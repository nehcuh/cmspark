/**
 * Dictation+ D2 — hold hotkey chord parse / validate (pure).
 * SoT: 2026-08-07-dictation-plus-design.md §5.2
 */

export type HotkeyChord = {
  /** Normalized parts for matching KeyboardEvent */
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  /** Lowercase key: "space" | "a" | "f1" | ... */
  key: string
  /** Display label */
  label: string
}

/** Suggested presets (no bare fn / Win+V). */
export const DICTATION_HOTKEY_PRESETS: Array<{ id: string; label: string; chord: string }> = [
  { id: "ctrl-shift-space", label: "Ctrl+Shift+Space", chord: "Control+Shift+Space" },
  { id: "alt-space", label: "Alt+Space / ⌥Space", chord: "Alt+Space" },
  { id: "ctrl-alt-space", label: "Ctrl+Alt+Space", chord: "Control+Alt+Space" },
  { id: "ctrl-shift-d", label: "Ctrl+Shift+D", chord: "Control+Shift+D" },
]

export const DICTATION_HOTKEY_DEFAULT_CHORD = "Control+Shift+Space"

const FORBIDDEN = new Set([
  "fn",
  "function",
  "metaleft",
  "metaright",
  // Win+V clipboard history — never default / never allow as sole chord
])

/**
 * Parse "Control+Shift+Space" style chord.
 * Returns null if empty, bare modifier, or forbidden (fn / Win+V alone).
 */
export function parseHotkeyChord(raw: string | null | undefined): HotkeyChord | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  const parts = raw
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return null

  let ctrl = false
  let alt = false
  let shift = false
  let meta = false
  let key = ""

  for (const p of parts) {
    const low = p.toLowerCase()
    if (low === "control" || low === "ctrl" || low === "⌃") ctrl = true
    else if (low === "alt" || low === "option" || low === "⌥") alt = true
    else if (low === "shift" || low === "⇧") shift = true
    else if (low === "meta" || low === "cmd" || low === "command" || low === "⌘" || low === "win" || low === "windows") {
      meta = true
    } else if (FORBIDDEN.has(low)) {
      return null
    } else {
      // Normalize "KeyM" / "Digit1" style codes users may type
      let k = low === " " ? "space" : low
      if (/^key[a-z]$/.test(k)) k = k.slice(3)
      if (/^digit[0-9]$/.test(k)) k = k.slice(5)
      key = k
    }
  }

  if (!key) return null
  // Forbid Win+V / Meta+V (clipboard)
  if (meta && key === "v" && !ctrl && !alt && !shift) return null
  if (key === "fn" || key === "function") return null
  // Require at least one modifier for safety
  if (!ctrl && !alt && !shift && !meta) return null

  const labelParts: string[] = []
  if (ctrl) labelParts.push("Ctrl")
  if (alt) labelParts.push("Alt")
  if (shift) labelParts.push("Shift")
  if (meta) labelParts.push("Meta")
  labelParts.push(key === "space" ? "Space" : key.length === 1 ? key.toUpperCase() : key)

  return {
    ctrl,
    alt,
    shift,
    meta,
    key,
    label: labelParts.join("+"),
  }
}

/** Match KeyboardEvent (keydown/keyup) against chord. */
export function eventMatchesChord(
  e: { key: string; code?: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean },
  chord: HotkeyChord,
): boolean {
  if (e.ctrlKey !== chord.ctrl) return false
  if (e.altKey !== chord.alt) return false
  if (e.shiftKey !== chord.shift) return false
  if (e.metaKey !== chord.meta) return false

  const k = (e.key || "").toLowerCase()
  const code = (e.code || "").toLowerCase()
  if (chord.key === "space") {
    return k === " " || k === "spacebar" || k === "space" || code === "space"
  }
  // Allow "KeyM" / "keym" style from user input
  const normKey = chord.key.replace(/^key/, "")
  if (normKey.length === 1) {
    return k === normKey || code === `key${normKey}` || code === chord.key
  }
  if (chord.key.length === 1) {
    return k === chord.key || code === `key${chord.key}`
  }
  return k === chord.key || code === chord.key || code === `key${chord.key}`
}

/** Serialize for storage. */
export function formatChord(c: HotkeyChord): string {
  const parts: string[] = []
  if (c.ctrl) parts.push("Control")
  if (c.alt) parts.push("Alt")
  if (c.shift) parts.push("Shift")
  if (c.meta) parts.push("Meta")
  parts.push(c.key === "space" ? "Space" : c.key.length === 1 ? c.key.toUpperCase() : c.key)
  return parts.join("+")
}

/**
 * Build a storage chord string from a KeyboardEvent (D2 UX capture).
 * Returns null for pure modifier presses, bare keys, or forbidden chords (fn / Win+V).
 */
export function chordFromKeyboardEvent(e: {
  key: string
  code?: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}): string | null {
  const k = e.key
  // Ignore pure modifier keydowns — wait for the main key
  if (
    k === "Control" ||
    k === "Shift" ||
    k === "Alt" ||
    k === "AltGraph" ||
    k === "Meta" ||
    k === "OS" ||
    k === "Fn" ||
    k === "Hyper" ||
    k === "Super"
  ) {
    return null
  }
  // Fn rarely surfaces; ban explicitly if it does
  if (k.toLowerCase() === "fn" || k.toLowerCase() === "function") return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push("Control")
  if (e.altKey) parts.push("Alt")
  if (e.shiftKey) parts.push("Shift")
  if (e.metaKey) parts.push("Meta")

  let main = ""
  if (k === " " || k === "Spacebar" || e.code === "Space") {
    main = "Space"
  } else if (k.length === 1) {
    main = /[a-zA-Z]/.test(k) ? k.toUpperCase() : k
  } else if (e.code && /^Key[A-Z]$/i.test(e.code)) {
    main = e.code.slice(3).toUpperCase()
  } else if (e.code && /^Digit[0-9]$/.test(e.code)) {
    main = e.code.slice(5)
  } else {
    main = k
  }
  if (!main) return null
  parts.push(main)
  const raw = parts.join("+")
  // Reuse parse for forbid rules (≥1 modifier, no bare fn, no Meta+V alone)
  const parsed = parseHotkeyChord(raw)
  return parsed ? formatChord(parsed) : null
}
