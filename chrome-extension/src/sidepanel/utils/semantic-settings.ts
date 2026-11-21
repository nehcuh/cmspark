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

export type KnowledgeScopePreview = { id: string; mode: "auto" | "all" | "manual"; selected: string[] }

export function sameKnowledgeScope(a: KnowledgeScopePreview, b?: KnowledgeScopePreview): boolean {
  return a.id === b?.id && a.mode === b.mode && a.selected.length === b.selected.length &&
    JSON.stringify([...a.selected].sort()) === JSON.stringify([...b.selected].sort())
}

/** A websocket receipt with the saved thread is required; a forwarding ACK is insufficient. */
export function applyManualKnowledge(scope: KnowledgeScopePreview, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = "settings-knowledge-" + crypto.randomUUID()
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (message?: string) => {
      clearTimeout(timer)
      chrome.runtime.onMessage.removeListener(receive)
      signal.removeEventListener("abort", cancel)
      if (message) reject(new Error(message)); else resolve()
    }
    const cancel = () => finish("已退出修改，请到原对话核对是否保存。")
    const receive = (message: any) => {
      if (message?.id !== id) return
      if (message.type === "error") {
        finish(message.code === "STALE_KNOWLEDGE_SCOPE" ? "知识范围已变化，请重新预览。" : "未能确认保存，请到原对话核对。")
      } else if (message.type === "thread.updated") {
        finish(sameKnowledgeScope({ ...scope, mode: "manual" }, { id: message.thread?.id, mode: message.thread?.knowledge_selection_mode, selected: message.thread?.active_knowledge_ids ?? [] })
          ? undefined : "未能确认保存，请到原对话核对。")
      }
    }
    if (signal.aborted) { cancel(); return }
    chrome.runtime.onMessage.addListener(receive)
    signal.addEventListener("abort", cancel, { once: true })
    timer = setTimeout(() => finish("未收到保存回执，请到原对话核对。"), 10_000)
    try {
      chrome.runtime.sendMessage({ type: "thread.update", id, threadId: scope.id, require_connected: true,
        updates: { knowledge_selection_mode: "manual" },
        expected_knowledge_scope: { mode: scope.mode, selected: scope.selected },
      }).then(ack => { if (ack?.ok === false) finish("未发送，请检查 Companion 连接。") }, () => finish("连接中断，请到原对话核对。"))
    } catch { finish("连接不可用。") }
  })
}
