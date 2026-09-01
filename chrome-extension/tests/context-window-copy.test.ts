// B0 T1/T1b — context_window default 512000, three-band Settings copy, Save hydration guard.

import test from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_LLM_CONFIG } from "../src/utils/config"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
import {
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
