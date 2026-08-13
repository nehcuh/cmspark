// Chat message list with streaming support

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import { useCapabilityMode } from "../hooks/useCapabilityMode"
import { marked } from "marked"
import markedKatex from "marked-katex-extension"
import DOMPurify from "dompurify"
import { renderMermaidBlocks, prefetchMermaid } from "./mermaid"
import { extractComputerCardData } from "../utils/computer-utils"
import {
  extractShellCardData,
  formatShellMetaLine,
  SHELL_BODY_PREVIEW_CHARS,
} from "../utils/shell-card-utils"
import { fleetProcessingLabel } from "./focus-band-priority"
import { collectRunningTools, formatRunningToolsLabel } from "../utils/running-tools"
import {
  buildScopedRunBusyInput,
  deriveRunBusy,
  deriveThreadBusy,
  isIntentOnlyRunBusy,
} from "../utils/thread-busy"
import { tokens, statusColor } from "../ui/tokens"
import {
  IconBranch,
  IconCopy,
  IconDownload,
  IconEdit,
  IconRefresh,
} from "../ui/icons"
// KaTeX stylesheet — bundled by Plasmo; needed for math glyph fonts/layout.
import "katex/dist/katex.min.css"

// LaTeX math rendering via KaTeX: $...$ inline, $$...$$ block.
// Registered once at module load so every marked.parse (history + streaming)
// shares the extension.
//   - output:"html"  → emits only <span>/<svg>/<path> (no MathML), keeping the
//                      DOMPurify tag whitelist minimal.
//   - nonStandard    → parses math adjacent to CJK text (no inter-word spaces).
//                      Code spans/blocks are still protected: marked tokenizes
//                      them before the katex inline tokenizer runs.
//   - throwOnError   → invalid LaTeX degrades to inline text instead of throwing.
marked.use(markedKatex({ throwOnError: false, output: "html", nonStandard: true }))

// Harden markdown links: open in a new tab with noopener, and intercept clicks
// inside the extension side panel so external origins cannot navigate the panel.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node instanceof HTMLAnchorElement) {
    node.setAttribute("target", "_blank")
    node.setAttribute("rel", "noopener noreferrer")
  }
})

const LONG_CONTENT_THRESHOLD = 3000
const LONG_CONTENT_PREVIEW = 500
const TOOL_RESULT_PREVIEW = 200

export function ChatView() {
  const { state, dispatch } = useAgentStore()
  const {
    messages,
    streamingContent,
    streamingReasoning,
    processingStatus,
    activeThreadId,
    isProcessing,
    sendShortcut,
    showReasoningMode,
    exportIncludeReasoning,
    fleet,
    threadBusyById,
    threads,
    contextCompactedByThreadId,
  } = state
  const contextCompacted =
    activeThreadId && contextCompactedByThreadId[activeThreadId]
      ? contextCompactedByThreadId[activeThreadId]
      : null
  const [summaryOpen, setSummaryOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  /** Inner content grows with messages; ResizeObserver watches this for stick-to-bottom. */
  const contentRef = useRef<HTMLDivElement>(null)
  const lastMessageCountRef = useRef(messages.length)
  const lastStickKeyRef = useRef("")
  /** When true, keep the viewport glued to the latest message. */
  const pinnedRef = useRef(true)
  /** Ignore scroll events caused by our own scrollToBottom (avoid false unpin). */
  const ignoreScrollRef = useRef(false)

  const { level } = useCapabilityMode()

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container || !pinnedRef.current) return
    ignoreScrollRef.current = true
    const apply = () => {
      const el = containerRef.current
      if (!el || !pinnedRef.current) return
      el.scrollTop = el.scrollHeight
    }
    apply()
    // Second frame: markdown / tool cards often expand after first paint.
    requestAnimationFrame(() => {
      apply()
      requestAnimationFrame(() => {
        apply()
        // Allow user scroll detection again after programmatic settles.
        ignoreScrollRef.current = false
      })
    })
  }, [])

  // Show processing label when request active OR any tool still running
  // (#au4dch ST-1/ST-4: shared collectRunningTools with FocusBand).
  const runningTools = collectRunningTools(messages)
  const mapBusy = !!(activeThreadId && threadBusyById[activeThreadId])
  const threadBusy = deriveThreadBusy({
    streaming: !!(streamingContent || streamingReasoning),
    isProcessing,
    runningToolCount: runningTools.length,
    mapBusy,
  })
  const activeThread = threads.find((t) => t.id === activeThreadId)
  // Prefer live event summary; fall back to thread meta after reload/list.
  const rollingSummary =
    contextCompacted?.rollingSummary ||
    activeThread?.runtime_context_budget?.rolling_summary ||
    ""
  const handoff =
    contextCompacted?.handoff ||
    activeThread?.runtime_context_budget?.handoff ||
    null
  const compactMode =
    contextCompacted?.mode ||
    activeThread?.runtime_context_budget?.mode ||
    "m1"
  const showCompactBanner =
    !!contextCompacted ||
    !!(
      activeThread?.runtime_context_budget &&
      (activeThread.runtime_context_budget.dropped_count ?? 0) > 0
    )
  const workers = fleet?.workers || []
  const busyThreadIds = Object.entries(threadBusyById)
    .filter(([, b]) => b)
    .map(([id]) => id)
  const { runBusyInput, workerCount: scopedWorkerCount, scopedWorkers } =
    buildScopedRunBusyInput({
      active: activeThread
        ? {
            id: activeThread.id,
            agent_role: activeThread.agent_role,
            parent_thread_id: activeThread.parent_thread_id,
            orchestrator_run_id: activeThread.orchestrator_run_id,
          }
        : activeThreadId
          ? { id: activeThreadId }
          : null,
      workers,
      locks: fleet?.locks,
      openIntentCount: fleet?.open_intent_count,
      openIntentsByRun: fleet?.open_intents_by_run,
      llmActiveThreadIds: fleet?.llm_active_thread_ids,
      busyThreadIds,
    })
  const lockCount = runBusyInput.lockCount
  const runBusy = deriveRunBusy(runBusyInput)
  const intentOnly = isIntentOnlyRunBusy(runBusyInput)

  const processingLabel = (() => {
    // Scope fleet processing hint to active thread — never foreign residual workers.
    const scopedWorst = scopedWorkers.some((w) => w.status === "holding_tabs")
      ? "holding_tabs"
      : scopedWorkers.some((w) => w.status === "paused")
        ? "paused"
        : scopedWorkers.length > 0
          ? "idle"
          : "none"
    const fleetLabel = fleetProcessingLabel({
      workerCount: scopedWorkerCount,
      lockCount,
      openIntents: runBusyInput.openIntents,
      worstStatus: scopedWorst,
    })
    // Active fleet only (not paused-only zombies) — suffix while tools/thinking.
    const fleetBit = fleetLabel ? ` · ${fleetLabel.replace(/^舰队/, "").trim()}` : ""
    // #au4dch M1: do NOT hide label when streamingContent is set — tools often
    // run after assistant text; streaming gate previously made UI look idle.
    if (runningTools.length > 0) {
      const base = formatRunningToolsLabel(runningTools) || "执行中"
      return `${base}${fleetBit}`
    }
    // Live answer/reasoning stream owns the bubble — hide status chip
    if (streamingContent || streamingReasoning) return null
    if (processingStatus) return `${processingStatus}${fleetBit}`
    if (threadBusy || isProcessing) {
      return `思考中${fleetBit}`
    }
    return null
  })()

  // Fingerprint of transcript tail — length alone misses SET_MESSAGES full replace
  // (same count, new ids) and tool_call result expansion (same count, taller cards).
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
  const stickKey = [
    messages.length,
    lastMsg?.id ?? "",
    typeof lastMsg?.content === "string" ? lastMsg.content.length : 0,
    Array.isArray(lastMsg?.tool_calls)
      ? lastMsg!.tool_calls!
          .map((tc: any) => `${tc?.id ?? ""}:${tc?.status ?? ""}:${String(tc?.result ?? "").length}`)
          .join("|")
      : "",
    streamingContent ? streamingContent.length : 0,
    streamingReasoning ? streamingReasoning.length : 0,
    processingLabel ? "1" : "0",
  ].join(":")

  // SoT §6: false-end banner when local turn idle but run still live
  const fakeEndLabel =
    !threadBusy && runBusy
      ? intentOnly
        ? "任务板仍有未关闭意图"
        : "编排本轮已结束 · 子任务还在跑"
      : null

  // Auto-scroll to bottom when transcript / stream grows.
  // Respects user scroll: if the user scrolled up to read history, stop forcing
  // the view back to the bottom (audit L5). Long threads previously only watched
  // messages.length — full reloads (same count) and late layout growth (tool cards,
  // markdown) left the viewport at the top or mid-history.
  // Stickiness is delivered by scrollTop + ResizeObserver on contentRef (not CSS
  // overflow-anchor — container disables anchoring to avoid yank-to-top).
  useEffect(() => {
    const unchanged =
      stickKey === lastStickKeyRef.current &&
      messages.length === lastMessageCountRef.current &&
      !streamingContent &&
      !streamingReasoning
    if (unchanged) return
    lastStickKeyRef.current = stickKey
    lastMessageCountRef.current = messages.length
    if (!pinnedRef.current) return
    requestAnimationFrame(() => scrollToBottom())
  }, [stickKey, messages.length, streamingContent, streamingReasoning, scrollToBottom])

  // Content-height growth (mermaid, tool results, KaTeX) does not change React
  // deps — keep glued when still pinned.
  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom()
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [scrollToBottom])

  const handleScroll = useCallback(() => {
    if (ignoreScrollRef.current) return
    const container = containerRef.current
    if (!container) return
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    // Slightly looser threshold: subpixel + large side-panel fonts on long threads.
    pinnedRef.current = distanceFromBottom < 120
  }, [])

  // On thread switch, re-pin to the bottom so the new thread auto-scrolls
  // instead of inheriting a stale "user scrolled up" pin from the previous
  // thread (audit L5).
  useEffect(() => {
    pinnedRef.current = true
    lastStickKeyRef.current = ""
    lastMessageCountRef.current = -1
    requestAnimationFrame(() => scrollToBottom())
  }, [activeThreadId, scrollToBottom])

  // Prefetch mermaid in the background once the panel is idle so the first
  // committed diagram doesn't stall on the chunk load (decision G3).
  useEffect(() => {
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined
    if (ric) {
      const h = ric(() => prefetchMermaid(), { timeout: 3000 })
      return () => (window as any).cancelIdleCallback?.(h)
    }
    const t = setTimeout(prefetchMermaid, 1500)
    return () => clearTimeout(t)
  }, [])

  // Stable callbacks so MessageRow memoization is effective (audit item 11).
  // Without useCallback, every ChatView render creates new function identities,
  // busting React.memo on every row.
  const handleRegenerate = useCallback((messageId: string, editedMessage?: string) => {
    if (!activeThreadId) return
    chrome.runtime.sendMessage({
      type: "chat.regenerate",
      thread_id: activeThreadId,
      message_id: messageId,
      message: editedMessage,
    })
    dispatch({ type: "SET_PROCESSING", isProcessing: true })
  }, [activeThreadId, dispatch])

  const handleFork = useCallback((messageId: string) => {
    if (!activeThreadId) return
    chrome.runtime.sendMessage({
      type: "thread.fork",
      thread_id: activeThreadId,
      message_id: messageId,
    })
  }, [activeThreadId])

  // Export the Q&A pair containing this message to Obsidian markdown (UI-side download).
  const handleExport = useCallback((messageId: string) => {
    if (!activeThreadId) return
    chrome.runtime.sendMessage({
      type: "thread.export_obsidian",
      thread_id: activeThreadId,
      // "single" = export just the clicked message (e.g. one response), not the whole
      // Q&A turn. (qa_pair would include the preceding question too.)
      scope: "single",
      anchor_message_id: messageId,
      include_reasoning: exportIncludeReasoning === true,
    })
  }, [activeThreadId, exportIncludeReasoning])

  return (
    <div style={styles.container} ref={containerRef} onScroll={handleScroll}>
      <div ref={contentRef} style={styles.contentInner}>
        {showCompactBanner && (
          <div
            role="status"
            style={{
              margin: "8px 10px 4px",
              padding: "8px 10px",
              borderRadius: 8,
              background: tokens.warningSoft || "#fffbeb",
              border: `1px solid ${tokens.border || "#f0e6c8"}`,
              fontSize: 11,
              lineHeight: 1.45,
              color: "#7a5b00",
            }}
          >
            {contextCompacted && contextCompacted.droppedCount === 0 ? (
              <>
                <strong>上下文可能超预算</strong>
                （当前为「仅提示」模式，未压缩）。
                可在设置 → 模型与推理中改为「自动压缩」。
                <button
                  type="button"
                  style={{
                    marginLeft: 8,
                    border: "none",
                    background: "transparent",
                    color: tokens.accent,
                    cursor: "pointer",
                    fontSize: 11,
                    textDecoration: "underline",
                    padding: 0,
                  }}
                  onClick={() =>
                    dispatch({ type: "OPEN_SETTINGS_SECTION", section: "model" })
                  }
                >
                  打开设置
                </button>
              </>
            ) : (
              <>
                <strong>模型上下文已压缩</strong>
                （约去掉{" "}
                {contextCompacted?.droppedCount ??
                  activeThread?.runtime_context_budget?.dropped_count ??
                  "?"}{" "}
                条请求侧消息
                {compactMode === "h1"
                  ? "，含结构化工作记忆"
                  : compactMode === "m2"
                    ? "，含滚动摘要"
                    : ""}
                ）。
                下方消息列表仍为完整原文；模型可能看不到较早轮次。
                {rollingSummary || handoff ? (
                  <button
                    type="button"
                    style={{
                      marginLeft: 8,
                      border: "none",
                      background: "transparent",
                      color: tokens.accent,
                      cursor: "pointer",
                      fontSize: 11,
                      textDecoration: "underline",
                      padding: 0,
                    }}
                    onClick={() => setSummaryOpen(true)}
                  >
                    查看摘要
                  </button>
                ) : null}
              </>
            )}
          </div>
        )}
        {summaryOpen && (rollingSummary || handoff) && (
          <div
            role="dialog"
            aria-label="上下文工作记忆"
            style={{
              margin: "4px 10px 8px",
              padding: 12,
              borderRadius: 8,
              background: "#fff",
              border: `1px solid ${tokens.border || "#e5e7eb"}`,
              boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
              fontSize: 12,
              lineHeight: 1.5,
              color: tokens.text || "#111",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <strong style={{ fontSize: 12 }}>
                {handoff ? "工作记忆（结构化 · 脱敏）" : "压缩摘要（脱敏 · 仅供回顾）"}
              </strong>
              <button
                type="button"
                onClick={() => setSummaryOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 14,
                  color: tokens.textMuted,
                }}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            {handoff ? (
              <div style={{ maxHeight: 260, overflow: "auto" }}>
                {(
                  [
                    ["目标", handoff.goals],
                    ["决策", handoff.decisions],
                    ["约束", handoff.constraints],
                    ["待办", handoff.open_todos],
                    ["产物", handoff.artifacts],
                  ] as const
                ).map(([label, items]) =>
                  items && items.length > 0 ? (
                    <div key={label} style={{ marginBottom: 8 }}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>【{label}】</div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {items.map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null,
                )}
              </div>
            ) : (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "inherit",
                  fontSize: 12,
                  maxHeight: 220,
                  overflow: "auto",
                }}
              >
                {rollingSummary}
              </pre>
            )}
            <div style={{ marginTop: 8, fontSize: 10, color: tokens.textMuted }}>
              工作记忆仅服务当前请求路径；不进入导出默认路径，也不跨会话注入。磁盘全文仍保留。
            </div>
          </div>
        )}
        {messages.length === 0 && !streamingContent && !streamingReasoning && !processingLabel && (
          <EmptyState level={level} />
        )}
        {messages.map(msg => (
          <MessageRow
            key={msg.id}
            msg={msg}
            activeThreadId={activeThreadId}
            sendShortcut={sendShortcut}
            onRegenerate={handleRegenerate}
            onFork={handleFork}
            onExport={handleExport}
            showReasoningMode={showReasoningMode}
            exportIncludeReasoning={exportIncludeReasoning === true}
            dispatch={dispatch}
          />
        ))}
        {(streamingReasoning || streamingContent) && (
          <div style={styles.agentMsg}>
            <div style={styles.messageCol}>
              {streamingReasoning ? (
                <ReasoningBlock
                  content={streamingReasoning}
                  live={!streamingContent}
                  mode={showReasoningMode}
                />
              ) : null}
              {streamingContent ? (
                <div style={styles.agentBubble}>
                  <StreamingMarkdown content={streamingContent} />
                  <Cursor />
                </div>
              ) : streamingReasoning ? (
                <div style={styles.statusBubble}>
                  思考中
                  <span style={styles.statusDots}>...</span>
                </div>
              ) : null}
            </div>
          </div>
        )}
        {processingLabel && (
          <div style={styles.agentMsg}>
            <div style={styles.statusBubble}>
              {processingLabel}
              <span style={styles.statusDots}>...</span>
            </div>
          </div>
        )}
        {fakeEndLabel && !processingLabel && (
          <div style={styles.agentMsg}>
            <button
              type="button"
              style={styles.fakeEnd}
              onClick={() => dispatch({ type: "SET_FLEET_LIST_OPEN", open: true })}
            >
              {fakeEndLabel}
              <span style={{ color: tokens.accent, marginLeft: 6 }}>查看子任务</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Memoized historical message row. Subscribes only to its own msg prop;
 * token-stream updates to `streamingContent` in the parent do NOT re-render this.
 * Edit state is local per-row (only one row can be interacted with at a time anyway).
 */
const MessageRow = memo(function MessageRow({
  msg,
  activeThreadId,
  sendShortcut,
  showReasoningMode,
  exportIncludeReasoning: _exportIncludeReasoning,
  onRegenerate,
  onFork,
  onExport,
  dispatch,
}: {
  msg: any
  activeThreadId: string | null
  sendShortcut: string
  showReasoningMode: "always_collapsed" | "auto_live" | "always_open"
  /** Primitive so custom memo re-renders when Settings export opt-in flips (P0-1). */
  exportIncludeReasoning: boolean
  onRegenerate: (messageId: string, editedMessage?: string) => void
  onFork: (messageId: string) => void
  onExport: (messageId: string) => void
  dispatch: any
}) {
  const isUser = msg.role === "user"
  const hasLongContent = (msg.content?.length || 0) > LONG_CONTENT_THRESHOLD
  const [isEditing, setIsEditing] = useState(false)
  const [editingText, setEditingText] = useState("")
  // useRef so the keydown handler always sees the latest shortcut without
  // busting MessageRow's memo when the user changes the setting.
  const sendShortcutRef = useRef(sendShortcut)
  sendShortcutRef.current = sendShortcut

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
    }
  }

  return (
    <div style={isUser ? styles.userMsg : styles.agentMsg}>
      <div style={styles.messageCol}>
        {isEditing ? (
          <div style={styles.editWrap}>
            <textarea
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              onKeyDown={(e) => {
                // Mirror InputArea's strict modifier check so editor submit matches the
                // configured send shortcut (Cmd-only / Ctrl-only / Enter-only).
                const shortcut = sendShortcutRef.current
                let submit = false
                if (shortcut === "Enter") {
                  submit = e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey
                } else if (shortcut === "Cmd+Enter") {
                  submit = e.key === "Enter" && e.metaKey && !e.ctrlKey
                } else if (shortcut === "Ctrl+Enter") {
                  submit = e.key === "Enter" && e.ctrlKey && !e.metaKey
                }
                if (submit) {
                  e.preventDefault()
                  onRegenerate(msg.id, editingText)
                  setIsEditing(false)
                  setEditingText("")
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  setIsEditing(false)
                  setEditingText("")
                }
              }}
              style={styles.editTextarea}
              rows={3}
              autoFocus
            />
            <div style={styles.editActions}>
              <button
                style={{ ...styles.editBtn, background: tokens.bgElevated, color: tokens.textSecondary, border: `1px solid ${tokens.border}` }}
                onClick={() => { setIsEditing(false); setEditingText("") }}
              >
                取消
              </button>
              <button
                style={{ ...styles.editBtn, background: tokens.accent, color: "#fff", border: "none" }}
                onClick={() => { onRegenerate(msg.id, editingText); setIsEditing(false); setEditingText("") }}
              >
                重新生成
              </button>
            </div>
          </div>
        ) : (
          <>
            {!isUser && msg.reasoning_content ? (
              <ReasoningBlock content={msg.reasoning_content} mode={showReasoningMode} />
            ) : null}
            <div style={isUser ? styles.userBubble : styles.agentBubble}>
              {hasLongContent ? (
                <CollapsibleMarkdown content={msg.content} maxPreview={LONG_CONTENT_PREVIEW} renderMermaid />
              ) : (
                <MarkdownRenderer content={msg.content} renderMermaid />
              )}
              {msg.tool_calls?.map((tc: any) => (
                <ToolCallCard key={tc.id} tc={tc} />
              ))}
            </div>
            <div style={{
              ...styles.actionBar,
              alignSelf: isUser ? "flex-end" : "flex-start",
            }}>
              <button type="button" style={styles.actionBtn} onClick={() => handleCopy(msg.content || "")} title="复制" aria-label="复制">
                <IconCopy size={13} />
              </button>
              {isUser && (
                <button
                  type="button"
                  style={styles.actionBtn}
                  onClick={() => { setIsEditing(true); setEditingText(msg.content || "") }}
                  title="编辑并重新生成"
                  aria-label="编辑并重新生成"
                >
                  <IconEdit size={13} />
                </button>
              )}
              {!isUser && (
                <button type="button" style={styles.actionBtn} onClick={() => onRegenerate(msg.id)} title="重新生成" aria-label="重新生成">
                  <IconRefresh size={13} />
                </button>
              )}
              <button type="button" style={styles.actionBtn} onClick={() => onFork(msg.id)} title="创建分支" aria-label="创建分支">
                <IconBranch size={13} />
              </button>
              <button type="button" style={styles.actionBtn} onClick={() => onExport(msg.id)} title="导出此条到 Obsidian" aria-label="导出到 Obsidian">
                <IconDownload size={13} />
              </button>
              <button
                type="button"
                style={styles.actionBtn}
                title="派给终端助手（编程接力）"
                aria-label="派给终端助手"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("cmspark:open-coding-handoff", {
                      detail: {
                        seedGoal: String(msg.content || "").slice(0, 800),
                      },
                    }),
                  )
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600 }}>{"</>"}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}, (prev, next) => {
  // Re-render only when this row's data actually changed. Reference-equality on
  // tool_calls is intentional — agentStore keeps the array referentially stable
  // across unrelated state changes (e.g. streamingContent updates).
  // Wave E / multi-adv P0-1: include showReasoningMode + exportIncludeReasoning so
  // Settings changes re-render historical rows (mode + fresh onExport closure).
  return (
    prev.msg.id === next.msg.id &&
    prev.msg.content === next.msg.content &&
    prev.msg.reasoning_content === next.msg.reasoning_content &&
    prev.msg.tool_calls === next.msg.tool_calls &&
    prev.activeThreadId === next.activeThreadId &&
    prev.sendShortcut === next.sendShortcut &&
    prev.showReasoningMode === next.showReasoningMode &&
    prev.exportIncludeReasoning === next.exportIncludeReasoning
  )
})

/** Collapsible model thinking / DeepSeek reasoning block. Wave D: mode from settings. */
function ReasoningBlock({
  content,
  live = false,
  mode = "auto_live",
}: {
  content: string
  live?: boolean
  mode?: "always_collapsed" | "auto_live" | "always_open"
}) {
  const initialOpen =
    mode === "always_open" ? true : mode === "always_collapsed" ? false : live
  const [open, setOpen] = useState(initialOpen)
  // Auto-open while live and no answer yet; leave user control once they toggle.
  // Settings mode change (P0-1 dual-truth) resets user toggle so global setting wins.
  const userToggled = useRef(false)
  const prevModeRef = useRef(mode)
  useEffect(() => {
    if (prevModeRef.current !== mode) {
      userToggled.current = false
      prevModeRef.current = mode
    }
    if (userToggled.current) return
    if (mode === "always_open") setOpen(true)
    else if (mode === "always_collapsed") setOpen(false)
    else {
      // auto_live
      if (live) setOpen(true)
      else setOpen(false)
    }
  }, [live, mode])
  if (!content) return null

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      /* ignore */
    }
  }

  return (
    <div style={styles.reasoningWrap}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          style={{ ...styles.reasoningToggle, flex: 1 }}
          onClick={() => {
            userToggled.current = true
            setOpen((v) => !v)
          }}
          aria-expanded={open}
        >
          <span style={styles.reasoningLabel}>
            {live ? "模型思考中" : "思考过程"}
            {live ? <span style={styles.statusDots}>...</span> : null}
            {!open && !live ? (
              <span style={styles.reasoningMeta}>（{content.length} 字）</span>
            ) : null}
          </span>
          <span style={styles.reasoningChevron}>{open ? "▾" : "▸"}</span>
        </button>
        <button
          type="button"
          style={styles.actionBtn}
          onClick={handleCopy}
          title="复制思考过程"
          aria-label="复制思考过程"
        >
          复制
        </button>
      </div>
      {open ? (
        <div style={styles.reasoningBody}>
          <pre style={styles.reasoningPre}>{content}</pre>
        </div>
      ) : null}
    </div>
  )
}

function CollapsibleMarkdown({ content, maxPreview, renderMermaid = false }: { content: string; maxPreview: number; renderMermaid?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const preview = content.substring(0, maxPreview)
  const needsCollapse = content.length > maxPreview

  return (
    <div>
      <MarkdownRenderer content={expanded ? content : preview + (needsCollapse ? "\n\n..." : "")} renderMermaid={renderMermaid} />
      {needsCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={styles.expandBtn}
          title={expanded ? "收起内容" : "展开完整内容"}
        >
          {expanded ? "收起 ▲" : "展开完整内容 ▼"}
        </button>
      )}
    </div>
  )
}

function toolResultUserHint(result: any): string | null {
  if (!result || result.success !== false) return null
  const err = typeof result.error === "string" ? result.error : ""
  const dataHint =
    typeof result.data?.user_hint_zh === "string" ? result.data.user_hint_zh : ""
  // Prefer structured companion hints (e.g. COOKIE_TRUST_DENIED) when present.
  if (dataHint) return dataHint
  if (/default_sandbox_unavailable|cannot create default sandbox|默认工作区沙箱不可用/i.test(err)) {
    return "默认沙箱 ~/CMspark-projects 不可用：检查本机权限，或侧栏「场景」→「选择工作区」绑定目录。协议解锁不会跳过。"
  }
  if (
    /workspace_root not set|需要先绑定工作区|pick a folder first|默认使用沙箱|本机读写可用默认沙箱/i.test(
      err,
    )
  ) {
    return "本机读写可用默认沙箱 ~/CMspark-projects；真实项目请侧栏「场景」→「选择工作区」。协议解锁 / 运行自主度与场地绑定无关。"
  }
  if (/tool_not_allowed|当前场景不允许|可退出场景|工具白名单|工具面已收窄/i.test(err)) {
    return "本对话工具面已收窄：顶栏点「恢复全工具」或「退出场景」（立即生效）。勿新建对话。三旗巡航会放开普通对话工具面。"
  }
  if (/image_fetch_file_requires_cruise|不能拉取 file:|file_requires_cruise/i.test(err)) {
    return "本地 file: 图需三旗巡航（风险自担），不是确认弹窗。或改用 screenshot；云元数据 SSRF 仍硬拦。"
  }
  if (
    /COOKIE_TRUST|Cookie 信任域|not in the trusted_domains|Access to cookie for domain/i.test(err) ||
    result.data?.error_code === "COOKIE_TRUST_DENIED"
  ) {
    const dom =
      typeof result.data?.target_domain === "string" && result.data.target_domain
        ? result.data.target_domain
        : "该域名"
    return (
      `Cookie 被拦：「${dom}」不在信任名单。` +
      `设置 → 安全设置 → Cookie 信任域 → 管理信任域，添加域名后重试。` +
      `全自动巡航不会自动放行 Cookie。`
    )
  }
  // First line of multi-line Chinese errors (skip English "Security Block:" title line)
  const first = err
    .split("\n")
    .find((l: string) => l.trim() && !l.trim().startsWith("[") && /[\u4e00-\u9fff]/.test(l) && l.length < 160)
  if (first) return first.trim().replace(/^Security Block:\s*/i, "")
  return null
}

function ToolCallCard({ tc }: { tc: any }) {
  const { state: agentState } = useAgentStore()
  const [expanded, setExpanded] = useState(false)
  const [visionExpanded, setVisionExpanded] = useState(false)
  const [shellExpanded, setShellExpanded] = useState(false)
  const [showRawJson, setShowRawJson] = useState(false)
  const hasResult = tc.result && !tc.error
  const userHint = hasResult ? toolResultUserHint(tc.result) : null
  // Avoid stringifying huge objects on every render; cap preview stringification
  const resultStr = hasResult ? JSON.stringify(tc.result, null, 2) : ""
  const isLongResult = resultStr.length > TOOL_RESULT_PREVIEW

  const isVisionTool = tc.tool_name === "screenshot" || tc.tool_name === "analyze_image"
  const visionDescription = tc.result?.data?.vision_description
  const hasVisionDescription = isVisionTool && visionDescription

  // WP4 (WI-5/X2): host_computer 紧凑任务卡——completed/total、error_code
  // (失败红色)、「📂 打开证据目录」。字段提取走纯函数 extractComputerCardData
  // (真实网线 snake_case 优先、camel 回退;无 evidenceDir 的旧 companion
  // 结果只读展示),fixture 测试在 computer-task-state 套件。
  const isComputerTask = tc.tool_name === "host_computer"
  const computerCard = isComputerTask ? extractComputerCardData(tc.result) : null
  const computerFailed = computerCard !== null && (computerCard.failed || tc.status === "error")

  // shell_exec: command + stdout/stderr plain text (not buried JSON headers).
  // History reload often omits status — derive from result.success / exit_code.
  const isShellExec = tc.tool_name === "shell_exec"
  const shellCard = isShellExec ? extractShellCardData(tc.params, tc.result) : null
  const shellBodyLong =
    !!shellCard && shellCard.body.length > SHELL_BODY_PREVIEW_CHARS
  const shellFailed = !!shellCard && (shellCard.failed || tc.status === "error")

  // Live tool.start sets status; history reload often omits it — derive from result.
  // S41 multi-adv: shell_exec returns success:true with exit_code≠0 so the agent
  // can read stdout — prefer shellFailed over tc.status for glyph/tone (avoid ✓+red).
  const derivedStatus: string =
    tc.status === "running"
      ? "running"
      : shellCard && shellFailed
        ? "error"
        : tc.status === "success" || tc.status === "error"
          ? tc.status
          : shellCard
            ? hasResult
              ? shellFailed
                ? "error"
                : "success"
              : "unknown"
            : hasResult
              ? tc.result?.success
                ? "success"
                : "error"
              : "unknown"
  const statusTone = statusColor(derivedStatus)
  const statusGlyph =
    derivedStatus === "running" ? "…" : derivedStatus === "success" ? "✓" : derivedStatus === "error" ? "!" : "–"

  // #au4dch ST-3: live progress from tool.progress
  const progressElapsed =
    typeof tc.progress_elapsed_ms === "number" ? tc.progress_elapsed_ms : null
  const progressOut =
    typeof tc.progress_stdout_tail === "string" ? tc.progress_stdout_tail : ""
  const progressErr =
    typeof tc.progress_stderr_tail === "string" ? tc.progress_stderr_tail : ""
  const showLiveProgress =
    derivedStatus === "running" && (progressElapsed != null || progressOut || progressErr)

  // Generic tools: click card to expand JSON. Shell uses its own expand control.
  const canExpandGeneric = hasResult && isLongResult && !isShellExec

  return (
    <div
      style={{
        ...styles.toolCard,
        // G3: status via left hairline only — not a full-border cage
        borderLeftColor: shellFailed ? tokens.danger : statusTone,
        cursor: canExpandGeneric ? "pointer" : "default",
      }}
      onClick={() => {
        if (canExpandGeneric) setExpanded(!expanded)
      }}
      data-testid="tool-call-card"
      data-tool={tc.tool_name || ""}
    >
      <div style={styles.toolHeader}>
        <span
          style={{
            ...styles.toolStatusGlyph,
            color: shellFailed ? tokens.danger : statusTone,
          }}
          aria-label={derivedStatus || "unknown"}
        >
          {statusGlyph}
        </span>
        <span style={styles.toolName}>
          {isShellExec ? "shell_exec · 本机命令" : tc.tool_name}
        </span>
        {isVisionTool && tc.vision_status === "analyzing" && (
          <span style={styles.toolMeta}>Analyzing…</span>
        )}
        {isVisionTool && tc.vision_status === "done" && (
          <span style={styles.toolMeta}>
            Vision {tc.vision_latency_ms ? `${(tc.vision_latency_ms / 1000).toFixed(1)}s` : ""}
          </span>
        )}
        {isVisionTool && tc.vision_status === "cached" && (
          <span style={{ ...styles.toolMeta, color: tokens.textMuted }}>Vision cached</span>
        )}
        {isVisionTool && tc.vision_status === "error" && (
          <span style={{ ...styles.toolMeta, color: tokens.warning }}>Vision failed</span>
        )}
        {canExpandGeneric && (
          <span style={styles.toolExpandHint}>{expanded ? "收起" : "展开"}</span>
        )}
        {showLiveProgress && progressElapsed != null && (
          <span style={styles.toolMeta} data-testid="tool-progress-elapsed">
            {Math.floor(progressElapsed / 1000)}s
          </span>
        )}
        {isShellExec && derivedStatus === "running" && typeof tc.id === "string" && tc.id && (
          <button
            type="button"
            data-testid="shell-stop-btn"
            title="停止此 shell 命令（不中断整轮对话）"
            onClick={(e) => {
              e.stopPropagation()
              chrome.runtime.sendMessage({
                type: "shell.exec.abort",
                tool_call_id: tc.id,
                thread_id: agentState.activeThreadId || undefined,
              })
            }}
            style={{
              ...styles.toolLinkBtn,
              marginLeft: "auto",
              color: tokens.danger,
              border: `1px solid ${tokens.danger}`,
              borderRadius: 4,
              padding: "1px 6px",
              fontSize: 10,
              cursor: "pointer",
              background: "transparent",
            }}
          >
            停止
          </button>
        )}
      </div>
      {shellCard && shellCard.commandPreview && (
        <div
          style={{
            ...styles.toolInset,
            marginTop: 6,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 10,
            lineHeight: 1.4,
            color: tokens.textSecondary,
            wordBreak: "break-all",
          }}
          data-testid="shell-command-preview"
          title={shellCard.command || undefined}
        >
          <span style={{ color: tokens.textMuted, marginRight: 4 }}>$</span>
          {shellCard.commandPreview}
        </div>
      )}
      {shellCard && (hasResult || shellCard.body) && (
        <div data-testid="shell-result-card">
          {formatShellMetaLine(shellCard) && (
            <div
              style={{
                marginTop: 4,
                fontSize: 10,
                color: shellFailed ? tokens.danger : tokens.textMuted,
              }}
              data-testid="shell-meta-line"
            >
              {formatShellMetaLine(shellCard)}
            </div>
          )}
          {shellCard.body ? (
            <>
              <pre
                style={{
                  margin: "6px 0 0",
                  padding: "6px 8px",
                  fontSize: 10,
                  lineHeight: 1.4,
                  maxHeight: shellExpanded ? 320 : 140,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "rgba(0,0,0,0.28)",
                  borderRadius: 4,
                  color: tokens.text,
                }}
                data-testid="shell-stdout-body"
              >
                {shellExpanded || !shellBodyLong
                  ? shellCard.body
                  : shellCard.body.slice(0, SHELL_BODY_PREVIEW_CHARS) + "\n…"}
              </pre>
              {(shellBodyLong || hasResult) && (
                <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                  {shellBodyLong && (
                    <button
                      type="button"
                      data-testid="shell-body-expand"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShellExpanded(!shellExpanded)
                      }}
                      style={styles.toolLinkBtn}
                    >
                      {shellExpanded ? "收起输出" : "展开全部输出"}
                    </button>
                  )}
                  {hasResult && (
                    <button
                      type="button"
                      data-testid="shell-raw-json-toggle"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowRawJson(!showRawJson)
                      }}
                      style={styles.toolLinkBtn}
                    >
                      {showRawJson ? "隐藏 JSON" : "原始 JSON"}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            hasResult && (
              <div style={{ marginTop: 4, fontSize: 10, color: tokens.textMuted }}>
                （无 stdout/stderr）
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowRawJson(!showRawJson)
                  }}
                  style={{ ...styles.toolLinkBtn, marginLeft: 6 }}
                >
                  {showRawJson ? "隐藏 JSON" : "原始 JSON"}
                </button>
              </div>
            )
          )}
          {showRawJson && hasResult && (
            <pre
              style={{
                ...styles.toolResult,
                maxHeight: 200,
                marginTop: 6,
              }}
            >
              <code>{resultStr}</code>
            </pre>
          )}
        </div>
      )}
      {showLiveProgress && (progressOut || progressErr) && (
        <pre
          style={{
            margin: "6px 0 0",
            padding: "6px 8px",
            fontSize: 10,
            lineHeight: 1.35,
            maxHeight: 96,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "rgba(0,0,0,0.25)",
            borderRadius: 4,
            color: tokens.textMuted,
          }}
          data-testid="tool-progress-tail"
        >
          {progressErr ? `[stderr]\n${progressErr}\n` : ""}
          {progressOut || ""}
        </pre>
      )}
      {hasVisionDescription && (
        <div style={styles.toolInset}>
          <div
            style={{
              fontSize: 11,
              color: tokens.text,
              lineHeight: 1.35,
              maxHeight: visionExpanded ? "none" : "2.7em",
              overflow: "hidden",
              whiteSpace: "pre-wrap",
            }}
          >
            {visionDescription}
          </div>
          {visionDescription.length > 100 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setVisionExpanded(!visionExpanded)
              }}
              style={styles.toolLinkBtn}
            >
              {visionExpanded ? "收起" : "展开全部"}
            </button>
          )}
        </div>
      )}
      {computerCard && (
        <div
          style={{
            ...styles.toolInset,
            background: computerFailed ? tokens.dangerSoft : tokens.accentSoft,
            borderLeftColor: computerFailed ? tokens.danger : tokens.accent,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span>
            坐标任务：完成 {computerCard.completed ?? "?"}/{computerCard.total ?? "?"} 步
          </span>
          {computerFailed && computerCard.errorCode && (
            <span style={{ color: tokens.danger, fontWeight: 700 }}>{computerCard.errorCode}</span>
          )}
          {computerCard.canOpenEvidence && (
            <button
              type="button"
              title="在 companion 机器上打开该任务的证据目录"
              onClick={(e) => {
                e.stopPropagation()
                chrome.runtime.sendMessage({ type: "computer.evidence.open", task_id: computerCard.taskId })
              }}
              style={{
                ...styles.toolLinkBtn,
                marginLeft: "auto",
                padding: "1px 6px",
                borderRadius: tokens.radiusSm,
                background: tokens.bgElevated,
              }}
            >
              打开证据目录
            </button>
          )}
        </div>
      )}
      {userHint && (
        <div
          style={{
            ...styles.toolInset,
            background: tokens.warningSoft,
            borderLeftColor: tokens.warning,
            fontSize: 11,
            lineHeight: 1.45,
            color: tokens.text,
          }}
        >
          {userHint}
        </div>
      )}
      {/* Generic tools keep JSON preview; shell_exec uses plain-text card above. */}
      {hasResult && !isShellExec && (
        <pre
          style={{
            ...styles.toolResult,
            maxHeight: expanded ? 240 : 64,
          }}
        >
          <code>
            {expanded
              ? resultStr
              : resultStr.substring(0, TOOL_RESULT_PREVIEW) + (isLongResult ? " ..." : "")}
          </code>
        </pre>
      )}
    </div>
  )
}

function Cursor() {
  return <span style={{
    display: "inline-block",
    width: 1,
    height: 14,
    background: tokens.text,
    marginLeft: 2,
    animation: "blink 1s infinite",
  }} />
}

/**
 * Throttled markdown rendering for the live streaming bubble.
 *
 * chat.token dispatches the FULL accumulated content on every token (not a
 * delta). Running marked.parse + DOMPurify on every token is wasteful and can
 * jank on long replies, so this snapshots content at most once per
 * STREAMING_RENDER_MS via a leading+trailing throttle. Code formatting / LaTeX
 * still appears incrementally as the reply streams in — just not re-parsed on
 * every single token.
 *
 * The trailing-edge timer always fires with the freshest content, so the view
 * is never stale relative to the message committed on chat.done.
 */
const STREAMING_RENDER_MS = 60

function StreamingMarkdown({ content }: { content: string }) {
  const [rendered, setRendered] = useState(content)
  const latestRef = useRef(content)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFlushRef = useRef(0)
  // Kick off mermaid prefetch on the first streamed token (decision G3) so it's
  // warm by the time the message commits and MarkdownRenderer's effect runs.
  const prefetchedRef = useRef(false)
  useEffect(() => {
    if (!prefetchedRef.current && content) {
      prefetchedRef.current = true
      prefetchMermaid()
    }
  }, [content])

  useEffect(() => {
    latestRef.current = content
    // A trailing flush is already scheduled — it will pick up this newer value.
    if (timerRef.current != null) return
    const delay = Math.max(0, STREAMING_RENDER_MS - (Date.now() - lastFlushRef.current))
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      lastFlushRef.current = Date.now()
      setRendered(latestRef.current)
    }, delay)
  }, [content])

  // Cancel any pending flush when the bubble unmounts (streamingContent clears
  // on chat.done). The committed message carries the full content, so dropping
  // a pending trailing update here loses nothing.
  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  return <MarkdownRenderer content={rendered} />
}

// Markdown renderer — uses marked + DOMPurify to sanitize LLM output before rendering.
// react-markdown/remark-gfm ecosystem is ESM-only with Node.js deps that crash in Chrome extension context.
// DOMPurify strips dangerous HTML (scripts, event handlers, etc.) to prevent XSS (P0).
//
// useMemo: parse + sanitize only when content actually changes (audit item 11).
// The previous class-based getDerivedStateFromProps ran the full marked.parse +
// DOMPurify.sanitize unconditionally on every render — including when a parent
// re-rendered due to unrelated state (e.g. streaming token arriving) — costing
// O(N messages × tokens/sec) of parse work per token.
function MarkdownRenderer({ content, renderMermaid = false }: { content: string; renderMermaid?: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const { html, error } = useMemo(() => {
    if (!content) return { html: "", error: false }
    try {
      const rawHtml = marked.parse(content, { async: false }) as string
      const sanitized = DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: [
          "p", "br", "strong", "em", "u", "s", "del", "ins",
          "h1", "h2", "h3", "h4", "h5", "h6",
          "ul", "ol", "li", "blockquote", "hr",
          "a", "code", "pre", "table", "thead", "tbody", "tr", "th", "td",
          "span", "div", "sup", "sub",
          // KaTeX (output:"html") emits only <span> + inline <svg>/<path> for
          // stretchy glyphs (√, large delimiters). DOMPurify still strips
          // <script>/event handlers from these, so adding them stays XSS-safe.
          "svg", "path",
        ],
        ALLOWED_ATTR: [
          "href", "title", "class", "style", "target", "rel",
          // KaTeX span/svg attributes. viewBox/preserveAspectRatio are matched
          // case-insensitively; list both parser-lowercased and camelCase forms.
          "aria-hidden", "d", "fill", "xmlns", "height", "width",
          "viewbox", "preserveaspectratio",
          "viewBox", "preserveAspectRatio",
        ],
        ALLOW_DATA_ATTR: false,
      })
      return { html: sanitized, error: false }
    } catch (e: any) {
      console.error("[MarkdownRenderer] marked.parse error:", e)
      return { html: "", error: true }
    }
  }, [content])

  // Render mermaid blocks (committed messages only — plan A). Runs after React
  // injects the sanitized HTML; re-runs whenever content changes. The async
  // work is resilient to React re-injection (stale-node guard inside).
  useEffect(() => {
    if (!renderMermaid || !html || !bodyRef.current) return
    void renderMermaidBlocks(bodyRef.current)
  }, [html, renderMermaid])

  const handleMarkdownClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const anchor = target.closest("a") as HTMLAnchorElement | null
    if (!anchor || !anchor.href) return
    // Always stop the link from navigating the side panel (audit L3).
    e.preventDefault()
    // Open only external http(s) links in a background tab. Fragment / relative /
    // mailto: links are swallowed — opening them would resolve against the
    // extension origin and open a side-panel copy in a new tab, which is worse.
    if (anchor.protocol === "http:" || anchor.protocol === "https:") {
      chrome.tabs.create({ url: anchor.href, active: false })
    }
  }, [])

  if (error) {
    console.warn("[MarkdownRenderer] falling back to raw text")
    return <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{content}</div>
  }
  if (!html) return null

  return (
    <>
      <style>{markdownCSS}</style>
      <div
        className="markdown-body"
        ref={bodyRef}
        onClick={handleMarkdownClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  )
}

function fillComposer(text: string) {
  window.dispatchEvent(new CustomEvent("cmspark:fill-composer", { detail: { text } }))
}

type SuggestItem =
  | { label: string; fill: string; primary?: boolean }
  | { label: string; action: "compose" | "packs" | "cockpit"; primary?: boolean }

function SuggestionChips({ items }: { items: SuggestItem[] }) {
  return (
    <div style={styles.chipRow}>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          style={{
            ...styles.suggestChip,
            ...(it.primary ? styles.suggestChipPrimary : null),
          }}
          onClick={() => {
            if ("action" in it) {
              if (it.action === "compose") {
                window.dispatchEvent(new CustomEvent("cmspark:open-compose"))
                return
              }
              if (it.action === "packs") {
                window.dispatchEvent(
                  new CustomEvent("cmspark:open-context-panel", { detail: { panel: "packs" } }),
                )
                return
              }
              if (it.action === "cockpit") {
                chrome.runtime.sendMessage({ type: "cockpit.open" }, () => {
                  void chrome.runtime.lastError
                })
              }
              return
            }
            fillComposer(it.fill)
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

function EmptyState({ level }: { level: "chat" | "browser" | "computer" }) {
  // Gemini-breath G2: editorial empty — one title, one line, ≤3 soft suggestions.
  if (level === "browser") {
    return (
      <div style={styles.empty} data-testid="empty-state-browser">
        <div style={styles.emptyKicker}>网页</div>
        <div style={styles.emptyTitle}>要对这页做什么？</div>
        <div style={styles.emptyHint}>总结、提问，或让 Agent 操作当前标签。</div>
        <SuggestionChips
          items={[
            { label: "总结本页", fill: "请总结当前页面的要点" },
            { label: "装配", action: "compose", primary: true },
            { label: "场景", action: "packs" },
          ]}
        />
      </div>
    )
  }
  if (level === "computer") {
    return (
      <div style={styles.empty} data-testid="empty-state-computer">
        <div style={styles.emptyKicker}>计算机</div>
        <div style={styles.emptyTitle}>任务在确认台进行</div>
        <div style={styles.emptyHint}>此处可排队跟进。步骤与确认请用确认台。</div>
        <SuggestionChips
          items={[
            { label: "确认台", action: "cockpit", primary: true },
            { label: "装配", action: "compose" },
          ]}
        />
      </div>
    )
  }
  return (
    <div style={styles.empty} data-testid="empty-state-chat">
      <div style={styles.emptyKicker}>CMspark</div>
      <div style={styles.emptyTitle}>有什么可以帮你？</div>
      <div style={styles.emptyHint}>问问题、写文案，或描述浏览器任务。</div>
      <SuggestionChips
        items={[
          { label: "总结本页", fill: "请总结当前页面的要点" },
          { label: "装配", action: "compose", primary: true },
          { label: "场景", action: "packs" },
        ]}
      />
    </div>
  )
}

const markdownCSS = `
  .markdown-body h1, .markdown-body h2, .markdown-body h3 {
    margin: 10px 0 4px 0;
    font-weight: 600;
    line-height: 1.3;
  }
  .markdown-body h1 { font-size: 16px; border-bottom: 1px solid ${tokens.border}; padding-bottom: 4px; }
  .markdown-body h2 { font-size: 14px; }
  .markdown-body h3 { font-size: 13px; }
  .markdown-body p { margin: 4px 0; line-height: 1.5; }
  .markdown-body ul, .markdown-body ol { margin: 4px 0; padding-left: 18px; }
  .markdown-body li { margin: 2px 0; }
  .markdown-body a { color: ${tokens.accent}; text-decoration: none; }
  .markdown-body strong { font-weight: 600; }
  .markdown-body blockquote {
    margin: 6px 0;
    padding: 4px 10px;
    border-left: 3px solid ${tokens.accent};
    background: ${tokens.bgMuted};
    color: ${tokens.textSecondary};
  }
  .markdown-body table {
    border-collapse: collapse;
    width: 100%;
    margin: 6px 0;
    font-size: 12px;
  }
  .markdown-body th, .markdown-body td {
    border: 1px solid ${tokens.border};
    padding: 4px 8px;
    text-align: left;
  }
  .markdown-body th { background: ${tokens.bgMuted}; font-weight: 600; }
  .markdown-body hr { border: none; border-top: 1px solid ${tokens.border}; margin: 10px 0; }
  .markdown-body code {
    background: ${tokens.bgMuted};
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 11px;
    font-family: ${tokens.fontMono};
  }
  .markdown-body pre {
    background: ${tokens.bgMuted};
    padding: 8px 10px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 6px 0;
    font-size: 11px;
  }
  .markdown-body pre code {
    background: none;
    padding: 0;
    font-size: inherit;
  }
  /* Mermaid diagrams (decisions F3 + default theme).
     - .mermaid-wrap: centers the svg, caps height so tall diagrams scroll
       vertically instead of blowing out the bubble.
     - .mermaid-svg: responsive — scales to bubble width via the svg's viewBox;
       zoom-in cursor signals click-to-expand (opens full-size in a new tab). */
  .markdown-body .mermaid-wrap {
    margin: 6px 0;
    text-align: center;
    max-height: 60vh;
    overflow-y: auto;
  }
  .markdown-body .mermaid-svg {
    max-width: 100%;
    height: auto;
    cursor: zoom-in;
  }
  .markdown-body .mermaid-error {
    color: #c33;
    font-size: 11px;
    margin-bottom: 4px;
  }
`


const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflowY: "auto",
    padding: "14px 14px 16px",
    background: "transparent",
    // Disable scroll-anchoring so late inserts (tools/markdown) cannot yank
    // long threads toward the top; stick-to-bottom is handled in JS.
    overflowAnchor: "none" as any,
  },
  contentInner: {
    minHeight: "min-content",
  },
  empty: {
    color: tokens.textSecondary,
    textAlign: "center",
    padding: "40px 16px 24px",
    fontSize: 13,
    fontFamily: tokens.font,
  },
  emptyKicker: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: tokens.textSecondary,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: 650,
    color: tokens.text,
    marginBottom: 8,
    letterSpacing: "-0.02em",
    lineHeight: 1.3,
  },
  emptyHint: {
    fontSize: 13,
    color: tokens.textSecondary,
    lineHeight: 1.55,
    maxWidth: 260,
    margin: "0 auto 20px",
  },
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    maxWidth: 300,
    margin: "0 auto",
  },
  suggestChip: {
    border: `1px solid ${tokens.border}`,
    background: tokens.bgElevated,
    color: tokens.accentText,
    borderRadius: tokens.radiusPill,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 550,
    cursor: "pointer",
    fontFamily: tokens.font,
    boxShadow: tokens.shadowSm,
  },
  suggestChipPrimary: {
    borderColor: "rgba(79, 70, 229, 0.25)",
    background: tokens.accentSoft,
    color: tokens.accentText,
    fontWeight: 650,
    boxShadow: "0 2px 8px rgba(79, 70, 229, 0.12)",
  },
  userMsg: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 10,
  },
  agentMsg: {
    display: "flex",
    justifyContent: "flex-start",
    marginBottom: 10,
  },
  messageCol: {
    display: "flex",
    flexDirection: "column",
    maxWidth: "90%",
    width: "fit-content" as const,
  },
  userBubble: {
    background: tokens.userBubbleBg,
    color: tokens.userBubbleText,
    borderRadius: `${tokens.radiusBubble}px ${tokens.radiusBubble}px 4px ${tokens.radiusBubble}px`,
    padding: "9px 13px",
    fontSize: 13,
    lineHeight: 1.5,
    wordBreak: "break-word" as const,
    whiteSpace: "pre-wrap",
    boxShadow: "0 2px 10px rgba(79, 70, 229, 0.20)",
  },
  agentBubble: {
    background: tokens.assistantBubbleBg,
    color: tokens.assistantBubbleText,
    borderRadius: `${tokens.radiusBubble}px ${tokens.radiusBubble}px ${tokens.radiusBubble}px 4px`,
    padding: "9px 13px",
    fontSize: 13,
    lineHeight: 1.5,
    wordBreak: "break-word" as const,
    border: `1px solid ${tokens.border}`,
    boxShadow: tokens.shadowSm,
  },
  statusBubble: {
    background: tokens.accentSoft,
    borderRadius: `${tokens.radiusBubble}px ${tokens.radiusBubble}px ${tokens.radiusBubble}px 4px`,
    padding: "8px 12px",
    maxWidth: "88%",
    fontSize: 12,
    color: tokens.accentText,
    fontStyle: "italic" as const,
    display: "flex",
    alignItems: "center",
    gap: 4,
    border: "1px solid rgba(79, 70, 229, 0.12)",
  },
  reasoningWrap: {
    marginBottom: 6,
    maxWidth: "100%",
    borderRadius: tokens.radiusBubble,
    border: `1px solid ${tokens.border}`,
    background: "rgba(15, 23, 42, 0.03)",
    overflow: "hidden" as const,
  },
  reasoningToggle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    gap: 8,
    padding: "6px 10px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: tokens.font,
    color: tokens.textSecondary,
    fontSize: 11,
    fontWeight: 600,
  },
  reasoningLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
  },
  reasoningChevron: {
    color: tokens.textMuted,
    fontSize: 11,
  },
  reasoningMeta: {
    fontWeight: 500,
    color: tokens.textMuted,
  },
  reasoningBody: {
    padding: "0 10px 8px",
    maxHeight: 220,
    overflowY: "auto" as const,
  },
  reasoningPre: {
    margin: 0,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    fontSize: 11,
    lineHeight: 1.45,
    color: tokens.textSecondary,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  fakeEnd: {
    display: "block",
    width: "100%",
    textAlign: "left",
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  statusDots: {
    display: "inline-block",
    width: 20,
    overflow: "hidden",
    animation: "cmspark-dots 1.5s steps(4, end) infinite",
  },
  actionBar: {
    display: "flex",
    gap: 2,
    marginTop: 3,
    padding: "2px 4px",
    background: tokens.bgMuted,
    borderRadius: tokens.radiusSm,
  },
  editWrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    width: "100%",
  },
  editTextarea: {
    width: "100%",
    border: `1px solid ${tokens.accent}`,
    borderRadius: tokens.radiusLg,
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: "inherit",
    resize: "none" as const,
    outline: "none",
    minHeight: 60,
    boxSizing: "border-box" as const,
  },
  editActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  },
  editBtn: {
    padding: "6px 12px",
    borderRadius: tokens.radiusSm,
    fontSize: 12,
    cursor: "pointer",
  },
  actionBtn: {
    background: "none",
    border: "none",
    fontSize: 12,
    color: tokens.textSecondary,
    cursor: "pointer",
    padding: "3px 5px",
    borderRadius: tokens.radiusSm,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: `background ${tokens.transitionFast} ease, color ${tokens.transitionFast} ease`,
  },
  expandBtn: {
    background: "none",
    border: "none",
    color: tokens.accent,
    cursor: "pointer",
    fontSize: 12,
    padding: "4px 0",
    marginTop: 4,
    fontWeight: 500,
  },
  // G3: elevated card + 2px left accent hairline (status overrides color)
  toolCard: {
    marginTop: 8,
    border: `1px solid ${tokens.border}`,
    borderLeft: `2px solid ${tokens.accent}`,
    borderRadius: tokens.radiusMd,
    padding: "8px 10px",
    background: tokens.bgElevated,
    fontSize: 11,
    boxShadow: tokens.shadowSm,
  },
  toolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    marginBottom: 0,
    minHeight: 18,
  },
  toolStatusGlyph: {
    fontSize: 10,
    fontWeight: 700,
    width: 12,
    textAlign: "center" as const,
    flexShrink: 0,
  },
  toolName: {
    fontWeight: 600,
    fontFamily: tokens.fontMono,
    fontSize: 11,
    color: tokens.text,
  },
  toolMeta: {
    fontSize: 10,
    color: tokens.accent,
    marginLeft: 4,
  },
  toolExpandHint: {
    marginLeft: "auto",
    fontSize: 10,
    color: tokens.textMuted,
    flexShrink: 0,
  },
  toolInset: {
    marginTop: 5,
    padding: "5px 8px",
    background: tokens.accentSoft,
    borderRadius: tokens.radiusSm,
    borderLeft: `2px solid ${tokens.accent}`,
    fontSize: 11,
    color: tokens.text,
  },
  toolLinkBtn: {
    fontSize: 10,
    color: tokens.accent,
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "2px 0",
    marginTop: 1,
    fontFamily: tokens.font,
  },
  toolResult: {
    margin: "5px 0 0",
    fontSize: 10,
    lineHeight: 1.35,
    overflowY: "auto",
    background: tokens.bgMuted,
    padding: "5px 8px",
    borderRadius: tokens.radiusSm,
    fontFamily: tokens.fontMono,
  },
}
