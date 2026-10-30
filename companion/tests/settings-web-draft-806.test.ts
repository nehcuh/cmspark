import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { SETTINGS_HTML } from "../src/settings-web"

// Execute the shipped page script with inert DOM/fetch boundaries; no browser
// or user data. The server and actual config producer are exercised separately.
test("settings web keeps edits while saves and conflicts are in flight", async () => {
  const script = SETTINGS_HTML.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]
  assert.ok(script)
  const elements = new Map<string, any>()
  function element(id: string) {
    if (!elements.has(id)) elements.set(id, {
      value: "", checked: false, disabled: false, type: "text", textContent: "", className: "",
      style: {}, classList: { add() {}, remove() {} }, focus() {}, getAttribute() { return "preset" },
    })
    return elements.get(id)
  }
  const preset = element("synthetic-preset")
  const pending: Array<{ body: any; resolve: (value: any) => void }> = []
  const fetch = (_url: string, options?: { body?: string }) => new Promise(resolve => {
    pending.push({ body: options?.body ? JSON.parse(options.body) : null, resolve: value => resolve({ json: async () => value }) })
  })
  const document = { getElementById: element, querySelectorAll: () => [preset] }
  vm.runInNewContext(script, { document, fetch, location: { search: "?token=owned" }, URL, setTimeout() {}, window: { close() {} }, navigator: {} })
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

  assert.equal(element("modelName").disabled, true)
  preset.onclick()
  assert.equal(element("modelName").value, "")
  element("testBtn").onclick()
  element("testVisionBtn").onclick()
  assert.equal(pending.length, 1, "pre-hydration connection tests do not run")
  element("saveBtn").onclick()
  assert.equal(pending.length, 1, "unhydrated settings cannot save")
  pending[0].resolve({ config_revision: "epoch:1", llm: { model_name: "base" }, vision: {} })
  await flush()
  assert.equal(element("modelName").disabled, false)
  element("modelName").value = "draft-A"
  element("saveBtn").onclick()
  assert.equal(pending.length, 2)
  assert.equal(element("result").className, "result pending")
  assert.equal(pending[1].body.config_revision, "epoch:1")
  assert.equal(pending[1].body.llm.model_name, "draft-A")
  element("modelName").value = "draft-B"
  element("saveBtn").onclick()
  assert.equal(pending.length, 2, "a second save cannot overlap")
  pending[1].resolve({ ok: true, config_revision: "epoch:2" })
  await flush()
  assert.equal(element("modelName").value, "draft-B")
  assert.match(element("result").textContent, /当前修改尚未保存/)
  element("saveBtn").onclick()
  assert.equal(pending[2].body.config_revision, "epoch:2")
  assert.equal(pending[2].body.llm.model_name, "draft-B")
  pending[2].resolve({ ok: false, error: "CONFIG_REVISION_CONFLICT" })
  await flush()
  assert.equal(element("modelName").value, "draft-B")
  assert.match(element("result").textContent, /草稿已保留/)
  element("saveBtn").onclick()
  assert.equal(pending.length, 3, "conflict cannot silently reuse a stale revision")
})
