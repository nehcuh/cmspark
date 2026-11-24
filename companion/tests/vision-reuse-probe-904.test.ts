import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import http from "node:http"

test("904 vision connection tests use the selected model's credentials and auth metadata", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-vision-probe-904-"))
  const previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = dir
  const config = await import("../src/config")
  const { startSettingsServer, stopSettingsServer } = await import("../src/settings-web")
  const { handleConfigFamily } = await import("../src/message-router/handlers/config")
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; headers: Headers }> = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: new Headers(options?.headers) })
    return Response.json({ content: [{ type: "text", text: "fixture pixel" }], stop_reason: "end_turn" })
  }
  try {
    config.clearConfigCache()
    config.saveConfig({
      llm: { ...config.getConfig().llm, base_url: "http://127.0.0.1:9/v1", model_name: "claude-fixture", protocol: "anthropic", api_key: "owned-main-904", extra_headers: { "x-owned-main": "main" } },
      vision: { ...config.getConfig().vision!, enabled: true, reuse_main_model: true, base_url: "http://127.0.0.1:8/v1", model_name: "claude-separate", protocol: "anthropic", api_key: "owned-separate-904", extra_headers: { "x-owned-vision": "vision" } },
    }, { llmKey: true, visionKey: true })
    const server = await startSettingsServer(23530)
    const payload = JSON.stringify({ reuse_main_model: true, use_main_auth: true, base_url: "http://127.0.0.1:9/v1", model_name: "claude-fixture", protocol: "anthropic", api_key: "owne****904" })
    const reply = await new Promise<{ ok: boolean }>((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port: server.port, path: `/api/testVision?token=${server.token}`, method: "POST", headers: { Origin: `http://127.0.0.1:${server.port}`, "Content-Type": "application/json" } }, res => {
        let body = ""
        res.on("data", chunk => { body += chunk })
        res.on("end", () => resolve(JSON.parse(body)))
      })
      req.on("error", reject)
      req.end(payload)
    })
    assert.equal(reply.ok, true)
    assert.equal(calls[0].headers.get("x-api-key"), "owned-main-904")
    assert.equal(calls[0].headers.get("x-owned-main"), "main")
    assert.equal(calls[0].headers.get("x-owned-vision"), null)
    assert.equal((await handleConfigFamily("config.testVision", {})).ok, true)
    assert.match(calls[1].url, /:9\/v1\/messages$/)
    assert.equal(calls[1].headers.get("x-api-key"), "owned-main-904")
    config.saveConfig({ vision: { ...config.getConfig().vision!, reuse_main_model: false } })
    assert.equal((await handleConfigFamily("config.testVision", {})).ok, true)
    assert.match(calls[2].url, /:8\/v1\/messages$/)
    assert.equal(calls[2].headers.get("x-api-key"), "owned-separate-904")
  } finally {
    globalThis.fetch = originalFetch
    stopSettingsServer()
    config.clearConfigCache()
    if (previous === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
