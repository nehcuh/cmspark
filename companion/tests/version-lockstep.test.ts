// Version lockstep: companion/package.json is the version SoT.
// CLI usage/--version resolve at runtime (cli-version.ts); ACP/MCP serverInfo
// and CLI_VERSION_FALLBACK stay as literals — this test guards bump misses.

import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"

const ROOT = path.join(__dirname, "..", "..")
const VERSION: string = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
).version

function src(rel: string): string {
  return fs.readFileSync(path.join(ROOT, "src", rel), "utf8")
}

function sourceVersionLabel(version: string, heading: string): string {
  const v = version.replace(/\./g, "\\.")
  const match = heading.replace(/\r$/, "").match(new RegExp(`^## \\[${v}\\] — (\\d{4}-\\d{2}-\\d{2})（(正式发布|发布准备)）$`))
  assert.ok(match, "version heading must declare 发布准备 or 正式发布")
  return match[2] === "正式发布"
    ? `源码版本 **${version}（已于 ${match[1]} 正式发布）**`
    : `源码开发版本 **${version}（尚未正式发布）**`
}

test("version lockstep: development and released status stay distinct", () => {
  assert.equal(sourceVersionLabel("0.7.1", "## [0.7.1] — 2026-10-27（发布准备）"), "源码开发版本 **0.7.1（尚未正式发布）**")
  assert.equal(sourceVersionLabel("0.7.1", "## [0.7.1] — 2026-10-27（正式发布）"), "源码版本 **0.7.1（已于 2026-10-27 正式发布）**")
  assert.equal(sourceVersionLabel("0.7.1", "## [0.7.1] — 2026-10-27（正式发布）\r"), "源码版本 **0.7.1（已于 2026-10-27 正式发布）**")
  assert.throws(() => sourceVersionLabel("0.7.1", "## [0.7.1] — 2026-10-27（发布完成）"))
})

test("version lockstep: embedded literals match package.json", () => {
  assert.ok(VERSION, "package.json must carry a version")
  const v = VERSION.replace(/\./g, "\\.")
  // CLI banner is runtime-resolved; hardcoded `cmspark-agent vX.Y.Z` in
  // index.ts would fight --version honesty. Fallback + ACP/MCP stay literals.
  assert.match(src("index.ts"), /cmspark-agent v\$\{resolveCliVersion\(\)\}/)
  assert.match(src("cli-version.ts"), new RegExp(`CLI_VERSION_FALLBACK = "${v}"`))
  assert.match(src(path.join("acp", "jsonrpc-stdio.ts")), new RegExp(`version: "${v}"`))
  assert.match(src(path.join("outbound-mcp", "stdio-server.ts")), new RegExp(`version: "${v}"`))
})

test("version lockstep: chrome-extension package.json matches companion", () => {
  const ext = JSON.parse(
    fs.readFileSync(path.join(ROOT, "..", "chrome-extension", "package.json"), "utf8"),
  )
  assert.equal(ext.version, VERSION)
})

test("version lockstep: AGENTS.md header and footer match package.json", () => {
  const agents = fs.readFileSync(path.join(ROOT, "..", "AGENTS.md"), "utf8")
  const v = VERSION.replace(/\./g, "\\.")
  assert.match(agents, new RegExp(`> \\*\\*Version\\*\\*: ${v} `), "AGENTS.md header version line")
  assert.match(agents, new RegExp(`\\*CMspark Agent v${v}\\*`), "AGENTS.md footer")
})


test("version lockstep: both npm lock roots match their package version", () => {
  for (const dir of [ROOT, path.join(ROOT, "..", "chrome-extension")]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
    const lock = JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8"))
    assert.equal(lock.version, pkg.version, `${dir}: top-level lock version`)
    assert.equal(lock.packages[""].version, pkg.version, `${dir}: root package lock version`)
  }
})

test("version lockstep: Windows installer fallback matches companion", () => {
  const installer = fs.readFileSync(path.join(ROOT, "..", "scripts", "installer.nsi"), "utf8")
  const fallback = installer.match(/^\s*!define PRODUCT_VERSION "([^"]+)"/m)
  assert.equal(fallback?.[1], VERSION)
})

// This checks document consistency; release existence is verified by release gates.
test("version lockstep: live docs and changelog identify the source version", () => {
  const repo = path.join(ROOT, "..")
  const read = (rel: string) => fs.readFileSync(path.join(repo, rel), "utf8")
  const heading = read("CHANGELOG.md").split("\n").find(line => line.startsWith(`## [${VERSION}] — `))
  assert.ok(heading, "CHANGELOG.md must identify the source version")
  const status = sourceVersionLabel(VERSION, heading)
  const v = VERSION.replace(/\./g, "\\.")
  const opposite = heading.replace(/\r$/, "").endsWith("（正式发布）")
    ? new RegExp(`源码开发版本 \\*\\*${v}（尚未正式发布）\\*\\*`)
    : new RegExp(`源码版本 \\*\\*${v}（已于 \\d{4}-\\d{2}-\\d{2} 正式发布）\\*\\*`)
  for (const rel of ["README.md", "CLAUDE.md", "docs/README.md", "docs/release-status.md"]) {
    assert.ok(read(rel).includes(status), `${rel} must identify the same source version and release status`)
    assert.doesNotMatch(read(rel), opposite, `${rel} must not claim the opposite release status`)
  }
  assert.ok(read("PRODUCT.md").includes(`Version lock: companion/extension **${VERSION}**`))
  assert.ok(read("docs/GOAL.md").includes(`产品 ${VERSION}**`))
  assert.ok(read("docs/GOAL.md").includes(`[CHANGELOG](../CHANGELOG.md) **${VERSION}**`))
  assert.ok(read("README.md").includes(`当前阶段（${VERSION}）`))
  assert.ok(read("docs/architecture.md").includes(`当前源码版本 **${VERSION}**`))
})
