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
 * Gate for the Side Panel「在本插件打开终端」entry.
 *
 * Darwin: intentionally NOT gated here. The extension has no darwin signal in the
 * config/session payload — `apps.list` `platform` is companion-narrowed to `win32 | other`
 * (darwin and linux both read `other`), and `voice/stt-engine-chain.detectChainPlatform()`
 * narrows the same way, so neither can decide "is darwin". Rather than add a wire field or a
 * config key, non-darwin hosts get the companion's honest refusal
 * (`terminal.closed` / `unsupported`: 内嵌终端仅支持 macOS), which the terminal tab renders.
 */
export function shouldShowEmbeddedTerminalEntry(config: EmbeddedTerminalConfig): boolean {
  return config?.embedded_terminal?.enabled === true
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
export function modeCBannerText(localTerminal: LocalTerminalState): string {
  if (localTerminal === "embed_intent") return codingHandoffCopy.modeCEmbedIntentBanner
  if (localTerminal === "failed") {
    return "模式 C：本机终端未打开；侧栏监视仍在。停止仅结束侧栏桥。"
  }
  if (localTerminal === "opened_l0") {
    return "模式 C：终端已开（L0 仅横幅，需手动粘贴命令）。" + codingHandoffCopy.modeCDualProcessBanner
  }
  if (localTerminal === "pending") return "模式 C：正在打开本机终端…"
  return codingHandoffCopy.modeCDualProcessBanner
}
