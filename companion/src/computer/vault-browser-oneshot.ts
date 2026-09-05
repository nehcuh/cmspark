// #360 (CU-B) — 浏览器 one-shot 禁 VLM：共享 seam 常量 + 确认疲劳观测仪器。
//
// 背景（FINAL-SYNTHESIS 票 B）：浏览器窗口的坐标化定位只走 L0 UIA → L1 OCR →
// 诚实 ELEMENT_NOT_FOUND；已登录浏览器帧的像素永不喂 Qwen3-VL / cloud stub。
// 判定本身挂在平台无关 seam 上（policy.ts isVaultBrowserEntry /
// isVaultBrowserAppToken —— 同时覆盖 WIN_BROWSER_VAULT_TOKENS 与
// MAC_BROWSER_VAULT_BUNDLE_IDS）；本模块只提供 reason 常量、触发原因清洗与
// capability-audit 计数（观测 one-shot L2 确认疲劳）。

import { appendCapabilityAudit } from "../packs/audit-log"
import { sanitizeComputerCaption } from "./preview"

/** L2/L3 在浏览器 one-shot 路径上的诚实 skipped reason（证据链 locateAttempts 可见）。 */
export const VAULT_BROWSER_NO_VLM_REASON = "vault-browser-no-vlm"

/** capability-audit 事件类型：每次浏览器 one-shot 任务级 L2 确认触发记一条。 */
export const VAULT_BROWSER_ONESHOT_L2_AUDIT_TYPE = "computer.vault_browser_oneshot_l2"

/** 触发原因长度上限（确认文案单行）。 */
const TRIGGER_REASON_MAX_CHARS = 200

/**
 * LLM 传入的 trigger_reason 是不可信文本：与 step caption 同一字符类清洗
 * （换行/控制符 → 空格，零宽/格式符删除），再截断上限。空结果 → undefined
 * （确认文案省略该行，绝不渲染原始串）。
 */
export function cleanVaultBrowserTriggerReason(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const cleaned = sanitizeComputerCaption(raw).slice(0, TRIGGER_REASON_MAX_CHARS).trim()
  return cleaned || undefined
}

/**
 * 记一条 one-shot L2 触发计数。appendCapabilityAudit 内部全 catch，这里再兜
 * 一层——审计仪器永远不能弄断确认门。
 */
export function recordVaultBrowserOneShotL2(
  fields: { toolCallId: string; app: string; platform: string; triggerReason?: string },
  filePath?: string,
): void {
  try {
    appendCapabilityAudit(
      {
        type: VAULT_BROWSER_ONESHOT_L2_AUDIT_TYPE,
        at: new Date().toISOString(),
        tool_call_id: fields.toolCallId,
        app: fields.app,
        platform: fields.platform,
        ...(fields.triggerReason ? { trigger_reason: fields.triggerReason } : {}),
      },
      filePath,
    )
  } catch {
    /* audit must never break the gate */
  }
}
