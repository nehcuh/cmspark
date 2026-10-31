import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("config handler rejects stale revisions without bypassing security or exposing keys", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-router-806-")))
  const identity = fs.lstatSync(root)
  process.env.CMSPARK_DATA_DIR = root
  try {
    const config = await import("../src/config")
    const { handleConfigFamily } = await import("../src/message-router/handlers/config")
    config.clearConfigCache()
    config.saveConfig({ llm: { ...config.getConfig().llm, api_key: "owned-test-key" } }, { llmKey: true })
    const read = await handleConfigFamily("config.get", {})
    assert.equal(read.config.llm.api_key, "***")
    const token = read.config_revision

    const broadcasts: Array<{ revision: string; value: string }> = []
    const observe = () => { const snapshot = config.getConfigSnapshot(); broadcasts.push({ revision: snapshot.revision, value: snapshot.config.llm.model_name }) }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, observe)
    let first: any
    try { first = await handleConfigFamily("config.set", { config: { model_name: "owned-first" }, config_revision: token }) }
    finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, observe) }
    assert.deepEqual(broadcasts, [{ revision: first.config_revision, value: "owned-first" }])
    assert.equal(first.type, "config.updated")
    assert.notEqual(first.config_revision, token)
    assert.equal(first.config_applied_revision, first.config_revision)
    const stale = await handleConfigFamily("config.set", { config: { model_name: "owned-stale" }, config_revision: token })
    assert.equal(stale.type, "config.conflict")
    assert.equal(stale.config_applied_revision, undefined)
    assert.equal(stale.config.llm.model_name, "owned-first")
    assert.equal(stale.config.llm.api_key, "***")
    assert.equal(JSON.stringify(stale).includes("owned-test-key"), false)
    assert.equal(config.getConfig().llm.model_name, "owned-first")

    const rejected = await handleConfigFamily("config.set", {
      config: { auto_approve_dangerous: true }, config_revision: first.config_revision,
    })
    assert.equal(rejected.type, "error")
    assert.notEqual(config.getConfig().security?.auto_approve_dangerous, true)

    const secretRevision = config.getConfigRevision()
    const secret = await handleConfigFamily("config.set", { config: { api_key: "owned-next-key" }, config_revision: secretRevision })
    assert.equal(secret.config_applied_revision, secret.config_revision)
    assert.deepEqual(secret.config_applied_secret_fields, ["api_key"])
    assert.equal(secret.config.llm.api_key, "***")
    assert.equal(JSON.stringify(secret).includes("owned-next-key"), false)

    // A synchronous listener can perform another write before the first reply.
    // The returned value and token must refer to the same latest snapshot.
    const listener = () => {
      config.configEvents.off(config.CONFIG_CHANGE_EVENT, listener)
      config.saveConfig({ llm: { ...config.getConfig().llm, model_name: "owned-reentrant" } })
    }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, listener)
    try {
      const reply = await handleConfigFamily("config.set", { config: { model_name: "owned-before-event" } })
      assert.equal(reply.config.llm.model_name, "owned-reentrant")
      assert.equal(reply.config_revision, config.getConfigRevision())
      assert.equal(reply.config_applied_revision, undefined)
    } finally {
      config.configEvents.off(config.CONFIG_CHANGE_EVENT, listener)
    }
    // A reentrant write to the *same value* still has its own revision and
    // cannot be attributed to the outer request by comparing field contents.
    const sameValue = () => {
      config.configEvents.off(config.CONFIG_CHANGE_EVENT, sameValue)
      config.saveConfig({ llm: { ...config.getConfig().llm, model_name: "owned-same" } })
    }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, sameValue)
    try {
      const reply = await handleConfigFamily("config.set", { config: { model_name: "owned-same" } })
      assert.equal(reply.config.llm.model_name, "owned-same")
      assert.equal(reply.config_applied_revision, undefined)
    } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, sameValue) }
    // Even the same on-disk content reloaded under a new revision must not
    // inherit a prior write's proof merely because the values match.
    const clearDuringEvent = () => { config.configEvents.off(config.CONFIG_CHANGE_EVENT, clearDuringEvent); config.clearConfigCache() }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, clearDuringEvent)
    try {
      const reply = await handleConfigFamily("config.set", { config: { model_name: "owned-reload" } })
      assert.equal(reply.config.llm.model_name, "owned-reload")
      assert.equal(reply.config_applied_revision, undefined)
    } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, clearDuringEvent) }
    // An exception after atomic write is not a successful receipt.
    const throwsAfterWrite = () => { throw new Error("owned-listener-failure") }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, throwsAfterWrite)
    try {
      await assert.rejects(handleConfigFamily("config.set", { config: { model_name: "owned-persisted-before-error" } }), /owned-listener-failure/)
      assert.equal(config.getConfig().llm.model_name, "owned-persisted-before-error")
    } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, throwsAfterWrite) }
  } finally {
    delete process.env.CMSPARK_DATA_DIR
    const current = fs.lstatSync(root)
    assert.equal(current.isSymbolicLink(), false)
    assert.equal(current.dev, identity.dev)
    assert.equal(current.ino, identity.ino)
    fs.rmSync(root, { recursive: true })
  }
})
