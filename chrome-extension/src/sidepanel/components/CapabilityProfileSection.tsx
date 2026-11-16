// #284: Settings 能力档 — community ⇄ enterprise. Two-step confirm inside
// settings (NOT the L2 forceConfirm tool system); sends only modules.set_profile
// via the consent-gated helper — never the raw settings-config channel.

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import {
  buildProfileSwitchConfirm,
  resolveProfileSwitchSend,
  type CapabilityProfile,
} from "../utils/capability-profile"

type ModuleStateView = { available?: boolean; enabled?: boolean }

const PROFILE_SWITCH_UNKNOWN_MS = 15000
const PROFILE_SWITCH_UNKNOWN = "能力档切换结果未知。可以重试，或刷新本机能力列表核对。"

let profileSwitchSeq = 0

function nextProfileSwitchId(): string {
  profileSwitchSeq += 1
  return `profile-switch-${profileSwitchSeq}`
}

function authoritativeProfile(next: unknown, view: unknown): next is CapabilityProfile {
  return (next === "enterprise" && view === "provided") || (next === "community" && (view === "community" || view === "unavailable"))
}

export function CapabilityProfileSection() {
  const [profile, setProfile] = useState<CapabilityProfile>("community")
  const [modules, setModules] = useState<Record<string, ModuleStateView>>({})
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  const pendingProfile = useRef<{ id: string; to: CapabilityProfile } | null>(null)
  const retiredIds = useRef<Set<string>>(new Set())
  const timer = useRef<number | null>(null)

  const shellEnabled = modules.shell?.enabled === true
  const netsecEnabled = modules.netsec?.enabled === true
  const isEnterprise = profile === "enterprise"

  const flash = (msg: string, ms = 3500) => {
    setStatus(msg)
    setTimeout(() => setStatus(""), ms)
  }

  const clearTimer = () => {
    if (timer.current != null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  const releaseAttempt = (message: string, refresh: boolean) => {
    const id = pendingProfile.current?.id
    if (id) retiredIds.current.add(id)
    pendingProfile.current = null
    clearTimer()
    setBusy(false)
    flash(message)
    if (refresh) chrome.runtime.sendMessage({ type: "modules.list" })
  }

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "modules.list" })
    const handler = (msg: any) => {
      if (msg?.type === "thread.mutation.connection" && msg.state !== "connected" && pendingProfile.current) {
        releaseAttempt(PROFILE_SWITCH_UNKNOWN, true)
        return
      }
      if (msg?.type === "modules.list") {
        if (msg.modules) setModules(msg.modules)
        if (typeof msg.capability_profile === "string") {
          setProfile(msg.capability_profile === "enterprise" ? "enterprise" : "community")
        }
      }
      if (msg?.type === "modules.updated" && msg.capability_profile !== "community" && msg.capability_profile !== "enterprise") {
        if (msg.modules) setModules(msg.modules)
        return
      }
      if (msg?.type === "modules.updated" || msg?.type === "modules.profile.result") {
        const id = typeof msg.id === "string" ? msg.id : ""
        if (!id || retiredIds.current.has(id)) return
        const next = msg.capability_profile
        const view = msg.shell_provision
        const authoritative = authoritativeProfile(next, view)
        if (!pendingProfile.current || pendingProfile.current.id !== id) {
          if (pendingProfile.current || !authoritative) return
          if (msg.modules) setModules(msg.modules)
          setProfile(next)
          return
        }
        const expected = pendingProfile.current.to
        pendingProfile.current = null
        clearTimer()
        setBusy(false)
        if (!authoritative || next !== expected) {
          retiredIds.current.add(id)
          flash("没有权威的能力档回执，界面保持切换前的状态", 5000)
          return
        }
        if (msg.modules) setModules(msg.modules)
        setProfile(next)
        const disabled = Array.isArray(msg.modules_disabled) ? msg.modules_disabled : []
        flash(disabled.length > 0 ? `能力档已切换；已关闭 ${disabled.join("、")}` : "能力档已更新", 3500)
      }
      if (msg?.type === "error") {
        const id = typeof msg.id === "string" ? msg.id : ""
        if (!pendingProfile.current || id !== pendingProfile.current.id) return
        releaseAttempt(msg.error || "操作失败", false)
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => {
      chrome.runtime.onMessage.removeListener(handler)
      if (timer.current != null) clearTimeout(timer.current)
      if (pendingProfile.current) retiredIds.current.add(pendingProfile.current.id)
      pendingProfile.current = null
    }
  }, [])

  const requestSwitch = (to: CapabilityProfile) => {
    const confirm = buildProfileSwitchConfirm({ from: profile, to, shellEnabled, netsecEnabled })
    // null = same profile — never a switch; nothing to confirm, nothing to send.
    if (!confirm) return
    const confirmed = window.confirm(`${confirm.title}\n\n${confirm.body}`)
    const frame = resolveProfileSwitchSend({ confirmed, from: profile, to })
    if (!frame) return
    const id = nextProfileSwitchId()
    pendingProfile.current = { id, to }
    setBusy(true)
    const acceptTransport = (response?: { ok?: boolean; error?: string }) => {
      if (pendingProfile.current?.id !== id) return
      if (response?.ok === false) {
        releaseAttempt(response.error || "能力档请求未能发送。可以重试。", false)
        return
      }
      if (chrome.runtime.lastError || response?.ok !== true) {
        releaseAttempt(PROFILE_SWITCH_UNKNOWN, true)
        return
      }
      timer.current = setTimeout(() => {
        if (pendingProfile.current?.id !== id) return
        releaseAttempt(PROFILE_SWITCH_UNKNOWN, true)
      }, PROFILE_SWITCH_UNKNOWN_MS)
    }
    try {
      chrome.runtime.sendMessage({ ...frame, id }, acceptTransport)
    } catch {
      acceptTransport(undefined)
    }
  }

  return (
    <div data-testid="capability-profile-section">
      <div style={styles.sectionTitle}>能力档</div>
      <div style={styles.help}>
        enterprise 档提供 shell。netsec 不会随档位自动开启。命令仍需策略和 L2 确认。
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
            切回 community 后 shell 不再提供；已开启的 netsec 会关闭。
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
