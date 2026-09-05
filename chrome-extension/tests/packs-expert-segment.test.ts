// #369: 场景与专家分段 / builtin 只读无编辑按钮 / 空态文案 / CTA 文案分叉（纯逻辑断言）
import test from "node:test"
import assert from "node:assert/strict"
import {
  EXPERT_EMPTY_COPY,
  EXPERT_PRIMARY_CTA_DISABLED_HINT,
  EXPERT_PRIMARY_CTA_LABEL,
  EXPERT_SECONDARY_CTA_LABEL,
  PANEL_TITLE,
  expertCardActions,
  formatEffectiveToolsLine,
  formatUsageLine,
  isExpertPack,
  segmentPacks,
} from "../src/sidepanel/packs-panel-logic"

test("panel renamed to 场景与专家", () => {
  assert.equal(PANEL_TITLE, "场景与专家")
})

test("segmentPacks: kind=expert → 专家段；其余（含 legacy 无 kind）→ 场景段", () => {
  const packs = [
    { id: "a-mission", kind: "mission" as const },
    { id: "b-legacy" },
    { id: "c-expert", kind: "expert" as const },
    { id: "d-expert", kind: "expert" as const },
  ]
  const { scenes, experts } = segmentPacks(packs)
  assert.deepEqual(scenes.map((p) => p.id), ["a-mission", "b-legacy"])
  assert.deepEqual(experts.map((p) => p.id), ["c-expert", "d-expert"])
  assert.equal(isExpertPack({}), false)
  assert.equal(isExpertPack({ kind: "mission" }), false)
  assert.equal(isExpertPack({ kind: "expert" }), true)
})

test("builtin expert: 只读 — 动作集无 编辑/删除，有 查看/另存为我的", () => {
  const actions = expertCardActions({ id: "builtin-expert", kind: "expert", origin: "builtin" })
  assert.ok(!actions.includes("edit"), "builtin must NOT have 编辑")
  assert.ok(!actions.includes("delete"), "builtin must NOT have 删除")
  assert.ok(!actions.includes("disable") && !actions.includes("enable"))
  assert.ok(actions.includes("view"))
  assert.ok(actions.includes("clone"))
  assert.ok(actions.includes("team"))
  assert.ok(actions.includes("apply"))
  // installed（非 user 可编辑）同样只读
  const installed = expertCardActions({ id: "i", kind: "expert", origin: "installed" })
  assert.ok(!installed.includes("edit") && !installed.includes("delete"))
})

test("user expert: CRUD 齐全（编辑/停用/删除）+ 主次 CTA", () => {
  const actions = expertCardActions({ id: "u", kind: "expert", origin: "user", editable: true })
  for (const a of ["team", "apply", "view", "edit", "disable", "delete"] as const) {
    assert.ok(actions.includes(a), `user expert missing action ${a}`)
  }
  assert.ok(!actions.includes("clone"), "user expert does not need 另存为我的")
})

test("disabled: 不出 派出/套用（companion 已拒绝，UI 不误导）；编辑器只读可打开", () => {
  const userDisabled = expertCardActions({
    id: "u",
    kind: "expert",
    origin: "user",
    editable: true,
    disabled: true,
  })
  assert.deepEqual(userDisabled, ["view", "enable", "delete"])
  const builtinDisabled = expertCardActions({ id: "b", kind: "expert", origin: "builtin", disabled: true })
  assert.deepEqual(builtinDisabled, ["view"])
})

test("空态文案：给下一步（新建 + 另存为），不留死屏", () => {
  assert.match(EXPERT_EMPTY_COPY, /新建专家/)
  assert.match(EXPERT_EMPTY_COPY, /另存为我的/)
  assert.match(EXPERT_EMPTY_COPY, /专家/)
})

test("CTA 文案分叉：主 CTA 组队（即将推出，honest disabled），次 CTA 套到本对话", () => {
  assert.match(EXPERT_PRIMARY_CTA_LABEL, /派到当前任务|组队/)
  assert.match(EXPERT_PRIMARY_CTA_DISABLED_HINT, /即将推出/)
  assert.equal(EXPERT_SECONDARY_CTA_LABEL, "套到本对话")
  assert.notStrictEqual(EXPERT_PRIMARY_CTA_LABEL, EXPERT_SECONDARY_CTA_LABEL)
})

test("有效工具面文案：明示是计算结果；空面给出原因提示", () => {
  const line = formatEffectiveToolsLine(["navigate", "list_tabs"])
  assert.match(line, /有效工具面/)
  assert.match(line, /navigate、list_tabs/)
  const many = formatEffectiveToolsLine(Array.from({ length: 12 }, (_, i) => `t${i}`))
  assert.match(many, /等 12 个/)
  const empty = formatEffectiveToolsLine([])
  assert.match(empty, /空/)
})

test("用量行：0 次不展示；>0 展示次数与最近日期", () => {
  assert.equal(formatUsageLine(0, null), null)
  assert.equal(formatUsageLine(3, "2026-09-05T01:02:03Z"), "已被派出 3 次（最近 2026-09-05）")
})
