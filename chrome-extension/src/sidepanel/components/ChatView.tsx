// Chat message list with streaming support

import { Component, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { marked } from "marked"

export function ChatView() {
  const { state } = useAgentStore()
  const { messages, streamingContent } = state

  return (
    <div style={styles.container}>
      {messages.length === 0 && !streamingContent && (
        <div style={styles.empty}>输入指令开始与 CMspark Agent 对话</div>
      )}
      {messages.map(msg => {
        const isTool = msg.role === "tool"
        return (
          <div key={msg.id} style={msg.role === "user" ? styles.userMsg : styles.agentMsg}>
            <div style={msg.role === "user" ? styles.userBubble : styles.agentBubble}>
              {/* Tool messages: skip raw JSON content, only show tool card */}
              {!isTool && <MarkdownRenderer content={msg.content} />}
              {msg.tool_calls?.map(tc => (
                <ToolCallCard key={tc.id} tc={tc} />
              ))}
            </div>
          </div>
        )
      })}
      {streamingContent && (
        <div style={styles.agentMsg}>
          <div style={styles.agentBubble}>{streamingContent}<Cursor /></div>
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

// Markdown renderer — uses marked (zero-deps, browser-safe) instead of react-markdown + remark-gfm
// react-markdown/remark-gfm ecosystem is ESM-only with Node.js deps that crash in Chrome extension context
class MarkdownRenderer extends Component<{ content: string }> {
  state = { html: "", error: false }

  static getDerivedStateFromProps(props: { content: string }, state: { html: string; error: boolean }) {
    if (!props.content) return { html: "", error: false }
    try {
      const html = marked.parse(props.content, { async: false }) as string
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
  userBubble: {
    background: "#4A90D9",
    color: "#fff",
    borderRadius: "12px 12px 4px 12px",
    padding: "8px 12px",
    maxWidth: "85%",
    wordBreak: "break-word" as const,
    whiteSpace: "pre-wrap",
  },
  agentBubble: {
    background: "#f0f0f0",
    borderRadius: "12px 12px 12px 4px",
    padding: "8px 12px",
    maxWidth: "85%",
    wordBreak: "break-word" as const,
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
