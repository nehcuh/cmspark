import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  buildWindowsFilePickScript,
  buildWindowsFolderPickScript,
  parsePickerStdout,
  resolveWindowsPowerShell,
  WORKSPACE_FOLDER_PROMPT,
} from "../src/obsidian/folder-picker"

const execFileP = promisify(execFile)

test("windows folder pick script forces UTF-8 stdout and a TopMost owner form", () => {
  const script = buildWindowsFolderPickScript(WORKSPACE_FOLDER_PROMPT)
  assert.match(script, /UTF8Encoding/)
  assert.match(script, /\[Console\]::OutputEncoding/)
  assert.match(script, /TopMost/)
  assert.match(script, /ShowDialog\(\$f\)/)
  assert.match(script, /选择工作区文件夹/)
  assert.match(script, /\[Console\]::Out\.Write/)
  assert.doesNotMatch(script, /Write-Output/)
})

test("windows folder pick script escapes PowerShell single quotes in the prompt", () => {
  const script = buildWindowsFolderPickScript("it's a folder")
  assert.match(script, /'it''s a folder'/)
})

test("windows file pick script uses the same owner + UTF-8 contract", () => {
  const script = buildWindowsFilePickScript("选择 Python", "Executable|*.exe")
  assert.match(script, /UTF8Encoding/)
  assert.match(script, /OpenFileDialog/)
  assert.match(script, /ShowDialog\(\$f\)/)
  assert.match(script, /选择 Python/)
})

test("parsePickerStdout strips BOM, CR, and trailing newline", () => {
  assert.equal(parsePickerStdout("\uFEFFC:\\Users\\HuChen\\proj\r\n"), "C:\\Users\\HuChen\\proj")
  assert.equal(parsePickerStdout(Buffer.from("C:\\tmp\\a\n", "utf8")), "C:\\tmp\\a")
})

test("windows PowerShell UTF-8 stdout round-trips a Chinese path", {
  skip: process.platform !== "win32" ? "Windows-only encoding contract" : false,
}, async () => {
  const dir = path.join(os.tmpdir(), `工作区测试-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  try {
    const exe = resolveWindowsPowerShell()
    const escaped = dir.replace(/'/g, "''")
    const script = [
      "$utf8 = New-Object System.Text.UTF8Encoding $false",
      "[Console]::OutputEncoding = $utf8",
      "$OutputEncoding = $utf8",
      `[Console]::Out.Write('${escaped}')`,
    ].join("; ")
    const { stdout } = await execFileP(exe, ["-NoProfile", "-STA", "-Command", script], {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    })
    const parsed = parsePickerStdout(stdout)
    assert.equal(parsed, dir)
    assert.equal(fs.existsSync(parsed), true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

