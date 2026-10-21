import type { SettingsSectionId } from "./settings-sections"
export interface SemanticChange {
  id: string; settingId: string; label: string; before: boolean | number | string; after: boolean | number | string; reason: string
  scope: "companion" | "manual"; section: SettingsSectionId; destination?: "activity" | "todos"; prerequisites: string[]
}
export interface SemanticProposal {
  id: string; expiresAt: number; intent: string; clarification?: string
  candidates: { id: string; title: string; reason: string; tradeoffs: string; changes: SemanticChange[] }[]
}
export interface SemanticReceiptItem { settingId: string; label: string; status: "saved" | "failed" | "manual"; actual?: boolean | number | string; message: string; section: SettingsSectionId; destination?: "activity" | "todos" }
export interface SemanticReply { type: "settings.assistant.proposal" | "settings.assistant.receipt"; proposal?: SemanticProposal; proposalId?: string; items?: SemanticReceiptItem[] }
/** Matching Companion frame completes this request. Service-worker ACK only confirms transport. */
export function requestSemanticSettings(type: "settings.assistant.propose" | "settings.assistant.apply", fields: Record<string, unknown>, signal: AbortSignal): Promise<SemanticReply> {
  return new Promise((resolve, reject) => {
    const id = "settings-assistant-" + crypto.randomUUID()
    let settled = false, timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error, value?: SemanticReply) => {
      if (settled) return
      settled = true; clearTimeout(timer); chrome.runtime.onMessage.removeListener(receive); signal.removeEventListener("abort", cancel)
      if (error) reject(error); else resolve(value!)
    }
    const cancel = () => finish(new Error(type === "settings.assistant.apply" ? "操作已离开；已提交的设置请到原入口核对，不会自动重试。" : "已取消理解，输入已保留。"))
    const receive = (message: any) => {
      if (message?.id !== id) return
      if (message.type === "settings.assistant.error" || message.type === "error") finish(new Error(message.error || "设置请求失败，请核对当前状态。"))
      else if (type === "settings.assistant.propose" && message.type === "settings.assistant.proposal" && message.proposal && Array.isArray(message.proposal.candidates)) finish(undefined, message)
      else if (type === "settings.assistant.apply" && message.type === "settings.assistant.receipt" && message.proposalId === fields.proposalId && Array.isArray(message.items)) finish(undefined, message)
    }
    if (signal.aborted) { cancel(); return }
    chrome.runtime.onMessage.addListener(receive); signal.addEventListener("abort", cancel, { once: true })
    timer = setTimeout(() => finish(new Error(type === "settings.assistant.apply" ? "尚未收到保存回执。请核对原设置，不会自动重试。" : "模型暂未返回可靠候选，输入已保留；可直接浏览设置。")), 40_000)
    try { Promise.resolve(chrome.runtime.sendMessage({ type, ...fields, id })).then(ack => {
      if (ack?.ok === false) finish(new Error(ack.error || "Companion 未连接，输入与候选已保留。"))
    }).catch(() => finish(new Error("连接中断，请核对当前状态。"))) } catch { finish(new Error("连接不可用，请核对当前状态。")) }
  })
}
export function semanticValue(value: boolean | number | string): string {
  if (typeof value === "boolean") return value ? "开启" : "关闭"
  const labels: Record<string, string> = { continuous: "连续听写", classic: "经典短听", local: "本机识别", browser: "浏览器识别", review: "打开并核对", pause: "暂停采集（需确认）", localOnly: "仅本机处理（需核对模型）" }
  return labels[String(value)] || String(value)
}
