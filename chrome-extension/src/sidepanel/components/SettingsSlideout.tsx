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
  const [autoApprovedConfirm, setAutoApprovedConfirm] = useState(false)

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

  const handleAutoApprovedDomainsChange = (value: string) => {
    const auto_approved_domains = value
      .split(/\n|,/)
      .map(domain => domain.trim())
      .filter(Boolean)
    dispatch({ type: "SET_CONFIG", config: { auto_approved_domains } })
  }

  const handleAutoApproveDangerousChange = (checked: boolean) => {
    dispatch({ type: "SET_CONFIG", config: { auto_approve_dangerous: checked } })
  }

  const handleShortcutChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch({ type: "SET_SEND_SHORTCUT", shortcut: e.target.value as any })
  }

  const handleTest = () => {
    dispatch({ type: "SET_TEST_RESULT", result: "测试中..." })
    // Pass the API key currently shown in the UI so the test reflects what the
    // user sees — even before they click Save. Falls back to the last saved key
    // in the background if config.api_key is empty.
    const llmOverride = (config.api_key && config.api_key !== "***")
      ? { api_key: config.api_key, base_url: config.base_url, model_name: config.model_name }
      : null
    chrome.runtime.sendMessage({ type: "config.test", llmOverride })
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
          {/* --- Obsidian Export --- */}
          <div style={styles.sectionTitle}>Obsidian 导出</div>
          <div style={styles.field}>
            <label style={styles.label}>Vault 路径</label>
            <input
              style={styles.input}
              value={config.obsidian_vault_path || ""}
              onChange={e => dispatch({ type: "SET_CONFIG", config: { obsidian_vault_path: e.target.value } })}
              placeholder="/path/to/your/vault"
            />
            <button
              style={{ ...styles.secondaryBtn, marginTop: 6 }}
              disabled={state.vaultPicker.picking}
              onClick={() => {
                // Ask the companion to open the OS native folder-picker (extensions can't
                // read real folder paths). The response sets config.obsidian_vault_path.
                dispatch({ type: "SET_VAULT_PICKER", picking: true, error: null })
                chrome.runtime.sendMessage({ type: "obsidian.pick_vault_folder" })
              }}
            >
              {state.vaultPicker.picking ? "选择中…" : "📂 选择文件夹"}
            </button>
            {state.vaultPicker.error && (
              <div style={{ ...styles.helpText, color: "#F44336", marginTop: 4 }}>
                {state.vaultPicker.error}
              </div>
            )}
            <div style={styles.helpText}>
              导出时会扫描此 vault:把约 200 篇笔记的 frontmatter + 正文前 200 字发给你的 LLM 提取 frontmatter / 命名 / tag 约定,并建立笔记索引、检测模板。缓存后导出自动套用——frontmatter 贴合约定、footer 用 [[wikilinks]] 链向相关笔记、并用 vault 模板骨架包裹。
            </div>
            <button
              style={styles.secondaryBtn}
              onClick={() => {
                const vp = config.obsidian_vault_path?.trim()
                if (!vp) return
                dispatch({ type: "SET_OBSIDIAN_PROFILE_STATUS", status: { ok: true, message: "分析中…" } })
                chrome.runtime.sendMessage({ type: "obsidian.refresh_profile", vault_path: vp })
              }}
            >
              刷新 vault 档案
            </button>
            {state.obsidianProfileStatus && (
              <div style={{ ...styles.helpText, color: state.obsidianProfileStatus.ok ? "#2E7D32" : "#F44336", marginTop: 6 }}>
                {state.obsidianProfileStatus.message}
              </div>
            )}
          </div>

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
            <label style={styles.label}>自动批准域名白名单</label>
            {autoApprovedConfirm ? (
              <>
                <textarea
                  style={{ ...styles.input, minHeight: 72, resize: "vertical" }}
                  value={(config.auto_approved_domains || []).join("\n")}
                  onChange={e => handleAutoApprovedDomainsChange(e.target.value)}
                  placeholder={"example.com\n*.company.com"}
                />
                <div style={styles.helpText}>
                  列入此处的域名，<code>evaluate</code> / <code>osascript_eval</code> / <code>navigate</code> / <code>create_tab</code> / <code>set_tab_url</code> 等高危操作将跳过确认弹窗。每行一个域名，支持 <code>*.company.com</code> 通配子域。
                </div>
              </>
            ) : (
              <div>
                <button
                  style={styles.secondaryBtn}
                  onClick={() => setAutoApprovedConfirm(true)}
                >
                  管理白名单（需二次确认）
                </button>
                <div style={styles.helpText}>
                  当前已配置 {(config.auto_approved_domains || []).length} 个自动批准域名
                </div>
              </div>
            )}
          </div>

          <div style={styles.field}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={config.auto_approve_dangerous === true}
                onChange={e => handleAutoApproveDangerousChange(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 500 }}>自动批准所有危险操作</div>
                <div style={{ fontSize: 11, color: "#B26B00", marginTop: 2 }}>
                  ⚠ 跳过所有 evaluate / navigate 等高危操作确认弹窗。仅供长期无人值守的可信工作流使用；任何被注入的恶意指令也将不再被拦截。
                </div>
              </div>
            </label>
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
            {!config.api_key && state.companionConfig?.api_key && (
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>
                Using Companion global config
              </div>
            )}
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
            {!config.model_name && state.companionConfig?.model_name && (
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>
                Using Companion global config: {state.companionConfig.model_name}
              </div>
            )}
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

          <div style={styles.divider} />

          {/* --- Vision Model Settings --- */}
          <div style={styles.sectionTitle}>视觉模型</div>

          <div style={styles.field}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={config.vision_enabled || false}
                onChange={e => dispatch({ type: "SET_CONFIG", config: { vision_enabled: e.target.checked } })}
              />
              启用截图视觉分析
            </label>
            <div style={styles.helpText}>
              通过本地视觉模型分析截图和图片内容，需要 Ollama 等本地推理服务
            </div>
          </div>

          {config.vision_enabled && (
            <>
              <div style={styles.field}>
                <label style={styles.label}>API Key</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    style={{ ...styles.input, flex: 1 }}
                    type={showKey ? "text" : "password"}
                    value={config.vision_api_key || ""}
                    onChange={e => dispatch({ type: "SET_CONFIG", config: { vision_api_key: e.target.value } })}
                    placeholder="留空则使用 Ollama（无需 API Key）"
                  />
                </div>
                <div style={styles.helpText}>
                  本地模型（Ollama）可留空；使用云服务视觉 API 时需填写
                </div>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Base URL</label>
                <input
                  style={styles.input}
                  type="text"
                  value={config.vision_base_url || "http://localhost:11434/v1"}
                  onChange={e => dispatch({ type: "SET_CONFIG", config: { vision_base_url: e.target.value } })}
                  placeholder="http://localhost:11434/v1"
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Model</label>
                <input
                  style={styles.input}
                  list="vision-model-options"
                  type="text"
                  value={config.vision_model_name || ""}
                  onChange={e => dispatch({ type: "SET_CONFIG", config: { vision_model_name: e.target.value } })}
                  placeholder="输入模型名称或从列表选择"
                />
                <datalist id="vision-model-options">
                  <option value="llava:7b" />
                  <option value="llava:13b" />
                  <option value="minicpm-v" />
                  <option value="qwen2.5vl:3b" />
                  <option value="moondream2" />
                </datalist>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>超时时间: {config.vision_timeout_ms || 30000} / 1000s</label>
                <input
                  style={{ width: "100%" }}
                  type="range"
                  min={10000}
                  max={60000}
                  step={5000}
                  value={config.vision_timeout_ms || 30000}
                  onChange={e => dispatch({ type: "SET_CONFIG", config: { vision_timeout_ms: parseInt(e.target.value) } })}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>降级策略</label>
                <select
                  style={styles.select}
                  value={config.vision_fallback || "metadata"}
                  onChange={e => dispatch({ type: "SET_CONFIG", config: { vision_fallback: e.target.value as "metadata" | "passthrough" | "error" } })}
                >
                  <option value="metadata">仅元数据（推荐）</option>
                  <option value="passthrough">透传原始图片</option>
                  <option value="error">报错</option>
                </select>
                <div style={styles.helpText}>
                  视觉模型不可用时的处理方式：仅元数据 = 发送页面标题和尺寸信息
                </div>
              </div>

              <div style={styles.field}>
                <button style={styles.testBtn} onClick={() => {
                  dispatch({ type: "SET_TEST_RESULT", result: "测试视觉模型连接中..." })
                  chrome.runtime.sendMessage({ type: "config.testVision" })
                }}>
                  测试视觉模型连接
                </button>
              </div>
            </>
          )}

          <div style={styles.divider} />

          {/* --- File Upload Settings --- */}
          <div style={styles.sectionTitle}>文件上传</div>

          <div style={styles.field}>
            <label style={styles.label}>最大文件大小: {((config.file_upload_max_size ?? 10485760) / (1024 * 1024)).toFixed(0)} MB</label>
            <input
              style={{ width: "100%" }}
              type="range"
              min={1}
              max={100}
              step={1}
              value={(config.file_upload_max_size ?? 10485760) / (1024 * 1024)}
              onChange={e => dispatch({ type: "SET_CONFIG", config: { file_upload_max_size: parseInt(e.target.value) * 1024 * 1024 } })}
            />
            <div style={styles.helpText}>
              上传文件的大小上限，范围 1–100 MB
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>最大 Token 数</label>
            <input
              style={styles.input}
              type="number"
              value={config.file_upload_max_tokens ?? 50000}
              onChange={e => dispatch({ type: "SET_CONFIG", config: { file_upload_max_tokens: parseInt(e.target.value) || 50000 } })}
              min={1000}
              max={200000}
              step={1000}
            />
            <div style={styles.helpText}>
              文件内容截断阈值，范围 1000–200000
            </div>
          </div>

          <div style={styles.field}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={config.file_upload_vision ?? true}
                onChange={e => dispatch({ type: "SET_CONFIG", config: { file_upload_vision: e.target.checked } })}
              />
              启用文件视觉分析
            </label>
            <div style={styles.helpText}>
              上传图片时尝试使用视觉模型分析图片内容
            </div>
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

        {state.companionConfig && (
          <div style={{
            fontSize: 11,
            color: "#999",
            padding: "8px 16px",
            borderTop: "1px solid #eee",
            textAlign: "center",
          }}>
            Companion 全局配置已同步{state.companionConfig.model_name ? ` (${state.companionConfig.model_name})` : ""}
          </div>
        )}
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
