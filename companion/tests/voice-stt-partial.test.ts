import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { SttSessionCore } from "../src/voice/stt-session-core"
import { SttSessionService } from "../src/voice/stt-session-service"
import { handleVoiceSttMessage } from "../src/voice/stt-handlers"

function tempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-stt-partial-"))
}

function plantReadyModel(whisperRoot: string) {
  const dir = path.join(whisperRoot, "small")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "ggml-small.bin"), Buffer.alloc(64))
}

test("core snapshotAudio does not end session", () => {
  const core = new SttSessionCore()
  assert.equal(
    core.start({
      sessionId: "s1",
      modelId: "small",
      format: "pcm_s16le",
      sampleRate: 16000,
      channels: 1,
    }).ok,
    true,
  )
  // ~1s of silence PCM so partial min bytes can pass in service tests
  const pcm = Buffer.alloc(16_000 * 2)
  assert.equal(core.appendChunk("s1", 0, pcm).ok, true)
  const snap = core.snapshotAudio("s1")
  assert.equal(snap.ok, true)
  if (snap.ok && "audio" in snap) {
    assert.equal(snap.bytes, pcm.length)
  }
  assert.equal(core.getActive()?.phase, "receiving")
  assert.equal(core.getActive()?.chunks.size, 1)
})

test("service.partial returns hypothesis text without ending", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)

  let runs = 0
  const svc = new SttSessionService({
    dataDir,
    whisperRoot,
    runWhisper: async () => {
      runs += 1
      return { text: "你好世界", ms: 10 }
    },
    resolveBinary: () => ({
      ok: true,
      path: "/fake/cmspark-whisper",
      arch: "darwin-arm64",
      sha256: "x",
      pinned: false,
    }),
    probeModel: () => ({ status: "ready" as const }),
  })

  assert.equal(
    svc.start(
      {
        sessionId: "sess-p",
        modelId: "small",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
      },
      "peer-A",
    ).ok,
    true,
  )
  // enough audio for STT_PARTIAL_MIN_AUDIO_BYTES
  const pcm = Buffer.alloc(Math.ceil(16_000 * 2 * 0.9))
  assert.equal(svc.chunk("sess-p", 0, pcm, "peer-A").ok, true)

  const partial = await svc.partial("sess-p", "peer-A")
  assert.equal(partial.ok, true)
  if (partial.ok) assert.equal(partial.text, "你好世界")
  assert.equal(runs, 1)
  assert.equal(svc.getActive()?.phase, "receiving")

  // rate limit → skip
  const skip = await svc.partial("sess-p", "peer-A")
  assert.equal(skip.ok, false)
  if (!skip.ok) assert.equal(skip.code, "partial_skipped")
})

test("partial_busy when previous partial still running (F2 no cancel-restart)", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)

  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  let runs = 0
  const svc = new SttSessionService({
    dataDir,
    whisperRoot,
    runWhisper: async () => {
      runs += 1
      await gate
      return { text: `run-${runs}`, ms: 50 }
    },
    resolveBinary: () => ({
      ok: true,
      path: "/fake/cmspark-whisper",
      arch: "darwin-arm64",
      sha256: "x",
      pinned: false,
    }),
    probeModel: () => ({ status: "ready" as const }),
  })

  assert.equal(
    svc.start(
      {
        sessionId: "busy1",
        modelId: "small",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
      },
      "peer-A",
    ).ok,
    true,
  )
  const pcm = Buffer.alloc(Math.ceil(16_000 * 2 * 0.9))
  assert.equal(svc.chunk("busy1", 0, pcm, "peer-A").ok, true)

  const p1 = svc.partial("busy1", "peer-A")
  // Second call while first still running → busy, not cancel
  const p2 = await svc.partial("busy1", "peer-A")
  assert.equal(p2.ok, false)
  if (!p2.ok) assert.equal(p2.code, "partial_busy")
  release()
  const done = await p1
  assert.equal(done.ok, true)
  if (done.ok) assert.equal(done.text, "run-1")
  assert.equal(runs, 1)
})

test("handler partial_request emits hypothesis", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)
  const svc = new SttSessionService({
    dataDir,
    whisperRoot,
    runWhisper: async () => ({ text: "hello partial", ms: 5 }),
    resolveBinary: () => ({
      ok: true,
      path: "/fake/w",
      arch: "darwin-arm64",
      sha256: "x",
      pinned: false,
    }),
    probeModel: () => ({ status: "ready" as const }),
  })

  const sent: any[] = []
  const ctx = {
    origin: "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef",
    peerId: "panel-1",
    send: (m: any) => sent.push(m),
  }

  await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "hs1",
      modelId: "small",
      format: "pcm_s16le",
      sampleRate: 16000,
      channels: 1,
    },
    ctx,
    { service: svc },
  )
  await handleVoiceSttMessage(
    {
      type: "voice.stt.chunk",
      v: 1,
      sessionId: "hs1",
      seq: 0,
      data: Buffer.alloc(Math.ceil(16_000 * 2 * 0.9)).toString("base64"),
    },
    ctx,
    { service: svc },
  )
  const out = await handleVoiceSttMessage(
    { type: "voice.stt.partial_request", v: 1, sessionId: "hs1" },
    ctx,
    { service: svc },
  )
  assert.equal(out?.type, "voice.stt.partial")
  assert.equal(out?.status, "hypothesis")
  assert.equal(out?.text, "hello partial")
  assert.equal(out?.ms, 5)
})
