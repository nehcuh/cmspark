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

test("version lockstep: live docs and changelog identify the source version", () => {
  const repo = path.join(ROOT, "..")
  const read = (rel: string) => fs.readFileSync(path.join(repo, rel), "utf8")
  const liveVersion = `源码开发版本 **${VERSION}（尚未正式发布）**`
  assert.ok(read("README.md").includes(liveVersion))
  assert.ok(read("CLAUDE.md").includes(liveVersion))
  assert.ok(read("docs/README.md").includes(liveVersion))
  assert.ok(read("docs/release-status.md").includes(liveVersion))
  assert.ok(read("CHANGELOG.md").split("\n").some(line => line.startsWith(`## [${VERSION}] — `)))
})
