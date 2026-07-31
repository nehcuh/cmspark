// UIUX v2 PR6 — full 装配 sections + attach-target ontology (pure, no React mount)

import test from "node:test"
import assert from "node:assert/strict"
import {
  COMPOSE_GROUP_LABELS,
  COMPOSE_SECTIONS,
  composeAttachLine,
  composeSectionGroups,
  composeSectionsExcludeBoard,
  composeSectionsInGroup,
  surfaceLxLabel,
} from "../src/sidepanel/composer/meta-slash"

test("PR6: 装配 sections are Composition only — no board / autonomy ids", () => {
  assert.ok(composeSectionsExcludeBoard())
  for (const s of COMPOSE_SECTIONS) {
    assert.ok(s.panelId !== "board")
    assert.ok(s.id !== ("board" as typeof s.id))
    assert.ok(!/中层/.test(s.label))
    assert.ok(!/中层/.test(s.titleZh))
    assert.ok(!/中层/.test(s.hint))
  }
  const ids = COMPOSE_SECTIONS.map((s) => s.id)
  for (const need of ["skills", "knowledge", "packs", "mcp", "apps", "history"] as const) {
    assert.ok(ids.includes(need), `装配 missing ${need}`)
  }
})

test("PR6: full section cards carry titleZh + group + attach-ready hints", () => {
  for (const s of COMPOSE_SECTIONS) {
    assert.ok(s.titleZh.length > 0, `${s.id} missing titleZh`)
    assert.ok(s.hint.length > 0, `${s.id} missing hint`)
    assert.ok(s.group in COMPOSE_GROUP_LABELS, `${s.id} bad group ${s.group}`)
    assert.equal(s.panelId, s.id)
  }
})

test("PR6: section groups order is capability → connect → record", () => {
  assert.deepEqual(composeSectionGroups(), ["capability", "connect", "record"])
  assert.deepEqual(
    composeSectionsInGroup("capability").map((s) => s.id),
    ["skills", "knowledge"],
  )
  assert.deepEqual(
    composeSectionsInGroup("connect").map((s) => s.id),
    ["packs", "mcp", "apps"],
  )
  assert.deepEqual(
    composeSectionsInGroup("record").map((s) => s.id),
    ["history"],
  )
})

test("PR6 §4.5 attach target shows Surface Lx for each capability level", () => {
  assert.equal(surfaceLxLabel("chat"), "L0 聊")
  assert.equal(surfaceLxLabel("browser"), "L1 网页")
  assert.equal(surfaceLxLabel("computer"), "L2 计算机")

  assert.match(composeAttachLine("chat"), /挂到当前线程/)
  assert.match(composeAttachLine("chat"), /Surface L0 聊/)
  assert.match(composeAttachLine("browser"), /Surface L1 网页/)
  assert.match(composeAttachLine("computer"), /Surface L2 计算机/)
})

test("PR6: group labels never claim Board / 中层 Agent", () => {
  for (const label of Object.values(COMPOSE_GROUP_LABELS)) {
    assert.ok(!/board|任务板|中层/i.test(label))
  }
})
