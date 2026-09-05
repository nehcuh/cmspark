// L-4 (#390) loop status view — the single derivation behind the sidepanel
// loop status line (推进中 N/M · 换路中 · 等待确认 · 受阻:原因 · DONE · 无法完成:
// 钥匙清单). Pure; no I/O. The router broadcasts the derived frame as
// task_loop.status; the extension renders it verbatim (no re-derivation).
//
// #397 MAJOR-2 carry-over: kernel completion is MACHINE-TIER by construction
// (loop-kernel closeRouteRun comment), so `done` renders as「计划完成，待你确认」
// — never「任务已完成」. The default-tier claim layer stays L-4 wording-only.

import { evidenceItems } from "./completion-predicate"
import type { RunProgress } from "../threads/run-progress"
import { sanitizeLoopState, type LoopState, type LoopStatus } from "./loop-state"
import type { ImpossibleReport, RouteSteer } from "./route-engine"
import { tierShortLabel, type AutopilotTier } from "../security/autopilot-tier"

export type LoopPhase =
  | "advancing"
  | "rerouting"
  | "awaiting_confirm"
  | "blocked"
  | "done"
  | "impossible"
  | "stopped"
  | "halt"

export type LoopStatusView = {
  phase: LoopPhase
  /** Always non-empty (#356 lesson: no silent empty state). */
  label: string
  detail: string
  done: number
  total: number
  /** Cruise tier short label at derivation time (deriveDisplayTier SoT). */
  tier: string
  /** LoopStatus at derivation time (backfill / re-arm affordances). */
  status: LoopStatus
}

const BLOCKER_CLASS_ZH: Record<string, string> = {
  "needs-human-confirm": "需要你确认",
  "needs-credential": "缺钥匙/登录",
  "external-wall": "外部阻断",
  "route-exhausted": "路线预算耗尽",
  "model-noncompliance": "模型两次无视换路指令",
}

export function blockerClassLabel(blockerClass: string): string {
  return BLOCKER_CLASS_ZH[blockerClass] ?? `受阻（${blockerClass}）`
}

const STOP_LABEL: Record<LoopStatus, string> = {
  active: "",
  paused: "已暂停（授权到期/确认风暴）",
  completed: "计划完成，待你确认",
  stopped_budget: "续跑预算已尽",
  stopped_user: "已停止续跑",
  halt_security: "安全熔断，未自动续跑",
  stopped_no_checklist: "受阻：无机器可核验清单",
}

/** Extension-side backfill for panel reopen: label from loop_state.status alone. */
export function loopStatusLabelFromStatus(status: LoopStatus): string {
  return STOP_LABEL[status] ?? "循环已结束"
}

function unlockKeys(report: ImpossibleReport): string {
  return report.items
    .map((it) => `${it.item_id}：${it.unlock.detail}`)
    .join("；")
    .slice(0, 400)
}

export type LoopStatusArgs = {
  loopState: LoopState | null
  runProgress: unknown
  pendingSteers: RouteSteer[]
  impossible: ImpossibleReport | null
  pendingConfirms: number
  tier: AutopilotTier
}

export function deriveLoopStatusView(args: LoopStatusArgs): LoopStatusView | null {
  const state = args.loopState
  if (!state) return null
  const items = evidenceItems(args.runProgress as RunProgress | null | undefined)
  const done = items.filter((it) => it.done === true).length
  const total = items.length
  const tier = tierShortLabel(args.tier)
  const base = { done, total, tier, status: state.status }

  // Terminal success first: machine-tier close — user confirmation pending.
  if (state.status === "completed") {
    return {
      ...base,
      phase: "done",
      label: STOP_LABEL.completed,
      detail: "机器核验：清单全勾·收口轮无工具调用。请复核后自行结束；如需返工直接说。",
    }
  }

  const impossible = args.impossible
  if (impossible && impossible.items.length > 0) {
    if (state.status === "active") {
      // Items blocked while the loop keeps pushing the rest.
      const first = impossible.items[0]!
      return {
        ...base,
        phase: "blocked",
        label: `受阻：${blockerClassLabel(first.blocker_class)}`,
        detail: `${impossible.items.length} 项受阻 · 解锁：${unlockKeys(impossible)}`,
      }
    }
    return {
      ...base,
      phase: "impossible",
      label: "无法完成：钥匙清单",
      detail: unlockKeys(impossible),
    }
  }

  if (state.status === "halt_security") {
    return { ...base, phase: "halt", label: STOP_LABEL.halt_security, detail: "安全/不可恢复错误触发熔断；处理后在设置里重启。" }
  }
  if (state.status !== "active") {
    const extra =
      state.status === "stopped_user"
        ? "重新续跑=显式手势（再说一次「持续做完」或点建议卡）。"
        : state.status === "stopped_budget"
          ? "从断点恢复=显式手势（点建议卡或再说一次「持续做完」）。"
          : ""
    return { ...base, phase: "stopped", label: STOP_LABEL[state.status], detail: extra }
  }

  // Active loop, by display priority.
  if (args.pendingConfirms > 0) {
    return { ...base, phase: "awaiting_confirm", label: "等待确认", detail: "循环被一个待确认操作挂起；确认或拒绝后继续。" }
  }
  if (args.pendingSteers.length > 0) {
    const target = args.pendingSteers[0]!.target
    return {
      ...base,
      phase: "rerouting",
      label: "换路中",
      detail: `CDP 已被机器封禁，下一轮改走${target === "host_computer" ? "host_computer（仍走既有 L2）" : target}；两次无视将申报受阻。`,
    }
  }
  return {
    ...base,
    phase: "advancing",
    label: `推进中 ${done}/${total}`,
    detail: total === 0 ? "已要求模型先提出清单。" : "",
  }
}

export type TaskLoopStatusFrame = {
  type: "task_loop.status"
  thread_id: string
  phase: LoopPhase
  label: string
  detail: string
  done: number
  total: number
  tier: string
  status: LoopStatus
}

export function buildTaskLoopStatusFrame(
  threadId: string,
  view: LoopStatusView,
): TaskLoopStatusFrame {
  return {
    type: "task_loop.status",
    thread_id: threadId,
    phase: view.phase,
    label: view.label,
    detail: view.detail,
    done: view.done,
    total: view.total,
    tier: view.tier,
    status: view.status,
  }
}

/** Derive from a raw thread record (sanitize inside — thread payload is disk-truth). */
export function loopStateFromThread(thread: { loop_state?: unknown } | null | undefined): LoopState | null {
  return sanitizeLoopState(thread?.loop_state)
}
