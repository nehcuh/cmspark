// #258 WebAudio status tones. No asset files. Accidental discard never plays.

export type VoiceSfxKind = "start" | "stop" | "cancel" | "done"

export const VOICE_SFX: Record<VoiceSfxKind, { freqs: number[]; durMs: number }> = {
  start: { freqs: [440, 660], durMs: 70 },
  stop: { freqs: [660, 440], durMs: 70 },
  cancel: { freqs: [196], durMs: 45 },
  done: { freqs: [523, 659], durMs: 90 },
}

export const VOICE_SOUND_EFFECTS_KEY = "voice_sound_effects"

export function parseVoiceSoundEffectsPref(value: unknown): boolean {
  if (value === false) return false
  return true
}

export function shouldPlayVoiceSfx(opts: {
  enabled?: boolean
  privacySheetOpen: boolean
  accidental: boolean
}): boolean {
  if (opts.accidental) return false
  if (opts.privacySheetOpen) return false
  if (opts.enabled === false) return false
  return true
}

/** Best-effort beep. Missing AudioContext / autoplay block → silent. */
export function playVoiceSfx(kind: VoiceSfxKind): void {
  const row = VOICE_SFX[kind]
  try {
    const AC =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const now = ctx.currentTime
    const step = row.durMs / 1000 / Math.max(1, row.freqs.length)
    row.freqs.forEach((f, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.05, now + i * step)
      gain.gain.exponentialRampToValueAtTime(0.001, now + (i + 1) * step)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + i * step)
      osc.stop(now + (i + 1) * step)
    })
    setTimeout(() => {
      try {
        void ctx.close()
      } catch {
        /* */
      }
    }, row.durMs + 80)
  } catch {
    /* ignore */
  }
}
