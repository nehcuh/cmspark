// Fixed read-only NTFS admission. No ACL remediation, user names or descriptor output.
import { runPs, resolveWinScript } from "../host-use/win/powershell"
export async function verifyHistoryPrivacy(paths: string[]): Promise<"PRIVATE" | "REFUSED" | "UNKNOWN"> {
  if (paths.length < 1 || paths.length > 2 || paths.some(p => !p || p.includes("\0"))) return "UNKNOWN"
  try {
    const result = JSON.parse((await runPs(resolveWinScript("acp-history-privacy.ps1"), paths)).trim())
    return result === "PRIVATE" || result === "REFUSED" ? result : "UNKNOWN"
  } catch { return "UNKNOWN" }
}
