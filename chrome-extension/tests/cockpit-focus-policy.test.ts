import test from "node:test"
import assert from "node:assert/strict"
import {
  cockpitFocusEventFromMessage,
  cruiseFlagsFromConfig,
  decideCockpitFocus,
  foldConfigUpdated,
  isArmed,
  mergeCruiseFlags,
  unattendedArmedFromStatus,
  DEFAULT_ARM_STATE,
  type ArmState,
  type CockpitFocusAction,
  type CockpitFocusEvent,
} from "../src/background/cockpit-focus-policy"

const UNARMED: ArmState = { cruise: {}, unattendedArmed: false }
const CRUISE_BROWSER: ArmState = {
  cruise: { auto_approve_dangerous: true },
  unattendedArmed: false,
}
const CRUISE_FULL: ArmState = {
  cruise: { auto_approve_dangerous: true, auto_approve_enterprise_tools: true },
  unattendedArmed: false,
}
const CRUISE_FULL_PROTOCOL: ArmState = {
  cruise: {
    auto_approve_dangerous: true,
    auto_approve_enterprise_tools: true,
    allow_all_schemes: true,
  },
  unattendedArmed: false,
}
const UNATTENDED: ArmState = { cruise: {}, unattendedArmed: true }

// --- 决策表（GitHub #326 票 5）---------------------------------------------

const CASES: Array<{ name: string; event: CockpitFocusEvent; arm: ArmState; want: CockpitFocusAction }> = [
  // a) 非 nonce 轻量确认 → 不抢焦点（侧栏 MinimalConfirm + macOS 托盘承担）
  {
    name: "轻量确认（无 nonce 无重预览）→ 不抢焦点",
    event: { kind: "confirmation", hasNonce: false, hasHeavyPreview: false },
    arm: UNARMED,
    want: "stay_background",
  },
  {
    name: "轻量确认 + 巡航武装 → 不抢焦点",
    event: { kind: "confirmation", hasNonce: false, hasHeavyPreview: false },
    arm: CRUISE_FULL_PROTOCOL,
    want: "stay_background",
  },
  // b) nonce / 重预览级确认 → 仍自动开并聚焦（侧栏禁批 nonce）
  {
    name: "nonce 确认 → 抢焦点（未武装也一样）",
    event: { kind: "confirmation", hasNonce: true, hasHeavyPreview: false },
    arm: UNARMED,
    want: "open_focus",
  },
  {
    name: "nonce 确认 + 值守武装 → 仍抢焦点",
    event: { kind: "confirmation", hasNonce: true, hasHeavyPreview: false },
    arm: UNATTENDED,
    want: "open_focus",
  },
  {
    name: "重预览确认（full_preview/preview_image）→ 抢焦点",
    event: { kind: "confirmation", hasNonce: false, hasHeavyPreview: true },
    arm: CRUISE_FULL,
    want: "open_focus",
  },
  // c) CU paused 需人 → 仍开
  {
    name: "CU paused + 未武装 → 抢焦点",
    event: { kind: "computer_task", event: "paused" },
    arm: UNARMED,
    want: "open_focus",
  },
  {
    name: "CU paused + 巡航武装 → 仍抢焦点",
    event: { kind: "computer_task", event: "paused" },
    arm: CRUISE_FULL_PROTOCOL,
    want: "open_focus",
  },
  {
    name: "CU paused + 值守武装 → 仍抢焦点",
    event: { kind: "computer_task", event: "paused" },
    arm: UNATTENDED,
    want: "open_focus",
  },
  // d) CU started：巡航/值守武装 → 不抢；未武装 → 维持现状
  {
    name: "CU started + 网页巡航 → 不抢焦点",
    event: { kind: "computer_task", event: "started" },
    arm: CRUISE_BROWSER,
    want: "stay_background",
  },
  {
    name: "CU started + 全自动巡航 → 不抢焦点",
    event: { kind: "computer_task", event: "started" },
    arm: CRUISE_FULL,
    want: "stay_background",
  },
  {
    name: "CU started + 全自动+协议 → 不抢焦点",
    event: { kind: "computer_task", event: "started" },
    arm: CRUISE_FULL_PROTOCOL,
    want: "stay_background",
  },
  {
    name: "CU started + 值守武装 → 不抢焦点",
    event: { kind: "computer_task", event: "started" },
    arm: UNATTENDED,
    want: "stay_background",
  },
  {
    name: "CU started + 未武装 → 维持现状（抢焦点）",
    event: { kind: "computer_task", event: "started" },
    arm: UNARMED,
    want: "open_focus",
  },
  {
    name: "CU started + 状态未知（DEFAULT）→ 维持现状（fail-safe 偏向旧行为）",
    event: { kind: "computer_task", event: "started" },
    arm: DEFAULT_ARM_STATE,
    want: "open_focus",
  },
  // 其它 CU 事件从不抢焦点
  {
    name: "CU completed → 不抢焦点",
    event: { kind: "computer_task", event: "completed" },
    arm: UNARMED,
    want: "stay_background",
  },
  {
    name: "CU step 进度事件 → 不抢焦点",
    event: { kind: "computer_task", event: "step" },
    arm: UNATTENDED,
    want: "stay_background",
  },
]

for (const c of CASES) {
  test(`decideCockpitFocus: ${c.name}`, () => {
    assert.equal(decideCockpitFocus(c.event, c.arm), c.want)
  })
}

// --- 消息提取（字段名对齐 SecurityConfirmationRequest）---------------------

test("轻量 security.confirmation.request → confirmation 事件", () => {
  const ev = cockpitFocusEventFromMessage({
    type: "security.confirmation.request",
    confirmation_id: "c1",
    tool_name: "navigate",
    risk_level: "low",
  })
  assert.deepEqual(ev, { kind: "confirmation", hasNonce: false, hasHeavyPreview: false })
})

test("nonce_challenge 非空字符串 → hasNonce", () => {
  const ev = cockpitFocusEventFromMessage({
    type: "security.confirmation.request",
    confirmation_id: "c2",
    tool_name: "host_write",
    nonce_challenge: "483920",
  })
  assert.deepEqual(ev, { kind: "confirmation", hasNonce: true, hasHeavyPreview: false })
})

test("空 nonce 字符串不算 nonce", () => {
  const ev = cockpitFocusEventFromMessage({
    type: "security.confirmation.request",
    confirmation_id: "c3",
    tool_name: "host_write",
    nonce_challenge: "",
  })
  assert.deepEqual(ev, { kind: "confirmation", hasNonce: false, hasHeavyPreview: false })
})

test("full_preview / preview_image → 重预览级", () => {
  assert.deepEqual(
    cockpitFocusEventFromMessage({
      type: "security.confirmation.request",
      confirmation_id: "c4",
      tool_name: "host_computer",
      full_preview: "30 actions ...",
    }),
    { kind: "confirmation", hasNonce: false, hasHeavyPreview: true },
  )
  assert.deepEqual(
    cockpitFocusEventFromMessage({
      type: "security.confirmation.request",
      confirmation_id: "c5",
      tool_name: "host_computer",
      preview_image: "base64jpeg",
    }),
    { kind: "confirmation", hasNonce: false, hasHeavyPreview: true },
  )
})

// grok review NIT-3：白名单/信任勾选不算重预览——relevant_domains /
// relevant_apps 是 MinimalConfirm 可批的轻确认（白名单勾选在确认台，但此处
// 可快速允许/拒绝），若算重预览则几乎所有 navigate L2 仍抢桌面，票 5 空转。
test("relevant_domains 非空 ⇒ 仍轻确认（hasHeavyPreview: false，不抢焦点）", () => {
  const ev = cockpitFocusEventFromMessage({
    type: "security.confirmation.request",
    confirmation_id: "c6",
    tool_name: "navigate",
    relevant_domains: ["example.com"],
  })
  assert.deepEqual(ev, { kind: "confirmation", hasNonce: false, hasHeavyPreview: false })
  assert.equal(decideCockpitFocus(ev!, UNARMED), "stay_background")
})

test("relevant_apps 非空 ⇒ 仍轻确认（hasHeavyPreview: false，不抢焦点）", () => {
  const ev = cockpitFocusEventFromMessage({
    type: "security.confirmation.request",
    confirmation_id: "c7",
    tool_name: "host_read",
    relevant_apps: ["com.apple.Notes"],
  })
  assert.deepEqual(ev, { kind: "confirmation", hasNonce: false, hasHeavyPreview: false })
  assert.equal(decideCockpitFocus(ev!, CRUISE_FULL), "stay_background")
})

test("computer.task.event → computer_task 事件", () => {
  assert.deepEqual(cockpitFocusEventFromMessage({ type: "computer.task.event", event: "started" }), {
    kind: "computer_task",
    event: "started",
  })
  assert.deepEqual(cockpitFocusEventFromMessage({ type: "computer.task.event", event: "paused" }), {
    kind: "computer_task",
    event: "paused",
  })
})

test("无关消息 → null（confirm resolved/expired 不开窗）", () => {
  assert.equal(cockpitFocusEventFromMessage({ type: "security.confirmation.resolved" }), null)
  assert.equal(cockpitFocusEventFromMessage({ type: "security.confirmation.expired" }), null)
  assert.equal(cockpitFocusEventFromMessage({ type: "chat.stream" }), null)
  assert.equal(cockpitFocusEventFromMessage(null), null)
  assert.equal(cockpitFocusEventFromMessage({}), null)
})

// --- 武装态镜像 --------------------------------------------------------------

test("cruiseFlagsFromConfig 从嵌套 security.* 提取三 bool", () => {
  assert.deepEqual(
    cruiseFlagsFromConfig({
      llm: { model_name: "x" },
      security: {
        auto_approve_dangerous: true,
        auto_approve_enterprise_tools: false,
        allow_all_schemes: true,
      },
    }),
    { auto_approve_dangerous: true, auto_approve_enterprise_tools: false, allow_all_schemes: true },
  )
  assert.deepEqual(cruiseFlagsFromConfig({}), {})
  assert.deepEqual(cruiseFlagsFromConfig({ security: {} }), {})
  assert.deepEqual(cruiseFlagsFromConfig(null), {})
})

test("mergeCruiseFlags 只覆盖出现的旗（部分快照不误解除武装）", () => {
  assert.deepEqual(
    mergeCruiseFlags(
      { auto_approve_dangerous: true, auto_approve_enterprise_tools: true },
      { auto_approve_dangerous: false },
    ),
    { auto_approve_dangerous: false, auto_approve_enterprise_tools: true },
  )
})

test("unattendedArmedFromStatus 只认 security.unattended.status", () => {
  assert.equal(unattendedArmedFromStatus({ type: "security.unattended.status", armed: true }), true)
  assert.equal(unattendedArmedFromStatus({ type: "security.unattended.status", armed: false }), false)
  assert.equal(unattendedArmedFromStatus({ type: "security.unattended.status" }), false)
  assert.equal(unattendedArmedFromStatus({ type: "config.updated" }), null)
})

test("isArmed：任一巡航旗或值守即武装；默认状态不武装", () => {
  assert.equal(isArmed(UNARMED), false)
  assert.equal(isArmed(DEFAULT_ARM_STATE), false)
  assert.equal(isArmed(CRUISE_BROWSER), true)
  assert.equal(isArmed(CRUISE_FULL), true)
  assert.equal(isArmed(CRUISE_FULL_PROTOCOL), true)
  assert.equal(isArmed(UNATTENDED), true)
  assert.equal(isArmed({ cruise: { allow_all_schemes: true }, unattendedArmed: false }), true)
})

// grok review NIT-4：foldConfigUpdated belt——三旗全 false 时清陈旧值守镜像
// （tray 跨表面 disarm + clear_cruise 的 status 回包只到 tray，SW 镜像靠
// config.updated 全量广播纠偏）。
test("foldConfigUpdated：三旗全 false 清掉 unattendedArmed", () => {
  const prev: ArmState = {
    cruise: { auto_approve_dangerous: true, auto_approve_enterprise_tools: true },
    unattendedArmed: true,
  }
  const next = foldConfigUpdated(prev, {
    security: {
      auto_approve_dangerous: false,
      auto_approve_enterprise_tools: false,
      allow_all_schemes: false,
    },
  })
  assert.deepEqual(next, {
    cruise: {
      auto_approve_dangerous: false,
      auto_approve_enterprise_tools: false,
      allow_all_schemes: false,
    },
    unattendedArmed: false,
  })
  assert.equal(isArmed(next), false)
})

test("foldConfigUpdated：任一旗仍 true 时保留 unattendedArmed", () => {
  const prev: ArmState = { cruise: {}, unattendedArmed: true }
  const next = foldConfigUpdated(prev, {
    security: {
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: true,
      allow_all_schemes: false,
    },
  })
  assert.equal(next.unattendedArmed, true)
  assert.equal(isArmed(next), true)
})

test("foldConfigUpdated：无 security 块时保留巡航旧值与值守镜像", () => {
  const prev: ArmState = {
    cruise: { auto_approve_dangerous: true },
    unattendedArmed: true,
  }
  const next = foldConfigUpdated(prev, { llm: { model_name: "x" } })
  assert.deepEqual(next, prev)
})
