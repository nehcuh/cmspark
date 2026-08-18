// UIUX v2 PR4 — §4.8 slash / chip / 装配 parity (pure, no React mount)

import test from "node:test"
import assert from "node:assert/strict"
import {
  META_PANEL_SLASH,
  SLASH_PANEL_COMMANDS,
  COMPOSE_SECTIONS,
  composerChipsForLevel,
  composerPlaceholder,
  resolveMetaSlash,
  composeSectionsExcludeBoard,
} from "../src/sidepanel/composer/meta-slash"
import type { SkillMeta } from "../src/sidepanel/types"

test("§4.8 slash matrix covers all Host panel commands", () => {
  const expected: Array<{ command: string; panelId: string }> = [
    { command: "skills", panelId: "skills" },
    { command: "knowledge", panelId: "knowledge" },
    { command: "history", panelId: "history" },
    { command: "tabs", panelId: "tabs" },
    { command: "packs", panelId: "packs" },
    { command: "mcp", panelId: "mcp" },
    { command: "apps", panelId: "apps" },
    { command: "board", panelId: "board" },
  ]
  for (const row of expected) {
    const hit = SLASH_PANEL_COMMANDS.find((c) => c.command === row.command)
    assert.ok(hit, `missing /${row.command}`)
    assert.equal(hit!.panelId, row.panelId)
  }
})

test("§4.8 slash includes settings, cockpit, 装配 (non-panel)", () => {
  const names = new Set(META_PANEL_SLASH.map((e) => e.name))
  assert.ok(names.has("settings"))
  assert.ok(names.has("cockpit"))
  assert.ok(names.has("装配"))
  assert.equal(
    META_PANEL_SLASH.find((e) => e.name === "settings")?.metaKind,
    "settings",
  )
  assert.equal(
    META_PANEL_SLASH.find((e) => e.name === "cockpit")?.metaKind,
    "cockpit",
  )
  assert.equal(
    META_PANEL_SLASH.find((e) => e.name === "装配")?.metaKind,
    "compose",
  )
})

test("resolveMetaSlash maps panel / compose / settings / cockpit", () => {
  const skills = META_PANEL_SLASH.find((e) => e.name === "skills")!
  assert.equal(resolveMetaSlash(skills)?.metaKind, "panel")
  assert.equal(resolveMetaSlash(skills)?.panelId, "skills")

  const compose = META_PANEL_SLASH.find((e) => e.name === "装配")!
  assert.equal(resolveMetaSlash(compose)?.metaKind, "compose")

  const settings = META_PANEL_SLASH.find((e) => e.name === "settings")!
  assert.equal(resolveMetaSlash(settings)?.metaKind, "settings")

  const cockpit = META_PANEL_SLASH.find((e) => e.name === "cockpit")!
  assert.equal(resolveMetaSlash(cockpit)?.metaKind, "cockpit")

  const plain: SkillMeta = {
    name: "my-skill",
    description: "user",
    type: "prompt_template",
    builtin: false,
  }
  assert.equal(resolveMetaSlash(plain), null)
})

test("§4.5 装配 sections are Composition only — no board", () => {
  assert.ok(composeSectionsExcludeBoard())
  assert.ok(COMPOSE_SECTIONS.every((s) => s.panelId !== "board"))
  const ids = COMPOSE_SECTIONS.map((s) => s.id)
  for (const need of ["skills", "knowledge", "packs", "mcp", "apps", "history"] as const) {
    assert.ok(ids.includes(need), `装配 missing ${need}`)
  }
  // PR6 full cards still Composition-only
  assert.ok(COMPOSE_SECTIONS.every((s) => s.titleZh && s.group))
})

test("G2 / Q1 composer chips: L0 one 装配 only; L1 ≤3; no Abort", () => {
  const l0 = composerChipsForLevel("chat")
  assert.equal(l0.length, 1)
  assert.deepEqual(
    l0.map((c) => c.id),
    ["compose"],
  )
  assert.equal(l0[0].action.kind, "compose")
  assert.equal(l0[0].primary, true)

  const l1 = composerChipsForLevel("browser")
  assert.ok(l1.length <= 3)
  assert.deepEqual(
    l1.map((c) => c.id),
    ["compose", "tabs", "workspace"],
  )
  const workspace = l1.find((c) => c.id === "workspace")!
  assert.equal(workspace.action.kind, "panel")
  if (workspace.action.kind === "panel") {
    assert.equal(workspace.action.panelId, "packs")
  }

  const l2 = composerChipsForLevel("computer")
  assert.ok(l2.length <= 3)
  assert.deepEqual(
    l2.map((c) => c.id),
    ["cockpit", "compose"],
  )
  assert.ok(!l2.some((c) => /abort|急停|stop/i.test(c.label)))
  assert.ok(!l2.some((c) => c.id === "abort"))
})

test("G2 mode-aware placeholders (short, human)", () => {
  assert.match(composerPlaceholder("chat"), /描述任务/)
  assert.match(composerPlaceholder("browser"), /问这页/)
  assert.match(composerPlaceholder("computer"), /确认台/)
})

test("META_PANEL_SLASH entries tagged for popover filter", () => {
  for (const e of META_PANEL_SLASH) {
    assert.ok(e.builtin)
    assert.ok(e.tags?.includes("meta-slash") || e.tags?.some((t) => t.startsWith("meta-")))
  }
})
