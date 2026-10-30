import assert from "node:assert/strict"
import test from "node:test"
import { normalizeConfig } from "../src/sidepanel/utils/normalize-config"
import { acknowledgeSettingsSubmission, createSettingsDraft, editSettingsDraft, prepareSettingsSubmission, receiveSettingsSnapshot, resolveSettingsConflict } from "../src/sidepanel/utils/settings-draft"

const opaque = new Set<keyof ReturnType<typeof normalizeConfig>>(["api_key", "vision_api_key"])
function wire(model: string, secret: string, domains: string[] = ["example.test"]) {
  return normalizeConfig({
    llm: { base_url: "https://example.test/v1", model_name: model, api_key: secret ? "***" : "" },
    trusted_domains: domains,
  })
}

test("wire normalization preserves a draft over unrelated updates", () => {
  let draft = createSettingsDraft(wire("old", "synthetic-old"), "epoch:1")
  draft = editSettingsDraft(draft, { model_name: "draft" })
  draft = receiveSettingsSnapshot(draft, wire("old", "synthetic-old", ["other.test"]), "epoch:2", opaque)
  assert.equal(draft.value.model_name, "draft")
  assert.deepEqual(draft.value.trusted_domains, ["other.test"])
  assert.equal(draft.conflicts.model_name, undefined)
  draft = receiveSettingsSnapshot(draft, wire("remote", "synthetic-old"), "epoch:3", opaque)
  assert.equal(draft.value.model_name, "draft")
  assert.equal(draft.conflicts.model_name, true)
})

test("a correlated response cannot clear a newer edit or a masked secret", () => {
  let draft = createSettingsDraft(wire("old", "synthetic-old"), "epoch:1")
  draft = editSettingsDraft(draft, { model_name: "first", api_key: "synthetic-new" })
  const pending = prepareSettingsSubmission(draft, "request-1")
  draft = editSettingsDraft(draft, { model_name: "second" })
  draft = acknowledgeSettingsSubmission(draft, pending, "request-1", wire("first", "synthetic-new"), "epoch:2", opaque)
  assert.equal(draft.value.model_name, "second")
  assert.ok(draft.dirty.model_name)
  assert.equal(draft.value.api_key, "synthetic-new")
  assert.equal(draft.conflicts.api_key, true)
  assert.ok(draft.dirty.api_key)
})

test("unrelated responses cannot acknowledge a save", () => {
  let draft = createSettingsDraft(wire("old", "synthetic-old"), "epoch:1")
  draft = editSettingsDraft(draft, { model_name: "first" })
  const pending = prepareSettingsSubmission(draft, "request-1")
  draft = acknowledgeSettingsSubmission(draft, pending, "other", wire("first", "synthetic-old"), "epoch:2", opaque)
  assert.ok(draft.dirty.model_name)
  draft = acknowledgeSettingsSubmission(draft, pending, "request-1", wire("first", "synthetic-old"), "epoch:2", opaque)
  assert.equal(draft.dirty.model_name, undefined)
})


test("a conflicting edit requires an explicit choice before it can be sent", () => {
  let draft = createSettingsDraft(wire("old", "synthetic-old"), "epoch:1")
  draft = editSettingsDraft(draft, { model_name: "mine" })
  draft = receiveSettingsSnapshot(draft, wire("remote", "synthetic-old"), "epoch:2", opaque)
  let conflict = ""
  try { prepareSettingsSubmission(draft, "request-1") } catch (error) { conflict = String(error) }
  assert.match(conflict, /SETTINGS_DRAFT_CONFLICT/)
  const remote = resolveSettingsConflict(draft, "model_name", "remote")
  assert.equal(remote.value.model_name, "remote")
  assert.equal(remote.dirty.model_name, undefined)
  const mine = resolveSettingsConflict(draft, "model_name", "mine")
  assert.equal(prepareSettingsSubmission(mine, "request-2").patch.model_name, "mine")
})
