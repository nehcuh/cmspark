// #258 status capsule mapping (pure). Browser path must not pretend it has a level.

import type { VoicePhase } from "./types"

export type CapsuleTone = "red" | "blue" | "warmup"

export type CapsuleView = {
  visible: boolean
  tone: CapsuleTone
  useLevel: boolean
  pulse: boolean
  label: string
  hint: string
  live: string
}

export function capsuleView(opts: {
  phase: VoicePhase
  engine: "browser" | "local"
  locked: boolean
  level: number
}): CapsuleView {
  const hidden: CapsuleView = {
    visible: false,
    tone: "red",
    useLevel: false,
    pulse: false,
    label: "",
    hint: "",
    live: "",
  }
  const { phase, engine, locked } = opts
  if (phase === "idle" || phase === "unsupported" || phase === "error") return hidden

  if (phase === "starting") {
    return {
      visible: true,
      tone: "warmup",
      useLevel: false,
      pulse: false,
      label: engine === "local" ? "预热中…" : "正在开始…",
      hint: "",
      live: engine === "local" ? "模型预热中" : "正在开始听写",
    }
  }

  if (phase === "listening") {
    const lock = locked ? "已锁定 · 再按结束" : "录音中"
    if (engine === "browser") {
      return {
        visible: true,
        tone: "red",
        useLevel: false,
        pulse: true,
        label: lock,
        hint: "浏览器听写无电平",
        live: `${lock}，匀速脉冲，无麦克风电平`,
      }
    }
    return {
      visible: true,
      tone: "red",
      useLevel: true,
      pulse: false,
      label: lock,
      hint: "",
      live: lock,
    }
  }

  if (phase === "processing" || phase === "stopping" || phase === "refining") {
    const label = phase === "refining" ? "纠错中…" : "转写中…"
    return {
      visible: true,
      tone: "blue",
      useLevel: false,
      pulse: false,
      label,
      hint: "",
      live: label,
    }
  }

  return hidden
}
