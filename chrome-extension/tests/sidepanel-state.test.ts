import test from "node:test"
import assert from "node:assert/strict"
import { agentReducer, initialState, type AgentState } from "../src/sidepanel/store/agentStore"
import { normalizeConfig, requestInitialSidePanelData } from "../src/sidepanel/hooks/useWebSocket"
import type { SkillMeta } from "../src/sidepanel/types"

function stateWithThreads(): AgentState {
  return {
    ...initialState,
    activeThreadId: "thread-a",
    threads: [
      {
        id: "thread-a",
        alias: "A",
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [101],
        active_skill_ids: ["browse"],
        skill_selection_mode: "manual",
        knowledge_selection_mode: "manual",
      },
      {
        id: "thread-b",
        alias: "B",
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [202, 303],
        active_skill_ids: ["browse"],
        skill_selection_mode: "all",
        knowledge_selection_mode: "all",
      },
    ],
    pinnedTabIds: [101],
    skillSelectionMode: "manual",
    knowledgeSelectionMode: "manual",
  }
}

test("SET_ACTIVE_THREAD restores pinned tabs, skillSelectionMode, and knowledgeSelectionMode from thread metadata", () => {
  const next = agentReducer(stateWithThreads(), { type: "SET_ACTIVE_THREAD", threadId: "thread-b" })

  assert.equal(next.activeThreadId, "thread-b")
  assert.deepEqual(next.pinnedTabIds, [202, 303])
  assert.deepEqual(next.messages, [])
  assert.equal(next.skillSelectionMode, "all")
  assert.equal(next.knowledgeSelectionMode, "all")
})

test("SET_ACTIVE_THREAD defaults skillSelectionMode to auto when thread has no mode", () => {
  const s = stateWithThreads()
  const threadWithoutMode = { ...s.threads[1], skill_selection_mode: undefined, knowledge_selection_mode: undefined }
  const state = { ...s, threads: [s.threads[0], threadWithoutMode] }
  const next = agentReducer(state, { type: "SET_ACTIVE_THREAD", threadId: "thread-b" })

  assert.equal(next.skillSelectionMode, "auto")
  assert.equal(next.knowledgeSelectionMode, "auto")
})

test("SET_PINNED_TABS updates active thread metadata", () => {
  const next = agentReducer(stateWithThreads(), { type: "SET_PINNED_TABS", tabIds: [404] })

  assert.deepEqual(next.pinnedTabIds, [404])
  assert.deepEqual(next.threads.find(t => t.id === "thread-a")?.pinned_tabs, [404])
  assert.deepEqual(next.threads.find(t => t.id === "thread-b")?.pinned_tabs, [202, 303])
})

test("normalizeConfig flattens companion config and keeps masked API keys out of UI state", () => {
  assert.deepEqual(normalizeConfig({
    llm: {
      base_url: "https://example.test/v1",
      api_key: "***",
      model_name: "model-x",
      temperature: 0.2,
      context_window: 4096,
    },
    trusted_domains: ["example.com", "*.company.com"],
  }), {
    base_url: "https://example.test/v1",
    api_key: "",
    model_name: "model-x",
    temperature: 0.2,
    context_window: 4096,
    trusted_domains: ["example.com", "*.company.com"],
  })
})

test("security confirmation requests are queued and removable", () => {
  const request = {
    confirmation_id: "confirm-1",
    tool_name: "evaluate",
    dangerous_apis: ["fetch("],
    code_preview: "fetch('/api')",
    risk_score: 80,
    risk_category: "eval",
    risk_level: "high" as const,
    auto_confirm_eligible: false,
  }

  const queued = agentReducer(initialState, { type: "ADD_SECURITY_CONFIRMATION", request })
  assert.equal(queued.pendingSecurityConfirmations.length, 1)
  assert.deepEqual(queued.pendingSecurityConfirmations[0], request)

  const removed = agentReducer(queued, { type: "REMOVE_SECURITY_CONFIRMATION", confirmationId: "confirm-1" })
  assert.equal(removed.pendingSecurityConfirmations.length, 0)
})

test("initial side panel sync requests threads, skills, and config exactly once per connection", () => {
  const sent: object[] = []
  const initializedRef = { current: false }

  assert.equal(requestInitialSidePanelData((message) => sent.push(message), initializedRef), true)
  assert.deepEqual(sent, [{ type: "thread.list" }, { type: "skill.list" }, { type: "config.get" }])
  assert.equal(initializedRef.current, true)

  assert.equal(requestInitialSidePanelData((message) => sent.push(message), initializedRef), false)
  assert.deepEqual(sent, [{ type: "thread.list" }, { type: "skill.list" }, { type: "config.get" }])
})

test("SET_THREADS auto-selects first thread and syncs pinned tabs and skillSelectionMode", () => {
  const s = { ...initialState, threads: [], activeThreadId: null }
  const next = agentReducer(s, {
    type: "SET_THREADS",
    threads: [
      {
        id: "t1",
        alias: "T1",
        created_at: "",
        updated_at: "",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [1],
        active_skill_ids: ["skill-a"],
        skill_selection_mode: "all",
        knowledge_selection_mode: "manual",
      },
    ],
  })

  assert.equal(next.activeThreadId, "t1")
  assert.deepEqual(next.pinnedTabIds, [1])
  assert.deepEqual(next.activeSkillIds, ["skill-a"])
  assert.equal(next.skillSelectionMode, "all")
  assert.equal(next.knowledgeSelectionMode, "manual")
})

test("SET_THREADS defaults skillSelectionMode to auto when thread has no mode", () => {
  const s = { ...initialState, threads: [], activeThreadId: null }
  const next = agentReducer(s, {
    type: "SET_THREADS",
    threads: [
      {
        id: "t1",
        alias: "T1",
        created_at: "",
        updated_at: "",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [],
        active_skill_ids: [],
      },
    ],
  })

  assert.equal(next.skillSelectionMode, "auto")
  assert.equal(next.knowledgeSelectionMode, "auto")
})

test("SET_SKILL_SELECTION_MODE updates state", () => {
  const next = agentReducer(initialState, { type: "SET_SKILL_SELECTION_MODE", mode: "manual" })
  assert.equal(next.skillSelectionMode, "manual")
})

test("SET_KNOWLEDGE_SELECTION_MODE updates state", () => {
  const next = agentReducer(initialState, { type: "SET_KNOWLEDGE_SELECTION_MODE", mode: "all" })
  assert.equal(next.knowledgeSelectionMode, "all")
})

test("reducer handles unknown action type without crashing", () => {
  const next = agentReducer(initialState, { type: "UNKNOWN_ACTION_XYZ" as any })
  assert.equal(next, initialState)
})
