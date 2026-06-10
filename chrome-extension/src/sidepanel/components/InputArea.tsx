import { useState, useRef, useCallback } from "react"
import type { SendShortcut, FileAttachment } from "../types"

const ALLOWED_EXTENSIONS = ".docx,.pptx,.xlsx,.pdf,.odt,.rtf,.csv,.md,.txt,.html,.htm"
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(",")[1])
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function getMimeFromExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase()
  const map: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pdf: "application/pdf",
    odt: "application/vnd.oasis.opendocument.text",
    rtf: "application/rtf",
    csv: "text/csv",
    md: "text/markdown",
    txt: "text/plain",
    html: "text/html",
    htm: "text/html",
  }
  return map[ext || ""] || "application/octet-stream"
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

interface InputAreaProps {
  onSend: (message: string, files?: FileAttachment[]) => void
  onAbort: () => void
  isStreaming: boolean
  sendShortcut: SendShortcut
  placeholder?: string
}

export function InputArea({ onSend, onAbort, isStreaming, sendShortcut, placeholder }: InputAreaProps) {
  const [input, setInput] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<FileAttachment[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSend = useCallback(() => {
    const msg = input.trim()
    if ((!msg && selectedFiles.length === 0) || isStreaming) return
    onSend(msg, selectedFiles.length > 0 ? selectedFiles : undefined)
    setInput("")
    setSelectedFiles([])
  }, [input, isStreaming, selectedFiles, onSend])

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

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newFiles: FileAttachment[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      if (file.size > MAX_FILE_SIZE) {
        alert(`文件 "${file.name}" 超过 10MB 限制`)
        continue
      }

      const base64 = await fileToBase64(file)
      newFiles.push({
        name: file.name,
        type: file.type || getMimeFromExtension(file.name),
        size: file.size,
        content: base64,
      })
    }

    setSelectedFiles(prev => [...prev, ...newFiles])
    e.target.value = ""
  }, [])

  const removeFile = useCallback((idx: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const hasContent = input.trim() || selectedFiles.length > 0

  return (
    <div style={{
      borderTop: "1px solid #e0e0e0",
      background: "#fff",
    }}>
      {selectedFiles.length > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 4,
          padding: "6px 12px 0",
        }}>
          {selectedFiles.map((file, idx) => (
            <span key={idx} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 8px", background: "#f0f4ff", borderRadius: 12,
              fontSize: 11, color: "#4A90D9", maxWidth: 200,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {file.name} ({formatFileSize(file.size)})
              <span
                role="button"
                onClick={() => removeFile(idx)}
                style={{ cursor: "pointer", marginLeft: 2, fontWeight: "bold" }}
              >
                {"×"}
              </span>
            </span>
          ))}
        </div>
      )}
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 8,
        padding: "8px 12px",
      }}>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept={ALLOWED_EXTENSIONS}
          onChange={handleFileSelect}
        />
        {!isStreaming && (
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: "8px", border: "1px solid #e0e0e0", borderRadius: 6,
              background: "#fff", fontSize: 14, cursor: "pointer",
              color: "#666", lineHeight: 1,
            }}
            title="上传文件"
          >
            {"📎"}
          </button>
        )}
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
            disabled={!hasContent}
            style={{
              padding: "8px 16px", border: "none", borderRadius: 6,
              background: hasContent ? "#4A90D9" : "#e0e0e0",
              color: "#fff", fontSize: 12, cursor: hasContent ? "pointer" : "default",
              whiteSpace: "nowrap",
            }}
          >
            发送
          </button>
        )}
      </div>
    </div>
  )
}
