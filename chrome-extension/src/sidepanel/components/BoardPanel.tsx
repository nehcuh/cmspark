// ADR-016 Stage 4 — MissionBoard Facts / Intents / Hints list (trust badges)

import { useEffect, useState, useCallback, useRef } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { submitBoardHint } from "../utils/board-hint-request"

type BoardSnap = {
  origin?: string | null
  goal?: string | null
  status?: string
  facts?: Array<{ id: string; claim: string; trust?: string; severity?: string | null }>
  intents?: Array<{
    id: string
    description: string
    status?: string
    claimed_by_worker_id?: string | null
  }>
  hints?: Array<{ id: string; text: string }>
}
type HintSubmission = { controller: AbortController; threadId: string; selectionRevision: number }
type HintReceipt = { request: HintSubmission; result: Awaited<ReturnType<typeof submitBoardHint>>; submittedDraft: string; revision: number }

function trustBadge(trust?: string): { bg: string; label: string } {
  if (trust === "user_confirmed") return { bg: "#16a34a", label: "用户确认" }
  if (trust === "tool_verified") return { bg: tokens.accent, label: "工具验证" }
  return { bg: "#ca8a04", label: "模型断言(未证实)" }
}

export function BoardPanel() {
  const { state } = useAgentStore()
  const [board, setBoard] = useState<BoardSnap | null>(null)
  const [err, setErr] = useState("")
  const [hint, setHint] = useState("")
  const [hintError, setHintError] = useState("")
  const [hintWaiting, setHintWaiting] = useState(false)
  const [hintReceipt, setHintReceipt] = useState<HintReceipt | null>(null)
  const threadId = state.activeThreadId
  const selectionRevision = state.activeThreadSelectionRevision
  const owner = useRef({ threadId, selectionRevision })
  owner.current = { threadId, selectionRevision }
  const draft = useRef(hint); draft.current = hint
  const draftRevision = useRef(0)
  const pending = useRef<HintSubmission | null>(null)
  useEffect(() => () => {
    const request = pending.current; pending.current = null
    request?.controller.abort()
  }, [])
  useEffect(() => {
    const request = pending.current
    if (request && (request.threadId !== threadId || request.selectionRevision !== selectionRevision)) {
      request.controller.abort(); pending.current = null; setHintWaiting(false)
    }
    setHintError("")
  }, [threadId, selectionRevision])

  // PacksPanel pattern: SW fire-and-forgets to Companion; response arrives as a
  // chrome.runtime.onMessage push (handleCompanionMessage forwards board.get).
  // Do not expect sendMessage callback to carry raw_board — SW only returns {ok:true}.
  const refresh = useCallback(() => {
    if (!threadId) {
      setBoard(null)
      return
    }
    setErr("")
    try {
      chrome.runtime.sendMessage({ type: "board.get", thread_id: threadId }, () => {
        if (chrome.runtime.lastError) {
          setErr(chrome.runtime.lastError.message || "board.get failed")
        }
      })
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }, [threadId])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    const onMsg = (msg: any) => {
      if (msg?.type !== "board.get") return
      // Ignore pushes for other threads
      if (threadId && msg.thread_id && msg.thread_id !== threadId) return
      if (msg.error) {
        setErr(String(msg.error))
        setBoard(null)
        return
      }
      setErr("")
      const raw = msg?.raw_board || msg?.board || msg?.data?.raw_board || msg?.data?.board
      setBoard(raw || null)
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => {
      clearInterval(id)
      chrome.runtime.onMessage.removeListener(onMsg)
    }
  }, [refresh, threadId])

  useEffect(() => {
    if (!hintReceipt) return
    setHintReceipt(null)
    const { request, result, submittedDraft, revision } = hintReceipt
    if (pending.current !== request) return
    pending.current = null; setHintWaiting(false)
    // Reconcile only after React commits the canonical selection. A Promise
    // continuation can run before queued A→B→A reducer actions render.
    if (request.controller.signal.aborted || threadId !== request.threadId ||
        selectionRevision !== request.selectionRevision || draftRevision.current !== revision ||
        draft.current !== submittedDraft) return
    if (result.ok === true) { draftRevision.current++; draft.current = ""; setHint(""); refresh() }
    else setHintError(result.error)
  }, [hintReceipt, threadId, selectionRevision, refresh])

  async function addHint() {
    const owned = owner.current
    const submittedDraft = draft.current, revision = draftRevision.current
    if (!owned.threadId || !submittedDraft.trim() || pending.current) return
    const request = { controller: new AbortController(), threadId: owned.threadId, selectionRevision: owned.selectionRevision }
    pending.current = request; setHintWaiting(true); setHintError("")
    const result = await submitBoardHint(chrome.runtime, request.threadId, submittedDraft.trim(), request.controller.signal)
    if (pending.current !== request) return
    setHintReceipt({ request, result, submittedDraft, revision })
  }

  if (!threadId) {
    return <div style={s.empty}>选择线程以查看任务板</div>
  }

  const openIntents = (board?.intents || []).filter(
    (i) => i.status === "open" || i.status === "claimed",
  )

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <strong style={{ fontSize: 15 }}>任务板</strong>
        <button type="button" style={s.link} onClick={refresh}>
          刷新
        </button>
      </div>
      {err && <div style={s.err}>{err}</div>}
      {!board && !err && <div style={s.empty}>未启用 board_mode 或板为空 — 应用 AppSec 场景后初始化</div>}
      {board && (
        <>
          <div style={s.meta}>
            <div>
              <span style={s.label}>状态</span> {board.status || "open"}
            </div>
            {board.goal && (
              <div style={{ marginTop: 4 }}>
                <span style={s.label}>目标</span> {board.goal}
              </div>
            )}
            {board.origin && (
              <div style={{ marginTop: 4 }}>
                <span style={s.label}>起点</span> {board.origin}
              </div>
            )}
            <div style={{ marginTop: 4, fontSize: 10, color: tokens.textMuted }}>
              Facts {board.facts?.length || 0} · Open intents {openIntents.length} · Hints{" "}
              {board.hints?.length || 0}
            </div>
          </div>

          <Section title="Facts">
            {(board.facts || []).length === 0 && <div style={s.empty}>暂无</div>}
            {(board.facts || []).map((f) => {
              const b = trustBadge(f.trust)
              return (
                <div key={f.id} style={s.card}>
                  <span style={{ ...s.badge, background: b.bg }}>{b.label}</span>
                  {f.severity && (
                    <span style={{ ...s.badge, background: "#6b7280", marginLeft: 4 }}>{f.severity}</span>
                  )}
                  <div style={s.claim}>{f.claim}</div>
                </div>
              )
            })}
          </Section>

          <Section title="Intents">
            {(board.intents || []).length === 0 && <div style={s.empty}>暂无</div>}
            {(board.intents || []).map((i) => (
              <div key={i.id} style={s.card}>
                <div style={{ fontSize: 10, color: tokens.textMuted }}>
                  {i.status}
                  {i.claimed_by_worker_id ? ` · worker ${i.claimed_by_worker_id.slice(0, 8)}…` : ""}
                </div>
                <div style={s.claim}>{i.description}</div>
              </div>
            ))}
          </Section>

          <Section title="Hints">
            {(board.hints || []).length === 0 && <div style={s.empty}>暂无</div>}
            {(board.hints || []).map((h) => (
              <div key={h.id} style={s.card}>
                <div style={s.claim}>{h.text}</div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                style={s.input}
                placeholder="添加 Hint（人类判断）"
                value={hint}
                onChange={(e) => { draftRevision.current++; draft.current = e.target.value; setHint(e.target.value); setHintError("") }}
              />
              <button
                type="button"
                style={s.btn}
                disabled={hintWaiting}
                onClick={addHint}
              >
                添加
              </button>
            </div>
            {hintError && <div role="alert" style={s.err}>{hintError}</div>}
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: { padding: "8px 10px", fontSize: 12, color: tokens.text, maxHeight: 320, overflow: "auto" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  link: {
    border: "none",
    background: "transparent",
    color: tokens.accent,
    cursor: "pointer",
    fontSize: 11,
  },
  empty: { fontSize: 11, color: tokens.textSecondary, padding: "4px 0" },
  err: { fontSize: 11, color: "#b91c1c", marginBottom: 6 },
  meta: {
    padding: 8,
    borderRadius: 6,
    background: tokens.bgElevated || "#f9fafb",
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
    fontSize: 11,
    lineHeight: 1.4,
  },
  label: { color: tokens.textMuted, marginRight: 6 },
  card: {
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
    borderRadius: 6,
    padding: 6,
    marginBottom: 6,
    background: "#fff",
  },
  badge: {
    fontSize: 9,
    color: "#fff",
    padding: "1px 6px",
    borderRadius: 99,
    fontWeight: 600,
  },
  claim: { fontSize: 11, marginTop: 4, lineHeight: 1.35 },
  input: {
    flex: 1,
    fontSize: 11,
    padding: "4px 6px",
    borderRadius: 6,
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
  },
  btn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: tokens.accent,
    cursor: "pointer",
  },
}
