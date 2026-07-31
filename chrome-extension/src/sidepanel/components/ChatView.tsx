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
  const { messages, streamingContent, activeThreadId, isProcessing, sendShortcut } = state
  const containerRef = useRef<HTMLDivElement>(null)
  const lastMessageCountRef = useRef(messages.length)
  const pinnedRef = useRef(true)

  const { level } = useCapabilityMode()

  // Show processing label only when there is an active request (no emoji chrome)
  const processingLabel = (() => {
    if (streamingContent) return null
    if (!isProcessing) return null
    const last = messages[messages.length - 1]
    if (last?.role === "assistant" && last.tool_calls) {
      const running = last.tool_calls.filter((tc: any) => tc.status === "running")
      if (running.length > 0) {
        const names = running.map((tc: any) => tc.tool_name).join(", ")
        return `执行中: ${names}`
      }
    }
    return "思考中"
  })()

  // Auto-scroll to bottom when new messages arrive or streaming updates.
  // Respects user scroll: if the user has scrolled up to read history, we stop
  // forcing the view back to the bottom on every token (audit L5).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Scroll when message count changes or streaming content updates
    if (messages.length !== lastMessageCountRef.current || streamingContent) {
      lastMessageCountRef.current = messages.length
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (pinnedRef.current) {
          container.scrollTop = container.scrollHeight
        }
      })
    }
  }, [messages.length, streamingContent])

  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    pinnedRef.current = distanceFromBottom < 60
  }, [])

  // On thread switch, re-pin to the bottom so the new thread auto-scrolls
  // instead of inheriting a stale "user scrolled up" pin from the previous
  // thread (audit L5).
  useEffect(() => {
    pinnedRef.current = true
    const container = containerRef.current
    if (!container) return
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight
    })
  }, [activeThreadId])

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
    })
  }, [activeThreadId])

  return (
    <div style={styles.container} ref={containerRef} onScroll={handleScroll}>
      {messages.length === 0 && !streamingContent && !processingLabel && (
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
          dispatch={dispatch}
        />
      ))}
      {streamingContent && (
        <div style={styles.agentMsg}>
          <div style={styles.agentBubble}>
            <StreamingMarkdown content={streamingContent} />
            <Cursor />
          </div>
        </div>
      )}
      {processingLabel && !streamingContent && (
        <div style={styles.agentMsg}>
          <div style={styles.statusBubble}>
            {processingLabel}
            <span style={styles.statusDots}>...</span>
          </div>
        </div>
      )}
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
  onRegenerate,
  onFork,
  onExport,
  dispatch,
}: {
  msg: any
  activeThreadId: string | null
  sendShortcut: string
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
  return (
    prev.msg.id === next.msg.id &&
    prev.msg.content === next.msg.content &&
    prev.msg.tool_calls === next.msg.tool_calls &&
    prev.activeThreadId === next.activeThreadId &&
    prev.sendShortcut === next.sendShortcut
  )
})

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

function ToolCallCard({ tc }: { tc: any }) {
  const [expanded, setExpanded] = useState(false)
  const [visionExpanded, setVisionExpanded] = useState(false)
  const hasResult = tc.result && !tc.error
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

  const statusTone = statusColor(tc.status === "success" ? "success" : tc.status)
  const statusGlyph =
    tc.status === "running" ? "…" : tc.status === "success" ? "✓" : tc.status === "error" ? "!" : "–"

  return (
    <div
      style={{
        ...styles.toolCard,
        // G3: status via left hairline only — not a full-border cage
        borderLeftColor: statusTone,
        cursor: hasResult && isLongResult ? "pointer" : "default",
      }}
      onClick={() => {
        if (hasResult && isLongResult) setExpanded(!expanded)
      }}
      data-testid="tool-call-card"
    >
      <div style={styles.toolHeader}>
        <span
          style={{
            ...styles.toolStatusGlyph,
            color: statusTone,
          }}
          aria-label={tc.status || "unknown"}
        >
          {statusGlyph}
        </span>
        <span style={styles.toolName}>{tc.tool_name}</span>
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
        {hasResult && isLongResult && (
          <span style={styles.toolExpandHint}>{expanded ? "收起" : "展开"}</span>
        )}
      </div>
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
      {hasResult && (
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
            { label: "任务包", action: "packs" },
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
          { label: "任务包", action: "packs" },
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
  },
  empty: {
    color: tokens.textMuted,
    textAlign: "center",
    padding: "56px 20px 28px",
    fontSize: 13,
    fontFamily: tokens.font,
  },
  emptyKicker: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: tokens.textMuted,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: tokens.text,
    marginBottom: 8,
    letterSpacing: "-0.035em",
    lineHeight: 1.25,
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
    background: "rgba(255,255,255,0.9)",
    color: tokens.accentText,
    borderRadius: tokens.radiusPill,
    padding: "6px 12px",
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
    background: `linear-gradient(145deg, ${tokens.userBubbleBg} 0%, ${tokens.accentHover} 100%)`,
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
