import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("settings web preserves masked headers and never returns their values", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-settings-806-")))
  const identity = fs.lstatSync(root)
  process.env.CMSPARK_DATA_DIR = root
  try {
    const { getConfig, saveConfig, clearConfigCache } = await import("../src/config")
    const { settingsWebLlmResponse, settingsWebLlmUpdate } = await import("../src/settings-web")
    clearConfigCache()
    const original = getConfig().llm
    saveConfig({ llm: { ...original, extra_headers: { "X-Owned": "synthetic-private-value" } } })

    // The old web POST forwarded a masked object to this real producer.
    // Verify that control would overwrite the stored header before testing the fix.
    saveConfig({ llm: { ...original, extra_headers: { "X-Owned": "***" } } })
    assert.equal(getConfig().llm.extra_headers?.["X-Owned"], "***")
    saveConfig({ llm: { ...original, extra_headers: { "X-Owned": "synthetic-private-value" } } })

    const response = settingsWebLlmResponse(getConfig().llm)
    assert.deepEqual(response.extra_headers, { "X-Owned": "***" })
    assert.equal(JSON.stringify(response).includes("synthetic-private-value"), false)

    const patch = settingsWebLlmUpdate({ ...response, model_name: "owned-model" })
    saveConfig({ llm: { ...original, ...patch } })
    assert.equal(getConfig().llm.model_name, "owned-model")
    assert.equal(getConfig().llm.extra_headers?.["X-Owned"], "synthetic-private-value")

    const changed = settingsWebLlmUpdate({ extra_headers: { "X-Owned": "new-synthetic-value" } })
    saveConfig({ llm: { ...original, ...changed } })
    assert.equal(getConfig().llm.extra_headers?.["X-Owned"], "new-synthetic-value")
    assert.deepEqual(settingsWebLlmResponse(getConfig().llm).extra_headers, { "X-Owned": "***" })
  } finally {
    delete process.env.CMSPARK_DATA_DIR
    const current = fs.lstatSync(root)
    assert.equal(current.isSymbolicLink(), false)
    assert.equal(current.dev, identity.dev)
    assert.equal(current.ino, identity.ino)
    fs.rmSync(root, { recursive: true })
  }
})
