// #260 — diarize speaker-embedding model download/delete/probe.
// Mirrors voice-whisper-download.test.ts harness; mock fetch only.
// Core invariant: the voice-models disk budget is SHARED across the whisper
// root and the diarize root (sum of subtrees, one 4096MB default).

import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  DIARIZE_MODEL_ID,
  _resetDiarizeDownloadInflightForTests,
  deleteDiarizeModel,
  diarizeModelDestDir,
  downloadDiarizeModel,
  probeDiarizeModel,
  resolveDiarizeRoot,
} from "../src/voice/diarize-model"
import {
  WhisperDownloadError,
  _resetWhisperDownloadInflightForTests,
  downloadWhisperModel,
} from "../src/voice/whisper-download"
import type { DiarizeManifest } from "../src/voice/diarize-manifest"
import type { WhisperManifest } from "../src/voice/whisper-manifest"

// --- fixtures -----------------------------------------------------------------

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

function contentOf(seed: number, size: number): Buffer {
  const buf = Buffer.alloc(size)
  for (let i = 0; i < size; i++) buf[i] = (seed + i) % 251
  return buf
}

const MODEL_BYTES = contentOf(13, 300 * 1024)
const MODEL_URL = `https://models.cmspark.invalid/diarize/${DIARIZE_MODEL_ID}/speaker.onnx`

function makeDiarizeManifest(): DiarizeManifest {
  return {
    schemaVersion: 1,
    models: {
      [DIARIZE_MODEL_ID]: {
        files: [
          {
            name: "speaker.onnx",
            url: MODEL_URL,
            sha256: sha256(MODEL_BYTES),
            size: MODEL_BYTES.byteLength,
          },
        ],
      },
    },
  }
}

function makeWhisperManifest(): WhisperManifest {
  const small = contentOf(3, 512)
  return {
    schemaVersion: 1,
    models: {
      small: {
        files: [
          {
            name: "ggml-small.bin",
            url: "https://models.cmspark.invalid/whisper/small/ggml-small.bin",
            sha256: sha256(small),
            size: small.byteLength,
          },
        ],
      },
    },
  }
}

// --- fake fetch (subset of whisper harness) -------------------------------------

interface FakeRoute {
  body: Buffer
  failAfterBytes?: number
  corruptAt?: number
  callCount: number
  seenRanges: (string | undefined)[]
}

function bodyStream(body: Buffer, route: FakeRoute, signal?: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(c) {
      const failAt = route.failAfterBytes
      const corruptAt = route.corruptAt
      const limit = failAt !== undefined ? Math.min(failAt, body.byteLength) : body.byteLength
      for (let off = 0; off < limit; off += 256) {
        if (signal?.aborted) {
          c.error(new DOMException("The operation was aborted.", "AbortError"))
          return
        }
        const chunk = Buffer.from(body.subarray(off, Math.min(off + 256, limit)))
        if (corruptAt !== undefined && corruptAt >= off && corruptAt < off + chunk.byteLength) {
          chunk[corruptAt - off] = chunk[corruptAt - off]! ^ 0xff
        }
        c.enqueue(chunk)
        await new Promise((r) => setImmediate(r))
      }
      if (failAt !== undefined && failAt < body.byteLength) {
        c.error(new Error("simulated connection reset"))
        return
      }
      c.close()
    },
  })
}

function makeFakeFetch(routes: Record<string, FakeRoute>): typeof fetch {
  return (async (input: unknown, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
    const url = String(input)
    const route = routes[url]
    if (!route) return new Response("not found", { status: 404 })
    route.callCount++
    if (init?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError")
    }
    route.seenRanges.push(init?.headers?.Range)
    return new Response(bodyStream(route.body, route, init?.signal) as any, {
      status: 200,
      headers: {},
    })
  }) as unknown as typeof fetch
}

function makeEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "cmspark-diarize-dl-"))
  const modelsParent = path.join(dir, "models")
  const whisperRoot = path.join(modelsParent, "whisper")
  const diarizeRoot = path.join(modelsParent, "diarize")
  const qwenSibling = path.join(modelsParent, "qwen-vl")
  mkdirSync(whisperRoot, { recursive: true })
  mkdirSync(diarizeRoot, { recursive: true })
  mkdirSync(qwenSibling, { recursive: true })
  return {
    dir,
    modelsParent,
    whisperRoot,
    diarizeRoot,
    qwenSibling,
    cleanup: () => {
      _resetDiarizeDownloadInflightForTests()
      _resetWhisperDownloadInflightForTests()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function expectReason(err: unknown, reason: string): void {
  assert.ok(err instanceof WhisperDownloadError, `expected WhisperDownloadError, got ${String(err)}`)
  assert.equal(err.reason, reason)
}

test("happy path: download → file at models/diarize/<id>, probe ready", async () => {
  const env = makeEnv()
  try {
    const route: FakeRoute = { body: MODEL_BYTES, callCount: 0, seenRanges: [] }
    await downloadDiarizeModel({
      fetchImpl: makeFakeFetch({ [MODEL_URL]: route }),
      rootDir: env.diarizeRoot,
      dataDir: env.dir,
      budgetMB: 4,
      manifest: makeDiarizeManifest(),
    })
    const dest = diarizeModelDestDir(DIARIZE_MODEL_ID, env.diarizeRoot)
    assert.ok(existsSync(path.join(dest, "speaker.onnx")), "final onnx present")
    assert.ok(!existsSync(path.join(dest, "speaker.onnx.part")), "no .part residue")
    assert.ok(!existsSync(path.join(dest, "speaker.onnx.part.json")), "no .part.json residue")
    assert.deepEqual(probeDiarizeModel(env.diarizeRoot, makeDiarizeManifest()), { status: "ready" })
  } finally {
    env.cleanup()
  }
})

test("probe: absent before any download", () => {
  const env = makeEnv()
  try {
    assert.deepEqual(probeDiarizeModel(env.diarizeRoot, makeDiarizeManifest()), { status: "absent" })
  } finally {
    env.cleanup()
  }
})

test("probe: incomplete when only .part residue exists", () => {
  const env = makeEnv()
  try {
    const dest = diarizeModelDestDir(DIARIZE_MODEL_ID, env.diarizeRoot)
    mkdirSync(dest, { recursive: true })
    writeFileSync(path.join(dest, "speaker.onnx.part"), MODEL_BYTES.subarray(0, 1024))
    const p = probeDiarizeModel(env.diarizeRoot, makeDiarizeManifest())
    assert.equal(p.status, "incomplete")
    assert.equal(p.error, "partial-download")
  } finally {
    env.cleanup()
  }
})

test("corrupt download → hash-mismatch, no final file, probe not ready", async () => {
  const env = makeEnv()
  try {
    const route: FakeRoute = {
      body: MODEL_BYTES,
      corruptAt: 100,
      callCount: 0,
      seenRanges: [],
    }
    await assert.rejects(
      downloadDiarizeModel({
        fetchImpl: makeFakeFetch({ [MODEL_URL]: route }),
        rootDir: env.diarizeRoot,
        dataDir: env.dir,
        budgetMB: 4,
        manifest: makeDiarizeManifest(),
      }),
      (err: unknown) => {
        expectReason(err, "hash-mismatch")
        return true
      },
    )
    assert.ok(!existsSync(path.join(diarizeModelDestDir(DIARIZE_MODEL_ID, env.diarizeRoot), "speaker.onnx")))
    assert.notEqual(probeDiarizeModel(env.diarizeRoot, makeDiarizeManifest()).status, "ready")
  } finally {
    env.cleanup()
  }
})

test("SHARED budget: junk in whisper root blocks diarize download (disk-budget-exceeded)", async () => {
  const env = makeEnv()
  try {
    // 1.2MB junk in the WHISPER subtree must consume the shared budget
    mkdirSync(path.join(env.whisperRoot, "small"), { recursive: true })
    writeFileSync(
      path.join(env.whisperRoot, "small", "ggml-small.bin"),
      Buffer.alloc(1.2 * 1024 * 1024),
    )
    // qwen sibling is NOT part of the budget — add junk there too as control
    writeFileSync(path.join(env.qwenSibling, "junk.bin"), Buffer.alloc(2 * 1024 * 1024))

    const route: FakeRoute = { body: MODEL_BYTES, callCount: 0, seenRanges: [] }
    await assert.rejects(
      downloadDiarizeModel({
        fetchImpl: makeFakeFetch({ [MODEL_URL]: route }),
        rootDir: env.diarizeRoot,
        dataDir: env.dir,
        budgetMB: 1, // 1MB budget: 1.2MB whisper junk + 300KB model > budget
        manifest: makeDiarizeManifest(),
      }),
      (err: unknown) => {
        expectReason(err, "disk-budget-exceeded")
        return true
      },
    )
    assert.equal(route.callCount, 0, "zero fetch on budget fail-closed")
  } finally {
    env.cleanup()
  }
})

test("SHARED budget (reverse): diarize junk blocks whisper download too", async () => {
  const env = makeEnv()
  try {
    mkdirSync(path.join(env.diarizeRoot, DIARIZE_MODEL_ID), { recursive: true })
    writeFileSync(
      path.join(env.diarizeRoot, DIARIZE_MODEL_ID, "speaker.onnx"),
      Buffer.alloc(1.2 * 1024 * 1024),
    )
    const wm = makeWhisperManifest()
    const route: FakeRoute = {
      body: contentOf(3, 512),
      callCount: 0,
      seenRanges: [],
    }
    await assert.rejects(
      downloadWhisperModel("small", {
        fetchImpl: makeFakeFetch({ "https://models.cmspark.invalid/whisper/small/ggml-small.bin": route }),
        rootDir: env.whisperRoot,
        dataDir: env.dir,
        budgetMB: 1,
        manifest: wm,
      }),
      (err: unknown) => {
        expectReason(err, "disk-budget-exceeded")
        return true
      },
    )
    assert.equal(route.callCount, 0, "zero fetch on budget fail-closed")
  } finally {
    env.cleanup()
  }
})

test("interrupted download resumes on second call (Range attempt + final ready)", async () => {
  const env = makeEnv()
  try {
    const failing: FakeRoute = {
      body: MODEL_BYTES,
      failAfterBytes: 1024,
      callCount: 0,
      seenRanges: [],
    }
    await assert.rejects(
      downloadDiarizeModel({
        fetchImpl: makeFakeFetch({ [MODEL_URL]: failing }),
        rootDir: env.diarizeRoot,
        dataDir: env.dir,
        budgetMB: 4,
        manifest: makeDiarizeManifest(),
      }),
      (err: unknown) => {
        expectReason(err, "network-error")
        return true
      },
    )
    const dest = diarizeModelDestDir(DIARIZE_MODEL_ID, env.diarizeRoot)
    const partPath = `${path.join(dest, "speaker.onnx")}.part`
    assert.ok(existsSync(partPath), ".part kept for resume")
    // pipeline destroy on stream error may discard in-flight writes — the on-disk
    // .part size (not failAfterBytes) is the resume contract.
    const partSize = statSync(partPath).size
    assert.ok(partSize > 0 && partSize < MODEL_BYTES.byteLength, "partial bytes kept")

    const resuming: FakeRoute = { body: MODEL_BYTES, callCount: 0, seenRanges: [] }
    await downloadDiarizeModel({
      fetchImpl: makeFakeFetch({ [MODEL_URL]: resuming }),
      rootDir: env.diarizeRoot,
      dataDir: env.dir,
      budgetMB: 4,
      manifest: makeDiarizeManifest(),
    })
    assert.ok(
      resuming.seenRanges.includes(`bytes=${partSize}-`),
      `Range resume attempted from .part size ${partSize}`,
    )
    assert.deepEqual(probeDiarizeModel(env.diarizeRoot, makeDiarizeManifest()), { status: "ready" })
  } finally {
    env.cleanup()
  }
})

test("single-flight: concurrent downloads share one fetch; success is idempotent", async () => {
  const env = makeEnv()
  try {
    const route: FakeRoute = { body: MODEL_BYTES, callCount: 0, seenRanges: [] }
    const fetchImpl = makeFakeFetch({ [MODEL_URL]: route })
    const opts = () => ({
      fetchImpl,
      rootDir: env.diarizeRoot,
      dataDir: env.dir,
      budgetMB: 4,
      manifest: makeDiarizeManifest(),
    })
    await Promise.all([downloadDiarizeModel(opts()), downloadDiarizeModel(opts())])
    assert.equal(route.callCount, 1, "one fetch for two concurrent calls")

    // second full run after success → zero additional fetches
    await downloadDiarizeModel(opts())
    assert.equal(route.callCount, 1, "idempotent skip on verified final")
  } finally {
    env.cleanup()
  }
})

test("delete → dir removed, probe absent", async () => {
  const env = makeEnv()
  try {
    const route: FakeRoute = { body: MODEL_BYTES, callCount: 0, seenRanges: [] }
    await downloadDiarizeModel({
      fetchImpl: makeFakeFetch({ [MODEL_URL]: route }),
      rootDir: env.diarizeRoot,
      dataDir: env.dir,
      budgetMB: 4,
      manifest: makeDiarizeManifest(),
    })
    await deleteDiarizeModel(env.diarizeRoot)
    assert.deepEqual(probeDiarizeModel(env.diarizeRoot, makeDiarizeManifest()), { status: "absent" })
  } finally {
    env.cleanup()
  }
})

test("resolveDiarizeRoot default under dataDir: models/diarize (whisper sibling)", () => {
  const env = makeEnv()
  try {
    assert.equal(resolveDiarizeRoot({ dataDir: env.dir }), env.diarizeRoot)
  } finally {
    env.cleanup()
  }
})
