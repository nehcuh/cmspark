import test from "node:test"
import assert from "node:assert/strict"
import { agentReducer, initialState, type AgentState } from "../src/sidepanel/store/agentStore"
import { normalizeConfig } from "../src/sidepanel/hooks/useWebSocket"

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
      },
    ],
    pinnedTabIds: [101],
  }
}

test("SET_ACTIVE_THREAD restores pinned tabs from thread metadata", () => {
  const next = agentReducer(stateWithThreads(), { type: "SET_ACTIVE_THREAD", threadId: "thread-b" })

  assert.equal(next.activeThreadId, "thread-b")
  assert.deepEqual(next.pinnedTabIds, [202, 303])
  assert.deepEqual(next.messages, [])
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
  }

  const queued = agentReducer(initialState, { type: "ADD_SECURITY_CONFIRMATION", request })
  assert.equal(queued.pendingSecurityConfirmations.length, 1)
  assert.deepEqual(queued.pendingSecurityConfirmations[0], request)

  const removed = agentReducer(queued, { type: "REMOVE_SECURITY_CONFIRMATION", confirmationId: "confirm-1" })
  assert.equal(removed.pendingSecurityConfirmations.length, 0)
})
