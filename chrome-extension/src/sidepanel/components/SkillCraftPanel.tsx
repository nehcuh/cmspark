// Skill-craft: extract reusable skills from conversation history

import { useState, useEffect, useCallback } from "react"
import { useAgentStore } from "../store/agentStore"
import { Modal } from "./ui/Modal"

interface SkillParameter {
  name: string
  type: "string" | "number" | "boolean"
  required: boolean
  default?: string
  description: string
}

interface LocalCraftedSkill {
  name: string
  description: string
  type: "prompt_template" | "tool_chain"
  parameters?: SkillParameter[]
  body: string
}

type PanelStep = "select" | "loading" | "preview" | "saving"

export function SkillCraftPanel({ onClose }: { onClose: () => void }) {
  const { state } = useAgentStore()
  const [step, setStep] = useState<PanelStep>("select")
  const [messageCount, setMessageCount] = useState(10)
  const [craftedSkill, setCraftedSkill] = useState<LocalCraftedSkill | null>(null)
  const [editName, setEditName] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [editType, setEditType] = useState<"prompt_template" | "tool_chain">("prompt_template")
  const [editBody, setEditBody] = useState("")
  const [error, setError] = useState("")

  const hasMessages = state.messages.length > 0

  // Listen for skill.crafted response
  useEffect(() => {
    const listener = (msg: any) => {
      if (msg.type === "skill.crafted") {
        if (msg.error) {
          setError(msg.error)
          setStep("select")
          return
        }
        if (msg.skill) {
          const s = msg.skill
          setCraftedSkill(s)
          setEditName(s.name)
          setEditDesc(s.description)
          setEditType(s.type)
          setEditBody(s.body)
          // If already auto-saved by companion, skip preview and go to "saved" state
          if (msg.auto_saved) {
            chrome.runtime.sendMessage({ type: "skill.list" })
            onClose()
            return
          }
          setStep("preview")
        } else {
          setError(msg.reason || "未发现可提取的操作模式")
          setStep("select")
        }
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const handleStartCraft = useCallback(() => {
    setError("")
    setStep("loading")
    chrome.runtime.sendMessage({
      type: "skill.craft",
      thread_id: state.activeThreadId,
      message_count: messageCount,
    })
  }, [state.activeThreadId, messageCount])

  const handleSave = useCallback(() => {
    // Validate name
    const safeName = editName.trim().replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
    if (!safeName) {
      setError("请输入有效的技能名称")
      return
    }
    setError("")
    setStep("saving")

    const body = editBody
    const paramsYaml = craftedSkill?.parameters
      ? "parameters:\n" + (craftedSkill.parameters || []).map(p =>
          `  ${p.name}:\n    type: ${p.type}\n    required: ${p.required}\n    default: ${p.default || ""}\n    description: ${p.description}`
        ).join("\n") + "\n"
      : ""

    const markdown = [
      "---",
      `name: ${editName}`,
      `description: ${editDesc}`,
      `type: ${editType}`,
      paramsYaml,
      "---",
      "",
      body,
    ].join("\n")

    chrome.runtime.sendMessage({
      type: "skill.import",
      content: markdown,
    })

    // Close after a brief moment to show "saving" state
    setTimeout(() => {
      // Refresh skill list
      chrome.runtime.sendMessage({ type: "skill.list" })
      onClose()
    }, 800)
  }, [editName, editDesc, editType, editBody, craftedSkill, onClose])

  return (
    // Conditionally mounted by the parent ({craftOpen && <SkillCraftPanel/>}),
    // so when we render we are open. <Modal> adds the focus trap + Escape +
    // focus-restore this panel previously lacked (backdrop click was its only
    // dismiss path). open is pinned true because mount/unmount is the gate.
    <Modal
      open={true}
      onClose={onClose}
      overlayStyle={styles.overlay}
      panelStyle={styles.panel}
      ariaLabel="提取技能"
    >
        <div style={styles.header}>
          <span style={styles.title}>提取技能</span>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {step === "select" && (
          <div style={styles.body}>
            {error && <div style={styles.error}>{error}</div>}
            <div style={styles.label}>分析范围</div>
            <div style={styles.radioGroup}>
              <label style={styles.radio}>
                <input type="radio" checked={messageCount === 0} onChange={() => setMessageCount(0)} />
                整个线程对话 ({state.messages.length} 条消息)
              </label>
              <label style={styles.radio}>
                <input type="radio" checked={messageCount === 10} onChange={() => setMessageCount(10)} />
                最近 10 轮对话
              </label>
              <label style={styles.radio}>
                <input type="radio" checked={messageCount === 5} onChange={() => setMessageCount(5)} />
                最近 5 轮对话
              </label>
            </div>
            <div style={styles.actions}>
              <button style={styles.cancelBtn} onClick={onClose}>取消</button>
              <button
                style={{ ...styles.primaryBtn, opacity: hasMessages ? 1 : 0.5 }}
                disabled={!hasMessages}
                onClick={handleStartCraft}
              >
                开始分析
              </button>
            </div>
            {!hasMessages && <div style={styles.hint}>当前线程没有消息，请先进行对话</div>}
          </div>
        )}

        {step === "loading" && (
          <div style={styles.body}>
            <div style={styles.loading}>
              <div style={styles.spinner} />
              <div style={styles.loadingText}>正在分析对话历史...</div>
              <div style={styles.loadingHint}>这会调用 LLM 分析对话中的操作模式</div>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div style={styles.body}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>名称</label>
              <input style={styles.input} value={editName} onChange={e => setEditName(e.target.value)} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>描述</label>
              <input style={styles.input} value={editDesc} onChange={e => setEditDesc(e.target.value)} />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>类型</label>
              <select style={styles.select} value={editType} onChange={e => setEditType(e.target.value as any)}>
                <option value="prompt_template">prompt_template (提示模板)</option>
                <option value="tool_chain">tool_chain (工具链)</option>
              </select>
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>正文</label>
              <textarea
                style={styles.textarea}
                value={editBody}
                rows={10}
                onChange={e => setEditBody(e.target.value)}
              />
            </div>
            <div style={styles.actions}>
              <button style={styles.cancelBtn} onClick={onClose}>取消</button>
              <button style={styles.secondaryBtn} onClick={() => setStep("select")}>重新分析</button>
              <button style={styles.primaryBtn} onClick={handleSave}>保存技能</button>
            </div>
          </div>
        )}

        {step === "saving" && (
          <div style={styles.body}>
            <div style={styles.loading}>
              <div style={styles.spinner} />
              <div style={styles.loadingText}>正在保存技能...</div>
            </div>
          </div>
        )}
    </Modal>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 200,
  },
  panel: {
    width: "90%",
    maxWidth: 340,
    background: "#fff",
    borderRadius: 10,
    boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: "1px solid #eee",
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
  },
  closeBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 14,
    color: "#999",
  },
  body: {
    padding: "16px",
  },
  error: {
    padding: "8px 12px",
    background: "#FFF3E0",
    border: "1px solid #FFB74D",
    borderRadius: 6,
    fontSize: 12,
    color: "#E65100",
    marginBottom: 12,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#555",
    marginBottom: 6,
  },
  radioGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 16,
  },
  radio: {
    fontSize: 12,
    color: "#333",
    display: "flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
  },
  actions: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
  },
  cancelBtn: {
    padding: "6px 14px",
    borderRadius: 6,
    border: "1px solid #ddd",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
    color: "#666",
  },
  primaryBtn: {
    padding: "6px 14px",
    borderRadius: 6,
    border: "none",
    background: "#4A90D9",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
  secondaryBtn: {
    padding: "6px 14px",
    borderRadius: 6,
    border: "1px solid #4A90D9",
    background: "#fff",
    color: "#4A90D9",
    cursor: "pointer",
    fontSize: 12,
  },
  hint: {
    marginTop: 10,
    fontSize: 11,
    color: "#999",
    textAlign: "center",
  },
  loading: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: 20,
  },
  spinner: {
    width: 32,
    height: 32,
    border: "3px solid #e0e0e0",
    borderTop: "3px solid #4A90D9",
    borderRadius: "50%",
    animation: "cmspark-spin 0.8s linear infinite",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: "#333",
    fontWeight: 500,
  },
  loadingHint: {
    marginTop: 4,
    fontSize: 11,
    color: "#999",
  },
  fieldGroup: {
    marginBottom: 12,
  },
  input: {
    width: "100%",
    padding: "5px 8px",
    border: "1px solid #ddd",
    borderRadius: 4,
    fontSize: 12,
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  select: {
    width: "100%",
    padding: "5px 8px",
    border: "1px solid #ddd",
    borderRadius: 4,
    fontSize: 12,
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    padding: "6px 8px",
    border: "1px solid #ddd",
    borderRadius: 4,
    fontSize: 11,
    fontFamily: "monospace",
    resize: "vertical",
    boxSizing: "border-box",
    minHeight: 120,
  },
}
