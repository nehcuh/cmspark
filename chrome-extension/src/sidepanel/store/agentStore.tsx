// Global state store for the agent

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from "react"
import type { ConnectionState, Thread, Message, SkillMeta, OperationRecord, LLMConfig, SendShortcut, SecurityConfirmationRequest, LogEntry, KnowledgeMeta, SkillSelectionMode, SecurityAuditEntry, McpServerMeta, McpSelectionMode, AppEntry, AppPresetStatus, AppEnumerateCandidate, AppAddWarning, ComputerTaskEventView, ComputerTaskState, ComputerModelState, ComputerModelProgress, ComputerModelLicenseDoor, VoiceModelState, VoiceModelProgress, CapabilityLevel, FleetSnapshot, UserEnvPublic } from "../types"
import { reduceComputerTaskEvent } from "../utils/computer-utils"

export interface AgentState {
  connectionState: ConnectionState
  threads: Thread[]
  activeThreadId: string | null
  messages: Message[]
  skills: SkillMeta[]
  activeSkillIds: string[]
  operations: OperationRecord[]
  config: LLMConfig
  settingsOpen: boolean
  /** Deep-link target for settings accordion (F-UX7). Cleared after Settings applies. */
  settingsFocusSection: string | null
  tabList: chrome.tabs.Tab[]
  pinnedTabIds: number[]
  streamingContent: string
  /** Live model thinking / DeepSeek reasoning stream (cleared on chat.done). */
  streamingReasoning: string
  /**
   * Phase label while busy without tokens yet — e.g. file parse status
   * 「正在解析文档…」. Cleared when reasoning/tokens arrive or turn ends.
   */
  processingStatus: string | null
  testResult: string | null
  testVisionResult: string | null
  sendShortcut: SendShortcut
  /** M1 voice input prefs (chrome.storage.local only). */
  voiceInputEnabled: boolean
  voicePrivacyAckV1: boolean
  /**
   * Path B local STT privacy ack (chrome.storage.local `voice_privacy_ack_v2`).
   * v1 does not satisfy local engine; required before voice.stt.start.
   */
  voicePrivacyAckV2: boolean
  /**
   * Dictation+ continuous / ASR Refiner ack (chrome.storage.local `voice_privacy_ack_v3`).
   */
  voicePrivacyAckV3: boolean
  /** classic = M1 45s; continuous = opt-in long browser listen (SoT Dictation+). */
  voiceDictationMode: "classic" | "continuous"
  /** ASR Refiner after stop (default false). Requires privacy ack v3 + Companion LLM. */
  asrRefinerEnabled: boolean
  /**
   * Dictation+ D2: hold-to-talk hotkey (default off). Chord never bare fn / Win+V.
   * chrome.storage.local `dictationHotkeyEnabled` / `dictationHotkeyChord`.
   */
  dictationHotkeyEnabled: boolean
  /** e.g. Control+Shift+Space */
  dictationHotkeyChord: string
  /**
   * Prefer live word/char interim in composer (browser Web Speech).
   * When on + browser engine: continuous recommended; interim → live overlay.
   * When on + local: shorter (~8s) segments for near-real-time finals (no fake interim).
   * chrome.storage.local `voiceRealtimeStreaming`.
   */
  voiceRealtimeStreaming: boolean
  /**
   * Mtg1: meeting workbench is live-capturing (local segmented STT).
   * Mutual exclusion with composer dictation (global max-1 STT).
   */
  meetingCaptureActive: boolean
  /**
   * Composer dictation is listening / processing / refining.
   * Meeting panel refuses Start while true.
   */
  dictationCaptureActive: boolean
  /**
   * Wave D: how to show model thinking blocks.
   * auto_live = expand while streaming, collapse when done (default).
   */
  showReasoningMode: "always_collapsed" | "auto_live" | "always_open"
  /** Wave D: include reasoning in Obsidian export when true. */
  exportIncludeReasoning: boolean
  pendingSecurityConfirmations: SecurityConfirmationRequest[]
  logs: LogEntry[]
  autoSkillNames: string
  knowledgeDocs: KnowledgeMeta[]
  skillSelectionMode: SkillSelectionMode
  knowledgeSelectionMode: "auto" | "all" | "manual"
  activeKnowledgeIds: string[]
  securityAuditLog: SecurityAuditEntry[]
  companionConfig: LLMConfig | null
  isProcessing: boolean
  obsidianProfileStatus: { ok: boolean; message: string } | null
  /** Status of the last companion-side folder import (null = idle). */
  knowledgeImportStatus: { ok: boolean; message: string } | null
  /** P3: thread currently being summarized (null when idle). Drives the 🧠 button spinner. */
  summarizingThreadId: string | null
  /** Vault folder-picker state (P3.5): picking + last error. */
  vaultPicker: { picking: boolean; error: string | null }
  mcpServers: McpServerMeta[]
  mcpSelectionMode: McpSelectionMode
  activeMcpServerIds: string[]
  mcpServerFormOpen: boolean
  mcpServerFormEditing: string | null
  // App tab (WP4) — view state fed by apps.list / apps.updated broadcasts.
  /** Global apps kill-switch state (read-only view — set in config.json). */
  appsEnabled: boolean
  appEntries: AppEntry[]
  appPresets: AppPresetStatus[]
  /** Latest apps.enumerate.result (null = no enumeration run this session). */
  appCandidates: AppEnumerateCandidate[] | null
  /** Warnings from the last successful apps.add (D8 prominent render area). */
  appsWarnings: AppAddWarning[]
  /** Last apps.* error (BIOMETRIC_DENIED / POLICY_CAP_EXCEEDED / ...). */
  appsError: string | null
  /** WP6a (Finding 2): companion platform from apps.list (null = unknown /
   *  pre-WP6a companion → panel keeps the add UI enabled). */
  appsPlatform: string | null
  // 坐标 computer-use(WP4)— computer.task.event 折叠视图 + 全局坐标开关只读镜像。
  /** 当前/最近一个坐标任务的折叠状态(null = 无任务;驱动任务条 + 急停按钮)。 */
  computerTask: ComputerTaskState | null
  /** computer.state 只读镜像(null = 尚未查询;WP4 不做面板内全局开关切换)。 */
  computerCoordinateEnabled: boolean | null
  // WP5-I4 实验层模型切片——全部只读镜像,无乐观更新(设置页实验区消费):
  // 每次操作只发 WS 消息,UI 态由 companion state 广播/应答驱动刷新。
  /** computer.model.state 最新镜像(null = 尚未查询;设置页打开时拉一次)。 */
  computerModel: ComputerModelState | null
  /** 最后一条 computer.model.progress(非下载中 state 到达时由 reducer 清除)。 */
  computerModelProgress: ComputerModelProgress | null
  /** license_required 载荷(非 null = 许可证门应弹出;渲染载荷原文)。 */
  computerModelLicenseDoor: ComputerModelLicenseDoor | null
  /** 最后一条 computer.model.* 错误(family:"computer.model" 路由;LICENSE_DECLINED 等)。 */
  computerModelError: string | null
  // Path B M0 voice.model 切片——全部只读镜像,无乐观更新(设置页语音区消费;UI 见 Task 7):
  /** voice.model.state 最新镜像(null = 尚未查询;设置页打开时拉一次)。 */
  voiceModel: VoiceModelState | null
  /** 最后一条 voice.model.progress(无 model 仍 downloading 时由 reducer 清除)。 */
  voiceModelProgress: VoiceModelProgress | null
  /** voice.binary.progress — cmspark-whisper runtime download. */
  voiceBinaryProgress: {
    phase?: string
    receivedBytes?: number
    totalBytes?: number
    file?: string
  } | null
  /** 最后一条 voice.model.* 错误(family:"voice.model" 路由)。 */
  voiceModelError: string | null
  /** UI Mode P0: last browser CDP tool activity timestamp (ms) for L1 quiescence. */
  lastBrowserToolAt: number | null
  /** UI Mode P0: user pin; blocks auto-down only (never blocks up). */
  modePin: CapabilityLevel | null
  /** ADR-015 FleetStrip — null until first fleet.status */
  fleet: FleetSnapshot | null
  /**
   * Run-state W2-min: per-thread LLM/tool busy map (survives SET_ACTIVE_THREAD).
   * Keys are thread ids; true while turn/tools in flight for that thread.
   */
  threadBusyById: Record<string, boolean>
  /** Open fleet worker list popover (portal). */
  fleetListOpen: boolean
  /** ADR-019 user-env public snapshot (keys + mask only; null until first list/updated). */
  userEnv: UserEnvPublic | null
  /** ADR-019 last user_env.* error (Chinese-mapped), shown in Settings Secrets section. */
  userEnvError: string | null
  /** ADR-019 last success status line for Secrets section (e.g. 已保存). */
  userEnvStatus: string | null
  /** ADR-021 process-memory unattended desktop grant (null = unknown / not fetched). */
  unattended: {
    armed: boolean
    armedAt: number | null
    expiresAt: number | null
    includeProtocol: boolean
  } | null
  /**
   * Runtime context budget dual-truth indicator (per thread, session-scoped).
   * Set when companion drops history for the LLM; UI history remains full.
   */
  contextCompactedByThreadId: Record<
    string,
    {
      droppedCount: number
      tokensBefore: number
      tokensAfter: number
      at: number
      mode?: "m1" | "m2" | "h1"
      rollingSummary?: string
      handoff?: {
        updated_at?: string
        goals?: string[]
        decisions?: string[]
        constraints?: string[]
        open_todos?: string[]
        artifacts?: string[]
      }
    }
  >
}

export type AgentAction =
  | { type: "SET_CONNECTION"; state: ConnectionState }
  | { type: "SET_THREADS"; threads: Thread[] }
  | { type: "SET_ACTIVE_THREAD"; threadId: string }
  | { type: "ADD_MESSAGE"; message: Message }
  | { type: "UPDATE_MESSAGE"; id: string; content: string }
  | { type: "SET_MESSAGES"; messages: Message[] }
  | { type: "ADD_TOOL_CALL"; messageId: string; toolCall: any }
  | { type: "UPDATE_TOOL_CALL"; messageId: string; toolCallId: string; updates: any }
  | { type: "SET_SKILLS"; skills: SkillMeta[] }
  | { type: "TOGGLE_SKILL"; skillId: string }
  | { type: "SET_OPERATIONS"; operations: OperationRecord[] }
  | { type: "SET_CONFIG"; config: Partial<LLMConfig> }
  | { type: "TOGGLE_SETTINGS" }
  | { type: "SET_SETTINGS_OPEN"; open: boolean }
  | { type: "OPEN_SETTINGS_SECTION"; section: string }
  | { type: "CLEAR_SETTINGS_FOCUS" }
  | { type: "SET_TAB_LIST"; tabs: chrome.tabs.Tab[] }
  | { type: "TOGGLE_PIN_TAB"; tabId: number }
  | { type: "SET_PINNED_TABS"; tabIds: number[] }
  | { type: "ADD_THREAD"; thread: Thread }
  | { type: "UPSERT_THREAD"; thread: Thread }
  | { type: "REMOVE_THREAD"; threadId: string }
  | { type: "REMOVE_THREADS"; threadIds: string[] }
  | { type: "SET_STREAMING"; content: string }
  | { type: "SET_STREAMING_REASONING"; content: string }
  | { type: "SET_PROCESSING_STATUS"; status: string | null }
  | { type: "SET_TEST_RESULT"; result: string | null }
  | { type: "SET_TEST_VISION_RESULT"; result: string | null }
  | { type: "SET_SEND_SHORTCUT"; shortcut: SendShortcut }
  | {
      type: "SET_SHOW_REASONING_MODE"
      mode: "always_collapsed" | "auto_live" | "always_open"
    }
  | { type: "SET_EXPORT_INCLUDE_REASONING"; enabled: boolean }
  | { type: "SET_VOICE_INPUT_ENABLED"; enabled: boolean }
  | { type: "SET_VOICE_PRIVACY_ACK_V1"; ack: boolean }
  | { type: "SET_VOICE_PRIVACY_ACK_V2"; ack: boolean }
  | { type: "SET_VOICE_PRIVACY_ACK_V3"; ack: boolean }
  | { type: "SET_VOICE_DICTATION_MODE"; mode: "classic" | "continuous" }
  | { type: "SET_ASR_REFINER_ENABLED"; enabled: boolean }
  | { type: "SET_DICTATION_HOTKEY_ENABLED"; enabled: boolean }
  | { type: "SET_DICTATION_HOTKEY_CHORD"; chord: string }
  | {
      type: "SET_VOICE_REALTIME_STREAMING"
      enabled: boolean
      /** When true and enabling, also switch dictation mode to continuous (user toggle only). */
      preferContinuous?: boolean
    }
  | { type: "SET_MEETING_CAPTURE_ACTIVE"; active: boolean }
  | { type: "SET_DICTATION_CAPTURE_ACTIVE"; active: boolean }
  | { type: "ADD_SECURITY_CONFIRMATION"; request: SecurityConfirmationRequest }
  | { type: "REMOVE_SECURITY_CONFIRMATION"; confirmationId: string }
  | { type: "ADD_LOG"; entry: LogEntry }
  | { type: "SET_AUTO_SKILLS"; names: string }
  | { type: "SET_KNOWLEDGE_DOCS"; docs: KnowledgeMeta[] }
  | { type: "SET_SKILL_SELECTION_MODE"; mode: SkillSelectionMode }
  | { type: "SET_KNOWLEDGE_SELECTION_MODE"; mode: "auto" | "all" | "manual" }
  | { type: "TOGGLE_KNOWLEDGE"; knowledgeId: string }
  | { type: "ADD_SECURITY_AUDIT"; entry: SecurityAuditEntry }
  | { type: "SET_COMPANION_CONFIG"; config: LLMConfig }
  | { type: "SET_PROCESSING"; isProcessing: boolean }
  | { type: "SET_OBSIDIAN_PROFILE_STATUS"; status: { ok: boolean; message: string } | null }
  | { type: "SET_KNOWLEDGE_IMPORT_STATUS"; status: { ok: boolean; message: string } | null }
  | { type: "SET_SUMMARIZING_THREAD"; threadId: string | null }
  | { type: "SET_VAULT_PICKER"; picking: boolean; error: string | null }
  | { type: "SET_MCP_SERVERS"; servers: McpServerMeta[] }
  | { type: "UPDATE_MCP_SERVER_STATUS"; server: McpServerMeta }
  | { type: "TOGGLE_MCP_SERVER"; serverName: string }
  | { type: "SET_MCP_SELECTION_MODE"; mode: McpSelectionMode }
  | { type: "OPEN_MCP_SERVER_FORM"; editing: string | null }
  | { type: "CLOSE_MCP_SERVER_FORM" }
  | { type: "SET_APPS_STATE"; enabled: boolean; entries: AppEntry[]; presets?: AppPresetStatus[]; platform?: string }
  | { type: "SET_APPS_CANDIDATES"; candidates: AppEnumerateCandidate[] | null }
  | { type: "SET_APPS_WARNINGS"; warnings: AppAddWarning[] }
  | { type: "SET_APPS_ERROR"; error: string | null }
  | { type: "COMPUTER_TASK_EVENT"; event: ComputerTaskEventView }
  | { type: "COMPUTER_TASK_ABORT_ACK"; taskId: string; matched: number }
  /** Cockpit/panel hydrate from SW mirror — full snapshot, not incremental event. */
  | { type: "HYDRATE_COMPUTER_TASK"; task: ComputerTaskState | null }
  | { type: "HYDRATE_SECURITY_CONFIRMATIONS"; requests: SecurityConfirmationRequest[] }
  | { type: "SET_COMPUTER_COORDINATE_STATE"; enabled: boolean }
  | { type: "SET_COMPUTER_MODEL_STATE"; modelState: ComputerModelState }
  | { type: "SET_COMPUTER_MODEL_PROGRESS"; progress: ComputerModelProgress }
  | { type: "SET_COMPUTER_MODEL_LICENSE_DOOR"; door: ComputerModelLicenseDoor | null }
  | { type: "SET_COMPUTER_MODEL_ERROR"; error: string | null }
  | { type: "SET_VOICE_MODEL_STATE"; modelState: VoiceModelState }
  | { type: "SET_VOICE_MODEL_PROGRESS"; progress: VoiceModelProgress | null }
  | {
      type: "SET_VOICE_BINARY_PROGRESS"
      progress: {
        phase?: string
        receivedBytes?: number
        totalBytes?: number
        file?: string
      } | null
    }
  | { type: "SET_VOICE_MODEL_ERROR"; error: string | null }
  | { type: "NOTE_BROWSER_TOOL"; at?: number }
  | { type: "SET_MODE_PIN"; pin: CapabilityLevel | null }
  | { type: "SET_FLEET"; fleet: FleetSnapshot | null }
  | { type: "SET_THREAD_BUSY"; threadId: string; busy: boolean }
  | { type: "SET_FLEET_LIST_OPEN"; open: boolean }
  | { type: "SET_USER_ENV"; userEnv: UserEnvPublic }
  | { type: "SET_USER_ENV_ERROR"; error: string | null }
  | { type: "SET_USER_ENV_STATUS"; status: string | null }
  | {
      type: "SET_UNATTENDED_STATUS"
      unattended: {
        armed: boolean
        armedAt: number | null
        expiresAt: number | null
        includeProtocol: boolean
      } | null
    }
  | {
      type: "SET_CONTEXT_COMPACTED"
      threadId: string
      droppedCount: number
      tokensBefore: number
      tokensAfter: number
      mode?: "m1" | "m2" | "h1"
      rollingSummary?: string
      handoff?: {
        updated_at?: string
        goals?: string[]
        decisions?: string[]
        constraints?: string[]
        open_todos?: string[]
        artifacts?: string[]
      }
    }
  | { type: "CLEAR_CONTEXT_COMPACTED"; threadId: string }

export const initialState: AgentState = {
  connectionState: "disconnected",
  threads: [],
  activeThreadId: null,
  messages: [],
  skills: [],
  activeSkillIds: [],
  operations: [],
  config: {
    base_url: "https://api.deepseek.com/v1",
    api_key: "",
    model_name: "deepseek-v4-flash",
    temperature: 0.7,
    context_window: 128000,
    context_compaction: "auto",
    context_compaction_m2: true,
    protocol: "openai",
    client_header_profile: "none",
    trusted_domains: [],
    safety_skills_enabled: [],
    auto_approved_domains: [],
    auto_approve_dangerous: false,
    allow_all_schemes: false,
    vision_enabled: false,
    vision_api_key: "",
    vision_base_url: "http://localhost:11434/v1",
    vision_model_name: "llava:7b",
    vision_timeout_ms: 30000,
    vision_fallback: "metadata",
    file_upload_max_size: 10485760,
    file_upload_max_tokens: 50000,
    file_upload_vision: true,
  },
  settingsOpen: false,
  settingsFocusSection: null,
  tabList: [],
  pinnedTabIds: [],
  streamingContent: "",
  streamingReasoning: "",
  processingStatus: null,
  testResult: null,
  testVisionResult: null,
  sendShortcut: "Enter",
  voiceInputEnabled: true,
  showReasoningMode: "auto_live",
  exportIncludeReasoning: false,
  voicePrivacyAckV1: false,
  voicePrivacyAckV2: false,
  voicePrivacyAckV3: false,
  voiceDictationMode: "classic",
  asrRefinerEnabled: false,
  dictationHotkeyEnabled: false,
  dictationHotkeyChord: "Control+Shift+Space",
  voiceRealtimeStreaming: true,
  meetingCaptureActive: false,
  dictationCaptureActive: false,
  pendingSecurityConfirmations: [],
  logs: [],
  autoSkillNames: "",
  knowledgeDocs: [],
  skillSelectionMode: "auto",
  knowledgeSelectionMode: "auto",
  activeKnowledgeIds: [],
  securityAuditLog: [],
  companionConfig: null,
  isProcessing: false,
  obsidianProfileStatus: null,
  knowledgeImportStatus: null,
  summarizingThreadId: null,
  vaultPicker: { picking: false, error: null },
  mcpServers: [],
  mcpSelectionMode: "auto",
  activeMcpServerIds: [],
  mcpServerFormOpen: false,
  mcpServerFormEditing: null,
  appsEnabled: true,
  appEntries: [],
  appPresets: [],
  appCandidates: null,
  appsWarnings: [],
  appsError: null,
  appsPlatform: null,
  computerTask: null,
  computerCoordinateEnabled: null,
  computerModel: null,
  computerModelProgress: null,
  computerModelLicenseDoor: null,
  computerModelError: null,
  voiceModel: null,
  voiceModelProgress: null,
  voiceBinaryProgress: null,
  voiceModelError: null,
  lastBrowserToolAt: null,
  modePin: null,
  fleet: null,
  threadBusyById: {},
  fleetListOpen: false,
  userEnv: null,
  userEnvError: null,
  userEnvStatus: null,
  unattended: null,
  contextCompactedByThreadId: {},
}

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "SET_CONNECTION": {
      // P1 C-RACE-02: drop sticky busy when companion disconnects — in-flight
      // map never gets chat.done/aborted over a dead socket.
      if (action.state === "disconnected") {
        return {
          ...state,
          connectionState: action.state,
          isProcessing: false,
          threadBusyById: {},
          streamingContent: "",
          streamingReasoning: "",
        }
      }
      return { ...state, connectionState: action.state }
    }
    case "SET_THREADS": {
      // Keep active thread if it's still in the list; otherwise stay null so that
      // the upcoming thread.created (fresh blank thread) can be auto-selected.
      // Guard: companion/WS may omit threads (or send non-array) — never crash Side Panel.
      // Dual-review B2: when list includes trashed rows, match active against
      // non-trashed OR full list (active may be trashed only if user is viewing it).
      const threads = Array.isArray(action.threads) ? action.threads : []
      const activeExists = threads.some(t => t.id === state.activeThreadId)
      // Preserve active + messages when active is temporarily absent only if
      // every incoming row is trashed (only_trashed mishap) — otherwise clear.
      const onlyTrashedIncoming =
        threads.length > 0 && threads.every((t: any) => t.trashed_at)
      const nextActiveThreadId = activeExists
        ? state.activeThreadId
        : onlyTrashedIncoming
          ? state.activeThreadId
          : null
      const nextActiveThread = threads.find(t => t.id === nextActiveThreadId)
      return {
        ...state,
        threads,
        activeThreadId: nextActiveThreadId,
        // Do not wipe messages when preserving active across trash-scoped merges
        pinnedTabIds: nextActiveThread?.pinned_tabs ?? state.pinnedTabIds,
        activeSkillIds: nextActiveThread?.active_skill_ids ?? state.activeSkillIds,
        activeKnowledgeIds: nextActiveThread?.active_knowledge_ids ?? state.activeKnowledgeIds,
        skillSelectionMode: nextActiveThread?.skill_selection_mode || state.skillSelectionMode || "auto",
        knowledgeSelectionMode:
          nextActiveThread?.knowledge_selection_mode || state.knowledgeSelectionMode || "auto",
        mcpSelectionMode: nextActiveThread?.mcp_selection_mode || state.mcpSelectionMode || "auto",
        activeMcpServerIds: nextActiveThread?.active_mcp_server_ids || state.activeMcpServerIds || [],
      }
    }
    case "SET_ACTIVE_THREAD": {
      const threads = Array.isArray(state.threads) ? state.threads : []
      const activeThread = threads.find(t => t.id === action.threadId)
      return {
        ...state,
        activeThreadId: action.threadId,
        messages: [],
        streamingContent: "",
        streamingReasoning: "",
        processingStatus: null,
        isProcessing: false,
        lastBrowserToolAt: null,
        modePin: null,
        pinnedTabIds: activeThread?.pinned_tabs || [],
        activeSkillIds: activeThread?.active_skill_ids || [],
        activeKnowledgeIds: activeThread?.active_knowledge_ids || [],
        skillSelectionMode: activeThread?.skill_selection_mode || "auto",
        knowledgeSelectionMode: activeThread?.knowledge_selection_mode || "auto",
        mcpSelectionMode: activeThread?.mcp_selection_mode || "auto",
        activeMcpServerIds: activeThread?.active_mcp_server_ids || [],
      }
    }
    case "ADD_MESSAGE":
      // Dedup by id: Side Panel optimistic add + SW `chat.user` broadcast (Cockpit
      // / multi-surface) must not double-append the same user turn.
      if (state.messages.some((m) => m.id === action.message.id)) {
        return state
      }
      return { ...state, messages: [...state.messages, action.message] }
    case "UPDATE_MESSAGE":
      return {
        ...state,
        messages: state.messages.map(m =>
          m.id === action.id ? { ...m, content: action.content } : m
        ),
      }
    case "UPDATE_TOOL_CALL":
      return {
        ...state,
        messages: state.messages.map(m => {
          if (m.id !== action.messageId) return m
          return {
            ...m,
            tool_calls: (m.tool_calls || []).map(tc =>
              tc.id === action.toolCallId ? { ...tc, ...action.updates } : tc
            ),
          }
        }),
      }
    case "SET_MESSAGES":
      return { ...state, messages: action.messages }
    case "SET_SKILLS":
      // Guard: skill.list / error payloads may omit skills → never leave non-iterable state
      // (App.tsx spreads state.skills into slashSkills; undefined throws "is not iterable").
      return { ...state, skills: Array.isArray(action.skills) ? action.skills : [] }
    case "TOGGLE_SKILL":
      return {
        ...state,
        activeSkillIds: state.activeSkillIds.includes(action.skillId)
          ? state.activeSkillIds.filter(id => id !== action.skillId)
          : [...state.activeSkillIds, action.skillId],
      }
    case "SET_OPERATIONS":
      return { ...state, operations: action.operations }
    case "SET_CONFIG":
      return { ...state, config: { ...state.config, ...action.config } }
    case "SET_UNATTENDED_STATUS":
      return { ...state, unattended: action.unattended }
    case "SET_CONTEXT_COMPACTED":
      return {
        ...state,
        contextCompactedByThreadId: {
          ...state.contextCompactedByThreadId,
          [action.threadId]: {
            droppedCount: action.droppedCount,
            tokensBefore: action.tokensBefore,
            tokensAfter: action.tokensAfter,
            at: Date.now(),
            mode: action.mode,
            rollingSummary: action.rollingSummary,
            handoff: action.handoff,
          },
        },
      }
    case "CLEAR_CONTEXT_COMPACTED": {
      if (!state.contextCompactedByThreadId[action.threadId]) return state
      const next = { ...state.contextCompactedByThreadId }
      delete next[action.threadId]
      return { ...state, contextCompactedByThreadId: next }
    }
    case "SET_OBSIDIAN_PROFILE_STATUS":
      return { ...state, obsidianProfileStatus: action.status }
    case "SET_KNOWLEDGE_IMPORT_STATUS":
      return { ...state, knowledgeImportStatus: action.status }
    case "SET_SUMMARIZING_THREAD":
      return { ...state, summarizingThreadId: action.threadId }
    case "SET_VAULT_PICKER":
      return { ...state, vaultPicker: { picking: action.picking, error: action.error } }
    case "TOGGLE_SETTINGS":
      return {
        ...state,
        settingsOpen: !state.settingsOpen,
        settingsFocusSection: state.settingsOpen ? null : state.settingsFocusSection,
      }
    case "SET_SETTINGS_OPEN":
      return {
        ...state,
        settingsOpen: action.open,
        settingsFocusSection: action.open ? state.settingsFocusSection : null,
      }
    case "OPEN_SETTINGS_SECTION":
      return {
        ...state,
        settingsOpen: true,
        settingsFocusSection: action.section,
      }
    case "CLEAR_SETTINGS_FOCUS":
      return { ...state, settingsFocusSection: null }
    case "SET_TAB_LIST":
      return { ...state, tabList: action.tabs }
    case "TOGGLE_PIN_TAB":
      return {
        ...state,
        pinnedTabIds: state.pinnedTabIds.includes(action.tabId)
          ? state.pinnedTabIds.filter(id => id !== action.tabId)
          : [...state.pinnedTabIds, action.tabId],
      }
    case "SET_PINNED_TABS":
      return {
        ...state,
        pinnedTabIds: action.tabIds,
        threads: state.threads.map(t =>
          t.id === state.activeThreadId ? { ...t, pinned_tabs: action.tabIds } : t
        ),
      }
    case "ADD_THREAD":
      return {
        ...state,
        threads: [action.thread, ...state.threads],
        activeThreadId: action.thread.id,
        messages: [],
        streamingContent: "",
        streamingReasoning: "",
        processingStatus: null,
        isProcessing: false,
        lastBrowserToolAt: null,
        modePin: null,
        pinnedTabIds: action.thread.pinned_tabs || [],
      }
    case "REMOVE_THREAD": {
      const filtered = state.threads.filter(t => t.id !== action.threadId)
      const nextActive = state.activeThreadId === action.threadId
        ? (filtered[0]?.id || null)
        : state.activeThreadId
      const nextThread = filtered.find(t => t.id === nextActive)
      const { [action.threadId]: _removed, ...restBusy } = state.threadBusyById
      const clearingActive = state.activeThreadId === action.threadId
      return {
        ...state,
        threads: filtered,
        activeThreadId: nextActive,
        messages: clearingActive ? [] : state.messages,
        streamingContent: clearingActive ? "" : state.streamingContent,
        streamingReasoning: clearingActive ? "" : state.streamingReasoning,
        processingStatus: clearingActive ? null : state.processingStatus,
        pinnedTabIds: nextThread?.pinned_tabs || [],
        activeSkillIds: nextThread?.active_skill_ids || [],
        activeKnowledgeIds: nextThread?.active_knowledge_ids || [],
        threadBusyById: restBusy,
      }
    }
    case "REMOVE_THREADS": {
      const removeSet = new Set(action.threadIds || [])
      if (removeSet.size === 0) return state
      const filtered = state.threads.filter(t => !removeSet.has(t.id))
      const clearingActive =
        !!state.activeThreadId && removeSet.has(state.activeThreadId)
      const nextActive = clearingActive
        ? (filtered[0]?.id || null)
        : state.activeThreadId
      const nextThread = filtered.find(t => t.id === nextActive)
      const restBusy = { ...state.threadBusyById }
      for (const id of removeSet) delete restBusy[id]
      return {
        ...state,
        threads: filtered,
        activeThreadId: nextActive,
        messages: clearingActive ? [] : state.messages,
        streamingContent: clearingActive ? "" : state.streamingContent,
        streamingReasoning: clearingActive ? "" : state.streamingReasoning,
        processingStatus: clearingActive ? null : state.processingStatus,
        pinnedTabIds: nextThread?.pinned_tabs || [],
        activeSkillIds: nextThread?.active_skill_ids || [],
        activeKnowledgeIds: nextThread?.active_knowledge_ids || [],
        threadBusyById: restBusy,
      }
    }
    case "UPSERT_THREAD": {
      const exists = state.threads.find(t => t.id === action.thread.id)
      const isActive = action.thread.id === state.activeThreadId
      if (exists) {
        return {
          ...state,
          threads: state.threads.map(t => t.id === action.thread.id ? { ...t, ...action.thread } : t),
          pinnedTabIds: isActive
            ? action.thread.pinned_tabs || []
            : state.pinnedTabIds,
          activeSkillIds: isActive
            ? (action.thread.active_skill_ids || state.activeSkillIds)
            : state.activeSkillIds,
          activeKnowledgeIds: isActive
            ? (action.thread.active_knowledge_ids ?? state.activeKnowledgeIds)
            : state.activeKnowledgeIds,
          knowledgeSelectionMode: isActive
            ? (action.thread.knowledge_selection_mode || state.knowledgeSelectionMode)
            : state.knowledgeSelectionMode,
        }
      }
      return {
        ...state,
        threads: [action.thread, ...state.threads],
      }
    }
    case "SET_STREAMING":
      return { ...state, streamingContent: action.content }
    case "SET_STREAMING_REASONING":
      return { ...state, streamingReasoning: action.content }
    case "SET_PROCESSING_STATUS":
      return { ...state, processingStatus: action.status }
    case "SET_TEST_RESULT":
      return { ...state, testResult: action.result }
    case "SET_TEST_VISION_RESULT":
      return { ...state, testVisionResult: action.result }
    case "SET_SEND_SHORTCUT":
      chrome.storage.local.set({ sendShortcut: action.shortcut })
      return { ...state, sendShortcut: action.shortcut }
    case "SET_SHOW_REASONING_MODE": {
      const mode = action.mode
      chrome.storage.local.set({ "cmspark.ui.show_reasoning": mode })
      return { ...state, showReasoningMode: mode }
    }
    case "SET_EXPORT_INCLUDE_REASONING":
      chrome.storage.local.set({ "cmspark.ui.export_include_reasoning": action.enabled })
      return { ...state, exportIncludeReasoning: action.enabled }
    case "SET_VOICE_INPUT_ENABLED":
      chrome.storage.local.set({ voiceInputEnabled: action.enabled })
      return { ...state, voiceInputEnabled: action.enabled }
    case "SET_VOICE_PRIVACY_ACK_V1":
      chrome.storage.local.set({ voice_privacy_ack_v1: action.ack })
      return { ...state, voicePrivacyAckV1: action.ack }
    case "SET_VOICE_PRIVACY_ACK_V2":
      chrome.storage.local.set({ voice_privacy_ack_v2: action.ack })
      return { ...state, voicePrivacyAckV2: action.ack }
    case "SET_VOICE_PRIVACY_ACK_V3":
      chrome.storage.local.set({ voice_privacy_ack_v3: action.ack })
      return { ...state, voicePrivacyAckV3: action.ack }
    case "SET_MEETING_CAPTURE_ACTIVE":
      return { ...state, meetingCaptureActive: action.active === true }
    case "SET_DICTATION_CAPTURE_ACTIVE":
      return { ...state, dictationCaptureActive: action.active === true }
    case "SET_VOICE_DICTATION_MODE": {
      const mode = action.mode === "continuous" ? "continuous" : "classic"
      chrome.storage.local.set({ voiceDictationMode: mode })
      return { ...state, voiceDictationMode: mode }
    }
    case "SET_ASR_REFINER_ENABLED":
      chrome.storage.local.set({ asrRefinerEnabled: action.enabled })
      return { ...state, asrRefinerEnabled: action.enabled }
    case "SET_DICTATION_HOTKEY_ENABLED":
      chrome.storage.local.set({ dictationHotkeyEnabled: action.enabled === true })
      return { ...state, dictationHotkeyEnabled: action.enabled === true }
    case "SET_DICTATION_HOTKEY_CHORD": {
      const chord =
        typeof action.chord === "string" && action.chord.trim()
          ? action.chord.trim()
          : "Control+Shift+Space"
      chrome.storage.local.set({ dictationHotkeyChord: chord })
      return { ...state, dictationHotkeyChord: chord }
    }
    case "SET_VOICE_REALTIME_STREAMING": {
      const enabled = action.enabled === true
      chrome.storage.local.set({ voiceRealtimeStreaming: enabled })
      // User toggle only: pair with continuous (do not force on storage hydrate).
      if (enabled && action.preferContinuous === true) {
        chrome.storage.local.set({ voiceDictationMode: "continuous" })
        return {
          ...state,
          voiceRealtimeStreaming: true,
          voiceDictationMode: "continuous",
        }
      }
      return { ...state, voiceRealtimeStreaming: enabled }
    }
    case "ADD_SECURITY_CONFIRMATION":
      return {
        ...state,
        pendingSecurityConfirmations: [
          ...state.pendingSecurityConfirmations.filter(r => r.confirmation_id !== action.request.confirmation_id),
          action.request,
        ],
      }
    case "REMOVE_SECURITY_CONFIRMATION":
      return {
        ...state,
        pendingSecurityConfirmations: state.pendingSecurityConfirmations.filter(r => r.confirmation_id !== action.confirmationId),
      }
    case "ADD_LOG":
      return { ...state, logs: [...state.logs.slice(-99), action.entry] }
    case "SET_AUTO_SKILLS":
      return { ...state, autoSkillNames: action.names }
    case "SET_KNOWLEDGE_DOCS":
      return { ...state, knowledgeDocs: action.docs }
    case "SET_SKILL_SELECTION_MODE":
      return { ...state, skillSelectionMode: action.mode }
    case "SET_KNOWLEDGE_SELECTION_MODE":
      return { ...state, knowledgeSelectionMode: action.mode }
    case "TOGGLE_KNOWLEDGE":
      return {
        ...state,
        activeKnowledgeIds: state.activeKnowledgeIds.includes(action.knowledgeId)
          ? state.activeKnowledgeIds.filter(id => id !== action.knowledgeId)
          : [...state.activeKnowledgeIds, action.knowledgeId],
      }
    case "ADD_SECURITY_AUDIT":
      return { ...state, securityAuditLog: [...state.securityAuditLog.slice(-199), action.entry] }
    case "SET_COMPANION_CONFIG":
      return { ...state, companionConfig: action.config }
    case "SET_PROCESSING":
      return { ...state, isProcessing: action.isProcessing }
    case "SET_THREAD_BUSY": {
      const id = action.threadId
      if (!id) return state
      if (action.busy) {
        if (state.threadBusyById[id]) return state
        return { ...state, threadBusyById: { ...state.threadBusyById, [id]: true } }
      }
      if (!state.threadBusyById[id]) return state
      const { [id]: _, ...rest } = state.threadBusyById
      return { ...state, threadBusyById: rest }
    }
    case "SET_FLEET_LIST_OPEN":
      return { ...state, fleetListOpen: action.open }
    case "SET_MCP_SERVERS":
      return { ...state, mcpServers: Array.isArray(action.servers) ? action.servers : [] }
    case "UPDATE_MCP_SERVER_STATUS": {
      const prev = Array.isArray(state.mcpServers) ? state.mcpServers : []
      const exists = prev.some(s => s.name === action.server.name)
      const servers = exists
        ? prev.map(s => s.name === action.server.name ? action.server : s)
        : [...prev, action.server]
      return { ...state, mcpServers: servers }
    }
    case "TOGGLE_MCP_SERVER": {
      const ids = Array.isArray(state.activeMcpServerIds) ? state.activeMcpServerIds : []
      return {
        ...state,
        activeMcpServerIds: ids.includes(action.serverName)
          ? ids.filter(id => id !== action.serverName)
          : [...ids, action.serverName],
      }
    }
    case "SET_MCP_SELECTION_MODE":
      return { ...state, mcpSelectionMode: action.mode }
    case "OPEN_MCP_SERVER_FORM":
      return { ...state, mcpServerFormOpen: true, mcpServerFormEditing: action.editing }
    case "CLOSE_MCP_SERVER_FORM":
      return { ...state, mcpServerFormOpen: false, mcpServerFormEditing: null }
    case "SET_APPS_STATE":
      // apps.updated carries no presets array (and no platform) — keep the
      // last known values for both.
      return {
        ...state,
        appsEnabled: action.enabled,
        appEntries: action.entries,
        appPresets: action.presets ?? state.appPresets,
        appsPlatform: action.platform ?? state.appsPlatform,
      }
    case "SET_APPS_CANDIDATES":
      return { ...state, appCandidates: action.candidates }
    case "SET_APPS_WARNINGS":
      return { ...state, appsWarnings: action.warnings }
    case "SET_APPS_ERROR":
      return { ...state, appsError: action.error }
    case "COMPUTER_TASK_EVENT":
      // 状态机(含 P4 懒创建/完结后丢弃)全部在纯函数 reduceComputerTaskEvent 里。
      return { ...state, computerTask: reduceComputerTaskEvent(state.computerTask, action.event) }
    case "COMPUTER_TASK_ABORT_ACK": {
      // matched>0 才置位;task_id="*"(急停全部)对当前任务同样生效。
      const t = state.computerTask
      if (!t || action.matched <= 0) return state
      if (t.taskId !== action.taskId && action.taskId !== "*") return state
      return { ...state, computerTask: { ...t, abortAcked: true } }
    }
    case "HYDRATE_COMPUTER_TASK":
      return { ...state, computerTask: action.task }
    case "HYDRATE_SECURITY_CONFIRMATIONS":
      return {
        ...state,
        pendingSecurityConfirmations: Array.isArray(action.requests) ? action.requests : [],
      }
    case "SET_COMPUTER_COORDINATE_STATE":
      return { ...state, computerCoordinateEnabled: action.enabled }
    case "SET_COMPUTER_MODEL_STATE":
      // 非下载中的 state 到达 = 下载已完结/失败/无下载——清掉陈旧进度镜像。
      return {
        ...state,
        computerModel: action.modelState,
        computerModelProgress:
          action.modelState.modelStatus === "downloading" ? state.computerModelProgress : null,
      }
    case "SET_COMPUTER_MODEL_PROGRESS":
      return { ...state, computerModelProgress: action.progress }
    case "SET_COMPUTER_MODEL_LICENSE_DOOR":
      return { ...state, computerModelLicenseDoor: action.door }
    case "SET_COMPUTER_MODEL_ERROR":
      return { ...state, computerModelError: action.error }
    case "SET_VOICE_MODEL_STATE": {
      // Any model still downloading → keep progress; otherwise clear stale %.
      const anyDownloading = Object.values(action.modelState.models).some(
        (m) => m.status === "downloading",
      )
      const binaryReady = action.modelState.binary?.status === "ready"
      return {
        ...state,
        voiceModel: action.modelState,
        voiceModelProgress: anyDownloading ? state.voiceModelProgress : null,
        voiceBinaryProgress: binaryReady ? null : state.voiceBinaryProgress,
      }
    }
    case "SET_VOICE_MODEL_PROGRESS":
      return { ...state, voiceModelProgress: action.progress }
    case "SET_VOICE_BINARY_PROGRESS":
      return { ...state, voiceBinaryProgress: action.progress }
    case "SET_VOICE_MODEL_ERROR":
      return { ...state, voiceModelError: action.error }
    case "NOTE_BROWSER_TOOL":
      return { ...state, lastBrowserToolAt: action.at ?? Date.now() }
    case "SET_MODE_PIN":
      return { ...state, modePin: action.pin }
    case "SET_FLEET":
      return { ...state, fleet: action.fleet }
    case "SET_USER_ENV":
      return {
        ...state,
        userEnv: action.userEnv,
        userEnvError: null,
      }
    case "SET_USER_ENV_ERROR":
      return { ...state, userEnvError: action.error, userEnvStatus: action.error ? null : state.userEnvStatus }
    case "SET_USER_ENV_STATUS":
      return { ...state, userEnvStatus: action.status, userEnvError: action.status ? null : state.userEnvError }
    default:
      return state
  }
}

const AgentContext = createContext<{ state: AgentState; dispatch: Dispatch<AgentAction> } | null>(null)

export function AgentStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(agentReducer, initialState)
  return (
    <AgentContext.Provider value={{ state, dispatch }}>
      {children}
    </AgentContext.Provider>
  )
}

export function useAgentStore() {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error("useAgentStore must be used within AgentStoreProvider")
  return ctx
}
