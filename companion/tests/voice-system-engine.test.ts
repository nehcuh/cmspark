// #259 — "system" STT engine (Windows SAPI fallback): handler gates,
// voice.system.state probe payload, config fail-closed, WS validation.
// Spec: docs/superpowers/specs/2026-09-04-windows-sapi-fallback.md §3.1–§3.4

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "cmspark-voice-system-engine-"),
)
delete process.env.DEEPSEEK_API_KEY
delete process.env.CMSPARK_API_KEY

import test from "node:test"
import assert from "node:assert/strict"

import { validateWsMessage } from "../src/server"
import {
  handleVoiceModelMessage,
  _resetVoiceModelHandlersForTests,
} from "../src/voice/whisper-handlers"
import {
  handleVoiceSttMessage,
  _resetVoiceSttHandlersForTests,
} from "../src/voice/stt-handlers"
import { clearConfigCache, getConfig, saveConfig } from "../src/config"

const TEST_DATA_DIR = process.env.CMSPARK_DATA_DIR!
const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopqrstuvwxyz"

function resetVoiceConfig(voice: Record<string, unknown> = {}) {
  _resetVoiceModelHandlersForTests()
  _resetVoiceSttHandlersForTests()
  clearConfigCache()
  try {
    fs.rmSync(path.join(TEST_DATA_DIR, "config.json"))
  } catch {
    /* ignore */
  }
  saveConfig({
    voice: {
      sttEngine: "browser",
      localModelId: "medium",
      modelDiskBudgetMB: 4096,
      ...voice,
    },
  } as any)
  clearConfigCache()
}

const helperOk = { ok: true as const, path: "C:\\app\\bin\\win-sapi-helper.exe", sha256: "a".repeat(64), pinned: true }
const helperMissing = {
  ok: false as const,
  reason: "missing" as const,
  message: "win-sapi-helper.exe not found",
}

// --- voice.model.set_engine engine:"system" -------------------------------------

test("set_engine system: non-win32 refused, ZERO config write", async () => {
  resetVoiceConfig()
  const r = await handleVoiceModelMessage(
    { type: "voice.model.set_engine", engine: "system", source: "settings", privacy_ack_v2: true },
    { origin: EXT_ORIGIN },
    { platform: "darwin", resolveSapi: () => helperOk },
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "SYSTEM_ENGINE_NOT_SUPPORTED")
  assert.equal(getConfig().voice?.sttEngine, "browser")
})

test("set_engine system: privacy_ack_v2 required on the wire (local-class audio path)", async () => {
  resetVoiceConfig()
  const r = await handleVoiceModelMessage(
    { type: "voice.model.set_engine", engine: "system", source: "settings" },
    { origin: EXT_ORIGIN },
    { platform: "win32", resolveSapi: () => helperOk },
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "NEED_PRIVACY_ACK")
  assert.equal(getConfig().voice?.sttEngine, "browser")
})

test("set_engine system: helper missing refused honestly, ZERO config write", async () => {
  resetVoiceConfig()
  const r = await handleVoiceModelMessage(
    { type: "voice.model.set_engine", engine: "system", source: "settings", privacy_ack_v2: true },
    { origin: EXT_ORIGIN },
    { platform: "win32", resolveSapi: () => helperMissing },
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "SYSTEM_ENGINE_UNAVAILABLE")
  assert.ok(String(r.error).includes("win-sapi-helper"))
  assert.equal(getConfig().voice?.sttEngine, "browser")
})

test("set_engine system: win32 + ack + helper ready → sttEngine=system persisted", async () => {
  resetVoiceConfig()
  const r = await handleVoiceModelMessage(
    { type: "voice.model.set_engine", engine: "system", source: "settings", privacy_ack_v2: true },
    { origin: EXT_ORIGIN },
    { platform: "win32", resolveSapi: () => helperOk },
  )
  assert.equal(r.type, "voice.model.state")
  assert.equal(getConfig().voice?.sttEngine, "system")
  assert.equal(r.sttEngine, "system")
})

// --- voice.system.state ----------------------------------------------------------

test("voice.system.state: non-win32 → platform other, unavailable, no probe spawn", async () => {
  resetVoiceConfig()
  let probeCalls = 0
  const r = await handleVoiceModelMessage(
    { type: "voice.system.state" },
    { origin: EXT_ORIGIN },
    {
      platform: "darwin",
      resolveSapi: () => helperOk,
      probeSapi: async () => {
        probeCalls++
        return { available: true }
      },
    },
  )
  assert.equal(r.type, "voice.system.state")
  assert.equal(r.platform, "other")
  assert.equal(r.systemSpeech.available, false)
  assert.equal(r.systemSpeech.reason, "not_win32")
  assert.equal(probeCalls, 0)
})

test("voice.system.state: win32 + helper ok + System.Speech present → available", async () => {
  resetVoiceConfig()
  const r = await handleVoiceModelMessage(
    { type: "voice.system.state" },
    { origin: EXT_ORIGIN },
    {
      platform: "win32",
      resolveSapi: () => helperOk,
      probeSapi: async () => ({ available: true }),
    },
  )
  assert.equal(r.platform, "win32")
  assert.equal(r.helper.ok, true)
  assert.equal(r.systemSpeech.available, true)
})

test("voice.system.state: helper missing → available:false with reason, never throws", async () => {
  resetVoiceConfig()
  const r = await handleVoiceModelMessage(
    { type: "voice.system.state" },
    { origin: EXT_ORIGIN },
    {
      platform: "win32",
      resolveSapi: () => helperMissing,
      probeSapi: async () => {
        throw new Error("must not be called when helper missing")
      },
    },
  )
  assert.equal(r.systemSpeech.available, false)
  assert.equal(r.systemSpeech.reason, "missing")
})

// --- config fail-closed（非 win32 配置出现 system → 回 browser） ------------------

test("config load: sttEngine=system on non-win32 fail-closes to browser", () => {
  if (process.platform === "win32") return // CI windows runner: sanitizer keeps system
  resetVoiceConfig({ sttEngine: "system" })
  assert.equal(getConfig().voice?.sttEngine, "browser")
})

// --- WS validation（layer 1） ------------------------------------------------------

test("validate: set_engine accepts system (settings source)", () => {
  assert.equal(
    validateWsMessage({ type: "voice.model.set_engine", engine: "system", source: "settings" })
      .valid,
    true,
  )
  assert.equal(
    validateWsMessage({ type: "voice.model.set_engine", engine: "cloud", source: "settings" })
      .valid,
    false,
  )
})

test("validate: stt.start engine=system makes modelId optional; other engines still require it", () => {
  const base = {
    type: "voice.stt.start",
    v: 1,
    sessionId: "s1",
    format: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
    privacy_ack_v2: true,
  }
  assert.equal(validateWsMessage({ ...base, engine: "system" }).valid, true)
  assert.equal(validateWsMessage({ ...base, engine: "junk" }).valid, false)
  // legacy (engine absent) still requires a whisper modelId
  assert.equal(validateWsMessage({ ...base }).valid, false)
  assert.equal(validateWsMessage({ ...base, modelId: "medium" }).valid, true)
})

// --- voice.stt.start engine:"system"（per-session fallback；不写 config） ----------

function fakeService(capture: { startReq?: any }) {
  return {
    start: (req: any) => {
      capture.startReq = req
      return { ok: true }
    },
    chunk: () => ({ ok: true }),
    partial: async () => ({ ok: false, code: "partial_skipped", message: "" }),
    end: async () => ({ ok: true, text: "hi" }),
    abort: () => ({ ok: true }),
    forceAbort: () => {},
    getActive: () => null,
    getBoundPeerId: () => null,
  } as any
}

const sttStartBase = {
  type: "voice.stt.start",
  v: 1,
  sessionId: "sys-1",
  format: "pcm_s16le",
  sampleRate: 16000,
  channels: 1,
  lang: "zh",
  privacy_ack_v2: true,
}

test("stt.start engine=system: non-win32 refused (system_unavailable)", async () => {
  resetVoiceConfig()
  const cap: { startReq?: any } = {}
  const r = await handleVoiceSttMessage(
    { ...sttStartBase, engine: "system" },
    { origin: EXT_ORIGIN, peerId: "peer-1" },
    { service: fakeService(cap), platform: "darwin", resolveSapi: () => helperOk },
  )
  assert.equal(r.type, "voice.stt.error")
  assert.equal(r.code, "system_unavailable")
  assert.equal(cap.startReq, undefined)
})

test("stt.start engine=system: helper missing refused honestly (no browser drop)", async () => {
  resetVoiceConfig()
  const cap: { startReq?: any } = {}
  const r = await handleVoiceSttMessage(
    { ...sttStartBase, engine: "system" },
    { origin: EXT_ORIGIN, peerId: "peer-1" },
    { service: fakeService(cap), platform: "win32", resolveSapi: () => helperMissing },
  )
  assert.equal(r.type, "voice.stt.error")
  assert.equal(r.code, "system_unavailable")
  assert.equal(cap.startReq, undefined)
})

test("stt.start engine=system: win32 + helper ok + ack → system session, no config write", async () => {
  resetVoiceConfig()
  const cap: { startReq?: any } = {}
  const r = await handleVoiceSttMessage(
    { ...sttStartBase, engine: "system" },
    { origin: EXT_ORIGIN, peerId: "peer-1" },
    { service: fakeService(cap), platform: "win32", resolveSapi: () => helperOk },
  )
  assert.equal(r.type, "voice.stt.partial")
  assert.equal(cap.startReq.engine, "system")
  assert.equal(getConfig().voice?.sttEngine, "browser") // per-session, ZERO config write
})

test("stt.start engine=system: privacy_ack_v2 still required", async () => {
  resetVoiceConfig()
  const cap: { startReq?: any } = {}
  const r = await handleVoiceSttMessage(
    { ...sttStartBase, engine: "system", privacy_ack_v2: false },
    { origin: EXT_ORIGIN, peerId: "peer-1" },
    { service: fakeService(cap), platform: "win32", resolveSapi: () => helperOk },
  )
  assert.equal(r.type, "voice.stt.error")
  assert.equal(r.code, "need_privacy_ack")
})

test("stt.start: engine absent + config system → engine_not_local (wire field is the system authority)", async () => {
  // Config "system" only drives settings/radio + extension chain; companion
  // sessions pick system exclusively via the explicit engine:"system" field,
  // so a stale client without the field gets the honest gate, not a local run.
  resetVoiceConfig({ sttEngine: "system" })
  const cap: { startReq?: any } = {}
  const r = await handleVoiceSttMessage(
    { ...sttStartBase },
    { origin: EXT_ORIGIN, peerId: "peer-1" },
    { service: fakeService(cap), platform: "win32", resolveSapi: () => helperOk },
  )
  // On non-win32 the load sanitizer already coerced config to browser; on win32
  // the explicit-field rule holds either way: no local session, honest error.
  assert.equal(r.type, "voice.stt.error")
  assert.equal(r.code, "engine_not_local")
  assert.equal(cap.startReq, undefined)
})

test("stt.start regression: engine absent + config browser → engine_not_local (unchanged)", async () => {
  resetVoiceConfig()
  const cap: { startReq?: any } = {}
  const r = await handleVoiceSttMessage(
    { ...sttStartBase, modelId: "medium" },
    { origin: EXT_ORIGIN, peerId: "peer-1" },
    { service: fakeService(cap) },
  )
  assert.equal(r.type, "voice.stt.error")
  assert.equal(r.code, "engine_not_local")
  assert.equal(cap.startReq, undefined)
})
