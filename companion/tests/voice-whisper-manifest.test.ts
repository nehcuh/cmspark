// Path B M0 Task 1 — whisper catalog + in-repo manifest (no network at runtime)

import test from "node:test"
import assert from "node:assert/strict"
import {
  RECOMMENDED_WHISPER_MODEL,
  WHISPER_MODEL_IDS,
  defaultWhisperModelsRoot,
  isWhisperModelId,
  whisperModelDirName,
} from "../src/voice/whisper-catalog"
import {
  WhisperManifestError,
  loadWhisperManifest,
  parseWhisperManifest,
} from "../src/voice/whisper-manifest"

test("recommended is medium", () => {
  assert.equal(RECOMMENDED_WHISPER_MODEL, "medium")
})

test("allowlist ids", () => {
  assert.equal(isWhisperModelId("small"), true)
  assert.equal(isWhisperModelId("medium"), true)
  assert.equal(isWhisperModelId("large-v3-turbo"), true)
  assert.equal(isWhisperModelId("tiny"), false)
  assert.deepEqual([...WHISPER_MODEL_IDS], ["small", "medium", "large-v3-turbo"])
})

const PATH_SEP_RE = /[\\/]/

test("dir names are basenames only", () => {
  assert.equal(whisperModelDirName("medium"), "medium")
  assert.doesNotMatch(whisperModelDirName("medium"), PATH_SEP_RE)
  assert.doesNotMatch(whisperModelDirName("large-v3-turbo"), PATH_SEP_RE)
})

test("defaultWhisperModelsRoot nests under dataDir", () => {
  const root = defaultWhisperModelsRoot("/tmp/cmspark-data")
  assert.ok(root.endsWith(`${"/"}models${"/"}whisper`) || root.endsWith("\\models\\whisper"))
  assert.doesNotMatch(root, /\.\./)
})

test("loadWhisperManifest parses repo asset", () => {
  const m = loadWhisperManifest()
  assert.equal(m.schemaVersion, 1)
  assert.ok(m.models.medium.files.length >= 1)
  for (const id of WHISPER_MODEL_IDS) {
    assert.ok(m.models[id], `missing model ${id}`)
    for (const f of m.models[id].files) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/)
      assert.ok(f.url.startsWith("https://"))
      assert.doesNotMatch(f.name, PATH_SEP_RE)
      assert.ok(Number.isInteger(f.size) && f.size > 0)
    }
  }
})

test("parse rejects path-separators in name", () => {
  const bad = {
    schemaVersion: 1,
    models: {
      medium: {
        files: [
          {
            name: "../escape.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
            sha256: "a".repeat(64),
            size: 100,
          },
        ],
      },
    },
  }
  assert.throws(
    () => parseWhisperManifest(JSON.stringify(bad)),
    (e: unknown) => e instanceof WhisperManifestError,
  )
})

test("parse rejects non-https url", () => {
  const bad = {
    schemaVersion: 1,
    models: {
      medium: {
        files: [
          {
            name: "ggml-medium.bin",
            url: "http://example.com/ggml-medium.bin",
            sha256: "b".repeat(64),
            size: 100,
          },
        ],
      },
    },
  }
  assert.throws(
    () => parseWhisperManifest(JSON.stringify(bad)),
    (e: unknown) => e instanceof WhisperManifestError,
  )
})

test("parse rejects bad sha256", () => {
  const bad = {
    schemaVersion: 1,
    models: {
      medium: {
        files: [
          {
            name: "ggml-medium.bin",
            url: "https://example.com/ggml-medium.bin",
            sha256: "deadbeef",
            size: 100,
          },
        ],
      },
    },
  }
  assert.throws(
    () => parseWhisperManifest(JSON.stringify(bad)),
    (e: unknown) => e instanceof WhisperManifestError,
  )
})
