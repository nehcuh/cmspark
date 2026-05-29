import { useState, useRef, useCallback } from "react"
import type { SendShortcut } from "../types"

interface InputAreaProps {
  onSend: (message: string) => void
  onAbort: () => void
  isStreaming: boolean
  sendShortcut: SendShortcut
  placeholder?: string
}

export function InputArea({ onSend, onAbort, isStreaming, sendShortcut, placeholder }: InputAreaProps) {
  const [input, setInput] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const msg = input.trim()
    if (!msg || isStreaming) return
    onSend(msg)
    setInput("")
  }, [input, isStreaming, onSend])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const isEnterOnly = sendShortcut === "Enter"
    const isCmdEnter = sendShortcut === "Cmd+Enter"
    const isCtrlEnter = sendShortcut === "Ctrl+Enter"

    if (isEnterOnly && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    } else if (isCmdEnter && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    } else if (isCtrlEnter && e.key === "Enter" && e.ctrlKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend, sendShortcut])

  return (
    <div style={{
      display: "flex", alignItems: "flex-end", gap: 8,
      padding: "8px 12px", borderTop: "1px solid #e0e0e0",
      background: "#fff",
    }}>
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || (isStreaming ? "Agent 正在处理..." : "输入任务... (Enter 发送)")}
        disabled={isStreaming}
        rows={1}
        style={{
          flex: 1, border: "1px solid #e0e0e0", borderRadius: 6,
          padding: "8px 12px", fontSize: 13, fontFamily: "inherit",
          resize: "none", outline: "none", maxHeight: 120,
          opacity: isStreaming ? 0.6 : 1,
        }}
      />
      {isStreaming ? (
        <button
          onClick={onAbort}
          style={{
            padding: "8px 16px", border: "1px solid #F44336",
            borderRadius: 6, background: "#fff", color: "#F44336",
            fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          停止
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          style={{
            padding: "8px 16px", border: "none", borderRadius: 6,
            background: input.trim() ? "#4A90D9" : "#e0e0e0",
            color: "#fff", fontSize: 12, cursor: input.trim() ? "pointer" : "default",
            whiteSpace: "nowrap",
          }}
        >
          发送
        </button>
      )}
    </div>
  )
}
