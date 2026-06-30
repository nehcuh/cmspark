// Native OS folder-picker for selecting the Obsidian vault path.
//
// Chrome extensions can't read the real absolute path of a user-selected folder (the
// File.path property is unreliable/hidden for security in MV3), so the picker runs in the
// companion — a local Node process with full FS access. macOS uses osascript `choose folder`
// (CMspark already drives osascript elsewhere); Linux uses zenity; Windows uses PowerShell's
// FolderBrowserDialog. Each surfaces the platform's real native dialog and returns the chosen
// absolute path; the UI just triggers it and adopts the result.

import { execFile } from "child_process"
import { promisify } from "util"
import { isLinux, isMacOS, isWindows } from "../platform"

const execFileP = promisify(execFile)
const PICK_TIMEOUT_MS = 120000 // the dialog blocks until the user picks/cancels

export interface PickResult {
  path?: string
  error?: string
}

/** Open the OS native folder-picker. Returns {path} on success, {error:"cancelled"} if the
 *  user dismissed it, or {error} describing the failure. */
export async function pickFolderNative(): Promise<PickResult> {
  try {
    if (isMacOS()) return await pickMacOS()
    if (isLinux()) return await pickLinux()
    if (isWindows()) return await pickWindows()
    return { error: "当前平台不支持图形化选择文件夹,请手动输入路径" }
  } catch (e: any) {
    return { error: `选择文件夹失败: ${e.message || String(e)}` }
  }
}

function trimTrailingSlash(p: string): string {
  const s = p.trim()
  return s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s
}

async function pickMacOS(): Promise<PickResult> {
  // `choose folder` returns an alias; `POSIX path of` yields the path (with a trailing slash).
  // Cancel → osascript exits non-zero with "User canceled" / error -128 in stderr.
  const script = 'POSIX path of (choose folder with prompt "选择你的 Obsidian Vault 文件夹")'
  try {
    const { stdout } = await execFileP("osascript", ["-e", script], { timeout: PICK_TIMEOUT_MS })
    const p = trimTrailingSlash(stdout)
    return p ? { path: p } : { error: "未选择文件夹" }
  } catch (e: any) {
    const msg = ((e.stderr || "") + " " + (e.message || "")).toString()
    if (/cancel|-128/i.test(msg)) return { error: "cancelled" }
    return { error: `macOS 文件夹对话框失败: ${msg.slice(0, 160)}` }
  }
}

async function pickLinux(): Promise<PickResult> {
  // zenity exits 0 with the path on stdout; exit 1 if cancelled; non-zero/ENOENT if missing.
  try {
    const { stdout } = await execFileP(
      "zenity",
      ["--file-selection", "--directory", "--title=选择你的 Obsidian Vault 文件夹"],
      { timeout: PICK_TIMEOUT_MS },
    )
    const p = trimTrailingSlash(stdout)
    return p ? { path: p } : { error: "cancelled" }
  } catch (e: any) {
    const msg = ((e.stderr || "") + " " + (e.message || "")).toString()
    if (e.code === "ENOENT") return { error: "未安装 zenity,请手动输入路径(或安装 zenity)" }
    if (e.code === 1 || /cancel/i.test(msg)) return { error: "cancelled" }
    return { error: `zenity 失败: ${msg.slice(0, 160)}` }
  }
}

async function pickWindows(): Promise<PickResult> {
  const ps =
    "Add-Type -AssemblyName System.Windows.Forms; " +
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
    "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }"
  try {
    const { stdout } = await execFileP("powershell", ["-NoProfile", "-Command", ps], {
      timeout: PICK_TIMEOUT_MS,
    })
    const p = stdout.trim()
    return p ? { path: p } : { error: "cancelled" }
  } catch (e: any) {
    const msg = ((e.stderr || "") + " " + (e.message || "")).toString()
    return { error: `Windows 文件夹对话框失败: ${msg.slice(0, 160)}` }
  }
}
