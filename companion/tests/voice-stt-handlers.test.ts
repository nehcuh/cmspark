// Path B M1 Task 4 �?voice.stt.* handlers + WS validation + origin fence

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// DATA_DIR fixed at config load �?set before any src import.
process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-voice-stt-handlers-"))
delete process.env.DEEPSEEK_API_KEY
delete process.env.CMSPARK_API_KEY

import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"

import { validateWsMessage } from "../src/server"
import { setVoiceFields } from "../src/config"
import {
  handleVoiceSttMessage,
  isChromeExtensionOrigin,
  isVoiceSttOriginAllowed,
  _resetVoiceSttHandlersForTests,
} from "../src/voice/stt-handlers"
import {
  SttSessionService,
  resetSttSessionServiceForTests,
} from "../src/voice/stt-session-service"
import { STT_MAX_CHUNK_BYTES, STT_MAX_RECORD_MS } from "../src/voice/session-caps"
import type { WhisperManifest } from "../src/voice/whisper-manifest"

const TEST_DATA_DIR = process.env.CMSPARK_DATA_DIR!
const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopqrstuvwxyz"
const TRAY_ORIGIN = "cmspark-tray://local"

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

const MODEL_BYTES = Buffer.from("fake-ggml-small-weights")

function testManifest(): WhisperManifest {
  return {
    schemaVersion: 1,
    models: {
      small: {
        files: [
          {
            name: "ggml-small.bin",
            url: "https://models.cmspark.invalid/ggml-small.bin",
            sha256: sha256(MODEL_BYTES),
            size: MODEL_BYTES.byteLength,
          },
        ],
      },
      medium: {
        files: [
          {
            name: "ggml-medium.bin",
            url: "https://models.cmspark.invalid/ggml-medium.bin",
            sha256: sha256(MODEL_BYTES),
            size: MODEL_BYTES.byteLength,
          },
        ],
      },
      "large-v3-turbo": {
        files: [
          {
            name: "ggml-large-v3-turbo.bin",
            url: "https://models.cmspark.invalid/ggml-large-v3-turbo.bin",
            sha256: sha256(MODEL_BYTES),
            size: MODEL_BYTES.byteLength,
          },
        ],
      },
    },
  }
}

function plantReadyModel(whisperRoot: string, modelId = "small"): void {
  const name = modelId === "large-v3-turbo" ? "ggml-large-v3-turbo.bin" : `ggml-${modelId}.bin`
  const dir = path.join(whisperRoot, modelId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, name), MODEL_BYTES)
}

function makeService(opts?: {
  runWhisper?: ConstructorParameters<typeof SttSessionService>[0]["runWhisper"]
}): SttSessionService {
  const whisperRoot = path.join(TEST_DATA_DIR, "models", "whisper")
  plantReadyModel(whisperRoot, "small")
  const manifest = testManifest()
  return new SttSessionService({
    dataDir: TEST_DATA_DIR,
    whisperRoot,
    manifest,
    probeModel: (id) => {
      const name = id === "large-v3-turbo" ? "ggml-large-v3-turbo.bin" : `ggml-${id}.bin`
      const p = path.join(whisperRoot, id, name)
      return existsSync(p) ? { status: "ready" } : { status: "absent" }
    },
    resolveBinary: () => ({
      ok: true as const,
      path: "/fake/cmspark-whisper",
      arch: "darwin-arm64" as const,
      sha256: "a".repeat(64),
      pinned: false,
    }),
    runWhisper: opts?.runWhisper ?? (async () => ({ text: "你好世界", ms: 33 })),
  })
}

function extCtx(peerId = "panel-1") {
  return { origin: EXT_ORIGIN, peerId }
}

// --- origin helper ------------------------------------------------------------

test("isChromeExtensionOrigin accepts extension only", () => {
  assert.equal(isChromeExtensionOrigin(EXT_ORIGIN), true)
  assert.equal(isChromeExtensionOrigin(TRAY_ORIGIN), false)
  assert.equal(isChromeExtensionOrigin(undefined), false)
  assert.equal(isChromeExtensionOrigin(""), false)
  assert.equal(isChromeExtensionOrigin("https://evil.example"), false)
})

test("isVoiceSttOriginAllowed: extension always; tray only with summoner surface", () => {
  assert.equal(isVoiceSttOriginAllowed(EXT_ORIGIN), true)
  assert.equal(isVoiceSttOriginAllowed(EXT_ORIGIN, "summoner"), true)
  assert.equal(isVoiceSttOriginAllowed(TRAY_ORIGIN), false)
  assert.equal(isVoiceSttOriginAllowed(TRAY_ORIGIN, "tray"), false)
  assert.equal(isVoiceSttOriginAllowed(TRAY_ORIGIN, undefined), false)
  assert.equal(isVoiceSttOriginAllowed(TRAY_ORIGIN, "summoner"), true)
  assert.equal(isVoiceSttOriginAllowed(undefined, "summoner"), false)
  assert.equal(isVoiceSttOriginAllowed("https://evil.example", "summoner"), false)
})

// --- validateWsMessage (layer 1) ----------------------------------------------

test("validateWsMessage: voice.stt.start shape", () => {
  const ok = {
    type: "voice.stt.start",
    v: 1,
    sessionId: "s1",
    modelId: "small",
    format: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
      privacy_ack_v2: true,
  }
  assert.equal(validateWsMessage(ok).valid, true)
  assert.equal(validateWsMessage({ ...ok, lang: "zh", maxMs: 45000 }).valid, true)

  // NOT source:settings �?must still be valid without it
  assert.equal(validateWsMessage(ok).valid, true)

  // P1: privacy_ack_v2 required
  const { privacy_ack_v2: _drop, ...noAck } = ok
  assert.equal(validateWsMessage(noAck).valid, false)

  assert.equal(validateWsMessage({ ...ok, v: 2 }).valid, false)
  assert.equal(validateWsMessage({ ...ok, format: "mp3" }).valid, false)
  assert.equal(validateWsMessage({ ...ok, sampleRate: 44100 }).valid, false)
  assert.equal(validateWsMessage({ ...ok, channels: 2 }).valid, false)
  assert.equal(validateWsMessage({ ...ok, modelId: "tiny" }).valid, false)
  assert.equal(validateWsMessage({ ...ok, maxMs: STT_MAX_RECORD_MS + 1 }).valid, false)
  assert.equal(validateWsMessage({ ...ok, sessionId: "" }).valid, false)
})

test("validateWsMessage: voice.stt.chunk base64 size", () => {
  const small = Buffer.from("pcm").toString("base64")
  assert.equal(
    validateWsMessage({
      type: "voice.stt.chunk",
      v: 1,
      sessionId: "s1",
      seq: 0,
      data: small,
    }).valid,
    true,
  )
  assert.equal(
    validateWsMessage({
      type: "voice.stt.chunk",
      v: 1,
      sessionId: "s1",
      seq: -1,
      data: small,
    }).valid,
    false,
  )
  // oversized decoded payload
  const huge = Buffer.alloc(STT_MAX_CHUNK_BYTES + 1, 1).toString("base64")
  assert.equal(
    validateWsMessage({
      type: "voice.stt.chunk",
      v: 1,
      sessionId: "s1",
      seq: 0,
      data: huge,
    }).valid,
    false,
  )
  assert.equal(
    validateWsMessage({
      type: "voice.stt.chunk",
      v: 1,
      sessionId: "s1",
      seq: 0,
      data: 123,
    }).valid,
    false,
  )
})

test("validateWsMessage: voice.stt.end / abort", () => {
  assert.equal(
    validateWsMessage({ type: "voice.stt.end", v: 1, sessionId: "s", totalSeq: 2 }).valid,
    true,
  )
  assert.equal(
    validateWsMessage({ type: "voice.stt.end", v: 1, sessionId: "s", totalSeq: 1.5 }).valid,
    false,
  )
  assert.equal(
    validateWsMessage({ type: "voice.stt.abort", v: 1, sessionId: "s" }).valid,
    true,
  )
  assert.equal(
    validateWsMessage({ type: "voice.stt.abort", v: 1 }).valid,
    false,
  )
})

// --- handlers -----------------------------------------------------------------

test.beforeEach(() => {
  setVoiceFields({ sttEngine: "local", localModelId: "small" })
})


test("handler rejects non-extension origin (tray)", async () => {
  const svc = makeService()
  const r = await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "s1",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_v2: true,
    },
    { origin: TRAY_ORIGIN, peerId: "tray-1" },
    { service: svc },
  )
  assert.equal(r.type, "voice.stt.error")
  assert.equal(r.code, "origin_denied")
  assert.equal(svc.getActive(), null)
})

test("handler rejects tray origin when surface is tray (not summoner)", async () => {
  const svc = makeService()
  const r = await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "s-tray-surface",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_v2: true,
    },
    { origin: TRAY_ORIGIN, peerId: "tray-1", surface: "tray" },
    { service: svc },
  )
  assert.equal(r.type, "voice.stt.error")
  assert.equal(r.code, "origin_denied")
})

test("handler does not origin_denied tray origin on summoner surface", async () => {
  const svc = makeService()
  const r = await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "s-summoner-stt",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_v2: true,
    },
    { origin: TRAY_ORIGIN, peerId: "summoner-1", surface: "summoner" },
    { service: svc },
  )
  assert.notEqual(r.code, "origin_denied")
})

test("handler rejects missing origin", async () => {
  const svc = makeService()
  const r = await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "s1",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_v2: true,
    },
    { peerId: "p1" },
    { service: svc },
  )
  assert.equal(r.type, "voice.stt.error")
  assert.equal(r.code, "origin_denied")
})

test("happy path: start �?chunk �?end with injected service", async () => {
  const sent: any[] = []
  const svc = makeService({
    runWhisper: async () => ({ text: "fixture 听写", ms: 12 }),
  })

  const start = await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "happy1",
      modelId: "small",
      format: "pcm_s16le",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_v2: true,
      lang: "zh",
    },
    { ...extCtx("peer-A"), send: (m) => sent.push(m) },
    { service: svc },
  )
  assert.equal(start.type, "voice.stt.partial")
  assert.equal(start.status, "receiving")
  assert.equal(start.sessionId, "happy1")

  const chunk = await handleVoiceSttMessage(
    {
      type: "voice.stt.chunk",
      v: 1,
      sessionId: "happy1",
      seq: 0,
      data: Buffer.from("audio-bytes").toString("base64"),
    },
    extCtx("peer-A"),
    { service: svc },
  )
  assert.equal(chunk, undefined)

  const end = await handleVoiceSttMessage(
    {
      type: "voice.stt.end",
      v: 1,
      sessionId: "happy1",
      totalSeq: 1,
    },
    { ...extCtx("peer-A"), send: (m) => sent.push(m) },
    { service: svc },
  )
  assert.equal(end.type, "voice.stt.result")
  assert.equal(end.text, "fixture 听写")
  assert.equal(end.ms, 12)
  assert.equal(end.modelId, "small")
  assert.equal(end.v, 1)
  // partials: receiving (start) + transcribing (end)
  assert.ok(sent.some((m) => m.status === "receiving"))
  assert.ok(sent.some((m) => m.status === "transcribing"))
})

test("abort ends session", async () => {
  const svc = makeService()
  await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "ab1",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_v2: true,
    },
    extCtx("p"),
    { service: svc },
  )
  assert.ok(svc.getActive())

  const abort = await handleVoiceSttMessage(
    { type: "voice.stt.abort", v: 1, sessionId: "ab1" },
    extCtx("p"),
    { service: svc },
  )
  assert.equal(abort.type, "voice.stt.error")
  assert.equal(abort.code, "aborted")
  assert.equal(svc.getActive(), null)
})

test("session_busy on second start", async () => {
  const svc = makeService()
  const ctx = extCtx("p")
  const r1 = await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "b1",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_v2: true,
    },
    ctx,
    { service: svc },
  )
  assert.equal(r1.type, "voice.stt.partial")

  const r2 = await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "b2",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_v2: true,
    },
    ctx,
    { service: svc },
  )
  assert.equal(r2.type, "voice.stt.error")
  assert.equal(r2.code, "session_busy")

  await handleVoiceSttMessage(
    { type: "voice.stt.abort", v: 1, sessionId: "b1" },
    ctx,
    { service: svc },
  )
})

test("peer mismatch rejects chunk from other panel", async () => {
  const svc = makeService()
  await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "own",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_v2: true,
    },
    extCtx("owner"),
    { service: svc },
  )
  const r = await handleVoiceSttMessage(
    {
      type: "voice.stt.chunk",
      v: 1,
      sessionId: "own",
      seq: 0,
      data: Buffer.from("x").toString("base64"),
    },
    extCtx("intruder"),
    { service: svc },
  )
  assert.equal(r.type, "voice.stt.error")
  assert.equal(r.code, "peer_mismatch")

  await handleVoiceSttMessage(
    { type: "voice.stt.abort", v: 1, sessionId: "own" },
    extCtx("owner"),
    { service: svc },
  )
})

test("empty transcription maps to empty_result", async () => {
  const svc = makeService({
    runWhisper: async () => ({ text: "   ", ms: 1 }),
  })
  await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "e1",
      modelId: "small",
      format: "pcm_s16le",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_v2: true,
    },
    extCtx("p"),
    { service: svc },
  )
  await handleVoiceSttMessage(
    {
      type: "voice.stt.chunk",
      v: 1,
      sessionId: "e1",
      seq: 0,
      data: Buffer.from("x").toString("base64"),
    },
    extCtx("p"),
    { service: svc },
  )
  const end = await handleVoiceSttMessage(
    { type: "voice.stt.end", v: 1, sessionId: "e1", totalSeq: 1 },
    extCtx("p"),
    { service: svc },
  )
  assert.equal(end.type, "voice.stt.error")
  assert.equal(end.code, "empty_result")
})

// cleanup singleton between files if needed
test("teardown reset singleton", () => {
  _resetVoiceSttHandlersForTests()
  resetSttSessionServiceForTests()
})
