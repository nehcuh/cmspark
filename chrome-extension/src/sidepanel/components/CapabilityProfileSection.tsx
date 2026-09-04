// #284: Settings 能力档 — community ⇄ enterprise. Two-step confirm inside
// settings (NOT the L2 forceConfirm tool system); sends only modules.set_profile
// via the consent-gated helper — never the raw settings-config channel.

import { useEffect, useState, type CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import {
  buildProfileSwitchConfirm,
  resolveProfileSwitchSend,
  type CapabilityProfile,
} from "../utils/capability-profile"

type ModuleStateView = { available?: boolean; enabled?: boolean }

export function CapabilityProfileSection() {
  const [profile, setProfile] = useState<CapabilityProfile>("community")
  const [modules, setModules] = useState<Record<string, ModuleStateView>>({})
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)

  const shellEnabled = modules.shell?.enabled === true
  const netsecEnabled = modules.netsec?.enabled === true
  const isEnterprise = profile === "enterprise"

  const flash = (msg: string, ms = 3500) => {
    setStatus(msg)
    setTimeout(() => setStatus(""), ms)
  }

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "modules.list" })
    const handler = (msg: any) => {
      if (msg?.type === "modules.list" || msg?.type === "modules.updated") {
        if (msg.modules) setModules(msg.modules)
        if (typeof msg.capability_profile === "string") {
          setProfile(msg.capability_profile === "enterprise" ? "enterprise" : "community")
        }
        if (msg.type === "modules.updated") {
          setBusy(false)
          const disabled = Array.isArray(msg.modules_disabled) ? msg.modules_disabled : []
          flash(
            disabled.length > 0
              ? `能力档已切换；已强制关闭 ${disabled.join("、")}`
              : "能力档已更新",
            3500,
          )
        }
      }
      if (msg?.type === "error") {
        flash(msg.error || "操作失败", 5000)
        setBusy(false)
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  const requestSwitch = (to: CapabilityProfile) => {
    const confirm = buildProfileSwitchConfirm({ from: profile, to, shellEnabled, netsecEnabled })
    // null = same profile — never a switch; nothing to confirm, nothing to send.
    if (!confirm) return
    const confirmed = window.confirm(`${confirm.title}\n\n${confirm.body}`)
    const frame = resolveProfileSwitchSend({ confirmed, from: profile, to })
    if (!frame) return
    setBusy(true)
    chrome.runtime.sendMessage(frame)
  }

  return (
    <div data-testid="capability-profile-section">
      <div style={styles.sectionTitle}>能力档</div>
      <div style={styles.help}>
        安装级档位，决定能否开启企业能力。enterprise 才允许 shell（宿主命令执行）、
        netsec（端口扫描）与应用企业场景包；切换本身不会开启任何模块。
      </div>
      {status && <div style={styles.status}>{status}</div>}
      <div style={styles.card}>
        <div style={styles.row}>
          <span style={styles.current}>
            当前：<strong>{isEnterprise ? "enterprise" : "community"}</strong>
          </span>
          <button
            type="button"
            style={isEnterprise ? styles.secondaryBtn : styles.primaryBtn}
            onClick={() => requestSwitch(isEnterprise ? "community" : "enterprise")}
            disabled={busy}
          >
            {isEnterprise ? "切回 community" : "切换到 enterprise"}
          </button>
        </div>
        {(shellEnabled || netsecEnabled) && (
          <div style={styles.hint}>
            shell / netsec 电源当前开着 — 切回 community 会将它们强制断电。
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  sectionTitle: {
    fontSize: 13,
    fontWeight: 650,
    color: tokens.text,
    marginBottom: 6,
  },
  help: {
    fontSize: 11,
    color: tokens.textMuted,
    lineHeight: 1.45,
    marginBottom: 8,
  },
  status: { fontSize: 11, color: tokens.accent, marginBottom: 6 },
  card: {
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    padding: 10,
    background: tokens.bg,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  current: { fontSize: 12, color: tokens.text },
  hint: { fontSize: 11, color: tokens.warning, marginTop: 6 },
  primaryBtn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.borderStrong}`,
    background: tokens.bgActive,
    color: tokens.accent,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
  secondaryBtn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.borderStrong}`,
    background: tokens.bgElevated,
    color: tokens.text,
    cursor: "pointer",
    fontFamily: tokens.font,
  },
}
