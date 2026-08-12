/**
 * P1 deep-diagnosis batch regressions (2026-08-11 fanout).
 */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import {
  commandMatchesAllowlistEntry,
  assertShellCwdInWorkspace,
} from "../src/capability/shell"
import {
  validateWildcardPattern,
  isMultiTenantOrPublicSuffix,
} from "../src/security"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-p1-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  await initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("P1 SEC-05: multi-tenant eTLD wildcards rejected", () => {
  assert.equal(validateWildcardPattern("*.azurewebsites.net").ok, false)
  assert.equal(validateWildcardPattern("*.cloudfront.net").ok, false)
  assert.equal(validateWildcardPattern("*.firebaseapp.com").ok, false)
  assert.equal(validateWildcardPattern("*.github.io").ok, false)
  assert.equal(isMultiTenantOrPublicSuffix("azurewebsites.net"), true)
  assert.equal(validateWildcardPattern("*.example.com").ok, true)
  assert.equal(validateWildcardPattern("app.example.com").ok, true)
})

test("P1 SEC-07: bare interpreter rejects -c / -e", () => {
  assert.equal(commandMatchesAllowlistEntry("python3 -c 'print(1)'", "python3"), false)
  assert.equal(commandMatchesAllowlistEntry("node -e '1'", "node"), false)
  assert.equal(commandMatchesAllowlistEntry("python3 script.py", "python3"), true)
  assert.equal(commandMatchesAllowlistEntry("echo hello", "echo"), true)
  assert.equal(commandMatchesAllowlistEntry("echo", "echo"), true)
})

test("P1 SEC-08: cwd must stay inside workspace_root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-ws-"))
  const inside = path.join(root, "sub")
  fs.mkdirSync(inside)
  assert.equal(assertShellCwdInWorkspace(inside, root), null)
  assert.ok(assertShellCwdInWorkspace(os.tmpdir(), root))
  assert.equal(assertShellCwdInWorkspace("/any/path", null), null)
  fs.rmSync(root, { recursive: true, force: true })
})

test("P1 D8: pack whitelist constrains mcp__ tools", () => {
  const tm = new ThreadManager()
  const t = tm.create("p1-wl")
  // Force cruiseOpen=false so live three-flag user config does not expand surface.
  const noCruise = { cruiseOpen: false as const }
  tm.update(t.id, { tool_whitelist: ["list_tabs"] })
  assert.equal(tm.isToolAllowed(t.id, "list_tabs", noCruise), true)
  assert.equal(tm.isToolAllowed(t.id, "mcp__fs__read", noCruise), false)
  tm.update(t.id, { tool_whitelist: ["list_tabs", "mcp__*"] })
  assert.equal(tm.isToolAllowed(t.id, "mcp__fs__read", noCruise), true)
  tm.update(t.id, { tool_whitelist: ["mcp__fs__*"] })
  assert.equal(tm.isToolAllowed(t.id, "mcp__fs__read", noCruise), true)
  assert.equal(tm.isToolAllowed(t.id, "mcp__other__x", noCruise), false)
  // Legacy short id `fs` must match real default server `filesystem`
  assert.equal(
    tm.isToolAllowed(t.id, "mcp__filesystem__list_allowed_directories", noCruise),
    true,
  )
  tm.update(t.id, { tool_whitelist: ["mcp__filesystem__*"] })
  assert.equal(tm.isToolAllowed(t.id, "mcp__fs__read_file", noCruise), true)
  // With cruise, restricted whitelist expands for non-workers
  assert.equal(tm.isToolAllowed(t.id, "list_tabs", { cruiseOpen: true }), true)
})
