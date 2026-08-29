/**
 * Batch C host P1 (#247) — TDD DoD.
 * C1 osascript URL bind · C2 MCP loader env · C3 quoted -c · C4 Win scripts dual opt-in · C5 spawn HMAC
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import { commandMatchesAllowlistEntry } from "../src/capability/shell"
import { resolveWinScript } from "../src/host-use/win/powershell"
import { buildMcpStdioEnv } from "../src/mcp/transport"
import { isUnsafeLoaderEnvKey } from "../src/user-env"
import { SecurityPolicy } from "../src/security-policy"
import { computeWorkerWhitelist } from "../src/orchestrator/spawn"
import { canonicalizeOsascriptUrl } from "../src/tool/osascript-bind"
import { WORKER_HARD_DENY } from "../src/orchestrator/constants"
import catalog from "../src/bridge/tool-definitions-catalog.json"

test("C3: quoted -c / clustered interpreter flags denied; grep -ic still allowed", () => {
  assert.equal(commandMatchesAllowlistEntry("python3 '-c' 'code'", "python3"), false)
  assert.equal(commandMatchesAllowlistEntry("python3 -c", "python3"), false)
  assert.equal(commandMatchesAllowlistEntry("python3 -ic 'code'", "python3"), false)
  assert.equal(commandMatchesAllowlistEntry("python3 script.py", "python3"), true)
  assert.equal(commandMatchesAllowlistEntry("grep -ic pattern file", "grep"), true)
  assert.equal(commandMatchesAllowlistEntry("wc -c file", "wc"), true)
})

test("C4: WIN_SCRIPTS without ALLOW throws even when NODE_ENV is empty", () => {
  const prevScripts = process.env.CMSPARK_WIN_SCRIPTS
  const prevAllow = process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE
  const prevNode = process.env.NODE_ENV
  try {
    process.env.CMSPARK_WIN_SCRIPTS = "/tmp/cmspark-win-scripts"
    delete process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE
    delete process.env.NODE_ENV
    assert.throws(
      () => resolveWinScript("computer-uia-watch.ps1"),
      /CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE/,
    )
  } finally {
    if (prevScripts === undefined) delete process.env.CMSPARK_WIN_SCRIPTS
    else process.env.CMSPARK_WIN_SCRIPTS = prevScripts
    if (prevAllow === undefined) delete process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE
    else process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE = prevAllow
    if (prevNode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNode
  }
})

test("C4: dual opt-in joins even under NODE_ENV=production", () => {
  const prevScripts = process.env.CMSPARK_WIN_SCRIPTS
  const prevAllow = process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE
  const prevNode = process.env.NODE_ENV
  try {
    process.env.CMSPARK_WIN_SCRIPTS = "/tmp/cmspark-win-scripts"
    process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE = "1"
    process.env.NODE_ENV = "production"
    assert.equal(
      resolveWinScript("computer-uia-watch.ps1"),
      path.join("/tmp/cmspark-win-scripts", "computer-uia-watch.ps1"),
    )
  } finally {
    if (prevScripts === undefined) delete process.env.CMSPARK_WIN_SCRIPTS
    else process.env.CMSPARK_WIN_SCRIPTS = prevScripts
    if (prevAllow === undefined) delete process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE
    else process.env.CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE = prevAllow
    if (prevNode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNode
  }
})

test("C2: loader keys rejected by name; PATH and operator secrets stay", () => {
  assert.equal(isUnsafeLoaderEnvKey("NODE_OPTIONS"), true)
  assert.equal(isUnsafeLoaderEnvKey("node_options"), true)
  assert.equal(isUnsafeLoaderEnvKey("DYLD_INSERT_LIBRARIES"), true)
  assert.equal(isUnsafeLoaderEnvKey("PYTHONINSPECT"), true)
  assert.equal(isUnsafeLoaderEnvKey("BASH_ENV"), true)
  assert.equal(isUnsafeLoaderEnvKey("PATH"), false)
  assert.equal(isUnsafeLoaderEnvKey("HOME"), false)
  assert.equal(isUnsafeLoaderEnvKey("BRAVE_API_KEY"), false)
  assert.throws(
    () => buildMcpStdioEnv({ NODE_OPTIONS: "--require ./x" }),
    /NODE_OPTIONS/,
  )
  assert.throws(
    () => buildMcpStdioEnv({ DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib" }),
    /DYLD_INSERT_LIBRARIES/,
  )
  const env = buildMcpStdioEnv({ PATH: "/custom/bin", BRAVE_API_KEY: "k" })
  assert.equal(env.PATH, "/custom/bin")
  assert.equal(env.BRAVE_API_KEY, "k")
})

test("C1: canonicalize keep-query drop-hash; reject fragments", () => {
  assert.equal(
    canonicalizeOsascriptUrl("https://a.example/x?q=1#hash"),
    "https://a.example/x?q=1",
  )
  assert.equal(canonicalizeOsascriptUrl("https://a.example/x?u=https://good.tld"), "https://a.example/x?u=https://good.tld")
  assert.equal(canonicalizeOsascriptUrl("zhihu.com"), null)
  assert.equal(canonicalizeOsascriptUrl("example.com"), null)
})

test("C1: HMAC binds canonical URL; swap URL fails", () => {
  const policy = new SecurityPolicy()
  const a = {
    expression: "document.title",
    url: "https://good.example/page?q=1",
  }
  const payload = SecurityPolicy.bindingPayloadFor("osascript_eval", a)
  assert.match(payload, /document\.title/)
  assert.match(payload, /https:\/\/good\.example\/page\?q=1/)
  const { token } = policy.issueTokenFor("osascript_eval", a)
  assert.equal(
    policy.validateTokenFor(token, "osascript_eval", {
      expression: "document.title",
      url: "https://evil.example/",
    }),
    false,
  )
  assert.equal(policy.validateTokenFor(token, "osascript_eval", a), true)
})

test("C5: spawn HMAC sort+unique; extra tool fails; empty !== missing", () => {
  const policy = new SecurityPolicy()
  const base = { role_label: "reviewer", pack_id: "p1", alias: "w1" }
  const p1 = { ...base, tool_allow: ["evaluate", "list_tabs"] }
  const pReorder = { ...base, tool_allow: ["list_tabs", "evaluate"] }
  const pDup = { ...base, tool_allow: ["list_tabs", "evaluate", "list_tabs"] }
  const pExtra = { ...base, tool_allow: ["list_tabs", "evaluate", "click"] }
  const pMissing = { ...base }
  const pEmpty = { ...base, tool_allow: [] as string[] }
  assert.equal(
    SecurityPolicy.bindingPayloadFor("spawn_worker", p1),
    SecurityPolicy.bindingPayloadFor("spawn_worker", pReorder),
  )
  assert.equal(
    SecurityPolicy.bindingPayloadFor("spawn_worker", p1),
    SecurityPolicy.bindingPayloadFor("spawn_worker", pDup),
  )
  assert.notEqual(
    SecurityPolicy.bindingPayloadFor("spawn_worker", p1),
    SecurityPolicy.bindingPayloadFor("spawn_worker", pExtra),
  )
  assert.notEqual(
    SecurityPolicy.bindingPayloadFor("spawn_worker", pMissing),
    SecurityPolicy.bindingPayloadFor("spawn_worker", pEmpty),
  )
  const { token } = policy.issueTokenFor("spawn_worker", p1)
  assert.equal(policy.validateTokenFor(token, "spawn_worker", pExtra), false)
  assert.equal(policy.validateTokenFor(token, "spawn_worker", pReorder), true)
})

test("C1: catalog no longer teaches fragment contains", () => {
  const osa = (catalog as any[]).find((t) => t?.function?.name === "osascript_eval")
  assert.ok(osa)
  const desc = String(osa.function.description)
  const urlDesc = String(osa.function.parameters?.properties?.url?.description || "")
  assert.equal(osa.function.parameters.required.includes("expression"), true)
  assert.equal(osa.function.parameters.required.includes("url"), false)
  assert.ok(osa.function.parameters.properties.tabId)
  assert.doesNotMatch(desc, /contains/i)
  assert.doesNotMatch(urlDesc, /zhihu\.com matches/)
})

test("C5: empty roleAllow does not fall back to the default browser set", () => {
  const empty = computeWorkerWhitelist({ parentWhitelist: null, roleAllow: [] })
  assert.equal(empty.length, 0)
  const def = computeWorkerWhitelist({ parentWhitelist: null, roleAllow: null })
  assert.ok(def.includes("list_tabs"))
  const withShell = computeWorkerWhitelist({
    parentWhitelist: null,
    roleAllow: ["list_tabs", "shell_exec", "osascript_eval"],
  })
  assert.ok(withShell.includes("list_tabs"))
  assert.equal(withShell.includes("shell_exec"), false)
  for (const d of WORKER_HARD_DENY) {
    assert.equal(withShell.includes(d), false, d)
  }
})
