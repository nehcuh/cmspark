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
  SETTINGS_POINTER_CTA,
  extractSettingsPointer,
  settingsPointerLine,
} from "../utils/settings-pointer"
import {
  extractShellCardData,
  formatShellMetaLine,
  SHELL_BODY_PREVIEW_CHARS,
} from "../utils/shell-card-utils"
import { extractRedactedStub, isRedactedStubContent } from "../utils/redacted-stub-utils"
import { RetrievedSourcesChips } from "./RetrievedSourcesChips"
import { fillKnowledgeDraftFromSuggestion, formatKnowledgeTagsInput } from "../utils/knowledge-preview"
import {
  KNOWLEDGE_IMPORT_CONFIRM_LABEL,
  KNOWLEDGE_IMPORT_FORCE_LABEL,
} from "../utils/knowledge-distribution"
import { fleetProcessingLabel } from "./focus-band-priority"
import { collectRunningTools, formatRunningToolsLabel } from "../utils/running-tools"
import {
  buildScopedRunBusyInput,
  deriveRunBusy,
  deriveThreadBusy,
  isIntentOnlyRunBusy,
} from "../utils/thread-busy"
import { tokens, statusColor } from "../ui/tokens"
import { captionOnlyForEdit, previewDataUrl } from "../utils/image-compose"
import { previewImageSafe } from "../utils/computer-utils"
import type { MessageAttachment } from "../types"
import {
  CompanionMark,
  IconBranch,
  IconChat,
  IconCopy,
  IconDownload,
  IconEdit,
  IconGlobe,
  IconList,
  IconMonitor,
  IconRefresh,
  type IconProps,
} from "../ui/icons"
import { emptyStateCopy, type EmptyInvite } from "../empty-state-copy"
import { compactBannerKind } from "../utils/context-window-copy"
import { truncationHonestyChip } from "../chat-shell-copy"
import { RunProgress } from "./RunProgress"
import { listSig } from "./run-progress-view"
import { CHAT_MARKED_OPTIONS } from "../utils/markdown-gfm"
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
marked.use(CHAT_MARKED_OPTIONS)

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
    hydrating,
  } = state
  const contextCompacted =
    activeThreadId && contextCompactedByThreadId[activeThreadId]
      ? contextCompactedByThreadId[activeThreadId]
      : null
  const runItems = threads.find((t) => t.id === activeThreadId)?.run_progress?.items
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
  // "none" falls through to the dropped-history copy, which already reads the
  // runtime_context_budget fallback when no live event is stored.
  const compactBanner = compactBannerKind(contextCompacted)
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

  const handlePopout = useCallback(() => {
    if (!activeThreadId) return
    chrome.runtime.sendMessage({ type: "overlay.shell.open", thread_id: activeThreadId }, (response) => {
      if (chrome.runtime.lastError || response?.ok === false) {
        window.dispatchEvent(new CustomEvent("cmspark:toast", { detail: "无法弹出对话框" }))
      }
    })
  }, [activeThreadId])

  // Export the Q&A pair containing this message as Markdown (UI-side download).
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
    <div style={styles.shell}>
      <div style={styles.popoutBar}>
        <span aria-hidden style={styles.popoutDots}>⋯</span>
        <button
          type="button"
          disabled={!activeThreadId}
          onClick={handlePopout}
          style={{
            ...styles.popoutBtn,
            opacity: activeThreadId ? 1 : 0.45,
            cursor: activeThreadId ? "pointer" : "not-allowed",
          }}
        >
          弹出对话框
        </button>
      </div>
      <div style={styles.container} ref={containerRef} onScroll={handleScroll}>
      <div ref={contentRef} style={styles.contentInner}>
        {showCompactBanner && (
          <div
            role="status"
            style={{
              margin: "8px 10px 4px",
              padding: "8px 10px",
              borderRadius: 8,
              background: tokens.warningSoft,
              border: `1px solid ${tokens.border}`,
              fontSize: 11,
              lineHeight: 1.45,
              color: tokens.warningText,
            }}
          >
            {compactBanner === "shrink" ? (
              <>
                <strong>工具结果已截断</strong>
                （自动压缩未丢掉更早轮次，但最长工具正文改成了占位，避免半截 JSON）。
                下方消息列表仍为完整原文。
              </>
            ) : compactBanner === "unknown" ? (
              <>
                <strong>上下文可能已被压缩</strong>
                （当前 companion 版本未报告压缩细节）。
                下方消息列表仍为完整原文；升级 companion 到 0.5.8+ 可查看准确信息。
              </>
            ) : compactBanner === "prompt" ? (
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
              background: tokens.bgElevated,
              border: `1px solid ${tokens.border}`,
              boxShadow: tokens.shadowPopover,
              fontSize: 12,
              lineHeight: 1.5,
              color: tokens.text,
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
                          <li key={i}>{typeof t === "string" ? t : t && typeof t === "object" && "text" in t ? String((t as { text?: string }).text ?? "") : ""}</li>
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
        {runItems && runItems.length > 0 && activeThreadId ? (
          // key by thread+listSig: thread switch or list identity remounts to defaultExpanded(n).
          // Sticky/collapse styling lives in RunProgress.
          <RunProgress
            key={`${activeThreadId}:${listSig(runItems)}`}
            threadId={activeThreadId}
            items={runItems}
          />
        ) : null}
        {messages.length === 0 &&
          !hydrating &&
          !streamingContent &&
          !streamingReasoning &&
          !processingLabel && <EmptyState level={level} />}
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
      <KnowledgeImportModal />
      </div>
    </div>
  )
}

function KnowledgeImportModal() {
  const { state, dispatch } = useAgentStore()
  const p = state.knowledgePreview
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [pin, setPin] = useState(false)
  // #272 user-dirty (spec §4.3): fields the user edited are never overwritten
  // by late server data (Phase-1 parse reply, Phase-2 LLM suggestion).
  const dirtyRef = useRef<{ title: boolean; description: boolean; tags: boolean }>({
    title: false,
    description: false,
    tags: false,
  })
  // N5/F1: the 「AI 建议」 badge lights only for fields the LLM suggestion
  // actually wrote — a dirty field the suggestion skipped shows no badge.
  const [aiFilled, setAiFilled] = useState<{ description: boolean; tags: boolean }>({
    description: false,
    tags: false,
  })
  const payloadRef = useRef<unknown>(null)
  useEffect(() => {
    if (!p) return
    if (payloadRef.current !== p.payload) {
      // New import request — reset the form from the sentinel.
      payloadRef.current = p.payload
      dirtyRef.current = { title: false, description: false, tags: false }
      setAiFilled({ description: false, tags: false })
      setTitle(p.title || "")
      setDescription(p.description || "")
      // #272: prefill the source file's own frontmatter tags (was setTags("")
      // unconditionally, silently dropping them).
      setTags(formatKnowledgeTagsInput(p.tags))
      setPin(false)
      return
    }
    // Same request, fresh server data (Phase-1 reply): fill untouched fields only.
    if (!dirtyRef.current.title) setTitle(p.title || "")
    if (!dirtyRef.current.description) setDescription(p.description || "")
    if (!dirtyRef.current.tags) setTags(formatKnowledgeTagsInput(p.tags))
  }, [p])
  // #272 Phase 2: the LLM suggestion fills only fields the user hasn't edited.
  const suggested = p?.suggested
  useEffect(() => {
    if (!suggested) return
    const isLlm = suggested.source === "llm"
    const next = fillKnowledgeDraftFromSuggestion({ description, tags }, dirtyRef.current, suggested)
    const filledDescription = isLlm && !dirtyRef.current.description && !!suggested.description
    const filledTags = isLlm && !dirtyRef.current.tags && Array.isArray(suggested.tags) && suggested.tags.length > 0
    setDescription(next.description)
    setTags(next.tags)
    if (filledDescription || filledTags) {
      setAiFilled((cur) => ({
        description: cur.description || filledDescription,
        tags: cur.tags || filledTags,
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dirtyRef is the guard; re-running on keystrokes would fight the user
  }, [suggested])
  // M4/N2 watchdog: extract_pending armed but the Phase-2 frame never arrives
  // (companion died mid-extract) → local timeout, heuristic draft stays, the
  // confirm button is unaffected.
  const extractId = state.knowledgePreviewExtractId
  useEffect(() => {
    if (!p?.extractPending || !extractId) return
    const timer = setTimeout(() => {
      dispatch({
        type: "SET_KNOWLEDGE_PREVIEW_SUGGESTED",
        replyId: extractId,
        extractError: "解读超时，已保留草稿",
      })
    }, 17000) // companion's extraction timeout is 15s; +2s RTT margin so a late suggested frame isn't preempted
    return () => clearTimeout(timer)
  }, [p?.extractPending, extractId, dispatch])
  if (!p) return null
  const abortExtract = () => {
    // Abort any in-flight companion extraction (跳过解读/取消/确认) so the
    // 15s LLM call doesn't run to completion for a modal that's gone.
    const id = state.knowledgePreviewExtractId || state.knowledgePreviewPendingId
    if (id) chrome.runtime.sendMessage({ type: "knowledge.preview_cancel", id })
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="确认导入知识"
      style={{
        position: "fixed",
        inset: 0,
        background: tokens.scrimStrong,
        zIndex: 11000,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div style={{ background: tokens.bg, width: "100%", maxHeight: "80%", overflow: "auto", padding: 12, borderRadius: "12px 12px 0 0" }}>
        <strong style={{ fontSize: 13 }}>确认导入知识库</strong>
        {p.duplicate_of?.title ? (
          <div style={{ fontSize: 11, color: tokens.textSecondary, marginTop: 6 }}>
            内容与已有文档《{p.duplicate_of.title}》完全相同
          </div>
        ) : null}
        {p.extractPending && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: tokens.textSecondary, marginTop: 6 }}>
            <span>正在解读…</span>
            <button
              type="button"
              onClick={() => {
                abortExtract()
                dispatch({ type: "SKIP_KNOWLEDGE_PREVIEW_EXTRACT" })
              }}
            >
              跳过解读
            </button>
          </div>
        )}
        {!p.extractPending && p.extractError && (
          <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 6 }}>AI 解读不可用，已保留草稿，可手动修改后导入</div>
        )}
        <label style={{ display: "block", fontSize: 11, marginTop: 8 }}>标题</label>
        <input value={title} onChange={(e) => { dirtyRef.current.title = true; setTitle(e.target.value) }} style={{ width: "100%", fontSize: 12, padding: 6 }} />
        <label style={{ display: "block", fontSize: 11, marginTop: 8 }}>
          说明
          {aiFilled.description && <span style={{ marginLeft: 6, fontSize: 10, color: tokens.accent }}>AI 建议</span>}
        </label>
        <input value={description} onChange={(e) => { dirtyRef.current.description = true; setAiFilled((cur) => ({ ...cur, description: false })); setDescription(e.target.value) }} style={{ width: "100%", fontSize: 12, padding: 6 }} />
        <label style={{ display: "block", fontSize: 11, marginTop: 8 }}>
          标签（逗号分隔）
          {aiFilled.tags && <span style={{ marginLeft: 6, fontSize: 10, color: tokens.accent }}>AI 建议</span>}
        </label>
        <input value={tags} onChange={(e) => { dirtyRef.current.tags = true; setAiFilled((cur) => ({ ...cur, tags: false })); setTags(e.target.value) }} style={{ width: "100%", fontSize: 12, padding: 6 }} />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginTop: 8 }}>
          <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
          钉到本对话
        </label>
        <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto", background: tokens.bgElevated, padding: 8, marginTop: 8 }}>
          {p.preview || "（无预览）"}
          {p.char_count > (p.preview || "").length ? "\n…" : ""}
        </pre>
        <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
          {(p.preview === "正在解析…" || p.preview === "正在抓取…") && (
            <button
              type="button"
              onClick={() => {
                abortExtract()
                dispatch({ type: "SKIP_KNOWLEDGE_PREVIEW_PARSE" })
              }}
            >
              跳过解析，手动填写
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              abortExtract()
              dispatch({ type: "CLEAR_KNOWLEDGE_PREVIEW" })
            }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={
              p.preview === "正在解析…" ||
              p.preview === "正在抓取…" ||
              (p.preview || "").startsWith("预览失败") ||
              !(p.payload && (p.payload.file || p.payload.url || p.payload.content))
            }
            onClick={() => {
              abortExtract()
              chrome.runtime.sendMessage({
                ...p.payload,
                type: "knowledge.import",
                user_gesture: true,
                // #293: preview flagged an exact duplicate — only an explicit
                // 仍导入 click carries force past the server-side gate.
                force: p.duplicate_of ? true : undefined,
                title,
                description,
                tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
                pin_thread_id: pin ? state.activeThreadId : undefined,
              })
              dispatch({ type: "CLEAR_KNOWLEDGE_PREVIEW" })
            }}
          >
            {p.duplicate_of ? KNOWLEDGE_IMPORT_FORCE_LABEL : KNOWLEDGE_IMPORT_CONFIRM_LABEL}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 48px transcript thumb — preview JPEG or empty tile + name. No lightbox. */
function UserImageThumb({ att }: { att: MessageAttachment }) {
  const preview = typeof att.preview_jpeg_b64 === "string" ? att.preview_jpeg_b64 : ""
  const [broken, setBroken] = useState(false)
  const src = !broken && previewImageSafe(preview) ? previewDataUrl(preview) : ""
  if (src) {
    return (
      <img
        src={src}
        alt={att.name || "image"}
        width={48}
        height={48}
        style={styles.thumbImg}
        onError={() => setBroken(true)}
      />
    )
  }
  return (
    <div style={styles.thumbEmpty} title={att.name || "image"}>
      {att.name || "image"}
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
  // SEC-C: a reloaded tool row's content IS the redacted-stub JSON
  // (companion llm/tool-batch-heal.ts persists JSON.stringify(safeResult)).
  // The ToolCallCard hint already carries the info — skip stub bubble text.
  // Non-sensitive tool rows are unaffected: their content keeps rendering.
  const isToolStubContent = !isUser && isRedactedStubContent(msg.content)
  const honestyChip = !isUser ? truncationHonestyChip(msg) : null
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
                style={{ ...styles.editBtn, background: tokens.accent, color: tokens.userBubbleText, border: "none" }}
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
              {!isToolStubContent &&
                (hasLongContent ? (
                  <CollapsibleMarkdown content={msg.content} maxPreview={LONG_CONTENT_PREVIEW} renderMermaid />
                ) : (
                  <MarkdownRenderer content={msg.content} renderMermaid />
                ))}
              {msg.tool_calls?.map((tc: any) => (
                <ToolCallCard key={tc.id} tc={tc} />
              ))}
            </div>
            {honestyChip ? (
              <div style={styles.truncChip} role="status">
                {honestyChip}
              </div>
            ) : null}
            {!isUser && Array.isArray(msg.retrieved_sources) && msg.retrieved_sources.length > 0 ? (
              <RetrievedSourcesChips sources={msg.retrieved_sources} routing={msg.knowledge_routing} />
            ) : null}
            {isUser && Array.isArray(msg.attachments) && msg.attachments.length > 0 ? (
              <>
              <div style={styles.thumbRow} aria-label="附图">
                {msg.attachments.map((att: MessageAttachment, i: number) => (
                  <UserImageThumb key={`${att.sha256 || att.name}-${i}`} att={att} />
                ))}
              </div>
              <div style={styles.attachMeta}>
                {`📎 ${msg.attachments.map((a: MessageAttachment) => a.name).join(", ")}`}
                {msg.attachments.find((a: MessageAttachment) => a.dest_host)?.dest_host
                  ? ` · → ${msg.attachments.find((a: MessageAttachment) => a.dest_host)!.dest_host}`
                  : ""}
              </div>
              </>
            ) : null}
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
                  onClick={() => { setIsEditing(true); setEditingText(captionOnlyForEdit(msg.content || "")) }}
                  title="编辑并重新生成"
                  aria-label="编辑并重新生成"
                >
                  <IconEdit size={13} />
                </button>
              )}
              {isUser && /<document filename=/.test(msg.content || "") && (
                <button
                  type="button"
                  style={styles.actionBtn}
                  title="收入知识库"
                  aria-label="收入知识库"
                  onClick={() => {
                    const m = /<document filename="([^"]+)">\n?([\s\S]*?)\n?<\/document>/.exec(msg.content || "")
                    if (!m) return
                    const filename = m[1]
                    const body = m[2] || ""
                    dispatch({
                      type: "SET_KNOWLEDGE_PREVIEW",
                      preview: {
                        title: filename.replace(/\.[^.]+$/, ""),
                        description: "",
                        preview: body.slice(0, 4000),
                        char_count: body.length,
                        payload: { content: body },
                      },
                    })
                  }}
                >
                  入知识
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
              <button type="button" style={styles.actionBtn} onClick={() => onExport(msg.id)} title="导出此条为 Markdown" aria-label="导出此条为 Markdown">
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
    prev.msg.attachments === next.msg.attachments &&
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
  const { state: agentState, dispatch } = useAgentStore()
  const [expanded, setExpanded] = useState(false)
  const [visionExpanded, setVisionExpanded] = useState(false)
  const [shellExpanded, setShellExpanded] = useState(false)
  const [showRawJson, setShowRawJson] = useState(false)
  const hasResult = tc.result && !tc.error
  const userHint = hasResult ? toolResultUserHint(tc.result) : null
  // SEC-C redacted stub: a reloaded thread reads the collapsed placeholder from
  // threads/*.json (companion security/tool-persistence-redact.ts). Render a
  // friendly hint instead of the raw stub JSON — live turns are unaffected.
  const redactedStub = hasResult ? extractRedactedStub(tc.result) : null
  // collapseResult (shape B) swallows `error` on failure rows — success===false
  // is the only surviving signal, so surface it in the hint line.
  const stubFailed = redactedStub !== null && tc.result?.success === false
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

  // #322: SETTINGS_REQUIRED pointer — restricted capability not configured.
  // Fixed template + deep-link into the settings accordion; nothing pre-filled.
  const settingsPointer = hasResult ? extractSettingsPointer(tc.result) : null

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
  // Redacted stubs never expand — there is no content to reveal.
  const canExpandGeneric = hasResult && isLongResult && !isShellExec && !redactedStub

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
      {shellCard && !redactedStub && shellCard.commandPreview && (
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
      {shellCard && !redactedStub && (hasResult || shellCard.body) && (
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
                  background: tokens.shellOutputBg,
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
            background: tokens.toolTailBg,
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
      {computerCard && !redactedStub && (
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
      {settingsPointer && (
        <div
          style={{
            ...styles.toolInset,
            background: tokens.accentSoft,
            borderLeftColor: tokens.accent,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            fontSize: 11,
            lineHeight: 1.45,
          }}
          data-testid="settings-pointer-card"
        >
          <span>{settingsPointerLine(settingsPointer)}</span>
          <button
            type="button"
            data-testid="settings-pointer-open-btn"
            onClick={(e) => {
              e.stopPropagation()
              dispatch({
                type: "OPEN_SETTINGS_SECTION",
                section: settingsPointer.settings_section,
              })
            }}
            style={{
              ...styles.toolLinkBtn,
              marginLeft: "auto",
              padding: "1px 6px",
              borderRadius: tokens.radiusSm,
              background: tokens.bgElevated,
            }}
          >
            {SETTINGS_POINTER_CTA}
          </button>
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
      {/* SEC-C redacted stub: persisted placeholder — show hint, not raw JSON. */}
      {redactedStub && (
        <div
          style={{
            ...styles.toolResult,
            fontFamily: "inherit",
            color: tokens.textMuted,
          }}
          data-testid="redacted-stub-hint"
        >
          {`出于安全未持久化：原始长度 ${redactedStub.len.toLocaleString()} 字符 · sha256 ${redactedStub.sha256}。实时轮次中内容对模型与界面可见（超长会截断），重新加载后不再保留。${stubFailed ? "该调用当时已失败。" : ""}`}
        </div>
      )}
      {/* Generic tools keep JSON preview; shell_exec uses plain-text card above. */}
      {hasResult && !isShellExec && !redactedStub && (
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
      const rawHtml = marked.parse(content, { async: false, ...CHAT_MARKED_OPTIONS }) as string
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
  | { label: string; fill: string; Icon: (p: IconProps) => JSX.Element }
  | { label: string; action: "compose" | "packs" | "cockpit"; Icon: (p: IconProps) => JSX.Element }

const inviteRowCSS = `
  .invite-row { color: ${tokens.text}; }
  .invite-row:hover,
  .invite-row:focus-visible { color: ${tokens.accentText}; }
  .invite-row:focus-visible {
    outline: none;
    box-shadow: ${tokens.shadowFocus};
    border-radius: ${tokens.radiusSm}px;
  }
`

function InvitationRows({ items }: { items: SuggestItem[] }) {
  return (
    <div style={styles.inviteCol}>
      <style>{inviteRowCSS}</style>
      {items.map((it) => {
        const Icon = it.Icon
        return (
          <button
            key={it.label}
            type="button"
            className="invite-row"
            style={styles.inviteRow}
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
            <Icon size={16} />
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

function inviteIcon(it: EmptyInvite): (p: IconProps) => JSX.Element {
  if (it.kind === "action" && it.action === "cockpit") return IconMonitor
  if (it.kind === "action") return IconList
  if (it.label.includes("起草")) return IconChat
  return IconGlobe
}

function EmptyState({ level }: { level: "chat" | "browser" | "computer" }) {
  const [pageTitle, setPageTitle] = useState<string | null>(null)
  const [omitPage, setOmitPage] = useState(false)

  useEffect(() => {
    const refresh = () => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          setPageTitle(null)
          return
        }
        setPageTitle(tabs[0]?.title ?? null)
      })
    }
    refresh()
    const onActivated = () => refresh()
    const onUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.status === "complete" || changeInfo.title || changeInfo.url) {
        refresh()
      }
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
    }
  }, [])

  const { title, hint, items, pageChip } = emptyStateCopy(level, omitPage ? null : pageTitle)
  const rows: SuggestItem[] = items.map((it) =>
    it.kind === "fill"
      ? { label: it.label, fill: it.fill, Icon: inviteIcon(it) }
      : { label: it.label, action: it.action, Icon: inviteIcon(it) },
  )
  const testId =
    level === "browser" ? "empty-state-browser" : level === "computer" ? "empty-state-computer" : "empty-state-chat"

  return (
    <div style={styles.empty} data-testid={testId}>
      <CompanionMark size={92} />
      <div style={styles.emptyTitle}>{title}</div>
      {hint ? <div style={styles.emptyHint}>{hint}</div> : null}
      {rows.length > 0 ? <InvitationRows items={rows} /> : null}
      {pageChip ? (
        <div style={styles.pageChip} data-testid="empty-page-chip">
          <span style={styles.pageChipText}>{pageChip}</span>
          <button
            type="button"
            style={styles.pageChipHide}
            aria-label="隐藏当前页"
            onClick={() => setOmitPage(true)}
          >
            ×
          </button>
        </div>
      ) : null}
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
  .markdown-body p { margin: 8px 0; line-height: 1.55; }
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
    color: ${tokens.danger};
    font-size: 11px;
    margin-bottom: 4px;
  }
`


const styles: Record<string, React.CSSProperties> = {
  shell: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "transparent",
  },
  popoutBar: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 12px",
    borderBottom: `1px solid ${tokens.border}`,
    background: tokens.bg,
  },
  popoutDots: {
    color: tokens.textMuted,
    fontSize: 14,
    letterSpacing: 1,
    userSelect: "none" as const,
    lineHeight: 1,
  },
  popoutBtn: {
    border: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
    color: tokens.text,
    borderRadius: tokens.radiusPill,
    fontSize: 12,
    padding: "4px 10px",
    fontFamily: tokens.font,
    lineHeight: 1.3,
  },
  container: {
    flex: 1,
    overflowY: "auto",
    padding: "14px 14px 16px",
    background: "transparent",
    display: "flex",
    flexDirection: "column",
    // Collapsed RunProgress header ~44–52px; keep anchors out from under the card.
    scrollPaddingTop: 52,
    // Disable scroll-anchoring so late inserts (tools/markdown) cannot yank
    // long threads toward the top; stick-to-bottom is handled in JS.
    overflowAnchor: "none" as any,
  },
  contentInner: {
    minHeight: "100%",
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },
  empty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: tokens.text,
    textAlign: "center",
    padding: "12px 8px 8px",
    fontFamily: tokens.font,
  },
  emptyTitle: {
    fontSize: tokens.emptyTitle,
    fontWeight: 600,
    color: tokens.text,
    margin: "18px 0 8px",
    letterSpacing: "-0.035em",
    lineHeight: 1.25,
  },
  emptyHint: {
    fontSize: 13,
    color: tokens.textSecondary,
    lineHeight: 1.5,
    maxWidth: 260,
    margin: "0 0 28px",
  },
  pageChip: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 20,
    maxWidth: 260,
    width: "100%",
    padding: "6px 8px 6px 12px",
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusPill,
    background: tokens.bgMuted,
    color: tokens.textSecondary,
    fontSize: 12,
    fontFamily: tokens.font,
    boxSizing: "border-box" as const,
  },
  pageChipText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    flex: 1,
    textAlign: "left" as const,
  },
  pageChipHide: {
    flexShrink: 0,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: tokens.textMuted,
    fontSize: 14,
    lineHeight: 1,
    padding: "0 4px",
    fontFamily: tokens.font,
  },
  inviteCol: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "100%",
    maxWidth: 260,
    alignItems: "flex-start",
  },
  inviteRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: 0,
    border: "none",
    background: "transparent",
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.4,
    cursor: "pointer",
    fontFamily: tokens.font,
    textAlign: "left" as const,
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
  thumbRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
    marginTop: 6,
    alignSelf: "flex-end" as const,
    maxWidth: "100%",
  },
  thumbImg: {
    width: 48,
    height: 48,
    objectFit: "cover" as const,
    borderRadius: tokens.radiusSm,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
    display: "block",
  },
  thumbEmpty: {
    width: 48,
    height: 48,
    borderRadius: tokens.radiusSm,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
    color: tokens.textMuted,
    fontSize: 11,
    lineHeight: 1.2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    padding: 3,
    boxSizing: "border-box" as const,
    overflow: "hidden",
    wordBreak: "break-all" as const,
  },
  attachMeta: {
    alignSelf: "flex-end" as const,
    marginTop: 4,
    fontSize: 11,
    color: tokens.textSecondary,
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
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
    boxShadow: tokens.shadowAccent,
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
  truncChip: {
    marginTop: 6,
    alignSelf: "flex-start" as const,
    fontSize: 11,
    lineHeight: 1.4,
    color: tokens.warning,
    background: tokens.warningSoft,
    border: `1px solid ${tokens.border}`,
    borderRadius: 10,
    padding: "2px 8px",
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
    border: `1px solid ${tokens.accentBorderSoft}`,
  },
  reasoningWrap: {
    marginBottom: 6,
    maxWidth: "100%",
    borderRadius: tokens.radiusBubble,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgSubtle,
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
    border: `1px solid ${tokens.warningBorder}`,
    background: tokens.warningSoft,
    color: tokens.warningText,
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
