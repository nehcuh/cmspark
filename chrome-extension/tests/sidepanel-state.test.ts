import test from "node:test"
import assert from "node:assert/strict"
import { agentReducer, initialState, isTempUserMessageId, type AgentState } from "../src/sidepanel/store/agentStore"
import { normalizeConfig, parseChatUserAttachments, requestInitialSidePanelData } from "../src/sidepanel/hooks/useWebSocket"
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

test("SET_SKILLS coerces non-array to empty list (skill.list missing skills)", () => {
  const poisoned = agentReducer(initialState, { type: "SET_SKILLS", skills: undefined as any })
  assert.deepEqual(poisoned.skills, [])
  const ok = agentReducer(initialState, {
    type: "SET_SKILLS",
    skills: [{ name: "browse", description: "d", type: "prompt_template", builtin: true }],
  })
  assert.equal(ok.skills.length, 1)
  assert.equal(ok.skills[0].name, "browse")
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
    // Masked key still signals "is set" so the UI can show "已配置 ✓"
    // without ever exposing the real key.
    api_key_set: true,
    model_name: "model-x",
    temperature: 0.2,
    context_window: 4096,
    protocol: "openai",
    client_header_profile: "none",
    trusted_domains: ["example.com", "*.company.com"],
    vision_enabled: false,
  })
})

test("normalizeConfig maps anthropic protocol and coding-plan profile", () => {
  const n = normalizeConfig({
    llm: {
      base_url: "https://gateway.example/v1",
      api_key: "",
      model_name: "claude-sonnet-4-6",
      temperature: 0.5,
      context_window: 200000,
      protocol: "anthropic",
      client_header_profile: "claude_code_compat",
    },
  })
  assert.equal(n.protocol, "anthropic")
  assert.equal(n.client_header_profile, "claude_code_compat")
  assert.equal(n.base_url, "https://gateway.example/v1")
})

test("normalizeConfig flattens thread_digest (Wave B)", () => {
  const n = normalizeConfig({
    llm: { base_url: "x", model_name: "m", temperature: 0, context_window: 1, api_key: "" },
    thread_digest: { enabled: true, on_idle_hours: 48, max_per_day: 10 },
  })
  assert.equal(n.thread_digest_enabled, true)
  assert.equal(n.thread_digest_on_idle_hours, 48)
  assert.equal(n.thread_digest_max_per_day, 10)
})

test("normalizeConfig flattens context_compaction modes", () => {
  assert.equal(
    normalizeConfig({ llm: { context_compaction: "prompt", base_url: "x", model_name: "m", temperature: 0, context_window: 1, api_key: "" } }).context_compaction,
    "prompt",
  )
  assert.equal(
    normalizeConfig({ llm: { context_compaction: "off", base_url: "x", model_name: "m", temperature: 0, context_window: 1, api_key: "" } }).context_compaction,
    "off",
  )
  assert.equal(
    normalizeConfig({ llm: { context_compaction: "auto", base_url: "x", model_name: "m", temperature: 0, context_window: 1, api_key: "" } }).context_compaction,
    "auto",
  )
})

test("ADD_MESSAGE dedupes by message id (optimistic panel + SW chat.user echo)", () => {
  const msg = {
    id: "thread-a_user_1",
    thread_id: "thread-a",
    role: "user" as const,
    content: "from cockpit",
    created_at: "2026-07-28T00:00:00.000Z",
  }
  const once = agentReducer(initialState, { type: "ADD_MESSAGE", message: msg })
  assert.equal(once.messages.length, 1)
  const twice = agentReducer(once, { type: "ADD_MESSAGE", message: { ...msg, content: "dup" } })
  assert.equal(twice.messages.length, 1)
  assert.equal(twice.messages[0].content, "from cockpit")
  const other = agentReducer(twice, {
    type: "ADD_MESSAGE",
    message: { ...msg, id: "thread-a_user_2", content: "second" },
  })
  assert.equal(other.messages.length, 2)
})

test("ADD_MESSAGE same id merges attachments without replacing content", () => {
  const msg = {
    id: "thread-a_user_1730000000000",
    thread_id: "thread-a",
    role: "user" as const,
    content: "look",
    created_at: "2026-08-17T00:00:00.000Z",
  }
  const once = agentReducer(initialState, { type: "ADD_MESSAGE", message: msg })
  const att = { kind: "image" as const, name: "shot.png", mime: "image/png", preview_jpeg_b64: "abc" }
  const merged = agentReducer(once, {
    type: "ADD_MESSAGE",
    message: { ...msg, content: "ignored", attachments: [att] },
  })
  assert.equal(merged.messages.length, 1)
  assert.equal(merged.messages[0].content, "look")
  assert.equal(merged.messages[0].attachments?.[0]?.name, "shot.png")
  assert.equal(merged.messages[0].attachments?.[0]?.preview_jpeg_b64, "abc")
})

test("ADD_MESSAGE adopts persisted message_id onto last temp user bubble", () => {
  const optimistic = {
    id: "thread-a_user_1730000000000",
    thread_id: "thread-a",
    role: "user" as const,
    content: "look",
    created_at: "2026-08-17T00:00:00.000Z",
  }
  const once = agentReducer(initialState, { type: "ADD_MESSAGE", message: optimistic })
  const persisted = {
    id: "thread-a_1730000000001_x7k2p1",
    thread_id: "thread-a",
    role: "user" as const,
    content: "look\n📎 shot.png",
    created_at: "2026-08-17T00:00:01.000Z",
    attachments: [{ kind: "image" as const, name: "shot.png", mime: "image/png" }],
  }
  const adopted = agentReducer(once, { type: "ADD_MESSAGE", message: persisted })
  assert.equal(adopted.messages.length, 1)
  assert.equal(adopted.messages[0].id, persisted.id)
  assert.equal(adopted.messages[0].content, "look", "keep optimistic caption")
  assert.equal(adopted.messages[0].attachments?.[0]?.name, "shot.png")
})

test("ADD_MESSAGE late temp echo after adopt does not duplicate", () => {
  const persisted = {
    id: "thread-a_1730000000001_x7k2p1",
    thread_id: "thread-a",
    role: "user" as const,
    content: "look",
    created_at: "2026-08-17T00:00:00.000Z",
    attachments: [{ kind: "image" as const, name: "shot.png", mime: "image/png" }],
  }
  const once = agentReducer(initialState, { type: "ADD_MESSAGE", message: persisted })
  const late = agentReducer(once, {
    type: "ADD_MESSAGE",
    message: {
      id: "thread-a_user_1730000000000",
      thread_id: "thread-a",
      role: "user",
      content: "look",
      created_at: "2026-08-17T00:00:00.000Z",
    },
  })
  assert.equal(late.messages.length, 1)
  assert.equal(late.messages[0].id, persisted.id)
  assert.equal(late.messages[0].attachments?.[0]?.name, "shot.png")
})

test("isTempUserMessageId: panel/SW/file-upload vs companion persist", () => {
  assert.equal(isTempUserMessageId("thread-a_user_1730000000000", "thread-a"), true)
  assert.equal(isTempUserMessageId("thread-a_1730000000000", "thread-a"), true)
  assert.equal(isTempUserMessageId("thread-a_1730000000000_x7k2p1", "thread-a"), false)
  assert.equal(isTempUserMessageId("thread-b_user_1730000000000", "thread-a"), true)
})

test("parseChatUserAttachments: image only, skip junk", () => {
  assert.equal(parseChatUserAttachments(undefined), undefined)
  assert.equal(parseChatUserAttachments([]), undefined)
  const parsed = parseChatUserAttachments([
    { kind: "image", name: "a.png", mime: "image/png", sha256: "ab", bytes: 12, preview_jpeg_b64: "qq" },
    { kind: "file", name: "x.pdf", mime: "application/pdf" },
    { kind: "image", name: "", mime: "image/png" },
    null,
  ])
  assert.equal(parsed?.length, 1)
  assert.deepEqual(parsed![0], {
    kind: "image",
    name: "a.png",
    mime: "image/png",
    sha256: "ab",
    bytes: 12,
    preview_jpeg_b64: "qq",
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

test("initial side panel sync requests threads, skills, knowledge, config, and mcp servers exactly once per connection", () => {
  const sent: object[] = []
  const initializedRef = { current: false }

  // Production requestInitialSidePanelData (useWebSocket.ts) sends 7 messages
  // on connect: threads, skills, knowledge, config, MCP, user_env, unattended status.
  // Keep these in lock-step — a new initial-sync message means updating this
  // expected array. The CI extension `npm test` step now catches such drift.
  const expected = [
    { type: "thread.list" },
    { type: "skill.list" },
    { type: "knowledge.list" },
    { type: "config.get" },
    { type: "mcp.list" },
    { type: "user_env.list" },
    { type: "security.unattended.status" },
  ]

  assert.equal(requestInitialSidePanelData((message) => sent.push(message), initializedRef), true)
  assert.deepEqual(sent, expected)
  assert.equal(initializedRef.current, true)

  assert.equal(requestInitialSidePanelData((message) => sent.push(message), initializedRef), false)
  assert.deepEqual(sent, expected)
})

test("SET_THREADS keeps active thread when it exists in the new list and syncs metadata", () => {
  const s = { ...initialState, threads: [], activeThreadId: "t1" }
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

test("SET_THREADS preserves active when list is only-trashed mishap (B2 residual)", () => {
  const s = {
    ...initialState,
    activeThreadId: "live1",
    threads: [
      {
        id: "live1",
        alias: "Live",
        created_at: "",
        updated_at: "",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [],
        active_skill_ids: ["browse"],
      },
    ],
  }
  const next = agentReducer(s as any, {
    type: "SET_THREADS",
    threads: [
      {
        id: "trash1",
        alias: "Gone",
        created_at: "",
        updated_at: "",
        config_override: initialState.config,
        tool_whitelist: null,
        pinned_tabs: [],
        active_skill_ids: [],
        trashed_at: "2026-08-01T00:00:00.000Z",
      },
    ] as any,
  })
  // only-trashed incoming: keep active id so open-trash cannot steal chat focus
  assert.equal(next.activeThreadId, "live1")
})

test("SET_THREADS clears active thread when it is not in the new list", () => {
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

  assert.equal(next.activeThreadId, null)
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

test("REMOVE_THREADS drops multiple ids, falls back active, clears busy", () => {
  const base = stateWithThreads()
  const withBusy: AgentState = {
    ...base,
    activeThreadId: "thread-a",
    threadBusyById: { "thread-a": true, "thread-b": true, "other": true },
    messages: [{ id: "m1", role: "user", content: "hi" } as any],
  }
  const next = agentReducer(withBusy, {
    type: "REMOVE_THREADS",
    threadIds: ["thread-a", "missing"],
  })
  assert.equal(next.threads.length, 1)
  assert.equal(next.threads[0].id, "thread-b")
  assert.equal(next.activeThreadId, "thread-b")
  assert.deepEqual(next.messages, [])
  assert.equal(next.threadBusyById["thread-a"], undefined)
  assert.equal(next.threadBusyById["thread-b"], true)
  assert.equal(next.threadBusyById["other"], true)
  assert.deepEqual(next.pinnedTabIds, [202, 303])
})

test("reducer handles unknown action type without crashing", () => {
  const next = agentReducer(initialState, { type: "UNKNOWN_ACTION_XYZ" as any })
  assert.equal(next, initialState)
})
