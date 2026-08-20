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
import { resolveLaunchArgs, resolveProtocolArgs } from "../src/acp/launch-presets"

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

  it("applies partial hunk without truncating rest of file (Pi B1)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-diff-"))
    const big = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n") + "\n"
    fs.writeFileSync(path.join(root, "big.txt"), big)
    const diff = [
      "diff --git a/big.txt b/big.txt",
      "--- a/big.txt",
      "+++ b/big.txt",
      "@@ -5,3 +5,3 @@",
      " line4",
      "-line5",
      "+LINE5-CHANGED",
      " line6",
      "",
    ].join("\n")
    const files = parseUnifiedDiff(diff)
    const r = applyParsedDiffs(root, files)
    assert.equal(r.ok, true, JSON.stringify(r))
    const result = fs.readFileSync(path.join(root, "big.txt"), "utf8")
    const lines = result.replace(/\n$/, "").split("\n")
    assert.equal(lines.length, 20, `expected 20 lines got ${lines.length}: ${result}`)
    assert.equal(lines[5], "LINE5-CHANGED")
    assert.equal(lines[0], "line0")
    assert.equal(lines[19], "line19")
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
        hunks: [],
      },
    ]
    const r = applyParsedDiffs(root, files)
    assert.equal(r.applied.length, 0)
    assert.ok(r.skipped.some((s) => s.reason === "path_escape"))
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("summarizeDiffFiles non-empty", () => {
    const s = summarizeDiffFiles([
      { relPath: "a.ts", hunk: "", newContent: "1", isNew: true, isDelete: false, hunks: [] },
    ])
    assert.match(s, /a\.ts/)
  })
})

describe("handback format", () => {
  it("strips frame and formats chat with 路径/摘要/建议验收 sections", () => {
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
    assert.match(chat, /### 路径/)
    assert.match(chat, /### 摘要/)
    assert.match(chat, /### 建议验收/)
  })

  it("shapeHandbackBody always emits section headers even with empty paths", async () => {
    const { shapeHandbackBody } = await import("../src/acp/handback-format")
    const empty = shapeHandbackBody({ body: "", paths: [] })
    assert.match(empty, /### 路径/)
    assert.match(empty, /（无）/)
    assert.match(empty, /### 摘要/)
    assert.match(empty, /### 建议验收/)
    const withPaths = shapeHandbackBody({ body: "done", paths: ["src/a.ts", "b.ts"] })
    assert.match(withPaths, /- src\/a\.ts/)
    assert.match(withPaths, /### 摘要\ndone/)
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

  it("uses grok --prompt-file for CLI bridge", () => {
    const args = resolveLaunchArgs("grok", undefined, {
      prompt: "review me",
      promptFile: "/tmp/p.md",
    })
    assert.deepEqual(args, ["--prompt-file", "/tmp/p.md", "--output-format", "plain"])
    assert.deepEqual(resolveProtocolArgs("grok", undefined), [])
    assert.deepEqual(resolveProtocolArgs("grok", ["agent", "stdio"]), ["agent", "stdio"])
  })

  it("injects kimi -p prompt and uses acp protocol args", () => {
    const args = resolveLaunchArgs("kimi", undefined, {
      prompt: "review me",
      promptFile: "/tmp/p.md",
    })
    assert.equal(args[0], "-p")
    assert.equal(args[1], "review me")
    assert.ok(args.includes("--output-format"))
    assert.ok(!args.includes("-y") && !args.includes("--auto"))
    assert.deepEqual(resolveProtocolArgs("kimi", undefined), ["acp"])
    assert.deepEqual(resolveProtocolArgs("kimi", []), ["acp"])
    assert.deepEqual(resolveProtocolArgs("kimi", ["--login"]), ["--login"])
  })

  it("appends opencode run prompt and uses acp protocol args", () => {
    const args = resolveLaunchArgs("opencode", undefined, {
      prompt: "fix the bug",
      promptFile: "/tmp/p.md",
    })
    assert.deepEqual(args, ["run", "fix the bug"])
    assert.deepEqual(resolveProtocolArgs("opencode", undefined), ["acp"])
  })
})
