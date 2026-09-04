/**
 * #260 — kaldi-style 80-dim log-mel fbank front-end for speaker embeddings.
 * Matches the WeSpeaker/3D-Speaker ONNX export preprocessing family:
 * 25ms window / 10ms shift / 80 mel bins (20Hz–8kHz), natural log energies.
 * Pure TS (radix-2 FFT); no native deps; deterministic.
 */

export const FBANK_NUM_BINS = 80
export const FBANK_FRAME_MS = 25
export const FBANK_SHIFT_MS = 10
export const FBANK_SAMPLE_RATE = 16000

const FRAME_LEN = (FBANK_FRAME_MS * FBANK_SAMPLE_RATE) / 1000 // 400
const FRAME_SHIFT = (FBANK_SHIFT_MS * FBANK_SAMPLE_RATE) / 1000 // 160
const FFT_SIZE = 512 // next pow2 ≥ 400
const FMIN = 20
const FMAX = FBANK_SAMPLE_RATE / 2
const LOG_EPS = 1e-10

/** HTK mel scale. */
function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}

/** Triangular mel filterbank weights (computed once per process). */
let melBank: Float32Array[] | null = null
function getMelBank(): Float32Array[] {
  if (melBank) return melBank
  const numFftBins = FFT_SIZE / 2 + 1
  const binHz = FBANK_SAMPLE_RATE / FFT_SIZE
  const melMin = hzToMel(FMIN)
  const melMax = hzToMel(FMAX)
  const bank: Float32Array[] = []
  for (let b = 0; b < FBANK_NUM_BINS; b++) {
    const left = melMin + ((melMax - melMin) * b) / FBANK_NUM_BINS
    const center = melMin + ((melMax - melMin) * (b + 0.5)) / FBANK_NUM_BINS
    const right = melMin + ((melMax - melMin) * (b + 1)) / FBANK_NUM_BINS
    const w = new Float32Array(numFftBins)
    for (let k = 0; k < numFftBins; k++) {
      const hz = k * binHz
      const m = hzToMel(hz)
      if (m <= left || m >= right || center === left || center === right) continue
      w[k] = m <= center ? (m - left) / (center - left) : (right - m) / (right - center)
    }
    bank.push(w)
  }
  melBank = bank
  return bank
}

/** Povey window (kaldi default): raised cosine to the 0.85 power. */
let povey: Float32Array | null = null
function getPovey(): Float32Array {
  if (povey) return povey
  const w = new Float32Array(FRAME_LEN)
  for (let i = 0; i < FRAME_LEN; i++) {
    w[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_LEN - 1)), 0.85)
  }
  povey = w
  return w
}

/**
 * In-place iterative radix-2 FFT (real re/im arrays, length FFT_SIZE).
 * Standard Cooley-Tukey; deterministic ordering.
 */
function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!
        const ui = im[i + k]!
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/**
 * Log-mel fbank rows for 16kHz mono float samples.
 * snip_edges semantics (kaldi): num_frames = 1 + floor((n - FRAME_LEN) / FRAME_SHIFT).
 */
export function computeFbank(samples: Float32Array | number[]): Float32Array[] {
  const x = samples as ArrayLike<number>
  const n = x.length
  if (n === 0) return []
  const numFrames = n < FRAME_LEN ? 1 : 1 + Math.floor((n - FRAME_LEN) / FRAME_SHIFT)
  const win = getPovey()
  const bank = getMelBank()
  const numFftBins = FFT_SIZE / 2 + 1

  const rows: Float32Array[] = []
  const re = new Float32Array(FFT_SIZE)
  const im = new Float32Array(FFT_SIZE)
  for (let f = 0; f < numFrames; f++) {
    const start = Math.min(f * FRAME_SHIFT, Math.max(0, n - FRAME_LEN))
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < FRAME_LEN; i++) {
      re[i] = (x[start + i] ?? 0) * win[i]!
    }
    fftInPlace(re, im)
    const row = new Float32Array(FBANK_NUM_BINS)
    for (let b = 0; b < FBANK_NUM_BINS; b++) {
      const w = bank[b]!
      let e = 0
      for (let k = 0; k < numFftBins; k++) {
        const p = re[k]! * re[k]! + im[k]! * im[k]!
        e += p * w[k]!
      }
      row[b] = Math.log(Math.max(e, LOG_EPS))
    }
    rows.push(row)
  }
  return rows
}

/** Cepstral/utterance mean normalization over the time axis (per-bin mean subtract). */
export function cmnOverTime(rows: Float32Array[]): Float32Array[] {
  if (rows.length === 0) return []
  const bins = rows[0]!.length
  const mean = new Float64Array(bins)
  for (const r of rows) {
    for (let b = 0; b < bins; b++) mean[b] += r[b] ?? 0
  }
  for (let b = 0; b < bins; b++) mean[b] /= rows.length
  return rows.map((r) => {
    const out = new Float32Array(bins)
    for (let b = 0; b < bins; b++) out[b] = (r[b] ?? 0) - mean[b]!
    return out
  })
}
