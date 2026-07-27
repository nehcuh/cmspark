// Panel content-split confirm (UI Mode P1/P2/R2) — tool + risk + allow/deny/stop + queue chrome.
// Heavy preview / nonce / whitelist live in Cockpit ConfirmElevated.

import { useCallback, useEffect, useRef, type CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import type { SecurityConfirmationRequest } from "../types"
import { tokens, riskColorDark, riskLabel } from "../ui/tokens"

export function MinimalConfirm() {
  const { state, dispatch } = useAgentStore()
  const queue = state.pendingSecurityConfirmations
  const request = queue[0] as SecurityConfirmationRequest | undefined
  const denyBtnRef = useRef<HTMLButtonElement>(null)
  const activeThreadId = state.activeThreadId

  const respond = useCallback(
    (approved: boolean, stopThread = false) => {
      if (!request) return
      const needsNonce = !!request.nonce_challenge
      if (approved && needsNonce) return
      const stopTargetId = request.worker_id || activeThreadId
      chrome.runtime.sendMessage({
        type: "security.confirmation.response",
        confirmation_id: request.confirmation_id,
        approved,
        stop_thread: stopThread,
        add_to_whitelist: [],
        stop_thread_id: stopThread ? stopTargetId : undefined,
      })
      dispatch({ type: "REMOVE_SECURITY_CONFIRMATION", confirmationId: request.confirmation_id })
      if (stopThread && stopTargetId) {
        chrome.runtime.sendMessage({
          type: "chat.abort",
          threadId: stopTargetId,
          thread_id: stopTargetId,
        })
        if (stopTargetId === activeThreadId) {
          dispatch({ type: "SET_STREAMING", content: "" })
        }
      }
    },
    [request, activeThreadId, dispatch],
  )

  // R2: focus deny (safe default) when queue head changes
  useEffect(() => {
    if (!request) return
    const t = requestAnimationFrame(() => denyBtnRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [request?.confirmation_id])

  // R2: Escape → deny current head
  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        respond(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [request?.confirmation_id, respond])

  if (!request) return null

  const color = riskColorDark(request.risk_level)
  const label = riskLabel(request.risk_level)
  const needsNonce = !!request.nonce_challenge
  const workerLabel =
    request.worker_role_label ||
    (request.worker_id ? `worker ${request.worker_id.slice(0, 8)}` : null)
  const stopTargetId = request.worker_id || activeThreadId
  const queueLen = queue.length
  const queueTail = queue.slice(1, 4)

  return (
    <div
      style={{
        marginTop: 8,
        padding: 10,
        borderRadius: tokens.radiusMd,
        background: `linear-gradient(180deg, ${tokens.darkDangerBg} 0%, #2a1515 100%)`,
        border: "1px solid #7f1d1d",
        color: tokens.darkDanger,
        fontSize: 11,
        fontFamily: tokens.font,
      }}
      role="alertdialog"
      aria-label={`${label}确认 ${queueLen > 1 ? `1/${queueLen}` : ""}`}
      aria-modal="true"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, letterSpacing: "0.01em", color: color, flex: 1, minWidth: 0 }}>
          {label} ·{" "}
          <span style={{ fontFamily: tokens.fontMono, color: tokens.darkText }}>{request.tool_name}</span>
        </div>
        {queueLen > 1 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: tokens.darkWarning,
              background: tokens.darkWarningBg,
              padding: "2px 7px",
              borderRadius: tokens.radiusPill,
              flexShrink: 0,
            }}
            title="确认队列（先处理队首）"
          >
            1 / {queueLen}
          </span>
        )}
      </div>
      {workerLabel && (
        <div style={{ fontSize: 10, color: tokens.darkWarning, marginBottom: 4 }}>
          来自 <strong>{workerLabel}</strong>
          {typeof request.tab_id === "number" ? ` · tab ${request.tab_id}` : ""}
          {request.orchestrator_run_id
            ? ` · run ${request.orchestrator_run_id.slice(0, 8)}…`
            : ""}
        </div>
      )}
      <div style={{ color: tokens.darkMuted, marginBottom: 8, fontSize: 10, lineHeight: 1.45 }}>
        {needsNonce
          ? "此确认需要输入确认码 — 请在确认台完成。"
          : "详细预览与白名单在确认台；此处可快速允许或拒绝。"}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          style={{
            ...btn,
            background: needsNonce ? "#374151" : tokens.success,
            color: needsNonce ? tokens.darkMuted : "#fff",
            cursor: needsNonce ? "not-allowed" : "pointer",
          }}
          disabled={needsNonce}
          title={needsNonce ? "请在确认台输入确认码后允许" : "允许"}
          onClick={() => respond(true)}
        >
          允许
        </button>
        <button
          ref={denyBtnRef}
          type="button"
          style={{ ...btn, background: "#374151", color: tokens.darkText }}
          onClick={() => respond(false)}
        >
          拒绝
        </button>
        <button
          type="button"
          style={{
            ...btn,
            background: "transparent",
            color: tokens.darkDanger,
            border: "1px solid #7f1d1d",
          }}
          onClick={() => respond(false, true)}
          title={stopTargetId ? `停止 ${stopTargetId.slice(0, 8)}…` : "停止当前线程"}
        >
          拒绝并停止
        </button>
        <button
          type="button"
          style={{
            ...btn,
            background: "transparent",
            color: tokens.darkAccent,
            border: `1px solid ${tokens.darkBorder}`,
            fontWeight: 500,
          }}
          onClick={() => chrome.runtime.sendMessage({ type: "cockpit.open" })}
          title="打开确认台查看完整预览"
        >
          确认台
        </button>
      </div>
      {queueLen > 1 && (
        <div style={{ marginTop: 8, fontSize: 10, color: tokens.darkWarning, lineHeight: 1.4 }}>
          队列后续：
          {queueTail.map((q, i) => (
            <span key={q.confirmation_id}>
              {i > 0 ? " · " : " "}
              <span style={{ fontFamily: tokens.fontMono, color: tokens.darkMuted }}>{q.tool_name}</span>
            </span>
          ))}
          {queueLen > 4 ? ` · +${queueLen - 4}` : ""}
          <div style={{ marginTop: 2, color: tokens.darkMuted }}>Esc 拒绝当前 · 确认台可看完整预览</div>
        </div>
      )}
    </div>
  )
}

const btn: CSSProperties = {
  padding: "5px 10px",
  borderRadius: tokens.radiusSm,
  border: "none",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
  fontFamily: tokens.font,
  transition: `opacity ${tokens.transitionFast} ease`,
}
