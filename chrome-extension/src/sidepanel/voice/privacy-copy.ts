/**
 * Path B privacy ack v2 copy (SoT §5.2 / ADR-023 §8.3).
 * Used by local-first privacy sheet (UI wires later). Pure constants — no DOM.
 */

/** Six required clauses for `voice_privacy_ack_v2` (local first start / browser→local). */
export const VOICE_PRIVACY_ACK_V2_CLAUSES: readonly string[] = [
  "音频经本机 Companion 写入临时文件，由本机识别后填入草稿，识别后删除临时音频。",
  "默认不自动发送；文字与键入相同，仍受现有确认与信任设置约束。",
  "模型需用户显式下载（HTTPS + 校验）。",
  "不保证 OS 交换区、崩溃转储等零痕迹。",
  "浏览器听写仍可能使用厂商云端服务。",
  "此前的浏览器隐私确认（v1）不满足本机转写；使用本机转写须单独确认本说明。",
] as const

/** Joined sheet body for local privacy ack (paragraph form). */
export const VOICE_PRIVACY_ACK_V2_BODY = VOICE_PRIVACY_ACK_V2_CLAUSES.join("\n")

/** Storage key for chrome.storage.local (lock-step with agentStore). */
export const VOICE_PRIVACY_ACK_V2_STORAGE_KEY = "voice_privacy_ack_v2" as const
