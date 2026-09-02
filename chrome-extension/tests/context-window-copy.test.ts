// B0 T1/T1b — context_window default 512000, three-band Settings copy, Save hydration guard.

import test from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_LLM_CONFIG } from "../src/utils/config"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
import {
  compactBannerKind,
  contextWindowHelpText,
  settingsSaveDisabled,
  settingsSaveDisabledTitle,
} from "../src/sidepanel/utils/context-window-copy"

test("T1: DEFAULT_LLM_CONFIG.context_window is 512000", () => {
  assert.equal(DEFAULT_LLM_CONFIG.context_window, 512000)
})

test("T1: initialState.config.context_window is 512000", () => {
  assert.equal(initialState.config.context_window, 512000)
})

test("T1: tiny disk copy says runtime 128000 and 未改配置文件", () => {
  const text = contextWindowHelpText(4000)
  assert.match(text, /128000/)
  assert.match(text, /未改配置文件/)
  assert.match(text, /过小/)
  assert.equal(/推荐 128000/.test(text), false)
})

test("T1: non-positive disk uses the tiny band", () => {
  assert.match(contextWindowHelpText(0), /未改配置文件/)
  assert.match(contextWindowHelpText(-8), /未改配置文件/)
})

test("T1: default 512000 copy is Agent working budget; not 推荐 128000", () => {
  const text = contextWindowHelpText(512000)
  assert.match(text, /512000/)
  assert.match(text, /工作预算/)
  assert.equal(/推荐 128000/.test(text), false)
})

test("T1: 1e6 copy says 极大 and compression almost never fires", () => {
  const text = contextWindowHelpText(1000000)
  assert.match(text, /极大/)
  assert.match(text, /几乎不触发/)
  assert.equal(/推荐 128000/.test(text), false)
})

test("T1b: Save is disabled until companion hydrates config", () => {
  assert.equal(initialState.configHydratedFromCompanion, false)
  assert.equal(settingsSaveDisabled(false), true)
  assert.equal(settingsSaveDisabled(true), false)
  assert.match(String(settingsSaveDisabledTitle(false)), /Companion/)
  assert.equal(settingsSaveDisabledTitle(true), undefined)
})

test("T1b: SET_CONFIG_HYDRATED from companion unlocks Save", () => {
  const next = agentReducer(initialState, { type: "SET_CONFIG_HYDRATED", hydrated: true })
  assert.equal(next.configHydratedFromCompanion, true)
  assert.equal(settingsSaveDisabled(next.configHydratedFromCompanion), false)
  const localEdit = agentReducer(next, { type: "SET_CONFIG", config: { context_window: 64000 } })
  assert.equal(localEdit.configHydratedFromCompanion, true, "local SET_CONFIG must not clear hydration")
})

test("SET_CONTEXT_COMPACTED stores shrunk so ChatView can tell shrink-only from prompt-mode", () => {
  const next = agentReducer(initialState, {
    type: "SET_CONTEXT_COMPACTED",
    threadId: "t1",
    droppedCount: 0,
    tokensBefore: 100,
    tokensAfter: 80,
    shrunk: true,
  })
  assert.equal(next.contextCompactedByThreadId.t1?.shrunk, true)
  assert.equal(next.contextCompactedByThreadId.t1?.droppedCount, 0)
})

test("SET_CONTEXT_COMPACTED keeps shrunk tri-state: false stays false", () => {
  const next = agentReducer(initialState, {
    type: "SET_CONTEXT_COMPACTED",
    threadId: "t1",
    droppedCount: 0,
    tokensBefore: 100,
    tokensAfter: 100,
    shrunk: false,
  })
  assert.equal(next.contextCompactedByThreadId.t1?.shrunk, false)
})

test("SET_CONTEXT_COMPACTED keeps shrunk tri-state: absent stays undefined (old companion)", () => {
  const next = agentReducer(initialState, {
    type: "SET_CONTEXT_COMPACTED",
    threadId: "t1",
    droppedCount: 0,
    tokensBefore: 100,
    tokensAfter: 80,
  })
  assert.equal(next.contextCompactedByThreadId.t1?.shrunk, undefined)
})

test("compactBannerKind: shrink / prompt / unknown / dropped / none", () => {
  assert.equal(compactBannerKind(null), "none")
  assert.equal(compactBannerKind(undefined), "none")
  assert.equal(compactBannerKind({ droppedCount: 0, shrunk: true }), "shrink")
  assert.equal(compactBannerKind({ droppedCount: 0, shrunk: false }), "prompt")
  assert.equal(compactBannerKind({ droppedCount: 0 }), "unknown")
  assert.equal(compactBannerKind({ droppedCount: 3, shrunk: true }), "dropped")
  assert.equal(compactBannerKind({ droppedCount: 3 }), "dropped")
})

test("CLEAR_CONTEXT_COMPACTED clears a thread's banner; no-op when absent", () => {
  const compacted = agentReducer(initialState, {
    type: "SET_CONTEXT_COMPACTED",
    threadId: "t1",
    droppedCount: 0,
    tokensBefore: 100,
    tokensAfter: 80,
    shrunk: true,
  })
  const cleared = agentReducer(compacted, { type: "CLEAR_CONTEXT_COMPACTED", threadId: "t1" })
  assert.equal(cleared.contextCompactedByThreadId.t1, undefined)
  // No-op: same state object returned when nothing to clear.
  const again = agentReducer(cleared, { type: "CLEAR_CONTEXT_COMPACTED", threadId: "t1" })
  assert.equal(again, cleared)
})
