// WP5-I4 WI-4.4 — 设置页「实验功能」段纯逻辑（组件纯渲染，逻辑全抽本模块；
// apps-utils.ts / computer-utils.ts 先例：node:test 直接驱动，不挂 React）。
//
// 文案纪律（单一真源）：
//   - MODEL_STATE_MESSAGES / MODEL_SWITCH_COPY 逐字镜像自
//     companion/src/computer/model-state-messages.ts——companion 是唯一真源，
//     本表为只读镜像；改动必须先改 companion 并同步本表（两侧文案断言测试互锁：
//     companion computer-model-states.test.ts ↔ 本仓 model-switch-logic.test.ts）。
//   - 许可证门全文不走镜像——渲染 license_required 载荷原文（扩展不复制不私编）。
//   - reason 词表即协议（computer.model.state 的 error 字段），文案只许从本表取。

import type {
  ComputerModelLicenseDoor,
  ComputerModelProgress,
  ComputerModelState,
  ComputerTaskState,
} from "../types"

// --- 逐字镜像：companion model-state-messages.ts（改动须先改 companion 并同步） ------

export interface ModelStateMessage {
  /** 状态行/通知标题（短句） */
  title: string
  /** 详情说明（含对其他定位层无影响的明示） */
  detail: string
  /** 建议动作按钮文案；null = 无动作（仅告知） */
  action: string | null
}

export const MODEL_STATE_MESSAGES: Record<string, ModelStateMessage> = {
  "model-file-missing": {
    title: "模型文件缺失",
    detail:
      "TinyClick 模型未下载或已被删除。UIA / OCR / 用户框选定位不受影响；" +
      "在设置页下载模型后可启用本实验层。",
    action: "下载模型",
  },
  "model-hash-mismatch": {
    title: "模型文件校验失败",
    detail:
      "模型文件与登记 sha256 不一致（可能被篡改或损坏），已拒绝加载。" +
      "UIA / OCR / 用户框选定位不受影响；请删除后重新下载。",
    action: "删除并重新下载",
  },
  "network-error": {
    title: "模型下载失败",
    detail:
      "网络错误导致下载中断（断点已保留，重试可续传）。已自动降级，" +
      "UIA / OCR / 云端定位不受影响。",
    action: "重试下载",
  },
  "model-unknown": {
    title: "模型未登记",
    detail: "manifest 中不存在该模型条目（发版内容异常）。其余定位层不受影响。",
    action: null,
  },
  "variant-unknown": {
    title: "模型变体未登记",
    detail: "manifest 中不存在该交付变体（发版内容异常）。其余定位层不受影响。",
    action: null,
  },
  "mirror-scheme-denied": {
    title: "镜像地址被拒绝",
    detail:
      "computer.modelMirror 仅允许 https 主机（file:// / UNC 本地替换面已关闭）。" +
      "请检查设置后重试；其余定位层不受影响。",
    action: "检查镜像设置",
  },
  "disk-budget-exceeded": {
    title: "磁盘预算超限",
    detail:
      "模型根目录占用（全部变体合计）将超过预算（computer.modelDiskBudgetMB，默认 2048MB）。" +
      "可调大预算或删除其他变体后重试；其余定位层不受影响。",
    action: "调整磁盘预算",
  },
  "disk-full": {
    title: "磁盘空间不足",
    detail: "目标卷剩余空间不足以下载模型文件。请释放磁盘空间后重试；其余定位层不受影响。",
    action: null,
  },
  "http-error": {
    title: "模型下载失败",
    detail:
      "模型服务器返回异常状态。若使用镜像，请检查镜像可用性；其余定位层不受影响，可稍后重试。",
    action: "重试下载",
  },
  "size-mismatch": {
    title: "模型文件大小异常",
    detail:
      "下载完成的文件大小与登记不符（分发链异常），已删除并拒绝使用。" +
      "其余定位层不受影响；请重试下载，复现请向项目反馈。",
    action: "重试下载",
  },
  "hash-mismatch": {
    title: "模型文件校验失败",
    detail:
      "下载完成的文件 sha256 与登记不符（分片级篡改或分发链异常），已删除分片并拒绝使用。" +
      "其余定位层不受影响；请重试下载，复现请向项目反馈。",
    action: "重试下载",
  },
  "oversize-stream": {
    title: "模型下载数据异常",
    detail:
      "下载源吐出的字节超过登记大小（分发链异常或镜像不可信），已在传输中途截断并清理。" +
      "其余定位层不受影响；请检查镜像设置后重试，复现请向项目反馈。",
    action: "重试下载",
  },
  "model-size-mismatch": {
    title: "模型文件大小异常",
    detail: "磁盘上的模型文件大小与登记不符，已拒绝加载。请删除后重新下载；其余定位层不受影响。",
    action: "删除并重新下载",
  },
  "manifest-invalid": {
    title: "模型登记信息损坏",
    detail: "models.manifest.json 未通过 schema 校验（发版内容异常）。其余定位层不受影响。",
    action: null,
  },
  "manifest-source-remote": {
    title: "模型登记来源被拒绝",
    detail:
      "模型 manifest 只接受随发版的本地文件（运行时网络更新 manifest 的通道已关闭）。" +
      "其余定位层不受影响。",
    action: null,
  },
  "download-host-unset": {
    title: "模型发布地址未配置",
    detail:
      "模型发布地址尚未配置（发布链 owner 决策中）——当前构建不可下载模型。" +
      "UIA / OCR / 用户框选定位不受影响。",
    action: null,
  },
  "model-variant-missing": {
    title: "当前变体未下载",
    detail:
      "当前配置交付变体的模型文件未下载或不完整。下载当前变体后方可启用实验层；" +
      "UIA / OCR / 用户框选定位不受影响。",
    action: "下载当前变体",
  },
  "circuit-breaker": {
    title: "模型层已熔断停用",
    detail:
      "模型层连续故障达到熔断阈值，已自动停用（无自动恢复）。UIA / OCR / 用户框选定位" +
      "不受影响；排查后可在设置页重置熔断。",
    action: "重置熔断",
  },
}

/** 取 reason 对应文案；未知 reason 给兜底（词表外新码不应让 UI 崩溃）。 */
export function modelStateMessage(reason: string): ModelStateMessage {
  return (
    MODEL_STATE_MESSAGES[reason] ?? {
      title: "模型层不可用",
      detail: `未登记的原因（${reason}）。其余定位层不受影响。`,
      action: null,
    }
  )
}

export interface ModelSwitchCopy {
  switchLabel: string
  switchHint: string
  masterOffHint: string
  appNotAllowedHint: string
  layerSemantics: string
  licenseDoorHint: string
  firstLoadTimeline: string
  switchRunningNote: string
  statusReadyEnabled: string
  statusReadyDisabled: string
  downloadInProgress: string
  licenseDeclinedNotice: string
}

export const MODEL_SWITCH_COPY: ModelSwitchCopy = {
  switchLabel: "实验层：TinyClick 本地视觉定位",
  switchHint:
    "默认关闭。开启后仅作为定位链第 2 层（L2）的坐标候选建议；" +
    "命中在执行前仍会弹出人工确认。",
  masterOffHint: "主开关（computer.use）已关闭——实验层不参与任何定位。",
  appNotAllowedHint:
    "当前应用未加入允许列表（coordinateAllowed）——实验层对该应用不参与定位。",
  // P2 修订镜像：per-task 生效语义 + estop 引导（companion 侧断言互锁）。
  layerSemantics:
    "本层是定位链的实验性建议层（L2）：模型输出仅作为坐标候选，" +
    "任何点击执行前必经人工确认；本层未校准，可能完全错误。" +
    "关闭开关按任务粒度生效——任务运行中关闭将于当前任务结束后生效；" +
    "若需立即停止（含当前任务），请按 Ctrl+Alt+End 急停或中止当前任务。" +
    "拒绝建议或关闭本层后，UIA / OCR / 用户框选兜底不受影响。",
  licenseDoorHint:
    "首次开启需阅读并接受模型许可证与研究品免责声明；" +
    "拒绝则本实验层永久跳过，其余定位层不受影响。",
  firstLoadTimeline:
    "模型首次加载最长约 35 秒（超时自动降级，且不计入故障熔断）；" +
    "加载期间 UIA / OCR / 用户框选定位不受影响。",
  switchRunningNote:
    "当前有任务正在运行——开关变更将于当前任务结束后生效；" +
    "立即停止请按 Ctrl+Alt+End 急停或中止任务。",
  statusReadyEnabled:
    "实验层已开启，模型就绪。任务执行中每个模型建议在点击前仍需人工确认。",
  statusReadyDisabled: "模型已下载就绪——实验层未开启。",
  downloadInProgress: "模型下载中",
  licenseDeclinedNotice:
    "你已拒绝实验层许可证——本层永久跳过，其余定位层不受影响。" +
    "（复位路径 = 手动编辑 config.json，属显式 owner opt-in。）",
}

// --- 纯函数判定 -------------------------------------------------------------------

/** 状态行视图（组件只渲染，不组文案）。 */
export interface ModelStatusLineView {
  kind: "loading" | "ok" | "info" | "error"
  /** 主文本（标题级） */
  text: string
  /** 详情（error 态来自 MODEL_STATE_MESSAGES.detail） */
  detail?: string
  /** 建议动作文案（error 态来自词表；null=无动作） */
  action?: string | null
}

/**
 * 状态行文案选择：state × progress → 状态行视图。
 *   state=null → loading；error(reason) → 词表；absent → 词表 model-file-missing；
 *   downloading → 百分比文本；disabled → 词表 circuit-breaker；ready → 就绪双态。
 */
export function modelStatusLine(
  modelState: ComputerModelState | null,
  progress: ComputerModelProgress | null,
): ModelStatusLineView {
  if (modelState === null) {
    return { kind: "loading", text: "模型状态查询中…" }
  }
  if (modelState.error) {
    const m = modelStateMessage(modelState.error)
    return { kind: "error", text: m.title, detail: m.detail, action: m.action }
  }
  switch (modelState.modelStatus) {
    case "absent": {
      const m = modelStateMessage("model-file-missing")
      return { kind: "error", text: m.title, detail: m.detail, action: m.action }
    }
    case "downloading": {
      const pct = downloadPercent(progress)
      return {
        kind: "info",
        text:
          pct === null
            ? `${MODEL_SWITCH_COPY.downloadInProgress}…`
            : `${MODEL_SWITCH_COPY.downloadInProgress}…${pct}%（${progress!.file}）`,
      }
    }
    case "disabled": {
      const m = modelStateMessage("circuit-breaker")
      return { kind: "error", text: m.title, detail: m.detail, action: m.action }
    }
    case "ready":
      return {
        kind: "ok",
        text: modelState.modelEnabled
          ? MODEL_SWITCH_COPY.statusReadyEnabled
          : MODEL_SWITCH_COPY.statusReadyDisabled,
      }
    default:
      return { kind: "info", text: modelStateMessage(modelState.modelStatus).title }
  }
}

/**
 * 三层依赖提示优先级：masterOffHint > appNotAllowedHint > null（显示本体
 * layerSemantics）。输入为 null = 该层状态未知（不判该层）。
 */
export function modelSwitchHint(args: {
  masterEnabled: boolean | null
  appCoordinateAllowed: boolean | null
}): string | null {
  if (args.masterEnabled === false) return MODEL_SWITCH_COPY.masterOffHint
  if (args.appCoordinateAllowed === false) return MODEL_SWITCH_COPY.appNotAllowedHint
  return null
}

/** 许可证门触发条件：license_required 载荷到达（非 null）即弹门。 */
export function licenseDoorShouldOpen(door: ComputerModelLicenseDoor | null): boolean {
  return door !== null
}

/**
 * 开关禁用原因（组件据此禁用开关行）：
 *   许可证已拒绝 → 永久跳过提示（裁决 2，无 UI 复位）；其余 → null（可拨动）。
 */
export function modelSwitchDisabledReason(modelState: ComputerModelState | null): string | null {
  if (modelState?.modelLicenseDeclined === true) return MODEL_SWITCH_COPY.licenseDeclinedNotice
  return null
}

/** 下载百分比（0-100；totalBytes<=0 或 progress=null → null 不显示数字）。 */
export function downloadPercent(progress: ComputerModelProgress | null): number | null {
  if (!progress || !(progress.totalBytes > 0)) return null
  const pct = Math.floor((progress.receivedBytes / progress.totalBytes) * 100)
  return Math.max(0, Math.min(100, pct))
}

/**
 * P2 任务运行中旁注判定：有活动 computer 任务（running/paused）拨动开关时
 * 显示「当前任务结束后生效」+ estop 引导；无任务/已完结 → null。
 */
export function modelSwitchRunningNote(task: ComputerTaskState | null): string | null {
  if (!task) return null
  if (task.status === "running" || task.status === "paused") {
    return MODEL_SWITCH_COPY.switchRunningNote
  }
  return null
}

/**
 * computer.model.* 错误路由守卫（family:"computer.model"——apps family:"apps"
 * 先例）：命中 → 设置页实验区错误位；否则交回通用流（chat）。仅认 family，不用
 * code 回退集——BIOMETRIC_DENIED 等共享 code 在 apps/computer 流间不可分，
 * family 是唯一无歧义路由键（model-handlers.ts modelError 注释）。
 */
export function isComputerModelErrorMessage(msg: { family?: unknown }): boolean {
  if (!msg || typeof msg !== "object") return false
  return msg.family === "computer.model"
}
