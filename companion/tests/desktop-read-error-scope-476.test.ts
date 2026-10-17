import test, { after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"

// Before any application import: this contract is CPU/DOM only on every OS.
const restorers: Array<() => void> = []
let blockedAttempts = 0
const block = () => { blockedAttempts++; throw new Error("DESKTOP_READ_ERROR_TEST_OS_NETWORK_FORBIDDEN") }
function guard(target: any, keys: string[]) {
  for (const key of keys) { const original = target[key]; target[key] = block; restorers.push(() => { target[key] = original }) }
}
guard(require("node:child_process"), ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"])
guard(require("node:net"), ["connect", "createConnection", "createServer"])
guard(require("node:http"), ["request", "get", "createServer"])
guard(require("node:https"), ["request", "get", "createServer"])
guard(process, ["kill", "dlopen"])
after(() => { try { assert.equal(blockedAttempts, 0) } finally { for (const restore of restorers.reverse()) restore() } })
const ts = require("typescript") as typeof import("typescript")
const { desktopRead } = require("../src/desktop/read") as typeof import("../src/desktop/read")
const root = path.resolve(__dirname, "../..")
const app = fs.readFileSync(path.join(root, "src/desktop/assets/app.js"), "utf8")
const channel = fs.readFileSync(path.join(root, "src/desktop/channel.ts"), "utf8")
const ast = ts.createSourceFile("channel.ts", channel, ts.ScriptTarget.Latest, true)
const bodies: string[] = []
function walk(node: import("typescript").Node) {
  if (ts.isTryStatement(node) && node.tryBlock.getText(ast).includes("const result = desktopRead(")) bodies.push(node.getText(ast))
  ts.forEachChild(node, walk)
}
walk(ast)
assert.equal(bodies.length, 1, "unique actual read/response producer, not a handmade error envelope")
const route = new Function("frame", "desktopRead", "opts", "principal", "ws", "send", ts.transpileModule(bodies[0], {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText)
function element(id: string): any {
  return { id, textContent: "", children: [], dataset: {}, events: {}, setAttribute() {},
    replaceChildren(...rows: any[]) { this.children = rows; this.textContent = "" },
    append(row: any) { this.children.push(row) }, addEventListener(kind: string, callback: () => void) { this.events[kind] = callback } }
}
function fixture() {
  const ids: Record<string, any> = Object.fromEntries(["title", "notice", "list", "preview", "status", "view"].map(id => [id, element(id)]))
  const nav = ["thread.list", "mcp.list", "skill.list", "knowledge.list"].map(page => { const e = element(page); e.dataset.page = page; return e })
  const posted: any[] = []
  const window: any = { webkit: { messageHandlers: { desktop: { postMessage: (frame: any) => posted.push(JSON.parse(JSON.stringify(frame))) } } } }
  const document = { getElementById: (id: string) => ids[id], querySelectorAll: () => nav, createElement: (tag: string) => element(tag) }
  vm.runInNewContext(app, { window, document }, { timeout: 1000 })
  const services = {
    threads: { desktopMetadataSnapshot: () => [{ id: "owned-thread", alias: "Public owned thread", updated_at: "2026-10-17" }] },
    skills: { list: () => [{ id: "owned-skill", name: "Public owned skill" }], listKnowledge: () => [] },
    mcp: { listServers: () => { throw new Error("owned inert MCP metadata failure") } },
  }
  function response(frame: any) {
    const result: any[] = []
    route(frame, desktopRead, { services, registry: { allows: () => true } }, {}, {}, (_ws: unknown, value: unknown) => result.push(value))
    assert.equal(result.length, 1)
    return result[0]
  }
  const receive = (frame: any) => window.cmsparkDesktopReceive(frame)
  receive({ type: "desktop.document", generation: "owned-document" })
  return { ids, nav, posted, receive, response }
}
const failed = "暂时无法读取，请重试。"

test("desktop readonly errors: MCP prefetch cannot mark a successful thread list failed", () => {
  const f = fixture()
  assert.deepEqual(f.posted.map(frame => frame.type), ["thread.list", "mcp.list", "skill.list", "knowledge.list"])
  f.receive(f.response(f.posted[0])); assert.equal(f.ids.list.children.length, 1)
  const actualError = f.response(f.posted[1]); assert.deepEqual(actualError, { type: "desktop.error", error_code: "DESKTOP_READ_FAILED", id: "mcp.list" })
  f.receive(actualError); f.receive(f.response(f.posted[2])); f.receive(f.response(f.posted[3]))
  assert.equal(f.ids.notice.textContent, ""); assert.equal(f.ids.list.children.length, 1)
})
test("desktop readonly errors: a late MCP response cannot poison the current successful skills page", () => {
  const f = fixture(); f.nav[1].events.click(); const previous = f.posted.at(-1)
  f.nav[2].events.click(); f.receive(f.response(f.posted.at(-1))); assert.equal(f.ids.list.children.length, 1)
  f.receive(f.response(previous)); assert.equal(f.ids.notice.textContent, ""); assert.equal(f.ids.list.children.length, 1)
})
test("desktop readonly errors: the current resource's actual metadata failure stays visible", () => {
  const f = fixture(); f.nav[1].events.click(); f.receive(f.response(f.posted.at(-1))); assert.equal(f.ids.notice.textContent, failed)
})
test("desktop readonly errors: every explicit noncurrent resource id is scoped without coercion", () => {
  for (let page = 0; page < 4; page++) for (let other = 0; other < 4; other++) if (page !== other) {
    const f = fixture(); f.nav[page].events.click(); const before = f.ids.notice.textContent
    f.receive({ type: "desktop.error", id: f.nav[other].dataset.page, error_code: "OWNED_UNKNOWN_CODE" })
    assert.equal(f.ids.notice.textContent, before)
  }
})
test("desktop readonly errors: unscoped, unknown and prototype-like ids retain generic feedback", () => {
  for (const id of [undefined, "unknown.resource", "toString", "constructor", "__proto__"]) {
    const f = fixture(); f.receive({ type: "desktop.error", ...(id === undefined ? {} : { id }), error_code: "OWNED_UNKNOWN_CODE" })
    assert.equal(f.ids.notice.textContent, failed)
  }
})
test("desktop readonly errors: a current resource unknown error code is never treated as success", () => {
  const f = fixture(); f.receive({ type: "desktop.error", id: "thread.list", error_code: "OWNED_UNKNOWN_CODE" }); assert.equal(f.ids.notice.textContent, failed)
})
test("desktop readonly errors: selected current thread preview failures remain visible", () => {
  const f = fixture(); f.receive(f.response(f.posted[0])); f.ids.list.children[0].children[0].events.click()
  assert.equal(f.posted.at(-1).type, "thread.peek"); assert.equal(f.posted.at(-1).thread_id, "owned-thread")
  f.receive({ type: "desktop.error", id: "thread.peek", error_code: "OWNED_UNKNOWN_CODE" }); assert.equal(f.ids.notice.textContent, failed)
})
test("desktop readonly errors: a preview error with no current selected thread is not a list failure", () => {
  const f = fixture(); f.receive(f.response(f.posted[0])); f.receive({ type: "desktop.error", id: "thread.peek", error_code: "OWNED_UNKNOWN_CODE" })
  assert.equal(f.ids.notice.textContent, "")
})
test("desktop readonly errors: a preview error on a resource page is not its resource failure", () => {
  const f = fixture(); f.nav[2].events.click(); f.receive(f.response(f.posted.at(-1)))
  f.receive({ type: "desktop.error", id: "thread.peek", error_code: "OWNED_UNKNOWN_CODE" }); assert.equal(f.ids.notice.textContent, "")
})
test("desktop readonly errors: offline and reconnect retain the existing read-only document lifecycle", () => {
  const f = fixture(); f.receive({ type: "desktop.offline" }); assert.equal(f.ids.status.textContent, "连接已断开")
  assert.equal(f.ids.notice.textContent, "等待原生宿主重新连接。"); const count = f.posted.length
  f.nav[2].events.click(); assert.equal(f.posted.length, count)
  f.receive({ type: "desktop.document", generation: "owned-next-document" }); assert.equal(f.ids.status.textContent, "已连接 · 只读")
  assert.equal(f.posted.at(-1).generation, "owned-next-document")
})
