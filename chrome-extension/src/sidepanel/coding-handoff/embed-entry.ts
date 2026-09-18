// #502 C — pure (React-free) rules for the in-plugin embedded terminal entry + Mode C copy.
//
// Why a module and not inline JSX: the Side Panel entry is load-bearing (a recorded embed
// intent is unclaimable without it) and its gate is a security-relevant switch
// (`embedded_terminal.enabled`). Keeping the gate and the Mode C copy ladder as pure
// functions makes both unit-testable without a DOM harness.

import { codingHandoffCopy } from "./copy"

/**
 * `config.embedded_terminal` — the NESTED key, exactly as written by SettingsSlideout
 * (`config.set { embedded_terminal: { enabled } }`). There is no flattened
 * `embedded_terminal_enabled`; do not invent one (no new config key, #502 C).
 */
export type EmbeddedTerminalConfig =
  | { embedded_terminal?: { enabled?: boolean } }
  | null
  | undefined

/**
 * Gate for the Side Panel「在本插件打开终端」entry (config half).
 *
 * The darwin half is `isDarwin()` below: the button is shown on `enabled && isDarwin()`.
 * The companion still refuses a non-darwin host with `unsupported`
 * (内嵌终端仅支持 macOS) — this is a UI-hiding gate, NOT a security boundary.
 */
export function shouldShowEmbeddedTerminalEntry(config: EmbeddedTerminalConfig): boolean {
  return config?.embedded_terminal?.enabled === true
}

/** The slice of `navigator` the darwin predicate reads (callers pass a literal; not a public type). */
type PlatformEnv = {
  userAgentData?: { platform?: unknown } | null
  platform?: unknown
  userAgent?: unknown
}

function nonEmptyString(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/**
 * Is this host macOS? Total and FAIL-CLOSED: anything inconclusive is `false`, so we never
 * promise an embed the companion would refuse (`unsupported`).
 *
 * Order — the side panel reports `navigator.userAgentData.platform === "macOS"` (the strongest
 * signal, and the only one that is not a UA-string sniff); `navigator.platform` then the UA
 * string are fallbacks. iPad/iPhone UAs also say "like Mac OS X", so the UA rung requires
 * "Macintosh" and rejects iOS. No wire field, no config key.
 *
 * NOT a security boundary — the companion re-checks the real platform.
 */
export function isDarwin(env?: PlatformEnv | null): boolean {
  const e: PlatformEnv | null =
    env === undefined
      ? typeof navigator === "undefined"
        ? null
        : (navigator as PlatformEnv)
      : env
  if (!e) return false
  const uadp = nonEmptyString(e.userAgentData?.platform)
  if (uadp) return /^mac/i.test(uadp)
  const platform = nonEmptyString(e.platform)
  if (platform) return /^mac/i.test(platform)
  const ua = nonEmptyString(e.userAgent)
  if (ua) return /Macintosh/.test(ua) && !/iPhone|iPad|iPod/.test(ua)
  return false
}

/** Mode C host-terminal outcome, as emitted by the companion (`local_terminal`). */
export type LocalTerminalState =
  | "pending"
  | "opened"
  | "opened_l0"
  | "failed"
  | "skipped"
  | "embed_intent"
  | string
  | undefined

/**
 * True when Mode C is *involved* for this session: a host terminal is/was opening or open, or
 * the propose-time snapshot said Mode C (`open_local_terminal`). Drives the Mode C hint.
 */
export function isModeCInvolved(
  localTerminal: LocalTerminalState,
  openLocalTerminal: boolean | undefined,
): boolean {
  return (
    localTerminal === "opened" ||
    localTerminal === "opened_l0" ||
    localTerminal === "pending" ||
    localTerminal === "embed_intent" ||
    (openLocalTerminal === true &&
      localTerminal !== "failed" &&
      localTerminal !== "skipped" &&
      localTerminal !== "embed_intent")
  )
}

/**
 * Stop honesty: true only when an OUTER terminal process exists that the side panel cannot end
 * — then Stop ends the monitor bridge alone. `embed_intent` is excluded: nothing was opened and
 * no PTY exists, so the outer-terminal title would be false; Stop ends the ACP session itself.
 */
export function isModeCMonitorStop(
  localTerminal: LocalTerminalState,
  openLocalTerminal: boolean | undefined,
): boolean {
  return (
    localTerminal === "opened" ||
    localTerminal === "opened_l0" ||
    localTerminal === "pending" ||
    (openLocalTerminal === true &&
      localTerminal !== "failed" &&
      localTerminal !== "skipped" &&
      localTerminal !== "embed_intent")
  )
}

/**
 * Mode C banner/hint copy for one outcome. Single source of truth for the panel banner and the
 * FocusBand chip hint — the two ladders had already drifted.
 *
 * `embed_intent` must NEVER fall through to `modeCDualProcessBanner`: that copy describes an
 * outer Terminal.app agent that has to exit on its own, while in this state nothing is running
 * at all and the user still has to click the panel button.
 */
export function modeCBannerText(
  localTerminal: LocalTerminalState,
  surface: { hasEntryButton?: boolean } = {},
): string {
  if (localTerminal === "embed_intent") {
    // Only say「点下方…」where the button is actually rendered next to this line (the panel
    // passes hasEntryButton; the FocusBand chip has no button and gets the honest variant).
    return surface.hasEntryButton === true
      ? codingHandoffCopy.modeCEmbedIntentBanner
      : codingHandoffCopy.modeCEmbedIntentBannerNoButton
  }
  // Defensive rung: both render sites gate on `isModeCInvolved`, which excludes `failed`,
  // so this string is not rendered today — it must still be non-lying if a site ever adds it.
  if (localTerminal === "failed") return codingHandoffCopy.modeCTerminalFailedBanner
  if (localTerminal === "opened_l0") {
    return codingHandoffCopy.modeCTerminalOpenedL0Banner + codingHandoffCopy.modeCDualProcessBanner
  }
  if (localTerminal === "pending") return codingHandoffCopy.modeCTerminalPendingBanner
  return codingHandoffCopy.modeCDualProcessBanner
}
