// Records actual BrowserBridge create/read/guarded-close wire results with a synthetic Chrome actuator.
import { createRequire } from "node:module"
import { writeFileSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import vm from "node:vm"
const require = createRequire(import.meta.url)
const { BrowserBridge } = require("../.test-dist/src/background/browser-bridge.js")
const context = { thread_id: "task-tabs-fixture", execution_id: "11111111-1111-4111-8111-111111111111" }
const tabs = new Map([[1, { id: 1, url: "https://example.test/user", title: "User existing tab", active: false }]])
const edited = new Set()
let nextId = 7
const event = { addListener() {}, removeListener() {} }
globalThis.chrome = {
  tabs: { onActivated: event, onRemoved: event, onUpdated: event,
    create: async options => {
      const tab = { id: nextId++, url: options.url, title: "Synthetic source", active: options.active, pinned: false, status: "complete" }
      tabs.set(tab.id, tab); return tab
    },
    get: async id => { if (!tabs.has(id)) throw Error("missing tab"); return { ...tabs.get(id) } },
    remove: async id => { if (id === 1 || !tabs.has(id)) throw Error("unexpected tab"); tabs.delete(id) },
  },
  storage: { local: { get: async () => ({}), set: async () => {} } },
  debugger: { onDetach: event, onEvent: event, attach: async () => {}, getTargets: async () => [...tabs.keys()].map(tabId => ({ tabId, attached: false })),
    sendCommand: async (target, method, params) => {
      if (method === "Page.enable" || method === "DOM.enable") return {}
      if (method === "Runtime.evaluate") return { result: { value: vm.runInNewContext(params.expression, {
        location: { href: tabs.get(target.tabId).url }, document: { body: { innerText: "Synthetic task evidence: product release 42." }, querySelector: () => null },
      }) } }
      throw Error("unexpected CDP method " + method)
    } },
  scripting: { executeScript: async ({ target }) => [{ frameId: 0, result: { edited: edited.has(target.tabId), child_frames: 0 } }] },
}
const bridge = new BrowserBridge()
const create = await bridge.execute("create_tab", { url: "https://user:secret@example.test/source?token=private", active: false, wait_for_load: false }, undefined, context)
const read = await bridge.execute("get_page_text", { tabId: 7 }, undefined, context)
const close = await bridge.execute("close_tab", { tabId: 7, __task_tab_cleanup: {
  token: create.data?.task_tab?.token, navigation_key: read.data?.provenance?.target?.navigation_key, automatic: true,
} }, undefined, context)
if (!create.success || !read.success || !close.success || tabs.has(7)) throw Error("production tab lifecycle failed " + JSON.stringify({ create, read, close }))
if (!process.argv.includes("--verify-lifecycle")) {
  writeFileSync(new URL("../../companion/tests/fixtures/task-tabs-848.json", import.meta.url), JSON.stringify({ context, create, read, close }, null, 2) + "\n")
  console.log("Recorded create/read/close results from production BrowserBridge; only the synthetic task tab was removed.")
} else {
  const { TaskBrowserTabs, readBrowserSources } = require("../../companion/.test-dist/src/business-evidence/task-pages.js")
  const { captureLocalPageResult } = require("../../companion/.test-dist/src/business-evidence/executor.js")
  const root = mkdtempSync(path.join(os.tmpdir(), "cmspark-tabs-production-")), scope = { kind: "chat", threadId: context.thread_id }
  let callId = 0
  const lifecycle = new TaskBrowserTabs({ dataDir: root, threadId: context.thread_id, executionId: context.execution_id,
    current: () => true, execute: async (id, name, args) => {
      if (name === "close_tab") {
        const saved = readBrowserSources(root, scope).data.sources.find(source => source.tab_id === args.tabId)
        assert.equal(saved.state, "closing"); assert.ok(saved.observation_ids.length)
      }
      return captureLocalPageResult(root, scope, id, name, await bridge.execute(name, args, undefined, context))
    } })
  const execute = (name, args) => lifecycle.execute("call-" + ++callId, name, args)
  const open = async (name, params = {}) => {
    const result = await execute("create_tab", { url: "https://example.test/" + name, active: false, wait_for_load: false, ...params })
    assert.equal(result.success, true); assert.equal(result.data.task_tab, undefined)
    await execute("get_page_text", { tabId: result.data.id }); return result.data.id
  }
  try {
    const early = await open("early"); assert.equal((await execute("close_tab", { tabId: early })).success, true)
    const keep = await open("keep", { keep_open: true }), background = await open("background")
    const foreground = await open("foreground", { active: true }), form = await open("form"); edited.add(form)
    const adopted = await open("adopted")
    await bridge.execute("get_page_text", { tabId: adopted }, undefined, { ...context, thread_id: "other-task" })
    const changed = await open("changed"); tabs.get(changed).url += "?different=route"
    const unread = await execute("create_tab", { url: "https://example.test/unread", active: false, wait_for_load: false })
    assert.deepEqual(await lifecycle.finish(true), { closed: 1, retained: 5 })
    assert.equal(tabs.has(early), false); assert.equal(tabs.has(background), false)
    for (const id of [1, keep, foreground, form, adopted, changed, unread.data.id]) assert.equal(tabs.has(id), true)
    const archived = readBrowserSources(root, scope).data.sources.filter(source => source.state === "closed")
    assert.equal(archived.length, 2)
    for (const source of archived) assert.ok(readBrowserSources(root, scope, source.observation_ids[0]).data.observation.content)
    console.log("PASS: production BrowserBridge + page capture + task ledger + guarded early/final close; 2 closed, 5 guarded task pages retained, keep-open and pre-existing user tabs untouched, closed-page evidence reloaded.")
  } finally { rmSync(root, { recursive: true, force: true }) }
}
