import { useState } from "react"
import type { FleetWorkerView } from "../types"
import { tokens } from "../ui/tokens"

type Action = "wait" | "summarize" | "merge" | "dismiss"
type Followup = NonNullable<FleetWorkerView["followup"]>

export function FleetFollowupChoice({ threadId, followup }: { threadId: string; followup: Followup }) {
  const [sending, setSending] = useState(false)
  const { phase, offer_id, pending } = followup
  const text = {
    choose: pending ? `仍有 ${pending} 个子任务待回收。请选择报告生成时机。` : "子任务已结束，可以生成报告。",
    wait: pending ? `正在等待 ${pending} 个子任务。` : "正在汇总已收回的结果。",
    report: "正在生成报告。",
    merge: "收到晚到的子任务结果。是否合并到报告？",
    tracking: `仍在跟踪 ${pending} 个子任务。有新结果时会在这里提醒。`,
  }[phase]
  const actions: Array<[Action, string]> = []
  if (phase === "choose") actions.push(["wait", pending ? "继续等待" : "生成总结报告"])
  if ((phase === "choose" || phase === "wait") && pending) actions.push(["summarize", "先生成阶段报告"])
  if (phase === "merge") actions.push(["merge", "合并到报告"], ["dismiss", "暂不合并"])

  const choose = async (action: Action) => {
    if (!offer_id || sending) return
    setSending(true)
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "fleet.followup.choose", thread_id: threadId, offer_id, action, user_gesture: true,
      })
      if (reply?.ok !== true) throw new Error(reply?.error || "选项未发送，请重试。")
    } catch (error) {
      window.dispatchEvent(new CustomEvent("cmspark:toast", {
        detail: error instanceof Error ? error.message : "选项未发送，请重试。",
      }))
    } finally { setSending(false) }
  }

  return (
    <div style={{ padding: "8px 10px", border: `1px solid ${tokens.border}`, borderRadius: 8 }}>
      <div role="status">{text}</div>
      {offer_id && actions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {actions.map(([action, label]) => (
            <button key={action} type="button" disabled={sending} onClick={() => void choose(action)}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
