import assert from "node:assert/strict"
import test from "node:test"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
import { normalizeConfig } from "../src/sidepanel/utils/normalize-config"

const frame = (model: string) => normalizeConfig({
  llm: { base_url: "https://example.test/v1", model_name: model, api_key: "***" },
  trusted_domains: ["example.test"],
})

test("actual store keeps drafts while authoritative snapshots update", () => {
  let state = agentReducer(initialState, { type: "SET_CONFIG_SNAPSHOT", config: frame("old"), revision: "epoch:1" })
  state = agentReducer(state, { type: "BEGIN_SETTINGS_DRAFT" })
  state = agentReducer(state, { type: "EDIT_SETTINGS_DRAFT", config: { model_name: "mine" } })
  state = agentReducer(state, { type: "SET_CONFIG_SNAPSHOT", config: frame("remote"), revision: "epoch:2" })
  assert.equal(state.config.model_name, "remote")
  assert.equal(state.settingsDraft?.value.model_name, "mine")
  assert.equal(state.settingsDraft?.conflicts.model_name, true)
})

test("legacy snapshots cannot discard or authorize a draft", () => {
  let state = agentReducer(initialState, { type: "SET_CONFIG_SNAPSHOT", config: frame("old"), revision: "epoch:1" })
  state = agentReducer(state, { type: "BEGIN_SETTINGS_DRAFT" })
  state = agentReducer(state, { type: "EDIT_SETTINGS_DRAFT", config: { model_name: "mine" } })
  state = agentReducer(state, { type: "SET_CONFIG_SNAPSHOT", config: frame("remote"), revision: null })
  assert.equal(state.configRevision, null)
  assert.equal(state.settingsDraft?.value.model_name, "mine")
  assert.equal(state.settingsDraft?.revision, "epoch:1")
})
