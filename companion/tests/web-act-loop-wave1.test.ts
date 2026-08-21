import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getToolDefinitions } from "../src/bridge/tool-definitions.js"
import { tryParseToolArgs } from "../src/bridge/tool-schemas.js"
import { classifyError } from "../src/security.js"
import { isDomInjectShellCommand } from "../src/tool/dom-script-budget.js"
import { L2_GATE_TOOLS } from "../src/tool/l2-admission.js"

function tool(name: string, platform?: string) {
  const t = getToolDefinitions(platform as any).find((x: any) => x.function.name === name)
  assert.ok(t, `missing tool ${name}`)
  return t.function
}

test("catalog click/type expose text; fill_form item does not require selector", () => {
  const click = tool("click")
  assert.ok(click.parameters.properties.text)
  assert.ok(click.description.includes("text"))
  assert.ok(!click.parameters.required.includes("selector"))
  const type = tool("type")
  assert.ok(type.parameters.properties.text)
  const fill = tool("fill_form")
  const items = fill.parameters.properties.fields.items as { required?: string[] } | undefined
  const itemReq = items?.required || []
  assert.ok(itemReq.includes("value"))
  assert.ok(!itemReq.includes("selector"))
  const press = tool("press_key")
  assert.doesNotMatch(press.parameters.properties.modifiers?.description || "", /Meta=8/)
  assert.doesNotMatch(press.parameters.properties.modifiers?.description || "", /Shift=4/)
  assert.ok(press.parameters.properties.ctrlKey)
  assert.ok(press.parameters.properties.metaKey)
})

test("zod: click text-only ok; fill_form field text-only ok; type may omit locator", () => {
  assert.equal(tryParseToolArgs("click", { tabId: 1, text: "发布" }).ok, true)
  assert.equal(tryParseToolArgs("click", { tabId: 1 }).ok, false)
  assert.equal(
    tryParseToolArgs("fill_form", { tabId: 1, fields: [{ text: "标题", value: "hi" }] }).ok,
    true,
  )
  assert.equal(tryParseToolArgs("type", { tabId: 1, value: "x" }).ok, true)
})

test("classifyError: new act-loop codes are recoverable", () => {
  const codes = [
    "SELECTOR_OR_TEXT_REQUIRED: provide text or selector",
    "ELEMENT_AMBIGUOUS: 2 matches",
    "INVALID_SELECTOR: a[",
    "WRONG_ORIGIN: chrome-extension",
    "CDP_ATTACH_FAILED: debugger",
    "EVAL_DEAD_WORLD: probe failed",
    "EVAL_THROWN: TypeError",
    "DOM_SCRIPT_LOOP_CAPPED: stop",
    "DOM_SCRIPT_VOLUME_CAPPED: stop",
    "TYPE_UNSUPPORTED_EDITOR: ce",
    "ELEMENT_NOT_FOUND: no visible element",
  ]
  for (const c of codes) {
    assert.equal(classifyError(c), "recoverable", c)
  }
})

test("win32 parameterized: Start-Process chrome is not inject; querySelector cmd is", () => {
  assert.equal(isDomInjectShellCommand('powershell -c "Start-Process chrome"'), false)
  assert.equal(isDomInjectShellCommand("cmd /c echo document.querySelector && cscript inject.js"), true)
  const winNames = getToolDefinitions("win32").map((t: any) => t.function.name)
  assert.equal(winNames.includes("osascript_eval"), false)
})

test("click is not L2; evaluate/osascript still are", () => {
  assert.equal(L2_GATE_TOOLS.includes("click"), false)
  assert.equal(L2_GATE_TOOLS.includes("fill_form"), false)
  assert.equal(L2_GATE_TOOLS.includes("evaluate"), true)
  assert.equal(L2_GATE_TOOLS.includes("osascript_eval"), true)
})

test("W5 Rule 12/7/12b never host_computer for browser-DOM (source lock)", () => {
  const src = readFileSync(join(process.cwd(), "src/llm/adapter.ts"), "utf8")
  assert.match(src, /NEVER use host_read\/host_write\/host_computer for browser-DOM/)
  assert.match(src, /do NOT retry via evaluate or host_computer/)
  assert.match(src, /NEVER for browser-DOM \(use click\(\{text\}\)/)
  assert.match(src, /host_computer is NOT available on this platform \(Linux\)/)
})
