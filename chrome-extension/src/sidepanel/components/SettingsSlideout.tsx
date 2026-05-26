// Settings slideout panel for LLM configuration

import { useState } from "react"
import { useAgentStore } from "../store/agentStore"

export function SettingsSlideout() {
  const { state, dispatch } = useAgentStore()
  const [showKey, setShowKey] = useState(false)

  if (!state.settingsOpen) return null

  const config = state.config

  const handleSave = () => {
    chrome.runtime.sendMessage({ type: "config.set", config }, () => {
      dispatch({ type: "TOGGLE_SETTINGS" })
    })
  }

  const handleShortcutChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch({ type: "SET_SEND_SHORTCUT", shortcut: e.target.value as any })
  }

  const handleTest = () => {
    dispatch({ type: "SET_TEST_RESULT", result: "测试中..." })
    chrome.runtime.sendMessage({ type: "config.test" })
  }

  return (
    <div style={styles.backdrop} onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={{ margin: 0, fontSize: 15 }}>LLM 配置</h3>
          <button style={styles.closeBtn} onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}>✕</button>
        </div>

        <div style={styles.body}>
          <div style={styles.field}>
            <label style={styles.label}>Base URL</label>
            <input
              style={styles.input}
              type="text"
              value={config.base_url}
              onChange={e => dispatch({ type: "SET_CONFIG", config: { base_url: e.target.value } })}
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>API Key</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ ...styles.input, flex: 1 }}
                type={showKey ? "text" : "password"}
                value={config.api_key}
                onChange={e => dispatch({ type: "SET_CONFIG", config: { api_key: e.target.value } })}
                placeholder="sk-..."
              />
              <button style={styles.toggleBtn} onClick={() => setShowKey(!showKey)}>
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Model</label>
            <input
              style={styles.input}
              type="text"
              value={config.model_name}
              onChange={e => dispatch({ type: "SET_CONFIG", config: { model_name: e.target.value } })}
              placeholder="gpt-4o"
              list="model-suggestions"
            />
            <datalist id="model-suggestions">
              <option value="deepseek-v4-pro" />
              <option value="deepseek-chat" />
              <option value="deepseek-reasoner" />
              <option value="gpt-4o" />
              <option value="gpt-4-turbo" />
              <option value="claude-sonnet-4-6" />
              <option value="claude-opus-4-7" />
            </datalist>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Temperature: {(config.temperature ?? 0.7).toFixed(1)}</label>
            <input
              style={{ width: "100%" }}
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={config.temperature}
              onChange={e => dispatch({ type: "SET_CONFIG", config: { temperature: parseFloat(e.target.value) } })}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>发送快捷键</label>
            <select
              style={styles.select}
              value={state.sendShortcut || "Enter"}
              onChange={handleShortcutChange}
            >
              <option value="Enter">Enter</option>
              <option value="Cmd+Enter">Cmd+Enter</option>
              <option value="Ctrl+Enter">Ctrl+Enter</option>
            </select>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Context Window</label>
            <input
              style={styles.input}
              type="number"
              value={config.context_window}
              onChange={e => dispatch({ type: "SET_CONFIG", config: { context_window: parseInt(e.target.value) || 128000 } })}
              min={1024}
              max={1000000}
              step={1024}
            />
          </div>
        </div>

        <div style={styles.footer}>
          {state.testResult && <span style={{
            fontSize: 12,
            color: state.testResult.includes("成功") ? "#4CAF50" : "#F44336",
          }}>{state.testResult}</span>}
          <button style={styles.testBtn} onClick={handleTest}>测试连接</button>
          <button style={styles.saveBtn} onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.3)",
    zIndex: 200,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "stretch",
  },
  panel: {
    width: "100%",
    maxHeight: "80vh",
    background: "#fff",
    borderRadius: "12px 12px 0 0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 16px",
    borderBottom: "1px solid #eee",
  },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: 18,
    cursor: "pointer",
    color: "#999",
  },
  body: {
    padding: "16px",
    overflowY: "auto",
    flex: 1,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 500,
    color: "#333",
    marginBottom: 4,
  },
  input: {
    width: "100%",
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 6,
    fontSize: 13,
    fontFamily: "monospace",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  toggleBtn: {
    padding: "4px 10px",
    border: "1px solid #ddd",
    borderRadius: 6,
    background: "#fff",
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  select: {
    width: "100%",
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 6,
    fontSize: 13,
    fontFamily: "monospace",
    outline: "none",
    boxSizing: "border-box" as const,
    background: "#fff",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderTop: "1px solid #eee",
  },
  testBtn: {
    padding: "6px 14px",
    border: "1px solid #4A90D9",
    borderRadius: 6,
    background: "#fff",
    color: "#4A90D9",
    fontSize: 12,
    cursor: "pointer",
  },
  saveBtn: {
    padding: "6px 20px",
    border: "none",
    borderRadius: 6,
    background: "#4A90D9",
    color: "#fff",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
}
