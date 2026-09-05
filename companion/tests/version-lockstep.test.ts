// Version lockstep: source-embedded version literals must match
// companion/package.json (the version SoT). These strings ship in the bundled
// cmspark-agent.js where package.json is unavailable at runtime, so they are
// hardcoded by necessity — this test is the guard against bump misses.

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
  assert.match(src("index.ts"), new RegExp(`cmspark-agent v${VERSION.replace(/\./g, "\\.")}`))
  assert.match(src(path.join("acp", "jsonrpc-stdio.ts")), new RegExp(`version: "${VERSION.replace(/\./g, "\\.")}"`))
  assert.match(src(path.join("outbound-mcp", "stdio-server.ts")), new RegExp(`version: "${VERSION.replace(/\./g, "\\.")}"`))
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
