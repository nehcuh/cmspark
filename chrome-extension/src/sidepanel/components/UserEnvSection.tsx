// ADR-019 Settings section: 环境变量（Secrets）
// Companion is the sole source of truth. UI only shows names + mask (*** / 已配置).
// Each row saves independently via user_env.set — not the bottom config Save.

import { useEffect, useState, type CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import {
  USER_ENV_MASK,
  USER_ENV_NAME_CHIPS,
  validateUserEnvKeyName,
} from "../utils/user-env-utils"

const fieldStyle: CSSProperties = { marginBottom: 16 }
const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  color: "#333",
  marginBottom: 4,
}
const inputStyle: CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  border: "1px solid #ddd",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "monospace",
  outline: "none",
  boxSizing: "border-box",
}
const helpStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 11,
  color: "#777",
  lineHeight: 1.4,
}
const btnStyle: CSSProperties = {
  padding: "4px 10px",
  border: "1px solid #ddd",
  borderRadius: 6,
  background: "#fff",
  fontSize: 11,
  cursor: "pointer",
  whiteSpace: "nowrap",
}
const primaryBtnStyle: CSSProperties = {
  ...btnStyle,
  border: "none",
  background: tokens.accent,
  color: "#fff",
  fontWeight: 500,
}
const sectionTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#333",
  marginBottom: 12,
  marginTop: 8,
  paddingBottom: 6,
  borderBottom: "1px solid #eee",
}
const chipStyle: CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 12,
  border: `1px solid ${tokens.accent}`,
  color: tokens.accent,
  background: "#fff",
  cursor: "pointer",
}

export function UserEnvSection() {
  const { state, dispatch } = useAgentStore()
  const connected = state.connectionState === "connected"
  const keys = state.userEnv?.keys ?? []

  const [newName, setNewName] = useState("")
  const [newValue, setNewValue] = useState("")
  const [updateValues, setUpdateValues] = useState<Record<string, string>>({})
  const [localError, setLocalError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Refresh redacted list whenever settings opens while connected.
  useEffect(() => {
    if (!state.settingsOpen || !connected) return
    chrome.runtime.sendMessage({ type: "user_env.list" })
  }, [state.settingsOpen, connected])

  // Clear draft values when companion confirms an update (never re-show plaintext).
  useEffect(() => {
    if (state.userEnvStatus === "已保存") {
      setNewValue("")
      setUpdateValues({})
      setBusy(false)
    }
  }, [state.userEnvStatus, state.userEnv?.updated_at, state.userEnv?.count])

  useEffect(() => {
    if (state.userEnvError) setBusy(false)
  }, [state.userEnvError])

  const disabled = !connected || busy

  const clearFeedback = () => {
    setLocalError(null)
    dispatch({ type: "SET_USER_ENV_ERROR", error: null })
    dispatch({ type: "SET_USER_ENV_STATUS", status: null })
  }

  const handleAdd = () => {
    clearFeedback()
    const nameErr = validateUserEnvKeyName(newName)
    if (nameErr) {
      setLocalError(nameErr)
      return
    }
    // Empty string is a legal value (ADR R6); only reject if user left value as mask-only placeholder by mistake is N/A for new.
    const name = newName.trim()
    setBusy(true)
    chrome.runtime.sendMessage({
      type: "user_env.set",
      vars: { [name]: newValue },
    })
    setNewName("")
    // newValue cleared on user_env.updated (never keep plaintext in React state longer than needed)
    setNewValue("")
  }

  const handleUpdate = (name: string) => {
    clearFeedback()
    if (!(name in updateValues)) {
      setLocalError("请输入新值后再保存")
      return
    }
    const value = updateValues[name]
    // "***" means unchanged (companion ignores); treat as no-op in UI.
    if (value === USER_ENV_MASK) {
      setLocalError("请输入新值（*** 表示未改动）")
      return
    }
    // Empty string is a legal value (ADR R6); only delete goes through user_env.delete.
    setBusy(true)
    chrome.runtime.sendMessage({
      type: "user_env.set",
      vars: { [name]: value },
    })
  }

  const handleDelete = (name: string) => {
    clearFeedback()
    if (!confirm(`确定删除环境变量「${name}」？`)) return
    setBusy(true)
    chrome.runtime.sendMessage({
      type: "user_env.delete",
      keys: [name],
    })
  }

  const fillChip = (chip: string) => {
    setNewName(chip)
    clearFeedback()
  }

  const feedbackError = localError || state.userEnvError
  const feedbackOk = !feedbackError && state.userEnvStatus

  return (
    <>
      <div style={sectionTitleStyle}>环境变量（Secrets）</div>
      <div style={{ ...fieldStyle, opacity: connected ? 1 : 0.55, pointerEvents: connected ? "auto" : "none" }}>
        <div style={helpStyle}>
          用于 skill 与 shell 命令（如 <code>DATAYES_TOKEN</code>）。仅保存在本机 Companion，
          <b>不会发送给大模型</b>。设置后列表只显示「已配置」，永不回显明文。
        </div>

        {!connected && (
          <div style={{ ...helpStyle, color: tokens.danger, marginTop: 8 }}>
            未连接 Companion，无法管理环境变量。请先配对并启动 Companion。
          </div>
        )}

        {/* Existing keys */}
        {keys.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {keys.map((entry) => (
              <div
                key={entry.name}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #eee",
                  background: "#fafafa",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <code style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{entry.name}</code>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      padding: "1px 6px",
                      borderRadius: 8,
                      color: tokens.success,
                      background: tokens.successSoft,
                    }}
                  >
                    ● 已配置
                  </span>
                  <span style={{ fontSize: 11, color: "#999", fontFamily: "monospace" }}>
                    {entry.masked || USER_ENV_MASK}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={disabled}
                    value={updateValues[entry.name] ?? ""}
                    onChange={(e) =>
                      setUpdateValues((prev) => ({ ...prev, [entry.name]: e.target.value }))
                    }
                    placeholder="输入新值以更新（不会显示原值）"
                  />
                  <button
                    style={primaryBtnStyle}
                    disabled={
                      disabled
                      || !(entry.name in updateValues)
                      || updateValues[entry.name] === USER_ENV_MASK
                    }
                    onClick={() => handleUpdate(entry.name)}
                    title="保存此变量"
                  >
                    保存
                  </button>
                  <button
                    style={{ ...btnStyle, color: tokens.danger, borderColor: "#f0c0c0" }}
                    disabled={disabled}
                    onClick={() => handleDelete(entry.name)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {connected && keys.length === 0 && state.userEnv && (
          <div style={{ ...helpStyle, marginTop: 10 }}>暂无环境变量。可在下方添加（例如 DATAYES_TOKEN）。</div>
        )}

        {/* Add row */}
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>添加变量</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {USER_ENV_NAME_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                style={chipStyle}
                disabled={disabled}
                onClick={() => fillChip(chip)}
                title={`填入变量名 ${chip}`}
              >
                {chip}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              style={inputStyle}
              type="text"
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                clearFeedback()
              }}
              placeholder="变量名，如 DATAYES_TOKEN"
            />
            <input
              style={inputStyle}
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              value={newValue}
              onChange={(e) => {
                setNewValue(e.target.value)
                clearFeedback()
              }}
              placeholder="密钥值（password 输入，保存后不回显）"
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                style={primaryBtnStyle}
                disabled={disabled || !newName.trim()}
                onClick={handleAdd}
              >
                添加并保存
              </button>
            </div>
          </div>
        </div>

        {feedbackError && (
          <div style={{ ...helpStyle, color: tokens.danger, marginTop: 8 }}>{feedbackError}</div>
        )}
        {feedbackOk && (
          <div style={{ ...helpStyle, color: tokens.success, marginTop: 8 }}>✓ {state.userEnvStatus}</div>
        )}
      </div>
    </>
  )
}
