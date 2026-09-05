// Cockpit 抢焦点收敛（GitHub #326）— 开窗决策纯函数/表驱动。
// Spec anchors: .omx/artifacts/perm-rethink-20260905/FINAL-SYNTHESIS.md 票 5,
// current-permission-inventory.md §5, ADR-022 L8.
//
// 只改「开窗策略」，不改确认代数：companion forceConfirm / never-exempt 零 diff。
// 本模块不引入新协议——武装态镜像自已有的 config.updated（三 bool 巡航 SoT）
// 与 security.unattended.status（值守 grant）广播，fail-safe 方向 = 状态未知时
// 维持旧行为（open_focus）。

/** 三 bool 巡航旗（config.security.*，companion config 为唯一 SoT）。 */
export interface CruiseFlags {
  auto_approve_dangerous?: boolean
  auto_approve_enterprise_tools?: boolean
  allow_all_schemes?: boolean
}

/** 扩展侧可见的武装态（巡航三旗 + 值守 grant）。 */
export interface ArmState {
  cruise: CruiseFlags
  unattendedArmed: boolean
}

export const DEFAULT_ARM_STATE: ArmState = {
  cruise: {},
  unattendedArmed: false,
}

/** 巡航（任一旗）或值守武装中。无人值守 arm 双写巡航旗，故两者是或关系。 */
export function isArmed(arm: ArmState): boolean {
  return (
    arm.unattendedArmed === true ||
    arm.cruise.auto_approve_dangerous === true ||
    arm.cruise.auto_approve_enterprise_tools === true ||
    arm.cruise.allow_all_schemes === true
  )
}

export type CockpitFocusEvent =
  | { kind: "confirmation"; hasNonce: boolean; hasHeavyPreview: boolean }
  | { kind: "computer_task"; event: string }

export type CockpitFocusAction = "open_focus" | "stay_background"

/**
 * 开窗决策表（票 5 产品句：小事不抢桌面，要事确认台仍在面前）：
 *
 * | 事件                                   | 动作            |
 * |----------------------------------------|-----------------|
 * | 确认 + nonce_challenge（侧栏禁批）     | open_focus      |
 * | 确认 + 重预览（full_preview/preview_image） | open_focus  |
 * | 确认 + 轻量（MinimalConfirm 可批）     | stay_background |
 * | computer.task paused（需人）           | open_focus      |
 * | computer.task started + 巡航/值守武装  | stay_background |
 * | computer.task started + 未武装/未知    | open_focus      |
 * | 其它 computer.task 事件                | stay_background |
 *
 * 注意：轻确认分支**无武装门**——未武装时轻确认也不抢焦点。这是刻意对齐
 * FINAL-SYNTHESIS 票 5（原文无「武装下」限定；issue 首条的「巡航/值守武装下」
 * 是窄述）与 inventory §5（轻量 = 侧栏可批）。勿按 issue 字面把武装门加回。
 * Win/Linux 侧栏关且无托盘时，未批确认 45s 超时 deny（fail-closed）是票面
 * 明示验收，不是本表的 bug。
 */
export function decideCockpitFocus(
  event: CockpitFocusEvent,
  arm: ArmState,
): CockpitFocusAction {
  if (event.kind === "confirmation") {
    return event.hasNonce || event.hasHeavyPreview ? "open_focus" : "stay_background"
  }
  if (event.event === "paused") return "open_focus"
  if (event.event === "started") {
    return isArmed(arm) ? "stay_background" : "open_focus"
  }
  return "stay_background"
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}

/**
 * 从 companion WS 消息提取开窗事件；无关消息返回 null。
 * nonce/重预览字段名与 sidepanel/types.ts SecurityConfirmationRequest 对齐。
 */
export function cockpitFocusEventFromMessage(msg: any): CockpitFocusEvent | null {
  if (!msg || typeof msg.type !== "string") return null
  if (msg.type === "security.confirmation.request") {
    return {
      kind: "confirmation",
      hasNonce: nonEmptyString(msg.nonce_challenge),
      hasHeavyPreview: nonEmptyString(msg.full_preview) || nonEmptyString(msg.preview_image),
    }
  }
  if (msg.type === "computer.task.event") {
    return { kind: "computer_task", event: typeof msg.event === "string" ? msg.event : "" }
  }
  return null
}

/** 从 config.updated 的 config blob 提取三 bool 巡航旗（嵌套 security.*）。 */
export function cruiseFlagsFromConfig(config: any): CruiseFlags {
  const sec = config && typeof config === "object" ? config.security : undefined
  if (!sec || typeof sec !== "object") return {}
  const flags: CruiseFlags = {}
  if (typeof sec.auto_approve_dangerous === "boolean") {
    flags.auto_approve_dangerous = sec.auto_approve_dangerous
  }
  if (typeof sec.auto_approve_enterprise_tools === "boolean") {
    flags.auto_approve_enterprise_tools = sec.auto_approve_enterprise_tools
  }
  if (typeof sec.allow_all_schemes === "boolean") {
    flags.allow_all_schemes = sec.allow_all_schemes
  }
  return flags
}

/**
 * 折叠 config.updated 进镜像：只覆盖消息里出现的旗，未出现的保留旧值
 * （companion 全量推送，但防御部分快照丢旗时误解除武装）。
 */
export function mergeCruiseFlags(prev: CruiseFlags, next: CruiseFlags): CruiseFlags {
  const merged: CruiseFlags = {}
  for (const key of [
    "auto_approve_dangerous",
    "auto_approve_enterprise_tools",
    "allow_all_schemes",
  ] as const) {
    const v = next[key] !== undefined ? next[key] : prev[key]
    if (v !== undefined) merged[key] = v
  }
  return merged
}

/**
 * 从 security.unattended.status 广播提取值守武装态。
 * 非 status 消息返回 null（不触碰镜像）；status 消息缺 armed 字段时按 false
 * （armed !== true）处理——companion 全量推送，缺字段视为未武装。
 */
export function unattendedArmedFromStatus(msg: any): boolean | null {
  if (!msg || msg.type !== "security.unattended.status") return null
  return msg.armed === true
}

/**
 * 折叠一条 config.updated 进武装态镜像。
 * Belt（grok review NIT-4）：合并后三旗**全 false** 时同时清 unattendedArmed。
 * 场景：扩展武装值守后，tray 跨表面 disarm + clear_cruise——status 回包只到
 * tray 那条 WS（message-router handler 返回值），SW 的值守镜像会陈旧为 true；
 * 但 disarm 的 saveConfig 全量广播 config.updated，三旗全 false 是确定信号。
 * 反向（值守仍 armed 时用户手动关三旗）会把 unattendedArmed 误清——方向是
 * 「CU started 多弹一次」，与 fail-safe「未知多弹」一致，可接受。
 */
export function foldConfigUpdated(prev: ArmState, config: any): ArmState {
  const cruise = mergeCruiseFlags(prev.cruise, cruiseFlagsFromConfig(config))
  const allFlagsOff =
    cruise.auto_approve_dangerous === false &&
    cruise.auto_approve_enterprise_tools === false &&
    cruise.allow_all_schemes === false
  return { cruise, unattendedArmed: allFlagsOff ? false : prev.unattendedArmed }
}
