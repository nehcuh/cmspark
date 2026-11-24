// Settings slideout panel for LLM configuration + NetSec (migrated from 场景 panel)

import { useState, useEffect, useCallback, useRef } from "react"
import { useAgentStore } from "../store/agentStore"
import type { AgentState } from "../store/agentStore"
import { prepareSettingsSubmission } from "../utils/settings-draft"
import { CHAT_OUTPUT_LIMIT_MAX, isChatOutputLimit } from "../utils/normalize-config"
import type { LLMConfig, SecurityAuditEntry } from "../types"

type LocalSettingKey = "asrRefinerEnabled" | "sendShortcut" | "showReasoningMode" | "exportIncludeReasoning" | "voiceInputEnabled" | "voiceDictationMode" | "chatDictationLanguage" | "dictationHotkeyEnabled" | "dictationHotkeyChord" | "voiceSoundEffects" | "voiceRealtimeStreaming"
type LocalSettingsDraft = Partial<Pick<AgentState, LocalSettingKey>>
type VoicePrefsDraft = Partial<Record<"autoFallbackToBrowser" | "modelPrewarm" | "postprocessFillers" | "postprocessLowercase" | "postprocessStripPunct", boolean>>
type ComputerDraft = { pythonMode?: "isolated" | "system"; downloadSource?: "auto" | "modelscope" | "hf-mirror" | "huggingface"; variant?: "2b" | "4b" | "8b" }
type FooterControl = { dirty: boolean; busy: boolean; save: (known?: ModelCenterState) => void | Promise<boolean | ModelCenterState>; error?: string }
import { Modal } from "./ui/Modal"
import { connectionLabel, tokens } from "../ui/tokens"
import { effortLevels, modelSpec, modelSuggestions, reasoningWireEffort, type ReasoningEffort } from "../utils/reasoning-effort"
import { calculateChatOutputBudget, effectiveContextWindow } from "../utils/chat-output-policy"
import { UserEnvSection } from "./UserEnvSection"
import { SiteCounterSettingsSection } from "./SiteCounterSettingsSection"
import { NetSecSettingsSection } from "./NetSecSettingsSection"
import { CapabilityProfileSection } from "./CapabilityProfileSection"
import { OutboundMcpSettingsSection } from "./OutboundMcpSettingsSection"
import { CodingHandoffSettingsSection } from "./CodingHandoffSettingsSection"
import { LcuSettingsSection } from "./LcuSettingsSection"
import { SettingsNavRow, SettingsPage } from "./SettingsPage"
import { SettingsModelUses } from "./SettingsModelUses"
import { ModelCenterControls } from "./ModelCenterControls"
import { MeetingExternalAsrSettings } from "./MeetingExternalAsrSettings"
import type { ModelCenterState } from "../utils/model-center"
import { MicrophoneDeviceSelect } from "./MicrophoneDeviceSelect"
import {
  resolveSettingsDestination,
  SETTINGS_CATEGORIES,
  SETTINGS_DESTINATIONS,
  type SettingsCategoryId,
  type SettingsDestinationId,
} from "../utils/settings-navigation"
import { SettingsIntentBar } from "./SettingsIntentBar"
import { HotkeyCaptureField } from "./HotkeyCaptureField"
import { useContextPanelHostOptional } from "./ContextPanelHost"
import type { SettingsIntent } from "../utils/settings-intent"
import { DICTATION_HOTKEY_DEFAULT_CHORD } from "../voice/hotkey-chord"
import { isElevatedTrust } from "../utils/settings-sections"
import {
  contextWindowHelpText,
  settingsSaveDisabled,
  settingsSaveDisabledTitle,
} from "../utils/context-window-copy"
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
import { AutopilotConsequenceMatrix } from "./AutopilotConsequenceMatrix"
// Path B M0: pure copy + recommended model id for local STT settings progressive disclosure.
import {
  BTN_CANCEL,
  BTN_DELETE,
  BTN_DOWNLOAD,
  BTN_ENABLE_LOCAL,
  BTN_ENABLE_SYSTEM,
  BTN_LOCAL_ENABLED,
  BTN_SET_ACTIVE,
  BTN_SWITCH_BROWSER,
  BTN_SYSTEM_ENABLED,
  ENGINE_BROWSER_HINT,
  ENGINE_BROWSER_LABEL,
  ENGINE_LOCAL_HINT,
  ENGINE_LOCAL_LABEL,
  ENGINE_SECTION_LABEL,
  ENGINE_SYSTEM_HINT,
  ENGINE_SYSTEM_LABEL,
  OTHER_MODELS_TOGGLE,
  WHISPER_SETTINGS_MODEL_IDS,
  RECOMMENDED_ROW_PREFIX,
  RECOMMENDED_WHISPER_MODEL_ID,
  SYSTEM_UNAVAILABLE_REASON_LABEL,
  VOICE_AUTO_FALLBACK_HINT,
  VOICE_AUTO_FALLBACK_LABEL,
  VOICE_DOWNLOAD_ENDPOINT_HINT,
  VOICE_DOWNLOAD_ENDPOINT_LABEL,
  VOICE_DOWNLOAD_ENDPOINT_PLACEHOLDER,
  VOICE_ERR_DOWNLOAD_NO_PROGRESS,
  VOICE_ERR_STATE_TIMEOUT,
  VOICE_STATUS_QUERYING,
  VOICE_STATUS_STARTING_DOWNLOAD,
  whisperModelMetaLine,
  binaryStatusLine,
  canDownloadWhisperBinary,
  engineChainRows,
  formatDiskUsage,
  modelProbeErrorLabel,
  modelStatusLabel,
  parseVoiceSettingsSendResponse,
  privacyCopyForEngine,
  progressPercent,
  type WhisperSettingsModelId,
} from "../voice/whisper-settings-copy"
import { WhisperAccelerationSettings } from "./WhisperAccelerationSettings"
import {
  externalCancelCopy,
  externalKeySaveCopy,
  externalLimitCopy,
  externalPrivacyCopy,
  externalRefineCopy,
} from "../voice/external-asr-ui"
import { detectSpeechRecognition, normalizeChatDictationLanguage } from "../voice/detect"
import {
  VISION_COPY,
  extractHostname,
  shouldOfferVisionReuse,
} from "./vision-reuse-logic"

// P1-1 / PR-B: typed-confirmation phrase for arming dangerous security flags.
// Lock-step with companion/src/security-arm.ts SECURITY_ARM_CONFIRM_PHRASE —
// companion rejects false→true without this top-level confirmation_phrase.
// UI phrase alone is theater; arm path must forward phrase on config.set.
// Alias kept as SECURITY_ARM_CONFIRM_PHRASE semantics; not a product "God" noun.
const GODMODE_CONFIRM_PHRASE = "我了解风险"
const SECURITY_ARM_PHRASE = GODMODE_CONFIRM_PHRASE

// #259 引擎链路状态 row 2: Web Speech availability (pure feature detect; node tests → missing).
const BROWSER_STT_SUPPORT = detectSpeechRecognition(
  typeof window !== "undefined" ? (window as any) : {},
)

function immediatePatchApplied(config: any, patch: any): boolean {
  if (!patch || typeof patch !== "object") return false
  return Object.keys(patch).every(key => {
    const want = patch[key]
    const got = config?.[key]
    if (want && typeof want === "object" && !Array.isArray(want)) return immediatePatchApplied(got, want)
    return JSON.stringify(got) === JSON.stringify(want)
  })
}

type SettingsRoute =
  | { view: "home" }
  | { view: "category"; category: SettingsCategoryId }
  | { view: "destination"; category: SettingsCategoryId; destination: SettingsDestinationId }

const settingsCategories = Object.keys(SETTINGS_CATEGORIES) as SettingsCategoryId[]
const settingsDestinations = Object.keys(SETTINGS_DESTINATIONS) as SettingsDestinationId[]

export function SettingsSlideout() {
  const { state, dispatch } = useAgentStore()
  const host = useContextPanelHostOptional()
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
  const [immediateNotice, setImmediateNotice] = useState<string | null>(null)
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
  // Vision reuse UX (multi-adversarial P0): banner session + advanced collapse when reused
  const [unattendedAckDesktop, setUnattendedAckDesktop] = useState(false)
  const [unattendedAckSession, setUnattendedAckSession] = useState(false)
  const [unattendedIncludeProtocol, setUnattendedIncludeProtocol] = useState(false)
  // WP5-I4 实验区:删除模型两步确认按钮的待命态(非 store——纯组件内 UI 态)。
  const [modelDeleteArmed, setModelDeleteArmed] = useState(false)
  // Path B M0: engine radio is UI draft until ready model + explicit "启用本机转写".
  const [engineSelection, setEngineDraft] = useState<"browser" | "local" | "system" | "external" | null>(null)
  const [enginePrivacyAck, setEnginePrivacyAck] = useState(false)
  const [enginePending, setEnginePending] = useState(false)
  const engineSaveRef = useRef<string | null>(null)
  const committedEngine = state.voiceModel?.sttEngine
  const engineDraft = engineSelection ?? committedEngine ?? "browser"
  const [externalPrivacyAck, setExternalPrivacyAck] = useState(false)
  const [externalKeyDraft, setExternalKeyDraft] = useState("")
  const [externalBaseDraft, setExternalBaseDraft] = useState<string | null>(null)
  const [externalStyleDraft, setExternalStyleDraft] = useState<"deepseek" | "openai" | null>(null)
  const [externalModelDraft, setExternalModelDraft] = useState<string | null>(null)
  const [computerDraft, setComputerDraft] = useState<ComputerDraft>({})
  const [localDraft, setLocalDraft] = useState<LocalSettingsDraft>({})
  const [localSaving, setLocalSaving] = useState(false)
  const [localSaveError, setLocalSaveError] = useState<string | null>(null)
  const [localSaved, setLocalSaved] = useState(false)
  const [footerNotice, setFooterNotice] = useState<string | null>(null)
  const localSavingRef = useRef(false)
  const [footerWaiting, setFooterWaiting] = useState(false)
  const [footerRunning, setFooterRunning] = useState(false)
  const footerRunningRef = useRef(false)
  const [footerAckTick, setFooterAckTick] = useState(0)
  const footerQueueRef = useRef<{ id: string; ackRevision: string | null } | null>(null)
  const afterConfigRef = useRef<() => void>(() => {})
  const [meetingFooter, setMeetingFooter] = useState<FooterControl | null>(null)
  const reportMeetingFooter = useCallback((control: FooterControl | null) => setMeetingFooter(control), [])
  const [profileFooter, setProfileFooter] = useState<FooterControl | null>(null)
  const reportProfileFooter = useCallback((control: FooterControl | null) => setProfileFooter(control), [])
  const [visualFooter, reportVisualFooter] = useState<FooterControl | null>(null)
  const [minutesFooter, setMinutesFooter] = useState<FooterControl | null>(null)
  const reportMinutesFooter = useCallback((control: FooterControl | null) => setMinutesFooter(control), [])
  const [lcuFooter, setLcuFooter] = useState<FooterControl | null>(null)
  const reportLcuFooter = useCallback((control: FooterControl | null) => setLcuFooter(control), [])
  const [microphoneFooter, setMicrophoneFooter] = useState<FooterControl | null>(null)
  const reportMicrophoneFooter = useCallback((control: FooterControl | null) => setMicrophoneFooter(control), [])
  const [envFooter, setEnvFooter] = useState<FooterControl | null>(null)
  const reportEnvFooter = useCallback((control: FooterControl | null) => setEnvFooter(control), [])
  const [externalPending, setExternalPending] = useState(false)
  const [externalSaved, setExternalSaved] = useState(false)
  const externalSaveRef = useRef<{ id: string; style: typeof externalStyleDraft; base: typeof externalBaseDraft; model: typeof externalModelDraft; key: string } | null>(null)
  const [otherWhisperOpen, setOtherWhisperOpen] = useState(false)
  /** Local-only: modelId user clicked download on, until companion state/progress arrives. */
  const [voicePendingDownload, setVoicePendingDownload] = useState<string | null>(null)
  const voicePendingDownloadRef = useRef<string | null>(null)
  voicePendingDownloadRef.current = voicePendingDownload
  /** 模型下载源输入草稿；null = 未编辑，跟随 voiceModel 镜像。 */
  const [voiceEndpointDraft, setVoiceEndpointDraft] = useState<string | null>(null)
  const [voicePrefsDraft, setVoicePrefsDraft] = useState<VoicePrefsDraft>({})
  const [voicePrefsPending, setVoicePrefsPending] = useState(false)
  const voicePrefsRef = useRef<{ id: string; prefs: VoicePrefsDraft; endpoint: string | null } | null>(null)
  const [settingsRoute, setSettingsRoute] = useState<SettingsRoute>({ view: "home" })
  const activeCategory = settingsRoute.view === "home" ? undefined : settingsRoute.category
  const activeDestination = settingsRoute.view === "destination" ? settingsRoute.destination : undefined
  const settingsInteractive = state.settingsOpen && !licenseDoorShouldOpen(state.computerModelLicenseDoor)
  const knowledgeRoute = useRef<SettingsRoute | null>(null)
  knowledgeRoute.current = settingsInteractive && activeDestination === "data-knowledge" ? settingsRoute : null
  const settingsBody = useRef<HTMLDivElement>(null)
  const focusTarget = useRef<string | null>(null)
  const lastSettingsFocus = useRef<HTMLElement | null>(null)
  const licenseWasOpen = useRef(false)
  useEffect(() => {
    const open = licenseDoorShouldOpen(state.computerModelLicenseDoor)
    const restore = licenseWasOpen.current && !open && state.settingsOpen && !state.settingsFocusSection
    licenseWasOpen.current = open
    if (!restore) return
    const frame = requestAnimationFrame(() => lastSettingsFocus.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [state.computerModelLicenseDoor, state.settingsOpen, state.settingsFocusSection])
  const selectSettingsPage = useCallback((id: string, category?: SettingsCategoryId) => {
    const destination = resolveSettingsDestination(id)
    if (!destination) return
    focusTarget.current = `[data-settings-destination="${destination}"] h3`
    setSettingsRoute({ view: "destination", category: category ?? SETTINGS_DESTINATIONS[destination].category, destination })
  }, [])
  const selectSettingsCategory = (category: SettingsCategoryId) => {
    focusTarget.current = "#settings-category-heading"
    setSettingsRoute({ view: "category", category })
  }
  const goBackInSettings = () => {
    if (settingsRoute.view === "destination") {
      focusTarget.current = `[data-settings-open-destination="${settingsRoute.destination}"]`
      setSettingsRoute({ view: "category", category: settingsRoute.category })
    } else if (settingsRoute.view === "category") {
      focusTarget.current = `[data-settings-open-category="${settingsRoute.category}"]`
      setSettingsRoute({ view: "home" })
    }
  }
  useEffect(() => {
    if (!state.settingsOpen) {
      focusTarget.current = null
      setSettingsRoute({ view: "home" })
      return
    }
    if (!settingsInteractive || !focusTarget.current) return
    const frame = requestAnimationFrame(() => {
      const body = settingsBody.current
      if (!body || !focusTarget.current) return
      body.scrollTop = 0
      const target = body.querySelector<HTMLElement>(focusTarget.current)
      const heading = body.querySelector<HTMLElement>("#settings-category-heading")
      const element = target ?? heading
      element?.focus()
      focusTarget.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [settingsInteractive, settingsRoute, state.settingsOpen])
  const openWorkspaceDestination = (destination: "activity" | "todos") => {
    window.dispatchEvent(new CustomEvent("cmspark:open-workspace-destination", { detail: destination }))
  }

  const elevatedTrust = isElevatedTrust({
    auto_approve_dangerous: state.config.auto_approve_dangerous,
    auto_approve_enterprise_tools: state.config.auto_approve_enterprise_tools,
    allow_all_schemes: state.config.allow_all_schemes,
    unattendedArmed: state.unattended?.armed === true,
  })

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
    // Path B M0: mirror voice.model state on settings open (UI Task 7).
    // Do not blank voiceModelError here — get_state / WS lastDownloadError hydrates it.
    setVoicePendingDownload(null)
    setVoiceEndpointDraft(null)
    setExternalPrivacyAck(false)
    setExternalKeyDraft("")
    setExternalBaseDraft(null)
    setExternalStyleDraft(null)
    setExternalModelDraft(null)
    // #259: Windows SAPI probe (win32 → helper/System.Speech rows; other → no-op).
    chrome.runtime.sendMessage({ type: "voice.system.state" })
    chrome.runtime.sendMessage({ type: "ws.getPairingStatus" }, (resp: { paired?: boolean } | undefined) => {
      const paired = !!resp?.paired
      setWsPaired(paired)
    })
    // Coding agents: list even when acp.enabled=false (discovery ≠ feature gate)
    chrome.runtime.sendMessage({ type: "acp.list" }, () => {
      void chrome.runtime.lastError
    })
  }, [state.settingsOpen])

  useEffect(() => {
    if (!state.settingsOpen || state.connectionState !== "connected") return
    chrome.runtime.sendMessage({ type: "voice.model.get_state" }, (resp: unknown) => {
      const lastErr =
        typeof chrome.runtime.lastError?.message === "string"
          ? chrome.runtime.lastError.message
          : null
      const parsed = parseVoiceSettingsSendResponse(resp, lastErr)
      if (parsed.ok === false) {
        dispatch({ type: "SET_VOICE_MODEL_ERROR", error: parsed.error })
      }
    })
  }, [state.settingsOpen, state.connectionState, dispatch])

  // Reopen on the committed engine and follow changes confirmed by Companion.
  useEffect(() => {
    setEngineDraft(null)
  }, [state.settingsOpen, committedEngine])

  useEffect(() => { setEnginePrivacyAck(false) }, [engineSelection])

  useEffect(() => {
    if (state.voiceModelError && engineSelection === "browser" && committedEngine && committedEngine !== "browser") {
      setEngineDraft(null)
    }
  }, [state.voiceModelError, engineSelection, committedEngine])

  // Clear local pending-download once companion reports downloading/ready or progress.
  useEffect(() => {
    const pending = voicePendingDownload
    if (!pending) return
    const st = state.voiceModel?.models?.[pending]?.status
    if (st === "downloading" || st === "ready") {
      setVoicePendingDownload(null)
      return
    }
    if (state.voiceModelProgress?.modelId === pending) {
      setVoicePendingDownload(null)
    }
  }, [state.voiceModel, state.voiceModelProgress, voicePendingDownload])

  // Settings open but voice.model.state never arrives → surface timeout (was silent forever).
  useEffect(() => {
    if (!state.settingsOpen) return
    if (state.voiceModel !== null) return
    const t = window.setTimeout(() => {
      dispatch({ type: "SET_VOICE_MODEL_ERROR", error: VOICE_ERR_STATE_TIMEOUT })
    }, 6000)
    return () => window.clearTimeout(t)
  }, [state.settingsOpen, state.voiceModel, dispatch])

  // Download click accepted by SW but no companion progress → surface (was silent).
  useEffect(() => {
    if (!voicePendingDownload) return
    const modelId = voicePendingDownload
    const t = window.setTimeout(() => {
      if (voicePendingDownloadRef.current !== modelId) return
      setVoicePendingDownload(null)
      dispatch({ type: "SET_VOICE_MODEL_ERROR", error: VOICE_ERR_DOWNLOAD_NO_PROGRESS })
      dispatch({ type: "SET_VOICE_MODEL_PROGRESS", progress: null })
    }, 8000)
    return () => window.clearTimeout(t)
  }, [voicePendingDownload, dispatch])

  // Auto-expand advanced gates when any arm flag is on (user can still collapse).
  // Parent「安全与信任」is collapsible; elevated trust only shows header badge.
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

  useEffect(() => {
    if (!settingsInteractive || !state.settingsFocusSection) return
    selectSettingsPage(state.settingsFocusSection)
    dispatch({ type: "CLEAR_SETTINGS_FOCUS" })
  }, [settingsInteractive, state.settingsFocusSection, dispatch, selectSettingsPage])

  /**
   * Text / voice commands for configuring this extension (D2+ UX).
   * MUST stay above the settingsOpen early-return — React #310 if hooks run only when open.
   */
  const applySettingsIntent = useCallback(
    async (intent: SettingsIntent, isCurrent: () => boolean): Promise<string> => {
      switch (intent.type) {
        case "open_meeting":
        case "open_packs": {
          if (!host) return "此处无法打开面板，请保留设置并从工作区导航打开。"
          const opened = await host.openPanelForce(intent.type === "open_meeting" ? "meeting" : "packs")
          if (!isCurrent()) return "导航已取消，设置保持原状。"
          if (!opened) return "面板尚未打开，请先完成当前操作后再试。"
          dispatch({ type: "SET_SETTINGS_OPEN", open: false })
          return intent.type === "open_meeting" ? "已打开会议工作台" : "已打开场景面板"
        }
        case "unknown":
        default:
          return "未识别导航。请描述目标并生成设置候选，或输入「打开会议」「打开场景」使用规则导航。"
      }
    },
    [dispatch, host],
  )

  useEffect(() => {
    if (state.settingsOpen && state.configHydratedFromCompanion) dispatch({ type: "BEGIN_SETTINGS_DRAFT" })
  }, [state.settingsOpen, state.configHydratedFromCompanion, dispatch])

  useEffect(() => {
    const onMessage = (message: { type?: string; id?: string; error?: string; config_revision?: string }) => {
      if (footerQueueRef.current && message.id === footerQueueRef.current.id && message.type === "config.updated") {
        footerQueueRef.current.ackRevision = typeof message.config_revision === "string" ? message.config_revision : null
        setFooterAckTick(value => value + 1)
      }
      if (engineSaveRef.current && message.id === engineSaveRef.current && (message.type === "voice.model.state" || message.type === "error")) {
        engineSaveRef.current = null
        setEnginePending(false)
        if (message.type === "error") dispatch({ type: "SET_VOICE_MODEL_ERROR", error: message.error || "听写引擎没有切换。" })
      }
      const prefs = voicePrefsRef.current
      if (prefs && message.id === prefs.id && (message.type === "voice.model.state" || message.type === "error")) {
        voicePrefsRef.current = null
        setVoicePrefsPending(false)
        if (message.type === "voice.model.state") {
          setVoicePrefsDraft(current => {
            const next = { ...current }
            for (const key of Object.keys(prefs.prefs) as Array<keyof VoicePrefsDraft>) if (current[key] === prefs.prefs[key]) delete next[key]
            return next
          })
          setVoiceEndpointDraft(value => value === prefs.endpoint ? null : value)
        } else dispatch({ type: "SET_VOICE_MODEL_ERROR", error: message.error || "本机听写设置没有保存。" })
      }
      const pending = externalSaveRef.current
      if (!pending || message.id !== pending.id) return
      if (message.type === "voice.model.state") {
        externalSaveRef.current = null
        setExternalPending(false)
        setExternalStyleDraft(value => value === pending.style ? null : value)
        setExternalBaseDraft(value => value === pending.base ? null : value)
        setExternalModelDraft(value => value === pending.model ? null : value)
        setExternalKeyDraft(value => value === pending.key ? "" : value)
        setExternalSaved(true)
      } else if (message.type === "voice.model.error" || message.type === "error") {
        externalSaveRef.current = null
        setExternalPending(false)
        dispatch({ type: "SET_VOICE_MODEL_ERROR", error: message.error || "外部转写配置没有保存，请重试。" })
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [dispatch])

  useEffect(() => {
    const queue = footerQueueRef.current
    if (!footerWaiting || !queue) return
    if (queue.ackRevision && queue.ackRevision === state.configRevision && state.settingsSave.status === "saved") {
      footerQueueRef.current = null
      setFooterWaiting(false)
      afterConfigRef.current()
    } else if (["unknown", "conflict", "review"].includes(state.settingsSave.status)) {
      footerQueueRef.current = null
      setFooterWaiting(false)
      setLocalSaveError("部分设置尚未保存，请先处理配置回执或冲突，再重新保存。")
    }
  }, [footerWaiting, footerAckTick, state.settingsSave, state.configRevision])

  useEffect(() => {
    if (!footerWaiting) return
    const timer = window.setTimeout(() => {
      const queue = footerQueueRef.current
      if (!queue) return
      footerQueueRef.current = null
      setFooterWaiting(false)
      dispatch({ type: "SETTINGS_SAVE_UNKNOWN", id: queue.id, error: "等待配置保存回执超时" })
      setLocalSaveError("配置保存结果未知，其余设置草稿已保留。")
    }, 15000)
    return () => window.clearTimeout(timer)
  }, [footerWaiting, dispatch])

  useEffect(() => {
    if (!enginePending) return
    const timer = window.setTimeout(() => {
      engineSaveRef.current = null
      setEnginePending(false)
      dispatch({ type: "SET_VOICE_MODEL_ERROR", error: "听写引擎切换结果未知，请核对当前配置。" })
    }, 15000)
    return () => window.clearTimeout(timer)
  }, [enginePending, dispatch])

  useEffect(() => {
    if (!voicePrefsPending) return
    const timer = window.setTimeout(() => {
      voicePrefsRef.current = null
      setVoicePrefsPending(false)
      dispatch({ type: "SET_VOICE_MODEL_ERROR", error: "本机听写设置保存结果未知，草稿已保留。" })
    }, 15000)
    return () => window.clearTimeout(timer)
  }, [voicePrefsPending, dispatch])

  useEffect(() => {
    if (!externalPending) return
    const timer = window.setTimeout(() => {
      externalSaveRef.current = null
      setExternalPending(false)
      dispatch({ type: "SET_VOICE_MODEL_ERROR", error: "保存结果未知，草稿已保留。请核对当前配置后重试。" })
    }, 15000)
    return () => window.clearTimeout(timer)
  }, [externalPending, dispatch])

  const immediateSave = state.immediateSave
  const immediateConfigRef = useRef(state.config)
  const immediateSaveRef = useRef(immediateSave)
  immediateConfigRef.current = state.config
  immediateSaveRef.current = immediateSave
  const immediateKey = immediateSave && immediateSave.status === "accepted"
    ? `${immediateSave.id}:${immediateSave.matchedRevision ?? ""}:${immediateSave.conflict ? "conflict" : immediatePatchApplied(state.config, immediateSave.patch) ? "ready" : "wait"}`
    : ""
  useEffect(() => {
    const save = immediateSaveRef.current
    if (!save || save.status !== "accepted") return
    if (save.conflict) {
      dispatch({ type: "SETTINGS_SAVE_UNKNOWN", id: save.id, error: "配置已在其他地方更新，这次修改没有写入" })
      return
    }
    if (!save.matchedRevision || !immediatePatchApplied(immediateConfigRef.current, save.patch)) return
    dispatch({ type: "IMMEDIATE_SAVE_CONFIRMED", id: save.id })
    if (save.audit) dispatch({ type: "ADD_SECURITY_AUDIT", entry: save.audit })
  }, [immediateKey, dispatch])

  if (!state.settingsOpen) return null

  // Security controls with their own immediate, phrase-protected writes keep
  // reading authoritative state. Overlay only fields the user is editing.
  const config = { ...state.config }
  const draft = state.settingsDraft
  if (draft) {
    for (const key of Object.keys(draft.dirty) as Array<keyof LLMConfig>) {
      Object.assign(config, { [key]: draft.value[key] })
    }
  }
  const spec = modelSpec(config.protocol, config.base_url, config.model_name)
  const support = spec?.support ?? "unsupported"
  const wireEffort = reasoningWireEffort(support, config.reasoning_effort)
  const toggleOnly = support === "switch" || support === "adaptive-switch"
  const budget = calculateChatOutputBudget(effectiveContextWindow(config.context_window).effective, spec, config.max_tokens, config.reasoning_effort)
  const saveBlocked = settingsSaveDisabled(state.configHydratedFromCompanion) || !draft ||
    !state.configRevision || state.connectionState !== "connected" || !!state.settingsSave.pending ||
    state.settingsSave.status === "unknown" || state.immediateSave?.status === "sending" || state.immediateSave?.status === "accepted" || Object.keys(draft?.conflicts ?? {}).length > 0
  const hasEdits = Object.keys(draft?.dirty ?? {}).length > 0
  const savingExternal = activeDestination === "input-dictation-engine" && engineDraft === "external"
  const localValues = { ...state, ...localDraft }
  const localHasEdits = Object.keys(localDraft).length > 0
  const editLocal = <K extends LocalSettingKey>(key: K, value: AgentState[K]) => {
    setLocalSaveError(null)
    setLocalSaved(false)
    setLocalDraft(current => {
      const next = { ...current }
      if (value === state[key]) delete next[key]
      else Object.assign(next, { [key]: value })
      return next
    })
  }
  const externalHasEdits = externalStyleDraft !== null || externalBaseDraft !== null ||
    externalModelDraft !== null || externalKeyDraft.length > 0
  const voicePrefsHasEdits = voiceEndpointDraft !== null || Object.keys(voicePrefsDraft).length > 0
  const engineHasEdits = engineSelection !== null && engineSelection !== committedEngine

  const handleSaveExternal = () => {
    if (externalSaveRef.current || state.connectionState !== "connected" || !externalHasEdits) return
    const external = state.voiceModel?.external
    const style = externalStyleDraft ?? external?.style ?? "deepseek"
    const id = `voice-external-save:${crypto.randomUUID()}`
    externalSaveRef.current = { id, style: externalStyleDraft, base: externalBaseDraft, model: externalModelDraft, key: externalKeyDraft }
    setExternalPending(true)
    setExternalSaved(false)
    dispatch({ type: "SET_VOICE_MODEL_ERROR", error: null })
    try {
      chrome.runtime.sendMessage({
        type: "voice.external.set",
        id,
        source: "settings",
        style,
        baseUrl: externalBaseDraft ?? external?.baseUrl ?? "",
        ...(style === "openai" ? { model: externalModelDraft ?? external?.model ?? "whisper-1" } : {}),
        ...(externalKeyDraft ? { apiKey: externalKeyDraft } : {}),
      }, (response: unknown) => {
        const parsed = parseVoiceSettingsSendResponse(response, chrome.runtime.lastError?.message ?? null)
        if (parsed.ok === false && externalSaveRef.current?.id === id) {
          externalSaveRef.current = null
          setExternalPending(false)
          dispatch({ type: "SET_VOICE_MODEL_ERROR", error: parsed.error })
        }
      })
    } catch (error) {
      externalSaveRef.current = null
      setExternalPending(false)
      dispatch({ type: "SET_VOICE_MODEL_ERROR", error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleSaveLocal = async () => {
    if (!localHasEdits || localSavingRef.current) return
    const submitted = { ...localDraft }
    const names: Record<LocalSettingKey, string> = {
      asrRefinerEnabled: "asrRefinerEnabled", sendShortcut: "sendShortcut", showReasoningMode: "cmspark.ui.show_reasoning",
      exportIncludeReasoning: "cmspark.ui.export_include_reasoning", voiceInputEnabled: "voiceInputEnabled",
      voiceDictationMode: "voiceDictationMode", chatDictationLanguage: "chatDictationLanguage",
      dictationHotkeyEnabled: "dictationHotkeyEnabled", dictationHotkeyChord: "dictationHotkeyChord",
      voiceSoundEffects: "voice_sound_effects", voiceRealtimeStreaming: "voiceRealtimeStreaming",
    }
    const values = Object.fromEntries((Object.keys(submitted) as LocalSettingKey[]).map(key => [names[key], submitted[key]]))
    localSavingRef.current = true
    setLocalSaving(true)
    setLocalSaveError(null)
    setLocalSaved(false)
    try {
      if (submitted.sendShortcut !== undefined) {
        if (state.connectionState !== "connected") throw new Error("Companion 未连接，快捷键草稿已保留。")
        const revision = await new Promise<string>((resolve, reject) => {
          const id = `shortcut-config-get:${crypto.randomUUID()}`
          let done = false
          const finish = (revision?: string, error?: string) => {
            if (done) return
            done = true
            window.clearTimeout(timer)
            chrome.runtime.onMessage.removeListener(listener)
            revision ? resolve(revision) : reject(new Error(error || "无法读取当前配置版本，快捷键草稿已保留。"))
          }
          const listener = (message: { id?: string; type?: string; config_revision?: string; error?: string }) => {
            if (message.id !== id) return
            if (message.type === "config.updated") finish(message.config_revision)
            else if (message.type === "error") finish(undefined, message.error)
          }
          const timer = window.setTimeout(() => finish(), 15000)
          chrome.runtime.onMessage.addListener(listener)
          try {
            chrome.runtime.sendMessage({ type: "config.get", id }, response => {
              const error = chrome.runtime.lastError?.message || (response?.ok === false ? response.error : "")
              if (error) finish(undefined, error)
            })
          } catch (error) { finish(undefined, error instanceof Error ? error.message : String(error)) }
        })
        const id = `settings-save:${crypto.randomUUID()}`
        await new Promise<void>((resolve, reject) => {
          let done = false
          const finish = (error?: string) => {
            if (done) return
            done = true
            window.clearTimeout(timer)
            chrome.runtime.onMessage.removeListener(listener)
            error ? reject(new Error(error)) : resolve()
          }
          const listener = (message: { id?: string; type?: string; error?: string; config_applied_revision?: string; config_revision?: string; config?: { summoner?: { send_shortcut?: string } } }) => {
            if (message.id !== id) return
            if (message.type === "config.conflict") finish("快捷键保存发生配置冲突，草稿已保留。")
            else if (message.type === "error") finish(message.error || "快捷键未保存。")
            else if (message.type === "config.updated") {
              if (message.config_applied_revision && message.config_applied_revision === message.config_revision && message.config?.summoner?.send_shortcut === submitted.sendShortcut) finish()
              else finish("快捷键保存结果无法确认，草稿已保留。")
            }
          }
          const timer = window.setTimeout(() => finish("快捷键保存结果未知，请核对后重试。"), 15000)
          chrome.runtime.onMessage.addListener(listener)
          try {
            chrome.runtime.sendMessage({ type: "config.set", id, config_revision: revision, config: { summoner: { send_shortcut: submitted.sendShortcut } } }, response => {
              const error = chrome.runtime.lastError?.message || (response?.ok === false ? response.error : "")
              if (error) finish(error)
            })
          } catch (error) { finish(error instanceof Error ? error.message : String(error)) }
        })
      }
      await chrome.storage.local.set(values)
      if (submitted.asrRefinerEnabled !== undefined) dispatch({ type: "SET_ASR_REFINER_ENABLED", enabled: submitted.asrRefinerEnabled, persist: false })
      if (submitted.sendShortcut !== undefined) dispatch({ type: "SET_SEND_SHORTCUT", shortcut: submitted.sendShortcut, persist: false })
      if (submitted.showReasoningMode !== undefined) dispatch({ type: "SET_SHOW_REASONING_MODE", mode: submitted.showReasoningMode, persist: false })
      if (submitted.exportIncludeReasoning !== undefined) dispatch({ type: "SET_EXPORT_INCLUDE_REASONING", enabled: submitted.exportIncludeReasoning, persist: false })
      if (submitted.voiceInputEnabled !== undefined) dispatch({ type: "SET_VOICE_INPUT_ENABLED", enabled: submitted.voiceInputEnabled, persist: false })
      if (submitted.voiceDictationMode !== undefined) dispatch({ type: "SET_VOICE_DICTATION_MODE", mode: submitted.voiceDictationMode, persist: false })
      if (submitted.chatDictationLanguage !== undefined) dispatch({ type: "SET_CHAT_DICTATION_LANGUAGE", language: submitted.chatDictationLanguage, persist: false })
      if (submitted.dictationHotkeyEnabled !== undefined) dispatch({ type: "SET_DICTATION_HOTKEY_ENABLED", enabled: submitted.dictationHotkeyEnabled, persist: false })
      if (submitted.dictationHotkeyChord !== undefined) dispatch({ type: "SET_DICTATION_HOTKEY_CHORD", chord: submitted.dictationHotkeyChord, persist: false })
      if (submitted.voiceSoundEffects !== undefined) dispatch({ type: "SET_VOICE_SOUND_EFFECTS", enabled: submitted.voiceSoundEffects, persist: false })
      if (submitted.voiceRealtimeStreaming !== undefined) dispatch({ type: "SET_VOICE_REALTIME_STREAMING", enabled: submitted.voiceRealtimeStreaming, persist: false })
      setLocalDraft(current => {
        const next = { ...current }
        for (const key of Object.keys(submitted) as LocalSettingKey[]) if (current[key] === submitted[key]) delete next[key]
        return next
      })
      setLocalSaved(true)
    } catch (error) {
      setLocalSaveError(error instanceof Error && submitted.sendShortcut !== undefined ? error.message : "本机设置未保存，草稿已保留，请重试。")
    } finally {
      localSavingRef.current = false
      setLocalSaving(false)
    }
  }

  const handleSaveVoicePrefs = () => {
    if (voicePrefsRef.current || !voicePrefsHasEdits || state.connectionState !== "connected") return
    const id = `voice-prefs-save:${crypto.randomUUID()}`
    const submitted = { id, prefs: { ...voicePrefsDraft }, endpoint: voiceEndpointDraft }
    voicePrefsRef.current = submitted
    setVoicePrefsPending(true)
    dispatch({ type: "SET_VOICE_MODEL_ERROR", error: null })
    try {
      chrome.runtime.sendMessage({ type: "voice.model.set_prefs", source: "settings", id, ...submitted.prefs,
        ...(submitted.endpoint !== null ? { modelDownloadEndpoint: submitted.endpoint.trim() } : {}) }, (response: unknown) => {
        const parsed = parseVoiceSettingsSendResponse(response, chrome.runtime.lastError?.message ?? null)
        if (parsed.ok === false && voicePrefsRef.current?.id === id) {
          voicePrefsRef.current = null
          setVoicePrefsPending(false)
          dispatch({ type: "SET_VOICE_MODEL_ERROR", error: parsed.error })
        }
      })
    } catch (error) {
      voicePrefsRef.current = null
      setVoicePrefsPending(false)
      dispatch({ type: "SET_VOICE_MODEL_ERROR", error: error instanceof Error ? error.message : String(error) })
    }
  }

  const modelState = state.voiceModel
  const localReady = !!modelState && [modelState.localModelId, modelState.recommendedModelId].some(id => modelState.models[id]?.status === "ready")
  const systemReady = state.voiceSystemState?.platform === "win32" && state.voiceSystemState?.helper?.ok === true && state.voiceSystemState?.systemSpeech?.available === true
  const engineReady = engineSelection === "browser" || (engineSelection === "local" && localReady) ||
    (engineSelection === "system" && systemReady) ||
    (engineSelection === "external" && externalPrivacyAck && modelState?.external?.keyConfigured === true && !externalHasEdits)
  const handleSaveEngine = (explicitEnable = false) => {
    if (!engineSelection || !engineReady || !engineHasEdits || engineSaveRef.current || state.connectionState !== "connected") return
    if (!explicitEnable && (engineSelection === "local" || engineSelection === "system") && !enginePrivacyAck) return
    const id = `voice-engine-save:${crypto.randomUUID()}`
    engineSaveRef.current = id
    setEnginePending(true)
    dispatch({ type: "SET_VOICE_MODEL_ERROR", error: null })
    try {
      chrome.runtime.sendMessage({ type: "voice.model.set_engine", source: "settings", id, engine: engineSelection,
        ...(engineSelection === "external" ? { privacy_ack_external_v1: true } : engineSelection === "local" || engineSelection === "system" ? { privacy_ack_v2: true } : {}) }, (response: unknown) => {
        const parsed = parseVoiceSettingsSendResponse(response, chrome.runtime.lastError?.message ?? null)
        if (parsed.ok === false && engineSaveRef.current === id) {
          engineSaveRef.current = null
          setEnginePending(false)
          dispatch({ type: "SET_VOICE_MODEL_ERROR", error: parsed.error })
        }
      })
    } catch (error) {
      engineSaveRef.current = null
      setEnginePending(false)
      dispatch({ type: "SET_VOICE_MODEL_ERROR", error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleSave = (queueRest = false) => {
    if (saveBlocked || !hasEdits || !draft || !state.configRevision || draft.revision !== state.configRevision) return
    const id = `settings-save:${crypto.randomUUID()}`
    const submission = prepareSettingsSubmission(draft, id)
    if (queueRest) { footerQueueRef.current = { id, ackRevision: null }; setFooterWaiting(true) }
    dispatch({ type: "BEGIN_SETTINGS_SAVE", submission })
    chrome.runtime.sendMessage({ type: "config.set", id, config_revision: submission.revision, config: submission.patch }, (response) => {
      // This callback only reports transport admission, never persistence.
      if (chrome.runtime.lastError || !response?.ok) dispatch({ type: "SETTINGS_SAVE_UNKNOWN", id, error: chrome.runtime.lastError?.message || response?.error })
    })
  }

  const editComputer = <K extends keyof ComputerDraft>(key: K, value: NonNullable<ComputerDraft[K]>) => {
    const model = state.computerModel
    const committed = key === "pythonMode" ? model?.pythonMode ?? model?.preflight?.pythonMode ?? "isolated" : key === "downloadSource" ? model?.downloadSource ?? "auto" : model?.variant ?? "2b"
    setComputerDraft(current => {
      const next = { ...current }
      if (value === committed) delete next[key]
      else Object.assign(next, { [key]: value })
      return next
    })
    setLocalSaveError(null)
  }
  const computerHasEdits = Object.keys(computerDraft).length > 0
  const canSaveComputer = computerHasEdits && state.connectionState === "connected" && state.computerModel?.modelStatus !== "downloading"
  const saveComputerDraft = async (): Promise<boolean> => {
    const entries = Object.entries(computerDraft) as Array<[keyof ComputerDraft, string]>
    for (const [key, value] of entries) {
      const id = `computer-settings:${crypto.randomUUID()}`
      const field = key === "pythonMode" ? "mode" : key
      const type = key === "pythonMode" ? "computer.model.set_python_mode" : key === "downloadSource" ? "computer.model.set_download_source" : "computer.model.set_variant"
      try {
        await new Promise<void>((resolve, reject) => {
          let done = false
          const finish = (error?: string) => {
            if (done) return
            done = true
            window.clearTimeout(timer)
            chrome.runtime.onMessage.removeListener(listener)
            error ? reject(new Error(error)) : resolve()
          }
          const listener = (message: { id?: string; type?: string; error?: string; [key: string]: unknown }) => {
            if (message.id !== id) return
            if (message.type === "error") finish(message.error || "本机模型设置未保存。")
            else if (message.type === "computer.model.state") {
              if (message[key] === value) finish()
              else finish("本机模型设置回执与所选值不一致，请核对后重试。")
            }
          }
          const timer = window.setTimeout(() => finish("本机模型设置保存结果未知，请核对后重试。"), 15000)
          chrome.runtime.onMessage.addListener(listener)
          try {
            chrome.runtime.sendMessage({ type, source: "settings", id, [field]: value }, response => {
              const error = chrome.runtime.lastError?.message || (response?.ok === false ? response.error : "")
              if (error) finish(error)
            })
          } catch (error) { finish(error instanceof Error ? error.message : String(error)) }
        })
        setComputerDraft(current => {
          if (current[key] !== value) return current
          const next = { ...current }; delete next[key]; return next
        })
      } catch (error) {
        setLocalSaveError(error instanceof Error ? error.message : String(error))
        return false
      }
    }
    setFooterNotice("本机视觉模型设置已保存。")
    return true
  }
  const canSaveConfig = hasEdits && !saveBlocked && draft?.revision === state.configRevision
  const canSaveExternal = externalHasEdits && state.connectionState === "connected" && !externalPending
  const canSaveLocal = localHasEdits && !localSaving
  const canSaveMeeting = !!meetingFooter?.dirty && !meetingFooter.busy
  const canSaveProfile = !!profileFooter?.dirty && !profileFooter.busy
  const canSaveVisual = !!visualFooter?.dirty && !visualFooter.busy
  const canSaveMinutes = !!minutesFooter?.dirty && !minutesFooter.busy
  const canSaveLcu = !!lcuFooter?.dirty && !lcuFooter.busy
  const canSaveMicrophone = !!microphoneFooter?.dirty && !microphoneFooter.busy
  const canSaveEnv = !!envFooter?.dirty && !envFooter.busy
  const canSaveVoicePrefs = voicePrefsHasEdits && state.connectionState === "connected" && !voicePrefsPending
  const canSaveEngine = !!modelState && engineHasEdits && engineReady && state.connectionState === "connected" && !enginePending &&
    (engineSelection !== "local" && engineSelection !== "system" || enginePrivacyAck)
  const footerDisabled = footerWaiting || footerRunning || localSaving || externalPending || voicePrefsPending || enginePending || !(canSaveConfig || canSaveComputer || canSaveExternal || canSaveLocal || canSaveMeeting || canSaveProfile || canSaveMinutes || canSaveVisual || canSaveLcu || canSaveEnv || canSaveMicrophone || canSaveVoicePrefs || canSaveEngine)
  const saveRemaining = async () => {
    if (footerRunningRef.current) return
    footerRunningRef.current = true
    setFooterRunning(true)
    try {
      const profileResult = canSaveProfile ? await profileFooter?.save() : undefined
      if (profileResult === false) return
      const known = profileResult && typeof profileResult === "object" ? profileResult : undefined
      const minutesResult = canSaveMinutes ? await minutesFooter?.save(known) : undefined
      if (minutesResult === false) return
      const afterMinutes = minutesResult && typeof minutesResult === "object" ? minutesResult : known
      if (canSaveVisual && (await visualFooter?.save(afterMinutes)) === false) return
      if (canSaveProfile || canSaveMinutes || canSaveVisual) setFooterNotice("模型配置已保存并核对。")
      if (canSaveComputer && !(await saveComputerDraft())) return
      if (canSaveExternal) handleSaveExternal()
      if (canSaveLocal) await handleSaveLocal()
      if (canSaveMeeting) {
        if ((await meetingFooter?.save()) === false) return
        setFooterNotice("会议转写设置已保存并核对。")
      }
      if (canSaveLcu) lcuFooter?.save()
      if (canSaveEnv) envFooter?.save()
      if (canSaveMicrophone && (await microphoneFooter?.save()) === false) return
      if (canSaveVoicePrefs) handleSaveVoicePrefs()
      if (canSaveEngine) handleSaveEngine()
    } finally {
      footerRunningRef.current = false
      setFooterRunning(false)
    }
  }
  afterConfigRef.current = () => { void saveRemaining() }
  const handleFooterSave = () => {
    setFooterNotice(null)
    if (canSaveConfig) {
      const other = canSaveComputer || canSaveExternal || canSaveLocal || canSaveMeeting || canSaveProfile || canSaveMinutes || canSaveVisual || canSaveLcu || canSaveEnv || canSaveMicrophone || canSaveVoicePrefs || canSaveEngine
      handleSave(other)
      return
    }
    void saveRemaining()
  }

  const stageNested = (key: "acp" | "coding_handoff" | "embedded_terminal", patch: Record<string, unknown>) => {
    const current = (config as unknown as Record<string, unknown>)[key]
    dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { [key]: { ...(current && typeof current === "object" ? current : {}), ...patch } } as Partial<LLMConfig> })
  }

  const submitImmediate = (patch: Partial<LLMConfig>, audit?: SecurityAuditEntry | null, confirmation_phrase?: string) => {
    if (state.connectionState !== "connected" || !state.configRevision) {
      setImmediateNotice("尚未连接到 Companion，这次设置没有发送")
      return
    }
    const pendingPatch = state.settingsSave.pending?.patch
    if ((pendingPatch && Object.keys(patch).some(key => Object.hasOwn(pendingPatch, key))) || state.immediateSave?.status === "sending" || state.immediateSave?.status === "accepted") {
      setImmediateNotice("上一次设置还在等待确认")
      return
    }
    setImmediateNotice(null)
    const id = `settings-save:${crypto.randomUUID()}`
    const revision = state.configRevision
    dispatch({ type: "BEGIN_IMMEDIATE_SAVE", id, revision, patch, audit: audit ?? null })
    chrome.runtime.sendMessage({
      type: "config.set",
      id,
      config_revision: revision,
      config: patch,
      ...(confirmation_phrase ? { confirmation_phrase } : {}),
    }, (response?: { ok?: boolean; error?: string }) => {
      const channel = chrome.runtime.lastError?.message
      if (channel || response?.ok !== true) {
        if (channel || response?.ok === false) dispatch({ type: "SETTINGS_SAVE_UNKNOWN", id, error: channel || response?.error || "这次设置没有发出" })
        return
      }
      dispatch({ type: "IMMEDIATE_SAVE_ACCEPTED", id })
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
    dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { trusted_domains } })
  }

  const handleAutoApprovedDomainsChange = (value: string) => {
    const auto_approved_domains = value
      .split(/\n|,/)
      .map(domain => domain.trim())
      .filter(Boolean)
    dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { auto_approved_domains } })
  }

  // P1-1: arm paths send focused config.set + confirmation_phrase so companion
  // step-up is not UI theater. Disarm needs no phrase. handleSave re-sends
  // already-true flags without phrase (transition-only gate).
  const handleAutoApproveDangerousChange = (checked: boolean) => {
    if (!checked) {
      submitImmediate({ auto_approve_dangerous: false })
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
    submitImmediate({ auto_approve_dangerous: true }, null, phrase)
    setAutoDangerConfirm(false)
    setAutoDangerPhrase("")
    setAutoDangerMsg(null)
  }

  const handleEnterpriseAutoApproveToggle = (checked: boolean) => {
    if (!checked) {
      submitImmediate({ auto_approve_enterprise_tools: false })
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
    submitImmediate({ auto_approve_enterprise_tools: true }, null, phrase)
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
    submitImmediate({ allow_all_schemes: false }, {
      id: `godmode-off-${crypto.randomUUID()}`,
      ts: new Date().toISOString(),
      level: "info",
      tool_name: "allow_all_schemes",
      action: "changed",
      risk_level: "low",
      risk_score: 0,
      source: "ui_phrase_confirmed",
      message: "已关闭协议解锁（恢复协议保护：L1 scheme 硬阻断 + 网页 L2 确认门重新生效）",
    })
  }

  const handleGodModeConfirm = () => {
    if (godmodePhrase.trim() !== SECURITY_ARM_PHRASE) {
      setGodmodeMsg(`确认短语不匹配，请输入「${SECURITY_ARM_PHRASE}」`)
      return
    }
    const phrase = godmodePhrase.trim()
    submitImmediate({ allow_all_schemes: true }, {
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
    }, phrase)
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
    if (toArm.length > 0 && !phrase) return
    submitImmediate(target, {
      id: `autopilot-${crypto.randomUUID()}`,
      ts: new Date().toISOString(),
      level: toArm.length > 0 ? "error" : "info",
      tool_name: "autopilot_packaging",
      action: "changed",
      risk_level: toArm.length > 0 ? "high" : "low",
      risk_score: toArm.length > 0 ? 80 : 0,
      source: "ui_phrase_confirmed",
      message: `${auditMessage} [${[...toArm, ...toDisarm.map((k) => `-${k}`)].join(", ") || "noop"}]`,
    }, toArm.length > 0 ? phrase : undefined)
  }

  const handleAutopilotArmConfirm = () => {
    if (autopilotPhrase.trim() !== SECURITY_ARM_PHRASE) {
      setAutopilotMsg(`请输入「${SECURITY_ARM_PHRASE}」`)
      return
    }
    if (autopilotTierPick === "unattended") {
      if (!unattendedAckDesktop || !unattendedAckSession) {
        setAutopilotMsg("请勾选两项确认（桌面值守静默 + 会话失效）")
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
                "已请求武装无人值守 — 进程内桌面 grant 生效（重启失效）。host_computer 的任务级 L2 与 mid-task re-L2 均静默通过（须 App 已允许坐标）。支付/验证码等硬拒绝仍直接失败、无确认窗。自担 prompt 注入与桌面键鼠风险。",
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
    editLocal("sendShortcut", e.target.value as AgentState["sendShortcut"])
  }

  const handleTest = () => {
    dispatch({ type: "SET_TEST_RESULT", result: "测试中..." })
    dispatch({ type: "SET_TEST_VISION_RESULT", result: null })
    // Pass unsaved UI fields so the probe uses the same protocol/profile/url as Save.
    // api_key only when the user typed a real key; otherwise companion uses stored key.
    const llmOverride: Record<string, string> = {
      base_url: config.base_url,
      model_name: config.model_name,
      native_vision: config.native_vision || "auto",
      protocol: config.protocol === "anthropic" ? "anthropic" : "openai",
      client_header_profile:
        config.protocol === "anthropic" && config.client_header_profile === "claude_code_compat"
          ? "claude_code_compat"
          : "none",
    }
    if (config.api_key && config.api_key !== "***") {
      llmOverride.api_key = config.api_key
    }
    chrome.runtime.sendMessage({ type: "config.test", llmOverride, testVisionFallback: config.vision_enabled }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        dispatch({ type: "SET_TEST_RESULT", result: `连接失败：${chrome.runtime.lastError?.message || response?.error || "Companion 未连接"}` })
      }
    })
  }

  const openKnowledgeSettings = async () => {
    if (!host || knowledgeRoute.current !== settingsRoute) return
    try {
      const opened = await host.openPanelForce("knowledge")
      if (knowledgeRoute.current !== settingsRoute) return
      if (opened) dispatch({ type: "SET_SETTINGS_OPEN", open: false })
      else setImmediateNotice("知识面板尚未打开，请完成当前操作后重试。")
    } catch {
      if (knowledgeRoute.current === settingsRoute) setImmediateNotice("无法打开知识面板，请重试。")
    }
  }

  const pairingLabel = wsPaired === null ? "正在检测连接" : wsPaired === false ? "尚未配对 · 前往连接设置"
    : state.connectionState !== "connected" ? "Companion 未连接 · 前往连接设置" : null
  const pairingControl = pairingLabel && (wsPaired === null
    ? <span className="cm-settings-connection-status">{pairingLabel}</span>
    : <button type="button" onClick={() => selectSettingsPage("connection-pairing")}>{pairingLabel}</button>)

  return (
    <Modal
      open={state.settingsOpen}
      onClose={() => { if (!footerWaiting && !footerRunning) dispatch({ type: "TOGGLE_SETTINGS" }) }}
      overlayStyle={styles.backdrop}
      panelStyle={styles.panel}
      panelClassName="cm-settings-panel"
      ariaLabel="设置"
    >
        <div className="cm-settings-content" onFocusCapture={event => { lastSettingsFocus.current = event.target as HTMLElement }} {...(licenseDoorShouldOpen(state.computerModelLicenseDoor) ? { inert: "" } : {})}>
        <div className="cm-settings-header" style={styles.header}>
          <h3 style={{ margin: 0, fontSize: 15 }}>设置</h3>
          <button type="button" aria-label="关闭设置" className="cm-icon-button" style={styles.closeBtn} disabled={footerWaiting || footerRunning} onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}>✕</button>
        </div>

        <div className="cm-settings-status">
          <span className="cm-sr-only" role="status" aria-live="polite">{[wsPaired === null ? "正在检测连接" : wsPaired === false ? "尚未配对" : "", elevatedTrust ? "有高权限开关已开启" : "", state.immediateSave?.status === "unknown" ? state.immediateSave.error : "", immediateNotice].filter(Boolean).join("；")}</span>
          {(state.immediateSave?.status === "unknown" && state.immediateSave.error) || immediateNotice ? <div role="status">{state.immediateSave?.status === "unknown" && state.immediateSave.error ? state.immediateSave.error : immediateNotice}</div> : null}
          {settingsRoute.view !== "home" && activeDestination !== "connection-pairing" && pairingControl}
          {elevatedTrust && <button type="button" onClick={() => selectSettingsPage("privacy-autonomy")}>有高权限开关已开启 · 查看安全设置</button>}
        </div>
        <div className="cm-settings-layout">
          <nav aria-label="设置分类" className="cm-settings-nav" hidden={!activeCategory}>
            {settingsCategories.map(category => <button type="button" key={category} aria-current={activeCategory === category ? "page" : undefined}
              onClick={() => selectSettingsCategory(category)}>{SETTINGS_CATEGORIES[category].title}</button>)}
          </nav>
          <div ref={settingsBody} className="cm-settings-body" style={styles.body} {...(footerWaiting || footerRunning ? { inert: "" } : {})}>
            {settingsRoute.view !== "home" && <button type="button" className="cm-settings-back" onClick={goBackInSettings}>
              <span aria-hidden="true">‹</span> {settingsRoute.view === "category" ? "返回设置首页" : `返回${SETTINGS_CATEGORIES[settingsRoute.category].title}`}
            </button>}
            <section hidden={settingsRoute.view !== "home"} className="cm-settings-home" aria-labelledby="settings-home-heading">
              <h3 id="settings-home-heading">设置首页</h3>
              {pairingControl && <div className="cm-settings-status cm-settings-home-status">{pairingControl}</div>}
              <SettingsIntentBar onIntent={applySettingsIntent} onOpenSection={selectSettingsPage} onOpenDestination={openWorkspaceDestination}
                active={settingsRoute.view === "home" && settingsInteractive} connected={state.connectionState === "connected" && wsPaired === true}
                knowledgeScope={state.activeThreadId ? { id: state.activeThreadId, mode: state.knowledgeSelectionMode, selected: state.activeKnowledgeIds } : undefined}
                reasoningDisplay={state.showReasoningMode} onReasoningDisplay={mode => dispatch({ type: "SET_SHOW_REASONING_MODE", mode, persist: false })} />
              <div className="cm-settings-categories">
                {settingsCategories.map(category => <SettingsNavRow key={category} {...SETTINGS_CATEGORIES[category]}
                  category={category} onClick={() => selectSettingsCategory(category)} />)}
              </div>
            </section>
            {settingsRoute.view === "category" && <section aria-labelledby="settings-category-heading">
              <header className="cm-settings-page-heading">
                <h3 id="settings-category-heading" tabIndex={-1}>{SETTINGS_CATEGORIES[settingsRoute.category].title}</h3>
              </header>
              {settingsRoute.category === "models" ? <SettingsModelUses active={settingsInteractive} onOpen={id => selectSettingsPage(id, "models")} />
                : <div className="cm-settings-nav-list">
                  {settingsDestinations.filter(id => SETTINGS_DESTINATIONS[id].category === settingsRoute.category).map(id => <SettingsNavRow key={id}
                    title={SETTINGS_DESTINATIONS[id].title} description={SETTINGS_DESTINATIONS[id].description} destination={id} onClick={() => selectSettingsPage(id)} />)}
                </div>}
            </section>}
          <SettingsPage id="connection-pairing" active={activeDestination === "connection-pairing"} badge={wsPaired === false ? (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: 8,
                  color: tokens.warning,
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
              ) : null}>
          {/* --- Connection (P0-2B WS pairing) --- */}
          <div style={styles.field}>
            <label style={styles.label}>
              WS 配对密钥{" "}
              <span style={{
                fontSize: 10,
                fontWeight: 400,
                padding: "1px 6px",
                borderRadius: 8,
                color: wsPaired ? tokens.success : tokens.warning,
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
          </SettingsPage>

          <SettingsPage id="connection-maintenance" active={activeDestination === "connection-maintenance"}>
            <dl className="cm-settings-connection-details">
              <dt>Companion 连接</dt><dd>{connectionLabel(state.connectionState)}</dd>
              <dt>配对状态</dt><dd>{wsPaired === null ? "检测中" : wsPaired ? "已配对" : "尚未配对"}</dd>
              <dt>配置版本</dt><dd>{state.configRevision && !state.configEpochInvalid ? "已同步" : "暂无法确认"}</dd>
            </dl>
            <p className="cm-settings-note">升级 Companion 后重新打开应用，再核对连接和配置状态。</p>
            <button type="button" className="cm-settings-text-link" onClick={() => selectSettingsPage("connection-pairing")}>打开配对设置</button>
          </SettingsPage>

          <SettingsPage id="model-chat" active={activeDestination === "model-chat"}>
          {/* --- LLM Settings --- */}
          <p className="cm-settings-note">默认连接适用于对话、听写纠错、继承默认模型的会议纪要、使用主模型的活动提取和后台任务。启用主模型看图时，附图也使用该连接。</p>

          <div style={styles.field}>
            <label style={styles.label}>API 协议</label>
            <select
              style={styles.input}
              value={config.protocol === "anthropic" ? "anthropic" : "openai"}
              onChange={e => {
                const protocol = e.target.value === "anthropic" ? "anthropic" as const : "openai" as const
                dispatch({
                  type: "EDIT_SETTINGS_DRAFT",
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
            <label style={styles.label}>服务地址（Base URL）</label>
            <input
              style={styles.input}
              type="text"
              value={config.base_url}
              onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { base_url: e.target.value } })}
              placeholder={
                config.protocol === "anthropic"
                  ? "https://api.anthropic.com 或中继 https://host/v1"
                  : "https://api.deepseek.com/v1 或 http://10.x.x.x/v1"
              }
            />
            <div style={styles.helpText}>
              {config.protocol === "anthropic"
                ? "将拼到 /messages；勿混用 /chat/completions。官方 Anthropic 主机不要开下方兼容头。"
                : "支持内网 OpenAI 兼容服务（如 http://10.x.x.x/v1）。云元数据地址仍会被拒绝。"}
            </div>
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
                onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { api_key: e.target.value } })}
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
                      type: "EDIT_SETTINGS_DRAFT",
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
                    type: "EDIT_SETTINGS_DRAFT",
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
                    type: "EDIT_SETTINGS_DRAFT",
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
                    type: "EDIT_SETTINGS_DRAFT",
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
            <label style={styles.label}>模型名称</label>
            <input
              style={styles.input}
              list="model-options"
              type="text"
              value={config.model_name}
              onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { model_name: e.target.value } })}
              placeholder="输入模型名称或从列表选择"
            />
            <datalist id="model-options">
              {modelSuggestions(config.protocol, config.base_url).map(model => <option key={model} value={model} />)}
            </datalist>
            {!config.model_name && state.companionConfig?.model_name && (
              <div style={{ fontSize: 10, color: tokens.textMuted, marginTop: 2 }}>
                当前使用 Companion 全局配置： {state.companionConfig.model_name}
              </div>
            )}
          </div>

          <div style={styles.field}>
            <label htmlFor="reasoning-effort" style={styles.label}>思考强度</label>
            <select id="reasoning-effort" style={styles.input} value={wireEffort ?? ""} disabled={!wireEffort}
              onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { reasoning_effort: e.target.value as ReasoningEffort } })}>
              {!wireEffort && <option value="">由服务决定</option>}
              {effortLevels[support].map(level => <option key={level} value={level}>
                {toggleOnly && level === "high" ? "开启" : { none: "关闭", minimal: "最低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" }[level]}
              </option>)}
            </select>
            <div style={styles.helpText}>
              {!wireEffort ? "当前服务或模型暂未确认支持可调档位。"
                : toggleOnly ? "该型号支持开启或关闭思考。" : `实际发送 ${wireEffort}。思考和正文共用单次输出预算。`}
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>主模型看图</label>
            <select
              style={styles.input}
              value={config.native_vision || "auto"}
              onChange={(e) =>
                dispatch({
                  type: "EDIT_SETTINGS_DRAFT",
                  config: { native_vision: e.target.value as "auto" | "on" | "off" },
                })
              }
            >
              <option value="auto">自动（名称启发式 + 测试连接探测）</option>
              <option value="on">强制走主模型</option>
              <option value="off">关闭（截图走下方视觉轨）</option>
            </select>
            <div style={styles.helpText}>
              网页截图 / analyze_image 过去一律发给「视觉分析」里配置的模型（默认
              Ollama/llava）。主模型本身能看图时应走主模型。点「测试连接」会探测端点是否接受图片。
              {config.native_vision_detected === true
                ? " 最近一次探测：端点接受图片输入。"
                : config.native_vision_detected === false
                  ? " 最近一次探测：未接受图片。"
                  : " 尚未探测。"}
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>温度： {(config.temperature ?? 0.7).toFixed(1)}</label>
            <input
              style={{ width: "100%" }}
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={config.temperature}
              onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { temperature: parseFloat(e.target.value) } })}
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="chat-output-limit" style={styles.label}>单次输出上限（Token）</label>
            <input
              id="chat-output-limit"
              style={styles.input}
              type="number"
              min={0}
              max={CHAT_OUTPUT_LIMIT_MAX}
              step={1}
              placeholder="自动"
              value={config.max_tokens || ""}
              onChange={e => {
                const input = e.currentTarget
                if (input.validity.badInput) return
                const value = input.value === "" ? 0 : input.valueAsNumber
                if (isChatOutputLimit(value)) dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { max_tokens: value } })
              }}
            />
            <div style={styles.helpText}>
              {spec?.output && spec.contextWindow ? <>{spec.provider} 公布的单次输出上限为 {spec.output.toLocaleString("zh-CN")} Token，上下文窗口为 {spec.contextWindow.toLocaleString("zh-CN")} Token。 <a href={spec.source} target="_blank" rel="noreferrer">官方规格</a></>
                : "当前服务与模型组合尚未收录。对话使用最多 32,768 Token 的兼容预算。"}
              {" "}按当前设置，首次请求预算为 {budget.preferred.toLocaleString("zh-CN")} Token，恢复截断回复时最多可请求 {budget.ceiling.toLocaleString("zh-CN")} Token。留空使用自动预算，思考强度不会改变厂商上限。
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>上下文窗口（Token）</label>
            <input
              style={styles.input}
              type="number"
              value={config.context_window}
              onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { context_window: parseInt(e.target.value) || 512000 } })}
              min={1024}
              max={1000000}
              step={1024}
            />
            <div style={styles.helpText}>
              {contextWindowHelpText(config.context_window)}
            </div>
          </div>

              <div style={styles.field}>
                <div style={styles.helpText}>
                  上下文窗口过大时，长对话压缩会来不及触发（新默认 512000 是 Agent 工作预算）。建议按模型真实上限设置。
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
                dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { context_compaction: v } })
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
                      type: "EDIT_SETTINGS_DRAFT",
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
          </SettingsPage>

          <SettingsPage id="model-vision" active={activeDestination === "model-vision"}>
                    {/* --- Vision Model Settings --- */}

          <div style={styles.field}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={config.vision_enabled || false}
                onChange={e => {
                  const on = e.target.checked
                  dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { vision_enabled: on } })
                }}
              />
              启用截图视觉分析
            </label>
            <div style={styles.helpText}>{VISION_COPY.sectionHelp}</div>
            <div style={{ ...styles.helpText, marginTop: 4 }}>{VISION_COPY.railDifferentiator}</div>
          </div>

          {config.vision_enabled && (() => {
            const canReuse = shouldOfferVisionReuse(config)
            const reusing = canReuse && config.vision_reuse_main_model !== false
            return (
              <>
                <div style={styles.field}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={reusing}
                      disabled={!canReuse}
                      onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { vision_reuse_main_model: e.target.checked } })}
                    />
                    {VISION_COPY.reuseMain}
                  </label>
                  <div style={styles.helpText}>
                    {!canReuse ? VISION_COPY.unavailableHelp : reusing ? VISION_COPY.reuseHelp : VISION_COPY.separateHelp}
                  </div>
                  {reusing && (
                    <div style={{ ...styles.helpText, color: tokens.success, marginTop: 4 }}>
                      当前使用：{config.model_name} · {extractHostname(config.base_url)}
                    </div>
                  )}
                </div>
                <fieldset
                  disabled={reusing}
                  aria-label="独立视觉模型配置"
                  style={{ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: reusing ? 0.5 : 1 }}
                >
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
                    onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { vision_api_key: e.target.value } })}
                    placeholder={
                      state.companionConfig?.vision_api_key_set
                        ? "（已配置，留空保持不变；输入新值覆盖）"
                        : "本地 Ollama 可留空；云端需填写（或与主模型相同后保存继承）"
                    }
                  />
                </div>
                <div style={styles.helpText}>
                  本地 loopback 可留空；非本机端点需真实 Key。与主模型 URL/Model 相同时，保存会继承主 Key。
                </div>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>视觉协议</label>
                <select style={styles.input} value={config.vision_protocol || "openai"} onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { vision_protocol: e.target.value as "openai" | "anthropic", vision_use_main_auth: false } })}>
                  <option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic Messages</option>
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>服务地址（Base URL）</label>
                <input
                  style={styles.input}
                  type="text"
                  value={config.vision_base_url || "http://localhost:11434/v1"}
                  onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { vision_base_url: e.target.value } })}
                  placeholder="http://localhost:11434/v1 或云端 OpenAI 兼容端点"
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>模型名称</label>
                <input
                  style={styles.input}
                  list="vision-model-options"
                  type="text"
                  value={config.vision_model_name || ""}
                  onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { vision_model_name: e.target.value } })}
                  placeholder="输入模型名称或从列表选择"
                />
                <datalist id="vision-model-options">
                  <option value="llava:7b" />
                  <option value="llava:13b" />
                  <option value="minicpm-v" />
                  <option value="qwen2.5vl:3b" />
                  <option value="moondream2" />
                  <option value="gpt-4o" />
                  <option value="glm-4.6v" />
                </datalist>
              </div>

                </fieldset>

              <div style={styles.field}>
                <label style={styles.label}>
                  超时时间: {Math.round((config.vision_timeout_ms || 30000) / 1000)}s
                </label>
                <input
                  style={{ width: "100%" }}
                  type="range"
                  min={10000}
                  max={60000}
                  step={5000}
                  value={config.vision_timeout_ms || 30000}
                  onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { vision_timeout_ms: parseInt(e.target.value) } })}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>降级策略</label>
                <select
                  style={styles.select}
                  value={config.vision_fallback || "metadata"}
                  onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { vision_fallback: e.target.value as "metadata" | "passthrough" | "error" } })}
                >
                  <option value="metadata">{VISION_COPY.fallbackMetadata}</option>
                  <option value="passthrough">{VISION_COPY.fallbackPassthrough}</option>
                  <option value="error">{VISION_COPY.fallbackError}</option>
                </select>
                <div style={styles.helpText}>
                  视觉模型不可用时的处理方式：仅元数据 = 发送页面标题和尺寸信息
                </div>
              </div>
              <p style={styles.helpText}>保存后，「测试模型连接」会验证当前使用的视觉模型。</p>
              </>
            )
          })()}
          </SettingsPage>

          <SettingsPage id="model-profiles" active={activeDestination === "model-profiles"}>
            <ModelCenterControls active={activeDestination === "model-profiles" && settingsInteractive} onFooterSave={reportProfileFooter} />
          </SettingsPage>

          <SettingsPage id="model-meeting-visual" active={activeDestination === "model-meeting-visual"}>
            <ModelCenterControls active={activeDestination === "model-meeting-visual" && settingsInteractive} mode="visual" onFooterSave={reportVisualFooter} />
          </SettingsPage>

          <SettingsPage id="model-meeting-minutes" active={activeDestination === "model-meeting-minutes"}>
            <ModelCenterControls active={activeDestination === "model-meeting-minutes" && settingsInteractive} mode="meeting" onFooterSave={reportMinutesFooter} />
          </SettingsPage>

          <SettingsPage id="model-meeting-transcribe" active={activeDestination === "model-meeting-transcribe"}>
            <MeetingExternalAsrSettings active={activeDestination === "model-meeting-transcribe" && settingsInteractive} onFooterSave={reportMeetingFooter} />
          </SettingsPage>

          <SettingsPage id="model-activity" active={activeDestination === "model-activity"}>
            <p className="cm-settings-note">在活动记录的采集设置中选择 OCR、视觉或本机模型。启用图像处理前会提示核对所选目标。</p>
            <button type="button" className="cm-settings-text-link" onClick={() => openWorkspaceDestination("activity")}>打开活动记录</button>
          </SettingsPage>

          <SettingsPage id="model-background" active={activeDestination === "model-background"}>
            <div className="cm-settings-nav-list">
              <SettingsNavRow title="对话压缩与滚动摘要" description="使用对话模型处理较早的对话轮次。" onClick={() => selectSettingsPage("model-chat")} />
              <SettingsNavRow title="会话要点与标签" description="按会话索引规则使用对话模型提取要点与标签。" onClick={() => selectSettingsPage("data-index", "models")} />
            </div>
          </SettingsPage>

          <SettingsPage id="input-display" active={activeDestination === "input-display"}>
          <div style={styles.field}>
            <label htmlFor="settings-reasoning-display" style={styles.label}>展开方式</label>
            <select
              style={styles.input}
              id="settings-reasoning-display"
              value={localValues.showReasoningMode || "auto_live"}
              disabled={localSaving}
              onChange={(e) => {
                const v = e.target.value
                if (v === "always_collapsed" || v === "auto_live" || v === "always_open") {
                  editLocal("showReasoningMode", v)
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
          </SettingsPage>

          <SettingsPage id="input-shortcuts" active={activeDestination === "input-shortcuts"}>
          <div style={styles.field}>
            <label htmlFor="settings-send-shortcut" style={styles.label}>发送快捷键</label>
            <select
              style={styles.select}
              id="settings-send-shortcut"
              value={localValues.sendShortcut || "Enter"}
              disabled={localSaving}
              onChange={handleShortcutChange}
            >
              <option value="Enter">Enter</option>
              <option value="Cmd+Enter">Cmd+Enter</option>
              <option value="Ctrl+Enter">Ctrl+Enter</option>
            </select>
          </div>
              <div style={{ marginTop: 12, fontSize: 12, color: tokens.textSecondary }}>
                <div style={{ marginBottom: 4, fontWeight: 500 }}>按住热键听写（D2 · 默认关）</div>
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    cursor: "pointer",
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ marginTop: 2 }}
                    checked={localValues.dictationHotkeyEnabled === true}
                    disabled={localSaving}
                    onChange={(e) => editLocal("dictationHotkeyEnabled", e.target.checked)}
                  />
                  <span>
                    启用按住说话
                    <br />
                    <span style={{ color: tokens.textMuted, fontSize: 11 }}>
                      按住 ≥300ms 松手转写；短按静默丢弃。300ms 内连按两次进入锁定（再按或 Esc 结束）。仅进草稿、不自动发送。需 Side Panel
                      打开；页面可编辑框内同一热键会插入到该框。禁止 bare Fn / Win+V。会议录音中不可用。默认关。
                    </span>
                  </span>
                </label>
                <div style={{ marginTop: 8, fontSize: 11, color: tokens.textSecondary }}>
                  <div style={{ marginBottom: 2 }}>组合键（按键盘录制或点预设）</div>
                  <HotkeyCaptureField
                    active={activeDestination === "input-shortcuts" && settingsInteractive}
                    value={localValues.dictationHotkeyChord || DICTATION_HOTKEY_DEFAULT_CHORD}
                    disabled={localSaving || !localValues.dictationHotkeyEnabled}
                    onChange={(chord) => editLocal("dictationHotkeyChord", chord)}
                  />
                </div>
                <label style={{ display: "flex", gap: 8, marginTop: 8, fontSize: 12, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={localValues.voiceSoundEffects !== false}
                    disabled={localSaving}
                    onChange={(e) => editLocal("voiceSoundEffects", e.target.checked)}
                  />
                  听写状态音效（开始/停止/完成；误触静默）
                </label>
              </div>
          </SettingsPage>

          <SettingsPage id="input-dictation" active={activeDestination === "input-dictation"}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="chat-dictation-language">聊天听写语言</label>
            <select id="chat-dictation-language" data-testid="chat-dictation-language" style={styles.select}
              value={localValues.chatDictationLanguage}
              disabled={localSaving}
              onChange={e => editLocal("chatDictationLanguage", normalizeChatDictationLanguage(e.target.value))}>
              <option value="zh-CN">中文（普通话）</option>
              <option value="en-US">English (US)</option>
            </select>
            {state.voiceModel?.sttEngine === "external" && state.voiceModel.external?.style === "deepseek" && (
              <p className="cm-settings-note">当前 DeepSeek 转写服务自行识别录音语言。</p>
            )}
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
                checked={localValues.voiceInputEnabled !== false}
                disabled={localSaving}
                onChange={(e) => editLocal("voiceInputEnabled", e.target.checked)}
              />
              在输入框显示麦克风（听写进草稿，不自动发送）
            </label>

            <div style={{ marginTop: 10, fontSize: 12, color: tokens.textSecondary }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  marginBottom: 10,
                  cursor: "pointer",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                <input
                  type="checkbox"
                  style={{ marginTop: 2 }}
                  checked={localValues.voiceRealtimeStreaming !== false}
                  disabled={localSaving}
                  onChange={(e) => {
                    editLocal("voiceRealtimeStreaming", e.target.checked)
                    if (e.target.checked) editLocal("voiceDictationMode", "continuous")
                  }}
                />
                <span>
                  <strong>实时出字</strong>
                  （字级 / 近实时）
                  <br />
                  <span style={{ color: tokens.textMuted, fontSize: 11 }}>
                    浏览器听写：Web Speech 字级 interim。本机 Whisper（连续 + 本开关）：PCM
                    流式上传 + 约 8s 窗口内渐进重解码假设（poll 按上次推断耗时自适应）；窗口结束定稿；非
                    decoder token 流。开启时会切到连续听写。
                  </span>
                </span>
              </label>
              {localValues.voiceRealtimeStreaming !== false &&
                state.voiceModel?.sttEngine === "local" && (
                  <div
                    style={{
                      marginBottom: 10,
                      padding: "6px 8px",
                      fontSize: 11,
                      lineHeight: 1.4,
                      background: tokens.successSoft,
                      border: `1px solid ${tokens.success}`,
                      borderRadius: 6,
                      color: tokens.success,
                    }}
                  >
                    本机渐进假设流已开：说话中显示临时字，约每 8s
                    定稿一段；poll 随模型耗时自适应（medium 可能更慢）。更丝滑可改用浏览器听写。
                  </div>
                )}
              <div style={{ marginBottom: 4, fontWeight: 500 }}>听写形态</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="voiceDictationMode"
                  checked={(localValues.voiceDictationMode || "classic") === "classic"}
                  disabled={localSaving}
                  onChange={() => editLocal("voiceDictationMode", "classic")}
                />
                经典短听（默认 · 最长约 45 秒）
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="voiceDictationMode"
                  checked={localValues.voiceDictationMode === "continuous"}
                  disabled={localSaving}
                  onChange={() => editLocal("voiceDictationMode", "continuous")}
                />
                连续听写（可选 · 最长默认 15 分钟）
              </label>
              <div style={{ marginTop: 4, fontSize: 11, color: tokens.textMuted, lineHeight: 1.4 }}>
                浏览器：自动续听 + 字级 interim；本机：实时出字开时约 8 秒一段，否则约 45
                秒一段。仅进草稿、不自动发送。首次连续听写需隐私 v3。
              </div>
            </div>
          </div>
          <div className="cm-settings-nav-list">
            <SettingsNavRow title="听写引擎" description="查看或更换语音转写模型。" onClick={() => selectSettingsPage("input-dictation-engine")} />
            <SettingsNavRow title="听写纠错" description="管理转写文本的模型纠错。" onClick={() => selectSettingsPage("input-asr-refiner")} />
          </div>
          </SettingsPage>

          <SettingsPage id="input-asr-refiner" active={activeDestination === "input-asr-refiner"}>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  marginTop: 10,
                  cursor: "pointer",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                <input
                  type="checkbox"
                  style={{ marginTop: 2 }}
                  checked={localValues.asrRefinerEnabled === true}
                  disabled={localSaving}
                  onChange={(e) => editLocal("asrRefinerEnabled", e.target.checked)}
                />
                <span>
                  <strong>ASR 纠错</strong>
                  （停后可选；默认关）
                  <br />
                  <span style={{ color: tokens.textMuted, fontSize: 11 }}>
                    将把<strong>转写文本</strong>发给当前 Companion 模型做极保守纠错（不润色、不自动发送）；需已配置
                    LLM。首次听写前若未确认隐私 v3 将弹出说明。当前模型：
                    {state.companionConfig?.model_name || "（未连接/未配置）"}
                  </span>
                </span>
              </label>
          </SettingsPage>

          <SettingsPage id="input-dictation-engine" active={activeDestination === "input-dictation-engine"}>
          <div style={styles.field}>
            {/* Path B M0: 听写方式 progressive disclosure (UI draft until ready + enable) */}
            {(() => {
              const voiceModel = state.voiceModel
              const progress = state.voiceModelProgress
              const committedLocal = voiceModel?.sttEngine === "local"
              const committedSystem = voiceModel?.sttEngine === "system"
              const committedExternal = voiceModel?.sttEngine === "external"
              const externalView = voiceModel?.external
              const showLocalPanel = engineDraft === "local"
              // #259: system option only exists on win32 with the probe mirror.
              const systemStateMirror = state.voiceSystemState
              const systemProbeWin32 = systemStateMirror?.platform === "win32"
              const systemProbeGreen =
                systemProbeWin32 &&
                systemStateMirror?.helper?.ok === true &&
                systemStateMirror?.systemSpeech?.available === true
              const showSystemPanel = engineDraft === "system"
              const clearVoiceErr = () =>
                dispatch({ type: "SET_VOICE_MODEL_ERROR", error: null })
              /** settings → SW → WS; always surface SW refusals into voiceModelError. */
              const sendVoice = (
                msg: Record<string, unknown>,
                opts?: { onOk?: () => void; onFail?: () => void },
              ) => {
                try {
                  chrome.runtime.sendMessage({ ...msg, source: "settings" }, (resp: unknown) => {
                    const lastErr =
                      typeof chrome.runtime.lastError?.message === "string"
                        ? chrome.runtime.lastError.message
                        : null
                    const parsed = parseVoiceSettingsSendResponse(resp, lastErr)
                    if (parsed.ok === false) {
                      opts?.onFail?.()
                      dispatch({ type: "SET_VOICE_MODEL_ERROR", error: parsed.error })
                      return
                    }
                    opts?.onOk?.()
                  })
                } catch (e: unknown) {
                  opts?.onFail?.()
                  const msgText = e instanceof Error ? e.message : String(e)
                  dispatch({
                    type: "SET_VOICE_MODEL_ERROR",
                    error: msgText || VOICE_ERR_STATE_TIMEOUT,
                  })
                }
              }
              const proposedId = voiceModel?.recommendedModelId
              const binaryProgress = state.voiceBinaryProgress
              const downloadingBinary = voiceModel?.acceleration?.downloadingBackend ?? binaryProgress?.backend
              const modelDownloading = !!voicePendingDownload ||
                Object.values(voiceModel?.models ?? {}).some((entry) => entry.status === "downloading") ||
                voiceModel?.diarizeModel?.status === "downloading"
              const recommendedId: WhisperSettingsModelId = WHISPER_SETTINGS_MODEL_IDS.find(id => id === proposedId) ?? RECOMMENDED_WHISPER_MODEL_ID
              const activeId = voiceModel?.localModelId || recommendedId
              const recEntry = voiceModel?.models?.[recommendedId]
              const recReady = recEntry?.status === "ready"
              const activeReady = voiceModel?.models?.[activeId]?.status === "ready"
              const canEnableLocal = recReady || activeReady
              const privacyEngine: "browser" | "local" | "system" =
                engineDraft === "local" || committedLocal
                  ? "local"
                  : engineDraft === "system" || committedSystem
                    ? "system"
                    : "browser"

              const renderModelRow = (modelId: WhisperSettingsModelId, isRecommended: boolean) => {
                const entry = voiceModel?.models?.[modelId]
                const status = entry?.status || "absent"
                const pendingStart = voicePendingDownload === modelId
                const downloading =
                  status === "downloading" ||
                  pendingStart ||
                  (progress?.modelId === modelId && status !== "ready")
                const pct = pendingStart
                  ? 0
                  : downloading && progress?.modelId === modelId
                    ? progressPercent(progress.receivedBytes, progress.totalBytes)
                    : null
                const isActive = committedLocal && activeId === modelId
                return (
                  <div
                    key={modelId}
                    style={{
                      marginTop: isRecommended ? 8 : 6,
                      padding: "8px 8px 6px",
                      borderRadius: 6,
                      border: `1px solid ${tokens.border}`,
                      background: isRecommended ? tokens.bgMuted : tokens.bgElevated,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap" as const,
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ fontWeight: isRecommended ? 600 : 500, color: tokens.text }}>
                        {isRecommended ? `${RECOMMENDED_ROW_PREFIX}: ${modelId}` : modelId}
                        {modelId === "large-v3-turbo" ? (
                          <div style={{ fontSize: 10, color: tokens.textMuted, marginTop: 2 }}>
                            仅终稿识别（无实时出字）；速度取决于识别后端
                          </div>
                        ) : null}
                        {isActive ? " · 活动" : ""}
                      </span>
                      <span style={{ width: "100%", fontSize: 10, color: tokens.textMuted }}>
                        {whisperModelMetaLine(modelId)}
                        {voiceModel?.modelPrewarm &&
                        voiceModel.prewarmStatus === "fail" &&
                        isActive
                          ? " · 预热失败"
                          : ""}
                      </span>
                      <span style={{ color: tokens.textMuted, fontSize: 11 }}>
                        {pendingStart
                          ? VOICE_STATUS_STARTING_DOWNLOAD
                          : modelStatusLabel(status)}
                        {typeof entry?.bytesOnDisk === "number" && entry.bytesOnDisk > 0
                          ? ` · ${(entry.bytesOnDisk / (1024 * 1024)).toFixed(0)} MB`
                          : ""}
                      </span>
                      <span style={{ flex: 1 }} />
                      {downloading ? (
                        <button
                          type="button"
                          style={styles.secondaryBtn}
                          disabled={pendingStart}
                          onClick={() => {
                            clearVoiceErr()
                            setVoicePendingDownload(null)
                            sendVoice({ type: "voice.model.cancel", modelId })
                          }}
                        >
                          {BTN_CANCEL}
                        </button>
                      ) : status === "ready" ? (
                        <>
                          {!isActive && (
                            <button
                              type="button"
                              style={styles.secondaryBtn}
                              onClick={() => {
                                clearVoiceErr()
                                sendVoice({ type: "voice.model.set_active", modelId })
                              }}
                            >
                              {BTN_SET_ACTIVE}
                            </button>
                          )}
                          <button
                            type="button"
                            style={styles.secondaryBtn}
                            onClick={() => {
                              clearVoiceErr()
                              sendVoice({ type: "voice.model.delete", modelId })
                            }}
                          >
                            {BTN_DELETE}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          style={styles.secondaryBtn}
                          onClick={() => {
                            clearVoiceErr()
                            setVoicePendingDownload(modelId)
                            // Indeterminate bar until companion progress arrives.
                            dispatch({
                              type: "SET_VOICE_MODEL_PROGRESS",
                              progress: {
                                modelId,
                                file: "",
                                receivedBytes: 0,
                                totalBytes: 0,
                              },
                            })
                            sendVoice(
                              { type: "voice.model.download", modelId },
                              {
                                onFail: () => {
                                  setVoicePendingDownload(null)
                                  dispatch({ type: "SET_VOICE_MODEL_PROGRESS", progress: null })
                                },
                              },
                            )
                          }}
                        >
                          {BTN_DOWNLOAD}
                        </button>
                      )}
                    </div>
                    {(pct !== null || pendingStart) && (
                      <div style={{ marginTop: 6 }}>
                        <div
                          style={{
                            height: 6,
                            borderRadius: 3,
                            background: tokens.border,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: pendingStart
                                ? "18%"
                                : `${pct ?? 0}%`,
                              background: tokens.accent,
                              transition: "width 0.2s ease",
                              // Soft pulse while waiting for first progress bytes.
                              opacity: pendingStart ? 0.65 : 1,
                            }}
                          />
                        </div>
                        <div style={{ fontSize: 10, color: tokens.textMuted, marginTop: 2 }}>
                          {pendingStart
                            ? VOICE_STATUS_STARTING_DOWNLOAD
                            : `${progress?.file ? `${progress.file} · ` : ""}${pct ?? 0}%`}
                        </div>
                      </div>
                    )}
                    {entry?.error && (
                      <div style={{ fontSize: 11, color: tokens.danger, marginTop: 4 }}>
                        {modelProbeErrorLabel(entry.error) || entry.error}
                      </div>
                    )}
                  </div>
                )
              }

              return (
                <>
                  <MicrophoneDeviceSelect onFooterSave={reportMicrophoneFooter} />
                  <div style={{ marginTop: 12 }}>
                    <div style={{ ...styles.label, marginBottom: 6 }}>{ENGINE_SECTION_LABEL}</div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        cursor: "pointer",
                        fontSize: 13,
                        marginBottom: 6,
                      }}
                    >
                      <input
                        type="radio"
                        name="voice-stt-engine"
                        checked={engineDraft === "browser"}
                        onChange={() => setEngineDraft("browser")}
                        style={{ marginTop: 2 }}
                      />
                      <span>
                        <span style={{ fontWeight: 500 }}>{ENGINE_BROWSER_LABEL}</span>
                        <span style={{ color: tokens.textMuted, fontSize: 12 }}> — {ENGINE_BROWSER_HINT}</span>
                      </span>
                    </label>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        cursor: "pointer",
                        fontSize: 13,
                        marginBottom: 6,
                      }}
                    >
                      <input
                        type="radio"
                        name="voice-stt-engine"
                        checked={engineDraft === "external"}
                        onChange={() => setEngineDraft("external")}
                        style={{ marginTop: 2 }}
                      />
                      <span>
                        <span style={{ fontWeight: 500 }}>外部转写</span>
                        <span style={{ color: tokens.textMuted, fontSize: 12 }}> — 聊天语音发到你填写的地址，不用于会议</span>
                      </span>
                    </label>
                    {engineDraft === "external" ? (
                      <div style={{ margin: "8px 0 10px", fontSize: 12, color: tokens.textMuted, display: "grid", gap: 8 }}>
                        <div>{externalLimitCopy(externalView?.limitNote ?? "deepseek-docs")}</div>
                        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <input
                            type="checkbox"
                            checked={externalPrivacyAck}
                            onChange={(e) => setExternalPrivacyAck(e.target.checked)}
                            style={{ marginTop: 2 }}
                          />
                          <span>{externalPrivacyCopy()}</span>
                        </label>
                        <label style={{ display: "grid", gap: 4 }}>
                          接口
                          <select
                            value={externalStyleDraft ?? externalView?.style ?? "deepseek"}
                            onChange={(e) => setExternalStyleDraft(e.target.value === "openai" ? "openai" : "deepseek")}
                          >
                            <option value="deepseek">DeepSeek 官方转写</option>
                            <option value="openai">OpenAI 兼容转写</option>
                          </select>
                        </label>
                        <label style={{ display: "grid", gap: 4 }}>
                          地址
                          <input
                            value={externalBaseDraft ?? externalView?.baseUrl ?? ""}
                            onChange={(e) => setExternalBaseDraft(e.target.value)}
                            placeholder="留空使用该接口的默认地址"
                          />
                        </label>
                        {(externalStyleDraft ?? externalView?.style ?? "deepseek") === "openai" ? (
                          <label style={{ display: "grid", gap: 4 }}>
                            模型
                            <input
                              value={externalModelDraft ?? externalView?.model ?? "whisper-1"}
                              onChange={(e) => setExternalModelDraft(e.target.value)}
                            />
                          </label>
                        ) : null}
                        <label style={{ display: "grid", gap: 4 }}>
                          密钥
                          <input
                            type="password"
                            autoComplete="off"
                            value={externalKeyDraft}
                            onChange={(e) => setExternalKeyDraft(e.target.value)}
                            placeholder={externalView?.keyConfigured ? "已保存，留空表示不改" : "只在这台电脑的 Companion 配置里保存"}
                          />
                        </label>
                        <div>{externalView?.keyConfigured ? "密钥已配置，侧栏不显示原文。" : "尚未保存密钥。"}</div>
                        <div>{externalKeySaveCopy()}</div>
                        <div>{externalRefineCopy()}</div>
                        <div>{externalCancelCopy(false)} {externalCancelCopy(true)}</div>
                        <button
                          type="button"
                          style={styles.secondaryBtn}
                          onClick={handleSaveExternal}
                          disabled={externalPending || state.connectionState !== "connected" || !externalHasEdits}
                        >
                          保存外部转写
                        </button>
                        <button
                          type="button"
                          style={styles.secondaryBtn}
                          disabled={enginePending || committedExternal || !externalPrivacyAck || !externalView?.keyConfigured || externalHasEdits}
                          onClick={() => handleSaveEngine(true)}
                        >
                          {committedExternal ? "外部转写已启用" : "启用外部转写"}
                        </button>
                      </div>
                    ) : null}
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="radio"
                        name="voice-stt-engine"
                        checked={engineDraft === "local"}
                        onChange={() => {
                          // Draft only — never set_engine until ready + explicit enable.
                          setEngineDraft("local")
                        }}
                        style={{ marginTop: 2 }}
                      />
                      <span>
                        <span style={{ fontWeight: 500 }}>{ENGINE_LOCAL_LABEL}</span>
                        <span style={{ color: tokens.textMuted, fontSize: 12 }}> — {ENGINE_LOCAL_HINT}</span>
                      </span>
                    </label>
                    {systemProbeWin32 && (
                      <label
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          cursor: "pointer",
                          fontSize: 13,
                        }}
                      >
                        <input
                          type="radio"
                          name="voice-stt-engine"
                          checked={engineDraft === "system"}
                          onChange={() => {
                            // Draft only — enable via the probe-gated button below.
                            setEngineDraft("system")
                          }}
                          style={{ marginTop: 2 }}
                        />
                        <span>
                          <span style={{ fontWeight: 500 }}>{ENGINE_SYSTEM_LABEL}</span>
                          <span style={{ color: tokens.textMuted, fontSize: 12 }}> — {ENGINE_SYSTEM_HINT}</span>
                        </span>
                      </label>
                    )}
                  </div>

                  {/* #259: 引擎链路状态 — 常驻三行（本机/浏览器/系统），spec §3.3。
                      不藏进任一引擎面板；非 win32 第三行诚实 unavailable。 */}
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>引擎链路状态</div>
                    {engineChainRows({
                      voiceModel,
                      browserSupport: BROWSER_STT_SUPPORT,
                      systemState: systemStateMirror,
                    }).map((row) => (
                      <div
                        key={row.label}
                        style={{ fontSize: 11, color: tokens.textMuted, marginTop: 2 }}
                      >
                        {row.ok ? "✓" : "✗"} {row.label}：{row.detail}
                      </div>
                    ))}
                  </div>

                  {showLocalPanel && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: "10px 10px 8px",
                        borderRadius: 8,
                        border: `1px solid ${tokens.border}`,
                        background: tokens.bgMuted,
                      }}
                    >
                      {voiceModel === null && (
                        <div style={{ ...styles.helpText, marginTop: 0 }}>
                          {VOICE_STATUS_QUERYING}
                        </div>
                      )}

                      {voiceModel?.hardware && <div style={styles.helpText}>
                        本机：{voiceModel.hardware.cpu} · {voiceModel.hardware.logicalCores} 逻辑核心 · {voiceModel.hardware.memoryGB} GB 内存。
                        建议仅参考硬件资源；实际速度取决于识别后端。模型需自行下载和启用。
                      </div>}
                      <WhisperAccelerationSettings
                        acceleration={voiceModel?.acceleration}
                        progress={binaryProgress}
                        error={state.voiceBinaryError}
                        modelDownloading={modelDownloading}
                        onInstall={(backend) => {
                          clearVoiceErr()
                          sendVoice({ type: "voice.binary.download", backend })
                        }}
                        onCancel={(backend) => {
                          clearVoiceErr()
                          sendVoice({ type: "voice.binary.cancel", backend })
                        }}
                      />
                      {renderModelRow(recommendedId, true)}

                      <button
                        type="button"
                        style={{
                          marginTop: 8,
                          fontSize: 12,
                          border: "none",
                          background: "transparent",
                          color: tokens.textSecondary,
                          cursor: "pointer",
                          padding: 0,
                        }}
                        onClick={() => setOtherWhisperOpen((o) => !o)}
                      >
                        {OTHER_MODELS_TOGGLE} {otherWhisperOpen ? "▾" : "▸"}
                      </button>
                      {otherWhisperOpen &&
                        WHISPER_SETTINGS_MODEL_IDS.filter(id => id !== recommendedId).map(id => renderModelRow(id, false))}

                      {voiceModel && (
                        <>
                          <div style={{ ...styles.helpText, marginTop: 8 }}>
                            {formatDiskUsage(voiceModel.diskUsedMB, voiceModel.diskBudgetMB)}（含说话人分离模型）
                          </div>
                          <div style={{ ...styles.helpText, marginTop: 2 }}>
                            {binaryStatusLine(voiceModel.binary)}
                          </div>
                          {(canDownloadWhisperBinary(voiceModel.binary) || downloadingBinary === "cpu") && (
                            <div style={{ marginTop: 6 }}>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                                <button
                                  type="button"
                                  style={styles.secondaryBtn}
                                  disabled={!!voiceModel.acceleration && !!downloadingBinary}
                                  onClick={() => {
                                    clearVoiceErr()
                                    sendVoice({ type: "voice.binary.download" })
                                  }}
                                >
                                  安装本机听写组件
                                </button>
                                <button
                                  type="button"
                                  style={styles.secondaryBtn}
                                  disabled={(downloadingBinary !== undefined && downloadingBinary !== "cpu") || binaryProgress?.phase === "cancelling"}
                                  onClick={() => {
                                    clearVoiceErr()
                                    sendVoice({ type: "voice.binary.cancel" })
                                  }}
                                >
                                  取消安装
                                </button>
                              </div>
                              <div style={{ ...styles.helpText, marginTop: 4 }}>
                                macOS：优先用安装包内置组件；若缺失则从本机 Homebrew whisper-cpp
                                拷贝（需已 brew install whisper-cpp）。Windows 为 HTTPS 自动下载。
                              </div>
                            </div>
                          )}
                          {binaryProgress?.backend === "cpu" && (
                            <div style={{ ...styles.helpText, marginTop: 4 }}>
                              组件下载：{binaryProgress.phase === "cancelling" ? "正在取消安装" : binaryProgress.phase ?? "正在准备安装"}
                              {binaryProgress.totalBytes
                                ? ` ${progressPercent(binaryProgress.receivedBytes ?? 0, binaryProgress.totalBytes)}%`
                                : ""}
                              {binaryProgress.file && ` · ${binaryProgress.file}`}
                            </div>
                          )}
                          {state.voiceBinaryError?.backend === "cpu" && (
                            <div role="alert" style={{ ...styles.helpText, marginTop: 4, color: tokens.danger }}>
                              {state.voiceBinaryError.message}
                            </div>
                          )}

                          <label
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 8,
                              marginTop: 10,
                              cursor: "pointer",
                              fontSize: 12,
                              lineHeight: 1.4,
                            }}
                          >
                            <input
                              type="checkbox"
                              style={{ marginTop: 2 }}
                              checked={voicePrefsDraft.autoFallbackToBrowser ?? (voiceModel.autoFallbackToBrowser !== false)}
                              onChange={(e) => setVoicePrefsDraft(current => ({ ...current, autoFallbackToBrowser: e.target.checked }))}
                            />
                            <span>
                              <strong>{VOICE_AUTO_FALLBACK_LABEL}</strong>
                              <br />
                              <span style={{ color: tokens.textMuted, fontSize: 11 }}>
                                {VOICE_AUTO_FALLBACK_HINT}
                              </span>
                            </span>
                          </label>
                          <label style={{ display: "flex", gap: 8, marginTop: 8, fontSize: 12, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={voicePrefsDraft.modelPrewarm ?? (voiceModel.modelPrewarm === true)}
                              onChange={(e) => setVoicePrefsDraft(current => ({ ...current, modelPrewarm: e.target.checked }))}
                            />
                            启动时预热活动模型（默认关；失败只显示微标）
                          </label>
                          <div style={{ marginTop: 8, fontSize: 11, color: tokens.textMuted }}>
                            转写后处理（仅本机转写，默认全关）
                          </div>
                          {(
                            [
                              ["postprocessFillers", "去掉语气词"],
                              ["postprocessLowercase", "转小写"],
                              ["postprocessStripPunct", "去掉句尾标点"],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key} style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 12, cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={voicePrefsDraft[key] ?? (voiceModel[key] === true)}
                                onChange={(e) => setVoicePrefsDraft(current => ({ ...current, [key]: e.target.checked }))}
                              />
                              {label}
                            </label>
                          ))}

                          <div style={{ marginTop: 10 }}>
                            <div style={{ marginBottom: 4, fontWeight: 500, fontSize: 12 }}>
                              {VOICE_DOWNLOAD_ENDPOINT_LABEL}
                            </div>
                            <input
                              style={styles.input}
                              type="text"
                              value={
                                voiceEndpointDraft ?? voiceModel.modelDownloadEndpoint ?? ""
                              }
                              placeholder={VOICE_DOWNLOAD_ENDPOINT_PLACEHOLDER}
                              onChange={(e) => setVoiceEndpointDraft(e.target.value)}
                            />
                            <div style={{ ...styles.helpText, marginTop: 4 }}>
                              {VOICE_DOWNLOAD_ENDPOINT_HINT}
                            </div>
                          </div>
                        </>
                      )}

                      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap" as const, gap: 8, alignItems: "center" }}>
                        {committedLocal ? (
                          <>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: tokens.success,
                              }}
                            >
                              {BTN_LOCAL_ENABLED}
                              {activeId ? `（${activeId}）` : ""}
                            </span>
                            <button
                              type="button"
                              style={styles.secondaryBtn}
                              onClick={() => {
                                clearVoiceErr()
                                setEngineDraft("browser")
                              }}
                            >
                              {BTN_SWITCH_BROWSER}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            style={{
                              ...styles.secondaryBtn,
                              ...(canEnableLocal
                                ? {
                                    background: tokens.accent,
                                    color: tokens.userBubbleText,
                                    borderColor: tokens.accent as string,
                                  }
                                : {}),
                            }}
                            disabled={enginePending || !canEnableLocal}
                            title={
                              canEnableLocal
                                ? "将听写引擎切换为本机 Whisper（需已下载就绪模型）"
                                : `请先下载推荐模型 ${recommendedId}（或任一就绪型号）后再启用`
                            }
                            onClick={() => handleSaveEngine(true)}
                          >
                            {BTN_ENABLE_LOCAL}
                          </button>
                        )}
                      </div>
                      {!committedLocal && !canEnableLocal && voiceModel && (
                        <div style={{ ...styles.helpText, marginTop: 4, color: tokens.warning }}>
                          请先下载推荐型号 {recommendedId}（或就绪后启用）。选择「本机转写」仅为预览，不会立刻切换引擎。
                        </div>
                      )}
                    </div>
                  )}

                  {showSystemPanel && systemProbeWin32 && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: "10px 10px 8px",
                        borderRadius: 8,
                        border: `1px solid ${tokens.border}`,
                        background: tokens.bgMuted,
                      }}
                    >
                      {/* 引擎链路状态三行已上移为常驻块（radios 之后）；
                          本面板仅保留启用/停用动作。 */}
                      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap" as const, gap: 8, alignItems: "center" }}>
                        {committedSystem ? (
                          <>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: tokens.success,
                              }}
                            >
                              {BTN_SYSTEM_ENABLED}
                            </span>
                            <button
                              type="button"
                              style={styles.secondaryBtn}
                              onClick={() => {
                                clearVoiceErr()
                                setEngineDraft("browser")
                              }}
                            >
                              {BTN_SWITCH_BROWSER}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            style={{
                              ...styles.secondaryBtn,
                              ...(systemProbeGreen
                                ? {
                                    background: tokens.accent,
                                    color: tokens.userBubbleText,
                                    borderColor: tokens.accent as string,
                                  }
                                : {}),
                            }}
                            disabled={enginePending || !systemProbeGreen}
                            title={
                              systemProbeGreen
                                ? "将听写引擎切换为 Windows 系统语音识别（本机离线）"
                                : SYSTEM_UNAVAILABLE_REASON_LABEL
                            }
                            onClick={() => handleSaveEngine(true)}
                          >
                            {BTN_ENABLE_SYSTEM}
                          </button>
                        )}
                      </div>
                      {!committedSystem && !systemProbeGreen && (
                        <div style={{ ...styles.helpText, marginTop: 4, color: tokens.warning }}>
                          {SYSTEM_UNAVAILABLE_REASON_LABEL}。选择该选项仅为预览，不会立刻切换引擎。
                        </div>
                      )}
                    </div>
                  )}


                  {/* #260: 说话人分离模型（会议说话人嵌入；独立于转写引擎，共享磁盘预算） */}
                  {(() => {
                    const entry = voiceModel?.diarizeModel
                    const status = entry?.status || "absent"
                    const diarizePending =
                      entry?.modelId && voicePendingDownload === entry.modelId
                    const downloading =
                      status === "downloading" ||
                      !!diarizePending ||
                      (entry?.modelId != null &&
                        progress?.modelId === entry.modelId &&
                        status !== "ready")
                    const pct =
                      diarizePending || (downloading && progress?.modelId === entry?.modelId)
                        ? progressPercent(progress?.receivedBytes ?? 0, progress?.totalBytes ?? 0)
                        : null
                    return (
                      <div
                        style={{
                          marginTop: 10,
                          padding: "8px 8px 6px",
                          borderRadius: 6,
                          border: `1px solid ${tokens.border}`,
                          background: tokens.bgElevated,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap" as const,
                            alignItems: "center",
                            gap: 6,
                            fontSize: 12,
                          }}
                        >
                          <span style={{ fontWeight: 500, color: tokens.text }}>
                            说话人分离模型（会议 · 实验）
                          </span>
                          <span style={{ color: tokens.textMuted, fontSize: 11 }}>
                            {diarizePending ? VOICE_STATUS_STARTING_DOWNLOAD : modelStatusLabel(status)}
                            {typeof entry?.bytesOnDisk === "number" && entry.bytesOnDisk > 0
                              ? ` · ${(entry.bytesOnDisk / (1024 * 1024)).toFixed(0)} MB`
                              : ""}
                          </span>
                          <span style={{ flex: 1 }} />
                          {downloading ? (
                            <button
                              type="button"
                              style={styles.secondaryBtn}
                              disabled={!!diarizePending}
                              onClick={() => {
                                clearVoiceErr()
                                setVoicePendingDownload(null)
                                sendVoice({ type: "voice.model.diarize_cancel" })
                              }}
                            >
                              {BTN_CANCEL}
                            </button>
                          ) : status === "ready" ? (
                            <button
                              type="button"
                              style={styles.secondaryBtn}
                              onClick={() => {
                                clearVoiceErr()
                                sendVoice({ type: "voice.model.diarize_delete" })
                              }}
                            >
                              {BTN_DELETE}
                            </button>
                          ) : (
                            <button
                              type="button"
                              style={styles.secondaryBtn}
                              onClick={() => {
                                clearVoiceErr()
                                const modelId = entry?.modelId
                                if (!modelId) return
                                setVoicePendingDownload(modelId)
                                dispatch({
                                  type: "SET_VOICE_MODEL_PROGRESS",
                                  progress: {
                                    modelId,
                                    file: "",
                                    receivedBytes: 0,
                                    totalBytes: 0,
                                  },
                                })
                                sendVoice(
                                  { type: "voice.model.diarize_download" },
                                  {
                                    onFail: () => {
                                      setVoicePendingDownload(null)
                                      dispatch({
                                        type: "SET_VOICE_MODEL_PROGRESS",
                                        progress: null,
                                      })
                                    },
                                  },
                                )
                              }}
                            >
                              {BTN_DOWNLOAD}
                            </button>
                          )}
                        </div>
                        {(pct !== null || diarizePending) && (
                          <div style={{ marginTop: 6 }}>
                            <div
                              style={{
                                height: 6,
                                borderRadius: 3,
                                background: tokens.border,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  height: "100%",
                                  width: diarizePending ? "18%" : `${pct ?? 0}%`,
                                  background: tokens.accent,
                                  transition: "width 0.2s ease",
                                  opacity: diarizePending ? 0.65 : 1,
                                }}
                              />
                            </div>
                            <div style={{ fontSize: 10, color: tokens.textMuted, marginTop: 2 }}>
                              {diarizePending
                                ? VOICE_STATUS_STARTING_DOWNLOAD
                                : `${progress?.file ? `${progress.file} · ` : ""}${pct ?? 0}%`}
                            </div>
                          </div>
                        )}
                        {entry?.error && (
                          <div style={{ fontSize: 11, color: tokens.danger, marginTop: 4 }}>
                            {modelProbeErrorLabel(entry.error) || entry.error}
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: tokens.textMuted, marginTop: 4, lineHeight: 1.45 }}>
                          会议「自动标说话人」用：本机 ONNX 说话人嵌入聚类，音频不出本机；只标「发言人N」，非身份识别。与转写模型共享磁盘预算；下载后无需切换引擎。
                        </div>
                      </div>
                    )
                  })()}

                  <p style={{ fontSize: 11, color: tokens.textMuted, margin: "8px 0 0", lineHeight: 1.45 }}>
                    {privacyCopyForEngine(privacyEngine)}
                  </p>
                  {engineHasEdits && (engineSelection === "local" || engineSelection === "system") && <label style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input type="checkbox" checked={enginePrivacyAck} onChange={event => setEnginePrivacyAck(event.target.checked)} />
                    我已阅读上述音频处理说明，同意启用所选听写引擎。
                  </label>}

                  {state.voiceModelError && (
                    <div style={{ ...styles.helpText, color: tokens.danger, marginTop: 4 }}>
                      {modelProbeErrorLabel(state.voiceModelError) || state.voiceModelError}
                    </div>
                  )}
                </>
              )
            })()}

            {state.voicePrivacyAckV1 && (
              <button
                type="button"
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  border: "none",
                  background: "transparent",
                  color: tokens.textMuted,
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
          </SettingsPage>

          <SettingsPage id="privacy-secrets" active={activeDestination === "privacy-secrets"}>
          <UserEnvSection active={activeDestination === "privacy-secrets" && settingsInteractive} onFooterSave={reportEnvFooter} />
          </SettingsPage>

          <SettingsPage id="privacy-autonomy" active={activeDestination === "privacy-autonomy"} badge={elevatedTrust ? (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: 8,
                  color: tokens.danger,
                  background: tokens.dangerSoft,
                }}>有开关已开</span>
              ) : null}>
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
                        color: tokens.userBubbleText,
                        background: tokens.danger,
                      }}
                    >
                      {chip}
                    </span>
                  )}
                </div>
                <div style={styles.field}>
                  <div style={styles.helpText}>
                    长程无人值守的<strong>主入口</strong>。默认关闭。急停与硬性拒绝仍然有效。
                    选「无人值守」后，已白名单坐标 App 的桌面操控在值守期内<strong>任务级 L2 与 mid-task re-L2 均静默</strong>（风险自担；进程会话 8h/重启失效）；同时会写入长期配置开启网页/企业巡航，解除武装时关闭。
                  </div>
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {(
                      [
                        {
                          id: "browser" as const,
                          label: "网页巡航",
                          hint: "跳过导航 L2；evaluate / osascript 仍确认（非三旗）",
                        },
                        {
                          id: "full" as const,
                          label: "全自动巡航",
                          hint: "导航 L2 + 企业 shell/netsec；evaluate 仍确认（须三旗才跳过）",
                        },
                        {
                          id: "full_protocol" as const,
                          label: "全自动巡航（含协议解锁）",
                          hint: "三旗全开：evaluate/协议 L1 等可跳过；仍不含桌面值守",
                        },
                        {
                          id: "unattended" as const,
                          label: "无人值守",
                          hint: "本会话桌面 L2/re-L2 静默 + 默认 dual-write 网页/企业两旗（evaluate 仍确认，除非勾协议）",
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
                              ? `1px solid ${tokens.dangerSoft}`
                              : "1px solid transparent",
                          background: autopilotTierPick === opt.id ? tokens.dangerSoft : "transparent",
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

                  <div style={{ marginTop: 10 }}>
                    <AutopilotConsequenceMatrix footnotes={false} />
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
                        color: tokens.userBubbleText,
                        background: tokens.danger,
                        borderColor: tokens.danger,
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
                        background: tokens.bgElevated,
                        borderRadius: 6,
                        border: `1px solid ${tokens.dangerSoft}`,
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
                            允许已白名单且已开坐标的 App 在本会话静默桌面 L2 与 re-L2（含危险/实验/前台让出；风险自担）
                          </label>
                          <label style={{ display: "flex", gap: 6, marginBottom: 4, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={unattendedAckSession}
                              onChange={(e) => setUnattendedAckSession(e.target.checked)}
                            />
                            确认：桌面值守为进程会话（重启 Companion 后失效）；同时会<strong>写入长期配置</strong>开启网页/企业自动批准（解除武装时一并关闭）
                          </label>
                          <label style={{ display: "flex", gap: 6, cursor: "pointer", color: tokens.warning }}>
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
                            color: tokens.userBubbleText,
                            background: tokens.danger,
                            borderColor: tokens.danger,
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
                        <div style={{ fontSize: 11, color: tokens.danger, marginTop: 4 }}>{autopilotMsg}</div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )
          })()}
          </SettingsPage>

          <SettingsPage id="privacy-trust" active={activeDestination === "privacy-trust"}>
                    {/* --- Security Settings --- */}
          <div style={styles.sectionTitle}>安全设置</div>

          <div style={styles.field}>
            <div style={styles.label}>安全保护</div>
            <div style={styles.helpText}>
              安全技能目前不能在此单独开关。现有安全检查和操作确认仍按配置与权限规则执行。
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
                  <span style={{ fontSize: 10, color: tokens.danger, marginLeft: 6 }}>有开关已开</span>
                )}
              </span>
              <span style={{ fontSize: 11, color: tokens.textMuted }}>{advancedGatesOpen ? "收起 ▲" : "展开 ▼"}</span>
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
                <div style={{ fontSize: 11, color: tokens.warning, marginTop: 2 }}>
                  ⚠ 跳过 <b>导航</b> 类 L2（navigate / create_tab / set_tab_url）。
                  <b>不</b>单独跳过 evaluate / osascript（须三旗全开或协议解锁一并武装）。
                  <b>不含</b> shell / netsec（请用企业开关或全自动巡航）。
                </div>
              </div>
            </label>
            {autoDangerConfirm && (
              <div style={{ marginTop: 10, padding: 8, background: tokens.bgElevated, borderRadius: 6, border: `1px solid ${tokens.warning}` }}>
                <div style={{ fontSize: 12, color: tokens.warning, fontWeight: 500, marginBottom: 6 }}>
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
                    style={{ ...styles.toggleBtn, color: tokens.userBubbleText, background: tokens.danger, borderColor: tokens.danger }}
                    onClick={handleAutoApproveDangerousConfirm}
                  >确认开启</button>
                  <button
                    style={styles.toggleBtn}
                    onClick={() => { setAutoDangerConfirm(false); setAutoDangerPhrase(""); setAutoDangerMsg(null) }}
                  >取消</button>
                </div>
                {autoDangerMsg && (
                  <div style={{ fontSize: 11, color: tokens.danger, marginTop: 4 }}>{autoDangerMsg}</div>
                )}
              </div>
            )}
          </div>

          {/* Plan B: enterprise shell/netsec L2 skip under scope */}
          <div style={{ ...styles.field, padding: 10, borderRadius: 8, background: tokens.warningSoft, border: `1px solid ${tokens.warning}` }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={config.auto_approve_enterprise_tools === true}
                onChange={(e) => handleEnterpriseAutoApproveToggle(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 500, color: tokens.warning }}>
                  全局自动批准企业高危工具（shell / netsec）
                  {config.auto_approve_enterprise_tools === true && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, marginLeft: 6, padding: "1px 6px",
                      borderRadius: 8, color: tokens.userBubbleText, background: tokens.danger,
                    }}>已启用</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: tokens.warning, marginTop: 4, lineHeight: 1.5 }}>
                  仍受模块启用、目标白名单、任务授权（netsec）/ shell 策略约束。
                  <b>不跳过</b> spawn_worker、桌面操控、MCP 关键能力。
                </div>
                <table
                  style={{
                    width: "100%",
                    marginTop: 8,
                    borderCollapse: "collapse",
                    fontSize: 10,
                    color: tokens.textSecondary,
                  }}
                >
                  <thead>
                    <tr style={{ background: tokens.warningSoft }}>
                      <th style={{ textAlign: "left", padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>开关</th>
                      <th style={{ textAlign: "left", padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>网页 L2</th>
                      <th style={{ textAlign: "left", padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>shell/netsec</th>
                      <th style={{ textAlign: "left", padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>协议 L1</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>自动批准危险</td>
                      <td style={{ padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>可跳过</td>
                      <td style={{ padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>仍确认</td>
                      <td style={{ padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>仍阻断</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>协议解锁</td>
                      <td style={{ padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>可跳过</td>
                      <td style={{ padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>仍确认</td>
                      <td style={{ padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>可跳过</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>本开关(企业)</td>
                      <td style={{ padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>不变</td>
                      <td style={{ padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>可跳过(有范围)</td>
                      <td style={{ padding: "3px 5px", border: `1px solid ${tokens.warning}` }}>不变</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </label>
            {entBConfirm && (
              <div style={{ marginTop: 10, padding: 8, background: tokens.bgElevated, borderRadius: 6, border: `1px solid ${tokens.warning}` }}>
                <div style={{ fontSize: 12, color: tokens.warning, fontWeight: 500, marginBottom: 6 }}>
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
                    style={{ ...styles.toggleBtn, color: tokens.userBubbleText, background: tokens.danger, borderColor: tokens.danger }}
                    onClick={handleEnterpriseAutoApproveConfirm}
                  >确认开启</button>
                  <button
                    style={styles.toggleBtn}
                    onClick={() => { setEntBConfirm(false); setEntBPhrase(""); setEntBMsg(null) }}
                  >取消</button>
                </div>
                {entBMsg && (
                  <div style={{ fontSize: 11, color: tokens.danger, marginTop: 4 }}>{entBMsg}</div>
                )}
              </div>
            )}
          </div>

          {/* Protocol unlock (security.allow_all_schemes) — former UI name God-mode */}
          <div style={{ ...styles.field, padding: 10, borderRadius: 8, background: tokens.dangerSoft, border: `1px solid ${tokens.dangerSoft}` }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={config.allow_all_schemes === true}
                onChange={e => handleGodModeToggle(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 500, color: tokens.danger }}>
                  协议解锁（会放行 javascript: 导航且不再问）
                  {config.allow_all_schemes === true && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, marginLeft: 6, padding: "1px 6px",
                      borderRadius: 8, color: tokens.userBubbleText, background: tokens.danger,
                    }}>已启用</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: tokens.danger, marginTop: 4, lineHeight: 1.5 }}>
                  ☠ 开则跳过 L1 协议硬阻断与 URL 确认（含 <code>javascript:</code> / <code>data:</code> / <code>chrome:</code>，不再询问）。
                  不是「只允许非 http 协议」。
                  <b>不等于</b>无人值守全开。<b>不含</b> shell_exec / netsec / host_computer / spawn 的 forceConfirm。
                  曾用名 God-mode。
                </div>
              </div>
            </label>

            {godmodeConfirm && (
              <div style={{ marginTop: 10, padding: 8, background: tokens.bgElevated, borderRadius: 6, border: `1px solid ${tokens.dangerSoft}` }}>
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
                    style={{ ...styles.toggleBtn, color: tokens.userBubbleText, background: tokens.danger, borderColor: tokens.danger }}
                    onClick={handleGodModeConfirm}
                  >确认开启</button>
                  <button
                    style={styles.toggleBtn}
                    onClick={() => { setGodmodeConfirm(false); setGodmodePhrase(""); setGodmodeMsg(null) }}
                  >取消</button>
                </div>
                {godmodeMsg && (
                  <div style={{ fontSize: 11, color: tokens.danger, marginTop: 4 }}>{godmodeMsg}</div>
                )}
              </div>
            )}
          </div>
            </>
          )}

          <div style={styles.field}>
            <label style={styles.label}>安全审计日志</label>
            {showAuditLog ? (
              <div style={{ maxHeight: 200, overflowY: "auto", background: tokens.bgMuted, borderRadius: 6, padding: 8, fontSize: 11 }}>
                {state.securityAuditLog.length === 0 ? (
                  <div style={{ color: tokens.textMuted, padding: "8px 0" }}>暂无审计记录</div>
                ) : (
                  state.securityAuditLog.slice(-20).map(entry => (
                    <div key={entry.id} style={{ marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${tokens.border}` }}>
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
                        <span style={{ color: tokens.textSecondary }}>{entry.tool_name}</span>
                        <span style={{ color: tokens.textMuted, marginLeft: "auto" }}>{entry.ts.slice(11, 19)}</span>
                      </div>
                      <div style={{
                        color: entry.action === "changed"
                          ? (entry.level === "error" ? tokens.danger : tokens.success)
                          : tokens.textMuted,
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
          </SettingsPage>

          <SettingsPage id="privacy-activity" active={activeDestination === "privacy-activity"}>
            <button type="button" className="cm-settings-text-link" onClick={() => openWorkspaceDestination("activity")}>打开活动记录</button>
            <SiteCounterSettingsSection visible={activeDestination === "privacy-activity" && settingsInteractive} />
          </SettingsPage>

          <SettingsPage id="tools-capabilities" active={activeDestination === "tools-capabilities"}>
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
                <strong>运行自主度</strong>（隐私与权限 → 运行自主度）：危险操作要不要每次确认；
                <em>不会</em>放开场景已关掉的工具，也<strong>不能</strong>代替选工作区。
              </li>
            </ul>
            <div style={{ ...styles.helpText, marginTop: 8 }}>
              若工具提示「需要先绑定工作区」，请去场景页选文件夹，而不是开协议解锁或巡航。
            </div>
          </div>

          <div style={styles.divider} />

          <CapabilityProfileSection />
          </SettingsPage>

          <SettingsPage id="tools-network" active={activeDestination === "tools-network"}>
          <NetSecSettingsSection />
          </SettingsPage>

          <SettingsPage id="tools-mcp" active={activeDestination === "tools-mcp"}>
                    {/* --- Outbound MCP L4+ grants --- */}
          <OutboundMcpSettingsSection />
          </SettingsPage>

          <SettingsPage id="tools-lcu" active={activeDestination === "tools-lcu"}>
          <LcuSettingsSection active={activeDestination === "tools-lcu" && settingsInteractive} onFooterSave={reportLcuFooter} />
          </SettingsPage>

          <SettingsPage id="tools-coding" active={activeDestination === "tools-coding"}>
          <CodingHandoffSettingsSection
            acpEnabled={!!(config as { acp?: { enabled?: boolean } }).acp?.enabled}
            maxConcurrentSessions={(config as { acp?: { max_concurrent_sessions?: 1 | 2 | 3 | 4 } }).acp?.max_concurrent_sessions ?? 1}
            onChangeMaxConcurrentSessions={value => {
              stageNested("acp", { max_concurrent_sessions: value })
            }}
            acpAgents={state.acpAgents}
            autoSuggest={
              (config as { coding_handoff?: { auto_suggest?: boolean } }).coding_handoff
                ?.auto_suggest !== false
            }
            openLocalTerminal={
              (config as { coding_handoff?: { open_local_terminal?: boolean } }).coding_handoff
                ?.open_local_terminal === true
            }
            localTerminalApp={
              (config as { coding_handoff?: { local_terminal_app?: string } }).coding_handoff
                ?.local_terminal_app || "auto"
            }
            onToggleAutoSuggest={(v) => {
              stageNested("coding_handoff", { auto_suggest: v })
            }}
            onToggleOpenLocalTerminal={(v) => {
              stageNested("coding_handoff", { open_local_terminal: v })
            }}
            embeddedTerminal={
              (config as { embedded_terminal?: { enabled?: boolean } }).embedded_terminal
                ?.enabled === true
            }
            onToggleEmbeddedTerminal={(v) => {
              stageNested("embedded_terminal", { enabled: v })
            }}
            onChangeLocalTerminalApp={(v) => {
              stageNested("coding_handoff", { local_terminal_app: v })
            }}
            onToggleAcp={(v) => {
              stageNested("acp", { enabled: v })
              // Refresh agent list after master switch (list is independent of enabled)
              chrome.runtime.sendMessage({ type: "acp.list" }, () => {
                void chrome.runtime.lastError
              })
            }}
          />
          </SettingsPage>

          <SettingsPage id="data-knowledge" active={activeDestination === "data-knowledge"}>
            <p className="cm-settings-note">使用知识面板核对当前对话的知识选择方式、勾选项和匹配规则。</p>
            <button type="button" className="cm-settings-text-link" disabled={!host} onClick={() => void openKnowledgeSettings()}>打开知识面板</button>
          </SettingsPage>

          <SettingsPage id="data-files" active={activeDestination === "data-files"}>
                    {/* --- File Upload Settings --- */}

          <div style={styles.field}>
            <label style={styles.label}>最大文件大小: {((config.file_upload_max_size ?? 10485760) / (1024 * 1024)).toFixed(0)} MB</label>
            <input
              style={{ width: "100%" }}
              type="range"
              min={1}
              max={100}
              step={1}
              value={(config.file_upload_max_size ?? 10485760) / (1024 * 1024)}
              onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { file_upload_max_size: parseInt(e.target.value) * 1024 * 1024 } })}
            />
            <div style={styles.helpText}>
              对话中单个文档的大小上限，范围 1–100 MiB。单次附件合计 ≤100 MiB。图片另有预算（压缩后单张 ≤4 MiB，合计 ≤6 MiB）。
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>最大 Token 数</label>
            <input
              style={styles.input}
              type="number"
              value={config.file_upload_max_tokens ?? 50000}
              onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { file_upload_max_tokens: parseInt(e.target.value) || 50000 } })}
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
                onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { file_upload_vision: e.target.checked } })}
              />
              启用文件视觉分析
            </label>
            <div style={styles.helpText}>
              仅当主模型不能看图时，用户附图才走视觉轨。主模型能看图时此开关不影响粘贴/选/拖。
            </div>
          </div>
          </SettingsPage>

          <SettingsPage id="data-index" active={activeDestination === "data-index"}>
          {/* Thread History IA Wave B — session index (file and knowledge settings) */}
          <div style={styles.sectionTitle}>会话索引（标签 / 要点）</div>
          <div style={styles.field}>
            <label style={styles.label}>打开列表时惰性提取要点</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                style={{
                  ...styles.toggleBtn,
                  ...(config.thread_digest_enabled
                    ? { background: tokens.accent, color: tokens.userBubbleText, borderColor: tokens.accent }
                    : {}),
                }}
                onClick={() =>
                  dispatch({
                    type: "EDIT_SETTINGS_DRAFT",
                    config: { thread_digest_enabled: !config.thread_digest_enabled },
                  })
                }
              >
                {config.thread_digest_enabled ? "已开启" : "默认关闭"}
              </button>
            </div>
            <div style={styles.helpText}>
              默认关闭。开启后，每次打开线程列表会对空闲未标注/过期会话自动提取要点（受每日上限约束，非全库扫描）。手动「为未标注提取」始终可用。
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>空闲阈值（小时）</label>
            <input
              style={styles.input}
              type="number"
              min={0}
              max={720}
              value={config.thread_digest_on_idle_hours ?? 24}
              onChange={(e) =>
                dispatch({
                  type: "EDIT_SETTINGS_DRAFT",
                  config: {
                    thread_digest_on_idle_hours: Math.max(
                      0,
                      Math.min(720, Number(e.target.value) || 0),
                    ),
                  },
                })
              }
            />
            <div style={styles.helpText}>仅处理 updated_at 早于该小时数的会话（默认 24）。</div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>每日自动提取上限</label>
            <input
              style={styles.input}
              type="number"
              min={0}
              max={100}
              value={config.thread_digest_max_per_day ?? 20}
              onChange={(e) =>
                dispatch({
                  type: "EDIT_SETTINGS_DRAFT",
                  config: {
                    thread_digest_max_per_day: Math.max(
                      0,
                      Math.min(100, Number(e.target.value) || 0),
                    ),
                  },
                })
              }
            />
            <div style={styles.helpText}>
              含惰性自动批；单批仍 ≤20。点「保存」后写入 Companion 并生效。
            </div>
          </div>
          </SettingsPage>

          <SettingsPage id="data-archive" active={activeDestination === "data-archive"}>
          {/* #502 B — archive tier. Default off: durable thread JSON keeps tool
              rows as stubs so the chat log is not a full replay of every page
              read / form fill. Sensitive classes fold either way. */}
          <div style={styles.field}>
            <label style={styles.label}>保存完整操作史</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                style={{
                  ...styles.toggleBtn,
                  ...(config.persist_full_tool_history
                    ? { background: tokens.accent, color: tokens.userBubbleText, borderColor: tokens.accent }
                    : {}),
                }}
                onClick={() => {
                  dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { persist_full_tool_history: !config.persist_full_tool_history } as Partial<LLMConfig> })
                }}
              >
                {config.persist_full_tool_history ? "已开启" : "默认关闭"}
              </button>
            </div>
            <div style={styles.helpText}>
              默认关。只留工具名、成败、内容指纹；失败步骤保留错误原因与少量机器字段。打开后仍脱敏 cookie / 本机命令 / 密钥。已经省略的正文不会因打开而恢复。只作用于对话 JSON；操作历史面板与日志不在此开关内。
            </div>
          </div>
          </SettingsPage>

          <SettingsPage id="data-notes" active={activeDestination === "data-notes"}>
          {/* --- Markdown export (optional note-folder conventions) --- */}
          <div style={styles.field}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={localValues.exportIncludeReasoning === true}
                disabled={localSaving}
                onChange={(e) => editLocal("exportIncludeReasoning", e.target.checked)}
              />
              导出 Markdown 时包含思考过程
            </label>
            <div style={styles.helpText}>
              默认关闭。开启后以折叠块写入笔记；请注意思考可能含中间假设，勿默认分享。
            </div>
          </div>


          <div style={styles.field}>
            <label style={styles.label}>笔记库路径（可选）</label>
            <input
              style={styles.input}
              value={config.obsidian_vault_path || ""}
              onChange={e => dispatch({ type: "EDIT_SETTINGS_DRAFT", config: { obsidian_vault_path: e.target.value } })}
              placeholder="/path/to/your/notes"
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
              对话导出为 Markdown 文件下载，不写进该文件夹。若填写笔记库路径，会抽样约 200 篇笔记的 frontmatter 与正文前 200 字，提取命名 / tag 约定并建立索引；之后导出自动套用 frontmatter、相关笔记 [[wikilinks]] 与模板骨架。
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
              刷新笔记库档案
            </button>
            {state.obsidianProfileStatus && (
              <div style={{ ...styles.helpText, color: state.obsidianProfileStatus.ok ? tokens.success : tokens.danger, marginTop: 6 }}>
                {state.obsidianProfileStatus.message}
              </div>
            )}
          </div>
          </SettingsPage>

          <SettingsPage id="model-local" active={activeDestination === "model-local"}>
          {/* --- WP5-I4 实验功能(Qwen3-VL 本地模型定位层) --- */}
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
              else if (!computerHasEdits) {
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
                      ...(modelEnabled ? { background: tokens.accent, color: tokens.userBubbleText, borderColor: tokens.accent } : {}),
                    }}
                    disabled={disabledReason !== null || computerHasEdits}
                    onClick={toggle}
                  >
                    {modelEnabled ? "已开启" : "已关闭"}
                  </button>
                  <span style={styles.helpText}>{MODEL_SWITCH_COPY.switchHint}</span>
                </div>
                {/* P2:任务运行中旁注(per-task 生效 + estop 引导) */}
                {runningNote && (
                  <div style={{ ...styles.helpText, color: tokens.warning }}>{runningNote}</div>
                )}
                {/* 三层依赖提示(主开关关)优先;否则本体语义 */}
                <div style={styles.helpText}>{depHint ?? MODEL_SWITCH_COPY.layerSemantics}</div>
                {disabledReason && (
                  <div style={{ ...styles.helpText, color: tokens.warning }}>{disabledReason}</div>
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
                        ? tokens.success
                        : model?.canDownload === true
                          ? tokens.warning
                          : tokens.danger
                    }`,
                    background: model?.canEnable
                      ? tokens.successSoft
                      : model?.canDownload === true
                        ? tokens.warningSoft
                        : tokens.dangerSoft,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: tokens.text }}>
                    环境检查（下载 / 启用前必看）
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.45, color: tokens.text, marginBottom: 6 }}>
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
                            color: r.ok ? tokens.success : r.blocking ? tokens.danger : tokens.warning,
                          }}
                        >
                          <span style={{ flexShrink: 0, fontWeight: 700 }}>{r.ok ? "✓" : "✗"}</span>
                          <span>
                            <span style={{ fontWeight: 600 }}>{r.label}</span>
                            {r.detail ? (
                              <span style={{ display: "block", color: tokens.textSecondary, fontWeight: 400 }}>
                                {r.detail}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : model?.preflight?.hardware ? (
                    <div style={{ fontSize: 11, color: tokens.textSecondary, marginBottom: 6 }}>
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
                          color: tokens.danger,
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
                          color: tokens.warning,
                          marginBottom: 6,
                          lineHeight: 1.4,
                        }}
                      >
                        暂不可开启：
                        {model?.enableBlockReason || model?.preflight?.enableBlockReason}
                      </div>
                    )}
                  {Array.isArray(model?.nextSteps) && model!.nextSteps!.length > 0 && (
                    <ol style={{ margin: "0 0 6px 0", paddingLeft: 18, fontSize: 11, color: tokens.text }}>
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
                        <div style={{ fontSize: 11, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>
                          一键安装命令（复制到「终端」执行）
                        </div>
                        {model!.preflight!.installCommands!.map((c) => (
                          <div
                            key={c}
                            style={{
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontSize: 10,
                              background: tokens.darkElevated,
                              color: tokens.darkText,
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
                        <div style={{ fontSize: 10, color: tokens.textSecondary, marginTop: 2 }}>
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
                    color: tokens.text,
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
                <div style={{ ...styles.helpText, marginTop: 4, fontSize: 10, color: tokens.textSecondary }}>
                  权重会下载到该目录下的 qwen3-vl-2b / 4b / 8b 子文件夹。请选择有足够空间的磁盘位置。
                </div>

                <div style={{ ...styles.helpText, marginTop: 12, fontWeight: 700, fontSize: 12 }}>
                  Python 环境
                </div>
                <div style={{ ...styles.helpText, marginTop: 4, fontSize: 11, color: tokens.textSecondary }}>
                  {(model?.pythonResolution || model?.preflight?.pythonResolution) ??
                    "检测中…"}
                  {(() => {
                    const pyPath =
                      model?.pythonPath ||
                      (typeof model?.preflight?.deps?.pythonPath === "string"
                        ? model.preflight.deps.pythonPath
                        : "")
                    if (pyPath && pyPath.length > 0) {
                      const shown =
                        pyPath.length > 48
                          ? `${pyPath.slice(0, 20)}…${pyPath.slice(-24)}`
                          : pyPath
                      return ` · ${shown}`
                    }
                    return ""
                  })()}
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
                {(() => {
                  // Progressive CTA (PY14): fully missing → install hint; base ok → create-env
                  const mode = model?.pythonMode || model?.preflight?.pythonMode || "isolated"
                  const isoOk =
                    model?.isolatedEnvExists ?? model?.preflight?.isolatedEnvExists
                  const baseOk =
                    model?.basePythonAvailable ?? model?.preflight?.basePythonAvailable
                  const pyHint =
                    model?.pythonInstallHint ||
                    model?.preflight?.pythonInstallHint ||
                    ""
                  if (mode === "isolated" && !isoOk && baseOk !== true && pyHint) {
                    return (
                      <div
                        style={{
                          ...styles.helpText,
                          marginTop: 6,
                          fontSize: 10,
                          color: tokens.warning,
                          fontFamily: "ui-monospace, monospace",
                          wordBreak: "break-all",
                        }}
                      >
                        安装 Python：{pyHint}
                      </div>
                    )
                  }
                  return null
                })()}
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
                      (computerDraft.pythonMode ?? model?.pythonMode ?? model?.preflight?.pythonMode ?? "isolated") === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        style={{
                          ...styles.secondaryBtn,
                          textAlign: "left",
                          ...(active
                            ? { borderColor: tokens.accent, background: tokens.accentSoft }
                            : {}),
                        }}
                        disabled={model === null || model.modelStatus === "downloading"}
                        onClick={() => {
                          editComputer("pythonMode", opt.id)
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 11 }}>
                          {active ? "● " : "○ "}
                          {opt.label}
                        </div>
                        <div style={{ fontSize: 10, color: tokens.textSecondary, marginTop: 2 }}>{opt.desc}</div>
                      </button>
                    )
                  })}
                </div>
                {(computerDraft.pythonMode ?? model?.pythonMode ?? model?.preflight?.pythonMode) === "system" && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ ...styles.helpText, fontSize: 10, color: tokens.textSecondary, marginBottom: 4 }}>
                      当前全局解释器：
                      <span style={{ fontFamily: "ui-monospace, monospace", color: tokens.text }}>
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
                      disabled={computerHasEdits || model === null || model.modelStatus === "downloading"}
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
                  {(() => {
                    const mode =
                      model?.pythonMode || model?.preflight?.pythonMode || "isolated"
                    const isoOk =
                      model?.isolatedEnvExists ?? model?.preflight?.isolatedEnvExists
                    const baseOk =
                      model?.basePythonAvailable ?? model?.preflight?.basePythonAvailable
                    // Primary CTA: create-env when base available; still show when missing so user can retry after install
                    const createPrimary = mode === "isolated" && !isoOk && baseOk === true
                    return (
                      <button
                        type="button"
                        style={{
                          ...styles.secondaryBtn,
                          ...(createPrimary
                            ? {
                                borderColor: tokens.accent,
                                background: tokens.accentSoft,
                                fontWeight: 700,
                              }
                            : {}),
                        }}
                        disabled={
                          computerHasEdits || model === null ||
                          model.modelStatus === "downloading" ||
                          mode === "system"
                        }
                        title="创建或修复 Companion 数据目录下的独立 python-env；优先 uv"
                        onClick={() => {
                          dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
                          send({ type: "computer.model.ensure_python_env", source: "settings" })
                        }}
                      >
                        {isoOk ? "修复/更新独立环境" : "创建独立环境"}
                      </button>
                    )
                  })()}
                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    disabled={computerHasEdits || model === null || model.modelStatus === "downloading"}
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
                    const active = (computerDraft.downloadSource ?? model?.downloadSource ?? "auto") === s.id
                    return (
                      <button
                        key={s.id}
                        type="button"
                        style={{
                          ...styles.secondaryBtn,
                          ...(active
                            ? { background: tokens.accent, color: tokens.userBubbleText, borderColor: tokens.accent }
                            : {}),
                          opacity: model === null || model.modelStatus === "downloading" ? 0.5 : 1,
                        }}
                        disabled={model === null || model.modelStatus === "downloading"}
                        onClick={() => {
                          editComputer("downloadSource", s.id)
                        }}
                      >
                        {s.label}
                      </button>
                    )
                  })}
                </div>
                <div style={{ ...styles.helpText, marginTop: 4, fontSize: 11, color: tokens.textSecondary }}>
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
                    const active = (computerDraft.variant ?? model?.variant ?? "2b") === v
                    const tip = QWEN_VL_VARIANT_TIPS[v]!
                    const rec = model?.recommendedVariant === v
                    return (
                      <button
                        key={v}
                        type="button"
                        style={{
                          ...styles.secondaryBtn,
                          ...(active
                            ? { background: tokens.accent, color: tokens.userBubbleText, borderColor: tokens.accent }
                            : {}),
                          opacity: model === null || model.modelStatus === "downloading" ? 0.5 : 1,
                        }}
                        disabled={model === null || model.modelStatus === "downloading"}
                        title={tip.tip}
                        onClick={() => {
                          editComputer("variant", v)
                        }}
                      >
                        {tip.label}
                        {rec ? " · 推荐" : ""}
                      </button>
                    )
                  })}
                </div>
                <div style={{ ...styles.helpText, marginTop: 4, color: tokens.warning }}>
                  {model?.resourceTip || variantResourceTip(model?.variant)}
                </div>
                <div style={{ ...styles.helpText, marginTop: 2, fontSize: 11, color: tokens.textMuted }}>
                  切换规模后请重新「下载模型」。能否流畅运行由 Companion 按本机内存/显存估算；不足仍可下载，但可能很慢或 OOM。
                </div>
                {/* 状态行 */}
                <div
                  style={{
                    ...styles.helpText,
                    marginTop: 6,
                    color:
                      statusLine.kind === "error" ? tokens.danger : statusLine.kind === "ok" ? tokens.success : tokens.textSecondary,
                  }}
                >
                  {statusLine.text}
                  {statusLine.detail ? ` ${statusLine.detail}` : ""}
                  {statusLine.action ? (
                    <button style={{ ...styles.secondaryBtn, marginLeft: 8 }} disabled={computerHasEdits && statusLine.action !== "重置熔断"} onClick={() => runAction(statusLine.action!)}>
                      {statusLine.action}
                    </button>
                  ) : null}
                </div>
                {computerHasEdits && <div style={styles.helpText}>请先保存本机模型设置，再下载模型。</div>}
                {/* 管理按钮行:下载 / 删除(两步确认)/ 重置熔断(disabled 态) */}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button
                    style={styles.secondaryBtn}
                    disabled={
                      model === null ||
                      computerHasEdits ||
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
                      ...(modelDeleteArmed ? { borderColor: tokens.danger, color: tokens.danger } : {}),
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
          </SettingsPage>
          </div>
        </div>

        <div className="cm-settings-footer" style={styles.footer}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: "auto", textAlign: "left" }}>
            <span className="cm-settings-save-scope">保存当前设置草稿。授权与独立表单需要各自确认。</span>
            {(hasEdits || computerHasEdits || localHasEdits || externalHasEdits || voicePrefsHasEdits || engineHasEdits || meetingFooter?.dirty || profileFooter?.dirty || minutesFooter?.dirty || visualFooter?.dirty || lcuFooter?.dirty || envFooter?.dirty || microphoneFooter?.dirty) && <span role="status">有未保存的修改</span>}
            {[meetingFooter, profileFooter, minutesFooter, visualFooter, lcuFooter, envFooter, microphoneFooter].some(control => control?.dirty && control.busy) && <span role="status">部分设置仍在等待连接或回执，草稿已保留。</span>}
            {engineHasEdits && (engineSelection === "local" || engineSelection === "system") && !enginePrivacyAck && <span role="status">启用听写引擎前，请先勾选音频处理说明。</span>}
            {engineHasEdits && engineSelection === "external" && externalHasEdits && <span role="status">先保存外部转写配置，再保存引擎选择。</span>}
            {engineHasEdits && engineSelection === "external" && !externalPrivacyAck && <span role="status">启用外部转写前，请先勾选音频发送说明。</span>}
            {engineHasEdits && engineSelection === "external" && !externalHasEdits && externalPrivacyAck && modelState?.external?.keyConfigured && <span role="status">外部转写配置已保存，点击保存启用该引擎。</span>}
            {(savingExternal || externalHasEdits || voicePrefsHasEdits) && state.voiceModelError && <span role="alert">{modelProbeErrorLabel(state.voiceModelError) || state.voiceModelError}</span>}
            {localSaveError && <span role="alert">{localSaveError}</span>}
            {[meetingFooter, profileFooter, minutesFooter, visualFooter, lcuFooter, envFooter, microphoneFooter].map((control, index) => control?.error ? <span role="alert" key={index}>{control.error}</span> : null)}
            {localSaving && <span role="status">正在保存本机设置…</span>}
            {footerWaiting && <span role="status">正在按顺序保存设置，请等待配置回执…</span>}
            {footerRunning && <span role="status">正在提交其余设置…</span>}
            {localSaved && !localHasEdits && <span role="status">本机设置已保存</span>}
            {footerNotice && <span role="status">{footerNotice}</span>}
            {state.userEnvStatus === "已保存" && <span role="status">环境变量已保存</span>}
            {externalPending && <span role="status">正在等待外部转写配置保存回执…</span>}
            {voicePrefsPending && <span role="status">正在等待本机听写设置保存回执…</span>}
            {enginePending && <span role="status">正在等待听写引擎切换回执…</span>}
            {externalSaved && !externalHasEdits && <span role="status">外部转写配置已保存</span>}
            {state.configEpochInvalid ? <span role="alert">配置版本无法确认，请重新连接 Companion；草稿已保留。</span> : !state.configRevision && <span role="status">当前 Companion 未提供配置版本，请升级后保存草稿。</span>}
            {state.settingsSave.status === "pending" && <span role="status">正在等待 Companion 保存回执…</span>}
            {state.settingsSave.status === "saved" && <span role="status">对话设置已保存</span>}
            {state.settingsSave.status === "unknown" && <span role="alert">保存结果未知，草稿已保留。请先核对当前配置，再选择重新保存。 <button type="button" onClick={() => { chrome.runtime.sendMessage({ type: "config.get" }); dispatch({ type: "SETTINGS_SAVE_RETRY" }) }}>我已核对，允许重新保存</button></span>}
            {state.settingsSave.status === "conflict" && <span role="alert">配置已在别处更改，请核对草稿后再保存。</span>}
            {state.settingsSave.status === "review" && <span role="status">部分草稿仍需确认。</span>}
            {draft && Object.keys(draft.conflicts).map(key => <span role="alert" key={key}>字段 {key} 已变化，选择保留哪一份： <button type="button" onClick={() => dispatch({ type: "RESOLVE_SETTINGS_CONFLICT", key: key as keyof LLMConfig, choice: "mine" })}>保留我的编辑</button> <button type="button" onClick={() => dispatch({ type: "RESOLVE_SETTINGS_CONFLICT", key: key as keyof LLMConfig, choice: "remote" })}>使用当前配置</button></span>)}
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
          <button style={styles.testBtn} onClick={handleTest}>测试模型连接</button>
          <button
            style={{
              ...styles.saveBtn,
              ...(footerDisabled
                ? { opacity: 0.5, cursor: "not-allowed" }
                : {}),
            }}
            className="cm-settings-save"
            onClick={handleFooterSave}
            disabled={footerDisabled}
            title={footerDisabled ? settingsSaveDisabledTitle(state.configHydratedFromCompanion) ?? (saveBlocked ? "等待连接、回执或处理冲突" : undefined) : undefined}
          >保存</button>
        </div>

        {state.companionConfig && (
          <div style={{
            fontSize: 11,
            color: tokens.textMuted,
            padding: "8px 16px",
            borderTop: `1px solid ${tokens.border}`,
            textAlign: "center",
          }}>
            Companion 全局配置已同步{state.companionConfig.model_name ? ` (${state.companionConfig.model_name})` : ""}
          </div>
        )}
        </div>
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


    </Modal>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: tokens.scrim,
    zIndex: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    width: "100%",
    maxHeight: "80vh",
    background: tokens.bgElevated,
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
    borderBottom: `1px solid ${tokens.border}`,
  },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: 18,
    cursor: "pointer",
    color: tokens.textMuted,
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
    color: tokens.text,
    marginBottom: 4,
  },
  input: {
    width: "100%",
    padding: "6px 10px",
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: 6,
    fontSize: 13,
    fontFamily: tokens.font,
    outline: "none",
    boxSizing: "border-box" as const,
  },
  toggleBtn: {
    padding: "4px 10px",
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: 6,
    background: tokens.bgElevated,
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  select: {
    width: "100%",
    padding: "6px 10px",
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: 6,
    fontSize: 13,
    fontFamily: tokens.font,
    outline: "none",
    boxSizing: "border-box" as const,
    background: tokens.bgElevated,
  },
  helpText: {
    marginTop: 6,
    fontSize: 12,
    color: tokens.textSecondary,
    lineHeight: 1.6,
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderTop: `1px solid ${tokens.border}`,
  },
  testBtn: {
    padding: "6px 14px",
    border: `1px solid ${tokens.accent}`,
    borderRadius: 6,
    background: tokens.bgElevated,
    color: tokens.accent,
    fontSize: 12,
    cursor: "pointer",
  },
  saveBtn: {
    padding: "6px 20px",
    border: "none",
    borderRadius: 6,
    background: tokens.accent,
    color: tokens.userBubbleText,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: tokens.text,
    marginBottom: 12,
    marginTop: 8,
    paddingBottom: 6,
    borderBottom: `1px solid ${tokens.border}`,
  },
  divider: {
    height: 1,
    background: tokens.border,
    margin: "16px 0",
  },
  secondaryBtn: {
    padding: "6px 14px",
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: 6,
    background: tokens.bgElevated,
    color: tokens.textSecondary,
    fontSize: 12,
    cursor: "pointer",
  },
}
