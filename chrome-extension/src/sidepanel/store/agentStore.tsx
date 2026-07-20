// Global state store for the agent

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from "react"
import type { ConnectionState, Thread, Message, SkillMeta, OperationRecord, LLMConfig, SendShortcut, SecurityConfirmationRequest, LogEntry, KnowledgeMeta, SkillSelectionMode, SecurityAuditEntry, McpServerMeta, McpSelectionMode, AppEntry, AppPresetStatus, AppEnumerateCandidate, AppAddWarning, ComputerTaskEventView, ComputerTaskState, ComputerModelState, ComputerModelProgress, ComputerModelLicenseDoor } from "../types"
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
  tabList: chrome.tabs.Tab[]
  pinnedTabIds: number[]
  streamingContent: string
  testResult: string | null
  testVisionResult: string | null
  sendShortcut: SendShortcut
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
  | { type: "SET_TAB_LIST"; tabs: chrome.tabs.Tab[] }
  | { type: "TOGGLE_PIN_TAB"; tabId: number }
  | { type: "SET_PINNED_TABS"; tabIds: number[] }
  | { type: "ADD_THREAD"; thread: Thread }
  | { type: "UPSERT_THREAD"; thread: Thread }
  | { type: "REMOVE_THREAD"; threadId: string }
  | { type: "SET_STREAMING"; content: string }
  | { type: "SET_TEST_RESULT"; result: string | null }
  | { type: "SET_TEST_VISION_RESULT"; result: string | null }
  | { type: "SET_SEND_SHORTCUT"; shortcut: SendShortcut }
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
  | { type: "SET_COMPUTER_COORDINATE_STATE"; enabled: boolean }
  | { type: "SET_COMPUTER_MODEL_STATE"; modelState: ComputerModelState }
  | { type: "SET_COMPUTER_MODEL_PROGRESS"; progress: ComputerModelProgress }
  | { type: "SET_COMPUTER_MODEL_LICENSE_DOOR"; door: ComputerModelLicenseDoor | null }
  | { type: "SET_COMPUTER_MODEL_ERROR"; error: string | null }
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
    context_window: 1000000,
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
  tabList: [],
  pinnedTabIds: [],
  streamingContent: "",
  testResult: null,
  testVisionResult: null,
  sendShortcut: "Enter",
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
}

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "SET_CONNECTION":
      return { ...state, connectionState: action.state }
    case "SET_THREADS": {
      // Keep active thread if it's still in the list; otherwise stay null so that
      // the upcoming thread.created (fresh blank thread) can be auto-selected.
      const activeExists = action.threads.some(t => t.id === state.activeThreadId)
      const nextActiveThreadId = activeExists ? state.activeThreadId : null
      const nextActiveThread = action.threads.find(t => t.id === nextActiveThreadId)
      return {
        ...state,
        threads: action.threads,
        activeThreadId: nextActiveThreadId,
        pinnedTabIds: nextActiveThread?.pinned_tabs || [],
        activeSkillIds: nextActiveThread?.active_skill_ids || [],
        skillSelectionMode: nextActiveThread?.skill_selection_mode || "auto",
        knowledgeSelectionMode: nextActiveThread?.knowledge_selection_mode || "auto",
        mcpSelectionMode: nextActiveThread?.mcp_selection_mode || "auto",
        activeMcpServerIds: nextActiveThread?.active_mcp_server_ids || [],
      }
    }
    case "SET_ACTIVE_THREAD": {
      const activeThread = state.threads.find(t => t.id === action.threadId)
      return {
        ...state,
        activeThreadId: action.threadId,
        messages: [],
        streamingContent: "",
        isProcessing: false,
        pinnedTabIds: activeThread?.pinned_tabs || [],
        activeSkillIds: activeThread?.active_skill_ids || [],
        skillSelectionMode: activeThread?.skill_selection_mode || "auto",
        knowledgeSelectionMode: activeThread?.knowledge_selection_mode || "auto",
        mcpSelectionMode: activeThread?.mcp_selection_mode || "auto",
        activeMcpServerIds: activeThread?.active_mcp_server_ids || [],
      }
    }
    case "ADD_MESSAGE":
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
      return { ...state, skills: action.skills }
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
    case "SET_OBSIDIAN_PROFILE_STATUS":
      return { ...state, obsidianProfileStatus: action.status }
    case "SET_KNOWLEDGE_IMPORT_STATUS":
      return { ...state, knowledgeImportStatus: action.status }
    case "SET_SUMMARIZING_THREAD":
      return { ...state, summarizingThreadId: action.threadId }
    case "SET_VAULT_PICKER":
      return { ...state, vaultPicker: { picking: action.picking, error: action.error } }
    case "TOGGLE_SETTINGS":
      return { ...state, settingsOpen: !state.settingsOpen }
    case "SET_SETTINGS_OPEN":
      return { ...state, settingsOpen: action.open }
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
        isProcessing: false,
        pinnedTabIds: action.thread.pinned_tabs || [],
      }
    case "REMOVE_THREAD": {
      const filtered = state.threads.filter(t => t.id !== action.threadId)
      const nextActive = state.activeThreadId === action.threadId
        ? (filtered[0]?.id || null)
        : state.activeThreadId
      const nextThread = filtered.find(t => t.id === nextActive)
      return {
        ...state,
        threads: filtered,
        activeThreadId: nextActive,
        messages: state.activeThreadId === action.threadId ? [] : state.messages,
        streamingContent: state.activeThreadId === action.threadId ? "" : state.streamingContent,
        pinnedTabIds: nextThread?.pinned_tabs || [],
        activeSkillIds: nextThread?.active_skill_ids || [],
      }
    }
    case "UPSERT_THREAD": {
      const exists = state.threads.find(t => t.id === action.thread.id)
      if (exists) {
        return {
          ...state,
          threads: state.threads.map(t => t.id === action.thread.id ? { ...t, ...action.thread } : t),
          pinnedTabIds: action.thread.id === state.activeThreadId
            ? action.thread.pinned_tabs || []
            : state.pinnedTabIds,
        }
      }
      return {
        ...state,
        threads: [action.thread, ...state.threads],
      }
    }
    case "SET_STREAMING":
      return { ...state, streamingContent: action.content }
    case "SET_TEST_RESULT":
      return { ...state, testResult: action.result }
    case "SET_TEST_VISION_RESULT":
      return { ...state, testVisionResult: action.result }
    case "SET_SEND_SHORTCUT":
      chrome.storage.local.set({ sendShortcut: action.shortcut })
      return { ...state, sendShortcut: action.shortcut }
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
    case "SET_MCP_SERVERS":
      return { ...state, mcpServers: action.servers }
    case "UPDATE_MCP_SERVER_STATUS": {
      const exists = state.mcpServers.some(s => s.name === action.server.name)
      const servers = exists
        ? state.mcpServers.map(s => s.name === action.server.name ? action.server : s)
        : [...state.mcpServers, action.server]
      return { ...state, mcpServers: servers }
    }
    case "TOGGLE_MCP_SERVER":
      return {
        ...state,
        activeMcpServerIds: state.activeMcpServerIds.includes(action.serverName)
          ? state.activeMcpServerIds.filter(id => id !== action.serverName)
          : [...state.activeMcpServerIds, action.serverName],
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
