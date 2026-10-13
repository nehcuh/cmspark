import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import { buildSync } from "esbuild"
import { createRequire } from "node:module"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { generateKeyPairSync } from "node:crypto"
import { registerEnterpriseInstance } from "../src/outbound-mcp/enterprise-policy"
import { issueOutboundGrant } from "../src/outbound-mcp/outbound-grants"
import { EnterpriseBrowserService } from "../src/outbound-mcp/enterprise-service"
import { checkEnterprisePermit, claimEnterpriseDispatch } from "../src/outbound-mcp/enterprise-permit"

test("real BrowserBridge producer crosses JSON: profile probe, target descriptor, atomic click, same-URL reload and frame scope", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cmspark-enterprise-bridge-"))
  const previous = { chrome: (globalThis as any).chrome, document: (globalThis as any).document, location: (globalThis as any).location, HTMLElement: (globalThis as any).HTMLElement }
  let effects = 0, documentId = "document-one", state = "ready", iframe = false
  let targetAction = "next"
  let target = { tagName: "BUTTON", textContent: "Next", disabled: false, getAttribute: (key: string) => key === "data-action" ? targetAction : null, getBoundingClientRect: () => ({ width: 40, height: 20 }), click: () => effects++ }
  let queryHook: (() => void) | undefined, navigations = 0, tabUpdated: (id: number, change: any) => void = () => {}, tabRemoved: (id: number) => void = () => {}
  const profileId = "00000000-0000-4000-8000-000000000001"
  const marker = { textContent: "", getBoundingClientRect: () => ({ width: 20, height: 20 }) }
  ;(globalThis as any).document = { body: { innerText: "Business visible text" }, querySelectorAll: (selector: string) => selector === "#ready" ? (state === "ready" ? [marker] : []) : selector === "#login" ? (state === "login_required" ? [marker] : []) : selector === "#next" ? [target] : [], querySelector: () => null }
  ;(globalThis as any).location = { href: "https://business.test/app" }
  ;(globalThis as any).HTMLElement = class {}
  ;(globalThis as any).chrome = {
    debugger: { onDetach: { addListener() {} } },
    storage: { local: { get: async () => ({ enterprise_profile_id: profileId }), set: async () => {} } },
    tabs: { onUpdated: { addListener(fn: any) { tabUpdated = fn } }, onRemoved: { addListener(fn: any) { tabRemoved = fn } }, query: async () => { queryHook?.(); queryHook = undefined; return [] }, create: async () => ({ id: 7 }), update: async () => { navigations++ } },
    scripting: { executeScript: async (request: any) => {
      if (request.target.documentIds && !request.target.documentIds.includes(documentId)) throw new Error("document no longer available")
      const result = request.func(...request.args)
      return [{ frameId: 0, documentId, result }, ...(iframe && request.target.allFrames ? [{ frameId: 1, documentId: "login-frame", result: { url: "https://sso.test/login?ticket=SECRET", state: "login_required" } }] : [])]
    } },
  }
  try {
    const output = join(directory, "bridge.cjs")
    buildSync({ entryPoints: [resolve(process.cwd(), "../chrome-extension/src/background/browser-bridge.ts")], outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" })
    const bridge = new (createRequire(__filename)(output).BrowserBridge)()
    const policy = { navigation: [{ origin: "https://business.test", path: "/app" }], evidence: [{ origin: "https://business.test", path: "/app" }], login: [{ origin: "https://sso.test", path: "/" }], ready: [{ selector: "#ready" }], login_markers: [{ selector: "#login" }] }
    const guard: any = { version: 1, profile_id: profileId, mode: "probe", policy, expires_at: new Date(Date.now() + 60_000).toISOString() }
    const run = async (tool: string, params: any = {}) => JSON.parse(JSON.stringify(await bridge.execute(tool, { tabId: 7, ...params, __enterprise_guard: guard })))
    assert.deepEqual(await run("list_tabs"), { success: true, data: { enterprise_contract: 1, profile_id: profileId } })
    guard.profile_id = "wrong"; assert.equal((await run("list_tabs")).error, "ENTERPRISE_PROFILE_MISMATCH"); guard.profile_id = profileId
    guard.mode = "inspect"; guard.rule = { id: "next", tool: "click", effect: "read_only", selector: "#next", target: { tag: "button", attributes: { "data-action": "next" } } }
    const inspected = await run("list_tabs")
    assert.equal(inspected.data.state, "ready"); assert.equal(inspected.data.document_id, documentId)
    assert.equal(inspected.data.target.attributes["data-action"], "next")
    guard.expected = inspected.data; guard.mode = "act"
    assert.equal((await run("click")).data.executed, true); assert.equal(effects, 1)
    queryHook = () => { target = { ...target } }
    assert.equal((await run("click")).error, "TARGET_MISMATCH"); assert.equal(effects, 1)
    guard.mode = "inspect"; guard.expected = (await run("list_tabs")).data; guard.mode = "act"
    queryHook = () => { state = "login_required" }
    assert.equal((await run("click")).error, "READINESS_CHANGED"); assert.equal(effects, 1)
    state = "ready"
    guard.expires_at = new Date(Date.now() - 1).toISOString()
    assert.equal((await run("click")).error, "ENTERPRISE_DEADLINE_EXPIRED"); assert.equal(effects, 1)
    guard.expires_at = new Date(Date.now() + 60_000).toISOString()
    guard.mode = "inspect"; guard.expected = (await run("list_tabs")).data; guard.mode = "act"
    documentId = "document-two" // same URL and attributes, fresh document
    assert.equal((await run("click")).error, "NAVIGATION_CHANGED"); assert.equal(effects, 1)
    documentId = "document-one"; targetAction = "delete"
    assert.equal((await run("click")).success, false); assert.equal(effects, 1)
    targetAction = "next"; guard.mode = "inspect"; delete guard.rule; delete guard.expected
    iframe = true
    assert.equal((await run("list_tabs")).data.state, "LOGIN_IFRAME_UNSUPPORTED")
    iframe = false; guard.expected = (await run("list_tabs")).data; guard.mode = "text"
    const text = await run("get_page_text")
    assert.equal(text.data.text, "Business visible text")
    assert.equal(text.data.provenance.workbook_complete, false)
    assert.equal(text.data.provenance.coverage, "incomplete")
    const fixturePath = resolve(process.cwd(), "tests/fixtures/enterprise-browser/visible-text.json")
    if (process.env.CMSPARK_RECORD_ENTERPRISE_FIXTURES === "1") {
      mkdirSync(resolve(fixturePath, ".."), { recursive: true })
      writeFileSync(fixturePath, JSON.stringify({ evidence_kind: "simulated", producer: "BrowserBridge.execute -> JSON; controlled DOM/API adapter", payload: text }, null, 2) + "\n")
    }
    assert.deepEqual(JSON.parse(readFileSync(fixturePath, "utf8")).payload, text)
    guard.policy.evidence = []; guard.mode = "navigate"
    assert.equal((await run("navigate", { url: "https://business.test/app/other" })).data.executed, true)
    assert.equal(navigations, 1)
    guard.mode = "text"; assert.equal((await run("get_page_text")).error, "EVIDENCE_FORBIDDEN")
    guard.mode = "open"
    assert.equal((await run("create_tab", { url: "https://business.test/application" })).error, "NAVIGATION_FORBIDDEN")
    guard.mode = "inspect"; delete guard.expected
    tabUpdated(7, { url: "https://business.test/app/B", status: "loading" })
    ;(globalThis as any).location.href = "https://sso.test/login?ticket=PRIVATE"
    state = "login_required"; tabUpdated(7, { url: (globalThis as any).location.href })
    const login = await run("list_tabs")
    assert.equal(login.data.state, "login_required"); assert.equal(login.data.last_business_url, "https://business.test/app/B")
    tabUpdated(7, { url: "https://evil.test/app/C" })
    assert.equal((await run("list_tabs")).data.last_business_url, "https://business.test/app/B")
    tabRemoved(7)
    assert.equal((await run("list_tabs")).data.last_business_url, undefined)
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete (globalThis as any)[key]; else (globalThis as any)[key] = value }
    rmSync(directory, { recursive: true, force: true })
  }
})
test("ordinary BrowserBridge startup bootstraps profile UUID before grant registration and cold module restart retains it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cmspark-enterprise-bootstrap-")), previous = (globalThis as any).chrome
  const stored: Record<string, unknown> = {}
  let writes = 0, initialized!: () => void
  const ready = new Promise<void>(resolve => { initialized = resolve })
  ;(globalThis as any).chrome = { debugger: { onDetach: { addListener() {} } }, tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } }, storage: { local: { get: async () => stored, set: async (value: unknown) => { Object.assign(stored, value); writes++; initialized() } } } }
  try {
    const output = join(directory, "bridge.cjs"), load = createRequire(__filename)
    buildSync({ entryPoints: [resolve(process.cwd(), "../chrome-extension/src/background/browser-bridge.ts")], outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" })
    const bridge = new (load(output).BrowserBridge)()
    await ready
    const profile_id = stored.enterprise_profile_id
    assert.match(String(profile_id), /^[0-9a-f-]{36}$/)
    const guard = { version: 1, profile_id, mode: "probe", expires_at: new Date(Date.now() + 60_000).toISOString() }
    assert.equal((await bridge.execute("list_tabs", { __enterprise_guard: guard })).success, true)
    delete load.cache[output]
    const restarted = new (load(output).BrowserBridge)()
    assert.equal((await restarted.execute("list_tabs", { __enterprise_guard: guard })).success, true)
    assert.equal(writes, 1)
  } finally { if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous; rmSync(directory, { recursive: true, force: true }) }
})
test("actual producer→JSON→service rejects ambiguous same-path B instead of A evidence; verified same-URL B login resumes once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cmspark-enterprise-overlap-"))
  const previous = { chrome: (globalThis as any).chrome, document: (globalThis as any).document, location: (globalThis as any).location }
  const instance = registerEnterpriseInstance("00000000-0000-4000-8000-000000000030", "user-a")
  const marker = { textContent: "", getBoundingClientRect: () => ({ width: 20, height: 20 }) }
  let state = "ready", url = "https://business.test/app/A", documentId = "document-A", clicks = 0, navigations = 0
  let updated: (id: number, change: any) => void = () => {}
  const target = { tagName: "BUTTON", disabled: false, getAttribute: (key: string) => key === "data-action" ? "next" : null, getBoundingClientRect: () => ({ width: 30, height: 20 }), click: () => {
    clicks++; url = "https://business.test/app/B"; documentId = "document-B"; state = "login_required"; updated(99, { url, status: "loading" })
  } }
  const matches = (selector: string) => selector === "#ready" ? state === "ready" ? [marker] : [] : selector === "#login" ? state === "login_required" ? [marker] : [] : selector === "#next" ? [target] : []
  ;(globalThis as any).location = { get href() { return url } }
  ;(globalThis as any).document = { body: { get innerText() { return state === "ready" ? url : "PRIVATE_LOGIN" } }, querySelectorAll: matches, querySelector: (selector: string) => matches(selector)[0] || null }
  ;(globalThis as any).chrome = {
    storage: { local: { get: async () => ({ enterprise_profile_id: instance.profile_id }) } },
    tabs: { onUpdated: { addListener(fn: any) { updated = fn } }, onRemoved: { addListener() {} }, query: async () => [], create: async () => ({ id: 99 }), update: async (_id: number, args: any) => {
      navigations++; url = args.url; state = "ready"; documentId = "restored-B"; updated(99, { url, status: "loading" })
    } },
    scripting: { executeScript: async (request: any) => [{ frameId: 0, documentId, result: request.func(...request.args) }] },
  }
  let api: EnterpriseBrowserService | undefined
  try {
    const bundle = join(directory, "actuator.cjs")
    buildSync({ entryPoints: [resolve(process.cwd(), "../chrome-extension/src/background/enterprise-browser.ts")], outfile: bundle, bundle: true, platform: "node", format: "cjs", logLevel: "silent" })
    const actuator = createRequire(__filename)(bundle).executeEnterpriseBrowser
    const peer = { peer: {}, epoch: "overlap-test" }
    const scope = [{ origin: "https://business.test", path: "/app" }]
    const grant = issueOutboundGrant({ caller_id: "itcra", label: "overlap", profile: "outbound_l1_interact", enterprise_policy: { ...instance, revision: "r1", expires_at: new Date(Date.now() + 60_000).toISOString(),
      authority_public_key: generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString(), tools: ["create_tab", "navigate", "click", "get_page_text"], navigation: scope, evidence: scope, login: scope,
      ready: [{ selector: "#ready" }], login_markers: [{ selector: "#login" }], actions: [{ id: "next", tool: "click", effect: "read_only", selector: "#next", target: { tag: "button", attributes: { "data-action": "next" } } }] } })
    api = new EnterpriseBrowserService({ path: join(directory, "state.json"), monitor: false, peer: () => peer, runner: () => async (_id, tool, args, options) => {
      assert.equal(checkEnterprisePermit(options!.enterprisePermit, tool, args, peer.peer), true)
      claimEnterpriseDispatch(options!.enterprisePermit!, tool, args, peer.peer)
      return JSON.parse(JSON.stringify(await actuator(tool, { ...args, __enterprise_guard: options!.enterprisePermit!.guard }, async () => ({ success: false }))))
    } })
    const session = await api.open(grant.id, { subject: "user-a", change_id: "change-overlap", request_key: "open", url }) as any
    const prepare = (key: string, tool: string, args: object = {}) => api!.prepare(grant.id, { subject: "user-a", session_handle: session.session_handle, request_key: key, tool, args }) as Promise<any>
    const click = await prepare("click", "click", { rule_id: "next" })
    api.execute(grant.id, { subject: "user-a", operation_handle: click.operation_handle }); await api.drain()
    assert.equal(clicks, 1); assert.equal(state, "login_required")
    const metadata = await api.status(grant.id, "user-a", session.session_handle) as any
    assert.equal(metadata.state, "login_required")
    await assert.rejects(prepare("ambiguous-read", "get_page_text"), /RETURN_TARGET_NOT_RETAINED/)
    assert.equal(navigations, 0); assert.ok(!readFileSync(join(directory, "state.json"), "utf8").includes("https://"))
    // Site qualification has now observed a ready B. Same-URL modal login is
    // supported even with overlapping scopes, without substituting a callback.
    state = "ready"; await api.status(grant.id, "user-a", session.session_handle)
    state = "login_required"; updated(99, { url })
    const read = await prepare("verified-B", "get_page_text")
    api.execute(grant.id, { subject: "user-a", operation_handle: read.operation_handle }); await api.drain()
    state = "ready"; url = "https://business.test/app/home"; documentId = "callback"; updated(99, { url })
    await api.tick(); await api.tick()
    const result = api.operationStatus(grant.id, "user-a", read.operation_handle) as any
    assert.equal(result.state, "completed"); assert.equal(result.data.text, "https://business.test/app/B")
    assert.equal(clicks, 1); assert.equal(navigations, 1)
  } finally {
    api?.close()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete (globalThis as any)[key]; else (globalThis as any)[key] = value }
    rmSync(directory, { recursive: true, force: true })
  }
})
