// Global state store for the agent

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from "react"
import type { ConnectionState, Thread, Message, SkillMeta, OperationRecord, LLMConfig, SendShortcut, SecurityConfirmationRequest, LogEntry, KnowledgeMeta, SkillSelectionMode } from "../types"

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
  sendShortcut: SendShortcut
  pendingSecurityConfirmations: SecurityConfirmationRequest[]
  logs: LogEntry[]
  autoSkillNames: string
  knowledgeDocs: KnowledgeMeta[]
  skillSelectionMode: SkillSelectionMode
  knowledgeSelectionMode: "auto" | "all" | "manual"
  activeKnowledgeIds: string[]
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
  | { type: "SET_TAB_LIST"; tabs: chrome.tabs.Tab[] }
  | { type: "TOGGLE_PIN_TAB"; tabId: number }
  | { type: "SET_PINNED_TABS"; tabIds: number[] }
  | { type: "ADD_THREAD"; thread: Thread }
  | { type: "UPSERT_THREAD"; thread: Thread }
  | { type: "REMOVE_THREAD"; threadId: string }
  | { type: "SET_STREAMING"; content: string }
  | { type: "SET_TEST_RESULT"; result: string | null }
  | { type: "SET_SEND_SHORTCUT"; shortcut: SendShortcut }
  | { type: "ADD_SECURITY_CONFIRMATION"; request: SecurityConfirmationRequest }
  | { type: "REMOVE_SECURITY_CONFIRMATION"; confirmationId: string }
  | { type: "ADD_LOG"; entry: LogEntry }
  | { type: "SET_AUTO_SKILLS"; names: string }
  | { type: "SET_KNOWLEDGE_DOCS"; docs: KnowledgeMeta[] }
  | { type: "SET_SKILL_SELECTION_MODE"; mode: SkillSelectionMode }
  | { type: "SET_KNOWLEDGE_SELECTION_MODE"; mode: "auto" | "all" | "manual" }
  | { type: "TOGGLE_KNOWLEDGE"; knowledgeId: string }
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
  },
  settingsOpen: false,
  tabList: [],
  pinnedTabIds: [],
  streamingContent: "",
  testResult: null,
  sendShortcut: "Enter",
  pendingSecurityConfirmations: [],
  logs: [],
  autoSkillNames: "",
  knowledgeDocs: [],
  skillSelectionMode: "auto",
  knowledgeSelectionMode: "auto",
  activeKnowledgeIds: [],
}

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "SET_CONNECTION":
      return { ...state, connectionState: action.state }
    case "SET_THREADS": {
      // Auto-select first thread if no active or active thread no longer exists
      const activeExists = action.threads.some(t => t.id === state.activeThreadId)
      const nextActiveThreadId = activeExists ? state.activeThreadId : (action.threads[0]?.id || null)
      const nextActiveThread = action.threads.find(t => t.id === nextActiveThreadId)
      return {
        ...state,
        threads: action.threads,
        activeThreadId: nextActiveThreadId,
        pinnedTabIds: nextActiveThread?.pinned_tabs || [],
        activeSkillIds: nextActiveThread?.active_skill_ids || [],
        skillSelectionMode: nextActiveThread?.skill_selection_mode || "auto",
        knowledgeSelectionMode: nextActiveThread?.knowledge_selection_mode || "auto",
      }
    }
    case "SET_ACTIVE_THREAD": {
      const activeThread = state.threads.find(t => t.id === action.threadId)
      return {
        ...state,
        activeThreadId: action.threadId,
        messages: [],
        streamingContent: "",
        pinnedTabIds: activeThread?.pinned_tabs || [],
        activeSkillIds: activeThread?.active_skill_ids || [],
        skillSelectionMode: activeThread?.skill_selection_mode || "auto",
        knowledgeSelectionMode: activeThread?.knowledge_selection_mode || "auto",
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
    case "TOGGLE_SETTINGS":
      return { ...state, settingsOpen: !state.settingsOpen }
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
