// #689 actual React markup and owner-only forward contract; no browser or native.
import test from "node:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as ts from "typescript"
import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AppsPanel } from "../src/sidepanel/components/AppsPanel"
import * as storeModule from "../src/sidepanel/store/agentStore"
import { projectMetadataSenderAllowed } from "../src/background/project-metadata"
const store = storeModule as any
const A = "a".repeat(64), B = "b".repeat(64)
const entry: any = { token: "win.app.owned689", kind: "gui", display_name: "<owned editor>", policy: "manual", enabled: true,
  source: "user", added_at: "2026-10-17", exe: { path: "C:\\Owned\\editor.exe", sha256: A, signer: "Owned", user_writable_dir: false },
  binary_drift: { schema_version: 1, status: "suspended", approved_sha256: A, observed_sha256: B, restore_policy: "auto", subject_digest: "c".repeat(64) } }
function html(e = entry, connected = true) {
  const original = store.useAgentStore
  store.useAgentStore = () => ({ state: { ...store.initialState, appsPlatform: "win32", appsEnabled: true, computerCoordinateEnabled: false,
    connectionState: connected ? "connected" : "disconnected", appPresets: [], appEntries: [e] }, dispatch: () => { throw Error("SSR must not write") } })
  try { return renderToStaticMarkup(React.createElement(AppsPanel)) } finally { store.useAgentStore = original }
}
test("689 actual AppsPanel shows escaped hashes, last-known observation, saved intent and fixed-profile warning", () => {
  const body = html(); assert.ok(body.includes("&lt;owned editor&gt;")); assert.ok(body.includes(A)); assert.ok(body.includes(B))
  assert.ok(body.includes("上次检查值（批准前会重新检查）")); assert.ok(body.includes("保存的恢复策略")); assert.ok(body.includes("不会扩大文件模板支持"))
  assert.ok(body.includes("检查文件")); assert.ok(body.includes("重新批准指纹（需验证）")); assert.ok(!body.includes("持续监测正常"))
})
test("689 disconnected, disabled and invalidated views keep explicit owner controls unavailable", () => {
  for (const body of [html(entry, false), html({ ...entry, enabled: false }), html({ ...entry, binary_drift: { ...entry.binary_drift, status: "invalidated" } })]) {
    assert.match(body, /<button[^>]*disabled=""[^>]*>重新批准指纹（需验证）<\/button>/)
  }
  assert.ok(html({ ...entry, binary_drift: { ...entry.binary_drift, status: "invalidated" } }).includes("原恢复意图已失效"))
})
test("689 unpinned/AUMID views cannot start first pin adoption", () => {
  for (const e of [{ ...entry, binary_drift: undefined, exe: { ...entry.exe, sha256: undefined } }, { ...entry, aumid: "Owned!App" }])
    assert.ok(!html(e).includes("重新批准指纹（需验证）"))
})
test("689 reused fixed owner-sender guard rejects content, websites, subframes and foreign extension", () => {
  const id = "owned689"
  assert.equal(projectMetadataSenderAllowed({ id, url: `chrome-extension://${id}/sidepanel.html`, frameId: 0 }, id), true)
  for (const sender of [{ id, url: "https://example.invalid" }, { id, url: `chrome-extension://${id}/sidepanel.html`, frameId: 1 },
    { id: "foreign", url: `chrome-extension://${id}/sidepanel.html` }, { id, url: `chrome-extension://${id}/other.html` }])
    assert.equal(projectMetadataSenderAllowed(sender, id), false)
})

test("689 malformed old-server drift values cannot crash or enable the card", () => {
  const body = html({ ...entry, enabled: false, binary_drift: { ...entry.binary_drift, observed_sha256: { not: "text" } } })
  assert.ok(body.includes("应用漂移记录无效")); assert.ok(!body.includes("重新批准指纹（需验证）"))
})

function actualForwarder() {
  const file = path.join(process.cwd(), "src/background/index.ts"), source = fs.readFileSync(file, "utf8")
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const fn = tree.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "handleRuntimeMessage")
  if (!fn) throw Error("actual runtime function missing")
  const js = ts.transpileModule(fn.getText(tree) + "\nreturn handleRuntimeMessage", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  let guardCalls = 0, connected = true; const frames: any[] = []
  const forward = new Function("wsClient", "chrome", "projectMetadataSenderAllowed", js)(
    { getState: () => connected ? "connected" : "disconnected", send: (m: any) => { frames.push(m); return true } },
    { runtime: { id: "owned689" } }, (...args: Parameters<typeof projectMetadataSenderAllowed>) => { guardCalls++; return projectMetadataSenderAllowed(...args) })
  return { frames, calls: () => guardCalls, disconnect: () => { connected = false }, send: (message: any, sender?: any) => {
    let response: any; forward(message, (r: any) => { response = r }, sender); return response
  } }
}
test("689 actual background case group preserves every preceding legacy bulk route", () => {
  const f = actualForwarder()
  for (const type of ["thread.list", "knowledge.folder_create", "knowledge.move", "pack.list", "mcp.list", "user_env.list", "apps.list"])
    assert.equal(f.send({ type, id: type }).ok, true)
  assert.equal(f.calls(), 0); assert.equal(f.frames.length, 7)
})
test("689 actual background new family alone is owner and connected gated without replay", () => {
  const f = actualForwarder(), sender = { id: "owned689", url: "chrome-extension://owned689/sidepanel.html", frameId: 0 }
  for (const type of ["apps.drift_status", "apps.check_drift", "apps.reapprove"]) {
    assert.equal(f.send({ type }, { id: "owned689", url: "https://example.invalid" }).ok, false)
    assert.equal(f.send({ type }, sender).ok, true)
  }
  assert.equal(f.frames.length, 3); f.disconnect(); assert.equal(f.send({ type: "apps.check_drift" }, sender).ok, false); assert.equal(f.frames.length, 3)
})
