/** Server-owned native terminal adapter. No generic WS/router or ACP authority. */
import { getConfig } from "../config"
import { isModuleEnabled } from "../capability/modules"
import { captureOwnedPtyAckTicket, type OwnedPtyAckTicket, closePty, getOwnedPtyContext, isPtyBusy, pingPty, resizePty, spawnPtySession, writePtyInput } from "../pty/session"
import type { DesktopTerminalRuntime } from "./terminal-work"
/** Mirror the existing PTY default branch without executing or resolving a shell. */
export function nativeTerminalShell(): { file: string; args: string[] } {
  return process.platform === "win32" ? { file: "powershell.exe", args: [] } : { file: process.env.SHELL?.trim() || "/bin/zsh", args: ["-l"] }
}
export function createNativeTerminalRuntime(activity: DesktopTerminalRuntime["activity"]): DesktopTerminalRuntime {
  let receipt: { id: string; owner: unknown; ticket: OwnedPtyAckTicket } | undefined
  const retire = () => { receipt?.ticket.retire(); receipt = undefined }
  return {
    modules: () => ({ terminal: isModuleEnabled("devsec-workspace") && getConfig().embedded_terminal?.enabled === true, agent: false }),
    activity, shell: nativeTerminalShell,
    openTerminal(input) {
      if (JSON.stringify(nativeTerminalShell()) !== JSON.stringify(input.shell)) return { ok: false }
      const result = spawnPtySession({ id: input.id, threadId: input.threadId, owner: input.owner, cwd: input.cwd, cols: input.cols, rows: input.rows, send: input.send })
      if (result.ok) {
        const ticket = captureOwnedPtyAckTicket(input.id, input.owner)
        retire()
        if (ticket) receipt = { id: input.id, owner: input.owner, ticket }
      }
      return result
    },
    terminalAckContext: (id, owner) => receipt?.id === id && receipt.owner === owner && receipt.ticket.current(),
    retireTerminalAck(id, owner) { if (receipt?.id === id && receipt.owner === owner) retire() },
    terminalContext: (id, owner) => !!getOwnedPtyContext(id, owner), terminalBusy: isPtyBusy,
    input: writePtyInput, resize: resizePty, ack: (id, seq) => receipt?.id === id ? receipt.ticket.ack(seq) : { ok: false }, ping: pingPty, close: closePty,
  }
}
