// Path B M1 Task 3 — stt-session-service with fake runner + temp dirs

import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  SttSessionService,
  bootGcVoiceSttTmp,
  getSttSessionService,
  resetSttSessionServiceForTests,
} from "../src/voice/stt-session-service"
import { voiceSttTmpRoot } from "../src/voice/stt-tmp"
import type { WhisperManifest } from "../src/voice/whisper-manifest"
import { WhisperRunnerError } from "../src/voice/whisper-runner"

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

function tempDataDir(): string {
  return mkdtempSync(path.join(tmpdir(), "cmspark-stt-svc-"))
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

function plantReadyModel(whisperRoot: string, modelId = "small"): string {
  const dir = path.join(whisperRoot, modelId)
  mkdirSync(dir, { recursive: true })
  const modelPath = path.join(dir, `ggml-${modelId === "large-v3-turbo" ? "large-v3-turbo" : modelId}.bin`)
  // for small: ggml-small.bin
  const name = modelId === "large-v3-turbo" ? "ggml-large-v3-turbo.bin" : `ggml-${modelId}.bin`
  const p = path.join(dir, name)
  writeFileSync(p, MODEL_BYTES)
  return p
}

function makeService(opts: {
  dataDir: string
  whisperRoot: string
  runWhisper?: SttSessionService extends never ? never : ConstructorParameters<typeof SttSessionService>[0]["runWhisper"]
  resolveBinary?: ConstructorParameters<typeof SttSessionService>[0]["resolveBinary"]
  uploadIdleMs?: number
  maxRecordMs?: number
  inferMaxMs?: number
}): SttSessionService {
  const manifest = testManifest()
  return new SttSessionService({
    dataDir: opts.dataDir,
    whisperRoot: opts.whisperRoot,
    manifest,
    probeModel: (id) => {
      const p = path.join(opts.whisperRoot, id, id === "large-v3-turbo" ? "ggml-large-v3-turbo.bin" : `ggml-${id}.bin`)
      if (existsSync(p)) return { status: "ready" }
      return { status: "absent" }
    },
    resolveBinary:
      opts.resolveBinary ??
      (() => ({
        ok: true as const,
        path: "/fake/cmspark-whisper",
        arch: "darwin-arm64" as const,
        sha256: "a".repeat(64),
        pinned: false,
      })),
    runWhisper:
      opts.runWhisper ??
      (async () => ({ text: "你好世界", ms: 12 })),
    uploadIdleMs: opts.uploadIdleMs,
    maxRecordMs: opts.maxRecordMs,
    inferMaxMs: opts.inferMaxMs,
  })
}

test("happy path: start chunk end returns text and cleans tmp", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot, "small")

  let runnerCalls = 0
  let seenAudioPath = ""
  let seenModelPath = ""
  const svc = makeService({
    dataDir,
    whisperRoot,
    runWhisper: async (o) => {
      runnerCalls += 1
      seenAudioPath = o.audioPath
      seenModelPath = o.modelPath
      assert.ok(existsSync(o.audioPath), "audio must exist during run")
      assert.equal(o.binaryPath, "/fake/cmspark-whisper")
      return { text: "hello fixture", ms: 42 }
    },
  })

  const start = svc.start(
    {
      sessionId: "sess1",
      modelId: "small",
      format: "pcm_s16le",
      sampleRate: 16000,
      channels: 1,
    },
    "peer-A",
  )
  assert.equal(start.ok, true)
  assert.equal(svc.chunk("sess1", 0, Buffer.from("pcm-bytes"), "peer-A").ok, true)
  assert.equal(svc.chunk("sess1", 1, Buffer.from("-more"), "peer-A").ok, true)

  const end = await svc.end("sess1", 2, "peer-A")
  assert.equal(end.ok, true)
  if (end.ok) {
    assert.equal(end.text, "hello fixture")
    assert.equal(end.ms, 42)
    assert.equal(end.modelId, "small")
  }
  assert.equal(runnerCalls, 1)
  assert.ok(seenModelPath.includes(path.join("small", "ggml-small.bin")))
  // tmp cleaned after end
  assert.equal(existsSync(seenAudioPath), false)
  assert.equal(svc.getActive(), null)
})

test("peer mismatch rejects chunk/end/abort from other peer", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)

  const svc = makeService({ dataDir, whisperRoot })
  assert.equal(
    svc.start(
      {
        sessionId: "s",
        modelId: "small",
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      },
      "owner",
    ).ok,
    true,
  )
  const chunk = svc.chunk("s", 0, Buffer.from("x"), "intruder")
  assert.equal(chunk.ok, false)
  if (!chunk.ok) assert.equal(chunk.code, "peer_mismatch")

  const end = await svc.end("s", 0, "intruder")
  assert.equal(end.ok, false)
  if (!end.ok) assert.equal(end.code, "peer_mismatch")

  const abort = svc.abort("s", "intruder")
  assert.equal(abort.ok, false)
  if (!abort.ok) assert.equal(abort.code, "peer_mismatch")
})

test("model_missing when probe not ready", () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  mkdirSync(whisperRoot, { recursive: true })
  // no planted model
  const svc = makeService({ dataDir, whisperRoot })
  const r = svc.start(
    {
      sessionId: "s",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    },
    "p",
  )
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "model_missing")
})

test("binary_missing / hash_fail from resolveBinary", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)

  const missing = makeService({
    dataDir,
    whisperRoot,
    resolveBinary: () => ({
      ok: false,
      reason: "not_found",
      arch: "darwin-arm64",
      message: "not found",
    }),
  })
  missing.start(
    {
      sessionId: "s1",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    },
    "p",
  )
  missing.chunk("s1", 0, Buffer.from("a"), "p")
  const e1 = await missing.end("s1", 1, "p")
  assert.equal(e1.ok, false)
  if (!e1.ok) assert.equal(e1.code, "binary_missing")

  const hash = makeService({
    dataDir,
    whisperRoot,
    resolveBinary: () => ({
      ok: false,
      reason: "hash_mismatch",
      arch: "darwin-arm64",
      message: "bad hash",
    }),
  })
  hash.start(
    {
      sessionId: "s2",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    },
    "p",
  )
  hash.chunk("s2", 0, Buffer.from("a"), "p")
  const e2 = await hash.end("s2", 1, "p")
  assert.equal(e2.ok, false)
  if (!e2.ok) assert.equal(e2.code, "hash_fail")
})

test("infer_timeout maps from runner", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)
  const svc = makeService({
    dataDir,
    whisperRoot,
    runWhisper: async () => {
      throw new WhisperRunnerError("timeout", "whisper timed out after 1ms")
    },
  })
  svc.start(
    {
      sessionId: "s",
      modelId: "small",
      format: "pcm_s16le",
      sampleRate: 16000,
      channels: 1,
    },
    "p",
  )
  svc.chunk("s", 0, Buffer.from("x"), "p")
  const end = await svc.end("s", 1, "p")
  assert.equal(end.ok, false)
  if (!end.ok) assert.equal(end.code, "infer_timeout")
})

test("abort during infer cancels and cleans tmp", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)

  let audioPathDuring = ""
  const svc = makeService({
    dataDir,
    whisperRoot,
    runWhisper: async (o) => {
      audioPathDuring = o.audioPath
      // simulate abort via signal
      return await new Promise((_resolve, reject) => {
        o.signal?.addEventListener("abort", () => {
          reject(new WhisperRunnerError("aborted", "whisper aborted"))
        })
        // if never aborted, hang until test timeout — abort will fire
      })
    },
  })

  svc.start(
    {
      sessionId: "ab1",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    },
    "p",
  )
  svc.chunk("ab1", 0, Buffer.from("zz"), "p")

  const endP = svc.end("ab1", 1, "p")
  // allow end to enter runner
  await new Promise((r) => setTimeout(r, 20))
  const ab = svc.abort("ab1", "p")
  assert.equal(ab.ok, true)

  const end = await endP
  assert.equal(end.ok, false)
  if (!end.ok) assert.equal(end.code, "aborted")
  // tmp should be gone
  if (audioPathDuring) {
    assert.equal(existsSync(audioPathDuring), false)
  }
})

test("session_busy and invalid_session_id", () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)
  const svc = makeService({ dataDir, whisperRoot })

  assert.equal(
    svc.start(
      {
        sessionId: "a",
        modelId: "small",
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      },
      "p",
    ).ok,
    true,
  )
  const busy = svc.start(
    {
      sessionId: "b",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    },
    "p",
  )
  assert.equal(busy.ok, false)
  if (!busy.ok) assert.equal(busy.code, "session_busy")

  svc.forceAbort()
  const bad = svc.start(
    {
      sessionId: "../evil",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    },
    "p",
  )
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.equal(bad.code, "invalid_session_id")
})

test("idle timer force-aborts receiving session", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)
  const svc = makeService({ dataDir, whisperRoot, uploadIdleMs: 40 })
  assert.equal(
    svc.start(
      {
        sessionId: "idle1",
        modelId: "small",
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      },
      "p",
    ).ok,
    true,
  )
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(svc.getActive(), null)
  const chunk = svc.chunk("idle1", 0, Buffer.from("x"), "p")
  assert.equal(chunk.ok, false)
})

test("singleton get/reset for tests", () => {
  resetSttSessionServiceForTests()
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)
  const a = getSttSessionService({
    dataDir,
    whisperRoot,
    probeModel: () => ({ status: "ready" }),
    resolveBinary: () => ({
      ok: true,
      path: "/x",
      arch: "darwin-arm64",
      sha256: "b".repeat(64),
      pinned: false,
    }),
    runWhisper: async () => ({ text: "t", ms: 1 }),
  })
  const b = getSttSessionService()
  assert.equal(a, b)
  resetSttSessionServiceForTests()
})

test("bootGcVoiceSttTmp is callable", async () => {
  const dataDir = tempDataDir()
  const n = await bootGcVoiceSttTmp(dataDir, 1000)
  assert.equal(n, 0)
  // ensure root path shape
  assert.ok(voiceSttTmpRoot(dataDir).endsWith(path.join("tmp", "voice-stt")))
})

test("resolveModelPath reject escape via custom resolver", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)
  const svc = new SttSessionService({
    dataDir,
    whisperRoot,
    probeModel: () => ({ status: "ready" }),
    resolveBinary: () => ({
      ok: true,
      path: "/x",
      arch: "darwin-arm64",
      sha256: "c".repeat(64),
      pinned: false,
    }),
    resolveModelPath: () => "/etc/passwd",
    runWhisper: async () => ({ text: "nope", ms: 1 }),
  })
  svc.start(
    {
      sessionId: "esc",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    },
    "p",
  )
  svc.chunk("esc", 0, Buffer.from("a"), "p")
  const end = await svc.end("esc", 1, "p")
  assert.equal(end.ok, false)
  if (!end.ok) assert.equal(end.code, "model_missing")
})

test("end maps generic runner errors to infer_failed not resource_conflict", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)
  const svc = makeService({
    dataDir,
    whisperRoot,
    runWhisper: async () => {
      throw new Error("spawn EACCES")
    },
  })
  assert.equal(
    svc.start(
      {
        sessionId: "e1",
        modelId: "small",
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      },
      "p",
    ).ok,
    true,
  )
  svc.chunk("e1", 0, Buffer.from("RIFF...."), "p")
  const end = await svc.end("e1", 1, "p")
  assert.equal(end.ok, false)
  if (!end.ok) {
    assert.equal(end.code, "infer_failed")
    assert.match(end.message, /EACCES|spawn/i)
  }
})

test("end maps OOM-like runner errors to oom", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)
  const svc = makeService({
    dataDir,
    whisperRoot,
    runWhisper: async () => {
      throw new Error("out of memory: cannot allocate buffer")
    },
  })
  assert.equal(
    svc.start(
      {
        sessionId: "e-oom",
        modelId: "small",
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      },
      "p",
    ).ok,
    true,
  )
  svc.chunk("e-oom", 0, Buffer.from("RIFF...."), "p")
  const end = await svc.end("e-oom", 1, "p")
  assert.equal(end.ok, false)
  if (!end.ok) {
    assert.equal(end.code, "oom")
    assert.match(end.message, /out of memory|cannot allocate/i)
  }
})

test("forceAbort clears inferring so a new start can proceed", async () => {
  const dataDir = tempDataDir()
  const whisperRoot = path.join(dataDir, "models", "whisper")
  plantReadyModel(whisperRoot)
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const svc = makeService({
    dataDir,
    whisperRoot,
    runWhisper: async ({ signal }) => {
      await gate
      if (signal?.aborted) {
        throw new WhisperRunnerError("aborted", "aborted")
      }
      return { text: "hi", ms: 1 }
    },
  })
  assert.ok(
    svc.start(
      {
        sessionId: "old",
        modelId: "small",
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      },
      "peerA",
    ).ok,
  )
  svc.chunk("old", 0, Buffer.from("x"), "peerA")
  const endP = svc.end("old", 1, "peerA")
  await new Promise((r) => setTimeout(r, 20))
  const blocked = svc.start(
    {
      sessionId: "new",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    },
    "peerA",
  )
  assert.equal(blocked.ok, false)
  if (!blocked.ok) assert.equal(blocked.code, "resource_conflict")

  svc.forceAbort()
  release()
  await endP

  const ok = svc.start(
    {
      sessionId: "new2",
      modelId: "small",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    },
    "peerA",
  )
  assert.equal(ok.ok, true)
})
