// 坐标 computer-use(WP4)— 纯 UI 逻辑 helpers。
// reducer 折叠逻辑抽成纯函数,node:test 无需挂载 React 即可覆盖状态机
// (apps-utils.ts / sidepanel-state.test.ts 既定先例)。

import type {
  AppEntry,
  ComputerStepView,
  ComputerTaskEventView,
  ComputerTaskState,
} from "../types"

/** 时间线默认保留最近 30 步。 */
export const COMPUTER_TIMELINE_MAX_STEPS = 30
/** 时间线内预览图总字节上限(base64 解码后估算)——超过先丢旧图保文字行。 */
export const COMPUTER_TIMELINE_MAX_IMAGE_BYTES = 4 * 1024 * 1024
/** 单张预览图渲染守卫:超过 300KB(base64 解码后估算)拒渲染。 */
export const PREVIEW_IMAGE_MAX_BYTES = 300 * 1024

/** base64 字符串的解码后字节数估算(不真正解码)。 */
function base64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4)
}

/**
 * 预览图渲染守卫:仅接受非空 string 且估算字节 ≤300KB。
 * 服务端另有 ≤200KB too_large 兜底,扩展侧是双保险(计划「预览图体积双保险」)。
 */
export function previewImageSafe(b64: unknown): b64 is string {
  return typeof b64 === "string" && b64.length > 0 && base64Bytes(b64) <= PREVIEW_IMAGE_MAX_BYTES
}

/**
 * 时间线截断:只保留最近 maxSteps 步;预览图总字节超限时从最旧的图开始丢,
 * 文字行(caption/layer/坐标等)始终保留(计划「先丢旧图保文字行」)。
 */
export function capTimeline(
  steps: ComputerStepView[],
  maxSteps: number = COMPUTER_TIMELINE_MAX_STEPS,
  maxImageBytes: number = COMPUTER_TIMELINE_MAX_IMAGE_BYTES,
): ComputerStepView[] {
  let out = steps.length > maxSteps ? steps.slice(steps.length - maxSteps) : steps.slice()
  const totalImageBytes = () =>
    out.reduce((sum, s) => sum + (typeof s.previewImage === "string" ? base64Bytes(s.previewImage) : 0), 0)
  while (totalImageBytes() > maxImageBytes) {
    const idx = out.findIndex(s => typeof s.previewImage === "string")
    if (idx < 0) break
    out = [...out.slice(0, idx), { ...out[idx], previewImage: undefined }, ...out.slice(idx + 1)]
  }
  return out
}

/**
 * computer.task.event 折叠状态机(WP4 WI-1)。
 *
 * 事件是无来源绑定、无序号的广播;面板可能迟连错过 started,或任务完结后仍有
 * 迟到事件。迁移规则:
 *  - started:总是以负载重置任务状态(新任务取代旧任务;重复 started = 重置)。
 *  - step:同 taskId 且未完结 → 追加(paused → running 视为恢复);同 taskId
 *    已完结 → 丢弃(finished 后迟到);未知 taskId → 懒创建「恢复同步」状态
 *    (P4:急停按钮的存在性优先于事件流整洁性——面板迟连时首个 step 就必须
 *    让任务条出现;同理,当前任务已完结后来自下一任务的 step 也懒创建)。
 *  - paused:同 taskId 未完结 → 置 paused 并记原因;未知 taskId → 懒创建并置
 *    paused;完结后迟到 → 丢弃。
 *  - finished:同 taskId → 合并结果置 finished(幂等);未知 taskId → 丢弃
 *    (从未跟踪的任务完结无需展示)。
 */
export function reduceComputerTaskEvent(
  state: ComputerTaskState | null,
  ev: ComputerTaskEventView,
  now: number = Date.now(),
): ComputerTaskState | null {
  if (!ev || typeof ev !== "object") return state
  if (typeof ev.taskId !== "string" || !ev.taskId) return state
  const sameTask = state !== null && state.taskId === ev.taskId

  switch (ev.event) {
    case "started":
      return {
        taskId: ev.taskId,
        app: ev.app,
        task: ev.task,
        total: ev.total,
        budget: ev.budget,
        status: "running",
        resyncing: false,
        steps: [],
        abortAcked: false,
      }

    case "step": {
      const step: ComputerStepView = {
        seq: typeof ev.seq === "number" ? ev.seq : 0,
        action: ev.action,
        caption: ev.caption,
        x: ev.x,
        y: ev.y,
        budgetLeft: ev.budgetLeft,
        previewImage: typeof ev.previewImage === "string" ? ev.previewImage : undefined,
        layer: ev.layer,
        confidence: ev.confidence,
        durationMs: ev.durationMs,
        locateAttempts: Array.isArray(ev.locateAttempts) ? ev.locateAttempts : undefined,
        crossverified: ev.crossverified,
        crossverifyChannel: ev.crossverifyChannel,
      }
      if (sameTask && state.status !== "finished") {
        return { ...state, status: "running", steps: capTimeline([...state.steps, step]) }
      }
      if (sameTask) return state
      // P4 懒创建:未知 taskId 的 step(面板迟连错过 started / 下一任务的首见事件)。
      return {
        taskId: ev.taskId,
        status: "running",
        resyncing: true,
        steps: capTimeline([step]),
        abortAcked: false,
      }
    }

    case "paused": {
      if (sameTask && state.status !== "finished") {
        return { ...state, status: "paused", pauseReason: ev.reason }
      }
      if (sameTask) return state
      // P4 懒创建:未知 taskId 的 paused。
      return {
        taskId: ev.taskId,
        status: "paused",
        pauseReason: ev.reason,
        resyncing: true,
        steps: [],
        abortAcked: false,
      }
    }

    case "finished": {
      if (!sameTask) return state
      if (state.status === "finished") return state
      return {
        ...state,
        status: "finished",
        ok: ev.ok,
        completed: ev.completed,
        errorCode: ev.errorCode,
        evidenceDir: ev.evidenceDir,
        finishedAt: now,
      }
    }

    default:
      return state
  }
}

/**
 * 证据目录 taskId 校验(镜像 companion evidence.ts 的清洗规则
 * ^[a-zA-Z0-9_-]+$)——「打开证据目录」按钮发送前必过,路径解析全在 companion。
 */
export function isValidEvidenceTaskId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id)
}

export interface UiaCapableBadge {
  label: string
  color: string
  bg: string
  title: string
}

/**
 * uiaCapable 三态徽标(WP4 WI-6)——中性能力措辞,绝不渲染成安全背书
 * (WP3 §K.5:uiaCapable 是非权限位的探测提示):
 *  - true → 「UIA」蓝
 *  - false → 「OCR」灰(title 说明 UIA 不可用、走 OCR 定位)
 *  - undefined → 「未探测」点灰(title 说明首次坐标任务时自动探测)
 * uiaCapable 有值但 uiaProbedAt 缺失 = 人工在 config.json 手设 → title 追加「人工设定」。
 */
export function uiaCapableBadge(
  entry: Pick<AppEntry, "uiaCapable" | "uiaProbedAt">,
): UiaCapableBadge {
  const manualSuffix = entry.uiaCapable !== undefined && !entry.uiaProbedAt ? "（人工设定）" : ""
  if (entry.uiaCapable === true) {
    return {
      label: "UIA",
      color: "#1d4ed8",
      bg: "#dbeafe",
      title: `支持 UIA 精确定位（能力提示，非安全背书）${manualSuffix}`,
    }
  }
  if (entry.uiaCapable === false) {
    return {
      label: "OCR",
      color: "#4b5563",
      bg: "#e5e7eb",
      title: `UIA 不可用，走 OCR 定位（能力提示，非安全背书）${manualSuffix}`,
    }
  }
  return {
    label: "未探测",
    color: "#9ca3af",
    bg: "#f3f4f6",
    title: "首次坐标任务时自动探测（能力提示，非安全背书）",
  }
}
