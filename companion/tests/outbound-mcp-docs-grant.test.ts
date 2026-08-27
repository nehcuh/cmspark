/**
 * Docs contract for 5 分钟租手 (PR-A Task 4).
 * Source-regex only — no Companion runtime.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

function resolveRepoFile(...rel: string[]): string {
  const fromCompiled = path.resolve(__dirname, "..", "..", "..", ...rel)
  if (fs.existsSync(fromCompiled)) return fromCompiled
  const fromCwd = path.resolve(process.cwd(), "..", ...rel)
  if (fs.existsSync(fromCwd)) return fromCwd
  const fromRepoCwd = path.resolve(process.cwd(), ...rel)
  if (fs.existsSync(fromRepoCwd)) return fromRepoCwd
  throw new Error(`missing ${rel.join("/")} (tried ${fromCompiled})`)
}

function extractFences(md: string): { lang: string; body: string }[] {
  const out: { lang: string; body: string }[] = []
  const re = /```([a-zA-Z0-9_-]*)[^\n]*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    out.push({ lang: m[1] || "", body: m[2] })
  }
  return out
}

test("docs/mcp.md outbound snippets all include CMSPARK_OUTBOUND_GRANT", () => {
  const mdPath = resolveRepoFile("docs", "mcp.md")
  const md = fs.readFileSync(mdPath, "utf8")

  assert.match(md, /<a id="outbound-mcp"><\/a>/)
  const heading = md.indexOf("## 5 分钟租手")
  assert.ok(heading >= 0, "docs/mcp.md must have H2 ## 5 分钟租手")
  const outbound = md.slice(heading)

  assert.match(outbound, /5 分钟租手/)
  assert.match(outbound, /ERR_EMPTY_RESPONSE/)
  assert.doesNotMatch(outbound, /尚未跑/)
  assert.match(
    outbound,
    /LOCALAPPDATA|Local\\\\CMspark|Local\\CMspark|CMspark\\node\.exe/,
  )
  assert.match(outbound, /打开 Chrome 确认台/)

  // Verbatim experiment disclaimer (SoT §8.1)
  assert.match(
    outbound,
    /CMspark \*\*租手（Outbound MCP）目前是实验能力\*\*/,
  )
  assert.match(outbound, /非产品 ship/)
  assert.match(outbound, /不\*\*证明这个任务只能用我们/)

  // Two-door + CLI main path
  assert.match(outbound, /编程接力/)
  assert.match(outbound, /coding-handoff-user-guide\.md/)
  assert.match(
    outbound,
    /cmspark-agent outbound-grant issue --caller-id codex --label Codex/,
  )
  assert.match(outbound, /daemon start/)

  assert.doesNotMatch(outbound, /无缝对接/)
  assert.doesNotMatch(outbound, /CMspark for Codex/)
  assert.doesNotMatch(outbound, /Handoff/)
  assert.doesNotMatch(outbound, /Bearer\s+\$SECRET/)

  const fences = extractFences(outbound)
  const grantFences = fences.filter(
    (f) =>
      f.body.includes("mcp-outbound") || f.body.includes("mcp_servers.cmspark"),
  )
  assert.ok(
    grantFences.length >= 1,
    "expected at least one mcp-outbound / mcp_servers.cmspark fence in outbound section",
  )
  for (const f of grantFences) {
    assert.match(
      f.body,
      /CMSPARK_OUTBOUND_GRANT/,
      `fenced ${f.lang || "(plain)"} block mentioning mcp-outbound or mcp_servers.cmspark must contain CMSPARK_OUTBOUND_GRANT:\n${f.body.slice(0, 400)}`,
    )
  }
})

test("OutboundMcpSettingsSection checkbox and one-shot grant copy", () => {
  const src = fs.readFileSync(
    resolveRepoFile(
      "chrome-extension",
      "src",
      "sidepanel",
      "components",
      "OutboundMcpSettingsSection.tsx",
    ),
    "utf8",
  )
  assert.match(src, /允许 .*把页文\/截图发给其云模型/)
  assert.match(src, /推荐命令行签发（五分钟主路）。这里是备用与撤销。/)
  assert.match(src, /这把钥匙只出现一次。它不是扩展配对码。/)
  assert.match(src, /allow_page_export/)
  assert.match(src, /CMSPARK_OUTBOUND_GRANT/)
  assert.match(src, /CMSPARK_OUTBOUND_PORT/)
  assert.match(src, /outbound-grant/)
})
