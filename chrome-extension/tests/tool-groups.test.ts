import test from "node:test"
import assert from "node:assert/strict"
import { CONTEXT_PANEL_TABS } from "../src/sidepanel/components/ContextPanelHost"
import { contextBarOverflowTabsForLevel, contextBarTabsForLevel } from "../src/sidepanel/mode/mode-controller"
import { toolGroups } from "../src/sidepanel/navigation/tool-groups"

test("tool groups keep the existing primary order", () => {
  assert.deepEqual(toolGroups("chat")[0].ids, ["skills", "knowledge", "history"])
  assert.deepEqual(toolGroups("browser")[0].ids, ["tabs", "skills"])
  for (const level of ["chat", "browser", "computer"] as const) {
    assert.deepEqual(toolGroups(level)[0].ids, contextBarTabsForLevel(level))
    assert.deepEqual(toolGroups(level)[1].ids, contextBarOverflowTabsForLevel(level))
    const ids = toolGroups(level).flatMap(group => group.ids)
    assert.deepEqual([...ids].sort(), CONTEXT_PANEL_TABS.map(tab => tab.id).sort())
    assert.equal((ids as string[]).includes("shell"), false)
  }
})
