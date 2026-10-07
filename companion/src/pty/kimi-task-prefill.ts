import { stripVTControlCharacters } from "node:util"

/** Kimi 2.x has no interactive prompt argv. Wait for its empty message box,
 * then paste and submit the approved task once. Never type into trust/login menus.
 * Unknown UI versions keep the task pending rather than guessing a startup delay.
 */
export function createKimiTaskPrefill(task: string | undefined, write: (text: string) => void) {
  // A task is text, not terminal control input. A literal pasted ESC must not close
  // bracketed paste and turn later newlines into interactive key presses.
  let pending = (task || "").replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
  let output = ""
  return (data: string): boolean => {
    if (!pending) return false
    output = (output + data).slice(-65536)
    const end = output.lastIndexOf("\x1b[?2026l")
    const start = output.lastIndexOf("\x1b[?2026h")
    if (!output.includes("\x1b[?2004h") || start < 0 || end < start || !output.includes("Welcome to Kimi Code!")) return false
    // PTY chunks may contain an old ready render followed by a permission menu.
    // Only the latest complete render may establish the current empty input box.
    const screen = stripVTControlCharacters(output.slice(start, end))
    if (/(?:trust this folder|don't trust|enter select|log[ -]?in|sign[ -]?in|\bpermissions?\b|\byes[, ]+allow\b)/i.test(screen)) return false
    if (
        !screen.includes("No session yet") || !/│\s*>\s+│/.test(screen)) return false
    const submission = `\x1b[200~${pending}\x1b[201~\r`
    // Consume before writing so a synchronous render or write failure cannot
    // replay Enter into a later permission dialog.
    pending = ""
    output = ""
    write(submission)
    return true
  }
}
