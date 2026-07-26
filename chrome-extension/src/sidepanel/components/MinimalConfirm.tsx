// Panel content-split confirm (UI Mode P1) — tool + risk + allow/deny/stop only.
// Heavy preview / nonce / whitelist live in Cockpit ConfirmElevated.

import { useRef } from "react"
import { useAgentStore } from "../store/agentStore"
import type { SecurityConfirmationRequest } from "../types"

function riskColor(level?: string): string {
  if (level === "low") return "#FFC107"
  if (level === "medium") return "#FF9800"
  return "#F44336"
}

function riskLabel(level?: string): string {
  if (level === "low") return "低风险"
  if (level === "medium") return "中风险"
  return "高风险"
}

export function MinimalConfirm() {
  const { state, dispatch } = useAgentStore()
  const request = state.pendingSecurityConfirmations[0] as SecurityConfirmationRequest | undefined
  const denyBtnRef = useRef<HTMLButtonElement>(null)

  if (!request) return null

  const color = riskColor(request.risk_level)
  const label = riskLabel(request.risk_level)
  // Nonce-gated confirms must use Cockpit (content-split) — Panel cannot type-verify
  const needsNonce = !!request.nonce_challenge

  const respond = (approved: boolean, stopThread = false) => {
    if (approved && needsNonce) return
    chrome.runtime.sendMessage({
      type: "security.confirmation.response",
      confirmation_id: request.confirmation_id,
      approved,
      stop_thread: stopThread,
      add_to_whitelist: [],
    })
    dispatch({ type: "REMOVE_SECURITY_CONFIRMATION", confirmationId: request.confirmation_id })
    if (stopThread) {
      chrome.runtime.sendMessage({ type: "chat.abort", threadId: state.activeThreadId })
      dispatch({ type: "SET_STREAMING", content: "" })
    }
  }

  return (
    <div
      style={{
        marginTop: 8,
        padding: 10,
        borderRadius: 8,
        background: "linear-gradient(180deg, #3b1f1f 0%, #2a1515 100%)",
        border: "1px solid #7f1d1d",
        color: "#fca5a5",
        fontSize: 11,
      }}
      role="alertdialog"
      aria-label={`${label}确认`}
    >
      <div style={{ fontWeight: 700, marginBottom: 4, letterSpacing: "0.01em" }}>
        {label} · <span style={{ fontFamily: "ui-monospace, monospace" }}>{request.tool_name}</span>
      </div>
      <div style={{ color: "#d1d5db", marginBottom: 8, fontSize: 10, lineHeight: 1.45 }}>
        {needsNonce
          ? "此确认需要输入确认码 — 请在操控台完成。"
          : "详细预览与白名单在操控台；此处可快速允许或拒绝。"}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          style={{
            ...btn,
            background: needsNonce ? "#374151" : "#16a34a",
            color: needsNonce ? "#9aa0a6" : "#fff",
            cursor: needsNonce ? "not-allowed" : "pointer",
          }}
          disabled={needsNonce}
          title={needsNonce ? "请在操控台输入确认码后允许" : "允许"}
          onClick={() => respond(true)}
        >
          允许
        </button>
        <button
          ref={denyBtnRef}
          type="button"
          style={{ ...btn, background: "#374151", color: "#e5e7eb" }}
          onClick={() => respond(false)}
        >
          拒绝
        </button>
        <button
          type="button"
          style={{ ...btn, background: "transparent", color: "#fca5a5", border: "1px solid #7f1d1d" }}
          onClick={() => respond(false, true)}
        >
          拒绝并停止
        </button>
        <button
          type="button"
          style={{
            ...btn,
            background: "transparent",
            color: "#93c5fd",
            border: "1px solid #2a2f3a",
            fontWeight: 500,
          }}
          onClick={() => chrome.runtime.sendMessage({ type: "cockpit.open" })}
        >
          详情
        </button>
      </div>
      <span style={{ display: "none", color }} aria-hidden />
    </div>
  )
}

const btn: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
}
