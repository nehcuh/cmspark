// Run after tsc -p tsconfig.test.json (Node22). Records production BrowserBridge
// output using a synthetic browser DOM. This is a wire fixture, not pilot proof.
import { createRequire } from "node:module"
import { writeFileSync, mkdirSync } from "node:fs"
import vm from "node:vm"
const require = createRequire(import.meta.url)
const { BrowserBridge } = require("../.test-dist/src/background/browser-bridge.js")
globalThis.chrome = {
  tabs: { get: async () => ({ url: "https://user:secret@devops.example.test/releases?token=private#details", title: "Synthetic release" }) },
  debugger: {
    onDetach: { addListener() {} }, attach: async () => {},
    sendCommand: async (_target, method) => {
      if (method === "Page.enable" || method === "DOM.enable") return {}
      throw new Error("CDP unavailable in synthetic fixture")
    },
  },
  scripting: { executeScript: async options => [{ result: vm.runInNewContext(`(${options.func.toString()})(...args)`,
    { args: options.args || [], location: { href: "https://user:secret@devops.example.test/releases?token=private#details" }, document: {
      body: { innerText: "Release REL-1\r\nEnvironment prod\r\nCommit abc123\r\n😀 Café" },
      querySelector: () => ({ outerHTML: "<section id=\"environment\">Environment non-prod</section>" }),
    } }) }] },
}
const result = await new BrowserBridge().execute("get_page_text", { tabId: 7 })
if (!result.success || result.data?.provenance?.channel !== "isolated") throw new Error("unexpected producer result")
const destination = new URL("../../companion/tests/fixtures/page-read-v1.json", import.meta.url)
mkdirSync(new URL("./", destination), { recursive: true })
writeFileSync(destination, JSON.stringify(result, null, 2) + "\n")
const html = await new BrowserBridge().execute("get_page_html", { tabId: 7, selector: "#environment" })
if (!html.success || html.data?.provenance?.scope?.selector !== "#environment") throw new Error("unexpected HTML producer result")
writeFileSync(new URL("../../companion/tests/fixtures/page-read-html-v1.json", import.meta.url), JSON.stringify(html, null, 2) + "\n")
