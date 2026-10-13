#!/usr/bin/env node
/** Native Chrome DOM/CDP rehearsal. Extension API adapter is simulated; this
 * never claims real enterprise SSO or installed extension compatibility. */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
const root = path.resolve(import.meta.dirname, "..")
const require = createRequire(path.join(root, "companion/package.json"))
const { buildSync } = require("esbuild"), { WebSocket } = require("ws")
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-itcra-chrome-"))
const connections = []
let chromeProcess, server
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function connect(url) {
  const ws = new WebSocket(url); connections.push(ws)
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject) })
  let sequence = 0
  const pending = new Map()
  ws.on("message", raw => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { const { resolve, reject, timer } = pending.get(m.id); clearTimeout(timer); pending.delete(m.id); if (m.error || m.result?.exceptionDetails) reject(new Error("CDP command failed")); else resolve(m.result) } })
  return (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout")) }, 10_000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })) })
}
try {
  server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(req.url === "/login" ? '<main id="login">Synthetic QR placeholder</main>' : '<main id="ready">Business evidence</main><button id="next" data-action="next" onclick="window.effects=(window.effects||0)+1">Next</button><input id="query" type="search" name="query"><input id="password" type="password">')
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const binary = process.env.CMSPARK_TEST_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  chromeProcess = spawn(binary, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${path.join(temporary, "profile")}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" })
  const devtools = path.join(temporary, "profile/DevToolsActivePort")
  for (let i = 0; i < 200 && !fs.existsSync(devtools); i++) await sleep(100)
  if (!fs.existsSync(devtools)) throw new Error("isolated Chrome unavailable")
  const [port] = fs.readFileSync(devtools, "utf8").split("\n")
  const targets = new Map(), updates = []
  let nextTab = 1
  async function newTab(url) {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json()
    const send = await connect(target.webSocketDebuggerUrl)
    await send("Page.enable"); await send("Runtime.enable")
    const id = nextTab++; targets.set(id, { send })
    for (let i = 0; i < 100; i++) { const result = await send("Runtime.evaluate", { expression: `document.readyState === 'complete' && location.href === ${JSON.stringify(url)}`, returnByValue: true }); if (result.result.value === true) break; await sleep(50) }
    return { id }
  }
  async function frameList(id) {
    const { frameTree } = await targets.get(id).send("Page.getFrameTree")
    const frames = []
    const visit = (tree, index = 0) => { frames.push({ ...tree.frame, frameId: frames.length, documentId: tree.frame.id + ":" + tree.frame.loaderId }); for (const child of tree.childFrames || []) visit(child) }
    visit(frameTree); return frames
  }
  const profileId = "00000000-0000-4000-8000-000000000010"
  globalThis.chrome = {
    storage: { local: { get: async () => ({ enterprise_profile_id: profileId }), set: async () => {} } },
    tabs: {
      onUpdated: { addListener: fn => updates.push(fn) }, onRemoved: { addListener() {} }, create: ({ url }) => newTab(url),
      get: async id => ({ id, url: (await frameList(id))[0].url, title: "synthetic" }), query: async () => [],
      update: async (id, { url }) => { updates.forEach(fn => fn(id, { status: "loading", url })); await targets.get(id).send("Page.navigate", { url }); return { id } },
    },
    debugger: { onDetach: { addListener() {} }, attach: async () => {}, detach: async () => {}, sendCommand: ({ tabId }, method, params) => targets.get(tabId).send(method, params) },
    scripting: { executeScript: async request => {
      if (request.args?.some(arg => arg === undefined)) throw new TypeError("ScriptInjection arguments must be JSON serializable")
      const frames = await frameList(request.target.tabId)
      const selected = request.target.documentIds ? frames.filter(f => request.target.documentIds.includes(f.documentId)) : request.target.allFrames ? frames : frames.filter(f => f.frameId === 0)
      if (request.target.documentIds && selected.length !== request.target.documentIds.length) throw new Error("old document no longer exists")
      const send = targets.get(request.target.tabId).send
      return Promise.all(selected.map(async frame => {
        const { executionContextId } = await send("Page.createIsolatedWorld", { frameId: frame.id, worldName: "cmspark-enterprise-rehearsal" })
        const result = await send("Runtime.evaluate", { expression: `(${request.func.toString()})(...${JSON.stringify(request.args || [])})`, contextId: executionContextId, returnByValue: true, awaitPromise: true })
        if (result.exceptionDetails) throw new Error("isolated script failed")
        return { frameId: frame.frameId, documentId: frame.documentId, result: result.result.value }
      }))
    } },
  }
  const bundle = path.join(temporary, "bridge.cjs")
  buildSync({ entryPoints: [path.join(root, "chrome-extension/src/background/browser-bridge.ts")], outfile: bundle, bundle: true, format: "cjs", platform: "node", logLevel: "silent" })
  const bridge = new (require(bundle).BrowserBridge)()
  const policy = { navigation: [{ origin, path: "/app" }], evidence: [{ origin, path: "/app" }], login: [{ origin, path: "/login" }], ready: [{ selector: "#ready" }], login_markers: [{ selector: "#login" }] }
  const baseGuard = { version: 1, profile_id: profileId, policy, expires_at: new Date(Date.now() + 60_000).toISOString() }
  const execute = (tool, args, guard) => bridge.execute(tool, { ...args, __enterprise_guard: { ...baseGuard, ...guard } })
  const opened = await execute("create_tab", { url: origin + "/app" }, { mode: "open" })
  assert.equal(opened.success, true)
  const tabId = opened.data.tab_id
  const rule = { id: "next", tool: "click", effect: "read_only", selector: "#next", target: { tag: "button", attributes: { "data-action": "next" } } }
  const inspected = await execute("list_tabs", { tabId }, { mode: "inspect", rule })
  assert.equal(inspected.data.state, "ready")
  assert.equal((await execute("click", { tabId }, { mode: "act", rule, expected: inspected.data })).data.executed, true)
  const send = targets.get(tabId).send
  assert.equal((await send("Runtime.evaluate", { expression: "window.effects", returnByValue: true })).result.value, 1)
  await send("Runtime.evaluate", { expression: "const old=document.querySelector('#next');const replacement=old.cloneNode(true);replacement.onclick=()=>window.replacementEffects=(window.replacementEffects||0)+1;old.replaceWith(replacement)" })
  assert.equal((await execute("click", { tabId }, { mode: "act", rule, expected: inspected.data })).success, false)
  assert.equal((await send("Runtime.evaluate", { expression: "window.replacementEffects||0", returnByValue: true })).result.value, 0)
  policy.login.push({ origin, path: "/app" })
  const replacementSnapshot = await execute("list_tabs", { tabId }, { mode: "inspect", rule })
  let loginRace = true
  chrome.tabs.query = async () => {
    if (loginRace) { loginRace = false; await send("Runtime.evaluate", { expression: "(()=>{document.querySelector('#ready').remove();const marker=document.createElement('main');marker.id='login';marker.textContent='Synthetic login';document.body.append(marker)})()" }) }
    return []
  }
  assert.equal((await execute("click", { tabId }, { mode: "act", rule, expected: replacementSnapshot.data })).error, "READINESS_CHANGED")
  assert.equal((await send("Runtime.evaluate", { expression: "window.replacementEffects||0", returnByValue: true })).result.value, 0)
  await send("Runtime.evaluate", { expression: "document.querySelector('#login').remove();const ready=document.createElement('main');ready.id='ready';ready.textContent='Business evidence';document.body.append(ready)" })
  const expiredSnapshot = await execute("list_tabs", { tabId }, { mode: "inspect", rule })
  const scripting = chrome.scripting.executeScript
  chrome.scripting.executeScript = async request => { if (request.func.name === "actDocument") await sleep(250); return scripting(request) }
  assert.equal((await execute("click", { tabId }, { mode: "act", rule, expected: expiredSnapshot.data, expires_at: new Date(Date.now() + 100).toISOString() })).error, "ENTERPRISE_DEADLINE_EXPIRED")
  chrome.scripting.executeScript = scripting
  assert.equal((await send("Runtime.evaluate", { expression: "window.replacementEffects||0", returnByValue: true })).result.value, 0)
  const queryRule = { id: "query", tool: "type", effect: "read_only", selector: "#query", target: { tag: "input", attributes: { type: "search", name: "query" } } }
  const querySnapshot = await execute("list_tabs", { tabId }, { mode: "inspect", rule: queryRule })
  assert.equal((await execute("type", { tabId, text: "synthetic query" }, { mode: "act", rule: queryRule, expected: querySnapshot.data })).data.executed, true)
  assert.equal((await send("Runtime.evaluate", { expression: "document.querySelector('#query').value", returnByValue: true })).result.value, "synthetic query")
  const textSnapshot = await execute("list_tabs", { tabId }, { mode: "inspect" })
  const text = await execute("get_page_text", { tabId }, { mode: "text", expected: textSnapshot.data })
  assert.equal(text.success, true); assert.ok(text.data.text.includes("Business evidence")); assert.equal(text.data.provenance.workbook_complete, false)
  const image = await execute("screenshot", { tabId }, { mode: "business-screenshot", expected: textSnapshot.data })
  assert.equal(image.success, true); assert.ok(image.data.image_base64.length > 100); assert.equal(image.data.url, undefined)
  await send("Runtime.evaluate", { expression: "document.querySelector('#next').setAttribute('data-action','delete')" })
  assert.equal((await execute("click", { tabId }, { mode: "act", rule, expected: inspected.data })).success, false)
  assert.equal((await send("Runtime.evaluate", { expression: "window.effects", returnByValue: true })).result.value, 1)
  await send("Page.reload")
  await sleep(500)
  assert.equal((await execute("click", { tabId }, { mode: "act", rule, expected: inspected.data })).error, "NAVIGATION_CHANGED")
  const passwordRule = { id: "password", tool: "type", effect: "read_only", selector: "#password", target: { tag: "input", attributes: { type: "password" } } }
  assert.equal((await execute("list_tabs", { tabId }, { mode: "inspect", rule: passwordRule })).data.state, "credential_forbidden")
  const loginTab = await newTab(origin + "/login"), loginSnapshot = await execute("list_tabs", { tabId: loginTab.id }, { mode: "inspect" })
  assert.equal(loginSnapshot.data.state, "login_required")
  const loginImage = await execute("screenshot", { tabId: loginTab.id }, { mode: "login-screenshot", expected: loginSnapshot.data })
  assert.equal(loginImage.success, true); assert.equal(loginImage.data.url, undefined)
  assert.equal((await execute("get_page_text", { tabId: loginTab.id }, { mode: "text", expected: loginSnapshot.data })).error, "EVIDENCE_FORBIDDEN")
  policy.evidence = []
  const navigationSnapshot = await execute("list_tabs", { tabId }, { mode: "inspect" })
  assert.equal((await execute("navigate", { tabId, url: origin + "/app?target=next" }, { mode: "navigate", expected: navigationSnapshot.data })).success, true)
  // Real renderer navigation, declared API event adapter: do not inspect ready
  // B before its immediate SSO redirect, so history must come from the event.
  policy.login = [{ origin, path: "/login" }]
  await execute("list_tabs", { tabId }, { mode: "inspect" })
  await chrome.tabs.update(tabId, { url: origin + "/app/B" })
  for (let i = 0; i < 100; i++) {
    const current = await send("Runtime.evaluate", { expression: `document.readyState === 'complete' && location.pathname === '/app/B'`, returnByValue: true })
    if (current.result.value === true) break
    await sleep(50)
  }
  await chrome.tabs.update(tabId, { url: origin + "/login" })
  for (let i = 0; i < 100; i++) {
    const current = await send("Runtime.evaluate", { expression: `document.readyState === 'complete' && location.pathname === '/login'`, returnByValue: true })
    if (current.result.value === true) break
    await sleep(50)
  }
  const history = await execute("list_tabs", { tabId }, { mode: "inspect" })
  assert.equal(history.data.state, "login_required")
  assert.equal(history.data.last_business_url, origin + "/app/B")
  policy.login = [{ origin, path: "/app" }]
  const navigateAndWait = async pathname => {
    await chrome.tabs.update(tabId, { url: origin + pathname })
    for (let i = 0; i < 100; i++) {
      const current = await send("Runtime.evaluate", { expression: `document.readyState === 'complete' && location.pathname === ${JSON.stringify(pathname)}`, returnByValue: true })
      if (current.result.value === true) return
      await sleep(50)
    }
    throw new Error("synthetic document did not finish loading")
  }
  const showLogin = () => send("Runtime.evaluate", { expression: "(()=>{document.querySelector('#ready').remove();const marker=document.createElement('main');marker.id='login';marker.textContent='Synthetic login';document.body.append(marker)})()" })
  await navigateAndWait("/app/A")
  await execute("list_tabs", { tabId }, { mode: "inspect" }) // actual ready A
  await navigateAndWait("/app/B")
  await showLogin() // B never inspected ready
  const ambiguous = await execute("list_tabs", { tabId }, { mode: "inspect" })
  assert.equal(ambiguous.data.state, "login_required")
  assert.equal(ambiguous.data.business_target_unavailable, true)
  assert.equal(ambiguous.data.last_business_url, undefined)
  assert.equal((await execute("get_page_text", { tabId }, { mode: "text", expected: ambiguous.data })).error, "EVIDENCE_FORBIDDEN")
  await send("Runtime.evaluate", { expression: "(()=>{document.querySelector('#login').remove();const marker=document.createElement('main');marker.id='ready';marker.textContent='Business ready';document.body.append(marker)})()" })
  await execute("list_tabs", { tabId }, { mode: "inspect" }) // actual ready B now qualified
  await showLogin(); updates.forEach(fn => fn(tabId, { url: origin + "/app/B" }))
  const sameURL = await execute("list_tabs", { tabId }, { mode: "inspect" })
  assert.equal(sameURL.data.last_business_url, origin + "/app/B")
  assert.equal(sameURL.data.business_target_unavailable, undefined)
  // Explicit user-requested navigation is trusted intent even if an overlapping
  // login route appears before any authenticated-ready inspection.
  assert.equal((await execute("navigate", { tabId, url: origin + "/app/requested" }, { mode: "navigate", expected: sameURL.data })).success, true)
  await navigateAndWait("/app/login-route"); await showLogin()
  const intended = await execute("list_tabs", { tabId }, { mode: "inspect" })
  assert.equal(intended.data.last_business_url, origin + "/app/requested")
  assert.equal(intended.data.business_target_unavailable, undefined)
  process.stdout.write(JSON.stringify({ passed: true, evidence_kind: "isolated_native_chrome_with_api_adapter", checks: ["atomic_target_effect", "identical_replacement_denied", "late_login_denied", "extension_deadline_enforced", "navigation_without_export", "target_mutation_denied", "same_url_reload_denied", "credential_field_denied", "visible_text_coverage", "owned_tab_cdp_capture", "same_origin_login_separation", "pre_sso_business_navigation_retained", "normal_search_input_effect", "overlapping_target_ambiguity_denied", "verified_same_url_login_target_retained", "explicit_business_intent_retained"], real_enterprise_sso: false }) + "\n")
} finally {
  for (const ws of connections) ws.terminate()
  if (chromeProcess) {
    chromeProcess.kill("SIGTERM")
    await Promise.race([new Promise(resolve => chromeProcess.once("exit", resolve)), sleep(3000)])
    if (chromeProcess.exitCode === null) chromeProcess.kill("SIGKILL")
  }
  if (server) await new Promise(resolve => server.close(resolve))
  fs.rmSync(temporary, { recursive: true, force: true })
  delete globalThis.chrome
}
