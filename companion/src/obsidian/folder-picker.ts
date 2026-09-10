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
import * as fs from "fs"
import * as nodePath from "path"
import { isLinux, isMacOS, isWindows } from "../platform"
import { OSASCRIPT_BIN } from "../process-path"

const execFileP = promisify(execFile)
const PICK_TIMEOUT_MS = 120000 // the dialog blocks until the user picks/cancels
/** Native dialog title — export is Markdown; this folder is optional convention source. */
const MARKDOWN_FOLDER_PROMPT = "选择 Markdown 笔记文件夹"
/** Dialog title for 编程接力 / 场景「选择工作区」. */
export const WORKSPACE_FOLDER_PROMPT = "选择工作区文件夹"

export interface PickResult {
  path?: string
  error?: string
}

function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function psSingleQuote(s: string): string {
  return s.replace(/\r?\n/g, " ").replace(/'/g, "''")
}

/** Decode picker stdout. PowerShell 5.1 may emit a BOM and CRLF. */
export function parsePickerStdout(stdout: string | Buffer): string {
  const s = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout)
  return s.replace(/^\uFEFF/, "").trim()
}

/**
 * Resolve Windows PowerShell 5.1 by absolute path. Bare `"powershell"` fails when
 * PATH is stripped (Git Bash / hidden VBS launcher) — same class as OSASCRIPT_BIN.
 */
export function resolveWindowsPowerShell(): string {
  const sysroot = process.env.SystemRoot || process.env.windir || "C:\\Windows"
  const candidate = nodePath.join(
    sysroot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  )
  try {
    if (fs.existsSync(candidate)) return candidate
  } catch {
    /* PATH fallback */
  }
  return "powershell.exe"
}

/**
 * WinForms folder-picker script.
 *
 * Production bugs this encodes (Windows-only; macOS osascript is fine):
 * 1. ShowDialog() with no owner + hidden companion → dialog behind Chrome / hung.
 *    Owner is a 1×1 TopMost form so the dialog comes to the foreground.
 * 2. PowerShell 5.1 stdout is the system ANSI code page (CP936 on zh-CN). Node
 *    decodes utf8 → Chinese paths become mojibake → realpath ENOENT.
 */
export function buildWindowsFolderPickScript(prompt: string): string {
  const title = psSingleQuote(prompt)
  return [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "[System.Windows.Forms.Application]::EnableVisualStyles()",
    "$utf8 = New-Object System.Text.UTF8Encoding $false",
    "[Console]::OutputEncoding = $utf8",
    "$OutputEncoding = $utf8",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    `$d.Description = '${title}'`,
    "$d.ShowNewFolderButton = $true",
    "try { $d.UseDescriptionForTitle = $true } catch {}",
    "$f = New-Object System.Windows.Forms.Form",
    "$f.TopMost = $true",
    "$f.ShowInTaskbar = $false",
    "$f.StartPosition = 'Manual'",
    "$f.Location = New-Object System.Drawing.Point(-32000, -32000)",
    "$f.Size = New-Object System.Drawing.Size(1, 1)",
    "$null = $f.Show()",
    "try { $f.Activate() } catch {}",
    "$r = $d.ShowDialog($f)",
    "$f.Close()",
    "$f.Dispose()",
    "if ($r -eq [System.Windows.Forms.DialogResult]::OK -and $d.SelectedPath) {",
    "  [Console]::Out.Write($d.SelectedPath)",
    "}",
  ].join("; ")
}

export function buildWindowsFilePickScript(prompt: string, filter?: string): string {
  const title = psSingleQuote(prompt)
  const flt = psSingleQuote(filter || "Executable|*.exe;python.exe;pythonw.exe|All files|*.*")
  return [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "[System.Windows.Forms.Application]::EnableVisualStyles()",
    "$utf8 = New-Object System.Text.UTF8Encoding $false",
    "[Console]::OutputEncoding = $utf8",
    "$OutputEncoding = $utf8",
    "$d = New-Object System.Windows.Forms.OpenFileDialog",
    `$d.Title = '${title}'`,
    `$d.Filter = '${flt}'`,
    "$d.CheckFileExists = $true",
    "$f = New-Object System.Windows.Forms.Form",
    "$f.TopMost = $true",
    "$f.ShowInTaskbar = $false",
    "$f.StartPosition = 'Manual'",
    "$f.Location = New-Object System.Drawing.Point(-32000, -32000)",
    "$f.Size = New-Object System.Drawing.Size(1, 1)",
    "$null = $f.Show()",
    "try { $f.Activate() } catch {}",
    "$r = $d.ShowDialog($f)",
    "$f.Close()",
    "$f.Dispose()",
    "if ($r -eq [System.Windows.Forms.DialogResult]::OK -and $d.FileName) {",
    "  [Console]::Out.Write($d.FileName)",
    "}",
  ].join("; ")
}

async function runWindowsFormsDialog(script: string, failLabel: string): Promise<PickResult> {
  const exe = resolveWindowsPowerShell()
  try {
    const { stdout } = await execFileP(exe, ["-NoProfile", "-STA", "-Command", script], {
      timeout: PICK_TIMEOUT_MS,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    })
    const picked = parsePickerStdout(stdout)
    return picked ? { path: picked } : { error: "cancelled" }
  } catch (e: any) {
    if (e.killed || e.signal) return { error: "选择超时，请重试" }
    const msg = ((e.stderr || "") + " " + (e.message || "")).toString()
    return { error: `${failLabel}: ${msg.slice(0, 160)}` }
  }
}

/** Open the OS native folder-picker. Returns {path} on success, {error:"cancelled"} if the
 *  user dismissed it, or {error} describing the failure. */
export async function pickFolderNative(prompt?: string): Promise<PickResult> {
  const title = (prompt && prompt.trim()) || MARKDOWN_FOLDER_PROMPT
  try {
    if (isMacOS()) return await pickMacOS(title)
    if (isLinux()) return await pickLinux(title)
    if (isWindows()) return await pickWindows(title)
    return { error: "当前平台不支持图形化选择文件夹,请手动输入路径" }
  } catch (e: any) {
    return { error: `选择文件夹失败: ${e.message || String(e)}` }
  }
}

function trimTrailingSlash(p: string): string {
  const s = p.trim()
  return s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s
}

async function pickMacOS(prompt: string): Promise<PickResult> {
  // `choose folder` returns an alias; `POSIX path of` yields the path (with a trailing slash).
  // Cancel → osascript exits non-zero with "User canceled" / error -128 in stderr.
  const script = `POSIX path of (choose folder with prompt "${escapeAppleScriptString(prompt)}")`
  try {
    const { stdout } = await execFileP(OSASCRIPT_BIN, ["-e", script], { timeout: PICK_TIMEOUT_MS })
    const p = trimTrailingSlash(stdout)
    return p ? { path: p } : { error: "未选择文件夹" }
  } catch (e: any) {
    const msg = ((e.stderr || "") + " " + (e.message || "")).toString()
    if (/cancel|-128/i.test(msg)) return { error: "cancelled" }
    return { error: `macOS 文件夹对话框失败: ${msg.slice(0, 160)}` }
  }
}

async function pickLinux(prompt: string): Promise<PickResult> {
  // zenity exits 0 with the path on stdout; exit 1 if cancelled; non-zero/ENOENT if missing.
  try {
    const { stdout } = await execFileP(
      "zenity",
      ["--file-selection", "--directory", `--title=${prompt}`],
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

async function pickWindows(prompt: string): Promise<PickResult> {
  return runWindowsFormsDialog(buildWindowsFolderPickScript(prompt), "Windows 文件夹对话框失败")
}

/**
 * Native OS file-picker (single file). Used for selecting a Python interpreter.
 * Same platform backends as pickFolderNative; returns absolute path.
 */
export async function pickFileNative(opts?: {
  prompt?: string
  /** macOS ofi types e.g. {"public.unix-executable"} — best-effort filter */
  macTypes?: string[]
  /** PowerShell OpenFileDialog.Filter */
  windowsFilter?: string
}): Promise<PickResult> {
  const prompt = opts?.prompt || "选择文件"
  try {
    if (isMacOS()) return await pickFileMacOS(prompt)
    if (isLinux()) return await pickFileLinux(prompt)
    if (isWindows()) return await pickFileWindows(prompt, opts?.windowsFilter)
    return { error: "当前平台不支持图形化选择文件,请手动输入路径" }
  } catch (e: any) {
    return { error: `选择文件失败: ${e.message || String(e)}` }
  }
}

async function pickFileMacOS(prompt: string): Promise<PickResult> {
  // Escape prompt for AppleScript string
  const p = prompt.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  const script = `POSIX path of (choose file with prompt "${p}")`
  try {
    const { stdout } = await execFileP(OSASCRIPT_BIN, ["-e", script], { timeout: PICK_TIMEOUT_MS })
    const path = stdout.trim()
    return path ? { path } : { error: "未选择文件" }
  } catch (e: any) {
    const msg = ((e.stderr || "") + " " + (e.message || "")).toString()
    if (/cancel|-128/i.test(msg)) return { error: "cancelled" }
    return { error: `macOS 文件对话框失败: ${msg.slice(0, 160)}` }
  }
}

async function pickFileLinux(prompt: string): Promise<PickResult> {
  try {
    const { stdout } = await execFileP(
      "zenity",
      ["--file-selection", `--title=${prompt}`],
      { timeout: PICK_TIMEOUT_MS },
    )
    const path = stdout.trim()
    return path ? { path } : { error: "cancelled" }
  } catch (e: any) {
    const msg = ((e.stderr || "") + " " + (e.message || "")).toString()
    if (e.code === "ENOENT") return { error: "未安装 zenity,请手动输入路径" }
    if (e.code === 1 || /cancel/i.test(msg)) return { error: "cancelled" }
    return { error: `zenity 失败: ${msg.slice(0, 160)}` }
  }
}

async function pickFileWindows(prompt: string, filter?: string): Promise<PickResult> {
  return runWindowsFormsDialog(
    buildWindowsFilePickScript(prompt, filter),
    "Windows 文件对话框失败",
  )
}
