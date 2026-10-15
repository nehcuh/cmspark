import test from "node:test"
import assert from "node:assert/strict"
import { tryParseToolArgs } from "../src/bridge/tool-schemas"
import { getToolDefinitions } from "../src/bridge/tool-definitions"
import { outboundToolArgumentSchema, validateOutboundToolArgs } from "../src/outbound-mcp/tool-schema"
import { OUTBOUND_PROFILE_TOOLS } from "../src/outbound-mcp/profile"
import fs from "node:fs"
import path from "node:path"
const id = "9dbe5d46-b71e-4bd5-8c47-c8c2c2bf5a35"
test("#521 real catalog exposes local observation", () => assert.ok(getToolDefinitions().find(t => t.function.name === "get_interactive_snapshot")))
for (const tool of ["click", "type"]) {
 test("#521 paired IDs survive real schema: " + tool, () => {
  const input = { tabId: 7, snapshot_id: id, element_id: 3, ...(tool === "type" ? { value: "OWNED" } : {}) }
  const parsed = tryParseToolArgs(tool, input); assert.equal(parsed.ok, true)
  if (parsed.ok) assert.deepEqual(parsed.args, input)
 })
 for (const change of [{ element_id: undefined }, { snapshot_id: undefined }, { element_id: 0 }, { element_id: 65 }, { element_id: 1.5 }, { element_id: Infinity }, { element_id: NaN }, { snapshot_id: "" }, { exact: false }, { text: "Save" }, { selector: "#save" }]) {
  test("#521 partial/mixed mode rejects: " + tool + JSON.stringify(change), () => assert.equal(tryParseToolArgs(tool, { tabId: 7, snapshot_id: id, element_id: 3, ...(tool === "type" ? { value: "OWNED" } : {}), ...change }).ok, false))
 }
}
for (const input of [{ tabId: 7 }, { tabId: "7" }, { tabId: NaN }, { tabId: Infinity }, { tabId: 0 }, { tabId: Number.MAX_SAFE_INTEGER + 1 }, { tabId: 7, code: "OWNED_FORBIDDEN" }]) test("#521 observer strict shape: " + JSON.stringify(input), () => assert.equal(tryParseToolArgs("get_interactive_snapshot", input).ok, Object.keys(input).length === 1 && input.tabId === 7))
test("#521 UTF8 numeric cap preserves legacy focus type", () => {
 assert.equal(tryParseToolArgs("type", { tabId: 7, value: "é".repeat(8192), snapshot_id: id, element_id: 1 }).ok, true)
 assert.equal(tryParseToolArgs("type", { tabId: 7, value: "é".repeat(8193), snapshot_id: id, element_id: 1 }).ok, false)
 assert.equal(tryParseToolArgs("type", { tabId: 7, value: "é".repeat(8193) }).ok, true)
 assert.equal(tryParseToolArgs("click", { tabId: 7, text: "Save", selector: "#other" }).ok, true)
})
test("#521 outbound equals real legacy recording", () => {
 const recorded = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/interactive-snapshot-521-outbound-legacy.json"), "utf8"))
 for (const tool of ["click", "type"]) {
  const name = "cmspark__" + tool; assert.deepEqual(outboundToolArgumentSchema(name), recorded[name])
  assert.ok(validateOutboundToolArgs(name, { tabId: 7, snapshot_id: id, element_id: 1, ...(tool === "type" ? { value: "OWNED" } : {}) }))
 }
 for (const tools of Object.values(OUTBOUND_PROFILE_TOOLS)) assert.equal(tools.includes("cmspark__get_interactive_snapshot"), false)
})
