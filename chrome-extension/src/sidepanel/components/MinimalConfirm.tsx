// Panel content-split confirm (UI Mode P1/P2/R2) — tool + risk + allow/deny/stop + queue chrome.
// Heavy preview / nonce / whitelist live in Cockpit ConfirmElevated.
// Plan A: enterprise session-trust checkbox for shell/netsec when offered.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import type { SecurityConfirmationRequest } from "../types"
import { tokens, riskColorDark, riskLabel } from "../ui/tokens"
import { resolveStopTargetId } from "../utils/thread-busy"

/** Darker red ink for compact confirm on soft dangerSurface (~WCAG AA at 11px). */
const COMPACT_DANGER_INK = "#b91c1c"
const COMPACT_DANGER_BORDER = "#991b1b"

export function MinimalConfirm({ compact = false }: { compact?: boolean } = {}) {
  const { state, dispatch } = useAgentStore()
  const queue = state.pendingSecurityConfirmations
  const request = queue[0] as SecurityConfirmationRequest | undefined
  const denyBtnRef = useRef<HTMLButtonElement>(null)
  const activeThreadId = state.activeThreadId
  const [enterpriseTrust, setEnterpriseTrust] = useState(false)
  /** P1 CORR-04: block double-submit while waiting for companion resolved */
  const [respondingIds, setRespondingIds] = useState<Set<string>>(() => new Set())

  // Reset checkbox when queue head changes
  useEffect(() => {
    setEnterpriseTrust(false)
  }, [request?.confirmation_id])

  // Drop responding stamp when companion removes confirm
  useEffect(() => {
    const ids = new Set(queue.map((q) => q.confirmation_id))
    setRespondingIds((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (ids.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [queue])

  const respond = useCallback(
    (approved: boolean, stopThread = false) => {
      if (!request) return
      if (respondingIds.has(request.confirmation_id)) return
      const needsNonce = !!request.nonce_challenge
      if (approved && needsNonce) return
      // F-S1: stamp-first; multi-agent without worker_id → deny-safe (no wrong abort)
      const multiAgentContext = !!(
        request.worker_id ||
        request.orchestrator_run_id ||
        request.parent_thread_id
      )
      const stopTargetId = resolveStopTargetId({
        workerId: request.worker_id,
        activeThreadId,
        multiAgentContext,
      })
      // P1 CORR-04: do not optimistically REMOVE — wait for companion
      // security.confirmation.resolved. Local responding set blocks double-click;
      // Cockpit still races but companion origin/id single-flight no-ops second respond.
      setRespondingIds((prev) => new Set(prev).add(request.confirmation_id))
      chrome.runtime.sendMessage({
        type: "security.confirmation.response",
        confirmation_id: request.confirmation_id,
        approved,
        stop_thread: stopThread,
        add_to_whitelist: [],
        stop_thread_id: stopThread && stopTargetId ? stopTargetId : undefined,
        add_to_enterprise_session_trust:
          approved && !stopThread && enterpriseTrust && request.offer_enterprise_session_trust === true
            ? true
            : undefined,
      }, () => {
        if (chrome.runtime.lastError) {
          setRespondingIds((prev) => {
            const next = new Set(prev)
            next.delete(request.confirmation_id)
            return next
          })
        }
      })
      if (stopThread && stopTargetId) {
        chrome.runtime.sendMessage({
          type: "chat.abort",
          threadId: stopTargetId,
          thread_id: stopTargetId,
        })
        if (stopTargetId === activeThreadId) {
          dispatch({ type: "SET_STREAMING", content: "" })
          dispatch({ type: "SET_PROCESSING", isProcessing: false })
        }
      }
    },
    [request, activeThreadId, dispatch, enterpriseTrust, respondingIds],
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
  const multiAgentContext = !!(
    request.worker_id ||
    request.orchestrator_run_id ||
    request.parent_thread_id
  )
  const stopTargetId = resolveStopTargetId({
    workerId: request.worker_id,
    activeThreadId,
    multiAgentContext,
  })
  const queueLen = queue.length
  const queueTail = queue.slice(1, 4)
  const offerEnterprise = request.offer_enterprise_session_trust === true && !needsNonce
  const familyLabel =
    request.tool_name === "netsec_port_scan"
      ? "netsec 扫描"
      : request.tool_name === "shell_exec"
        ? "shell 命令"
        : "同类企业工具"

  // FocusBand compact (G3): soft danger surface — high-contrast actions, not solid red bar.
  // Dual-review nits: darker risk text (≥AA on tint), solid 停止 outline.
  if (compact) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "nowrap",
          padding: "6px 10px",
          background: "transparent",
          color: COMPACT_DANGER_INK,
          fontSize: 11,
          fontFamily: tokens.font,
          minHeight: 40,
          maxHeight: 56,
          overflow: "hidden",
        }}
        role="alertdialog"
        aria-label={`${label}确认 ${queueLen > 1 ? `1/${queueLen}` : ""}`}
        aria-modal="true"
      >
        <div
          style={{
            fontWeight: 700,
            letterSpacing: "0.01em",
            color: COMPACT_DANGER_INK,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11,
          }}
          title={
            workerLabel
              ? `${label} · ${request.tool_name} · ${workerLabel}`
              : `${label} · ${request.tool_name}`
          }
        >
          {label} ·{" "}
          <span style={{ fontFamily: tokens.fontMono, color: tokens.text }}>
            {request.tool_name}
          </span>
          {queueLen > 1 && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 10,
                fontWeight: 700,
                color: tokens.warning,
              }}
              title="确认队列（先处理队首）"
            >
              1/{queueLen}
            </span>
          )}
        </div>
        <button
          type="button"
          style={{
            ...btnCompact,
            background: needsNonce ? tokens.bgMuted : tokens.success,
            color: needsNonce ? tokens.textMuted : "#fff",
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
          style={{
            ...btnCompact,
            background: tokens.bgElevated,
            color: tokens.text,
            border: `1px solid ${tokens.borderStrong}`,
          }}
          onClick={() => respond(false)}
        >
          拒绝
        </button>
        <button
          type="button"
          style={{
            ...btnCompact,
            background: tokens.dangerSoft,
            color: COMPACT_DANGER_INK,
            border: `1px solid ${COMPACT_DANGER_BORDER}`,
          }}
          onClick={() => respond(false, true)}
          title={stopTargetId ? `停止 ${stopTargetId.slice(0, 8)}…` : "停止当前线程"}
        >
          停止
        </button>
        <button
          type="button"
          style={{
            ...btnCompact,
            background: "transparent",
            color: tokens.accentText,
            border: `1px solid ${tokens.borderStrong}`,
            fontWeight: 500,
          }}
          onClick={() => chrome.runtime.sendMessage({ type: "cockpit.open" })}
          title="打开确认台查看完整预览"
        >
          确认台
        </button>
      </div>
    )
  }

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
      {offerEnterprise && (
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            marginBottom: 8,
            fontSize: 10,
            color: tokens.darkText,
            cursor: "pointer",
            lineHeight: 1.4,
          }}
        >
          <input
            type="checkbox"
            checked={enterpriseTrust}
            onChange={(e) => setEnterpriseTrust(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            <strong>本线程内自动批准同类（{familyLabel}）</strong>
            <span style={{ color: tokens.darkMuted, display: "block" }}>
              仍受白名单/任务授权约束；30 分钟无人工批准或最长 8 小时或 Companion 重启后失效。默认不勾选。
            </span>
          </span>
        </label>
      )}
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

/** FocusBand single-row hit targets (min ~28px height for thumb-ish denser chrome). */
const btnCompact: CSSProperties = {
  padding: "4px 8px",
  borderRadius: tokens.radiusSm,
  border: "none",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
  fontFamily: tokens.font,
  flexShrink: 0,
  transition: `opacity ${tokens.transitionFast} ease`,
}
