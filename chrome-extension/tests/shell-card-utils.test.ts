// shell_exec tool-card extractors (pure, node:test)

import test from "node:test"
import assert from "node:assert/strict"
import {
  extractShellCardData,
  formatShellBody,
  formatShellMetaLine,
  previewShellCommand,
  SHELL_COMMAND_PREVIEW_CHARS,
} from "../src/sidepanel/utils/shell-card-utils"

test("previewShellCommand collapses whitespace and truncates", () => {
  assert.equal(previewShellCommand("  echo   hi\n  there  "), "echo hi there")
  const long = "x".repeat(SHELL_COMMAND_PREVIEW_CHARS + 40)
  const p = previewShellCommand(long)
  assert.ok(p.endsWith("…"))
  assert.equal(p.length, SHELL_COMMAND_PREVIEW_CHARS)
})

test("formatShellBody prefers stdout; prefixes stderr", () => {
  assert.equal(formatShellBody("ok\n", ""), "ok\n")
  assert.equal(formatShellBody("", "boom"), "[stderr]\nboom")
  assert.match(formatShellBody("out", "err"), /out\n\n\[stderr\]\nerr/)
})

test("extractShellCardData: happy path with stdout", () => {
  const card = extractShellCardData(
    { command: "cd /tmp && tail -3 brute.log" },
    {
      success: true,
      data: {
        exit_code: 0,
        timed_out: false,
        duration_ms: 27,
        cwd: "/Users/huchen/Downloads/netsafety",
        stdout: "R118 admin/x -> 用户名或密码错误\nR119 done\n",
        stderr: "",
        truncated: false,
      },
    },
  )
  assert.equal(card.failed, false)
  assert.equal(card.exitCode, 0)
  assert.match(card.commandPreview, /tail -3/)
  assert.match(card.body, /R118/)
  assert.match(formatShellMetaLine(card), /exit 0/)
  assert.match(formatShellMetaLine(card), /27ms/)
  assert.match(formatShellMetaLine(card), /Downloads\/netsafety|netsafety/)
})

test("extractShellCardData: non-zero exit → failed even if success:true", () => {
  const card = extractShellCardData(
    { command: "false" },
    { success: true, data: { exit_code: 1, stdout: "", stderr: "" } },
  )
  assert.equal(card.failed, true)
  assert.equal(card.exitCode, 1)
})

test("extractShellCardData: timed_out → failed + meta 超时", () => {
  const card = extractShellCardData(
    { command: "sleep 999" },
    {
      success: true,
      data: {
        exit_code: -1,
        timed_out: true,
        duration_ms: 120_000,
        stdout: "partial\n",
        stderr: "",
      },
    },
  )
  assert.equal(card.failed, true)
  assert.equal(card.timedOut, true)
  assert.equal(card.aborted, false)
  assert.match(formatShellMetaLine(card), /超时/)
  assert.match(card.body, /partial/)
})

test("extractShellCardData: aborted → failed + meta 已停止 (priority over 超时)", () => {
  const card = extractShellCardData(
    { command: "sleep 999" },
    {
      success: true,
      data: {
        exit_code: -1,
        timed_out: false,
        aborted: true,
        duration_ms: 1200,
        stdout: "partial\n",
        stderr: "",
      },
    },
  )
  assert.equal(card.failed, true)
  assert.equal(card.aborted, true)
  const meta = formatShellMetaLine(card)
  assert.match(meta, /已停止/)
  // node-shims Assert has no doesNotMatch — keep tsc green for npm test
  assert.ok(!/超时/.test(meta), "aborted meta must not also show 超时")
})

test("extractShellCardData: result.success false surfaces error as stderr body", () => {
  const card = extractShellCardData(
    { command: "x" },
    { success: false, error: "SHELL_SCOPE_DENIED: not allowed" },
  )
  assert.equal(card.failed, true)
  assert.match(card.body, /SHELL_SCOPE_DENIED/)
})

test("extractShellCardData: missing params still returns empty command", () => {
  const card = extractShellCardData(null, {
    success: true,
    data: { exit_code: 0, stdout: "hi", stderr: "" },
  })
  assert.equal(card.command, "")
  assert.equal(card.body, "hi")
})
