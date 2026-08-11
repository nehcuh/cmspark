/**
 * P2: tool catalog SoT lockstep — COMPANION_TOOLS ⊆ getAllToolDefinitions names
 * (plus known internal-only aliases if any).
 */
import test from "node:test"
import assert from "node:assert/strict"
import { COMPANION_TOOLS, isCompanionTool } from "../src/bridge/companion-tools"
import { getAllToolDefinitions } from "../src/bridge/tool-definitions"
import { TOOL_ARG_SCHEMAS } from "../src/bridge/tool-schemas"

test("P2: every COMPANION_TOOLS name is in catalog or schemas", () => {
  const catalog = new Set(getAllToolDefinitions().map((t) => t.function.name))
  const schemaKeys = new Set(Object.keys(TOOL_ARG_SCHEMAS || {}))
  const missing: string[] = []
  for (const name of COMPANION_TOOLS) {
    if (!catalog.has(name) && !schemaKeys.has(name)) missing.push(name)
  }
  assert.deepEqual(
    missing,
    [],
    `COMPANION_TOOLS missing from catalog/schemas: ${missing.join(", ")}`,
  )
})

test("P2: isCompanionTool matches COMPANION_TOOLS set", () => {
  assert.equal(isCompanionTool("shell_exec"), true)
  assert.equal(isCompanionTool("list_tabs"), false)
  assert.equal(isCompanionTool("spawn_worker"), true)
})

test("P2: catalog native tools that are browser-only are not in COMPANION_TOOLS", () => {
  // list_tabs / navigate must go to extension, not companion local switch
  assert.equal(isCompanionTool("list_tabs"), false)
  assert.equal(isCompanionTool("navigate"), false)
  assert.equal(isCompanionTool("evaluate"), false)
})
