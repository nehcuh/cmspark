import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("process-scoped config revision rejects a stale writer before changing owned config", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-revision-806-")))
  const identity = fs.lstatSync(root)
  process.env.CMSPARK_DATA_DIR = root
  try {
    const config = await import("../src/config")
    config.clearConfigCache()
    const initial = config.getConfigRevision()
    config.saveConfig({ llm: { ...config.getConfig().llm, model_name: "owned-first" } }, undefined, initial)
    const afterFirst = config.getConfigRevision()
    assert.notEqual(afterFirst, initial)
    assert.throws(
      () => config.saveConfig({ llm: { ...config.getConfig().llm, model_name: "owned-stale" } }, undefined, initial),
      /CONFIG_REVISION_CONFLICT/,
    )
    assert.equal(config.getConfig().llm.model_name, "owned-first")
    assert.equal(config.getConfigRevision(), afterFirst)

    // Existing callers without an expected token still use their prior API.
    config.saveConfig({ llm: { ...config.getConfig().llm, model_name: "owned-legacy" } })
    assert.notEqual(config.getConfigRevision(), afterFirst)
    assert.equal(config.getConfig().llm.model_name, "owned-legacy")

    const beforeReset = config.getConfigRevision()
    config.clearConfigCache()
    assert.notEqual(config.getConfigRevision(), beforeReset)
    assert.throws(() => config.saveConfig({}, undefined, beforeReset), /CONFIG_REVISION_CONFLICT/)
  } finally {
    delete process.env.CMSPARK_DATA_DIR
    const current = fs.lstatSync(root)
    assert.equal(current.isSymbolicLink(), false)
    assert.equal(current.dev, identity.dev)
    assert.equal(current.ino, identity.ino)
    fs.rmSync(root, { recursive: true })
  }
})
