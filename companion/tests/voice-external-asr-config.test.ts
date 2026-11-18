import assert from "node:assert/strict"
import test from "node:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { externalStateView, reduceExternalConfig } from "../src/voice/external-asr-config"
import { validateWsMessage } from "../src/ws/validate"
import { redactConfigForWire } from "../src/config-redact"

const stored = {
  sttEngine: "browser" as const,
  external: {
    style: "deepseek" as const,
    baseUrl: "",
    model: "whisper-1",
    apiKey: "stored-secret",
    maxDurationMs: 120000,
    maxBytes: 8388608,
    requestTimeoutMs: 180000,
  },
}

test("masked key keeps the stored secret and blank key clears it", () => {
  const kept = reduceExternalConfig(stored, { type: "set", apiKey: "***" })
  assert.equal(kept.ok && kept.external.apiKey, "stored-secret")
  const cleared = reduceExternalConfig(stored, { type: "set", apiKey: "" })
  assert.equal(cleared.ok && cleared.external.apiKey, "")
})

test("bad url and empty key do not switch the engine", () => {
  const bad = reduceExternalConfig(stored, { type: "set", baseUrl: "http://example.test/v1" })
  assert.equal(bad.ok, false)
  assert.equal(bad.ok === false && bad.sttEngine, "browser")
  const engine = reduceExternalConfig({ ...stored, external: { ...stored.external, apiKey: "" } }, {
    type: "set-engine",
    engine: "external",
    privacyAckExternalV1: true,
  })
  assert.equal(engine.ok, false)
})

test("state view has no apiKey field", () => {
  const view = externalStateView(stored)
  assert.equal(view.keyConfigured, true)
  assert.equal("apiKey" in view, false)
})

test("style change without a budget uses the new factory values", () => {
  const next = reduceExternalConfig(stored, { type: "set", style: "openai", baseUrl: "" })
  assert.equal(next.ok && next.external.maxDurationMs, null)
  assert.equal(next.ok && next.external.maxBytes, 25000000)
  assert.equal(next.ok && next.sttEngine, "browser")
})

const externalStart = {
  type: "voice.stt.start",
  v: 1,
  sessionId: "s",
  format: "wav",
  sampleRate: 16000,
  channels: 1,
  engine: "external",
  privacy_ack_external_v1: true,
}

test("external start skips the whisper model id and the 45s maxMs cap", () => {
  assert.equal(validateWsMessage(externalStart).valid, true)
  assert.equal(validateWsMessage({ ...externalStart, maxMs: 120000 }).valid, true)
  assert.equal(validateWsMessage({ ...externalStart, privacy_ack_external_v1: undefined, privacy_ack_v2: true }).valid, false)
  assert.equal(validateWsMessage({ type: "voice.model.set_engine", source: "settings", engine: "external" }).valid, true)
})

test("local and system validation stays on the old rules", () => {
  const local = {
    type: "voice.stt.start",
    v: 1,
    sessionId: "s",
    format: "wav",
    sampleRate: 16000,
    channels: 1,
    modelId: "medium",
    privacy_ack_v2: true,
    maxMs: 45000,
  }
  assert.equal(validateWsMessage(local).valid, true)
  assert.equal(validateWsMessage({ ...local, maxMs: 45001 }).valid, false)
  assert.equal(validateWsMessage({ ...local, modelId: undefined }).valid, false)
  assert.equal(validateWsMessage({ ...local, engine: "system", modelId: undefined, privacy_ack_v2: true }).valid, true)
})

test("wire redaction masks the external key", () => {
  const red = redactConfigForWire({ voice: { external: { apiKey: "stored-secret" } } })
  assert.equal(red.voice.external.apiKey, "***")
})

test("reload keeps external and only fills a missing external object", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-external-asr-"))
  process.env.CMSPARK_DATA_DIR = dir
  const cfg = await import("../src/config")
  cfg.clearConfigCache()
  await cfg.initDataDir()
  const file = path.join(dir, "config.json")
  const disk = JSON.parse(fs.readFileSync(file, "utf8"))
  disk.voice = { sttEngine: "browser", localModelId: "medium", modelDiskBudgetMB: 4096 }
  fs.writeFileSync(file, JSON.stringify(disk))
  cfg.clearConfigCache()
  const browser = cfg.getConfig()
  const voice = browser.voice
  assert.ok(voice?.external)
  assert.equal(voice.sttEngine, "browser")
  assert.equal(voice.external.maxDurationMs, 120000)
  disk.voice.sttEngine = "external"
  disk.voice.external = voice.external
  fs.writeFileSync(file, JSON.stringify(disk))
  cfg.clearConfigCache()
  assert.equal(cfg.getConfig().voice?.sttEngine, "external")
})
