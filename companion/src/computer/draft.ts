import {
  ALLOWED_KEY_SET,
  ComputerError,
  INJECTIVE_ACTIONS,
  MAX_KEY_CHORD,
  MAX_SCROLL_DELTA,
  MAX_TYPE_TEXT_CHARS,
} from "./types"

export function validateComputerDraft(params: { task?: unknown; actions?: unknown }, platform: NodeJS.Platform): ComputerError | null {
  if (!params || typeof params.task !== "string" || params.task.trim() === "") {
    return new ComputerError("COMPUTER_INPUT_INVALID", "computer: task must be a non-empty string")
  }
  if (!Array.isArray(params.actions) || params.actions.length === 0) {
    return new ComputerError("COMPUTER_INPUT_INVALID", "computer: actions must be a non-empty draft sequence")
  }
  for (const a of params.actions) {
    if (!a || typeof a !== "object") return new ComputerError("COMPUTER_INPUT_INVALID", "computer: malformed action")
    const kind = (a as any).action
    if (INJECTIVE_ACTIONS.has(kind)) {
      if (kind === "type") {
        if (typeof (a as any).text !== "string" || (a as any).text.length === 0) {
          return new ComputerError("COMPUTER_INPUT_INVALID", "computer: type action requires non-empty text")
        }
        // X4 layer 2 (schema is layer 1, ps1 layer 3): bound the foreground
        // hijack window — per-text cap.
        if ((a as any).text.length > MAX_TYPE_TEXT_CHARS) {
          return new ComputerError(
            "TYPE_TEXT_TOO_LONG",
            `computer: type text is ${(a as any).text.length} chars — exceeds the ${MAX_TYPE_TEXT_CHARS}-char cap (X4)`,
          )
        }
      } else if (kind === "key") {
        // WP2: named-key whitelist chords only — arbitrary VK / printable text
        // via key is rejected (text entry is the type primitive, A3 corpus).
        const keys = (a as any).keys
        if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_KEY_CHORD) {
          return new ComputerError("COMPUTER_INPUT_INVALID", `computer: key requires 1..${MAX_KEY_CHORD} key names`)
        }
        for (const k of keys) {
          if (typeof k !== "string" || !ALLOWED_KEY_SET.has(k.toLowerCase())) {
            return new ComputerError("COMPUTER_INPUT_INVALID", `computer: key name "${String(k)}" is not in the whitelist (plan §D.3)`)
          }
        }
        if (platform === "darwin") {
          // The Swift injector posts named non-modifier keys with modifier flags.
          // Its current key map has no F1-F12. Do not report a partial or empty post.
          if (keys.some(key => /^f\d+$/i.test(key))) {
            return new ComputerError("COMPUTER_INPUT_INVALID", "computer: macOS key actions do not support F1–F12")
          }
          if (keys.every(key => ["ctrl", "alt", "shift", "win"].includes(key.toLowerCase()))) {
            return new ComputerError("COMPUTER_INPUT_INVALID", "computer: macOS key actions require a named non-modifier key")
          }
        }
      } else if (kind === "scroll") {
        if (!Number.isInteger((a as any).x) || !Number.isInteger((a as any).y)) {
          return new ComputerError("COMPUTER_INPUT_INVALID", "computer: scroll requires integer x/y")
        }
        const d = (a as any).delta
        if (!Number.isInteger(d) || d === 0 || Math.abs(d) > MAX_SCROLL_DELTA) {
          return new ComputerError("COMPUTER_INPUT_INVALID", `computer: scroll delta must be a non-zero integer within ±${MAX_SCROLL_DELTA}`)
        }
      } else if (kind === "drag") {
        for (const f of ["x", "y", "x2", "y2"]) {
          if (!Number.isInteger((a as any)[f])) {
            return new ComputerError("COMPUTER_INPUT_INVALID", `computer: drag requires integer ${f}`)
          }
        }
      } else {
        // click family: explicit x/y or an OCR target anchor
        const hasCoords = Number.isInteger((a as any).x) && Number.isInteger((a as any).y)
        const hasTarget = typeof (a as any).target === "string" && (a as any).target.length > 0
        if (!hasCoords && !hasTarget) {
          return new ComputerError("COMPUTER_INPUT_INVALID", `computer: ${kind} requires explicit x/y or a target text anchor`)
        }
      }
    } else if (kind === "wait") {
      if (!Number.isInteger((a as any).ms) || (a as any).ms < 0) {
        return new ComputerError("COMPUTER_INPUT_INVALID", "computer: wait requires integer ms >= 0")
      }
    } else if (kind !== "screenshot" && kind !== "describe") {
      return new ComputerError("COMPUTER_INPUT_INVALID", `computer: unsupported action "${kind}"`)
    }
  }
  // X4: corpus TOTAL cap — task-splitting must not multiply the injection window.
  const corpusChars = params.actions.reduce(
    (n, a) => n + ((a as any)?.action === "type" && typeof (a as any).text === "string" ? (a as any).text.length : 0),
    0,
  )
  if (corpusChars > MAX_TYPE_TEXT_CHARS) {
    return new ComputerError(
      "TYPE_TEXT_TOO_LONG",
      `computer: task type corpus totals ${corpusChars} chars — exceeds the ${MAX_TYPE_TEXT_CHARS}-char cap (X4)`,
    )
  }
  return null
}
