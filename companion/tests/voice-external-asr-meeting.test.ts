import "./meeting-test-data-dir"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { join } from "node:path"
import test from "node:test"
import { DATA_DIR, getConfig, setVoiceFields } from "../src/config"
import { redactConfigForWire } from "../src/config-redact"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"
import { createMeetingExternalAsr, handleMeetingAsrMessage, meetingExternalRefusal, type MeetingAsrConfig } from "../src/voice/external-asr-meeting"
import type { ExternalTranscribeRequest } from "../src/voice/external-asr-client"
import { handleVoiceSttMessage } from "../src/voice/stt-handlers"
import { SttSessionService } from "../src/voice/stt-session-service"
import { validateWsMessage } from "../src/ws/validate"

test("meeting audio is not sent when the engine is external", () => {
  assert.deepEqual(meetingExternalRefusal("external"), { code: "meeting_external_unsupported" })
  assert.equal(meetingExternalRefusal("local"), null)
  assert.equal(meetingExternalRefusal("system"), null)
  assert.equal(meetingExternalRefusal("browser"), null)
})

const peerId = "extension-connection"
const openAi = {
  style: "openai" as const, baseUrl: "https://asr.example/v1", model: "meeting-whisper",
  apiKey: "meeting-secret", maxDurationMs: null, maxBytes: 25_000_000, requestTimeoutMs: 30_000,
}

test("authenticated WebSocket accepts reading independent meeting ASR settings", () => {
  assert.deepEqual(validateWsMessage({ type: "meeting.asr.get", id: "fixture-get", v: 1 }), { valid: true })
})

function wavFixture(marker: number) {
  const wav = Buffer.alloc(32_044)
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4)
  wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40)
  wav[44] = marker
  return wav
}

function harness(initial?: MeetingAsrConfig, transport: Partial<ExternalTranscribeRequest> = {}) {
  let config = initial
  const service = createMeetingExternalAsr({
    config: () => config,
    save: next => { config = next },
    lookup: async () => [{ address: "1.1.1.1", family: 4 }],
    ...transport,
  })
  let count = 0
  const request = async (type: string, fields: Record<string, unknown> = {}, owner = peerId): Promise<any> => {
    const frame = { type: `meeting.asr.${type}`, id: `fixture-${++count}`, v: 1, ...fields }
    assert.deepEqual(validateWsMessage(frame), { valid: true })
    return handleMeetingAsrMessage(frame, owner, service)
  }
  const authorize = async (wavFiles: Buffer[], identity?: string) => {
    const state = await request("get")
    return request("authorize", {
      config_identity: identity ?? state.state.configIdentity,
      privacy_ack_v1: true,
      privacy_ack_meeting_asr_v1: true,
      segments: wavFiles.map(wav => ({ bytes: wav.length, sha256: createHash("sha256").update(wav).digest("hex") })),
    })
  }
  const upload = (token: string, index: number, wav: Buffer, owner?: string) => request("segment", {
    token, index, data: wav.toString("base64"),
  }, owner)
  return { request, authorize, upload, service, setConfig: (next?: MeetingAsrConfig) => { config = next } }
}

test("old voice preferences default meeting import to local and meeting credentials are write-only", async () => {
  const { request } = harness()
  const original = await request("get")
  assert.equal(original.state.mode, "local")
  const saved = await request("set", {
    source: "settings", expected_identity: original.state.configIdentity, mode: "external", external: openAi,
  })
  assert.equal(saved.state.mode, "external")
  assert.equal(saved.state.normalizedUrl, "https://asr.example/v1/audio/transcriptions")
  assert.equal(saved.state.model, "meeting-whisper")
  assert.equal(saved.state.keyConfigured, true)
  assert.equal(JSON.stringify(saved).includes("meeting-secret"), false)
  assert.equal(JSON.stringify(await request("get")).includes("meeting-secret"), false)
  const stale = await request("set", { source: "settings", expected_identity: original.state.configIdentity, mode: "local" })
  assert.equal(stale.code, "external_configuration_changed")
  assert.equal((await request("get")).state.mode, "external")
})

test("a grant binds exact bytes and order to the authorizing extension connection", async () => {
  const sent: Buffer[] = []
  const audio = [wavFixture(1), wavFixture(2)]
  const { authorize, upload } = harness({ mode: "external", external: openAi }, {
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://asr.example/v1/audio/transcriptions")
      assert.equal(init.body.get("model"), "meeting-whisper")
      assert.equal(init.headers.Authorization, "Bearer meeting-secret")
      sent.push(Buffer.from(await (init.body.get("file") as Blob).arrayBuffer()))
      return { status: 200, json: async () => ({ text: `segment ${sent.length}` }) }
    },
  })
  assert.equal((await upload("00000000-0000-4000-8000-000000000000", 0, audio[0])).delivery, "not_sent")
  const { token } = await authorize(audio)
  assert.equal((await upload(token, 0, audio[0], "other-connection")).delivery, "not_sent")
  assert.equal((await upload(token, 1, audio[1])).delivery, "not_sent")
  assert.equal((await upload(token, 0, audio[1])).delivery, "not_sent")
  assert.equal(sent.length, 0)
  assert.equal((await upload(token, 0, audio[0])).text, "segment 1")
  assert.equal((await upload(token, 0, audio[0])).delivery, "not_sent")
  assert.equal((await upload(token, 1, audio[1])).text, "segment 2")
  assert.deepEqual(sent, audio)
})

test("changing recipient or credentials invalidates consent, including while DNS is pending", async () => {
  let finishLookup!: (rows: Array<{ address: string; family: number }>) => void
  let signalLookup!: () => void
  const lookupStarted = new Promise<void>(resolve => { signalLookup = resolve })
  let posts = 0
  const { request, authorize, upload, setConfig } = harness({ mode: "external", external: openAi }, {
    lookup: () => {
      signalLookup()
      return new Promise(resolve => { finishLookup = resolve })
    },
    fetchImpl: async () => { posts++; return { status: 503 } },
  })
  const audio = wavFixture(3)
  const old = (await request("get")).state.configIdentity
  setConfig({ mode: "external", external: { ...openAi, apiKey: "new-secret" } })
  assert.equal((await authorize([audio], old)).code, "external_configuration_changed")
  const { token } = await authorize([audio])
  const pending = upload(token, 0, audio)
  await lookupStarted
  setConfig({ mode: "external", external: { ...openAi, baseUrl: "https://other-asr.example/v1" } })
  finishLookup([{ address: "1.1.1.1", family: 4 }])
  const rejected = await pending
  assert.equal(rejected.code, "external_configuration_changed")
  assert.equal(rejected.delivery, "not_sent")
  assert.equal(posts, 0)
})

test("cancel aborts the in-flight request, reports unknown delivery and prevents later segments", async () => {
  let signalDispatch!: () => void
  const dispatched = new Promise<void>(resolve => { signalDispatch = resolve })
  const audio = [wavFixture(4), wavFixture(5)]
  const { request, authorize, upload } = harness({ mode: "external", external: openAi }, {
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("cancelled by test")), { once: true })
      signalDispatch()
    }),
  })
  const { token } = await authorize(audio)
  const pending = upload(token, 0, audio[0])
  await dispatched
  const cancelled = await request("cancel", { token })
  assert.equal(cancelled.delivery, "unknown")
  const rejected = await pending
  assert.equal(rejected.code, "aborted")
  assert.equal(rejected.delivery, "unknown")
  assert.equal((await upload(token, 1, audio[1])).delivery, "not_sent")
})

test("a provider rejection is reported and stops later segments without retry", async () => {
  const audio = [wavFixture(6), wavFixture(7)]
  let posts = 0
  const { authorize, upload } = harness({ mode: "external", external: openAi }, {
    fetchImpl: async () => { posts++; return { status: 429 } },
  })
  const { token } = await authorize(audio)
  const rejected = await upload(token, 0, audio[0])
  assert.equal(rejected.code, "external_rate_limited")
  assert.equal(rejected.delivery, "sent")
  assert.equal((await upload(token, 1, audio[1])).delivery, "not_sent")
  assert.equal(posts, 1)
})

test("the per-import authorization cannot use a chat consent flag", () => {
  const valid = validateWsMessage({
    type: "meeting.asr.authorize", id: "unrelated-ack", v: 1, config_identity: "0".repeat(64),
    privacy_ack_v1: true, privacy_ack_external_v1: true,
    segments: [{ bytes: 32_044, sha256: "0".repeat(64) }],
  })
  assert.equal(valid.valid, false)
})

test("changing an external endpoint requires a new explicit key or clearing the previous one", async () => {
  const { request } = harness({ mode: "external", external: openAi })
  const current = (await request("get")).state.configIdentity
  const update = await request("set", {
    source: "settings", expected_identity: current, mode: "external", external: { baseUrl: "https://other-asr.example/v1" },
  })
  assert.equal(update.code, "external_key_required_for_endpoint")
  assert.equal((await request("get")).state.normalizedUrl, "https://asr.example/v1/audio/transcriptions")
})

test("production settings persist meeting credentials independently and exclude them from config wire responses", async () => {
  const chat = { ...openAi, apiKey: "isolated-fixture-chat", baseUrl: "https://other-chat.invalid/" }
  setVoiceFields({ sttEngine: "external", external: chat })
  const ctx = { origin: "chrome-extension://paired", peerId }
  const get = { type: "meeting.asr.get", v: 1, id: "settings-test-read" }
  const first = await handleMeetingMessage(get, ctx)
  assert.equal(first.state.mode, "local")
  const saved = await handleMeetingMessage({
    type: "meeting.asr.set", v: 1, id: "settings-test-set", source: "settings",
    expected_identity: first.state.configIdentity, mode: "external", external: openAi,
  }, ctx)
  assert.equal(saved.state.mode, "external")
  assert.equal(getConfig().voice?.meetingAsr?.external.apiKey, "meeting-secret")
  assert.deepEqual(getConfig().voice?.external, chat)
  assert.equal(redactConfigForWire(getConfig()).voice.meetingAsr, undefined)
  const overlay = await handleMeetingMessage(get, { origin: "cmspark-tray://local", surface: "summoner", peerId })
  assert.equal(overlay.code, "origin_denied")
})

test("local meeting import can use prepared Whisper when the separate chat engine is external", async () => {
  setVoiceFields({ sttEngine: "external" })
  const root = join(DATA_DIR, "fixture-whisper")
  const service = new SttSessionService({
    dataDir: DATA_DIR, whisperRoot: root,
    probeModel: () => ({ status: "ready" }), resolveModelPath: () => join(root, "medium.bin"),
    resolveBinary: () => ({ ok: true, path: "OWNED_NO_PROCESS", arch: "win-x64", pinned: true, sha256: "test" }),
  })
  const ctx = { origin: "chrome-extension://paired", peerId, surface: "panel" }
  const start = {
    type: "voice.stt.start", v: 1, sessionId: "local-import", modelId: "medium",
    format: "wav", sampleRate: 16_000, channels: 1, privacy_ack_v2: true,
  }
  assert.equal((await handleVoiceSttMessage(start, ctx, { service })).code, "engine_not_local")
  const explicit = { ...start, purpose: "meeting-import" }
  assert.equal(validateWsMessage(explicit).valid, true)
  setVoiceFields({ meetingAsr: { mode: "external", external: openAi } })
  assert.equal((await handleVoiceSttMessage(explicit, ctx, { service })).code, "meeting_asr_configuration_changed")
  setVoiceFields({ meetingAsr: { mode: "local", external: openAi } })
  assert.equal((await handleVoiceSttMessage(explicit, ctx, { service })).type, "voice.stt.partial")
  await handleVoiceSttMessage({ type: "voice.stt.abort", v: 1, sessionId: start.sessionId }, ctx, { service })
})

test("live microphone consent is capture-bound and cannot become chat consent", async () => {
  const frame = { type: "voice.stt.start", v: 1, sessionId: "00000000-0000-4000-8000-000000000878", capture_epoch: 1, queue_contract: 1,
    format: "pcm_s16le", sampleRate: 16000, channels: 1, engine: "meeting-external" }
  assert.equal(validateWsMessage(frame).valid, true)
  const { capture_epoch, queue_contract, ...legacy } = frame
  assert.equal(validateWsMessage(legacy).valid, false)
  assert.equal((await handleVoiceSttMessage(frame, { origin: "chrome-extension://owned", peerId })).code, "stale_capture")
  const begin = { type: "meeting.start", v: 1, id: "fixture-live", queue_contract, capture_id: frame.sessionId,
    expected_capture_epoch: capture_epoch - 1, privacy_ack_v1: true, live_asr: "1".repeat(64) }
  assert.equal(validateWsMessage(begin).valid, false)
  assert.equal(validateWsMessage({ ...begin, privacy_ack_v2: true }).valid, false)
  assert.equal(validateWsMessage({ ...begin, privacy_ack_meeting_asr_v1: true }).valid, true)
})

test("live ASR stops before dispatch when the confirmed receiver changes during DNS", async () => {
  let resolving!: () => void, ready!: (r: { address: string; family: number }[]) => void
  const started = new Promise<void>(resolve => { resolving = resolve })
  let requests = 0
  const { service, setConfig } = harness({ mode: "external", external: openAi }, {
    lookup: () => { resolving(); return new Promise(resolve => { ready = resolve }) },
    fetchImpl: async () => { requests++; return { status: 200, json: async () => ({ text: "heard" }) } },
  })
  assert.equal(service.openLive("0".repeat(64)), null)
  const lease = service.openLive(service.state().state.configIdentity)!
  const result = lease.transcribe(wavFixture(3))
  await started
  setConfig({ mode: "external", external: { ...openAi, model: "different" } })
  ready([{ address: "1.1.1.1", family: 4 }])
  assert.deepEqual(await result, { ok: false, code: "external_configuration_changed", message: "meeting ASR target changed" })
  assert.equal(requests, 0)
})
