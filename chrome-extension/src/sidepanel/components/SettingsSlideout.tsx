// Settings slideout panel for LLM configuration + NetSec (migrated from 场景 panel)

import { useState, useEffect, useCallback } from "react"
import { useAgentStore } from "../store/agentStore"
import { Modal } from "./ui/Modal"
import { tokens } from "../ui/tokens"
import { UserEnvSection } from "./UserEnvSection"
import { NetSecSettingsSection } from "./NetSecSettingsSection"
import { OutboundMcpSettingsSection } from "./OutboundMcpSettingsSection"
import { SettingsSection } from "./SettingsSection"
import {
  defaultUserOpenSections,
  isElevatedTrust,
  isSectionEffectivelyOpen,
  LS_SETTINGS_EXPAND,
  parseSettingsExpand,
  serializeSettingsExpand,
  SETTINGS_SECTION_IDS,
  toggleSectionOpen,
  type SettingsSectionId,
} from "../utils/settings-sections"
// WP5-I4 实验功能段:组件纯渲染,文案/判定全部来自 logic 纯函数(镜像
// companion 单一真源);发送固定 source:"settings"(companion 双层围栏)。
import {
  MODEL_SWITCH_COPY,
  QWEN_VL_VARIANT_TIPS,
  licenseDoorShouldOpen,
  modelStatusLine,
  modelSwitchDisabledReason,
  modelSwitchHint,
  modelSwitchRunningNote,
  variantResourceTip,
} from "./model-switch-logic"
import {
  AUTOPILOT_CONSEQUENCE_ROWS,
  UNATTENDED_MATRIX_FOOTNOTES,
  type AutopilotArmPick,
  type AutopilotTier,
  deriveDisplayTier,
  disarmAllFlags,
  flagsNeedingArm,
  flagsNeedingDisarm,
  targetFlagsForTier,
  tierShortLabel,
  trustStatusChip,
} from "./autopilot-tier"

// P1-1 / PR-B: typed-confirmation phrase for arming dangerous security flags.
// Lock-step with companion/src/security-arm.ts SECURITY_ARM_CONFIRM_PHRASE —
// companion rejects false→true without this top-level confirmation_phrase.
// UI phrase alone is theater; arm path must forward phrase on config.set.
// Alias kept as SECURITY_ARM_CONFIRM_PHRASE semantics; not a product "God" noun.
const GODMODE_CONFIRM_PHRASE = "我了解风险"
const SECURITY_ARM_PHRASE = GODMODE_CONFIRM_PHRASE

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
  const [wsSecretInput, setWsSecretInput] = useState("")
  const [wsPaired, setWsPaired] = useState<boolean | null>(null)
  const [wsPairingMsg, setWsPairingMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // PR-B God-mode: the typed-confirmation sub-panel + its input + feedback.
  const [godmodeConfirm, setGodmodeConfirm] = useState(false)
  const [godmodePhrase, setGodmodePhrase] = useState("")
  const [godmodeMsg, setGodmodeMsg] = useState<string | null>(null)
  // Plan B enterprise auto-approve phrase gate
  const [entBConfirm, setEntBConfirm] = useState(false)
  const [entBPhrase, setEntBPhrase] = useState("")
  const [entBMsg, setEntBMsg] = useState<string | null>(null)
  // Alias of GODMODE_CONFIRM_PHRASE (companion SECURITY_ARM_CONFIRM_PHRASE) — one literal in this file.
  const ENT_B_PHRASE = GODMODE_CONFIRM_PHRASE
  // auto_approve_dangerous phrase gate (P1-1 — companion requires step-up on arm)
  const [autoDangerConfirm, setAutoDangerConfirm] = useState(false)
  const [autoDangerPhrase, setAutoDangerPhrase] = useState("")
  const [autoDangerMsg, setAutoDangerMsg] = useState<string | null>(null)
  // Trust IA + ADR-021: Autopilot package arm / unattended
  const [autopilotTierPick, setAutopilotTierPick] = useState<AutopilotArmPick>("browser")
  const [autopilotConfirm, setAutopilotConfirm] = useState(false)
  const [autopilotPhrase, setAutopilotPhrase] = useState("")
  const [autopilotMsg, setAutopilotMsg] = useState<string | null>(null)
  const [autopilotBusy, setAutopilotBusy] = useState(false)
  const [advancedGatesOpen, setAdvancedGatesOpen] = useState(false)
  const [unattendedAckDesktop, setUnattendedAckDesktop] = useState(false)
  const [unattendedAckSession, setUnattendedAckSession] = useState(false)
  const [unattendedIncludeProtocol, setUnattendedIncludeProtocol] = useState(false)
  // WP5-I4 实验区:删除模型两步确认按钮的待命态(非 store——纯组件内 UI 态)。
  const [modelDeleteArmed, setModelDeleteArmed] = useState(false)
  // W1 accordion: user open preferences (force rules applied in isSectionOpen).
  const [userOpenSections, setUserOpenSections] = useState<Set<SettingsSectionId>>(() => {
    try {
      const parsed = parseSettingsExpand(localStorage.getItem(LS_SETTINGS_EXPAND))
      if (parsed) return parsed
    } catch {
      /* ignore */
    }
    return defaultUserOpenSections(null)
  })

  const elevatedTrust = isElevatedTrust({
    auto_approve_dangerous: state.config.auto_approve_dangerous,
    auto_approve_enterprise_tools: state.config.auto_approve_enterprise_tools,
    allow_all_schemes: state.config.allow_all_schemes,
    unattendedArmed: state.unattended?.armed === true,
  })

  const isSectionOpen = useCallback(
    (id: SettingsSectionId) =>
      isSectionEffectivelyOpen(id, {
        userOpen: userOpenSections,
        wsPaired,
        elevatedTrust,
      }),
    [userOpenSections, wsPaired, elevatedTrust],
  )

  const handleToggleSection = useCallback((id: SettingsSectionId) => {
    // When force-open (unpaired connection / elevated security), still allow user
    // to toggle LS preference — but effective open stays forced until force clears.
    setUserOpenSections((prev) => {
      const next = toggleSectionOpen(id, prev)
      try {
        localStorage.setItem(LS_SETTINGS_EXPAND, serializeSettingsExpand(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  // P0-2B: check on open whether a WS pairing secret is already stored, so the
  // status badge reflects the real pairing state (not just connection state).
  useEffect(() => {
    if (!state.settingsOpen) return
    // Reset stale pairing feedback + re-check stored-secret presence each open.
    setWsPairingMsg(null)
    // Reset any stale security arm confirmation panels from a previous open.
    setGodmodeConfirm(false)
    setGodmodePhrase("")
    setGodmodeMsg(null)
    setEntBConfirm(false)
    setEntBPhrase("")
    setEntBMsg(null)
    setAutoDangerConfirm(false)
    setAutoDangerPhrase("")
    setAutoDangerMsg(null)
    setAutopilotConfirm(false)
    setAutopilotPhrase("")
    setAutopilotMsg(null)
    setAutopilotBusy(false)
    setUnattendedAckDesktop(false)
    setUnattendedAckSession(false)
    setUnattendedIncludeProtocol(false)
    // Hydrate unattended grant for chip / disarm
    chrome.runtime.sendMessage({ type: "security.unattended.status" })
    // WP5-I4 实验区:打开设置页拉一次模型状态(后续由 state 广播驱动,
    // 无乐观更新);清掉上次打开残留的错误与删除待命态。
    setModelDeleteArmed(false)
    dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
    chrome.runtime.sendMessage({ type: "computer.model.get_state" })
    chrome.runtime.sendMessage({ type: "ws.getPairingStatus" }, (resp: { paired?: boolean } | undefined) => {
      const paired = !!resp?.paired
      setWsPaired(paired)
      // First open without LS: seed defaults from pairing (F-UX3).
      try {
        if (localStorage.getItem(LS_SETTINGS_EXPAND) == null) {
          const seed = defaultUserOpenSections(paired)
          setUserOpenSections(seed)
          localStorage.setItem(LS_SETTINGS_EXPAND, serializeSettingsExpand(seed))
        }
      } catch {
        /* ignore */
      }
    })
  }, [state.settingsOpen])

  // Auto-expand advanced gates when any arm flag is on (user can still collapse).
  // Parent「安全与信任」is force-opened via isSectionEffectivelyOpen (F-S1).
  useEffect(() => {
    if (!state.settingsOpen) return
    const c = state.config
    if (
      c.auto_approve_dangerous === true ||
      c.auto_approve_enterprise_tools === true ||
      c.allow_all_schemes === true ||
      state.unattended?.armed === true
    ) {
      setAdvancedGatesOpen(true)
    }
  }, [
    state.settingsOpen,
    state.config.auto_approve_dangerous,
    state.config.auto_approve_enterprise_tools,
    state.config.allow_all_schemes,
    state.unattended?.armed,
  ])

  // F-UX7 deep-link: open target accordion section once settings opens.
  useEffect(() => {
    if (!state.settingsOpen || !state.settingsFocusSection) return
    const id = state.settingsFocusSection as SettingsSectionId
    if (!(SETTINGS_SECTION_IDS as readonly string[]).includes(id)) {
      dispatch({ type: "CLEAR_SETTINGS_FOCUS" })
      return
    }
    setUserOpenSections((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      try {
        localStorage.setItem(LS_SETTINGS_EXPAND, serializeSettingsExpand(next))
      } catch {
        /* ignore */
      }
      return next
    })
    dispatch({ type: "CLEAR_SETTINGS_FOCUS" })
  }, [state.settingsOpen, state.settingsFocusSection, dispatch])

  if (!state.settingsOpen) return null

  const config = state.config

  const handleSave = () => {
    chrome.runtime.sendMessage({ type: "config.set", config }, () => {
      dispatch({ type: "TOGGLE_SETTINGS" })
    })
  }

  // P0-2B: store the WS shared secret (out-of-band, pasted from
  // `cmspark-agent settings --ws-secret` first-run output) and reconnect so the
  // background WSClient authenticates against the companion's challenge.
  const handleWsPair = () => {
    const secret = wsSecretInput.trim()
    if (!secret) {
      setWsPairingMsg({ ok: false, text: "请粘贴 Companion 输出的配对密钥" })
      return
    }
    setWsPairingMsg({ ok: true, text: "配对中，正在重连…" })
    chrome.runtime.sendMessage({ type: "ws.setSecret", secret }, (resp: { ok?: boolean; error?: string }) => {
      if (resp?.ok) {
        setWsPaired(true)
        setWsSecretInput("")
        setWsPairingMsg({ ok: true, text: "已配对，正在鉴权重连…" })
      } else {
        setWsPairingMsg({ ok: false, text: resp?.error || "配对失败" })
      }
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

  // P1-1: arm paths send focused config.set + confirmation_phrase so companion
  // step-up is not UI theater. Disarm needs no phrase. handleSave re-sends
  // already-true flags without phrase (transition-only gate).
  const sendSecurityFlagConfig = (
    partial: Record<string, boolean>,
    confirmation_phrase?: string,
  ) => {
    chrome.runtime.sendMessage({
      type: "config.set",
      config: partial,
      ...(confirmation_phrase != null ? { confirmation_phrase } : {}),
    })
  }

  const handleAutoApproveDangerousChange = (checked: boolean) => {
    if (!checked) {
      dispatch({ type: "SET_CONFIG", config: { auto_approve_dangerous: false } })
      sendSecurityFlagConfig({ auto_approve_dangerous: false })
      setAutoDangerConfirm(false)
      setAutoDangerPhrase("")
      setAutoDangerMsg(null)
      return
    }
    setAutoDangerConfirm(true)
    setAutoDangerPhrase("")
    setAutoDangerMsg(null)
  }

  const handleAutoApproveDangerousConfirm = () => {
    if (autoDangerPhrase.trim() !== GODMODE_CONFIRM_PHRASE) {
      setAutoDangerMsg(`请输入「${GODMODE_CONFIRM_PHRASE}」`)
      return
    }
    const phrase = autoDangerPhrase.trim()
    dispatch({ type: "SET_CONFIG", config: { auto_approve_dangerous: true } })
    sendSecurityFlagConfig({ auto_approve_dangerous: true }, phrase)
    setAutoDangerConfirm(false)
    setAutoDangerPhrase("")
    setAutoDangerMsg(null)
  }

  const handleEnterpriseAutoApproveToggle = (checked: boolean) => {
    if (!checked) {
      dispatch({ type: "SET_CONFIG", config: { auto_approve_enterprise_tools: false } })
      sendSecurityFlagConfig({ auto_approve_enterprise_tools: false })
      setEntBConfirm(false)
      setEntBPhrase("")
      setEntBMsg(null)
      return
    }
    setEntBConfirm(true)
    setEntBPhrase("")
    setEntBMsg(null)
  }

  const handleEnterpriseAutoApproveConfirm = () => {
    if (entBPhrase.trim() !== ENT_B_PHRASE) {
      setEntBMsg(`请输入「${ENT_B_PHRASE}」`)
      return
    }
    const phrase = entBPhrase.trim()
    dispatch({ type: "SET_CONFIG", config: { auto_approve_enterprise_tools: true } })
    sendSecurityFlagConfig({ auto_approve_enterprise_tools: true }, phrase)
    setEntBConfirm(false)
    setEntBPhrase("")
    setEntBMsg(null)
  }

  // PR-B God-mode (security.allow_all_schemes). Bypasses BOTH layers — strictly
  // stronger than auto_approve_dangerous. Arming requires a typed phrase; disarming
  // is frictionless (safe direction). Either direction is recorded as an audit entry
  // (design §B godmode_enabled_changed, source = ui_phrase_confirmed).
  const handleGodModeToggle = (checked: boolean) => {
    if (checked) {
      // Arming: open the typed-confirmation panel, do NOT flip yet.
      setGodmodeConfirm(true)
      setGodmodePhrase("")
      setGodmodeMsg(null)
      return
    }
    // Disarming is safe — flip immediately + audit + companion config.set (no phrase).
    dispatch({ type: "SET_CONFIG", config: { allow_all_schemes: false } })
    sendSecurityFlagConfig({ allow_all_schemes: false })
    dispatch({
      type: "ADD_SECURITY_AUDIT",
      entry: {
        id: `godmode-off-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        level: "info",
        tool_name: "allow_all_schemes",
        action: "changed",
        risk_level: "low",
        risk_score: 0,
        source: "ui_phrase_confirmed",
        message: "已关闭协议解锁（恢复协议保护：L1 scheme 硬阻断 + 网页 L2 确认门重新生效）",
      },
    })
  }

  const handleGodModeConfirm = () => {
    if (godmodePhrase.trim() !== SECURITY_ARM_PHRASE) {
      setGodmodeMsg(`确认短语不匹配，请输入「${SECURITY_ARM_PHRASE}」`)
      return
    }
    const phrase = godmodePhrase.trim()
    dispatch({ type: "SET_CONFIG", config: { allow_all_schemes: true } })
    // P1-1: companion requires confirmation_phrase on false→true (not theater).
    sendSecurityFlagConfig({ allow_all_schemes: true }, phrase)
    dispatch({
      type: "ADD_SECURITY_AUDIT",
      entry: {
        id: `protocol-unlock-on-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        level: "error",
        tool_name: "allow_all_schemes",
        action: "changed",
        risk_level: "high",
        risk_score: 100,
        source: "ui_phrase_confirmed",
        message:
          "已启用协议解锁（allow_all_schemes）— L1 scheme 硬阻断 + 部分网页 L2 已绕过；不含 shell/CU/spawn forceConfirm",
      },
    })
    setGodmodeConfirm(false)
    setGodmodePhrase("")
    setGodmodeMsg(null)
  }

  const applySecurityFlagsTarget = (
    target: {
      auto_approve_dangerous: boolean
      auto_approve_enterprise_tools: boolean
      allow_all_schemes: boolean
    },
    phrase: string | undefined,
    auditMessage: string,
  ) => {
    const current = {
      auto_approve_dangerous: config.auto_approve_dangerous === true,
      auto_approve_enterprise_tools: config.auto_approve_enterprise_tools === true,
      allow_all_schemes: config.allow_all_schemes === true,
    }
    const toDisarm = flagsNeedingDisarm(current, target)
    const toArm = flagsNeedingArm(current, target)
    for (const k of toDisarm) {
      sendSecurityFlagConfig({ [k]: false })
    }
    for (const k of toArm) {
      if (!phrase) return
      sendSecurityFlagConfig({ [k]: true }, phrase)
    }
    dispatch({ type: "SET_CONFIG", config: { ...target } })
    dispatch({
      type: "ADD_SECURITY_AUDIT",
      entry: {
        id: `autopilot-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        level: toArm.length > 0 ? "error" : "info",
        tool_name: "autopilot_packaging",
        action: "changed",
        risk_level: toArm.length > 0 ? "high" : "low",
        risk_score: toArm.length > 0 ? 80 : 0,
        source: "ui_phrase_confirmed",
        message: `${auditMessage} [${[...toArm, ...toDisarm.map((k) => `-${k}`)].join(", ") || "noop"}]`,
      },
    })
  }

  const handleAutopilotArmConfirm = () => {
    if (autopilotPhrase.trim() !== SECURITY_ARM_PHRASE) {
      setAutopilotMsg(`请输入「${SECURITY_ARM_PHRASE}」`)
      return
    }
    if (autopilotTierPick === "unattended") {
      if (!unattendedAckDesktop || !unattendedAckSession) {
        setAutopilotMsg("请勾选两项确认（桌面免初始确认 + 会话失效）")
        return
      }
    }
    const phrase = autopilotPhrase.trim()
    setAutopilotBusy(true)

    if (autopilotTierPick === "unattended") {
      // ADR-021: process grant via companion; dual-writes cruise flags server-side.
      // Background ACKs {ok:true|false}; real status arrives via WS broadcast
      // (security.unattended.status → SET_UNATTENDED_STATUS). Do not invent armed:true.
      chrome.runtime.sendMessage(
        {
          type: "security.unattended.arm",
          confirmation_phrase: phrase,
          include_protocol: unattendedIncludeProtocol === true,
          ack_desktop: true,
          ack_session: true,
        },
        (resp?: { ok?: boolean; error?: string }) => {
          const channelErr = chrome.runtime.lastError?.message
          if (channelErr) {
            // Classic MV3: SW did not answer (dead worker / no sendResponse).
            // Still probe status — a prior grant or delayed SW wake may succeed.
            setAutopilotMsg(
              channelErr.includes("message port closed")
                ? "扩展后台未响应（可能已休眠）。请：① 确认 Side Panel 顶部为「已连接」② chrome://extensions 点 CMspark「重新加载」后再试"
                : channelErr,
            )
            setAutopilotBusy(false)
            chrome.runtime.sendMessage({ type: "security.unattended.status" })
            return
          }
          if (resp && resp.ok === false) {
            setAutopilotMsg(resp.error || "武装失败")
            setAutopilotBusy(false)
            return
          }
          dispatch({
            type: "ADD_SECURITY_AUDIT",
            entry: {
              id: `unattended-on-${crypto.randomUUID()}`,
              ts: new Date().toISOString(),
              level: "error",
              tool_name: "unattended_desktop",
              action: "changed",
              risk_level: "high",
              risk_score: 100,
              source: "ui_phrase_confirmed",
              message:
                "已请求武装无人值守 — 值守 grant 生效；并写入全自动+协议巡航。三旗全开时 evaluate/shell/spawn/cookie/桌面 re-L2 等不再二次确认（自担风险）",
            },
          })
          setAutopilotConfirm(false)
          setAutopilotPhrase("")
          setAutopilotMsg(null)
          setAutopilotBusy(false)
          setAdvancedGatesOpen(true)
          // Reconcile flags + grant from companion (source of truth)
          chrome.runtime.sendMessage({ type: "config.get" })
          chrome.runtime.sendMessage({ type: "security.unattended.status" })
        },
      )
      return
    }

    // Non-unattended: dual-write flags only; clear any leftover unattended grant.
    // Do not invent armed:false — wait for security.unattended.status.
    chrome.runtime.sendMessage({ type: "security.unattended.disarm", clear_cruise: false }, () => {
      chrome.runtime.sendMessage({ type: "security.unattended.status" })
    })
    const target = targetFlagsForTier(
      autopilotTierPick,
      {
        auto_approve_dangerous: config.auto_approve_dangerous,
        auto_approve_enterprise_tools: config.auto_approve_enterprise_tools,
        allow_all_schemes: config.allow_all_schemes,
      },
    )
    applySecurityFlagsTarget(
      target,
      phrase,
      `武装运行自主度：${tierShortLabel(autopilotTierPick as AutopilotTier)}`,
    )
    setAutopilotConfirm(false)
    setAutopilotPhrase("")
    setAutopilotMsg(null)
    setAutopilotBusy(false)
    setAdvancedGatesOpen(true)
  }

  const handleAutopilotDisarm = () => {
    setAutopilotBusy(true)
    // Full disarm: companion SoT for grant + cruise; no optimistic SET_UNATTENDED_STATUS.
    chrome.runtime.sendMessage(
      { type: "security.unattended.disarm", clear_cruise: true },
      () => {
        if (chrome.runtime.lastError) {
          setAutopilotMsg(chrome.runtime.lastError.message || "解除失败（扩展通道）")
          setAutopilotBusy(false)
          return
        }
        applySecurityFlagsTarget(
          disarmAllFlags(),
          undefined,
          "解除运行自主度 / 无人值守（已关闭网页/企业/协议三类自动批准 + 桌面值守；进行中的桌面任务已请求中止）",
        )
        chrome.runtime.sendMessage({ type: "config.get" })
        chrome.runtime.sendMessage({ type: "security.unattended.status" })
        setAutopilotBusy(false)
        setAutopilotConfirm(false)
        setAutopilotPhrase("")
        setAutopilotMsg(null)
      },
    )
  }

  const handleShortcutChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch({ type: "SET_SEND_SHORTCUT", shortcut: e.target.value as any })
  }

  const handleTest = () => {
    // Reset both result channels — main LLM test always runs, vision test runs
    // only when the user has enabled 截图视觉分析. Showing both side-by-side
    // (instead of overwriting one result) lets the user see e.g. "主 API ✓ /
    // 视觉 ✗" without re-clicking.
    dispatch({ type: "SET_TEST_RESULT", result: "测试中..." })
    if (config.vision_enabled) {
      dispatch({ type: "SET_TEST_VISION_RESULT", result: "测试视觉模型中..." })
    } else {
      dispatch({ type: "SET_TEST_VISION_RESULT", result: null })
    }
    // Pass unsaved UI fields so the probe uses the same protocol/profile/url as Save.
    // api_key only when the user typed a real key; otherwise companion uses stored key.
    const llmOverride: Record<string, string> = {
      base_url: config.base_url,
      model_name: config.model_name,
      protocol: config.protocol === "anthropic" ? "anthropic" : "openai",
      client_header_profile:
        config.protocol === "anthropic" && config.client_header_profile === "claude_code_compat"
          ? "claude_code_compat"
          : "none",
    }
    if (config.api_key && config.api_key !== "***") {
      llmOverride.api_key = config.api_key
    }
    chrome.runtime.sendMessage({ type: "config.test", llmOverride })
    if (config.vision_enabled) {
      chrome.runtime.sendMessage({ type: "config.testVision" })
    }
  }

  const toggleSafetySkill = (skillId: string) => {
    const current = config.safety_skills_enabled || []
    const next = current.includes(skillId)
      ? current.filter(id => id !== skillId)
      : [...current, skillId]
    dispatch({ type: "SET_CONFIG", config: { safety_skills_enabled: next } })
  }

  return (
    <Modal
      open={state.settingsOpen}
      onClose={() => dispatch({ type: "TOGGLE_SETTINGS" })}
      overlayStyle={styles.backdrop}
      panelStyle={styles.panel}
      ariaLabel="设置"
    >
        <div style={styles.header}>
          <h3 style={{ margin: 0, fontSize: 15 }}>设置</h3>
          <button style={styles.closeBtn} onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}>✕</button>
        </div>

        <div style={{ ...styles.body, display: "flex", flexDirection: "column" }}>
          {/* IA order via flex order (settings-thread-compact W1) */}

          <div style={{ order: 1 }}>
            <SettingsSection
              title="连接与配对"
              open={isSectionOpen("connection")}
              onToggle={() => handleToggleSection("connection")}
              badge={wsPaired === false ? (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: 8,
                  color: "#B26B00",
                  background: tokens.warningSoft,
                }}>未配对</span>
              ) : wsPaired === true ? (
                <span style={{
                  fontSize: 10,
                  fontWeight: 400,
                  padding: "1px 6px",
                  borderRadius: 8,
                  color: tokens.success,
                  background: tokens.successSoft,
                }}>已配对</span>
              ) : null}
            >
          {/* --- Connection (P0-2B WS pairing) --- */}
          <div style={styles.field}>
            <label style={styles.label}>
              WS 配对密钥{" "}
              <span style={{
                fontSize: 10,
                fontWeight: 400,
                padding: "1px 6px",
                borderRadius: 8,
                color: wsPaired ? tokens.success : "#B26B00",
                background: wsPaired ? tokens.successSoft : tokens.warningSoft,
              }}>
                {wsPaired === null ? "检测中…" : wsPaired ? "已配对" : "未配对"}
              </span>
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ ...styles.input, flex: 1 }}
                type="password"
                value={wsSecretInput}
                onChange={e => setWsSecretInput(e.target.value)}
                placeholder="粘贴 cmspark-agent settings --ws-secret 输出的密钥"
                autoComplete="off"
                spellCheck={false}
              />
              <button style={styles.toggleBtn} onClick={handleWsPair}>配对</button>
            </div>
            <div style={styles.helpText}>
              首次启动 Companion 会在终端打印一段配对密钥。把它粘贴到上方并点「配对」即可建立加密握手——之后所有通信都需要该密钥鉴权，本机其他进程无法再伪造来源驱动 Agent。重新查看密钥：<code>cmspark-agent settings --ws-secret</code>。
            </div>
            {wsPairingMsg && (
              <div style={{ ...styles.helpText, color: wsPairingMsg.ok ? tokens.success : tokens.danger, marginTop: 4 }}>
                {wsPairingMsg.text}
              </div>
            )}
          </div>

          
            </SettingsSection>
          </div>

          <div style={{ order: 2 }}>
            <SettingsSection
              title="模型与推理"
              open={isSectionOpen("model")}
              onToggle={() => handleToggleSection("model")}
            >
          {/* --- LLM Settings --- */}
          <div style={styles.sectionTitle}>LLM 配置</div>

          <div style={styles.field}>
            <label style={styles.label}>API 协议</label>
            <select
              style={styles.input}
              value={config.protocol === "anthropic" ? "anthropic" : "openai"}
              onChange={e => {
                const protocol = e.target.value === "anthropic" ? "anthropic" as const : "openai" as const
                dispatch({
                  type: "SET_CONFIG",
                  config: {
                    protocol,
                    // Leaving anthropic clears compat profile (only valid under anthropic)
                    ...(protocol === "openai" ? { client_header_profile: "none" as const } : {}),
                  },
                })
              }}
            >
              <option value="openai">OpenAI-compatible（默认）</option>
              <option value="anthropic">Anthropic Messages</option>
            </select>
            <div style={styles.helpText}>
              {config.protocol === "anthropic"
                ? "Anthropic 协议走 /messages（x-api-key）。内部工具循环不变。"
                : "默认 OpenAI Chat Completions（DeepSeek / 多数中继）。"}
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Base URL</label>
            <input
              style={styles.input}
              type="text"
              value={config.base_url}
              onChange={e => dispatch({ type: "SET_CONFIG", config: { base_url: e.target.value } })}
              placeholder={
                config.protocol === "anthropic"
                  ? "https://api.anthropic.com 或中继 https://host/v1"
                  : "https://api.deepseek.com/v1"
              }
            />
            {config.protocol === "anthropic" && (
              <div style={styles.helpText}>
                将拼到 /messages；勿混用 /chat/completions。官方 Anthropic 主机不要开下方兼容头。
              </div>
            )}
          </div>

          <div style={styles.field}>
            <label style={styles.label}>
              API Key{" "}
              {!config.api_key && state.companionConfig?.api_key_set && (
                <span style={{
                  fontSize: 10, fontWeight: 500, marginLeft: 6,
                  padding: "1px 6px", borderRadius: 8,
                  color: tokens.success, background: tokens.successSoft,
                }}>
                  ✓ 已配置
                </span>
              )}
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ ...styles.input, flex: 1 }}
                type={showKey ? "text" : "password"}
                value={config.api_key}
                onChange={e => dispatch({ type: "SET_CONFIG", config: { api_key: e.target.value } })}
                placeholder={state.companionConfig?.api_key_set ? "（已配置，留空保持不变；输入新值覆盖）" : "sk-..."}
              />
              <button style={styles.toggleBtn} onClick={() => setShowKey(!showKey)}>
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>
            {!config.api_key && state.companionConfig?.api_key_set && (
              <div style={{ fontSize: 11, color: tokens.success, marginTop: 4 }}>
                ✓ Companion 已保存 API Key 并正常工作。如需更换，请在上方输入新值；留空保存将沿用现有密钥。
              </div>
            )}
          </div>

          {config.protocol === "anthropic" && (
            <div style={styles.field}>
              <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={config.client_header_profile === "claude_code_compat"}
                  onChange={e =>
                    dispatch({
                      type: "SET_CONFIG",
                      config: {
                        client_header_profile: e.target.checked ? "claude_code_compat" : "none",
                      },
                    })
                  }
                />
                Coding Plan 网关兼容头
              </label>
              <div style={styles.helpText}>
                部分第三方「Coding Plan」中继只接受类似 Claude Code 的 User-Agent / 应用头。
                开启后，CMspark 会在 Anthropic 协议请求上附加这些兼容头。
                <strong>不会</strong>登录或盗用 Anthropic 官方订阅；请只用于你有权使用的 API / 中继。
                若使用官方 Anthropic 或无需门控的端点，请保持关闭。
              </div>
            </div>
          )}

          <div style={styles.field}>
            <label style={styles.label}>快速配置</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button
                type="button"
                style={styles.toggleBtn}
                onClick={() =>
                  dispatch({
                    type: "SET_CONFIG",
                    config: {
                      protocol: "openai",
                      client_header_profile: "none",
                      base_url: "https://api.deepseek.com/v1",
                    },
                  })
                }
              >
                OpenAI 兼容
              </button>
              <button
                type="button"
                style={styles.toggleBtn}
                onClick={() =>
                  dispatch({
                    type: "SET_CONFIG",
                    config: {
                      protocol: "anthropic",
                      client_header_profile: "none",
                      base_url: "https://api.anthropic.com",
                    },
                  })
                }
              >
                Anthropic Messages
              </button>
              <button
                type="button"
                style={styles.toggleBtn}
                onClick={() =>
                  dispatch({
                    type: "SET_CONFIG",
                    config: {
                      protocol: "anthropic",
                      client_header_profile: "claude_code_compat",
                      base_url: "",
                    },
                  })
                }
              >
                Coding Plan 中继
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
            <label style={styles.label}>语音输入</label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={state.voiceInputEnabled !== false}
                onChange={(e) =>
                  dispatch({ type: "SET_VOICE_INPUT_ENABLED", enabled: e.target.checked })
                }
              />
              在输入框显示麦克风（听写进草稿，不自动发送）
            </label>
            <p style={{ fontSize: 11, color: "#888", margin: "6px 0 0", lineHeight: 1.45 }}>
              可选麦克风：浏览器将语音转成文字后填入输入框，默认不自动发送。转写可能使用 Chrome
              语音服务（音频可能经网络发送至浏览器厂商），不经过 CMspark Companion。发送后的文字与键入相同，仍受现有确认与信任设置约束。
              若当前浏览器不支持网页语音识别，请使用系统听写。
            </p>
            {state.voicePrivacyAckV1 && (
              <button
                type="button"
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  border: "none",
                  background: "transparent",
                  color: "#888",
                  cursor: "pointer",
                  padding: 0,
                  textDecoration: "underline",
                }}
                onClick={() => dispatch({ type: "SET_VOICE_PRIVACY_ACK_V1", ack: false })}
              >
                重置隐私确认（下次听写将再次提示）
              </button>
            )}
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
            <div style={styles.helpText}>
              {config.context_window >= 200000
                ? `当前 ${config.context_window} 偏大，自动压缩较难触发。推荐 128000（或按模型真实上限 64k–128k）。`
                : "推荐默认 128000。请按所用模型真实上下文上限填写。"}
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>长对话上下文预算</label>
            <select
              style={styles.select || styles.input}
              value={config.context_compaction ?? "auto"}
              onChange={e => {
                const v = e.target.value
                if (v !== "auto" && v !== "prompt" && v !== "off") return
                if (v === "auto") {
                  const ok = window.confirm(
                    "自动压缩会让模型看不到较早轮次，即使聊天区仍显示全文。确定启用？",
                  )
                  if (!ok) return
                }
                dispatch({ type: "SET_CONFIG", config: { context_compaction: v } })
              }}
            >
              <option value="auto">自动压缩（超预算时）</option>
              <option value="prompt">仅提示（不压缩）</option>
              <option value="off">关闭</option>
            </select>
            <div style={styles.helpText}>
              仅影响发给模型的请求；磁盘与界面消息仍完整。仅提示 = 超预算时警告，需改回「自动」才压缩。
            </div>
          </div>

          {(config.context_compaction ?? "auto") === "auto" && (
            <div style={styles.field}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={config.context_compaction_m2 !== false}
                  onChange={e =>
                    dispatch({
                      type: "SET_CONFIG",
                      config: { context_compaction_m2: e.target.checked },
                    })
                  }
                />
                结构化工作记忆（H1）/ 滚动摘要
              </label>
              <div style={styles.helpText}>
                默认开启：丢弃轮次较多时，优先生成脱敏的结构化工作记忆（目标/决策/约束/待办/产物），
                失败则退回散文摘要；可在聊天顶栏「查看摘要」。仅在本轮开始时跑（tool 中途只做截断占位）。
              </div>
            </div>
          )}

          <div style={styles.field}>
            <label style={styles.label}>思考过程展示</label>
            <select
              style={styles.input}
              value={state.showReasoningMode || "auto_live"}
              onChange={(e) => {
                const v = e.target.value
                if (v === "always_collapsed" || v === "auto_live" || v === "always_open") {
                  dispatch({ type: "SET_SHOW_REASONING_MODE", mode: v })
                }
              }}
            >
              <option value="auto_live">仅推理时展开（默认）</option>
              <option value="always_collapsed">默认折叠</option>
              <option value="always_open">始终展开</option>
            </select>
            <div style={styles.helpText}>
              仅影响 Side Panel 显示。历史消息不会把思考回灌给模型（省 token / 兼容 Anthropic）。
            </div>
          </div>

          <div style={styles.field}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={state.exportIncludeReasoning === true}
                onChange={(e) =>
                  dispatch({ type: "SET_EXPORT_INCLUDE_REASONING", enabled: e.target.checked })
                }
              />
              导出到 Obsidian 时包含思考过程
            </label>
            <div style={styles.helpText}>
              默认关闭。开启后以折叠块写入笔记；请注意思考可能含中间假设，勿默认分享。
            </div>
          </div>

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
                <label style={styles.label}>
                  API Key{" "}
                  {!config.vision_api_key && state.companionConfig?.vision_api_key_set && (
                    <span style={{
                      fontSize: 10, fontWeight: 500, marginLeft: 6,
                      padding: "1px 6px", borderRadius: 8,
                      color: tokens.success, background: tokens.successSoft,
                    }}>
                      ✓ 已配置
                    </span>
                  )}
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    style={{ ...styles.input, flex: 1 }}
                    type={showKey ? "text" : "password"}
                    value={config.vision_api_key || ""}
                    onChange={e => dispatch({ type: "SET_CONFIG", config: { vision_api_key: e.target.value } })}
                    placeholder={
                      state.companionConfig?.vision_api_key_set
                        ? "（已配置，留空保持不变；输入新值覆盖）"
                        : "留空则使用 Ollama（无需 API Key）"
                    }
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

              <div style={styles.field}>
                <div style={styles.helpText}>
                  上下文窗口过大时，长对话压缩几乎不会触发（默认 1e6 ≈ 关闭自动压缩）。建议按模型真实上限设置。
                </div>
              </div>
            </SettingsSection>
          </div>

          <div style={{ order: 3 }}>
            <SettingsSection
              title="密钥与环境"
              open={isSectionOpen("secrets")}
              onToggle={() => handleToggleSection("secrets")}
            >
          {/* --- User env / Secrets (ADR-019) — independent of bottom config Save --- */}
          <UserEnvSection />

          
            </SettingsSection>
          </div>

          <div style={{ order: 4 }}>
            <SettingsSection
              title="安全与信任"
              open={isSectionOpen("security")}
              onToggle={() => handleToggleSection("security")}
              badge={elevatedTrust ? (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: 8,
                  color: tokens.danger,
                  background: tokens.dangerSoft || "#fde8e8",
                }}>有开关已开</span>
              ) : null}
            >
          {/* --- 运行自主度 (Trust packaging / Autopilot + ADR-021 unattended) --- */}
          {(() => {
            const armFlags = {
              auto_approve_dangerous: config.auto_approve_dangerous === true,
              auto_approve_enterprise_tools: config.auto_approve_enterprise_tools === true,
              allow_all_schemes: config.allow_all_schemes === true,
            }
            const unattendedArmed = state.unattended?.armed === true
            const tier = deriveDisplayTier(armFlags, unattendedArmed)
            const chip = trustStatusChip(armFlags, unattendedArmed)
            const anyArmed = tier !== "off" || unattendedArmed
            return (
              <>
                <div style={styles.sectionTitle}>
                  运行自主度
                  {chip && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        marginLeft: 8,
                        padding: "1px 6px",
                        borderRadius: 8,
                        color: "#fff",
                        background: "#C62828",
                      }}
                    >
                      {chip}
                    </span>
                  )}
                </div>
                <div style={styles.field}>
                  <div style={styles.helpText}>
                    长程无人值守的<strong>主入口</strong>。默认关闭。急停与硬性拒绝仍然有效。
                    选「无人值守」后，已白名单坐标 App 的桌面操控可免初始确认（进程会话 8h/重启失效）；同时会写入长期配置开启网页/企业巡航，解除武装时关闭。
                  </div>
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {(
                      [
                        { id: "browser" as const, label: "网页巡航", hint: "跳过网页类 L2（evaluate / 导航）" },
                        {
                          id: "full" as const,
                          label: "全自动巡航",
                          hint: "网页 L2 + 企业 shell/netsec（须 enterprise 模块与范围）",
                        },
                        {
                          id: "full_protocol" as const,
                          label: "全自动巡航（含协议解锁）",
                          hint: "上者 + 非 http(s)；仍不含桌面",
                        },
                        {
                          id: "unattended" as const,
                          label: "无人值守",
                          hint: "本会话：全自动 + 白名单 App 桌面免初始确认（含微信键入）",
                        },
                      ] as const
                    ).map((opt) => (
                      <label
                        key={opt.id}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                          cursor: autopilotBusy ? "not-allowed" : "pointer",
                          fontSize: 13,
                          padding: "6px 8px",
                          borderRadius: 6,
                          border:
                            autopilotTierPick === opt.id
                              ? "1px solid #E0A0A0"
                              : "1px solid transparent",
                          background: autopilotTierPick === opt.id ? "#FFF8F8" : "transparent",
                        }}
                      >
                        <input
                          type="radio"
                          name="autopilot-tier"
                          checked={autopilotTierPick === opt.id}
                          disabled={autopilotBusy}
                          onChange={() => setAutopilotTierPick(opt.id)}
                          style={{ marginTop: 3 }}
                        />
                        <div>
                          <div style={{ fontWeight: 500, color: opt.id === "unattended" ? tokens.danger : undefined }}>
                            {opt.label}
                          </div>
                          <div style={{ fontSize: 11, color: tokens.textSecondary }}>{opt.hint}</div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div style={{ marginTop: 10, overflowX: "auto" }}>
                    <div style={{ ...styles.helpText, fontWeight: 600, marginBottom: 4 }}>
                      武装后仍会 / 不会跳过（后果矩阵）
                    </div>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 10,
                        color: "#444",
                      }}
                    >
                      <thead>
                        <tr style={{ background: "#f5f5f5" }}>
                          <th style={{ textAlign: "left", padding: "4px 6px", border: "1px solid #e0e0e0" }}>
                            工具族
                          </th>
                          <th style={{ textAlign: "left", padding: "4px 6px", border: "1px solid #e0e0e0" }}>
                            网页
                          </th>
                          <th style={{ textAlign: "left", padding: "4px 6px", border: "1px solid #e0e0e0" }}>
                            全自动
                          </th>
                          <th style={{ textAlign: "left", padding: "4px 6px", border: "1px solid #e0e0e0" }}>
                            +协议
                          </th>
                          <th style={{ textAlign: "left", padding: "4px 6px", border: "1px solid #e0e0e0" }}>
                            值守
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {AUTOPILOT_CONSEQUENCE_ROWS.map((row) => (
                          <tr key={row.family}>
                            <td style={{ padding: "4px 6px", border: "1px solid #e0e0e0" }}>{row.family}</td>
                            <td style={{ padding: "4px 6px", border: "1px solid #e0e0e0" }}>{row.browser}</td>
                            <td style={{ padding: "4px 6px", border: "1px solid #e0e0e0" }}>{row.full}</td>
                            <td style={{ padding: "4px 6px", border: "1px solid #e0e0e0" }}>{row.protocol}</td>
                            <td style={{ padding: "4px 6px", border: "1px solid #e0e0e0" }}>{row.unattended}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ ...styles.helpText, marginTop: 4 }}>
                      {UNATTENDED_MATRIX_FOOTNOTES}
                      <br />
                      当前档位：<strong>{tierShortLabel(tier)}</strong>
                      {tier === "custom" ? "（高级闸门与预设不一致）" : ""}
                      {unattendedArmed && state.unattended?.expiresAt
                        ? ` · 值守至 ${new Date(state.unattended.expiresAt).toLocaleString()}`
                        : ""}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={{
                        ...styles.toggleBtn,
                        color: "#fff",
                        background: "#C62828",
                        borderColor: "#C62828",
                        opacity: autopilotBusy ? 0.6 : 1,
                      }}
                      disabled={autopilotBusy}
                      onClick={() => {
                        setAutopilotConfirm(true)
                        setAutopilotPhrase("")
                        setAutopilotMsg(null)
                      }}
                    >
                      {anyArmed ? "重新武装…" : "武装…"}
                    </button>
                    {anyArmed && (
                      <button
                        type="button"
                        style={styles.toggleBtn}
                        disabled={autopilotBusy}
                        onClick={handleAutopilotDisarm}
                        title="解除桌面值守 + 关闭网页/企业/协议三类自动批准"
                      >
                        解除武装
                      </button>
                    )}
                  </div>

                  {autopilotConfirm && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: 8,
                        background: "#fff",
                        borderRadius: 6,
                        border: "1px solid #E0B4B4",
                      }}
                    >
                      {autopilotTierPick === "unattended" && (
                        <div style={{ marginBottom: 10, fontSize: 12, color: tokens.danger, lineHeight: 1.5 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>
                            键入内容将在执行前<strong>不再</strong>逐字预览。仅已白名单且开坐标的 App。
                          </div>
                          <label style={{ display: "flex", gap: 6, marginBottom: 4, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={unattendedAckDesktop}
                              onChange={(e) => setUnattendedAckDesktop(e.target.checked)}
                            />
                            允许已白名单且已开坐标的 App 在本会话免初始确认
                          </label>
                          <label style={{ display: "flex", gap: 6, marginBottom: 4, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={unattendedAckSession}
                              onChange={(e) => setUnattendedAckSession(e.target.checked)}
                            />
                            确认：桌面值守为进程会话（重启 Companion 后失效）；同时会<strong>写入长期配置</strong>开启网页/企业自动批准（解除武装时一并关闭）
                          </label>
                          <label style={{ display: "flex", gap: 6, cursor: "pointer", color: "#8a5a00" }}>
                            <input
                              type="checkbox"
                              checked={unattendedIncludeProtocol}
                              onChange={(e) => setUnattendedIncludeProtocol(e.target.checked)}
                            />
                            同时协议解锁（非 http(s)，更高风险，默认关）
                          </label>
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: tokens.danger, fontWeight: 500, marginBottom: 6 }}>
                        确认武装「{tierShortLabel(autopilotTierPick as AutopilotTier)}」— 请输入「
                        <b>{SECURITY_ARM_PHRASE}</b>」：
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          style={{ ...styles.input, flex: 1 }}
                          type="text"
                          value={autopilotPhrase}
                          onChange={(e) => {
                            setAutopilotPhrase(e.target.value)
                            setAutopilotMsg(null)
                          }}
                          placeholder={SECURITY_ARM_PHRASE}
                          autoComplete="off"
                          spellCheck={false}
                          autoFocus
                          disabled={autopilotBusy}
                        />
                        <button
                          type="button"
                          style={{
                            ...styles.toggleBtn,
                            color: "#fff",
                            background: "#C62828",
                            borderColor: "#C62828",
                          }}
                          disabled={autopilotBusy}
                          onClick={handleAutopilotArmConfirm}
                        >
                          确认武装
                        </button>
                        <button
                          type="button"
                          style={styles.toggleBtn}
                          disabled={autopilotBusy}
                          onClick={() => {
                            setAutopilotConfirm(false)
                            setAutopilotPhrase("")
                            setAutopilotMsg(null)
                          }}
                        >
                          取消
                        </button>
                      </div>
                      {autopilotMsg && (
                        <div style={{ fontSize: 11, color: "#C62828", marginTop: 4 }}>{autopilotMsg}</div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )
          })()}

                    {/* --- Security Settings --- */}
          <div style={styles.sectionTitle}>安全设置</div>

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
                  <br />
                  <b>与「全自动巡航」无关：</b>巡航只少弹确认；读写 Cookie（登录态）必须把目标站写在这里。
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
                  当前已配置 {(config.trusted_domains || []).length} 个信任域。
                  渗透/需登录态时请把目标站加到此处；全自动巡航不会自动放行 Cookie。
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

          {/* 高级 · 独立闸门 — default collapsed; auto-hint when any flag on */}
          <div style={styles.field}>
            <button
              type="button"
              style={{
                ...styles.secondaryBtn,
                width: "100%",
                textAlign: "left",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
              onClick={() => setAdvancedGatesOpen((o) => !o)}
            >
              <span>
                高级 · 独立闸门
                {(config.auto_approve_dangerous ||
                  config.auto_approve_enterprise_tools ||
                  config.allow_all_schemes) && (
                  <span style={{ fontSize: 10, color: "#C62828", marginLeft: 6 }}>有开关已开</span>
                )}
              </span>
              <span style={{ fontSize: 11, color: "#888" }}>{advancedGatesOpen ? "收起 ▲" : "展开 ▼"}</span>
            </button>
            <div style={{ ...styles.helpText, marginTop: 6 }}>
              细粒度手动开关；长程请优先用上方「运行自主度」。下列开关与预设不一致时档位显示「自定义」。
            </div>
          </div>

          {advancedGatesOpen && (
            <>
          <div style={styles.field}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={config.auto_approve_dangerous === true}
                onChange={e => handleAutoApproveDangerousChange(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 500 }}>自动批准所有危险操作（网页 L2）</div>
                <div style={{ fontSize: 11, color: "#B26B00", marginTop: 2 }}>
                  ⚠ 跳过 evaluate / navigate 等网页类 L2。<b>不含</b> shell / netsec（请用企业开关或全自动巡航）。
                </div>
              </div>
            </label>
            {autoDangerConfirm && (
              <div style={{ marginTop: 10, padding: 8, background: "#fff", borderRadius: 6, border: "1px solid #E0C090" }}>
                <div style={{ fontSize: 12, color: "#B26B00", fontWeight: 500, marginBottom: 6 }}>
                  请输入「<b>{SECURITY_ARM_PHRASE}</b>」以确认开启：
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    style={{ ...styles.input, flex: 1 }}
                    type="text"
                    value={autoDangerPhrase}
                    onChange={(e) => { setAutoDangerPhrase(e.target.value); setAutoDangerMsg(null) }}
                    placeholder={SECURITY_ARM_PHRASE}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                  />
                  <button
                    style={{ ...styles.toggleBtn, color: "#fff", background: "#C62828", borderColor: "#C62828" }}
                    onClick={handleAutoApproveDangerousConfirm}
                  >确认开启</button>
                  <button
                    style={styles.toggleBtn}
                    onClick={() => { setAutoDangerConfirm(false); setAutoDangerPhrase(""); setAutoDangerMsg(null) }}
                  >取消</button>
                </div>
                {autoDangerMsg && (
                  <div style={{ fontSize: 11, color: "#C62828", marginTop: 4 }}>{autoDangerMsg}</div>
                )}
              </div>
            )}
          </div>

          {/* Plan B: enterprise shell/netsec L2 skip under scope */}
          <div style={{ ...styles.field, padding: 10, borderRadius: 8, background: "#FFF8F0", border: "1px solid #F0D0A0" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={config.auto_approve_enterprise_tools === true}
                onChange={(e) => handleEnterpriseAutoApproveToggle(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 500, color: "#B26B00" }}>
                  全局自动批准企业高危工具（shell / netsec）
                  {config.auto_approve_enterprise_tools === true && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, marginLeft: 6, padding: "1px 6px",
                      borderRadius: 8, color: "#fff", background: "#C62828",
                    }}>已启用</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#8a5a00", marginTop: 4, lineHeight: 1.5 }}>
                  仍受模块启用、目标白名单、任务授权（netsec）/ shell 策略约束。
                  <b>不跳过</b> spawn_worker、桌面操控、MCP 关键能力。
                </div>
                <table
                  style={{
                    width: "100%",
                    marginTop: 8,
                    borderCollapse: "collapse",
                    fontSize: 10,
                    color: "#555",
                  }}
                >
                  <thead>
                    <tr style={{ background: "#fff8f0" }}>
                      <th style={{ textAlign: "left", padding: "3px 5px", border: "1px solid #f0d0a0" }}>开关</th>
                      <th style={{ textAlign: "left", padding: "3px 5px", border: "1px solid #f0d0a0" }}>网页 L2</th>
                      <th style={{ textAlign: "left", padding: "3px 5px", border: "1px solid #f0d0a0" }}>shell/netsec</th>
                      <th style={{ textAlign: "left", padding: "3px 5px", border: "1px solid #f0d0a0" }}>协议 L1</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: "3px 5px", border: "1px solid #f0d0a0" }}>自动批准危险</td>
                      <td style={{ padding: "3px 5px", border: "1px solid #f0d0a0" }}>可跳过</td>
                      <td style={{ padding: "3px 5px", border: "1px solid #f0d0a0" }}>仍确认</td>
                      <td style={{ padding: "3px 5px", border: "1px solid #f0d0a0" }}>仍阻断</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "3px 5px", border: "1px solid #f0d0a0" }}>协议解锁</td>
                      <td style={{ padding: "3px 5px", border: "1px solid #f0d0a0" }}>可跳过</td>
                      <td style={{ padding: "3px 5px", border: "1px solid #f0d0a0" }}>仍确认</td>
                      <td style={{ padding: "3px 5px", border: "1px solid #f0d0a0" }}>可跳过</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "3px 5px", border: "1px solid #f0d0a0" }}>本开关(企业)</td>
                      <td style={{ padding: "3px 5px", border: "1px solid #f0d0a0" }}>不变</td>
                      <td style={{ padding: "3px 5px", border: "1px solid #f0d0a0" }}>可跳过(有范围)</td>
                      <td style={{ padding: "3px 5px", border: "1px solid #f0d0a0" }}>不变</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </label>
            {entBConfirm && (
              <div style={{ marginTop: 10, padding: 8, background: "#fff", borderRadius: 6, border: "1px solid #E0C090" }}>
                <div style={{ fontSize: 12, color: "#B26B00", fontWeight: 500, marginBottom: 6 }}>
                  请输入「<b>{ENT_B_PHRASE}</b>」以确认开启：
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    style={{ ...styles.input, flex: 1 }}
                    type="text"
                    value={entBPhrase}
                    onChange={(e) => { setEntBPhrase(e.target.value); setEntBMsg(null) }}
                    placeholder={ENT_B_PHRASE}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                  />
                  <button
                    style={{ ...styles.toggleBtn, color: "#fff", background: "#C62828", borderColor: "#C62828" }}
                    onClick={handleEnterpriseAutoApproveConfirm}
                  >确认开启</button>
                  <button
                    style={styles.toggleBtn}
                    onClick={() => { setEntBConfirm(false); setEntBPhrase(""); setEntBMsg(null) }}
                  >取消</button>
                </div>
                {entBMsg && (
                  <div style={{ fontSize: 11, color: "#C62828", marginTop: 4 }}>{entBMsg}</div>
                )}
              </div>
            )}
          </div>

          {/* Protocol unlock (security.allow_all_schemes) — former UI name God-mode */}
          <div style={{ ...styles.field, padding: 10, borderRadius: 8, background: "#FFF8F8", border: "1px solid #F0C0C0" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={config.allow_all_schemes === true}
                onChange={e => handleGodModeToggle(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 500, color: tokens.danger }}>
                  协议解锁（允许非 http(s) 协议）
                  {config.allow_all_schemes === true && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, marginLeft: 6, padding: "1px 6px",
                      borderRadius: 8, color: "#fff", background: "#C62828",
                    }}>已启用</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#C62828", marginTop: 4, lineHeight: 1.5 }}>
                  ☠ 绕过协议硬阻断（L1）与部分网页 L2——<b>不等于</b>无人值守全开。
                  <b>不含</b> shell_exec / netsec / host_computer / spawn 的 forceConfirm。
                  曾用名 God-mode。关闭后 prompt 注入仍可能驱动 <code>data:</code> / <code>chrome://</code>。
                </div>
              </div>
            </label>

            {godmodeConfirm && (
              <div style={{ marginTop: 10, padding: 8, background: "#fff", borderRadius: 6, border: "1px solid #E0B4B4" }}>
                <div style={{ fontSize: 12, color: tokens.danger, fontWeight: 500, marginBottom: 6 }}>
                  请输入「<b>{SECURITY_ARM_PHRASE}</b>」以确认开启协议解锁：
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    style={{ ...styles.input, flex: 1 }}
                    type="text"
                    value={godmodePhrase}
                    onChange={e => { setGodmodePhrase(e.target.value); setGodmodeMsg(null) }}
                    placeholder={SECURITY_ARM_PHRASE}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                  />
                  <button
                    style={{ ...styles.toggleBtn, color: "#fff", background: "#C62828", borderColor: "#C62828" }}
                    onClick={handleGodModeConfirm}
                  >确认开启</button>
                  <button
                    style={styles.toggleBtn}
                    onClick={() => { setGodmodeConfirm(false); setGodmodePhrase(""); setGodmodeMsg(null) }}
                  >取消</button>
                </div>
                {godmodeMsg && (
                  <div style={{ fontSize: 11, color: "#C62828", marginTop: 4 }}>{godmodeMsg}</div>
                )}
              </div>
            )}
          </div>
            </>
          )}

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
                          color: entry.action === "allowed" ? tokens.success
                            : entry.action === "denied" ? tokens.warning
                            // "changed" risk is level-driven: arming (error) = dark red,
                            // disarming (info) = green (restoring safety).
                            : entry.action === "changed" ? (entry.level === "error" ? tokens.danger : tokens.success)
                            : tokens.danger,
                          fontWeight: 600,
                        }}>
                          {entry.action === "allowed" ? "允许"
                            : entry.action === "denied" ? "拒绝"
                            : entry.action === "changed" ? "变更"
                            : "阻断"}
                        </span>
                        <span style={{ color: "#666" }}>{entry.tool_name}</span>
                        <span style={{ color: "#999", marginLeft: "auto" }}>{entry.ts.slice(11, 19)}</span>
                      </div>
                      <div style={{
                        color: entry.action === "changed"
                          ? (entry.level === "error" ? tokens.danger : tokens.success)
                          : "#888",
                        marginTop: 2,
                        fontWeight: entry.action === "changed" ? 500 : 400,
                      }}>{entry.message}</div>
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

          
            </SettingsSection>
          </div>

          <div style={{ order: 5 }}>
            <SettingsSection
              title="本机与集成"
              open={isSectionOpen("integrations")}
              onToggle={() => handleToggleSection("integrations")}
            >
          {/* --- How permissions work --- */}
          <div style={styles.field}>
            <div style={styles.helpText}>三道门互不替代，请勿混淆：</div>
            <ul
              style={{
                margin: "6px 0 0",
                paddingLeft: 18,
                fontSize: 12,
                color: tokens.textSecondary,
                lineHeight: 1.5,
              }}
            >
              <li>
                <strong>场景</strong>（侧栏「场景」）：本对话模板；可能<em>限制</em>可用工具。
              </li>
              <li>
                <strong>本机能力</strong>（场景页）：工作区 / 扫描 / 命令等电源是否启用。
              </li>
              <li>
                <strong>运行自主度</strong>（下方）：危险操作要不要每次确认；
                <em>不会</em>放开场景已关掉的工具，也<strong>不能</strong>代替选工作区。
              </li>
            </ul>
            <div style={{ ...styles.helpText, marginTop: 8 }}>
              若工具提示「需要先绑定工作区」，请去场景页选文件夹，而不是开协议解锁或巡航。
            </div>
          </div>

          <div style={styles.divider} />

          <NetSecSettingsSection />

                    {/* --- Outbound MCP L4+ grants --- */}
          <OutboundMcpSettingsSection />

          
            </SettingsSection>
          </div>

          <div style={{ order: 6 }}>
            <SettingsSection
              title="导出与集成"
              open={isSectionOpen("export")}
              onToggle={() => handleToggleSection("export")}
            >
          {/* --- Obsidian Export --- */}
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
              <div style={{ ...styles.helpText, color: tokens.danger, marginTop: 4 }}>
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
              <div style={{ ...styles.helpText, color: state.obsidianProfileStatus.ok ? tokens.success : tokens.danger, marginTop: 6 }}>
                {state.obsidianProfileStatus.message}
              </div>
            )}
          </div>

            </SettingsSection>
          </div>

          <div style={{ order: 7 }}>
            <SettingsSection
              title="实验功能"
              open={isSectionOpen("experimental")}
              onToggle={() => handleToggleSection("experimental")}
            >
          {/* --- WP5-I4 实验功能(Qwen3-VL 本地模型定位层) --- */}
          <div style={styles.sectionTitle}>实验功能</div>
          {(() => {
            // 纯渲染:一切文案/判定来自 logic 纯函数;发送固定 source:"settings";
            // 无乐观更新——UI 态由 companion state 广播/应答驱动。
            const model = state.computerModel
            const statusLine = modelStatusLine(model, state.computerModelProgress)
            const disabledReason = modelSwitchDisabledReason(model)
            const depHint = modelSwitchHint({
              masterEnabled: state.computerCoordinateEnabled,
              appCoordinateAllowed: null, // 全局设置页无单应用上下文(每层提示在 AppsPanel)
            })
            const runningNote = modelSwitchRunningNote(state.computerTask)
            const modelEnabled = model?.modelEnabled === true
            const send = (msg: object) => chrome.runtime.sendMessage(msg)
            const toggle = () => {
              dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
              send({ type: "computer.model.set_enabled", enabled: !modelEnabled, source: "settings" })
            }
            // 词表动作 → 发送映射(组件不组文案,只做按钮接线)
            const runAction = (action: string) => {
              if (action === "重置熔断") send({ type: "computer.model.reset_circuit_breaker", source: "settings" })
              else if (action === "删除并重新下载") setModelDeleteArmed(true)
              else {
                dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
                send({ type: "computer.model.download", source: "settings" })
              }
            }
            return (
              <div style={styles.field}>
                <label style={styles.label}>{MODEL_SWITCH_COPY.switchLabel}</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    style={{
                      ...styles.toggleBtn,
                      ...(modelEnabled ? { background: tokens.accent, color: "#fff", borderColor: tokens.accent } : {}),
                    }}
                    disabled={disabledReason !== null}
                    onClick={toggle}
                  >
                    {modelEnabled ? "已开启" : "已关闭"}
                  </button>
                  <span style={styles.helpText}>{MODEL_SWITCH_COPY.switchHint}</span>
                </div>
                {/* P2:任务运行中旁注(per-task 生效 + estop 引导) */}
                {runningNote && (
                  <div style={{ ...styles.helpText, color: "#B26B00" }}>{runningNote}</div>
                )}
                {/* 三层依赖提示(主开关关)优先;否则本体语义 */}
                <div style={styles.helpText}>{depHint ?? MODEL_SWITCH_COPY.layerSemantics}</div>
                {disabledReason && (
                  <div style={{ ...styles.helpText, color: "#B26B00" }}>{disabledReason}</div>
                )}
                {model?.modelLicenseDeclined === true && (
                  <div style={{ marginTop: 6 }}>
                    <button
                      style={styles.secondaryBtn}
                      type="button"
                      onClick={() => {
                        dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
                        send({
                          type: "computer.model.license_response",
                          reset_decline: true,
                          source: "settings",
                        })
                      }}
                    >
                      复位许可拒绝
                    </button>
                  </div>
                )}
                {/* 用户旅程：检测 → 选源 → 选规模 → 下载 → 启用（全部经 Companion） */}
                <div style={{ ...styles.helpText, marginTop: 8, fontWeight: 600 }}>使用步骤（经本机 Companion）</div>
                <div style={{ ...styles.helpText, marginTop: 4, lineHeight: 1.5 }}>
                  ① Companion 检测本机环境与硬件 → ② 选择下载源（大陆推荐自动/魔搭）→
                  ③ 选择模型规模 → ④ 下载权重 → ⑤ 开启实验层。
                  插件本身不跑模型，只通过 Companion 发现/下载/启用。
                </div>
                {/* 环境检查：显著清单（软件 / 硬件 / 模型）——用户无需知道包名 */}
                <div
                  style={{
                    marginTop: 10,
                    padding: "10px 10px 8px",
                    borderRadius: 8,
                    border: `1px solid ${
                      model?.canEnable
                        ? (tokens.success as string) || "#2e7d32"
                        : model?.canDownload === true
                          ? "#f0c14b"
                          : "#e57373"
                    }`,
                    background: model?.canEnable
                      ? tokens.successSoft || "#e8f5e9"
                      : model?.canDownload === true
                        ? "#fff8e1"
                        : "#ffebee",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: "#222" }}>
                    环境检查（下载 / 启用前必看）
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.45, color: "#333", marginBottom: 6 }}>
                    <strong>状态：</strong>
                    {model?.readinessSummary ||
                      model?.preflight?.readinessSummary ||
                      "等待 Companion 回报本机环境…"}
                  </div>
                  {Array.isArray(model?.preflight?.requirements) &&
                  model!.preflight!.requirements!.length > 0 ? (
                    <ul
                      style={{
                        margin: "0 0 6px 0",
                        padding: 0,
                        listStyle: "none",
                        fontSize: 11,
                        lineHeight: 1.5,
                      }}
                    >
                      {model!.preflight!.requirements!.map((r) => (
                        <li
                          key={r.id}
                          style={{
                            display: "flex",
                            gap: 6,
                            marginBottom: 4,
                            alignItems: "flex-start",
                            color: r.ok ? "#2e7d32" : r.blocking ? "#b71c1c" : "#e65100",
                          }}
                        >
                          <span style={{ flexShrink: 0, fontWeight: 700 }}>{r.ok ? "✓" : "✗"}</span>
                          <span>
                            <span style={{ fontWeight: 600 }}>{r.label}</span>
                            {r.detail ? (
                              <span style={{ display: "block", color: "#555", fontWeight: 400 }}>
                                {r.detail}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : model?.preflight?.hardware ? (
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>
                      硬件快照：内存 {model.preflight.hardware.totalRamGb ?? "?"}GB
                      {model.preflight.hardware.vramGb != null
                        ? ` · 显存 ${model.preflight.hardware.vramGb}GB`
                        : ""}
                      {model.preflight.hardware.accelerator
                        ? ` · 加速 ${model.preflight.hardware.accelerator}`
                        : ""}
                      {model.preflight.hardware.freeDiskGb != null
                        ? ` · 可用磁盘 ${model.preflight.hardware.freeDiskGb}GB`
                        : ""}
                      {model.recommendedVariant
                        ? ` · 建议规模 ${String(model.recommendedVariant).toUpperCase()}`
                        : ""}
                    </div>
                  ) : null}
                  {(model?.downloadBlockReason || model?.preflight?.downloadBlockReason) &&
                    model?.canDownload !== true && (
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#b71c1c",
                          marginBottom: 6,
                          lineHeight: 1.4,
                        }}
                      >
                        暂不可下载：
                        {model?.downloadBlockReason || model?.preflight?.downloadBlockReason}
                      </div>
                    )}
                  {(model?.enableBlockReason || model?.preflight?.enableBlockReason) &&
                    model?.canEnable !== true &&
                    model?.modelStatus === "ready" && (
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#e65100",
                          marginBottom: 6,
                          lineHeight: 1.4,
                        }}
                      >
                        暂不可开启：
                        {model?.enableBlockReason || model?.preflight?.enableBlockReason}
                      </div>
                    )}
                  {Array.isArray(model?.nextSteps) && model!.nextSteps!.length > 0 && (
                    <ol style={{ margin: "0 0 6px 0", paddingLeft: 18, fontSize: 11, color: "#333" }}>
                      {model!.nextSteps!.slice(0, 6).map((step, i) => (
                        <li key={i} style={{ marginBottom: 3 }}>
                          {step}
                        </li>
                      ))}
                    </ol>
                  )}
                  {Array.isArray(model?.preflight?.installCommands) &&
                    model!.preflight!.installCommands!.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#333", marginBottom: 4 }}>
                          一键安装命令（复制到「终端」执行）
                        </div>
                        {model!.preflight!.installCommands!.map((c) => (
                          <div
                            key={c}
                            style={{
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontSize: 10,
                              background: "#1e1e1e",
                              color: "#e0e0e0",
                              padding: "8px 8px",
                              borderRadius: 6,
                              marginBottom: 4,
                              wordBreak: "break-all",
                              userSelect: "all",
                            }}
                            title="点击三下可选中全文复制"
                          >
                            {c}
                          </div>
                        ))}
                        <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>
                          完成后回到本页，清单应变为绿色，再点「下载模型」。无需理解软件包名称。
                        </div>
                      </div>
                    )}
                </div>

                {/* 模型保存位置 + Python 环境（用户可控） */}
                <div style={{ ...styles.helpText, marginTop: 12, fontWeight: 700, fontSize: 12 }}>
                  模型保存位置
                </div>
                <div
                  style={{
                    ...styles.helpText,
                    marginTop: 4,
                    fontSize: 11,
                    fontFamily: "ui-monospace, monospace",
                    wordBreak: "break-all",
                    color: "#333",
                  }}
                >
                  {model?.modelRootDir ||
                    model?.preflight?.modelRootDir ||
                    "（Companion 数据目录 / models — 打开设置后由服务端回填绝对路径）"}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    disabled={model === null || model.modelStatus === "downloading"}
                    onClick={() => {
                      dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
                      send({ type: "computer.model.pick_model_root", source: "settings" })
                    }}
                  >
                    选择文件夹…
                  </button>
                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    disabled={model === null || model.modelStatus === "downloading"}
                    onClick={() => {
                      dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
                      send({ type: "computer.model.set_model_root", reset: true, source: "settings" })
                    }}
                  >
                    恢复默认
                  </button>
                </div>
                <div style={{ ...styles.helpText, marginTop: 4, fontSize: 10, color: "#666" }}>
                  权重会下载到该目录下的 qwen3-vl-2b / 4b / 8b 子文件夹。请选择有足够空间的磁盘位置。
                </div>

                <div style={{ ...styles.helpText, marginTop: 12, fontWeight: 700, fontSize: 12 }}>
                  Python 环境
                </div>
                <div style={{ ...styles.helpText, marginTop: 4, fontSize: 11, color: "#555" }}>
                  {(model?.pythonResolution || model?.preflight?.pythonResolution) ??
                    "检测中…"}
                  {(() => {
                    const uvOk = model?.uvAvailable ?? model?.preflight?.uvAvailable
                    const uvPath = model?.uvPath || model?.preflight?.uvPath
                    // Prefer server-driven platform hint (W7/N4); never hardcode brew here
                    const hint =
                      model?.uvInstallHint || model?.preflight?.uvInstallHint || ""
                    if (uvOk) {
                      // Truncate middle for long absolute paths
                      const shown =
                        uvPath && uvPath.length > 48
                          ? `${uvPath.slice(0, 20)}…${uvPath.slice(-24)}`
                          : uvPath
                      return shown
                        ? ` · 已检测到 uv（${shown}）`
                        : " · 已检测到 uv（创建/安装时优先使用）"
                    }
                    return hint
                      ? ` · 未检测到 uv（可选：${hint}）`
                      : " · 未检测到 uv（可选安装以加速）"
                  })()}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                  {(
                    [
                      {
                        id: "isolated" as const,
                        label: "CMspark 独立环境（推荐）",
                        desc: "专用虚拟环境，不污染系统 Python；有 uv 时优先用 uv 创建与装包",
                      },
                      {
                        id: "system" as const,
                        label: "本机全局 Python",
                        desc: "使用 PATH 上的 python / python3（Windows 常见 python.exe / py）；安装依赖需你在终端手动执行（避免静默改系统环境）",
                      },
                    ] as const
                  ).map((opt) => {
                    const active =
                      (model?.pythonMode || model?.preflight?.pythonMode || "isolated") === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        style={{
                          ...styles.secondaryBtn,
                          textAlign: "left",
                          ...(active
                            ? { borderColor: tokens.accent, background: tokens.accentSoft || "#eef3ff" }
                            : {}),
                        }}
                        disabled={model === null || model.modelStatus === "downloading"}
                        onClick={() => {
                          dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
                          send({
                            type: "computer.model.set_python_mode",
                            mode: opt.id,
                            source: "settings",
                          })
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 11 }}>
                          {active ? "● " : "○ "}
                          {opt.label}
                        </div>
                        <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{opt.desc}</div>
                      </button>
                    )
                  })}
                </div>
                {(model?.pythonMode || model?.preflight?.pythonMode) === "system" && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ ...styles.helpText, fontSize: 10, color: "#666", marginBottom: 4 }}>
                      当前全局解释器：
                      <span style={{ fontFamily: "ui-monospace, monospace", color: "#333" }}>
                        {model?.pythonPath ||
                          (typeof model?.preflight?.deps?.pythonPath === "string"
                            ? model.preflight.deps.pythonPath
                            : null) ||
                          "（PATH 自动探测）"}
                      </span>
                    </div>
                    <button
                      type="button"
                      style={styles.secondaryBtn}
                      disabled={model === null || model.modelStatus === "downloading"}
                      title="用系统对话框选择 python / python3 可执行文件"
                      onClick={() => {
                        dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
                        send({ type: "computer.model.pick_python_path", source: "settings" })
                      }}
                    >
                      选择 Python 可执行文件…
                    </button>
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    disabled={
                      model === null ||
                      model.modelStatus === "downloading" ||
                      (model?.pythonMode || model?.preflight?.pythonMode) === "system"
                    }
                    title="创建或修复 Companion 数据目录下的独立 python-env；优先 uv"
                    onClick={() => {
                      dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
                      send({ type: "computer.model.ensure_python_env", source: "settings" })
                    }}
                  >
                    {(model?.isolatedEnvExists ?? model?.preflight?.isolatedEnvExists)
                      ? "修复/更新独立环境"
                      : "创建独立环境"}
                  </button>
                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    disabled={model === null || model.modelStatus === "downloading"}
                    title="安装下载与推理所需组件"
                    onClick={() => {
                      dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
                      send({ type: "computer.model.install_deps", source: "settings" })
                    }}
                  >
                    安装缺失依赖
                  </button>
                </div>

                {/* 下载源 */}
                <div style={{ ...styles.helpText, marginTop: 10, fontWeight: 600 }}>下载源</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {(
                    [
                      { id: "auto", label: "自动" },
                      { id: "modelscope", label: "魔搭 ModelScope" },
                      { id: "hf-mirror", label: "HF 镜像" },
                      { id: "huggingface", label: "Hugging Face" },
                    ] as const
                  ).map((s) => {
                    const active = (model?.downloadSource || "auto") === s.id
                    return (
                      <button
                        key={s.id}
                        type="button"
                        style={{
                          ...styles.secondaryBtn,
                          ...(active
                            ? { background: tokens.accent, color: "#fff", borderColor: tokens.accent }
                            : {}),
                          opacity: model === null || model.modelStatus === "downloading" ? 0.5 : 1,
                        }}
                        disabled={model === null || model.modelStatus === "downloading"}
                        onClick={() => {
                          dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
                          send({
                            type: "computer.model.set_download_source",
                            downloadSource: s.id,
                            source: "settings",
                          })
                        }}
                      >
                        {s.label}
                      </button>
                    )
                  })}
                </div>
                <div style={{ ...styles.helpText, marginTop: 4, fontSize: 11, color: "#666" }}>
                  {model?.downloadSourceReason ||
                    "自动：探测 HF 是否可达；不可达或系统语言为中文时优先 ModelScope。中国大陆建议「自动」或「魔搭」。"}
                  {model?.downloadSourceResolved
                    ? ` 当前解析：${model.downloadSourceResolved}`
                    : ""}
                </div>

                {/* 变体选择 2B / 4B / 8B + 资源提示 */}
                <div style={{ ...styles.helpText, marginTop: 8, fontWeight: 600 }}>模型规模</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {(["2b", "4b", "8b"] as const).map((v) => {
                    const active = (model?.variant || "2b") === v
                    const tip = QWEN_VL_VARIANT_TIPS[v]!
                    const rec = model?.recommendedVariant === v
                    return (
                      <button
                        key={v}
                        type="button"
                        style={{
                          ...styles.secondaryBtn,
                          ...(active
                            ? { background: tokens.accent, color: "#fff", borderColor: tokens.accent }
                            : {}),
                          opacity: model === null || model.modelStatus === "downloading" ? 0.5 : 1,
                        }}
                        disabled={model === null || model.modelStatus === "downloading"}
                        title={tip.tip}
                        onClick={() => {
                          dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
                          send({ type: "computer.model.set_variant", variant: v, source: "settings" })
                        }}
                      >
                        {tip.label}
                        {rec ? " · 推荐" : ""}
                      </button>
                    )
                  })}
                </div>
                <div style={{ ...styles.helpText, marginTop: 4, color: "#B26B00" }}>
                  {model?.resourceTip || variantResourceTip(model?.variant)}
                </div>
                <div style={{ ...styles.helpText, marginTop: 2, fontSize: 11, color: "#888" }}>
                  切换规模后请重新「下载模型」。能否流畅运行由 Companion 按本机内存/显存估算；不足仍可下载，但可能很慢或 OOM。
                </div>
                {/* 状态行 */}
                <div
                  style={{
                    ...styles.helpText,
                    marginTop: 6,
                    color:
                      statusLine.kind === "error" ? "#C62828" : statusLine.kind === "ok" ? tokens.success : "#555",
                  }}
                >
                  {statusLine.text}
                  {statusLine.detail ? ` ${statusLine.detail}` : ""}
                  {statusLine.action ? (
                    <button style={{ ...styles.secondaryBtn, marginLeft: 8 }} onClick={() => runAction(statusLine.action!)}>
                      {statusLine.action}
                    </button>
                  ) : null}
                </div>
                {/* 管理按钮行:下载 / 删除(两步确认)/ 重置熔断(disabled 态) */}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button
                    style={styles.secondaryBtn}
                    disabled={
                      model === null ||
                      model.modelStatus === "downloading" ||
                      model.modelStatus === "ready" ||
                      // Fail-closed: only enable when Companion explicitly says canDownload
                      model.canDownload !== true
                    }
                    title={
                      model?.canDownload !== true
                        ? model?.downloadBlockReason ||
                          model?.preflight?.downloadBlockReason ||
                          "环境未就绪：请先完成上方「环境检查」中的软件/磁盘项"
                        : "从当前下载源拉取权重到本机 Companion 数据目录"
                    }
                    onClick={() => {
                      dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
                      send({ type: "computer.model.download", source: "settings" })
                    }}
                  >
                    {model?.canDownload === true ? "下载模型" : "下载模型（先完成环境检查）"}
                  </button>
                  <button
                    style={{
                      ...styles.secondaryBtn,
                      ...(modelDeleteArmed ? { borderColor: "#C62828", color: "#C62828" } : {}),
                    }}
                    disabled={model === null || (model.modelStatus !== "ready" && model.modelStatus !== "error" && model.modelStatus !== "disabled")}
                    onClick={() => {
                      if (!modelDeleteArmed) {
                        setModelDeleteArmed(true)
                        return
                      }
                      setModelDeleteArmed(false)
                      send({ type: "computer.model.delete", source: "settings" })
                    }}
                  >
                    {modelDeleteArmed ? "再次点击确认删除" : "删除模型"}
                  </button>
                  <button
                    style={styles.secondaryBtn}
                    disabled={model?.modelStatus !== "disabled"}
                    onClick={() => send({ type: "computer.model.reset_circuit_breaker", source: "settings" })}
                  >
                    重置熔断
                  </button>
                </div>
                {/* 错误位(family:"computer.model" 路由) */}
                {state.computerModelError && (
                  <div style={{ ...styles.helpText, color: tokens.danger, marginTop: 4 }}>
                    {state.computerModelError}
                  </div>
                )}
                <div style={styles.helpText}>{MODEL_SWITCH_COPY.licenseDoorHint}</div>
              </div>
            )
          })()}

          {/* 许可证门:渲染 license_required 载荷原文(LICENSE_DOOR_TEXT 单一真源
              在 companion model-license.ts,扩展不复制不私编) */}
          {licenseDoorShouldOpen(state.computerModelLicenseDoor) && (
            <Modal
              open={true}
              onClose={() => dispatch({ type: "SET_COMPUTER_MODEL_LICENSE_DOOR", door: null })}
              overlayStyle={styles.backdrop}
              panelStyle={{ ...styles.panel, maxWidth: 520 }}
              ariaLabel="实验层许可证与免责声明"
            >
              <div style={styles.header}>
                <h3 style={{ margin: 0, fontSize: 15 }}>实验层许可证与免责声明</h3>
              </div>
              <div style={{ ...styles.body, maxHeight: 320, overflowY: "auto", whiteSpace: "pre-wrap" }}>
                {state.computerModelLicenseDoor!.licenseText}
              </div>
              <div style={{ ...styles.helpText, padding: "0 16px" }}>
                {state.computerModelLicenseDoor!.notice}
              </div>
              <div style={styles.footer}>
                <button
                  style={styles.secondaryBtn}
                  onClick={() => {
                    dispatch({ type: "SET_COMPUTER_MODEL_LICENSE_DOOR", door: null })
                    chrome.runtime.sendMessage({ type: "computer.model.license_response", accepted: false, source: "settings" })
                  }}
                >
                  拒绝(跳过本层)
                </button>
                <button
                  style={styles.saveBtn}
                  onClick={() => {
                    dispatch({ type: "SET_COMPUTER_MODEL_LICENSE_DOOR", door: null })
                    chrome.runtime.sendMessage({ type: "computer.model.license_response", accepted: true, source: "settings" })
                  }}
                >
                  接受并下载模型
                </button>
              </div>
            </Modal>
          )}

          
            </SettingsSection>
          </div>

        </div>

        <div style={styles.footer}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: "auto", textAlign: "left" }}>
            {state.testResult && (
              <span style={{
                fontSize: 12,
                color: state.testResult.includes("成功") ? tokens.success : tokens.danger,
              }}>{state.testResult}</span>
            )}
            {state.testVisionResult && (
              <span style={{
                fontSize: 12,
                color: state.testVisionResult.includes("成功") ? tokens.success : tokens.danger,
              }}>{state.testVisionResult}</span>
            )}
          </div>
          <button style={styles.testBtn} onClick={handleTest}>
            {config.vision_enabled ? "测试连接（含视觉）" : "测试连接"}
          </button>
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
    </Modal>
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
    border: `1px solid ${tokens.accent}`,
    borderRadius: 6,
    background: "#fff",
    color: tokens.accent,
    fontSize: 12,
    cursor: "pointer",
  },
  saveBtn: {
    padding: "6px 20px",
    border: "none",
    borderRadius: 6,
    background: tokens.accent,
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
