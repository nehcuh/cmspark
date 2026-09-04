/**
 * #260 评测夹具：确定性合成多说话人音频（mulberry32 种子；谐波+共振峰声源；
 * 同 RMS 归一抹掉 legacy 能量特征）。由 diarize-eval.ts 使用。
 * 覆盖：spec 钉死的 3/5 段已知人数拼接 + 长夹具统计力 + 同性别近 F0 对抗。
 */

export const EVAL_SR = 16000
export const EVAL_SEG_SECONDS = 2.0

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type SpeakerProfile = {
  f0: number
  formants: [number, number, number]
  seed: number
}

/**
 * One segment of voiced speech: harmonic glottal source with formant
 * resonance shaping, slow F0 drift (prosody), syllable-rate envelope and
 * breath noise. Speaker identity = F0 mean + formant positions; drift/phase/
 * noise vary per segment (same speaker must still cluster together).
 */
export function synthSegment(sp: SpeakerProfile, rand: () => number): Float32Array {
  const n = Math.floor(EVAL_SR * EVAL_SEG_SECONDS)
  const out = new Float32Array(n)
  const [f1, f2, f3] = sp.formants
  const bw = [90, 120, 180]
  const driftPhase = rand() * Math.PI * 2
  const syllPhase = rand() * Math.PI * 2
  let phaseAcc = 0
  for (let i = 0; i < n; i++) {
    const t = i / EVAL_SR
    const f0 = sp.f0 * (1 + 0.02 * Math.sin(2 * Math.PI * 0.7 * t + driftPhase))
    phaseAcc += (2 * Math.PI * f0) / EVAL_SR
    const env = 0.55 + 0.45 * Math.max(0, Math.sin(2 * Math.PI * 3.5 * t + syllPhase))
    let s = 0
    for (let h = 1; h * f0 < 7800; h++) {
      const f = h * f0
      const g =
        1.0 / (1 + Math.pow((f - f1) / bw[0], 2)) +
        0.7 / (1 + Math.pow((f - f2) / bw[1], 2)) +
        0.4 / (1 + Math.pow((f - f3) / bw[2], 2))
      s += (Math.sin(phaseAcc * h) * g) / h
    }
    out[i] = s * env + (rand() - 0.5) * 0.002
  }
  // same-RMS normalization (adversarial: kills legacy log-energy feature)
  let e = 0
  for (let i = 0; i < n; i++) e += out[i]! * out[i]!
  const rms = Math.sqrt(e / n) || 1
  const gain = 0.05 / rms
  for (let i = 0; i < n; i++) out[i] = out[i]! * gain
  return out
}

export type Fixture = {
  name: string
  truthK: number
  /** truth speaker index per segment (0..K-1) */
  truth: number[]
  speakers: SpeakerProfile[]
  /** adversarial: same gender, close F0, same volume */
  adversarial?: boolean
}

const SPK_BASE: SpeakerProfile[] = [
  { f0: 110, formants: [520, 1450, 2500], seed: 101 },
  { f0: 200, formants: [680, 1900, 2900], seed: 102 },
  { f0: 96, formants: [480, 1250, 2350], seed: 103 },
  { f0: 222, formants: [740, 2050, 3050], seed: 104 },
  { f0: 132, formants: [560, 1600, 2650], seed: 105 },
  { f0: 250, formants: [800, 2200, 3200], seed: 106 },
]

/**
 * Held-out 说话人档案（#260 round-2）：全新 F0/共振峰/种子（301+），与
 * SPK_BASE 零重叠 —— DIARIZE_CLUSTER_THRESHOLD=0.06 只在 SPK_BASE 夹具上校准，
 * 这些夹具不参与调参，专供过门（防止「同一套夹具又校准又过门」）。
 */
const SPK_HELDOUT: SpeakerProfile[] = [
  { f0: 105, formants: [500, 1400, 2500], seed: 301 },
  { f0: 185, formants: [650, 1850, 2850], seed: 302 },
  { f0: 92, formants: [470, 1200, 2300], seed: 303 },
  { f0: 210, formants: [720, 2000, 3000], seed: 304 },
  { f0: 148, formants: [590, 1700, 2750], seed: 305 },
  { f0: 240, formants: [780, 2150, 3150], seed: 306 },
]

/**
 * One rand stream per fixture (seeded by its speaker set); synth in truth
 * order so same fixture → byte-identical audio (deterministic reruns).
 */
function synthesize(fixtures: Fixture[]): Float32Array[][] {
  return fixtures.map((f) => {
    const rand = mulberry32(0xc0ffee + f.speakers.reduce((s, p) => s + p.seed, 0))
    return f.truth.map((spk) => synthSegment(f.speakers[spk]!, rand))
  })
}

/** 校准集（DIARIZE_CLUSTER_THRESHOLD 在此调参；round-2 起仅作参考分栏，不过门）。 */
export function buildFixtures(): { fixtures: Fixture[]; segs: Float32Array[][] } {
  const fixtures: Fixture[] = [
    // spec letter: 3/5-segment known-K concatenated multi-speaker audio
    {
      name: "segs3-K2",
      truthK: 2,
      truth: [0, 1, 0],
      speakers: [SPK_BASE[0]!, SPK_BASE[1]!],
    },
    {
      name: "segs5-K3",
      truthK: 3,
      truth: [0, 1, 2, 0, 1],
      speakers: [SPK_BASE[0]!, SPK_BASE[1]!, SPK_BASE[2]!],
    },
    // statistical power
    {
      name: "long10-K2",
      truthK: 2,
      truth: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
      speakers: [SPK_BASE[0]!, SPK_BASE[1]!],
    },
    {
      name: "long12-K3",
      truthK: 3,
      truth: [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2],
      speakers: [SPK_BASE[0]!, SPK_BASE[1]!, SPK_BASE[2]!],
    },
    {
      name: "long12-K4",
      truthK: 4,
      truth: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],
      speakers: SPK_BASE.slice(0, 4),
    },
    {
      name: "long10-K5",
      truthK: 5,
      truth: [0, 1, 2, 3, 4, 0, 1, 2, 3, 4],
      speakers: SPK_BASE.slice(0, 5),
    },
    // adversarial: same gender (male), close F0, same volume (RMS equalized)
    {
      name: "adv10-K2-closeF0",
      truthK: 2,
      truth: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
      speakers: [
        { f0: 120, formants: [510, 1420, 2480], seed: 201 },
        { f0: 127, formants: [540, 1500, 2560], seed: 202 },
      ],
      adversarial: true,
    },
    {
      name: "adv12-K3-closeF0",
      truthK: 3,
      truth: [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2],
      speakers: [
        { f0: 120, formants: [500, 1400, 2450], seed: 211 },
        { f0: 126, formants: [530, 1480, 2530], seed: 212 },
        { f0: 132, formants: [560, 1560, 2610], seed: 213 },
      ],
      adversarial: true,
    },
  ]
  return { fixtures, segs: synthesize(fixtures) }
}

/**
 * Held-out 过门集（#260 round-2）：全部使用 SPK_HELDOUT / 全新对抗种子（311+），
 * 与校准集的说话人档案、种子、随机流零重叠。评测门只看这组。
 */
export function buildHeldOutFixtures(): { fixtures: Fixture[]; segs: Float32Array[][] } {
  const fixtures: Fixture[] = [
    {
      name: "held-segs4-K2",
      truthK: 2,
      truth: [0, 1, 1, 0],
      speakers: [SPK_HELDOUT[0]!, SPK_HELDOUT[1]!],
    },
    {
      name: "held-long12-K3",
      truthK: 3,
      truth: [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2],
      speakers: [SPK_HELDOUT[0]!, SPK_HELDOUT[1]!, SPK_HELDOUT[2]!],
    },
    {
      name: "held-long12-K4",
      truthK: 4,
      truth: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],
      speakers: SPK_HELDOUT.slice(0, 4),
    },
    {
      name: "held-long10-K5",
      truthK: 5,
      truth: [0, 1, 2, 3, 4, 0, 1, 2, 3, 4],
      speakers: SPK_HELDOUT.slice(0, 5),
    },
    // adversarial held-out: close F0 males, RMS equalized
    {
      name: "held-adv8-K2-closeF0",
      truthK: 2,
      truth: [0, 1, 0, 1, 0, 1, 0, 1],
      speakers: [
        { f0: 138, formants: [545, 1510, 2560], seed: 311 },
        { f0: 145, formants: [570, 1580, 2630], seed: 312 },
      ],
      adversarial: true,
    },
    {
      name: "held-adv9-K3-closeF0",
      truthK: 3,
      truth: [0, 1, 2, 0, 1, 2, 0, 1, 2],
      speakers: [
        { f0: 138, formants: [535, 1490, 2540], seed: 321 },
        { f0: 144, formants: [560, 1560, 2610], seed: 322 },
        { f0: 150, formants: [585, 1630, 2680], seed: 323 },
      ],
      adversarial: true,
    },
  ]
  return { fixtures, segs: synthesize(fixtures) }
}
