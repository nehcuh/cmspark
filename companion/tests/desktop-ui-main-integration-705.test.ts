/** Execute both shipped renderers with inert DOM/xterm; no native/browser execution. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"

const root = path.resolve(__dirname, "../..")
const source = (name: string) => fs.readFileSync(path.join(root, "src/desktop/assets", name), "utf8")
function renderer() {
  const posted: any[] = [], timers = new Map<number, () => void>(); let timer = 0
  function element(id: string): any { return { id, textContent: "", value: "", hidden: false, disabled: false, children: [], events: {}, dataset: {}, attributes: {}, setAttribute(k: string, v: string) { this.attributes[k] = v }, getAttribute(k: string) { return this.attributes[k] }, focus() {}, click() { if (!this.disabled) this.events.click?.() }, replaceChildren(...v: any[]) { this.children = v }, append(v: any) { this.children.push(v) }, addEventListener(k: string, f: any) { this.events[k] = f } } }
  const html = source("index.html"), ids: any = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], element(m[1])]))
  const nav = [...html.matchAll(/data-page="([^"]+)"/g)].map(m => { const e = element(m[1]); e.dataset.page = m[1]; return e })
  const document = { getElementById: (id: string) => ids[id], querySelectorAll: (s: string) => s === "nav button" ? nav : [], querySelector: () => ({ content: "a".repeat(64) }), createElement: element }
  const window: any = { webkit: { messageHandlers: { desktop: { postMessage: (f: any) => posted.push(JSON.parse(JSON.stringify(f))) } } }, Terminal: class {}, FitAddon: { FitAddon: class {} } }
  const context = vm.createContext({ window, document, TextEncoder, Uint8Array, setInterval: (f: () => void) => { timers.set(++timer, f); return timer }, clearInterval: (id: number) => timers.delete(id), btoa: (v: string) => Buffer.from(v, "binary").toString("base64"), atob: (v: string) => Buffer.from(v, "base64").toString("binary") })
  vm.runInContext(source("local-work.js"), context, { timeout: 1000 })
  vm.runInContext(source("app.js"), context, { timeout: 1000 })
  const receive = (f: any) => window.cmsparkDesktopReceive(f)
  receive({ type: "desktop.document", generation: "owned-doc" })
  const list = () => receive({ type: "thread.list", threads: [{ id: "A", title: "A" }, { id: "B", title: "B" }] })
  const button = (attr: string, id = "A") => ids.list.children.flatMap((r: any) => r.children).find((b: any) => b.attributes[attr] === id)
  return { html, ids, nav, posted, receive, list, button, timers, last: (type: string) => posted.filter(f => f.type === type).at(-1) }
}
const revision = "b".repeat(64)
test("local/workspace navigation retires archive intent and archive entry hides the local actor", () => {
  const f = renderer(); f.list()
  f.button("data-thread-archive").click(); const oldArchive = f.last("desktop.archive.state")
  f.button("data-thread-local").click(); assert.equal(f.ids["archive-editor"].hidden, true)
  assert.equal(f.ids["local-work"].hidden, false); assert.equal(f.last("desktop.local.state").thread_id, "A")
  f.receive({ type: "desktop.archive.state.result", id: oldArchive.id, thread_id: "A", ok: true, state: { archived: false, activity: "idle", revision, title: "Late A" } })
  assert.equal(f.ids["archive-save"].disabled, true); assert.equal(f.ids["archive-editor"].hidden, true)
  f.button("data-thread-archive", "B").click(); assert.equal(f.ids["local-work"].hidden, true)
  f.button("data-thread-workspace").click(); const workspace = f.last("desktop.workspace.state")
  assert.equal(f.ids["archive-editor"].hidden, true); assert.equal(f.ids["workspace-open"].hidden, false)
  f.receive({ type: "desktop.workspace.state.result", id: workspace.id, thread_id: "A", ok: true, state: { bound: false, display_name: "", module: "enabled", activity: "idle", revision } })
  f.ids["workspace-pick"].click(); const pick = f.last("desktop.workspace.pick")
  f.button("data-thread-archive", "B").click()
  assert.equal(f.ids["workspace-open"].hidden, true)
  assert.equal(f.last("desktop.workspace.cancel").operation_id, pick.id)
  f.receive({ type: "desktop.workspace.pick.result", id: pick.id, thread_id: "A", ok: true, outcome: "committed", state: { bound: false, display_name: "Late", module: "enabled", activity: "idle", revision } })
  assert.equal(f.ids["workspace-open"].hidden, true)
})

test("browser view remains reachable and main page transitions hide workspace/local without replay", () => {
  const f = renderer(); f.list(); f.button("data-thread-dialog").click()
  f.nav.find(n => n.dataset.page === "desktop.browser.status").click()
  assert.equal(f.ids["browser-editor"].hidden, false); assert(f.last("desktop.browser.status"))
  f.ids["browser-refresh"].click(); assert.equal(f.last("desktop.browser.tasks").thread_id, "A")
  f.nav.find(n => n.dataset.page === "thread.list").click(); f.list()
  f.button("data-thread-local").click(); const local = f.last("desktop.local.state")
  const count = f.posted.filter(v => v.type === "desktop.terminal.open" || v.type === "desktop.agent.start").length
  f.receive({ type: "desktop.offline" }); f.receive({ type: "desktop.document", generation: "new-doc" })
  f.receive({ type: "desktop.local.state.result", id: local.id, thread_id: "A", ok: true, state: { bound: true, revision, modules: { terminal: true, agent: true }, agents: [], operations: [] } })
  assert.equal(f.ids["local-work"].hidden, true); assert.equal(f.ids["workspace-open"].hidden, true)
  assert.equal(f.posted.filter(v => v.type === "desktop.terminal.open" || v.type === "desktop.agent.start").length, count)
  assert.equal(f.timers.size, 0)
})

test("merged document has unique controls and retains strict nonce-scoped offline terminal assets", () => {
  const f = renderer(), ids = [...f.html.matchAll(/id="([^"]+)"/g)].map(m => m[1])
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ["archive-editor", "browser-editor", "workspace-open", "local-work"]) assert(ids.includes(id))
  assert.match(f.html, /style-src-elem 'self' 'nonce-__CMSPARK_STYLE_NONCE_CSP__'/)
  assert.match(f.html, /name="cmspark-style-nonce" content="__CMSPARK_STYLE_NONCE_META__"/)
  assert(!f.html.includes("unsafe-inline")); assert(!f.html.includes("https://"))
  const scripts = [...f.html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(scripts, ["terminal-core.js", "terminal-fit.js", "local-work.js", "app.js"])
})
