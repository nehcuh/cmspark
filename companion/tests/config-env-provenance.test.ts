import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("initial configuration does not persist an environment-sourced key", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-config-env-"))
  const identity = fs.lstatSync(root)
  process.env.CMSPARK_DATA_DIR = root
  process.env.DEEPSEEK_API_KEY = "owned-ephemeral-env-key"
  try {
    const config = await import("../src/config")
    await config.initDataDir()
    const disk = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"))
    assert.equal(disk.llm.api_key, "")
    assert.equal(config.getConfig().llm.api_key, "owned-ephemeral-env-key")
    fs.writeFileSync(path.join(root, "config.json"), "{}")
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.api_key, "owned-ephemeral-env-key")
    delete process.env.DEEPSEEK_API_KEY
    fs.unlinkSync(path.join(root, "config.json"))
    config.clearConfigCache()
    await config.initDataDir()
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).llm.api_key, "")
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ llm: { api_key: "owned-explicit-user-key" } }))
    process.env.DEEPSEEK_API_KEY = "owned-other-env-key"
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.api_key, "owned-explicit-user-key")
    config.saveConfig({ port: 23401 })
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).llm.api_key, "owned-explicit-user-key")
  } finally {
    delete process.env.DEEPSEEK_API_KEY
    const current = fs.lstatSync(root)
    assert.equal(current.isSymbolicLink(), false)
    assert.equal(current.dev, identity.dev)
    assert.equal(current.ino, identity.ino)
    fs.rmSync(root, { recursive: true })
  }
})
