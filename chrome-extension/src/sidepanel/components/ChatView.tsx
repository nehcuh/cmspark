// Chat message list with streaming support

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import { marked } from "marked"
import markedKatex from "marked-katex-extension"
import DOMPurify from "dompurify"
import { renderMermaidBlocks, prefetchMermaid } from "./mermaid"
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

const LONG_CONTENT_THRESHOLD = 3000
const LONG_CONTENT_PREVIEW = 500
const TOOL_RESULT_PREVIEW = 200

export function ChatView() {
  const { state, dispatch } = useAgentStore()
  const { messages, streamingContent, activeThreadId, isProcessing } = state
  const containerRef = useRef<HTMLDivElement>(null)
  const lastMessageCountRef = useRef(messages.length)

  // Show processing label only when there is an active request
  const processingLabel = (() => {
    if (streamingContent) return null
    if (!isProcessing) return null
    const last = messages[messages.length - 1]
    if (last?.role === "assistant" && last.tool_calls) {
      const running = last.tool_calls.filter((tc: any) => tc.status === "running")
      if (running.length > 0) {
        const names = running.map((tc: any) => tc.tool_name).join(", ")
        return `⚙️ 执行中: ${names}`
      }
    }
    return "🤔 思考中"
  })()

  // Auto-scroll to bottom when new messages arrive or streaming updates
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Scroll when message count changes or streaming content updates
    if (messages.length !== lastMessageCountRef.current || streamingContent) {
      lastMessageCountRef.current = messages.length
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight
      })
    }
  }, [messages.length, streamingContent])

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
    <div style={styles.container} ref={containerRef}>
      {messages.length === 0 && !streamingContent && !processingLabel && (
        <div style={styles.empty}>输入指令开始与 CMspark Agent 对话</div>
      )}
      {messages.map(msg => (
        <MessageRow
          key={msg.id}
          msg={msg}
          activeThreadId={activeThreadId}
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
  onRegenerate,
  onFork,
  onExport,
  dispatch,
}: {
  msg: any
  activeThreadId: string | null
  onRegenerate: (messageId: string, editedMessage?: string) => void
  onFork: (messageId: string) => void
  onExport: (messageId: string) => void
  dispatch: any
}) {
  const isUser = msg.role === "user"
  const hasLongContent = (msg.content?.length || 0) > LONG_CONTENT_THRESHOLD
  const [isEditing, setIsEditing] = useState(false)
  const [editingText, setEditingText] = useState("")

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
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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
                style={{ ...styles.editBtn, background: "#fff", color: "#666", border: "1px solid #ddd" }}
                onClick={() => { setIsEditing(false); setEditingText("") }}
              >
                取消
              </button>
              <button
                style={{ ...styles.editBtn, background: "#4A90D9", color: "#fff", border: "none" }}
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
              <button style={styles.actionBtn} onClick={() => handleCopy(msg.content || "")} title="复制">
                📋
              </button>
              {isUser && (
                <button
                  style={styles.actionBtn}
                  onClick={() => { setIsEditing(true); setEditingText(msg.content || "") }}
                  title="编辑并重新生成"
                >
                  ✏️
                </button>
              )}
              {!isUser && (
                <button style={styles.actionBtn} onClick={() => onRegenerate(msg.id)} title="重新生成">
                  🔄
                </button>
              )}
              <button style={styles.actionBtn} onClick={() => onFork(msg.id)} title="创建分支">
                🔀
              </button>
              <button style={styles.actionBtn} onClick={() => onExport(msg.id)} title="导出此条到 Obsidian">
                📥
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
    prev.activeThreadId === next.activeThreadId
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

  return (
    <div style={{
      ...styles.toolCard,
      borderColor: tc.status === "error" ? "#F44336" : tc.status === "success" ? "#4CAF50" : "#ddd",
      cursor: hasResult && isLongResult ? "pointer" : "default",
    }} onClick={() => { if (hasResult && isLongResult) setExpanded(!expanded) }}>
      <div style={styles.toolHeader}>
        <span>{tc.status === "running" ? "⏳" : tc.status === "success" ? "✅" : tc.status === "error" ? "❌" : "⏸"}</span>
        <span style={styles.toolName}>{tc.tool_name}</span>
        {/* Vision status badge */}
        {isVisionTool && tc.vision_status === "analyzing" && (
          <span style={{ fontSize: 10, color: "#4A90D9", marginLeft: 8 }}>Analyzing...</span>
        )}
        {isVisionTool && tc.vision_status === "done" && (
          <span style={{ fontSize: 10, color: "#4CAF50", marginLeft: 8 }}>
            Vision {tc.vision_latency_ms ? `${(tc.vision_latency_ms / 1000).toFixed(1)}s` : ""}
          </span>
        )}
        {isVisionTool && tc.vision_status === "cached" && (
          <span style={{ fontSize: 10, color: "#9E9E9E", marginLeft: 8 }}>Vision cached</span>
        )}
        {isVisionTool && tc.vision_status === "error" && (
          <span style={{ fontSize: 10, color: "#FF9800", marginLeft: 8 }}>Vision failed</span>
        )}
        {hasResult && isLongResult && (
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#999" }}>{expanded ? "收起 ▲" : "展开 ▼"}</span>
        )}
      </div>
      {/* Expandable vision description */}
      {hasVisionDescription && (
        <div style={{
          marginTop: 6,
          padding: "6px 10px",
          background: "#f0f7ff",
          borderRadius: 4,
          borderLeft: "3px solid #4A90D9",
        }}>
          <div style={{
            fontSize: 11,
            color: "#333",
            lineHeight: 1.4,
            maxHeight: visionExpanded ? "none" : "3em",
            overflow: "hidden",
            whiteSpace: "pre-wrap",
          }}>
            {visionDescription}
          </div>
          {visionDescription.length > 100 && (
            <button
              onClick={(e) => { e.stopPropagation(); setVisionExpanded(!visionExpanded) }}
              style={{ fontSize: 10, color: "#4A90D9", background: "none", border: "none", cursor: "pointer", padding: "2px 0", marginTop: 2 }}
            >
              {visionExpanded ? "收起 ▲" : "展开全部 ▼"}
            </button>
          )}
        </div>
      )}
      {hasResult && (
        <pre style={{...styles.toolResult, background: "#f5f5f5", padding: "8px 12px", borderRadius: 4, fontSize: 11, fontFamily: "'SF Mono', 'Fira Code', monospace", maxHeight: expanded ? 300 : 80, overflow: "auto"}}>
          <code>{expanded ? resultStr : resultStr.substring(0, TOOL_RESULT_PREVIEW) + (isLongResult ? " ..." : "")}</code>
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
    background: "#333",
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
          "href", "title", "class", "style",
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
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  )
}

const markdownCSS = `
  .markdown-body h1, .markdown-body h2, .markdown-body h3 {
    margin: 10px 0 4px 0;
    font-weight: 600;
    line-height: 1.3;
  }
  .markdown-body h1 { font-size: 16px; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; }
  .markdown-body h2 { font-size: 14px; }
  .markdown-body h3 { font-size: 13px; }
  .markdown-body p { margin: 4px 0; line-height: 1.5; }
  .markdown-body ul, .markdown-body ol { margin: 4px 0; padding-left: 18px; }
  .markdown-body li { margin: 2px 0; }
  .markdown-body a { color: #4A90D9; text-decoration: none; }
  .markdown-body strong { font-weight: 600; }
  .markdown-body blockquote {
    margin: 6px 0;
    padding: 4px 10px;
    border-left: 3px solid #4A90D9;
    background: #f5f7fa;
    color: #555;
  }
  .markdown-body table {
    border-collapse: collapse;
    width: 100%;
    margin: 6px 0;
    font-size: 12px;
  }
  .markdown-body th, .markdown-body td {
    border: 1px solid #ddd;
    padding: 4px 8px;
    text-align: left;
  }
  .markdown-body th { background: #f5f5f5; font-weight: 600; }
  .markdown-body hr { border: none; border-top: 1px solid #e0e0e0; margin: 10px 0; }
  .markdown-body code {
    background: #f0f0f0;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 11px;
    font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  }
  .markdown-body pre {
    background: #f5f5f5;
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
    padding: "12px",
  },
  empty: {
    color: "#999",
    textAlign: "center",
    paddingTop: 40,
    fontSize: 13,
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
    maxWidth: "85%",
    width: "fit-content" as const,
  },
  userBubble: {
    background: "#4A90D9",
    color: "#fff",
    borderRadius: "12px 12px 4px 12px",
    padding: "8px 12px",
    wordBreak: "break-word" as const,
    whiteSpace: "pre-wrap",
  },
  agentBubble: {
    background: "#f0f0f0",
    borderRadius: "12px 12px 12px 4px",
    padding: "8px 12px",
    wordBreak: "break-word" as const,
  },
  statusBubble: {
    background: "#e8f0fe",
    borderRadius: "12px 12px 12px 4px",
    padding: "8px 12px",
    maxWidth: "85%",
    fontSize: 12,
    color: "#4A90D9",
    fontStyle: "italic" as const,
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  statusDots: {
    display: "inline-block",
    width: 20,
    overflow: "hidden",
    animation: "cmspark-dots 1.5s steps(4, end) infinite",
  },
  actionBar: {
    display: "flex",
    gap: 4,
    marginTop: 4,
    padding: "3px 6px",
    background: "#f0f0f0",
    borderRadius: 6,
  },
  editWrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    width: "100%",
  },
  editTextarea: {
    width: "100%",
    border: "1px solid #4A90D9",
    borderRadius: 8,
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
    borderRadius: 6,
    fontSize: 12,
    cursor: "pointer",
  },
  actionBtn: {
    background: "none",
    border: "none",
    fontSize: 12,
    color: "#666",
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: 4,
    lineHeight: 1,
    transition: "background 0.15s ease",
  },
  expandBtn: {
    background: "none",
    border: "none",
    color: "#4A90D9",
    cursor: "pointer",
    fontSize: 12,
    padding: "4px 0",
    marginTop: 4,
    fontWeight: 500,
  },
  toolCard: {
    marginTop: 8,
    border: "1px solid #ddd",
    borderRadius: 6,
    padding: 8,
    background: "#fafafa",
    fontSize: 12,
  },
  toolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  toolName: {
    fontWeight: 600,
    fontFamily: "monospace",
  },
  toolResult: {
    margin: 0,
    fontSize: 11,
    maxHeight: 200,
    overflowY: "auto",
    background: "#fff",
    padding: 6,
    borderRadius: 4,
  },
}
