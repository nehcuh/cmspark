// Settings slideout panel for LLM configuration

import { useState } from "react"
import { useAgentStore } from "../store/agentStore"
import type { PrivilegeMode } from "../types"

const PRIVILEGE_MODE_OPTIONS: { value: PrivilegeMode; label: string; desc: string }[] = [
  { value: "readonly", label: "只读", desc: "仅允许查询和浏览操作，禁止任何修改" },
  { value: "standard", label: "标准", desc: "允许常规操作，高风险操作需确认" },
  { value: "advanced", label: "高级", desc: "允许所有操作，确认阈值降低" },
]

const SAFETY_SKILLS = [
  { id: "cookie_guard", label: "Cookie 守卫" },
  { id: "eval_guard", label: "代码执行守卫" },
  { id: "nav_guard", label: "导航守卫" },
  { id: "input_guard", label: "输入守卫" },
]

export function SettingsSlideout() {
  const { state, dispatch } = useAgentStore()
  const [showKey, setShowKey] = useState(false)
  const [showAuditLog, setShowAuditLog] = useState(false)
  const [trustedDomainsConfirm, setTrustedDomainsConfirm] = useState(false)

  if (!state.settingsOpen) return null

  const config = state.config

  const handleSave = () => {
    chrome.runtime.sendMessage({ type: "config.set", config }, () => {
      dispatch({ type: "TOGGLE_SETTINGS" })
    })
  }

  const handleTrustedDomainsChange = (value: string) => {
    const trusted_domains = value
      .split(/\n|,/)
      .map(domain => domain.trim())
      .filter(Boolean)
    dispatch({ type: "SET_CONFIG", config: { trusted_domains } })
  }

  const handleShortcutChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch({ type: "SET_SEND_SHORTCUT", shortcut: e.target.value as any })
  }

  const handleTest = () => {
    dispatch({ type: "SET_TEST_RESULT", result: "测试中..." })
    chrome.runtime.sendMessage({ type: "config.test" })
  }

  const handlePrivilegeChange = (mode: PrivilegeMode) => {
    dispatch({ type: "SET_PRIVILEGE_MODE", mode })
    dispatch({ type: "SET_CONFIG", config: { privilege_mode: mode } })
  }

  const toggleSafetySkill = (skillId: string) => {
    const current = config.safety_skills_enabled || []
    const next = current.includes(skillId)
      ? current.filter(id => id !== skillId)
      : [...current, skillId]
    dispatch({ type: "SET_CONFIG", config: { safety_skills_enabled: next } })
  }

  return (
    <div style={styles.backdrop} onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={{ margin: 0, fontSize: 15 }}>设置</h3>
          <button style={styles.closeBtn} onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}>✕</button>
        </div>

        <div style={styles.body}>
          {/* --- Security Settings --- */}
          <div style={styles.sectionTitle}>安全设置</div>

          <div style={styles.field}>
            <label style={styles.label}>特权模式</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {PRIVILEGE_MODE_OPTIONS.map(opt => (
                <label key={opt.value} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="privilege_mode"
                    value={opt.value}
                    checked={(config.privilege_mode || "standard") === opt.value}
                    onChange={() => handlePrivilegeChange(opt.value)}
                    style={{ marginTop: 3 }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>安全技能</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {SAFETY_SKILLS.map(skill => (
                <label key={skill.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={(config.safety_skills_enabled || []).includes(skill.id)}
                    onChange={() => toggleSafetySkill(skill.id)}
                  />
                  {skill.label}
                </label>
              ))}
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Cookie 信任域</label>
            {trustedDomainsConfirm ? (
              <>
                <textarea
                  style={{ ...styles.input, minHeight: 72, resize: "vertical" }}
                  value={(config.trusted_domains || []).join("\n")}
                  onChange={e => handleTrustedDomainsChange(e.target.value)}
                  placeholder={"example.com\n*.company.com"}
                />
                <div style={styles.helpText}>
                  每行一个域名；支持 <code>*.company.com</code> 通配子域。仅调试环境建议使用 <code>*</code>。
                </div>
              </>
            ) : (
              <div>
                <button
                  style={styles.secondaryBtn}
                  onClick={() => setTrustedDomainsConfirm(true)}
                >
                  管理信任域（需二次确认）
                </button>
                <div style={styles.helpText}>
                  当前已配置 {(config.trusted_domains || []).length} 个信任域
                </div>
              </div>
            )}
          </div>

          <div style={styles.field}>
            <label style={styles.label}>安全审计日志</label>
            {showAuditLog ? (
              <div style={{ maxHeight: 200, overflowY: "auto", background: "#f9f9f9", borderRadius: 6, padding: 8, fontSize: 11 }}>
                {state.securityAuditLog.length === 0 ? (
                  <div style={{ color: "#999", padding: "8px 0" }}>暂无审计记录</div>
                ) : (
                  state.securityAuditLog.slice(-20).map(entry => (
                    <div key={entry.id} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid #eee" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{
                          color: entry.action === "allowed" ? "#4CAF50" : entry.action === "denied" ? "#FF9800" : "#F44336",
                          fontWeight: 600,
                        }}>
                          {entry.action === "allowed" ? "允许" : entry.action === "denied" ? "拒绝" : "阻断"}
                        </span>
                        <span style={{ color: "#666" }}>{entry.tool_name}</span>
                        <span style={{ color: "#999", marginLeft: "auto" }}>{entry.ts.slice(11, 19)}</span>
                      </div>
                      <div style={{ color: "#888", marginTop: 2 }}>{entry.message}</div>
                    </div>
                  ))
                )}
                <button style={{ ...styles.secondaryBtn, marginTop: 8 }} onClick={() => setShowAuditLog(false)}>
                  收起日志
                </button>
              </div>
            ) : (
              <button style={styles.secondaryBtn} onClick={() => setShowAuditLog(true)}>
                查看审计日志（{state.securityAuditLog.length} 条）
              </button>
            )}
          </div>

          <div style={styles.divider} />

          {/* --- LLM Settings --- */}
          <div style={styles.sectionTitle}>LLM 配置</div>

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
              list="model-options"
              type="text"
              value={config.model_name}
              onChange={e => dispatch({ type: "SET_CONFIG", config: { model_name: e.target.value } })}
              placeholder="输入模型名称或从列表选择"
            />
            <datalist id="model-options">
              <option value="deepseek-v4-flash" />
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
  helpText: {
    marginTop: 6,
    fontSize: 11,
    color: "#777",
    lineHeight: 1.4,
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
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#333",
    marginBottom: 12,
    marginTop: 8,
    paddingBottom: 6,
    borderBottom: "1px solid #eee",
  },
  divider: {
    height: 1,
    background: "#eee",
    margin: "16px 0",
  },
  secondaryBtn: {
    padding: "6px 14px",
    border: "1px solid #ddd",
    borderRadius: 6,
    background: "#fff",
    color: "#555",
    fontSize: 12,
    cursor: "pointer",
  },
}
