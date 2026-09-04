// #260 — voice.model.diarize_* handlers: settings fence, shared download mutex,
// state assembly with diarizeModel entry + combined budget roots.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-diarize-handlers-"))
delete process.env.DEEPSEEK_API_KEY
delete process.env.CMSPARK_API_KEY

import test from "node:test"
import assert from "node:assert/strict"

import { validateWsMessage } from "../src/server"
import {
  handleVoiceModelMessage,
  _resetVoiceModelHandlersForTests,
} from "../src/voice/whisper-handlers"
import { clearConfigCache, saveConfig } from "../src/config"
import { DIARIZE_MODEL_ID } from "../src/voice/diarize-model"

const TEST_DATA_DIR = process.env.CMSPARK_DATA_DIR!
const EXT = "chrome-extension://abcdefghijklmnopqrstuvwxyz"

function resetVoiceConfig() {
  _resetVoiceModelHandlersForTests()
  clearConfigCache()
  try {
    fs.rmSync(path.join(TEST_DATA_DIR, "config.json"))
  } catch {
    /* ignore */
  }
  saveConfig({
    voice: { sttEngine: "browser", localModelId: "medium", modelDiskBudgetMB: 4096 },
  } as any)
  clearConfigCache()
}

function tempRoots() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-diarize-roots-"))
  return {
    dir,
    whisperRoot: path.join(dir, "models", "whisper"),
    diarizeRoot: path.join(dir, "models", "diarize"),
  }
}

const flush = () => new Promise((r) => setImmediate(r))

// --- layer 1 validation ---------------------------------------------------------

test("validateWsMessage: diarize mutators require source:settings", () => {
  for (const type of [
    "voice.model.diarize_download",
    "voice.model.diarize_cancel",
    "voice.model.diarize_delete",
  ]) {
    assert.equal(validateWsMessage({ type }).valid, false, `${type} without source`)
    assert.equal(validateWsMessage({ type, source: "settings" }).valid, true, `${type} with source`)
  }
})

// --- fences ---------------------------------------------------------------------

test("origin fence: non-extension origin refused", async () => {
  resetVoiceConfig()
  const r = await handleVoiceModelMessage(
    { type: "voice.model.diarize_download", source: "settings" },
    { origin: "https://evil.example.com" },
  )
  assert.equal(r.code, "ORIGIN_DENIED")
})

test("source belt: diarize_download without source:settings → INVALID_SOURCE", async () => {
  resetVoiceConfig()
  const r = await handleVoiceModelMessage(
    { type: "voice.model.diarize_download" },
    { origin: EXT },
  )
  assert.equal(r.code, "INVALID_SOURCE")
})

// --- state assembly --------------------------------------------------------------

test("get_state includes diarizeModel entry + diarizeRoot (combined budget roots)", async () => {
  resetVoiceConfig()
  const roots = tempRoots()
  const r = await handleVoiceModelMessage(
    { type: "voice.model.get_state" },
    { origin: EXT },
    { rootDir: roots.whisperRoot, diarizeRootDir: roots.diarizeRoot },
  )
  assert.equal(r.type, "voice.model.state")
  assert.equal(r.diarizeModel.modelId, DIARIZE_MODEL_ID)
  assert.ok(["absent", "incomplete", "ready"].includes(r.diarizeModel.status))
  assert.equal(r.diarizeRoot, roots.diarizeRoot)
  assert.equal(r.whisperRoot, roots.whisperRoot)
  fs.rmSync(roots.dir, { recursive: true, force: true })
})

// --- download lifecycle ------------------------------------------------------------

test("diarize_download: started → progress/completion broadcasts; state flips downloading→absent/ready", async () => {
  resetVoiceConfig()
  const roots = tempRoots()
  const broadcasts: any[] = []
  let downloadCalls = 0
  const r = await handleVoiceModelMessage(
    { type: "voice.model.diarize_download", source: "settings" },
    { origin: EXT, broadcast: (d) => broadcasts.push(d) },
    {
      rootDir: roots.whisperRoot,
      diarizeRootDir: roots.diarizeRoot,
      downloadDiarizeImpl: (async (opts: any) => {
        downloadCalls++
        assert.ok(opts.signal, "abort signal wired")
        opts.onProgress?.({ modelId: DIARIZE_MODEL_ID, file: "speaker.onnx", receivedBytes: 1, totalBytes: 2 })
      }) as any,
    },
  )
  assert.equal(r.ok, true)
  assert.equal(r.status, "started")
  assert.equal(downloadCalls, 1)
  for (let i = 0; i < 5; i++) await flush()
  assert.ok(
    broadcasts.some((d) => d.type === "voice.model.progress" && d.modelId === DIARIZE_MODEL_ID),
    "progress broadcast",
  )
  assert.ok(
    broadcasts.some((d) => d.type === "voice.model.state" && d.diarizeModel?.status !== "downloading"),
    "final state broadcast after completion",
  )
  fs.rmSync(roots.dir, { recursive: true, force: true })
})

test("diarize_download when model ready → already-ready, zero download calls", async () => {
  resetVoiceConfig()
  const roots = tempRoots()
  let downloadCalls = 0
  const r = await handleVoiceModelMessage(
    { type: "voice.model.diarize_download", source: "settings" },
    { origin: EXT },
    {
      rootDir: roots.whisperRoot,
      diarizeRootDir: roots.diarizeRoot,
      probeDiarizeImpl: (() => ({ status: "ready" })) as any,
      downloadDiarizeImpl: (async () => {
        downloadCalls++
      }) as any,
    },
  )
  assert.equal(r.download, "already-ready")
  assert.equal(downloadCalls, 0)
  fs.rmSync(roots.dir, { recursive: true, force: true })
})

test("shared mutex: whisper download in progress → diarize_download refused", async () => {
  resetVoiceConfig()
  const roots = tempRoots()
  let releaseWhisper: (() => void) | null = null
  await handleVoiceModelMessage(
    { type: "voice.model.download", source: "settings", modelId: "medium" },
    { origin: EXT },
    {
      rootDir: roots.whisperRoot,
      downloadImpl: (async () => {
        await new Promise<void>((resolve) => {
          releaseWhisper = resolve
        })
      }) as any,
    },
  )
  const r = await handleVoiceModelMessage(
    { type: "voice.model.diarize_download", source: "settings" },
    { origin: EXT },
    { rootDir: roots.whisperRoot, diarizeRootDir: roots.diarizeRoot },
  )
  assert.equal(r.code, "DOWNLOAD_IN_PROGRESS")
  ;(releaseWhisper as (() => void) | null)?.()
  await flush()
  fs.rmSync(roots.dir, { recursive: true, force: true })
})

test("diarize_cancel: not-running is ok; while running aborts", async () => {
  resetVoiceConfig()
  const roots = tempRoots()
  const notRunning = await handleVoiceModelMessage(
    { type: "voice.model.diarize_cancel", source: "settings" },
    { origin: EXT },
  )
  assert.equal(notRunning.status, "not-running")

  let aborted = false
  await handleVoiceModelMessage(
    { type: "voice.model.diarize_download", source: "settings" },
    { origin: EXT },
    {
      rootDir: roots.whisperRoot,
      diarizeRootDir: roots.diarizeRoot,
      downloadDiarizeImpl: (async (opts: any) => {
        await new Promise<void>((resolve) => {
          opts.signal.addEventListener("abort", () => {
            aborted = true
            resolve()
          })
        })
      }) as any,
    },
  )
  const cancelling = await handleVoiceModelMessage(
    { type: "voice.model.diarize_cancel", source: "settings" },
    { origin: EXT },
  )
  assert.equal(cancelling.status, "cancelling")
  for (let i = 0; i < 5; i++) await flush()
  assert.equal(aborted, true)
  fs.rmSync(roots.dir, { recursive: true, force: true })
})

test("diarize_delete: happy path deleted:true; refused while downloading", async () => {
  resetVoiceConfig()
  const roots = tempRoots()
  let deleted = 0
  const r = await handleVoiceModelMessage(
    { type: "voice.model.diarize_delete", source: "settings" },
    { origin: EXT },
    {
      rootDir: roots.whisperRoot,
      diarizeRootDir: roots.diarizeRoot,
      deleteDiarizeImpl: (async (rootDir?: string) => {
        deleted++
        assert.equal(rootDir, roots.diarizeRoot)
      }) as any,
    },
  )
  assert.equal(r.deleted, true)
  assert.equal(deleted, 1)

  // while downloading → refused
  await handleVoiceModelMessage(
    { type: "voice.model.diarize_download", source: "settings" },
    { origin: EXT },
    {
      rootDir: roots.whisperRoot,
      diarizeRootDir: roots.diarizeRoot,
      downloadDiarizeImpl: (async (opts: any) => {
        await new Promise<void>((resolve) => {
          opts.signal.addEventListener("abort", () => resolve())
        })
      }) as any,
    },
  )
  const refused = await handleVoiceModelMessage(
    { type: "voice.model.diarize_delete", source: "settings" },
    { origin: EXT },
    { rootDir: roots.whisperRoot, diarizeRootDir: roots.diarizeRoot },
  )
  assert.equal(refused.code, "DOWNLOAD_IN_PROGRESS")
  await handleVoiceModelMessage(
    { type: "voice.model.diarize_cancel", source: "settings" },
    { origin: EXT },
  )
  await flush()
  fs.rmSync(roots.dir, { recursive: true, force: true })
})
