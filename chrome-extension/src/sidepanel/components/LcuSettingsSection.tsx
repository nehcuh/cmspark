import { useEffect, useRef, useState, type CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import { SectionHeader } from "../ui/SectionHeader"
import { tokens } from "../ui/tokens"

const LCU_THREAD_SELECTION = "cmspark_lcu"
const INSTALL_URL = "https://github.com/amontlabs/lcu/blob/v0.13.0/docs/INSTALLATION.md"

interface LcuState {
  enabled: boolean
  coordinateEnabled: boolean
  platform: string
  architecture: string
  detection: "unsupported_platform" | "invalid_command" | "missing_lcu" | "detected_unverified"
  command?: string
  observed?: {
    lcuVersion: string
    appVersion: string
    runtimeVersion: string
    pair: "tested" | "untested" | "unknown"
    changedSinceInstall: boolean
    nativeVerified: false
  }
  refusal?: string
  activeRuns?: number
  cleanupUnknown?: boolean
  nativeVerified: false
}

const messages: Record<string, string> = {
  LCU_STATUS_UNVERIFIED: "请先检查本机兼容性。",
  LCU_VERSION_UNSUPPORTED: "当前仅适配 LCU v0.13.0。",
  LCU_PLATFORM_APPROVAL_NOT_VERIFIED: "Linux 当前仅发现安装路径，兼容检查与桌面操作尚未开放。",
  LCU_RUNTIME_CHANGED: "安装后运行时已变化，请重新核实兼容性。",
  LCU_RUNTIME_PAIR_UNVERIFIED: "上游尚未验证这一桌面应用与运行时组合。",
  LCU_OWNER_UNAVAILABLE: "认证连接已失效，请重新连接后操作。",
  LCU_COMMAND_INVALID: "请填写以 lcu 结尾的绝对可执行文件路径，不包含参数。",
  LCU_ENABLED_INVALID: "启用请求格式无效。",
  LCU_SETTINGS_REQUEST_INVALID: "设置请求格式无效，请确认扩展与 Companion 版本一致。",
  LCU_SETTINGS_FAILED: "操作未完成，请重新查看检测状态。",
  LCU_SETTINGS_BUSY: "另一个 LCU 设置操作尚未结束；停用仍可取消它。",
  LCU_HUMAN_APPROVAL_REQUIRED: "未完成所需的人工作业确认与原生身份验证；能力保持关闭。",
  LCU_GLOBAL_COMPUTER_DISABLED: "请先开启 Computer Use 总开关。",
  LCU_CLEANUP_UNKNOWN: "上一桌面连接的清理尚未确认；后续操作已阻止。",
}

function refusalText(code: string): string {
  return messages[code] ?? (code.startsWith("LCU_PROBE_") ? "兼容检查未完成；未启用桌面操作。" : `操作未完成（${code}）`)
}

function validState(value: unknown): value is LcuState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const s = value as LcuState
  return typeof s.enabled === "boolean" && typeof s.coordinateEnabled === "boolean" &&
    typeof s.platform === "string" && typeof s.architecture === "string" && s.nativeVerified === false &&
    (s.command === undefined || typeof s.command === "string") &&
    (s.refusal === undefined || (typeof s.refusal === "string" && /^LCU_[A-Z0-9_]{1,80}$/.test(s.refusal))) &&
    (s.cleanupUnknown === undefined || typeof s.cleanupUnknown === "boolean") &&
    (s.activeRuns === undefined || (Number.isSafeInteger(s.activeRuns) && s.activeRuns >= 0)) &&
    (s.observed === undefined || (!!s.observed && typeof s.observed === "object" &&
      typeof s.observed.lcuVersion === "string" && typeof s.observed.appVersion === "string" && typeof s.observed.runtimeVersion === "string" &&
      ["tested", "untested", "unknown"].includes(s.observed.pair) && typeof s.observed.changedSinceInstall === "boolean" && s.observed.nativeVerified === false)) &&
    ["unsupported_platform", "invalid_command", "missing_lcu", "detected_unverified"].includes(s.detection)
}

export function LcuSettingsSection() {
  const { state: agent, dispatch } = useAgentStore()
  const [state, setState] = useState<LcuState | null>(null)
  const [command, setCommand] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const pending = useRef<string | null>(null)
  const live = useRef(true)
  const currentThread = useRef({ id: agent.activeThreadId, ids: agent.activeMcpServerIds })
  currentThread.current = { id: agent.activeThreadId, ids: agent.activeMcpServerIds }

  const send = (type: string, extra: Record<string, unknown> = {}) => {
    const request_id = crypto.randomUUID()
    pending.current = request_id
    setBusy(true)
    setError("")
    chrome.runtime.sendMessage({ type, source: "settings", request_id, ...extra }, response => {
      if (!live.current || pending.current !== request_id) return
      if (chrome.runtime.lastError || response?.ok === false) {
        pending.current = null
        setBusy(false)
        setError("未连接到 Companion，请连接后重试。")
      }
    })
  }

  useEffect(() => {
    live.current = true
    const listener = (message: any) => {
      if (!live.current || !pending.current || message?.request_id !== pending.current) return
      if (message.type === "computer.lcu.state") {
        pending.current = null
        setBusy(false)
        if (!validState(message.state)) { setError("收到不兼容的 LCU 状态，请确认扩展与 Companion 版本一致。"); return }
        setState(message.state)
        setCommand(message.state.command ?? "")
        setError("")
      } else if (message.type === "error") {
        pending.current = null
        setBusy(false)
        setError(refusalText(typeof message.code === "string" ? message.code : "LCU_SETTINGS_FAILED"))
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => {
      live.current = false
      pending.current = null
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [])

  useEffect(() => {
    if (agent.connectionState === "connected") { send("computer.lcu.get_state"); return }
    if (pending.current) setError("连接已中断；尚未确认操作结果，请重新连接后查看状态。")
    pending.current = null
    setBusy(false)
    setState(null)
  }, [agent.connectionState])

  const selected = agent.activeMcpServerIds.includes(LCU_THREAD_SELECTION)
  const mac = state?.platform === "darwin" && state.architecture === "arm64"
  const canEnable = !!state && mac && state.coordinateEnabled && state.detection === "detected_unverified" &&
    !!state.observed && !state.refusal && !state.cleanupUnknown
  const detection = state?.detection === "unsupported_platform" ? "当前平台不可用"
    : state?.detection === "missing_lcu" ? "未发现 LCU"
    : state?.detection === "invalid_command" ? "可执行路径无效"
    : state?.observed ? "已检查兼容性" : state ? "已发现，尚未检查" : agent.connectionState === "connected" ? "读取状态中" : "请连接 Companion"

  const toggleThread = () => {
    const threadId = agent.activeThreadId
    if (!threadId || (!selected && !state?.enabled)) return
    const next = selected ? agent.activeMcpServerIds.filter(id => id !== LCU_THREAD_SELECTION)
      : [...agent.activeMcpServerIds, LCU_THREAD_SELECTION]
    const original = JSON.stringify(agent.activeMcpServerIds)
    chrome.runtime.sendMessage({ type: "thread.update", threadId, require_connected: true, updates: { active_mcp_server_ids: next } }, response => {
      if (!live.current || currentThread.current.id !== threadId) return
      if (chrome.runtime.lastError || response?.ok !== true) { setError("当前对话选择尚未保存，请连接后重试。"); return }
      if (JSON.stringify(currentThread.current.ids) === original) dispatch({ type: "TOGGLE_MCP_SERVER", serverName: LCU_THREAD_SELECTION })
    })
  }

  return <section aria-label="LCU 桌面操作" style={styles.section}>
    <SectionHeader title="LCU 桌面操作" meta="实验 · 默认关闭" />
    <p style={styles.help}>使用本机 ChatGPT 桌面应用提供的运行时。仅安装 Codex CLI 无法开启此能力；CMspark 不代为安装依赖。</p>
    <div style={styles.status} role="status">{detection}{state?.enabled ? " · 已启用" : " · 未启用"}</div>
    {state && <p style={styles.help}>{state.platform} / {state.architecture}。macOS Apple Silicon 可申请启用；Linux 仅发现安装路径，Windows 当前不可用。</p>}
    <label style={styles.label}>LCU 可执行文件
      <input value={command} onChange={event => setCommand(event.target.value)} placeholder="留空使用默认安装位置" style={styles.input} disabled={busy} />
    </label>
    <p style={styles.help}>填写绝对文件路径，不含参数。保存路径会停用 LCU；之后需重新检查和授权。</p>
    <div style={styles.actions}>
      <button style={styles.button} disabled={busy || agent.connectionState !== "connected"} onClick={() => send("computer.lcu.get_state")}>刷新状态</button>
      <button style={styles.button} disabled={busy || !state || state.detection === "unsupported_platform"} onClick={() => send("computer.lcu.configure", { command: command.trim() || null })}>保存路径</button>
      <button style={styles.button} disabled={busy || !mac || !state || state.detection === "unsupported_platform"} onClick={() => send("computer.lcu.probe")}>检查兼容性</button>
      <a href={INSTALL_URL} target="_blank" rel="noopener noreferrer" style={styles.link}>官方安装说明</a>
    </div>
    {state?.observed && <dl style={styles.details}>
      <dt>LCU</dt><dd>{state.observed.lcuVersion}</dd>
      <dt>ChatGPT</dt><dd>{state.observed.appVersion}</dd>
      <dt>运行时</dt><dd>{state.observed.runtimeVersion}</dd>
      <dt>上游兼容记录</dt><dd>{state.observed.pair === "tested" ? "已覆盖此组合" : state.observed.pair === "untested" ? "未覆盖此组合" : "未知"}</dd>
    </dl>}
    {state?.refusal && <p style={styles.help}>{refusalText(state.refusal)}</p>}
    {state && !state.coordinateEnabled && <p style={styles.help}>请先开启 Computer Use 总开关。启用 LCU 不会自动开启总开关。</p>}
    {state?.cleanupUnknown && <p style={styles.error}>上一桌面连接的清理尚未确认；后续操作已阻止。</p>}
    <div style={styles.actions}>
      <button style={styles.button} disabled={busy || !canEnable || state?.enabled} onClick={() => send("computer.lcu.set_enabled", { enabled: true })}>授权启用</button>
      <button style={styles.button} disabled={!state || (!state.enabled && !busy)} onClick={() => send("computer.lcu.set_enabled", { enabled: false })}>停用并停止</button>
    </div>
    <label style={styles.checkbox}><input type="checkbox" checked={selected} disabled={!agent.activeThreadId || agent.connectionState !== "connected" || (!selected && (!state?.enabled || agent.threads.find(thread => thread.id === agent.activeThreadId)?.agent_role === "worker"))} onChange={toggleThread} />在当前对话提供 LCU 工具</label>
    <p style={styles.help}>每次桌面动作仍需确认与原生身份验证，App 授权单独确认。仅交互式主对话可用；需要当前模型支持图像。桌面实操尚未验收，兼容记录不代表 CMspark 已完成原生验证。</p>
    {typeof state?.activeRuns === "number" && state.activeRuns > 0 && <p style={styles.help}>当前桌面连接：{state.activeRuns}</p>}
    {busy && <p style={styles.help} role="status">正在处理；如出现确认请求，请在确认台处理。</p>}
    {error && <p style={styles.error} role="alert">{error}</p>}
  </section>
}

const styles: Record<string, CSSProperties> = {
  section: { fontFamily: tokens.font, color: tokens.text, fontSize: 12 },
  help: { color: tokens.textSecondary, fontSize: 11, lineHeight: 1.6, margin: "6px 0" },
  status: { fontWeight: 500, marginTop: 8 },
  label: { display: "flex", flexDirection: "column", gap: 5, marginTop: 10 },
  input: { minWidth: 0, width: "100%", boxSizing: "border-box", padding: "7px 8px", border: `1px solid ${tokens.borderStrong}`, borderRadius: 5, background: tokens.bg, color: tokens.text, fontSize: 12 },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 },
  button: { border: `1px solid ${tokens.borderStrong}`, borderRadius: 5, background: tokens.bgElevated, color: tokens.text, padding: "5px 9px", fontSize: 12, cursor: "pointer" },
  link: { fontSize: 11, color: tokens.accent },
  checkbox: { display: "flex", alignItems: "center", gap: 6, marginTop: 12 },
  details: { display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 10, rowGap: 4, fontSize: 11, margin: "10px 0", overflowWrap: "anywhere" },
  error: { color: tokens.danger, fontSize: 11, lineHeight: 1.6 },
}
