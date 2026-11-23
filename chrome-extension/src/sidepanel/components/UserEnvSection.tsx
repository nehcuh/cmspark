// ADR-019 Settings section: 环境变量（Secrets）
// Companion is the sole source of truth. UI only shows names + mask (*** / 已配置).
// Each row can save independently; the footer can submit all edited values.

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { Modal } from "./ui/Modal"
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
  color: tokens.text,
  marginBottom: 4,
}
const inputStyle: CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  border: `1px solid ${tokens.borderStrong}`,
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "monospace",
  outline: "none",
  boxSizing: "border-box",
}
const helpStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 11,
  color: tokens.textSecondary,
  lineHeight: 1.4,
}
const btnStyle: CSSProperties = {
  padding: "4px 10px",
  border: `1px solid ${tokens.borderStrong}`,
  borderRadius: 6,
  background: tokens.bgElevated,
  fontSize: 11,
  cursor: "pointer",
  whiteSpace: "nowrap",
}
const primaryBtnStyle: CSSProperties = {
  ...btnStyle,
  border: "none",
  background: tokens.accent,
  color: tokens.userBubbleText,
  fontWeight: 500,
}
const sectionTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: tokens.text,
  marginBottom: 12,
  marginTop: 8,
  paddingBottom: 6,
  borderBottom: `1px solid ${tokens.border}`,
}
const chipStyle: CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 12,
  border: `1px solid ${tokens.accent}`,
  color: tokens.accent,
  background: tokens.bgElevated,
  cursor: "pointer",
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10050,
  padding: 16,
}
const panelStyle: CSSProperties = {
  width: "100%",
  maxWidth: 320,
  background: tokens.bgElevated,
  borderRadius: 10,
  padding: 16,
  boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
}

export function UserEnvSection({ active = true, onFooterSave }: { active?: boolean; onFooterSave?: (control: { dirty: boolean; busy: boolean; save: () => void; error?: string } | null) => void }) {
  const { state, dispatch } = useAgentStore()
  const connected = state.connectionState === "connected"
  const keys = state.userEnv?.keys ?? []

  const [newName, setNewName] = useState("")
  const [newValue, setNewValue] = useState("")
  const [updateValues, setUpdateValues] = useState<Record<string, string>>({})
  const [localError, setLocalError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const pending = useRef<{ id: string; added: { name: string; value: string } | null; updates: Record<string, string>; timer: number } | null>(null)

  // Refresh redacted list whenever settings opens while connected.
  useEffect(() => {
    if (!state.settingsOpen || !connected) return
    chrome.runtime.sendMessage({ type: "user_env.list" })
  }, [state.settingsOpen, connected])

  useEffect(() => {
    const onMessage = (message: { id?: string; type?: string; error?: string }) => {
      const request = pending.current
      if (!request || message.id !== request.id || (message.type !== "user_env.updated" && message.type !== "error")) return
      window.clearTimeout(request.timer)
      pending.current = null
      setBusy(false)
      if (message.type === "error") {
        setLocalError(message.error || "环境变量未保存，请重试。")
        return
      }
      if (request.added) {
        setNewName(current => current === request.added?.name ? "" : current)
        setNewValue(current => current === request.added?.value ? "" : current)
      }
      setUpdateValues(current => {
        const next = { ...current }
        for (const [name, value] of Object.entries(request.updates)) if (current[name] === value) delete next[name]
        return next
      })
      setDeleteTarget(null)
      dispatch({ type: "SET_USER_ENV_STATUS", status: "已保存" })
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => { chrome.runtime.onMessage.removeListener(onMessage); if (pending.current) window.clearTimeout(pending.current.timer); pending.current = null }
  }, [dispatch])

  const disabled = !connected || busy

  const clearFeedback = () => {
    setLocalError(null)
    dispatch({ type: "SET_USER_ENV_ERROR", error: null })
    dispatch({ type: "SET_USER_ENV_STATUS", status: null })
  }

  const sendMutation = (type: "user_env.set" | "user_env.delete", payload: Record<string, unknown>, added: { name: string; value: string } | null, updates: Record<string, string>) => {
    if (pending.current || !connected) return
    const id = `user-env-save:${crypto.randomUUID()}`
    const timer = window.setTimeout(() => {
      if (pending.current?.id !== id) return
      pending.current = null
      setBusy(false)
      setLocalError("环境变量保存结果未知，草稿已保留，请核对后重试。")
    }, 15000)
    pending.current = { id, added, updates, timer }
    setBusy(true)
    try {
      chrome.runtime.sendMessage({ type, id, ...payload }, (response?: { ok?: boolean; error?: string }) => {
        if (pending.current?.id !== id) return
        if (chrome.runtime.lastError || response?.ok !== true) {
          window.clearTimeout(timer)
          pending.current = null
          setBusy(false)
          setLocalError(chrome.runtime.lastError?.message || response?.error || "未连接到 Companion，请重试。")
        }
      })
    } catch {
      window.clearTimeout(timer)
      pending.current = null
      setBusy(false)
      setLocalError("未连接到 Companion，请重试。")
    }
  }

  const handleAdd = () => {
    clearFeedback()
    const nameErr = validateUserEnvKeyName(newName)
    if (nameErr) {
      setLocalError(nameErr)
      return
    }
    // "***" is the unchanged sentinel for updates — not a legal new value (avoids silent no-op UX).
    if (newValue === USER_ENV_MASK) {
      setLocalError("请输入真实密钥值（*** 仅表示已配置项未改动，不可作为新值）")
      return
    }
    // Empty string is a legal value (ADR R6); only delete goes through user_env.delete.
    const name = newName.trim()
    sendMutation("user_env.set", { vars: { [name]: newValue } }, { name: newName, value: newValue }, {})
    // Do NOT clear drafts until ack — Gate2 nit: keep input on server reject.
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
    sendMutation("user_env.set", { vars: { [name]: value } }, null, { [name]: value })
  }

  const handleSaveAll = () => {
    clearFeedback()
    const vars = { ...updateValues }
    if (Object.values(vars).some(value => value === USER_ENV_MASK)) {
      setLocalError("请输入新值（*** 表示未改动）")
      return
    }
    if (newName || newValue) {
      const nameError = validateUserEnvKeyName(newName)
      if (nameError) { setLocalError(nameError); return }
      if (newValue === USER_ENV_MASK) { setLocalError("请输入真实密钥值（*** 表示未改动）"); return }
      const name = newName.trim()
      if (Object.hasOwn(vars, name)) { setLocalError("同一个变量有两处修改，请保留一处。") ; return }
      vars[name] = newValue
    }
    if (!Object.keys(vars).length) return
    sendMutation("user_env.set", { vars }, newName || newValue ? { name: newName, value: newValue } : null, { ...updateValues })
  }

  useEffect(() => {
    if (!onFooterSave) return
    const dirty = !!newName || !!newValue || Object.keys(updateValues).length > 0
    onFooterSave(dirty ? { dirty: true, busy: disabled, error: localError || state.userEnvError || undefined, save: handleSaveAll } : null)
    return () => onFooterSave(null)
  }, [active, newName, newValue, updateValues, disabled, localError, state.userEnvError, onFooterSave])

  const requestDelete = (name: string) => {
    clearFeedback()
    setDeleteTarget(name)
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    const name = deleteTarget
    sendMutation("user_env.delete", { keys: [name] }, null, {})
  }

  const fillChip = (chip: string) => {
    setNewName(chip)
    clearFeedback()
  }

  const feedbackError = localError || state.userEnvError
  const feedbackOk = !feedbackError && state.userEnvStatus
  const updateSaveTitle = (name: string) => {
    if (!(name in updateValues)) return "请先输入新值"
    if (updateValues[name] === USER_ENV_MASK) {
      return "*** 表示未改动，请输入新值后再保存"
    }
    return "保存此变量"
  }

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
                  border: `1px solid ${tokens.border}`,
                  background: tokens.bgMuted,
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
                  <span style={{ fontSize: 11, color: tokens.textMuted, fontFamily: "monospace" }}>
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
                    title={updateSaveTitle(entry.name)}
                  >
                    保存
                  </button>
                  <button
                    style={{ ...btnStyle, color: tokens.danger, borderColor: tokens.dangerSoft }}
                    disabled={disabled}
                    onClick={() => requestDelete(entry.name)}
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

      <Modal
        open={deleteTarget != null}
        onClose={() => {
          if (!busy) setDeleteTarget(null)
        }}
        role="alertdialog"
        ariaLabel="确认删除环境变量"
        backdropDismiss={!busy}
        overlayStyle={overlayStyle}
        panelStyle={panelStyle}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>删除环境变量？</div>
        <div style={{ fontSize: 12, color: tokens.textSecondary, lineHeight: 1.5, marginBottom: 14 }}>
          将永久删除 <code>{deleteTarget}</code>。子进程将无法再读取该密钥，且无法从 UI 恢复明文。
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            style={btnStyle}
            disabled={busy}
            onClick={() => setDeleteTarget(null)}
          >
            取消
          </button>
          <button
            type="button"
            style={{ ...primaryBtnStyle, background: tokens.danger }}
            disabled={busy}
            onClick={confirmDelete}
          >
            确认删除
          </button>
        </div>
      </Modal>
    </>
  )
}
