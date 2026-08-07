// Path B M0 Task 3 — whisper-download (budget scoped to whisper root; mock fetch only)

import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  DEFAULT_WHISPER_DISK_BUDGET_MB,
  WhisperDownloadError,
  _resetWhisperDownloadInflightForTests,
  deleteWhisperModel,
  dirOccupiedBytes,
  downloadWhisperModel,
  probeWhisperModelDir,
  resolveWhisperRoot,
} from "../src/voice/whisper-download"
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

const FILE_A = contentOf(7, 2048)
const FILE_B = contentOf(91, 512)

function makeManifest(
  files: { name: string; content: Buffer }[] = [{ name: "ggml-medium.bin", content: FILE_A }],
  modelId = "medium",
): WhisperManifest {
  return {
    schemaVersion: 1,
    models: {
      small: {
        files: [
          {
            name: "ggml-small.bin",
            url: "https://models.cmspark.invalid/whisper/small/ggml-small.bin",
            sha256: sha256(FILE_B),
            size: FILE_B.byteLength,
          },
        ],
      },
      medium: {
        files: files.map((f) => ({
          name: f.name,
          url: `https://models.cmspark.invalid/whisper/${modelId}/${f.name}`,
          sha256: sha256(f.content),
          size: f.content.byteLength,
        })),
      },
      "large-v3-turbo": {
        files: [
          {
            name: "ggml-large-v3-turbo.bin",
            url: "https://models.cmspark.invalid/whisper/large/ggml-large-v3-turbo.bin",
            sha256: sha256(FILE_A),
            size: FILE_A.byteLength,
          },
        ],
      },
    },
  }
}

// --- fake fetch ---------------------------------------------------------------

interface FakeRoute {
  body: Buffer
  failAfterBytes?: number
  corruptAt?: number
  headers?: Record<string, string>
  cancelled?: boolean
  seenRanges: (string | undefined)[]
  callCount: number
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
    cancel() {
      route.cancelled = true
    },
  })
}

function makeFakeFetch(routes: Record<string, FakeRoute>): typeof fetch {
  return (async (input: unknown, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
    const url = String(input)
    const route = routes[url]
    if (!route) return new Response("not found", { status: 404 })
    route.callCount++
    const range = init?.headers?.Range
    route.seenRanges.push(range)
    if (init?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError")
    }
    return new Response(bodyStream(route.body, route, init?.signal) as any, {
      status: 200,
      headers: route.headers,
    })
  }) as unknown as typeof fetch
}

function makeEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "cmspark-whisper-dl-"))
  // models/ parent + whisper root + sibling (qwen) — budget must ignore sibling
  const modelsParent = path.join(dir, "models")
  const whisperRoot = path.join(modelsParent, "whisper")
  const qwenSibling = path.join(modelsParent, "qwen-vl")
  mkdirSync(whisperRoot, { recursive: true })
  mkdirSync(qwenSibling, { recursive: true })
  return {
    dir,
    modelsParent,
    whisperRoot,
    qwenSibling,
    cleanup: () => {
      _resetWhisperDownloadInflightForTests()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function expectReason(err: unknown, reason: string): void {
  assert.ok(err instanceof WhisperDownloadError, `expected WhisperDownloadError, got ${String(err)}`)
  assert.equal(err.reason, reason)
}

// --- resolveWhisperRoot -------------------------------------------------------

test("resolveWhisperRoot: default nests under dataDir/models/whisper", () => {
  const root = resolveWhisperRoot({ dataDir: "/tmp/cmspark-data-x" })
  assert.ok(root.endsWith(path.join("models", "whisper")) || root.includes(`${path.sep}models${path.sep}whisper`))
  assert.doesNotMatch(root, /\.\./)
})

test("resolveWhisperRoot: rootDir wins", () => {
  const root = resolveWhisperRoot({ rootDir: "/custom/whisper", dataDir: "/ignored" })
  assert.equal(root, path.resolve("/custom/whisper"))
})

test("DEFAULT_WHISPER_DISK_BUDGET_MB is 4096", () => {
  assert.equal(DEFAULT_WHISPER_DISK_BUDGET_MB, 4096)
})

// --- budget scoped to whisper root --------------------------------------------

test("budgetDir is whisper root not models parent (unit size accounting)", async () => {
  const env = makeEnv()
  try {
    // Huge sibling under models/qwen — must NOT count toward whisper budget
    const huge = Buffer.alloc(5 * 1024 * 1024) // 5MB
    writeFileSync(path.join(env.qwenSibling, "weights.bin"), huge)

    const parentBytes = await dirOccupiedBytes(env.modelsParent)
    const whisperBytes = await dirOccupiedBytes(env.whisperRoot)
    assert.ok(parentBytes >= huge.byteLength, "parent includes qwen")
    assert.equal(whisperBytes, 0, "whisper root empty")

    const manifest = makeManifest([{ name: "ggml-medium.bin", content: FILE_A }])
    // Budget only enough for FILE_A (2KB) — would fail if parent (5MB+qwen) counted
    const budgetMB = (FILE_A.byteLength + 100) / (1024 * 1024) // ~0.002 MB
    // If we wrongly used models parent, occupied=5MB + 2KB >> budget
    await downloadWhisperModel("medium", {
      rootDir: env.whisperRoot,
      budgetMB,
      manifest,
      fetchImpl: makeFakeFetch({
        [manifest.models.medium.files[0]!.url]: {
          body: FILE_A,
          seenRanges: [],
          callCount: 0,
        },
      }),
    })
    assert.deepEqual(readFileSync(path.join(env.whisperRoot, "medium", "ggml-medium.bin")), FILE_A)

    // Contrast: pre-seed whisper root so whisper-scoped budget fails on re-download
    await deleteWhisperModel("medium", env.whisperRoot)
    mkdirSync(path.join(env.whisperRoot, "small"), { recursive: true })
    writeFileSync(path.join(env.whisperRoot, "small", "ggml-small.bin"), Buffer.alloc(4096))

    const occupiedWhisper = await dirOccupiedBytes(env.whisperRoot)
    assert.equal(occupiedWhisper, 4096)
    // budget = occupied + needed - 1 → fail
    const tightMB = (occupiedWhisper + FILE_A.byteLength - 1) / (1024 * 1024)
    await assert.rejects(
      () =>
        downloadWhisperModel("medium", {
          rootDir: env.whisperRoot,
          budgetMB: tightMB,
          manifest,
          fetchImpl: makeFakeFetch({
            [manifest.models.medium.files[0]!.url]: {
              body: FILE_A,
              seenRanges: [],
              callCount: 0,
            },
          }),
        }),
      (e) => (expectReason(e, "disk-budget-exceeded"), true),
    )
  } finally {
    env.cleanup()
  }
})

test("budget: pre-check fails before any fetch when over budget", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "ggml-medium.bin", content: FILE_A }])
    const route: FakeRoute = { body: FILE_A, seenRanges: [], callCount: 0 }
    await assert.rejects(
      () =>
        downloadWhisperModel("medium", {
          rootDir: env.whisperRoot,
          budgetMB: 0.000001, // tiny
          manifest,
          fetchImpl: makeFakeFetch({ [manifest.models.medium.files[0]!.url]: route }),
        }),
      (e) => (expectReason(e, "disk-budget-exceeded"), true),
    )
    assert.equal(route.callCount, 0, "fetch must not run when budget pre-check fails")
  } finally {
    env.cleanup()
  }
})

// --- happy path ---------------------------------------------------------------

test("happy path: small fake file written, no .part residue", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "ggml-medium.bin", content: FILE_A }])
    const url = manifest.models.medium.files[0]!.url
    const route: FakeRoute = { body: FILE_A, seenRanges: [], callCount: 0 }
    const progress: { file: string; received: number; total: number }[] = []
    await downloadWhisperModel("medium", {
      rootDir: env.whisperRoot,
      budgetMB: 10,
      manifest,
      fetchImpl: makeFakeFetch({ [url]: route }),
      onProgress: (p) => progress.push({ file: p.file, received: p.receivedBytes, total: p.totalBytes }),
    })
    const dest = path.join(env.whisperRoot, "medium", "ggml-medium.bin")
    assert.deepEqual(readFileSync(dest), FILE_A)
    assert.equal(existsSync(`${dest}.part`), false)
    assert.equal(route.callCount, 1)
    assert.ok(progress.length > 0)
    assert.equal(progress[0]!.file, "ggml-medium.bin")
    assert.equal(probeWhisperModelDir("medium", env.whisperRoot, manifest).status, "ready")
  } finally {
    env.cleanup()
  }
})

// --- hash mismatch ------------------------------------------------------------

test("hash mismatch deletes part and throws", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "ggml-medium.bin", content: FILE_A }])
    const url = manifest.models.medium.files[0]!.url
    // Return FILE_B body but manifest expects FILE_A hash/size — size must match for hash path
    // Easier: corrupt stream at offset so size matches but hash fails
    const route: FakeRoute = {
      body: FILE_A,
      corruptAt: 100,
      seenRanges: [],
      callCount: 0,
    }
    await assert.rejects(
      () =>
        downloadWhisperModel("medium", {
          rootDir: env.whisperRoot,
          budgetMB: 10,
          manifest,
          fetchImpl: makeFakeFetch({ [url]: route }),
        }),
      (e) => (expectReason(e, "hash-mismatch"), true),
    )
    const destDir = path.join(env.whisperRoot, "medium")
    assert.equal(existsSync(path.join(destDir, "ggml-medium.bin")), false)
    assert.equal(existsSync(path.join(destDir, "ggml-medium.bin.part")), false)
    assert.equal(existsSync(path.join(destDir, "ggml-medium.bin.part.json")), false)
  } finally {
    env.cleanup()
  }
})

// --- abort --------------------------------------------------------------------

test("cancel via AbortSignal aborts in-flight download", async () => {
  const env = makeEnv()
  try {
    // Larger body so abort can fire mid-stream
    const big = contentOf(3, 64 * 1024)
    const manifest = makeManifest([{ name: "ggml-medium.bin", content: big }])
    const url = manifest.models.medium.files[0]!.url
    const route: FakeRoute = { body: big, seenRanges: [], callCount: 0 }
    const ac = new AbortController()
    // Abort after first progress tick
    const p = downloadWhisperModel("medium", {
      rootDir: env.whisperRoot,
      budgetMB: 10,
      manifest,
      fetchImpl: makeFakeFetch({ [url]: route }),
      signal: ac.signal,
      onProgress: () => {
        if (!ac.signal.aborted) ac.abort()
      },
    })
    await assert.rejects(p, (e) => (expectReason(e, "aborted"), true))
  } finally {
    env.cleanup()
  }
})

test("cancel: already-aborted signal fails before fetch", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "ggml-medium.bin", content: FILE_A }])
    const url = manifest.models.medium.files[0]!.url
    const route: FakeRoute = { body: FILE_A, seenRanges: [], callCount: 0 }
    const ac = new AbortController()
    ac.abort()
    await assert.rejects(
      () =>
        downloadWhisperModel("medium", {
          rootDir: env.whisperRoot,
          budgetMB: 10,
          manifest,
          fetchImpl: makeFakeFetch({ [url]: route }),
          signal: ac.signal,
        }),
      (e) => (expectReason(e, "aborted"), true),
    )
    assert.equal(route.callCount, 0)
  } finally {
    env.cleanup()
  }
})

// --- idempotent skip ----------------------------------------------------------

test("already complete same sha skips network (fetch call count 0)", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "ggml-medium.bin", content: FILE_A }])
    const url = manifest.models.medium.files[0]!.url
    const destDir = path.join(env.whisperRoot, "medium")
    mkdirSync(destDir, { recursive: true })
    writeFileSync(path.join(destDir, "ggml-medium.bin"), FILE_A)
    // leftover part should be cleaned
    writeFileSync(path.join(destDir, "ggml-medium.bin.part"), Buffer.from("junk"))
    writeFileSync(path.join(destDir, "ggml-medium.bin.part.json"), "{}")

    const route: FakeRoute = { body: FILE_A, seenRanges: [], callCount: 0 }
    await downloadWhisperModel("medium", {
      rootDir: env.whisperRoot,
      budgetMB: 10,
      manifest,
      fetchImpl: makeFakeFetch({ [url]: route }),
    })
    assert.equal(route.callCount, 0, "must not fetch when size+sha already match")
    assert.equal(existsSync(path.join(destDir, "ggml-medium.bin.part")), false)
    assert.deepEqual(readFileSync(path.join(destDir, "ggml-medium.bin")), FILE_A)
  } finally {
    env.cleanup()
  }
})

// --- oversize -----------------------------------------------------------------

test("mid-stream oversize aborts and cleans part", async () => {
  const env = makeEnv()
  try {
    const big = contentOf(9, 8 * 1024)
    const manifest = makeManifest([{ name: "ggml-medium.bin", content: FILE_A }])
    // Manifest claims FILE_A size but body is larger
    const f = manifest.models.medium.files[0]!
    f.size = 1000 // declared 1000; body 8KB
    f.sha256 = sha256(big.subarray(0, 1000))
    const url = f.url
    const route: FakeRoute = { body: big, seenRanges: [], callCount: 0 }
    await assert.rejects(
      () =>
        downloadWhisperModel("medium", {
          rootDir: env.whisperRoot,
          budgetMB: 10,
          manifest,
          fetchImpl: makeFakeFetch({ [url]: route }),
        }),
      (e) => (expectReason(e, "oversize-stream"), true),
    )
    const destDir = path.join(env.whisperRoot, "medium")
    assert.equal(existsSync(path.join(destDir, "ggml-medium.bin")), false)
    assert.equal(existsSync(path.join(destDir, "ggml-medium.bin.part")), false)
  } finally {
    env.cleanup()
  }
})

// --- probe / delete -----------------------------------------------------------

test("probe: absent / incomplete / ready", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "ggml-medium.bin", content: FILE_A }])
    assert.equal(probeWhisperModelDir("medium", env.whisperRoot, manifest).status, "absent")

    const destDir = path.join(env.whisperRoot, "medium")
    mkdirSync(destDir, { recursive: true })
    writeFileSync(path.join(destDir, "ggml-medium.bin.part"), FILE_A.subarray(0, 100))
    assert.equal(probeWhisperModelDir("medium", env.whisperRoot, manifest).status, "incomplete")

    writeFileSync(path.join(destDir, "ggml-medium.bin"), FILE_A)
    assert.equal(probeWhisperModelDir("medium", env.whisperRoot, manifest).status, "ready")
  } finally {
    env.cleanup()
  }
})

test("deleteWhisperModel removes model dir", async () => {
  const env = makeEnv()
  try {
    const destDir = path.join(env.whisperRoot, "medium")
    mkdirSync(destDir, { recursive: true })
    writeFileSync(path.join(destDir, "ggml-medium.bin"), FILE_A)
    await deleteWhisperModel("medium", env.whisperRoot)
    assert.equal(existsSync(destDir), false)
    // idempotent
    await deleteWhisperModel("medium", env.whisperRoot)
  } finally {
    env.cleanup()
  }
})

test("unknown model id rejects", async () => {
  const env = makeEnv()
  try {
    await assert.rejects(
      () =>
        downloadWhisperModel("tiny" as any, {
          rootDir: env.whisperRoot,
          budgetMB: 10,
          manifest: makeManifest(),
          fetchImpl: makeFakeFetch({}),
        }),
      (e) => (expectReason(e, "model-unknown"), true),
    )
  } finally {
    env.cleanup()
  }
})
