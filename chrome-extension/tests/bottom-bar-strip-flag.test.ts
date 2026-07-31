// UIUX v2 PR5 — §4.7 M3: ui.bottomBarStrip default off; Host remains SoT.

import test from "node:test"
import assert from "node:assert/strict"
import { ui } from "../src/sidepanel/ui/flags"
import {
  CONTEXT_PANEL_TABS,
  isContextPanelId,
} from "../src/sidepanel/components/ContextPanelHost"
import {
  META_PANEL_SLASH,
  COMPOSE_SECTIONS,
  composerChipsForLevel,
} from "../src/sidepanel/composer/meta-slash"

test("PR5 M3: ui.bottomBarStrip defaults to false (no permanent tab row)", () => {
  assert.equal(ui.bottomBarStrip, false)
})

test("PR5: Host registry still owns all panel ids (SoT independent of strip)", () => {
  const ids = CONTEXT_PANEL_TABS.map((t) => t.id)
  for (const need of [
    "skills",
    "knowledge",
    "history",
    "tabs",
    "packs",
    "board",
    "mcp",
    "apps",
  ] as const) {
    assert.ok(ids.includes(need), `Host missing panel ${need}`)
    assert.equal(isContextPanelId(need), true)
  }
})

test("PR5: chips + 装配 + slash remain discoverability when strip off", () => {
  const l0 = composerChipsForLevel("chat").map((c) => c.id)
  assert.ok(l0.includes("compose"), "L0 needs 装配 chip")
  assert.ok(l0.includes("skills"))
  assert.ok(l0.includes("knowledge"))

  const l1 = composerChipsForLevel("browser").map((c) => c.id)
  assert.ok(l1.includes("compose"))
  assert.ok(l1.includes("tabs"))

  const l2 = composerChipsForLevel("computer").map((c) => c.id)
  assert.ok(l2.includes("cockpit"))
  assert.ok(l2.includes("compose"))

  assert.ok(COMPOSE_SECTIONS.some((s) => s.panelId === "packs"))
  assert.ok(COMPOSE_SECTIONS.some((s) => s.panelId === "mcp"))
  assert.ok(COMPOSE_SECTIONS.every((s) => s.panelId !== "board"))

  const slashNames = new Set(META_PANEL_SLASH.map((e) => e.name))
  assert.ok(slashNames.has("packs"))
  assert.ok(slashNames.has("mcp"))
  assert.ok(slashNames.has("装配"))
  assert.ok(slashNames.has("board"))
})
