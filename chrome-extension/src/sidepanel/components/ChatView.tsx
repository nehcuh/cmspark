// Chat message list with streaming support

import { Component, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { marked } from "marked"
import DOMPurify from "dompurify"

export function ChatView() {
  const { state } = useAgentStore()
  const { messages, streamingContent, activeThreadId } = state

  // Infer AI processing state from message history (no extra state needed)
  const processingLabel = (() => {
    if (streamingContent) return null
    const last = messages[messages.length - 1]
    if (!last) return null
    if (last.role === "user") return "🤔 思考中"
    if (last.role === "assistant" && last.tool_calls) {
      const running = last.tool_calls.filter((tc: any) => tc.status === "running")
      if (running.length > 0) {
        const names = running.map((tc: any) => tc.tool_name).join(", ")
        return `⚙️ 执行中: ${names}`
      }
    }
    return null
  })()

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

  const handleRegenerate = (messageId: string) => {
    if (!activeThreadId) return
    chrome.runtime.sendMessage({
      type: "chat.regenerate",
      thread_id: activeThreadId,
      message_id: messageId,
    })
  }

  const handleFork = (messageId: string) => {
    if (!activeThreadId) return
    chrome.runtime.sendMessage({
      type: "thread.fork",
      thread_id: activeThreadId,
      message_id: messageId,
    })
  }

  return (
    <div style={styles.container}>
      {messages.length === 0 && !streamingContent && !processingLabel && (
        <div style={styles.empty}>输入指令开始与 CMspark Agent 对话</div>
      )}
      {messages.map(msg => {
        const isUser = msg.role === "user"
        return (
          <div key={msg.id} style={isUser ? styles.userMsg : styles.agentMsg}>
            <div style={styles.messageCol}>
              <div style={isUser ? styles.userBubble : styles.agentBubble}>
                <MarkdownRenderer content={msg.content} />
                {msg.tool_calls?.map(tc => (
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
                  <button style={styles.actionBtn} onClick={() => handleRegenerate(msg.id)} title="重新生成">
                    🔄
                  </button>
                )}
                <button style={styles.actionBtn} onClick={() => handleFork(msg.id)} title="创建分支">
                  🔀
                </button>
              </div>
            </div>
          </div>
        )
      })}
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

function ToolCallCard({ tc }: { tc: any }) {
  const [expanded, setExpanded] = useState(false)
  const hasResult = tc.result && !tc.error
  const resultStr = hasResult ? JSON.stringify(tc.result, null, 2) : ""
  const previewLen = 200

  return (
    <div style={{
      ...styles.toolCard,
      borderColor: tc.status === "error" ? "#F44336" : tc.status === "success" ? "#4CAF50" : "#ddd",
      cursor: hasResult && resultStr.length > previewLen ? "pointer" : "default",
    }} onClick={() => { if (hasResult && resultStr.length > previewLen) setExpanded(!expanded) }}>
      <div style={styles.toolHeader}>
        <span>{tc.status === "running" ? "⏳" : tc.status === "success" ? "✅" : tc.status === "error" ? "❌" : "⏸"}</span>
        <span style={styles.toolName}>{tc.tool_name}</span>
        {hasResult && resultStr.length > previewLen && (
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#999" }}>{expanded ? "收起 ▲" : "展开 ▼"}</span>
        )}
      </div>
      {hasResult && (
        <pre style={{...styles.toolResult, background: "#f5f5f5", padding: "8px 12px", borderRadius: 4, fontSize: 11, fontFamily: "'SF Mono', 'Fira Code', monospace", maxHeight: expanded ? 300 : 80, overflow: "auto"}}>
          <code>{expanded ? resultStr : resultStr.substring(0, previewLen) + (resultStr.length > previewLen ? " ..." : "")}</code>
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
class MarkdownRenderer extends Component<{ content: string }> {
  state = { html: "", error: false }

  static getDerivedStateFromProps(props: { content: string }, state: { html: string; error: boolean }) {
    if (!props.content) return { html: "", error: false }
    try {
      const rawHtml = marked.parse(props.content, { async: false }) as string
      const html = DOMPurify.sanitize(rawHtml, {
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
      if (html !== state.html) {
        return { html, error: false }
      }
      return null
    } catch (e: any) {
      console.error("[MarkdownRenderer] marked.parse error:", e)
      return { error: true }
    }
  }

  render() {
    if (this.state.error) {
      console.warn("[MarkdownRenderer] falling back to raw text")
      return <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{this.props.content}</div>
    }
    if (!this.state.html) return null

    return (
      <>
        <style>{markdownCSS}</style>
        <div
          className="markdown-body"
          dangerouslySetInnerHTML={{ __html: this.state.html }}
        />
      </>
    )
  }
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
