import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("config.set preserves inherited credentials without persisting them on unrelated vision edits", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-credential-router-")))
  const identity = fs.lstatSync(root)
  process.env.CMSPARK_DATA_DIR = root
  process.env.DEEPSEEK_API_KEY = "owned-router-env"
  delete process.env.CMSPARK_API_KEY
  try {
    const config = await import("../src/config")
    const { handleConfigFamily } = await import("../src/message-router/handlers/config")
    config.clearConfigCache()
    const seed = await handleConfigFamily("config.set", { config: {
      llm: { base_url: "https://owned.invalid/v1", model_name: "owned", protocol: "openai" },
      vision: { enabled: true, base_url: "https://owned.invalid/v1", model_name: "owned", api_key: "ollama" },
    } })
    assert.equal(seed.type, "config.updated")
    assert.equal(config.getConfig().vision?.api_key, "owned-router-env")
    const edited = await handleConfigFamily("config.set", { config: { vision_enabled: false } })
    assert.equal(edited.type, "config.updated")
    const disk = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"))
    assert.equal(disk.llm.api_key, "")
    assert.equal(disk.vision.api_key, "")
    assert.equal(config.getConfig().vision?.api_key, "owned-router-env")
    const explicit = await handleConfigFamily("config.set", { config: { api_key: "owned-router-env" } })
    assert.equal(explicit.type, "config.updated")
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).llm.api_key, "owned-router-env")
    const visionExplicit = await handleConfigFamily("config.set", { config: { vision_api_key: "owned-router-env" } })
    assert.equal(visionExplicit.type, "config.updated")
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).vision.api_key, "owned-router-env")
  } finally {
    delete process.env.DEEPSEEK_API_KEY
    const current = fs.lstatSync(root)
    assert.equal(current.isSymbolicLink(), false)
    assert.equal(current.dev, identity.dev)
    assert.equal(current.ino, identity.ino)
    fs.rmSync(root, { recursive: true })
  }
})
