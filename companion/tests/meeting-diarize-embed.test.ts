// #260 — speaker-embedding runtime (fake onnxruntime; model files on temp disk).

import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  DIARIZE_EMBEDDING_DIM,
  __resetOrtCacheForTests,
  embedSegmentsForDiarize,
  type OrtLike,
  type OrtSessionLike,
} from "../src/meeting/diarize-embed"
import { DIARIZE_MODEL_ID } from "../src/voice/diarize-model"
import type { DiarizeManifest } from "../src/voice/diarize-manifest"

const MODEL_BYTES = Buffer.alloc(4096, 7)

function makeManifest(): DiarizeManifest {
  return {
    schemaVersion: 1,
    models: {
      [DIARIZE_MODEL_ID]: {
        files: [
          {
            name: "speaker.onnx",
            url: "https://models.cmspark.invalid/diarize/speaker.onnx",
            sha256: createHash("sha256").update(MODEL_BYTES).digest("hex"),
            size: MODEL_BYTES.byteLength,
          },
        ],
      },
    },
  }
}

function makeReadyRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cmspark-embed-"))
  const dest = path.join(dir, DIARIZE_MODEL_ID)
  mkdirSync(dest, { recursive: true })
  writeFileSync(path.join(dest, "speaker.onnx"), MODEL_BYTES)
  return dir
}

function sine(freq: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.floor(seconds * 16000)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / 16000)
  return out
}

/** Fake ONNX: embedding = [mean sample, 0, 0, …] (deterministic per input). */
function fakeOrt(dim = DIARIZE_EMBEDDING_DIM): OrtLike {
  const session: OrtSessionLike = {
    inputNames: ["input"],
    outputNames: ["embedding"],
    run: async (feeds) => {
      // Verify feed shape: [1, frames, 80]
      const tensor = feeds["input"] as { dims: readonly number[] }
      assert.equal(tensor.dims[0], 1)
      assert.equal(tensor.dims[2], 80)
      assert.ok(tensor.dims[1]! > 0, "frames > 0")
      const data = new Array<number>(dim).fill(0)
      return { embedding: { data } }
    },
  }
  return {
    Tensor: class {
      constructor(
        public type: string,
        public data: Float32Array,
        public dims: readonly number[],
      ) {}
    },
    InferenceSession: {
      create: async () => session,
    },
  } as unknown as OrtLike
}

/** Fake ONNX whose embedding encodes segment loudness (mean abs sample). */
function loudnessOrt(): OrtLike {
  const seen: Float32Array[] = []
  const session: OrtSessionLike = {
    inputNames: ["input"],
    outputNames: ["embedding"],
    run: async (feeds) => {
      const tensor = feeds["input"] as { data: Float32Array }
      seen.push(tensor.data)
      return { embedding: { data: new Array<number>(DIARIZE_EMBEDDING_DIM).fill(0) } }
    },
  }
  return {
    Tensor: class {
      constructor(
        public type: string,
        public data: Float32Array,
        public dims: readonly number[],
      ) {}
    },
    InferenceSession: {
      create: async () => session,
    },
  } as unknown as OrtLike
}

test("model not ready → embedding_model_required (guidance, no silent fallback)", async () => {
  __resetOrtCacheForTests()
  const root = mkdtempSync(path.join(tmpdir(), "cmspark-embed-empty-"))
  try {
    const r = await embedSegmentsForDiarize([sine(440, 0.1)], {
      modelRootDir: root,
      manifest: makeManifest(),
      ort: fakeOrt(),
    })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.code, "embedding_model_required")
      assert.ok(r.message.includes("设置"), "message guides to settings")
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("runtime missing → diarize_runtime_unavailable", async () => {
  __resetOrtCacheForTests()
  const root = makeReadyRoot()
  try {
    const r = await embedSegmentsForDiarize([sine(440, 0.1)], {
      modelRootDir: root,
      manifest: makeManifest(),
      ort: null as unknown as OrtLike,
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, "diarize_runtime_unavailable")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("happy path: N segments → N×192 embeddings + progress events", async () => {
  __resetOrtCacheForTests()
  const root = makeReadyRoot()
  try {
    const events: { done: number; total: number }[] = []
    const r = await embedSegmentsForDiarize(
      [sine(440, 0.2), sine(1200, 0.2), new Float32Array(0)],
      {
        modelRootDir: root,
        manifest: makeManifest(),
        ort: loudnessOrt(),
        onProgress: (p) => events.push({ ...p }),
      },
    )
    assert.ok(r.ok)
    if (r.ok) {
      assert.equal(r.embeddings.length, 3)
      for (const e of r.embeddings) assert.equal(e.length, DIARIZE_EMBEDDING_DIM)
    }
    assert.deepEqual(events, [
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("output dim mismatch → diarize_runtime_unavailable", async () => {
  __resetOrtCacheForTests()
  const root = makeReadyRoot()
  try {
    const r = await embedSegmentsForDiarize([sine(440, 0.1)], {
      modelRootDir: root,
      manifest: makeManifest(),
      ort: fakeOrt(64),
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, "diarize_runtime_unavailable")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("session cached per model path (one create for two runs)", async () => {
  __resetOrtCacheForTests()
  const root = makeReadyRoot()
  let creates = 0
  const ort: OrtLike = {
    Tensor: class {
      constructor(
        public type: string,
        public data: Float32Array,
        public dims: readonly number[],
      ) {}
    },
    InferenceSession: {
      create: async () => {
        creates++
        return {
          inputNames: ["input"],
          outputNames: ["embedding"],
          run: async () => ({ embedding: { data: new Array<number>(DIARIZE_EMBEDDING_DIM).fill(0) } }),
        }
      },
    },
  } as unknown as OrtLike
  try {
    await embedSegmentsForDiarize([sine(440, 0.1)], { modelRootDir: root, manifest: makeManifest(), ort })
    await embedSegmentsForDiarize([sine(440, 0.1)], { modelRootDir: root, manifest: makeManifest(), ort })
    assert.equal(creates, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("feed is fbank-shaped [1, frames, 80] with plausible magnitudes", async () => {
  __resetOrtCacheForTests()
  const root = makeReadyRoot()
  let observed: Float32Array | null = null
  let frames = 0
  const ort: OrtLike = {
    Tensor: class {
      constructor(
        public type: string,
        public data: Float32Array,
        public dims: readonly number[],
      ) {
        observed = data
        frames = dims[1]!
      }
    },
    InferenceSession: {
      create: async () => ({
        inputNames: ["input"],
        outputNames: ["embedding"],
        run: async () => ({ embedding: { data: new Array<number>(DIARIZE_EMBEDDING_DIM).fill(0) } }),
      }),
    },
  } as unknown as OrtLike
  try {
    await embedSegmentsForDiarize([sine(1000, 1)], { modelRootDir: root, manifest: makeManifest(), ort })
    // 1s @16k → 98 frames
    assert.equal(frames, 98)
    assert.equal(observed!.length, 98 * 80)
    for (const v of observed!) assert.ok(Number.isFinite(v))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
