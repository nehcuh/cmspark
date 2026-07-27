// CMspark Cockpit — L2 Computer Use surface (UI Mode P1)
// Spec dual-track + confirm elevation. Shares agentStore via useWebSocket broadcast.

import { useEffect, useState, type CSSProperties } from "react"
import { AgentStoreProvider, useAgentStore } from "../sidepanel/store/agentStore"
import { useWebSocket } from "../sidepanel/hooks/useWebSocket"
import { previewImageSafe } from "../sidepanel/utils/computer-utils"
import {
  canOfferComputerSessionTrust,
  canOfferThreadTrust,
  computerSessionTrustHint,
  threadTrustHint,
} from "../sidepanel/utils/apps-utils"
import type { ComputerStepView, SecurityConfirmationRequest } from "../sidepanel/types"
import { tokens } from "../sidepanel/ui/tokens"

export function CockpitRoot() {
  return (
    <AgentStoreProvider>
      <CockpitBoot />
    </AgentStoreProvider>
  )
}

function CockpitBoot() {
  const { dispatch } = useAgentStore()
  useWebSocket()
  useEffect(() => {
    const port = chrome.runtime.connect({ name: "cmspark-cockpit" })
    // Hydrate mid-task open: SW mirror of computerTask + pending confirms
    chrome.runtime.sendMessage({ type: "cockpit.hydrate" }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) return
      if (res.computerTask !== undefined) {
        dispatch({ type: "HYDRATE_COMPUTER_TASK", task: res.computerTask })
      }
      if (Array.isArray(res.pendingConfirmations)) {
        dispatch({
          type: "HYDRATE_SECURITY_CONFIRMATIONS",
          requests: res.pendingConfirmations,
        })
      }
    })
    return () => {
      try {
        port.disconnect()
      } catch {
        /* ignore */
      }
    }
  }, [dispatch])
  return <CockpitApp />
}

function CockpitApp() {
  // useWebSocket is mounted once in CockpitBoot — only read store here.
  // Confirm focus is background-driven (openOrFocus on host_* confirm) — do not self-focus.
  const { state, dispatch } = useAgentStore()
  const task = state.computerTask
  const confirm = state.pendingSecurityConfirmations[0] as SecurityConfirmationRequest | undefined
  const [text, setText] = useState("")
  const [abortSentAt, setAbortSentAt] = useState<number | null>(null)

  const sendAbort = () => {
    if (!task || task.abortAcked) return
    chrome.runtime.sendMessage({ type: "computer.task.abort", task_id: task.taskId })
    setAbortSentAt(Date.now())
  }

  const sendFollowUp = () => {
    const msg = text.trim()
    if (!msg || !state.activeThreadId) return
    chrome.runtime.sendMessage({
      type: "chat.send",
      threadId: state.activeThreadId,
      message: msg,
      skillIds: state.activeSkillIds,
    })
    setText("")
  }

  const finished = task?.status === "finished"
  const progressText =
    task && typeof task.total === "number"
      ? `${task.steps.length}/${task.total} 步`
      : task
        ? `${task.steps.length} 步`
        : "—"

  const compactMessages = state.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-8)

  // ADR-015: fleet strip in Cockpit Confirm Center shell
  useEffect(() => {
    const tick = () => chrome.runtime.sendMessage({ type: "fleet.status" })
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [])
  const fleet = state.fleet
  const pendingN = state.pendingSecurityConfirmations.length

  return (
    <div style={s.root}>
      <header style={s.titleBar}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <strong>CMspark 确认台</strong>
          <span style={s.liveBadge}>
            {task && !finished
              ? "L2 · LIVE"
              : task
                ? "L2"
                : confirm
                  ? "确认"
                  : "工作区"}
          </span>
          <span style={s.muted}>{state.activeThreadId || "—"}</span>
          <span style={s.muted}>
            {state.connectionState === "connected" ? "已连接" : state.connectionState}
          </span>
          {fleet && (
            <span style={s.muted} title="Fleet">
              舰队 {fleet.worker_count}w · {fleet.lock_count}锁
              {pendingN > 0 ? ` · 确认 ${pendingN}` : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {task && !finished && !task.abortAcked && (
            <button type="button" style={s.abortBtn} onClick={sendAbort}>
              急停
            </button>
          )}
          <button
            type="button"
            style={s.ghostBtn}
            onClick={() => {
              // P2 close warning: closing does not stop the task — make it explicit when LIVE
              if (task && !finished) {
                const ok = window.confirm(
                  "收起确认台不会停止任务。\n任务将继续在后台运行；可从侧栏 Chip 重新打开。\n\n确定收起？",
                )
                if (!ok) return
              }
              chrome.runtime.sendMessage({ type: "cockpit.close" })
            }}
            title="关闭窗口不会停止任务"
          >
            收起
          </button>
        </div>
      </header>

      {confirm && (
        <ConfirmElevated
          request={confirm}
          threadId={state.activeThreadId}
          onResolved={(id) =>
            dispatch({ type: "REMOVE_SECURITY_CONFIRMATION", confirmationId: id })
          }
        />
      )}

      {/* Empty confirm desk: explain purpose so opening 「确认台」 is not confusing */}
      {!confirm && (!task || finished) && (
        <section style={s.emptyGuide} role="status">
          <div style={s.emptyGuideTitle}>当前无待确认操作</div>
          <p style={s.emptyGuideBody}>
            这里是<strong>确认台</strong>（高危工具审批 + Computer Use 操控），不是日常聊天或配置页。
            出现 <code style={s.code}>evaluate</code> / <code style={s.code}>shell_exec</code> /{" "}
            <code style={s.code}>netsec_port_scan</code> / 桌面操控 / <code style={s.code}>spawn_worker</code>{" "}
            等请求时，会在此展示完整预览；侧栏红条也可快速允许或拒绝。
          </p>
          <p style={s.emptyGuideBody}>
            NetSec IP 与任务授权请到 Side Panel → <strong>任务包</strong>。
            关掉本窗<strong>不会</strong>停止已在跑的任务（请用急停）。
          </p>
          <p style={s.emptyGuideHint}>
            说明文档（仓库）：docs/confirm-center-user-guide.md
          </p>
        </section>
      )}

      <section style={s.taskDock}>
        <div style={{ fontSize: 13, marginBottom: 6 }}>
          {task?.task ||
            (confirm
              ? "等待确认…"
              : finished
                ? "上一任务已结束"
                : "等待 Computer Use 任务…")}
          {task?.app ? ` — ${task.app}` : ""}
        </div>
        {task && (
          <>
            <div style={s.progressTrack}>
              <div
                style={{
                  ...s.progressFill,
                  width: `${Math.min(
                    100,
                    task.total ? (task.steps.length / task.total) * 100 : 10,
                  )}%`,
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#9aa0a6" }}>
              <span>{progressText}</span>
              {typeof task.budget === "number" && <span>预算 {task.budget}</span>}
              <span>{task.status}</span>
              {abortSentAt && !task.abortAcked && <span style={{ color: "#fbbf24" }}>急停已发送…</span>}
            </div>
          </>
        )}
      </section>

      <div style={s.dual}>
        <div style={s.track}>
          <div style={s.trackTitle}>步骤轨</div>
          {!task || task.steps.length === 0 ? (
            <div style={s.muted}>暂无步骤</div>
          ) : (
            task.steps.map((step, i) => <StepLine key={`${step.seq}-${i}`} step={step} />)
          )}
        </div>
        <div style={s.track}>
          <div style={s.trackTitle}>对话（精简）</div>
          {compactMessages.length === 0 ? (
            <div style={s.muted}>无消息</div>
          ) : (
            compactMessages.map((m) => (
              <div key={m.id} style={{ marginBottom: 6, fontSize: 11, lineHeight: 1.45 }}>
                <span style={{ color: m.role === "user" ? "#5b8def" : "#a78bfa" }}>
                  {m.role === "user" ? "U" : "A"}
                </span>{" "}
                <span style={{ color: "#d1d5db" }}>
                  {(m.content || "").slice(0, 280)}
                  {(m.content || "").length > 280 ? "…" : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <footer style={s.footer}>
        <input
          style={s.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            state.activeThreadId
              ? "任务指令（Cockpit 主指挥）…"
              : "等待线程同步…"
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              sendFollowUp()
            }
          }}
        />
        <button type="button" style={s.sendBtn} onClick={sendFollowUp} disabled={!text.trim()}>
          发送
        </button>
      </footer>
    </div>
  )
}

function StepLine({ step }: { step: ComputerStepView }) {
  const show = previewImageSafe(step.previewImage)
  return (
    <div style={{ marginBottom: 8, fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#9aa0a6" }}>
      <div>
        <span style={{ color: "#4ade80" }}>#{step.seq}</span>{" "}
        {step.caption || step.action || "—"}
        {step.layer && <span style={{ marginLeft: 6, color: "#5b8def" }}>{step.layer}</span>}
      </div>
      {show && (
        <img
          src={`data:image/jpeg;base64,${step.previewImage}`}
          alt={`step ${step.seq}`}
          style={{ maxWidth: "100%", maxHeight: 80, marginTop: 4, borderRadius: 4, border: "1px solid #2a2f3a" }}
        />
      )}
    </div>
  )
}

function ConfirmElevated({
  request,
  threadId,
  onResolved,
}: {
  request: SecurityConfirmationRequest
  threadId: string | null
  onResolved: (id: string) => void
}) {
  const [whitelistMode, setWhitelistMode] = useState<"none" | "exact" | "wildcard">("none")
  const [nonceInput, setNonceInput] = useState("")
  const [pasteBlocked, setPasteBlocked] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const domain = request.relevant_domains?.[0]
  const relevantApp = request.relevant_apps?.[0]
  const canThreadTrust = canOfferThreadTrust(request.tool_name, relevantApp)
  const canSessionTrust = canOfferComputerSessionTrust(request.tool_name, relevantApp)
  const [threadTrust, setThreadTrust] = useState(false)
  const [sessionTrust, setSessionTrust] = useState(
    canOfferComputerSessionTrust(request.tool_name, relevantApp),
  )
  const nonceChallenge = request.nonce_challenge
  const nonceMatches =
    !nonceChallenge || nonceInput.toUpperCase() === nonceChallenge.toUpperCase()
  const showImg = !imgFailed && previewImageSafe(request.preview_image)

  useEffect(() => {
    setWhitelistMode("none")
    setThreadTrust(false)
    setSessionTrust(canOfferComputerSessionTrust(request.tool_name, request.relevant_apps?.[0]))
    setNonceInput("")
    setPasteBlocked(false)
    setImgFailed(false)
  }, [request.confirmation_id, request.tool_name, request.relevant_apps])

  // 60s auto-deny (D14)
  useEffect(() => {
    const ms =
      request.timeout_ms && request.timeout_ms > 0
        ? Math.min(request.timeout_ms, 60_000)
        : 60_000
    const t = setTimeout(() => {
      respond(false)
    }, ms)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.confirmation_id])

  const stopTargetId = request.worker_id || threadId
  const workerLabel =
    request.worker_role_label ||
    (request.worker_id ? `worker ${request.worker_id.slice(0, 8)}` : null)

  const respond = (approved: boolean, stopThread = false) => {
    if (approved && nonceChallenge && !nonceMatches) return
    const addToWhitelist: string[] = []
    if (approved && domain && whitelistMode !== "none") {
      addToWhitelist.push(whitelistMode === "wildcard" ? `*.${domain}` : domain)
    }
    chrome.runtime.sendMessage({
      type: "security.confirmation.response",
      confirmation_id: request.confirmation_id,
      approved,
      stop_thread: stopThread,
      stop_thread_id: stopThread ? stopTargetId : undefined,
      add_to_whitelist: addToWhitelist,
      add_to_thread_whitelist: approved && canThreadTrust && threadTrust,
      add_to_session_trust: approved && canSessionTrust && sessionTrust,
      nonce_response: approved && nonceChallenge ? nonceInput.toUpperCase() : undefined,
    })
    onResolved(request.confirmation_id)
    if (stopThread && stopTargetId) {
      chrome.runtime.sendMessage({ type: "chat.abort", threadId: stopTargetId })
    }
  }

  return (
    <section style={s.confirmElevated}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ color: "#fca5a5", fontWeight: 700 }}>
          ⚠ 确认抬升 · {request.tool_name}
          {workerLabel ? ` · ${workerLabel}` : ""}
        </span>
        <span style={{ fontSize: 10, color: "#9aa0a6" }}>
          {request.risk_level || "high"} · 超时自动拒绝
          {typeof request.tab_id === "number" ? ` · tab ${request.tab_id}` : ""}
        </span>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {showImg && (
          <img
            src={`data:image/jpeg;base64,${request.preview_image}`}
            alt="标注截图"
            style={{ width: 160, maxHeight: 100, objectFit: "cover", borderRadius: 6 }}
            onError={() => setImgFailed(true)}
          />
        )}
        <div style={{ flex: 1, fontSize: 11, color: "#d1d5db" }}>
          {request.preview_caption && <div style={{ marginBottom: 6 }}>{request.preview_caption}</div>}
          <pre style={s.codePreview}>
            {(request.full_preview || request.code_preview || "").slice(0, 1200)}
          </pre>
          {domain && (
            <div style={{ marginTop: 8, fontSize: 10 }}>
              <label style={{ marginRight: 8 }}>
                <input
                  type="radio"
                  checked={whitelistMode === "none"}
                  onChange={() => setWhitelistMode("none")}
                />{" "}
                不添加白名单
              </label>
              <label style={{ marginRight: 8 }}>
                <input
                  type="radio"
                  checked={whitelistMode === "exact"}
                  onChange={() => setWhitelistMode("exact")}
                />{" "}
                {domain}
              </label>
              <label>
                <input
                  type="radio"
                  checked={whitelistMode === "wildcard"}
                  onChange={() => setWhitelistMode("wildcard")}
                />{" "}
                *.{domain}
              </label>
            </div>
          )}
          {canThreadTrust && relevantApp && (
            <label style={{ display: "block", marginTop: 8, fontSize: 10 }}>
              <input
                type="checkbox"
                checked={threadTrust}
                onChange={(e) => setThreadTrust(e.target.checked)}
              />{" "}
              本线程信任 {relevantApp} {threadTrustHint(request.tool_name)}
            </label>
          )}
          {canSessionTrust && relevantApp && (
            <label style={{ display: "block", marginTop: 6, fontSize: 10 }}>
              <input
                type="checkbox"
                checked={sessionTrust}
                onChange={(e) => setSessionTrust(e.target.checked)}
              />{" "}
              本会话自动同意「{relevantApp}」同类操作 {computerSessionTrustHint()}
            </label>
          )}
          {nonceChallenge && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, marginBottom: 4 }}>
                输入确认码（手动输入，不可粘贴）：{nonceChallenge}
              </div>
              <input
                value={nonceInput}
                maxLength={6}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setNonceInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                  setPasteBlocked(false)
                }}
                onPaste={(e) => {
                  e.preventDefault()
                  setPasteBlocked(true)
                }}
                onContextMenu={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
                    e.preventDefault()
                    setPasteBlocked(true)
                  }
                  if (e.shiftKey && e.key === "Insert") {
                    e.preventDefault()
                    setPasteBlocked(true)
                  }
                }}
                onDrop={(e) => e.preventDefault()}
                style={{
                  ...s.input,
                  height: 28,
                  fontSize: 14,
                  letterSpacing: 4,
                  borderColor: nonceMatches ? "#4ade80" : pasteBlocked ? "#f87171" : "#2a2f3a",
                }}
              />
              {pasteBlocked && (
                <div style={{ color: "#f87171", fontSize: 10, marginTop: 4 }}>
                  粘贴被禁止 — 请手动输入确认码
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              style={{
                ...s.abortBtn,
                background: nonceChallenge && !nonceMatches ? "#374151" : "#22c55e",
                color: nonceChallenge && !nonceMatches ? "#9aa0a6" : "#052e16",
                border: "none",
                cursor: nonceChallenge && !nonceMatches ? "not-allowed" : "pointer",
              }}
              disabled={!!nonceChallenge && !nonceMatches}
              onClick={() => respond(true)}
            >
              允许
            </button>
            <button type="button" style={s.ghostBtn} onClick={() => respond(false)}>
              拒绝
            </button>
            <button
              type="button"
              style={{ ...s.ghostBtn, color: "#fca5a5", borderColor: "#7f1d1d" }}
              onClick={() => respond(false, true)}
            >
              拒绝并停止
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

const s: Record<string, CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: tokens.darkBg,
    color: tokens.darkText,
    fontFamily: tokens.font,
    fontSize: 12,
  },
  titleBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "11px 14px",
    borderBottom: `1px solid ${tokens.darkBorder}`,
    background: `linear-gradient(180deg, ${tokens.darkElevated} 0%, ${tokens.darkBg} 100%)`,
  },
  liveBadge: {
    fontSize: 10,
    padding: "3px 8px",
    background: tokens.modeComputerBg,
    color: tokens.darkLive,
    borderRadius: 999,
    fontWeight: 650,
    border: "1px solid #14532d",
    letterSpacing: "0.02em",
  },
  muted: { color: tokens.darkMuted, fontSize: 10 },
  abortBtn: {
    background: tokens.darkDangerBg,
    color: tokens.darkDanger,
    border: "1px solid #7f1d1d",
    borderRadius: 6,
    padding: "5px 10px",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 11,
  },
  ghostBtn: {
    background: "transparent",
    color: "#9aa0a6",
    border: "1px solid #2a2f3a",
    borderRadius: 6,
    padding: "5px 10px",
    cursor: "pointer",
    fontSize: 11,
  },
  confirmElevated: {
    margin: "12px 14px",
    padding: 14,
    background: "linear-gradient(180deg, #2f1818 0%, #241414 100%)",
    border: "1px solid #7f1d1d",
    borderRadius: 10,
    boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
  },
  emptyGuide: {
    margin: "12px 14px 0",
    padding: "12px 14px",
    background: "linear-gradient(180deg, #151a24 0%, #12161e 100%)",
    border: "1px solid #2a3344",
    borderRadius: 10,
    borderLeft: "3px solid #5b8def",
  },
  emptyGuideTitle: {
    fontWeight: 700,
    fontSize: 13,
    color: "#e8eaed",
    marginBottom: 8,
  },
  emptyGuideBody: {
    margin: "0 0 8px",
    fontSize: 11,
    lineHeight: 1.55,
    color: "#9aa0a6",
  },
  emptyGuideHint: {
    margin: 0,
    fontSize: 10,
    color: "#6b7280",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  code: {
    fontSize: 10,
    padding: "1px 4px",
    borderRadius: 4,
    background: "#1e2430",
    color: "#93c5fd",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  taskDock: {
    margin: "0 14px 12px",
    padding: 14,
    background: "#141820",
    border: "1px solid #232833",
    borderRadius: 10,
  },
  progressTrack: {
    height: 5,
    background: "#232833",
    borderRadius: 999,
    marginBottom: 8,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
    borderRadius: 999,
  },
  dual: {
    flex: 1,
    display: "flex",
    gap: 12,
    margin: "0 14px 12px",
    minHeight: 0,
    overflow: "hidden",
  },
  track: {
    flex: 1,
    background: "#141820",
    border: "1px solid #232833",
    borderRadius: 10,
    padding: 12,
    overflow: "auto",
  },
  trackTitle: {
    fontSize: 10,
    color: "#8b93a7",
    marginBottom: 10,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
  },
  footer: {
    display: "flex",
    gap: 8,
    padding: "12px 14px",
    borderTop: "1px solid #232833",
    background: "#11141b",
  },
  input: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    border: "1px solid #2a2f3a",
    background: "#0c0e12",
    color: "#e8eaed",
    padding: "0 12px",
    fontSize: 12,
  },
  sendBtn: {
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "0 16px",
    cursor: "pointer",
    fontWeight: 600,
  },
  codePreview: {
    maxHeight: 100,
    overflow: "auto",
    background: "#0c0e12",
    padding: 10,
    borderRadius: 6,
    fontSize: 10,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    margin: 0,
    border: "1px solid #232833",
  },
}
