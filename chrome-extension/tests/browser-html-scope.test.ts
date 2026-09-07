import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { BrowserBridge } from "../src/background/browser-bridge"

for (const tool of ["get_page_text", "get_page_html"]) {
  test(`${tool} detects actual query navigation during its production read`, async () => {
    const previous = (globalThis as any).chrome
    let url = "https://user:secret@example.test/page?version=1#details"
    ;(globalThis as any).chrome = {
      tabs: { get: async () => ({ url }) },
      debugger: {
        onDetach: { addListener() {} }, attach: async () => {},
        async sendCommand(_target: unknown, method: string, params: any) {
          if (method === "Page.enable" || method === "DOM.enable") return {}
          if (method === "Runtime.evaluate") {
            url = "https://user:secret@example.test/page?version=2#details"
            return { result: { value: vm.runInNewContext(params.expression, { location: { href: url }, document: {
              body: { innerText: "version 1" }, querySelector: () => ({ outerHTML: "<body>version 1</body>" }),
            } }) } }
          }
          throw new Error(`unexpected method ${method}`)
        },
      },
    }
    try {
      const result = await new BrowserBridge().execute(tool, { tabId: 7 })
      assert.equal(result.success, true)
      assert.equal(result.data.provenance.capture_status, "TARGET_CHANGED")
      assert.equal(result.data.provenance.target, undefined)
      assert.equal(result.data.provenance.title, "")
      assert.ok(String(result.data.text || result.data.html).includes("version 1"))
      assert.equal(result.data.observation_id, undefined)
      assert.ok(!JSON.stringify(result).includes("version="))
      assert.ok(!JSON.stringify(result).includes("secret"))
    } finally {
      if (previous === undefined) delete (globalThis as any).chrome
      else (globalThis as any).chrome = previous
    }
  })
}

// Exercise the production bridge and serialized injection functions. Browser
// APIs/DOM are fakes; no copy of the selector implementation lives in this test.
for (const mode of ["runtime", "isolated", "main", "dom"] as const) {
  for (const selector of [undefined, "#wanted", "#missing", '[data-name="a\\\"b"]']) {
    test(`HTML scope survives ${mode}: ${selector ?? "whole page"}`, async () => {
      const whole = "<html><body>private outside<section>wanted</section></body></html>"
      const part = "<section>wanted</section>"
      const wantedSelector = selector || "html"
      const fakeDocument = {
        querySelector(value: string) {
          assert.equal(value, wantedSelector)
          return value === "#missing" ? null : { outerHTML: value === "html" ? whole : part }
        },
      }
      const previous = (globalThis as any).chrome
      const worlds: string[] = []
      ;(globalThis as any).chrome = {
        tabs: { get: async () => ({ url: "https://example.test/page" }) },
        debugger: {
          onDetach: { addListener() {} }, attach: async () => {},
          async sendCommand(_target: unknown, method: string, params: any) {
            if (method === "Page.enable" || method === "DOM.enable") return {}
            if (method === "Runtime.evaluate") {
              if (mode !== "runtime") throw new Error("runtime unavailable")
              return { result: { value: vm.runInNewContext(params.expression, { document: fakeDocument, location: { href: "https://example.test/page" } }) } }
            }
            if (method === "DOM.getDocument") return { root: { nodeId: 1, documentURL: "https://example.test/page" } }
            if (method === "DOM.querySelector") {
              assert.equal(params.selector, wantedSelector)
              return { nodeId: selector === "#missing" ? 0 : 2 }
            }
            if (method === "DOM.getOuterHTML") {
              assert.equal(params.nodeId, 2)
              return { outerHTML: selector ? part : whole }
            }
            throw new Error(`unexpected CDP call ${method}`)
          },
        },
        scripting: {
          async executeScript(options: any) {
            worlds.push(options.world || "ISOLATED")
            if (mode === "dom" || (mode === "main" && !options.world)) throw new Error("injection blocked")
            const value = vm.runInNewContext(`(${options.func.toString()})(...args)`, {
              document: fakeDocument, location: { href: "https://example.test/page" }, args: options.args || [],
            })
            return [{ result: value }]
          },
        },
      }
      try {
        const bridge = new BrowserBridge()
        const result = await bridge.execute("get_page_html", { tabId: 7, ...(selector ? { selector } : {}) })
        assert.equal(result.success, true, result.error)
        assert.equal(result.data.html, selector === "#missing" ? "" : selector ? part : whole)
        assert.equal(result.data.source, mode === "dom" ? "dom" : "runtime")
        assert.equal(result.data.provenance.channel, mode === "runtime" ? "cdp" : mode)
        assert.equal(result.data.provenance.capture_status, "eligible")
        assert.equal(result.data.provenance.complete_for_scope, false)
        assert.deepEqual(worlds, mode === "runtime" ? [] : mode === "isolated" ? ["ISOLATED"] : ["ISOLATED", "MAIN"])
      } finally {
        if (previous === undefined) delete (globalThis as any).chrome
        else (globalThis as any).chrome = previous
      }
    })
  }
}
