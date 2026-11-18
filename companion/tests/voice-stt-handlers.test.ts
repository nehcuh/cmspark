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
import { getConfig, setVoiceFields } from "../src/config"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"
import { createMeeting, deleteMeeting } from "../src/meeting/meeting-store"
import { createExternalAsrSession } from "../src/voice/external-asr-session"
import {
  handleVoiceSttMessage,
  isChromeExtensionOrigin,
  isVoiceSttOriginAllowed,
  _resetVoiceSttHandlersForTests,
  _setExternalAsrSessionForTests,
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

test("external start, chunk, and end do not use the local session path", async () => {
  const previous = getConfig().voice?.sttEngine
  const external = {
    style: "deepseek" as const,
    baseUrl: "",
    model: "whisper-1",
    apiKey: "secret",
    maxDurationMs: 120000,
    maxBytes: 8388608,
    requestTimeoutMs: 180000,
  }
  setVoiceFields({ sttEngine: "external", external })
  let calls = 0
  let posted = 0
  const bound = createExternalAsrSession({
    now: () => 0,
    fetchImpl: async (_url: string, init: { body: FormData }) => {
      calls += 1
      posted = (init.body.get("file") as Blob).size
      return { status: 200, json: async () => ({ text: "外" }) }
    },
    config: () => ({ sttEngine: "external", external }),
  })
  _setExternalAsrSessionForTests(bound)
  try {
    const start = await handleVoiceSttMessage(
      {
        type: "voice.stt.start",
        v: 1,
        sessionId: "ext-1",
        engine: "external",
        format: "wav",
        sampleRate: 16000,
        channels: 1,
        privacy_ack_external_v1: true,
      },
      extCtx("p-ext"),
    )
    assert.equal(start.type, "voice.stt.partial")
    assert.notEqual(start.code, "engine_not_local")
    const pcm = Buffer.alloc(256 * 1024)
    const chunk = await handleVoiceSttMessage(
      {
        type: "voice.stt.chunk",
        v: 1,
        sessionId: "ext-1",
        seq: 0,
        data: pcm.toString("base64"),
      },
      extCtx("p-ext"),
    )
    assert.equal(chunk, undefined)
    const busy = await handleVoiceSttMessage(
      {
        type: "voice.stt.start",
        v: 1,
        sessionId: "ext-2",
        engine: "external",
        format: "wav",
        sampleRate: 16000,
        channels: 1,
        privacy_ack_external_v1: true,
      },
      extCtx("p-ext"),
    )
    assert.equal(busy.type, "voice.stt.error")
    assert.equal(busy.code, "session_busy")
    const end = await handleVoiceSttMessage(
      { type: "voice.stt.end", v: 1, sessionId: "ext-1", totalSeq: 1 },
      extCtx("p-ext"),
    )
    assert.equal(end.type, "voice.stt.result")
    assert.equal(end.text, "外")
    assert.equal(calls, 1)
    assert.equal(posted, 44 + pcm.length)
    const partial = await handleVoiceSttMessage(
      { type: "voice.stt.partial_request", v: 1, sessionId: "ext-1" },
      extCtx("p-ext"),
    )
    assert.notEqual(partial?.code, "session_bytes")
    assert.equal(calls, 1)
  } finally {
    _setExternalAsrSessionForTests(null)
    setVoiceFields({ sttEngine: previous === "local" || previous === "system" || previous === "external" ? previous : "browser" })
  }
})

test("openai handler sends the saved model and the start lang primary tag", async () => {
  const external = {
    style: "openai" as const,
    baseUrl: "https://asr.example.test/v1",
    model: "gpt-transcribe",
    apiKey: "secret",
    maxDurationMs: null,
    maxBytes: 25_000_000,
    requestTimeoutMs: 180000,
  }
  setVoiceFields({ sttEngine: "external", external })
  let model: FormDataEntryValue | null = null
  let language: FormDataEntryValue | null = null
  const bound = createExternalAsrSession({
    now: () => 0,
    fetchImpl: async (_url: string, init: { body: FormData }) => {
      model = init.body.get("model")
      language = init.body.get("language")
      return { status: 200, json: async () => ({ text: "やあ" }) }
    },
    config: () => ({ sttEngine: "external", external }),
  })
  _setExternalAsrSessionForTests(bound)
  try {
    const start = await handleVoiceSttMessage(
      {
        type: "voice.stt.start",
        v: 1,
        sessionId: "ja-1",
        engine: "external",
        format: "wav",
        sampleRate: 16000,
        channels: 1,
        privacy_ack_external_v1: true,
        lang: "ja-JP",
        modelId: "whisper-1",
      },
      extCtx("p-ja"),
    )
    assert.equal(start.type, "voice.stt.partial")
    await handleVoiceSttMessage(
      {
        type: "voice.stt.chunk",
        v: 1,
        sessionId: "ja-1",
        seq: 0,
        data: Buffer.from([1, 2]).toString("base64"),
      },
      extCtx("p-ja"),
    )
    const end = await handleVoiceSttMessage(
      { type: "voice.stt.end", v: 1, sessionId: "ja-1", totalSeq: 1 },
      extCtx("p-ja"),
    )
    assert.equal(end.type, "voice.stt.result")
    assert.equal(model, "gpt-transcribe")
    assert.equal(language, "ja")
  } finally {
    _setExternalAsrSessionForTests(null)
    setVoiceFields({ sttEngine: "browser" })
  }
})

test("blank saved openai model fails before fetch and is not replaced", async () => {
  const external = {
    style: "openai" as const,
    baseUrl: "https://asr.example.test/v1",
    model: "   ",
    apiKey: "secret",
    maxDurationMs: null,
    maxBytes: 25_000_000,
    requestTimeoutMs: 180000,
  }
  setVoiceFields({ sttEngine: "external", external })
  let calls = 0
  const bound = createExternalAsrSession({
    now: () => 0,
    fetchImpl: async () => {
      calls += 1
      return { status: 200, json: async () => ({ text: "x" }) }
    },
    config: () => ({ sttEngine: "external", external }),
  })
  _setExternalAsrSessionForTests(bound)
  try {
    await handleVoiceSttMessage(
      {
        type: "voice.stt.start",
        v: 1,
        sessionId: "blank-model",
        engine: "external",
        format: "wav",
        sampleRate: 16000,
        channels: 1,
        privacy_ack_external_v1: true,
        lang: "",
      },
      extCtx("p-blank"),
    )
    await handleVoiceSttMessage(
      {
        type: "voice.stt.chunk",
        v: 1,
        sessionId: "blank-model",
        seq: 0,
        data: Buffer.from([1, 2]).toString("base64"),
      },
      extCtx("p-blank"),
    )
    const end = await handleVoiceSttMessage(
      { type: "voice.stt.end", v: 1, sessionId: "blank-model", totalSeq: 1 },
      extCtx("p-blank"),
    )
    assert.equal(end.code, "external_unconfigured")
    assert.equal(calls, 0)
  } finally {
    _setExternalAsrSessionForTests(null)
    setVoiceFields({ sttEngine: "browser" })
  }
})

test("saved browser engine does not accept an external start", async () => {
  setVoiceFields({ sttEngine: "browser" })
  const refused = await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "ext-no",
      engine: "external",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_external_v1: true,
    },
    extCtx("p-ext"),
  )
  assert.equal(refused.code, "external_unconfigured")
})

test("meeting start with external engine does not open PCM capture", async () => {
  setVoiceFields({
    sttEngine: "external",
    external: {
      style: "deepseek",
      baseUrl: "",
      model: "whisper-1",
      apiKey: "secret",
      maxDurationMs: 120000,
      maxBytes: 8388608,
      requestTimeoutMs: 180000,
    },
  })
  const meeting = createMeeting({ title: "external refusal" })
  try {
    const started = await handleMeetingMessage(
      {
        type: "meeting.start",
        v: 1,
        id: meeting.id,
        queue_contract: 1,
        capture_id: "00000000-0000-4000-8000-000000000860",
        expected_capture_epoch: 0,
        privacy_ack_v1: true,
        privacy_ack_v2: true,
        audio_retained: false,
      },
      { origin: EXT_ORIGIN, surface: "panel", peerId: "p-ext" },
    )
    assert.equal(started.type, "meeting.error")
    assert.equal(started.code, "meeting_external_unsupported")
  } finally {
    deleteMeeting(meeting.id)
    setVoiceFields({ sttEngine: "browser" })
  }
})

// cleanup singleton between files if needed
test("teardown reset singleton", () => {
  _resetVoiceSttHandlersForTests()
  resetSttSessionServiceForTests()
})
