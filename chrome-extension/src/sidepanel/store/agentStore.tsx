// Global state store for the agent

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from "react"
import type { ConnectionState, Thread, Message, SkillMeta, OperationRecord, LLMConfig } from "../types"

interface AgentState {
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
}

type AgentAction =
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
  | { type: "ADD_THREAD"; thread: Thread }
  | { type: "SET_STREAMING"; content: string }

const initialState: AgentState = {
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
    model_name: "deepseek-v4-pro",
    temperature: 0.7,
    context_window: 128000,
  },
  settingsOpen: false,
  tabList: [],
  pinnedTabIds: [],
  streamingContent: "",
}

function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "SET_CONNECTION":
      return { ...state, connectionState: action.state }
    case "SET_THREADS":
      return { ...state, threads: action.threads }
    case "SET_ACTIVE_THREAD":
      return { ...state, activeThreadId: action.threadId, messages: [], streamingContent: "" }
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] }
    case "UPDATE_MESSAGE":
      return {
        ...state,
        messages: state.messages.map(m =>
          m.id === action.id ? { ...m, content: action.content } : m
        ),
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
    case "ADD_THREAD":
      return {
        ...state,
        threads: [action.thread, ...state.threads],
        activeThreadId: action.thread.id,
        messages: [],
        streamingContent: "",
      }
    case "SET_STREAMING":
      return { ...state, streamingContent: action.content }
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
