import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("#789 actual config handlers persist four levels, default legacy, and reject invalid without writing", async () => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-reasoning-789-"))
  const identity = fs.lstatSync(owned)
  process.env.CMSPARK_DATA_DIR = owned
  delete process.env.CMSPARK_API_KEY
  process.env.DEEPSEEK_API_KEY = "owned-import-key"
  const config = await import("../src/config")
  delete process.env.DEEPSEEK_API_KEY
  // This test exercises configuration, not the unrelated built-in skill installer.
  // mkdtempSync already provides the isolated directory used by the real handlers.
  const { handleConfigFamily } = await import("../src/message-router/handlers/config")
  try {
    assert.equal(config.getConfig().llm.reasoning_effort, "medium")
    for (const level of ["low", "medium", "high", "xhigh"]) {
      const response = await handleConfigFamily("config.set", { config: { reasoning_effort: level } })
      assert.equal(response.type, "config.updated")
      assert.equal(response.config.llm.reasoning_effort, level)
      config.clearConfigCache()
      assert.equal(config.getConfig().llm.reasoning_effort, level)
    }
    const nested = await handleConfigFamily("config.set", { config: { llm: { reasoning_effort: "high", api_key: "owned-secret" } } })
    assert.equal(nested.config.llm.reasoning_effort, "high")
    assert.equal(nested.config.llm.api_key, "***")
    const before = fs.readFileSync(path.join(owned, "config.json"))
    for (const candidate of [{ reasoning_effort: "max" }, { llm: { reasoning_effort: null } }]) {
      const response = await handleConfigFamily("config.set", { config: candidate })
      assert.equal(response.type, "error")
      assert.equal(response.error, "INVALID_REASONING_EFFORT")
      assert.deepEqual(fs.readFileSync(path.join(owned, "config.json")), before)
    }
    const legacy = JSON.parse(before.toString())
    delete legacy.llm.reasoning_effort
    fs.writeFileSync(path.join(owned, "config.json"), JSON.stringify(legacy))
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.reasoning_effort, "medium")
    assert.equal((await handleConfigFamily("settings.get", {})).settings.reasoning_effort, "medium")
    legacy.llm.model_name = "deepseek-chat"
    legacy.llm.reasoning_effort = "invalid"
    fs.writeFileSync(path.join(owned, "config.json"), JSON.stringify(legacy))
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.reasoning_effort, "medium")
    assert.equal(JSON.parse(fs.readFileSync(path.join(owned, "config.json"), "utf8")).llm.reasoning_effort, "invalid")
    config.saveConfig(config.getConfig())
    assert.equal(config.migrateLegacyModelName().migrated, true)
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.model_name, "deepseek-v4-flash")
    assert.equal(config.getConfig().llm.reasoning_effort, "medium")
    assert.equal(config.getConfig().llm.api_key, "owned-secret")
    legacy.llm.reasoning_effort = "xhigh"
    fs.writeFileSync(path.join(owned, "config.json"), JSON.stringify(legacy))
    config.clearConfigCache()
    assert.equal(config.migrateLegacyModelName().migrated, true)
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.reasoning_effort, "xhigh")
    assert.equal(config.getConfig().llm.api_key, "owned-secret")
    for (const invalidLlm of ["malformed", null, []]) {
      fs.writeFileSync(path.join(owned, "config.json"), JSON.stringify({ llm: invalidLlm }))
      process.env.DEEPSEEK_API_KEY = "owned-env-key"
      config.clearConfigCache()
      assert.equal(config.getConfig().llm.reasoning_effort, "medium")
      assert.equal(config.getConfig().llm.api_key, "owned-env-key")
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(owned, "config.json"), "utf8")).llm, invalidLlm)
      config.saveConfig(config.getConfig())
      assert.equal(JSON.parse(fs.readFileSync(path.join(owned, "config.json"), "utf8")).llm.api_key, "")
      delete process.env.DEEPSEEK_API_KEY
    }
    fs.writeFileSync(path.join(owned, "config.json"), JSON.stringify({ llm: null }))
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.api_key, "")
    config.saveConfig(config.getConfig())
    assert.equal(JSON.parse(fs.readFileSync(path.join(owned, "config.json"), "utf8")).llm.api_key, "")
  } finally {
    const current = fs.lstatSync(owned)
    assert.equal(current.isSymbolicLink(), false)
    assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino)
    fs.rmSync(owned, { recursive: true })
  }
})
