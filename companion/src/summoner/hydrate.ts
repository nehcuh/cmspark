/** Overlay hydrate: last N role-prefixed plaintext messages.
 *  Preserve newlines. Never wrap HTML or chat bubbles.
 *
 *  GitHub: #324 — cruise_label is derived here (companion), never in Swift.
 */

import { getConfig } from "../config"
import {
  overlayCruiseChipLabel,
  type SecurityArmFlags,
} from "../security/autopilot-tier"
import { SUMMONER_SEARCH_HINT, type SummonerBrowser, type SummonerHydratePayload } from "./protocol"

const HYDRATE_CAP = 20
const HYDRATE_CHARS = 4000

/** Tray-process cache of companion-daemon unattended grant (not in config.json). */
let unattendedArmedCache = false

export function setOverlayUnattendedArmed(armed: boolean): void {
  unattendedArmedCache = armed === true
}

export function overlayUnattendedArmed(): boolean {
  return unattendedArmedCache
}

export function currentOverlayCruiseChipLabel(
  flags?: SecurityArmFlags,
  unattendedArmed?: boolean,
): string {
  const armed = unattendedArmed ?? unattendedArmedCache
  try {
    const security = flags ?? getConfig().security ?? {}
    return overlayCruiseChipLabel(security, armed)
  } catch {
    return overlayCruiseChipLabel(flags ?? {}, armed)
  }
}

/** Fill hydrate payload including derived cruise chip copy. */
export function buildSummonerHydratePayload(args: {
  thread_id: string
  lines: string[]
  browser: SummonerBrowser
}): SummonerHydratePayload {
  return {
    thread_id: args.thread_id,
    lines: args.lines,
    browser: args.browser,
    search_hint: SUMMONER_SEARCH_HINT,
    cruise_label: currentOverlayCruiseChipLabel(),
  }
}

export function hydratePlaintext(
  messages: Array<{ role: string; content?: string; tool_calls?: Array<{ function?: { name?: string } }> }>,
  cap = HYDRATE_CAP,
): string[] {
  const lines: string[] = []
  for (const m of messages) {
    if (m.role === "tool") {
      const name = m.tool_calls?.[0]?.function?.name
      lines.push(name ? `[工具] ${name}` : "[工具]")
      continue
    }
    const text = String(m.content || "").replace(/\r\n/g, "\n").trim()
    if (!text) continue
    const who = m.role === "user" ? "你" : m.role === "assistant" ? "助手" : m.role
    lines.push(`${who}: ${text.slice(0, HYDRATE_CHARS)}`)
  }
  return lines.slice(-cap)
}
