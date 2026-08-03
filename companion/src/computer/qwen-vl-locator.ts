// Qwen3-VL experimental locate layer — drop-in for former TinyClickLocator.
// Chinese commands are allowed (unlike TinyClick ASCII envelope).

import type { CaptureMeta } from "./types"
import { ModelRuntimeError } from "./qwen-vl-runtime"
import type { QwenVlSession } from "./qwen-vl-session"

export const MAX_COMMAND_CHARS = 200
export const MAX_FRAME_WIDTH = 3840
export const COLLAPSE_TOLERANCE_PX = 8

export const QWEN_VL_REASON = {
  TOO_LONG: "qwen-vl-envelope:too-long",
  FRAME_TOO_WIDE: "qwen-vl-envelope:frame-too-wide",
  COLLAPSE: "qwen-vl-collapse-detected",
  ERROR: "qwen-vl-error",
  EMPTY: "qwen-vl-envelope:empty-command",
} as const

export type QwenVlLocateOutcome =
  | {
      kind: "hit"
      point: { x: number; y: number }
      raw?: string
      ms?: number
    }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; reason: string }

export interface CollapseRecord {
  command: string
  x: number
  y: number
}

export interface QwenVlLocatorDeps {
  session: Pick<QwenVlSession, "locate">
  collapseHistory?: Map<string, CollapseRecord[]>
  maxCommandChars?: number
  maxFrameWidth?: number
  collapseTolerancePx?: number
}

export class QwenVlLocator {
  private readonly session: Pick<QwenVlSession, "locate">
  private readonly history: Map<string, CollapseRecord[]>
  private readonly maxCommandChars: number
  private readonly maxFrameWidth: number
  private readonly collapseTolerancePx: number

  constructor(deps: QwenVlLocatorDeps) {
    this.session = deps.session
    this.history = deps.collapseHistory ?? new Map()
    this.maxCommandChars = deps.maxCommandChars ?? MAX_COMMAND_CHARS
    this.maxFrameWidth = deps.maxFrameWidth ?? MAX_FRAME_WIDTH
    this.collapseTolerancePx = deps.collapseTolerancePx ?? COLLAPSE_TOLERANCE_PX
  }

  async locate(args: { command: string; shot: CaptureMeta }): Promise<QwenVlLocateOutcome> {
    const { command, shot } = args
    const cmd = (command || "").trim()
    if (!cmd) return { kind: "skipped", reason: QWEN_VL_REASON.EMPTY }
    if (cmd.length > this.maxCommandChars) {
      return { kind: "skipped", reason: QWEN_VL_REASON.TOO_LONG }
    }

    const width =
      Number(shot.imageWidth) ||
      Number(shot.rect?.width) ||
      0
    const height =
      Number(shot.imageHeight) ||
      Number(shot.rect?.height) ||
      0
    if (width > this.maxFrameWidth) {
      return { kind: "skipped", reason: QWEN_VL_REASON.FRAME_TOO_WIDE }
    }

    const imagePath = shot.path
    if (!imagePath) {
      return { kind: "error", reason: QWEN_VL_REASON.ERROR }
    }

    try {
      const r = await this.session.locate(cmd, imagePath, width, height)
      if (!r.point) {
        return { kind: "error", reason: QWEN_VL_REASON.ERROR }
      }
      const { x, y } = r.point

      // Collapse suppression (same as TinyClick G4)
      const frameSha = typeof (shot as any).sha256 === "string" ? (shot as any).sha256 : ""
      if (frameSha) {
        const hist = this.history.get(frameSha) ?? []
        for (const prev of hist) {
          if (prev.command === cmd) continue
          const dist = Math.hypot(prev.x - x, prev.y - y)
          if (dist <= this.collapseTolerancePx) {
            return { kind: "skipped", reason: QWEN_VL_REASON.COLLAPSE }
          }
        }
        hist.push({ command: cmd, x, y })
        this.history.set(frameSha, hist)
      }

      return { kind: "hit", point: { x, y }, raw: r.raw, ms: r.ms }
    } catch (e) {
      if (e instanceof ModelRuntimeError) {
        // Layer unavailable / busy / packaging gaps → skip so OCR/UIA continue.
        // Keep real codes (worker-missing, model-not-ready) — never collapse to
        // a misleading "model-disabled" when the switch is actually ON.
        if (
          e.code === "model-disabled" ||
          e.code === "model-not-ready" ||
          e.code === "qwen-vl-busy" ||
          e.code === "worker-missing" ||
          e.code === "worker-spawn-failed" ||
          e.code === "worker-exit"
        ) {
          return { kind: "skipped", reason: e.code }
        }
      }
      return { kind: "error", reason: QWEN_VL_REASON.ERROR }
    }
  }
}
