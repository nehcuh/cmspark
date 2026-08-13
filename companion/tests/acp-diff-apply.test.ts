import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  extractDiffText,
  parseUnifiedDiff,
  applyParsedDiffs,
  summarizeDiffFiles,
} from "../src/acp/diff-apply"
import { formatHandbackChatMessage, stripUntrustedFrame } from "../src/acp/handback-format"
import { resolveLaunchArgs } from "../src/acp/launch-presets"

describe("diff extract/parse/apply", () => {
  it("extracts fenced diff", () => {
    const t = extractDiffText("hello\n```diff\n--- a/x\n+++ b/x\n@@\n+hi\n```\n")
    assert.ok(t)
    assert.match(t!, /\+\+\+/)
  })

  it("parses and applies new file under workspace", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-diff-"))
    const diff = [
      "diff --git a/hello.txt b/hello.txt",
      "--- /dev/null",
      "+++ b/hello.txt",
      "@@ -0,0 +1,2 @@",
      "+hello",
      "+world",
      "",
    ].join("\n")
    const files = parseUnifiedDiff(diff)
    assert.ok(files.length >= 1)
    const r = applyParsedDiffs(root, files)
    assert.equal(r.ok, true)
    assert.ok(r.applied.includes("hello.txt") || r.applied.some((p) => p.endsWith("hello.txt")))
    const body = fs.readFileSync(path.join(root, "hello.txt"), "utf8")
    assert.match(body, /hello/)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("rejects path escape", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-diff-"))
    const files = [
      {
        relPath: "../evil.txt",
        hunk: "",
        newContent: "x",
        isNew: true,
        isDelete: false,
      },
    ]
    const r = applyParsedDiffs(root, files)
    assert.equal(r.applied.length, 0)
    assert.ok(r.skipped.some((s) => s.reason === "path_escape"))
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("summarizeDiffFiles non-empty", () => {
    const s = summarizeDiffFiles([
      { relPath: "a.ts", hunk: "", newContent: "1", isNew: true, isDelete: false },
    ])
    assert.match(s, /a\.ts/)
  })
})

describe("handback format", () => {
  it("strips frame and formats chat", () => {
    const framed =
      "<<<UNTRUSTED_ACP_HANDBACK agent=x session=s profile=review_readonly partial=false>\n<source>x</source>\n<body>\nfinding one\n</body>\n<<<END_UNTRUSTED_ACP_HANDBACK>>>"
    assert.match(stripUntrustedFrame(framed), /finding one/)
    const chat = formatHandbackChatMessage({
      agentId: "claude",
      mode: "review_readonly",
      handback: framed,
    })
    assert.match(chat, /编程接力/)
    assert.match(chat, /finding one/)
  })
})

describe("launch presets", () => {
  it("injects claude -p prompt arg", () => {
    const args = resolveLaunchArgs("claude", undefined, {
      prompt: "review me",
      promptFile: "/tmp/p.md",
    })
    assert.ok(args.includes("-p"))
    assert.ok(args.includes("review me"))
  })
})
