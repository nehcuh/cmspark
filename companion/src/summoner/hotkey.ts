/**
 * Summoner hotkey picker (S11).
 *
 * No default combo. First overlay open with empty config prompts a picker.
 * Candidates never include Spotlight / Raycast / uTools / IME space chords.
 *
 * Canonical persisted form: lowercase `mod+mod+key`, mods in order
 * ctrl, alt, shift, cmd. Example: `ctrl+alt+space`.
 */

import {
  encodeSummonerHotkeyPrompt,
  encodeSummonerHotkeySet,
  type SummonerOutboundCmd,
} from "./protocol"

export type SummonerHotkeyCandidate = {
  combo: string
  label: string
}

/** Occupied-by copy shown in the picker — not selectable. */
export type SummonerHotkeyStolen = SummonerHotkeyCandidate & {
  occupiedBy: string
}

const MOD_ORDER = ["ctrl", "alt", "shift", "cmd"] as const
type Mod = (typeof MOD_ORDER)[number]

const MOD_ALIASES: Record<string, Mod> = {
  ctrl: "ctrl",
  control: "ctrl",
  "^": "ctrl",
  "⌃": "ctrl",
  alt: "alt",
  option: "alt",
  opt: "alt",
  "⌥": "alt",
  shift: "shift",
  "⇧": "shift",
  cmd: "cmd",
  command: "cmd",
  meta: "cmd",
  super: "cmd",
  win: "cmd",
  "⌘": "cmd",
}

const KEY_ALIASES: Record<string, string> = {
  space: "space",
  " ": "space",
  period: "period",
  dot: "period",
  ".": "period",
  c: "c",
  k: "k",
  s: "s",
}

/**
 * S11 stolen defaults — never offered, never persisted.
 * Cmd+Space = Spotlight; ⌥Space / Alt+Space = Raycast / uTools; ⌃⇧Space = IME.
 */
export const SUMMONER_HOTKEY_STOLEN: readonly SummonerHotkeyStolen[] = [
  { combo: "cmd+space", label: "⌘Space / Cmd+Space", occupiedBy: "Spotlight" },
  { combo: "alt+space", label: "⌥Space / Alt+Space", occupiedBy: "Raycast / uTools" },
  { combo: "ctrl+shift+space", label: "⌃⇧Space", occupiedBy: "输入法" },
]

const STOLEN_SET = new Set(SUMMONER_HOTKEY_STOLEN.map((s) => s.combo))

/** Safe picker list. Must stay disjoint from SUMMONER_HOTKEY_STOLEN. */
export const SUMMONER_HOTKEY_CANDIDATES: readonly SummonerHotkeyCandidate[] = [
  { combo: "ctrl+alt+space", label: "⌃⌥Space" },
  { combo: "ctrl+alt+cmd+space", label: "⌃⌥⌘Space" },
  { combo: "ctrl+alt+c", label: "⌃⌥C" },
  { combo: "ctrl+alt+k", label: "⌃⌥K" },
  { combo: "ctrl+alt+s", label: "⌃⌥S" },
  { combo: "ctrl+alt+cmd+period", label: "⌃⌥⌘." },
]

const CANDIDATE_SET = new Set(SUMMONER_HOTKEY_CANDIDATES.map((c) => c.combo))

function tokenizeCombo(raw: string): string[] {
  let s = raw.trim()
  if (!s) return []
  // Expand leading Unicode modifiers so "⌃⌥Space" parses like "ctrl+alt+Space".
  s = s
    .replace(/⌘/g, "cmd+")
    .replace(/⌃/g, "ctrl+")
    .replace(/⌥/g, "alt+")
    .replace(/⇧/g, "shift+")
  return s
    .split(/[+＋]/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
}

/**
 * Canonical combo or null if unparseable.
 * Does not enforce the candidate allowlist — use `acceptedSummonerHotkey`.
 */
export function canonicalizeSummonerHotkey(raw: string): string | null {
  const parts = tokenizeCombo(raw)
  if (parts.length < 2) return null
  const keyRaw = parts[parts.length - 1]
  const key = KEY_ALIASES[keyRaw]
  if (!key) return null
  const mods = new Set<Mod>()
  for (const p of parts.slice(0, -1)) {
    const mod = MOD_ALIASES[p]
    if (!mod) return null
    mods.add(mod)
  }
  if (mods.size === 0) return null
  const ordered = MOD_ORDER.filter((m) => mods.has(m))
  return `${ordered.join("+")}+${key}`
}

export function isBannedSummonerHotkey(canonical: string): boolean {
  return STOLEN_SET.has(canonical)
}

export function isSafeSummonerHotkey(canonical: string): boolean {
  return CANDIDATE_SET.has(canonical) && !STOLEN_SET.has(canonical)
}

/** Persistable combo from picker / stdin, or null (banned / unknown). */
export function acceptedSummonerHotkey(raw: string): string | null {
  const canonical = canonicalizeSummonerHotkey(raw)
  if (!canonical || !isSafeSummonerHotkey(canonical)) return null
  return canonical
}

/**
 * First overlay open: empty / banned / unknown config → picker prompt.
 * Known safe combo → RegisterEventHotKey via `summoner.hotkey.set`.
 */
export function nextSummonerHotkeyCmd(hotkey: string | undefined | null): SummonerOutboundCmd {
  const accepted = acceptedSummonerHotkey(hotkey ?? "")
  if (accepted) return encodeSummonerHotkeySet({ combo: accepted })
  return encodeSummonerHotkeyPrompt()
}


export type SummonerHotkeyPickerRow =
  | { kind: "occupied"; combo: string; label: string; occupiedBy: string; selectable: false }
  | { kind: "candidate"; combo: string; label: string; selectable: true }

/** First-open picker: stolen chords listed as occupied (not selectable), then candidates. */
export function summonerHotkeyPickerRows(): SummonerHotkeyPickerRow[] {
  return [
    ...SUMMONER_HOTKEY_STOLEN.map((s) => ({
      kind: "occupied" as const,
      combo: s.combo,
      label: s.label,
      occupiedBy: s.occupiedBy,
      selectable: false as const,
    })),
    ...SUMMONER_HOTKEY_CANDIDATES.map((c) => ({
      kind: "candidate" as const,
      combo: c.combo,
      label: c.label,
      selectable: true as const,
    })),
  ]
}

export function isOccupiedHotkeyRow(row: SummonerHotkeyPickerRow): boolean {
  return row.selectable === false
}
