// Chat message list with streaming support

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { marked } from "marked"
import DOMPurify from "dompurify"

const LONG_CONTENT_THRESHOLD = 3000
const LONG_CONTENT_PREVIEW = 500
const TOOL_RESULT_PREVIEW = 200

export function ChatView() {
  const { state } = useAgentStore()
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
    if (messages.length !== lastMessageCountRef.current || streamingContent) {
      lastMessageCountRef.current = messages.length
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight
      })
    }
  }, [messages.length, streamingContent])

  // Stable callbacks so MessageRow memoization is effective (audit item 11).
  // Without useCallback, every ChatView render creates new function identities,
  // busting React.memo on every row.
  const handleRegenerate = useCallback((messageId: string) => {
    if (!activeThreadId) return
    chrome.runtime.sendMessage({
      type: "chat.regenerate",
      thread_id: activeThreadId,
      message_id: messageId,
    })
  }, [activeThreadId])

  const handleFork = useCallback((messageId: string) => {
    if (!activeThreadId) return
    chrome.runtime.sendMessage({
      type: "thread.fork",
      thread_id: activeThreadId,
      message_id: messageId,
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
          onRegenerate={handleRegenerate}
          onFork={handleFork}
        />
      ))}
      {streamingContent && (
        <div style={styles.agentMsg}>
          <div style={styles.agentBubble}>{streamingContent}<Cursor /></div>
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
 * (audit item 11)
 */
const MessageRow = memo(function MessageRow({
  msg,
  onRegenerate,
  onFork,
}: {
  msg: any
  onRegenerate: (messageId: string) => void
  onFork: (messageId: string) => void
}) {
  const isUser = msg.role === "user"
  const hasLongContent = (msg.content?.length || 0) > LONG_CONTENT_THRESHOLD

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
        <div style={isUser ? styles.userBubble : styles.agentBubble}>
          {hasLongContent ? (
            <CollapsibleMarkdown content={msg.content} maxPreview={LONG_CONTENT_PREVIEW} />
          ) : (
            <MarkdownRenderer content={msg.content} />
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
          {!isUser && (
            <button style={styles.actionBtn} onClick={() => onRegenerate(msg.id)} title="重新生成">
              🔄
            </button>
          )}
          <button style={styles.actionBtn} onClick={() => onFork(msg.id)} title="创建分支">
            🔀
          </button>
        </div>
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
    prev.msg.tool_calls === next.msg.tool_calls
  )
})

function CollapsibleMarkdown({ content, maxPreview }: { content: string; maxPreview: number }) {
  const [expanded, setExpanded] = useState(false)
  const preview = content.substring(0, maxPreview)
  const needsCollapse = content.length > maxPreview

  return (
    <div>
      <MarkdownRenderer content={expanded ? content : preview + (needsCollapse ? "\n\n..." : "")} />
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

// Markdown renderer — uses marked + DOMPurify to sanitize LLM output before rendering.
// react-markdown/remark-gfm ecosystem is ESM-only with Node.js deps that crash in Chrome extension context.
// DOMPurify strips dangerous HTML (scripts, event handlers, etc.) to prevent XSS (P0).
//
// useMemo: parse + sanitize only when content actually changes (audit item 11).
// The previous class-based getDerivedStateFromProps ran the full marked.parse +
// DOMPurify.sanitize unconditionally on every render — including when a parent
// re-rendered due to unrelated state (e.g. streaming token arriving) — costing
// O(N messages × tokens/sec) of parse work per token.
function MarkdownRenderer({ content }: { content: string }) {
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
        ],
        ALLOWED_ATTR: ["href", "title", "class", "style"],
        ALLOW_DATA_ATTR: false,
      })
      return { html: sanitized, error: false }
    } catch (e: any) {
      console.error("[MarkdownRenderer] marked.parse error:", e)
      return { html: "", error: true }
    }
  }, [content])

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
