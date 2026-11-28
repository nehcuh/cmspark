import type { Message, Thread } from "../types"
import { decideActiveThreadList } from "../navigation/startup-destination"
import { codingSessionMembership, pruneCodingSessionCache } from "../utils/coding-session-cache"
import type { AgentState } from "./agentStore"

/** The selected transcript and one previous transcript fit in the panel cache. */
export const MESSAGES_BY_THREAD_LRU = 2

export function cacheThreadMessages(cache: Record<string, Message[]>, order: string[], threadId: string, messages?: Message[]) {
  const nextCache = { ...cache }
  if (messages) nextCache[threadId] = messages
  const nextOrder = order.filter(id => id !== threadId)
  nextOrder.push(threadId)
  while (nextOrder.length > MESSAGES_BY_THREAD_LRU) delete nextCache[nextOrder.shift()!]
  return { cache: nextCache, order: nextOrder }
}

function threadSettings(thread?: Thread, previous?: AgentState) {
  return {
    pinnedTabIds: thread?.pinned_tabs ?? previous?.pinnedTabIds ?? [],
    activeSkillIds: thread?.active_skill_ids ?? previous?.activeSkillIds ?? [],
    activeKnowledgeIds: thread?.active_knowledge_ids ?? previous?.activeKnowledgeIds ?? [],
    skillSelectionMode: thread?.skill_selection_mode || previous?.skillSelectionMode || "auto",
    knowledgeSelectionMode: thread?.knowledge_selection_mode || previous?.knowledgeSelectionMode || "auto",
    knowledgeSmartMatch: thread?.knowledge_smart_match !== false,
    knowledgeRouteByGroup: thread?.knowledge_route_by_group === true,
    mcpSelectionMode: thread?.mcp_selection_mode || previous?.mcpSelectionMode || "auto",
    activeMcpServerIds: thread?.active_mcp_server_ids ?? previous?.activeMcpServerIds ?? [],
  }
}

export function selectThread(
  state: AgentState,
  threadId: string | null,
  reason: "select" | "created" | "removed" = "select",
): AgentState {
  if (reason === "select" && threadId && threadId === state.activeThreadId) return state
  const threads = Array.isArray(state.threads) ? state.threads : []
  const thread = threads.find(row => row.id === threadId)
  let cached = { cache: state.messagesByThreadId, order: state.messagesCacheOrder }
  if (reason !== "removed" && state.activeThreadId && state.activeThreadId !== threadId &&
      !(state.hydrating && state.messages.length === 0)) {
    cached = cacheThreadMessages(cached.cache, cached.order, state.activeThreadId, state.messages)
  }
  if (threadId) {
    cached = cacheThreadMessages(cached.cache, cached.order, threadId, reason === "created" ? [] : undefined)
  }
  const hit = !!threadId && Object.hasOwn(cached.cache, threadId)
  const hydrating = !!threadId && !hit
  const records = pruneCodingSessionCache(state.codingSessionsById, threadId, state.codingSessionIdByThread)
  return {
    ...state,
    ...threadSettings(thread),
    activeThreadId: threadId,
    activeThreadSelectionRevision: state.activeThreadSelectionRevision + 1,
    messages: hit && threadId ? cached.cache[threadId]! : [],
    messagesByThreadId: cached.cache,
    messagesCacheOrder: cached.order,
    hydrating,
    historyLoadStatus: reason === "removed" && threadId ? "refresh" : "ready",
    streamingContent: "",
    streamingReasoning: "",
    processingStatus: hydrating ? "加载中" : null,
    isProcessing: false,
    lastBrowserToolAt: null,
    modePin: null,
    workspaceHints: null,
    overlayStandby: null,
    codingHistory: null,
    codingOperationError: null,
    codingManualEntry: null,
    codingSessionsById: records,
    codingSessionIdsByThread: codingSessionMembership(records, state.codingSessionIdsByThread, state.codingSessionIdByThread),
  }
}

function pruneFleetSuggestions(cards: AgentState["fleetSuggestByThreadId"], threads: Thread[]) {
  const keep = new Set(threads.map(thread => thread.id))
  const removed = Object.keys(cards).filter(id => !keep.has(id))
  if (!removed.length) return cards
  const next = { ...cards }
  for (const id of removed) delete next[id]
  return next
}

export function removeThreads(state: AgentState, ids: readonly string[]): AgentState {
  if (!ids.length) return state
  const removed = new Set(ids)
  const threads = state.threads.filter(row => !removed.has(row.id))
  const messagesByThreadId = { ...state.messagesByThreadId }
  const threadBusyById = { ...state.threadBusyById }
  for (const id of removed) {
    delete messagesByThreadId[id]
    delete threadBusyById[id]
  }
  const next = {
    ...state, threads, messagesByThreadId, threadBusyById,
    messagesCacheOrder: state.messagesCacheOrder.filter(id => !removed.has(id)),
    fleetSuggestByThreadId: pruneFleetSuggestions(state.fleetSuggestByThreadId, threads),
  }
  if (!state.activeThreadId || !removed.has(state.activeThreadId)) return next
  return selectThread(next, threads.find(row => !row.trashed_at)?.id ?? null, "removed")
}

export function upsertThread(state: AgentState, patch: Thread): AgentState {
  const threads = state.threads.some(row => row.id === patch.id)
    ? state.threads.map(row => row.id === patch.id ? { ...row, ...patch } : row)
    : [patch, ...state.threads]
  if (patch.id !== state.activeThreadId) return { ...state, threads }
  // A metadata patch may omit an optimistic setting that has not been acknowledged yet.
  return {
    ...state, threads, ...threadSettings(patch, state),
    knowledgeSmartMatch: patch.knowledge_smart_match ?? state.knowledgeSmartMatch,
    knowledgeRouteByGroup: patch.knowledge_route_by_group ?? state.knowledgeRouteByGroup,
  }
}

export function updateThreadList(state: AgentState, threads: Thread[], scope?: "active" | "all" | "trash"): AgentState {
  if (scope === "all" || scope === "trash") return { ...state, threads }
  const signature = threads.map(thread => thread.id).join("\n")
  const next = {
    ...state, threads,
    fleetSuggestByThreadId: pruneFleetSuggestions(state.fleetSuggestByThreadId, threads),
    threadListArrived: true,
    threadListSignature: signature,
    threadListEpoch: signature === state.threadListSignature ? state.threadListEpoch : state.threadListEpoch + 1,
  }
  if (threads.length && threads.every(row => row.trashed_at)) return next
  const selected = threads.find(row => row.id === state.activeThreadId && !row.trashed_at)
  if (selected) return { ...next, ...threadSettings(selected, state) }
  const decision = decideActiveThreadList({
    activeThreadId: state.activeThreadId, rememberedThreadId: state.navigationRemembered,
    incoming: threads, listScope: "active",
  })
  if (decision.selectThread) return { ...selectThread(next, decision.selectThread), historyLoadStatus: "refresh" }
  const home = state.activeThreadId ? selectThread(next, null) : next
  return {
    ...home, navigationLayer: "projects", navigationProjectId: null, navigationRemembered: null,
    navigationHomeCopy: decision.homeCopy, messages: [],
  }
}
