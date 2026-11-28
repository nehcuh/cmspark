import { modelStateMessage } from "../../shared/computer/model-state-messages"
import {
  isQwenVlVariant, QWEN_VL_DEFAULT_VARIANT, QWEN_VL_VARIANTS, qwenVlMeta, type QwenVlVariant,
} from "../../shared/computer/qwen-vl-catalog"
export { MODEL_STATE_MESSAGES, modelStateMessage, type ModelStateMessage } from "../../shared/computer/model-state-messages"

import type {
  ComputerModelLicenseDoor,
  ComputerModelProgress,
  ComputerModelState,
} from "../types"

// Short labels and tooltips for the settings buttons.
const compactTips: Record<QwenVlVariant, [string, string]> = {
  "2b": ["默认推荐。", "CPU 可跑但较慢。"],
  "4b": ["更强。", ""],
  "8b": ["最强本机档。", "资源不足会极慢或 OOM。"],
}

export const QWEN_VL_VARIANT_TIPS = Object.fromEntries(QWEN_VL_VARIANTS.map(variant => {
  const { downloadGb, minRamGb, minVramGb } = qwenVlMeta(variant)
  const [intro, detail] = compactTips[variant]
  const label = variant.toUpperCase() + (variant === QWEN_VL_DEFAULT_VARIANT ? "（默认）" : "")
  const tip = `${intro}流畅：统一内存/系统内存 ≥${minRamGb}GB，或独显 ≥${minVramGb}GB。${detail}`
  return [variant, { label, downloadGb, minRamGb, minVramGb, tip }] as const
}))

export function variantResourceTip(variant: string | undefined): string {
  const v = isQwenVlVariant(variant) ? variant : QWEN_VL_DEFAULT_VARIANT
  const m = QWEN_VL_VARIANT_TIPS[v]!
  return `${m.tip}（约下载 ${m.downloadGb}GB · 建议内存 ≥${m.minRamGb}GB / 显存 ≥${m.minVramGb}GB）`
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
            ? `模型下载中…`
            : `模型下载中…${pct}%（${progress!.file}）`,
      }
    }
    case "disabled": {
      const m = modelStateMessage("circuit-breaker")
      return { kind: "error", text: m.title, detail: m.detail, action: m.action }
    }
    case "ready":
      return {
        kind: "ok",
        text: "工作中心本机模型已下载就绪。",
      }
    default:
      return { kind: "info", text: modelStateMessage(modelState.modelStatus).title }
  }
}

/** 许可证门触发条件：license_required 载荷到达（非 null）即弹门。 */
export function licenseDoorShouldOpen(door: ComputerModelLicenseDoor | null): boolean {
  return door !== null
}

/** 下载百分比（0-100；totalBytes<=0 或 progress=null → null 不显示数字）。 */
export function downloadPercent(progress: ComputerModelProgress | null): number | null {
  if (!progress || !(progress.totalBytes > 0)) return null
  const pct = Math.floor((progress.receivedBytes / progress.totalBytes) * 100)
  return Math.max(0, Math.min(100, pct))
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
