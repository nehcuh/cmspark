// UIUX v2 §4.7 M1 — ContextPanelHost registry / id guards (unit, no React mount)

import test from "node:test"
import assert from "node:assert/strict"
import {
  CONTEXT_PANEL_TABS,
  contextPanelLabel,
  isContextPanelId,
  type ContextPanelId,
} from "../src/sidepanel/components/ContextPanelHost"
import {
  contextBarTabsForLevel,
  contextBarOverflowTabsForLevel,
} from "../src/sidepanel/mode/mode-controller"

test("M1: registry covers all ContextPanelId values used by mode-controller", () => {
  const registryIds = new Set(CONTEXT_PANEL_TABS.map((t) => t.id))
  for (const level of ["chat", "browser", "computer"] as const) {
    for (const id of contextBarTabsForLevel(level)) {
      assert.ok(registryIds.has(id as ContextPanelId), `primary tab ${id} missing from registry`)
    }
    for (const id of contextBarOverflowTabsForLevel(level)) {
      assert.ok(registryIds.has(id as ContextPanelId), `overflow tab ${id} missing from registry`)
    }
  }
})

test("M1: isContextPanelId accepts known panels and rejects junk", () => {
  assert.equal(isContextPanelId("skills"), true)
  assert.equal(isContextPanelId("packs"), true)
  assert.equal(isContextPanelId("mcp"), true)
  assert.equal(isContextPanelId("settings"), false)
  assert.equal(isContextPanelId(""), false)
  assert.equal(isContextPanelId("SKILLS"), false)
})

test("M1: contextPanelLabel returns Chinese labels for strip/host header", () => {
  assert.equal(contextPanelLabel("skills"), "技能")
  assert.equal(contextPanelLabel("knowledge"), "知识")
  assert.equal(contextPanelLabel("packs"), "场景")
  assert.equal(contextPanelLabel("board"), "任务板")
})

test("M1: registry has stable 8 panels (tabs/history/skills/knowledge/packs/board/mcp/apps)", () => {
  assert.equal(CONTEXT_PANEL_TABS.length, 8)
  assert.deepEqual(
    CONTEXT_PANEL_TABS.map((t) => t.id),
    ["tabs", "history", "skills", "knowledge", "packs", "board", "mcp", "apps"],
  )
})
