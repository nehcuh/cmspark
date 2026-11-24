import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { visionConfigForAnalyze, resolveNativeVision } from "../src/llm/likely-multimodal"

const main = { base_url: "https://main.invalid/v1", api_key: "main-fixture", model_name: "gpt-4o" }
const separate = { enabled: true, base_url: "https://vision.invalid/v1", api_key: "vision-fixture", model_name: "llava:7b" }

test("904 screenshot master switch wins over a multimodal main model", () => {
  assert.equal(visionConfigForAnalyze(main, { ...separate, enabled: false }), null)
  assert.equal(visionConfigForAnalyze(main), null)
  assert.equal(resolveNativeVision({ modelName: main.model_name }), true, "composer native images remain independent")
})

test("904 opting out selects the independent model even when main supports images", () => {
  const vision = { ...separate, reuse_main_model: false }
  assert.deepEqual(visionConfigForAnalyze(main, vision), vision)
})

test("904 reuse follows current main credentials without overwriting the independent model", () => {
  const vision = { ...separate, reuse_main_model: true }
  const before = structuredClone(vision)
  for (const current of [main, { ...main, base_url: "https://next.invalid", model_name: "claude-test", api_key: "next-fixture", protocol: "anthropic" as const }]) {
    const actual = visionConfigForAnalyze(current, vision)
    assert.ok(actual)
    assert.equal(actual.model_name, current.model_name)
    assert.equal(actual.api_key, current.api_key)
    assert.equal(actual.base_url, current.base_url)
  }
  assert.deepEqual(vision, before)
  const restored = { ...vision, reuse_main_model: false }
  assert.deepEqual(visionConfigForAnalyze(main, restored), restored)
})

test("904 text-only main and explicit native off use the separate configuration", () => {
  const vision = { ...separate, reuse_main_model: true }
  assert.deepEqual(visionConfigForAnalyze({ ...main, model_name: "deepseek-chat" }, vision), vision)
  assert.deepEqual(visionConfigForAnalyze({ ...main, native_vision: "off" }, vision), vision)
})

test("904 config handler persists both reuse choices and keeps dedicated credentials after reload", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-vision-904-"))
  const previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = dir
  const config = await import("../src/config")
  try {
    const { handleConfigFamily } = await import("../src/message-router/handlers/config")
    config.clearConfigCache()
    config.saveConfig({ vision: { ...config.getConfig().vision!, ...separate } }, { visionKey: true })
    for (const reuse of [false, true, false]) {
      const reply = await handleConfigFamily("config.set", {
        id: "settings-save:904", config_revision: config.getConfigRevision(),
        config: { vision_reuse_main_model: reuse },
      })
      assert.equal(reply.type, "config.updated")
      assert.equal((config.getConfig().vision as any).reuse_main_model, reuse)
      config.clearConfigCache()
      const saved = config.getConfig().vision!
      assert.equal((saved as any).reuse_main_model, reuse)
      assert.equal(saved.api_key, separate.api_key)
      assert.equal(saved.base_url, separate.base_url)
      assert.equal(saved.model_name, separate.model_name)
    }
  } finally {
    config.clearConfigCache()
    if (previous === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
