/** Server-owned native terminal adapter. No generic WS/router or ACP authority. */
import { getConfig } from "../config"
import { isModuleEnabled } from "../capability/modules"
import { ackPty, closePty, getOwnedPtyContext, isPtyBusy, pingPty, resizePty, spawnPtySession, writePtyInput } from "../pty/session"
import type { DesktopTerminalRuntime } from "./terminal-work"
/** Mirror the existing PTY default branch without executing or resolving a shell. */
export function nativeTerminalShell(): { file: string; args: string[] } {
  return process.platform === "win32" ? { file: "powershell.exe", args: [] } : { file: process.env.SHELL?.trim() || "/bin/zsh", args: ["-l"] }
}
export function createNativeTerminalRuntime(activity: DesktopTerminalRuntime["activity"]): DesktopTerminalRuntime {
  return {
    modules: () => ({ terminal: isModuleEnabled("devsec-workspace") && getConfig().embedded_terminal?.enabled === true, agent: false }),
    activity, shell: nativeTerminalShell,
    openTerminal(input) {
      if (JSON.stringify(nativeTerminalShell()) !== JSON.stringify(input.shell)) return { ok: false }
      return spawnPtySession({ id: input.id, threadId: input.threadId, owner: input.owner, cwd: input.cwd, cols: input.cols, rows: input.rows, send: input.send })
    },
    terminalContext: (id, owner) => !!getOwnedPtyContext(id, owner), terminalBusy: isPtyBusy,
    input: writePtyInput, resize: resizePty, ack: ackPty, ping: pingPty, close: closePty,
  }
}
