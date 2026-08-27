/**
 * #239 ChatShell copy lockstep — companion constants must match the
 * extension source strings. Do not import the chrome-extension module.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(__dirname, "..", "..")

function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

test("ChatShell copy constants lockstep with chrome-extension (no import)", () => {
  const extPath = path.join(ROOT, "..", "chrome-extension", "src", "sidepanel", "chat-shell-copy.ts")
  const companionPath = srcFile("summoner", "client.ts")
  const ext = fs.readFileSync(extPath, "utf8")
  const companion = fs.readFileSync(companionPath, "utf8")

  const constants = [
    "CHAT_SHELL_TITLE_PAGE",
    "CHAT_SHELL_TITLE_NONE",
    "CHAT_SHELL_PAGE_CHIP_PREFIX",
    "CHAT_SHELL_CHIPS",
  ]
  for (const name of constants) {
    assert.match(ext, new RegExp(name))
    assert.match(companion, new RegExp(name))
  }

  const strings = [
    "要对这页做什么？",
    "要我帮你做什么？",
    "当前页：",
    "总结这一页",
    "请总结当前页面的要点",
    "用更简单的话讲这一页",
    "用更简单的话讲这一页在干什么",
    "列出我能在这页替你做的操作",
    "列出当前页我可以替你执行的操作",
  ]
  for (const s of strings) {
    assert.match(ext, new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.match(companion, new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }
})
