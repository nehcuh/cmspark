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

    const first = await handleConfigFamily("config.set", { config: { model_name: "owned-first" }, config_revision: token })
    assert.equal(first.type, "config.updated")
    assert.notEqual(first.config_revision, token)
    const stale = await handleConfigFamily("config.set", { config: { model_name: "owned-stale" }, config_revision: token })
    assert.equal(stale.type, "config.conflict")
    assert.equal(stale.config.llm.model_name, "owned-first")
    assert.equal(stale.config.llm.api_key, "***")
    assert.equal(JSON.stringify(stale).includes("owned-test-key"), false)
    assert.equal(config.getConfig().llm.model_name, "owned-first")

    const rejected = await handleConfigFamily("config.set", {
      config: { auto_approve_dangerous: true }, config_revision: first.config_revision,
    })
    assert.equal(rejected.type, "error")
    assert.notEqual(config.getConfig().security?.auto_approve_dangerous, true)

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
    } finally {
      config.configEvents.off(config.CONFIG_CHANGE_EVENT, listener)
    }
  } finally {
    delete process.env.CMSPARK_DATA_DIR
    const current = fs.lstatSync(root)
    assert.equal(current.isSymbolicLink(), false)
    assert.equal(current.dev, identity.dev)
    assert.equal(current.ino, identity.ino)
    fs.rmSync(root, { recursive: true })
  }
})
