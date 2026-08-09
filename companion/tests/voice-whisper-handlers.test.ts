// Path B M0 Task 4 — voice.model.* handlers + WS validation fence

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// DATA_DIR is fixed at config module load — must set before any src import.
process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-voice-handlers-test-"))
delete process.env.DEEPSEEK_API_KEY
delete process.env.CMSPARK_API_KEY

import test from "node:test"
import assert from "node:assert/strict"

import { validateWsMessage } from "../src/server"
import {
  handleVoiceModelMessage as handleVoiceModelMessageRaw,
  _resetVoiceModelHandlersForTests,
} from "../src/voice/whisper-handlers"
import { clearConfigCache, getConfig, saveConfig, setVoiceFields } from "../src/config"
import type { WhisperModelId } from "../src/voice/whisper-catalog"

const TEST_DATA_DIR = process.env.CMSPARK_DATA_DIR!
const EXT_CTX = { origin: "chrome-extension://abcdefghijklmnopqrstuvwxyz" }

/** P1 origin fence: unit tests inject chrome-extension origin by default. */
function handleVoiceModelMessage(
  msg: any,
  ctxOrDeps?: any,
  maybeDeps?: any,
): ReturnType<typeof handleVoiceModelMessageRaw> {
  // Call shapes in this file: (msg) | (msg, deps) | (msg, ctx, deps)
  if (maybeDeps !== undefined) {
    return handleVoiceModelMessageRaw(msg, { ...EXT_CTX, ...ctxOrDeps }, maybeDeps)
  }
  // Heuristic: deps have downloadImpl/listReady/probe/buildState — not broadcast-only
  if (
    ctxOrDeps &&
    (ctxOrDeps.downloadImpl ||
      ctxOrDeps.listReady ||
      ctxOrDeps.probe ||
      ctxOrDeps.buildState ||
      ctxOrDeps.deleteImpl ||
      ctxOrDeps.rootDir)
  ) {
    return handleVoiceModelMessageRaw(msg, EXT_CTX, ctxOrDeps)
  }
  return handleVoiceModelMessageRaw(msg, { ...EXT_CTX, ...(ctxOrDeps || {}) })
}

function resetVoiceConfig(voice: Record<string, unknown> = {}) {
  _resetVoiceModelHandlersForTests()
  clearConfigCache()
  try {
    fs.rmSync(path.join(TEST_DATA_DIR, "config.json"))
  } catch {
    /* ignore */
  }
  saveConfig({
    voice: {
      sttEngine: "browser",
      localModelId: "medium",
      modelDiskBudgetMB: 4096,
      ...voice,
    },
  } as any)
  clearConfigCache()
}

const flush = () => new Promise((r) => setImmediate(r))

// --- validateWsMessage (layer 1) ----------------------------------------------

test("validateWsMessage: get_state always valid", () => {
  assert.equal(validateWsMessage({ type: "voice.model.get_state" }).valid, true)
})

test("validateWsMessage: mutators require source:settings", () => {
  assert.equal(
    validateWsMessage({ type: "voice.model.download", modelId: "medium" }).valid,
    false,
  )
  assert.equal(
    validateWsMessage({ type: "voice.model.download", modelId: "medium", source: "settings" })
      .valid,
    true,
  )
  assert.equal(
    validateWsMessage({ type: "voice.model.cancel", modelId: "medium" }).valid,
    false,
  )
  assert.equal(
    validateWsMessage({ type: "voice.model.delete", modelId: "medium", source: "settings" }).valid,
    true,
  )
  assert.equal(
    validateWsMessage({ type: "voice.model.set_active", modelId: "medium" }).valid,
    false,
  )
  assert.equal(
    validateWsMessage({ type: "voice.model.set_engine", engine: "local" }).valid,
    false,
  )
  assert.equal(
    validateWsMessage({ type: "voice.model.set_engine", engine: "local", source: "settings" })
      .valid,
    true,
  )
  assert.equal(
    validateWsMessage({ type: "voice.model.set_engine", engine: "cloud", source: "settings" })
      .valid,
    false,
  )
})

test("validateWsMessage: invalid modelId rejected", () => {
  assert.equal(
    validateWsMessage({
      type: "voice.model.download",
      modelId: "tiny",
      source: "settings",
    }).valid,
    false,
  )
})

// --- handler belt (layer 2) ---------------------------------------------------

test("belt: set_engine missing source → INVALID_SOURCE", async () => {
  resetVoiceConfig()
  const r = await handleVoiceModelMessage({ type: "voice.model.set_engine", engine: "browser" })
  assert.equal(r.type, "error")
  assert.equal(r.family, "voice.model")
  assert.equal(r.code, "INVALID_SOURCE")
})

test("belt: download missing source → INVALID_SOURCE", async () => {
  resetVoiceConfig()
  const r = await handleVoiceModelMessage({ type: "voice.model.download", modelId: "medium" })
  assert.equal(r.type, "error")
  assert.equal(r.code, "INVALID_SOURCE")
})

// --- get_state shape ----------------------------------------------------------

test("get_state: shape includes models/binary/budget/whisperRoot", async () => {
  resetVoiceConfig()
  const r = await handleVoiceModelMessage({ type: "voice.model.get_state" })
  assert.equal(r.type, "voice.model.state")
  assert.equal(r.sttEngine, "browser")
  assert.equal(r.localModelId, "medium")
  assert.equal(r.recommendedModelId, "medium")
  assert.ok(r.models)
  assert.ok(r.models.small)
  assert.ok(r.models.medium)
  assert.ok(r.models["large-v3-turbo"])
  assert.equal(r.models.medium.status, "absent")
  assert.ok(r.binary)
  assert.ok(
    r.binary.status === "ready" ||
      r.binary.status === "not_found" ||
      r.binary.status === "hash_mismatch" ||
      r.binary.status === "unsupported_arch",
  )
  assert.equal(typeof r.diskBudgetMB, "number")
  assert.equal(typeof r.diskUsedMB, "number")
  assert.equal(typeof r.whisperRoot, "string")
  assert.ok(r.whisperRoot.includes("whisper") || r.whisperRoot.length > 0)
})

// --- set_engine gates ---------------------------------------------------------

test("set_engine local with no ready model → NO_READY_MODEL, zero config write", async () => {
  resetVoiceConfig({ sttEngine: "browser", localModelId: "medium" })
  const before = getConfig().voice?.sttEngine
  assert.equal(before, "browser")

  const r = await handleVoiceModelMessage(
    { type: "voice.model.set_engine", engine: "local", source: "settings", privacy_ack_v2: true },
    {},
    {
      listReady: () => [],
      probe: () => ({ status: "absent" }),
    },
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "NO_READY_MODEL")
  assert.equal(getConfig().voice?.sttEngine, "browser")
})

test("set_engine browser always allowed", async () => {
  resetVoiceConfig({ sttEngine: "local", localModelId: "medium" })
  // Force local on disk without ready models (config can be in this state after delete)
  setVoiceFields({ sttEngine: "local" })
  const r = await handleVoiceModelMessage({
    type: "voice.model.set_engine",
    engine: "browser",
    source: "settings",
  })
  assert.equal(r.type, "voice.model.state")
  assert.equal(r.sttEngine, "browser")
  assert.equal(getConfig().voice?.sttEngine, "browser")
})

test("set_engine local with ready model → writes local", async () => {
  resetVoiceConfig({ sttEngine: "browser", localModelId: "medium" })
  const r = await handleVoiceModelMessage(
    { type: "voice.model.set_engine", engine: "local", source: "settings", privacy_ack_v2: true },
    {},
    {
      listReady: () => ["medium"] as WhisperModelId[],
      probe: (id: string) => (id === "medium" ? { status: "ready" } : { status: "absent" }),
      buildState: async () =>
        ({
          type: "voice.model.state",
          sttEngine: "local",
          localModelId: "medium",
          recommendedModelId: "medium",
          models: { medium: { status: "ready" } },
          binary: { status: "not_found" },
          diskBudgetMB: 4096,
          diskUsedMB: 0,
          whisperRoot: "/tmp/w",
        }) as any,
    },
  )
  assert.notEqual(r.type, "error")
  assert.equal(getConfig().voice?.sttEngine, "local")
  assert.equal(getConfig().voice?.localModelId, "medium")
})

// --- set_active ---------------------------------------------------------------

test("set_active incomplete → MODEL_NOT_READY, zero write", async () => {
  resetVoiceConfig({ localModelId: "medium" })
  const r = await handleVoiceModelMessage(
    { type: "voice.model.set_active", modelId: "small", source: "settings" },
    {},
    {
      probe: () => ({ status: "incomplete" }),
    },
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "MODEL_NOT_READY")
  assert.equal(getConfig().voice?.localModelId, "medium")
})

test("set_active ready → writes localModelId", async () => {
  resetVoiceConfig({ localModelId: "medium" })
  const r = await handleVoiceModelMessage(
    { type: "voice.model.set_active", modelId: "small", source: "settings" },
    {},
    {
      probe: (id: string) => (id === "small" ? { status: "ready" } : { status: "absent" }),
      buildState: async () =>
        ({
          type: "voice.model.state",
          sttEngine: "browser",
          localModelId: "small",
          recommendedModelId: "medium",
          models: { small: { status: "ready" } },
          binary: { status: "not_found" },
          diskBudgetMB: 4096,
          diskUsedMB: 0,
          whisperRoot: "/tmp/w",
        }) as any,
    },
  )
  assert.equal(r.type, "voice.model.state")
  assert.equal(getConfig().voice?.localModelId, "small")
})

// --- download mutex / mock ----------------------------------------------------

test("download: started + progress broadcast with mock downloadImpl", async () => {
  resetVoiceConfig()
  const broadcasts: any[] = []
  let release!: () => void
  const pending = new Promise<void>((res) => {
    release = res
  })

  const r = await handleVoiceModelMessage(
    { type: "voice.model.download", modelId: "medium", source: "settings" },
    { broadcast: (d: any) => broadcasts.push(d) },
    {
      probe: () => ({ status: "absent" }),
      downloadImpl: async (_id: string, opts: any) => {
        opts?.onProgress?.({
          modelId: "medium",
          file: "ggml-medium.bin",
          receivedBytes: 100,
          totalBytes: 1000,
        })
        await pending
      },
      buildState: async (opts: any) =>
        ({
          type: "voice.model.state",
          sttEngine: "browser",
          localModelId: "medium",
          recommendedModelId: "medium",
          models: {
            medium: {
              status: opts?.downloadingModelIds
                ? [...opts.downloadingModelIds].includes("medium")
                  ? "downloading"
                  : "absent"
                : "absent",
            },
          },
          binary: { status: "not_found" },
          diskBudgetMB: 4096,
          diskUsedMB: 0,
          whisperRoot: "/tmp/w",
        }) as any,
    },
  )
  assert.equal(r.status, "started")
  await flush()
  assert.ok(broadcasts.some((b) => b.type === "voice.model.state"))
  assert.ok(
    broadcasts.some(
      (b) => b.type === "voice.model.progress" && b.modelId === "medium" && b.file === "ggml-medium.bin",
    ),
  )
  release()
  for (let i = 0; i < 8; i++) await flush()
})

test("download refused while delete in progress", async () => {
  resetVoiceConfig()
  let releaseDelete!: () => void
  const deleteGate = new Promise<void>((res) => {
    releaseDelete = res
  })

  // Start a slow delete in the background via concurrent call
  const deleteP = handleVoiceModelMessage(
    { type: "voice.model.delete", modelId: "small", source: "settings" },
    {},
    {
      deleteImpl: async () => {
        await deleteGate
      },
      buildState: async () =>
        ({
          type: "voice.model.state",
          sttEngine: "browser",
          localModelId: "medium",
          recommendedModelId: "medium",
          models: {},
          binary: { status: "not_found" },
          diskBudgetMB: 4096,
          diskUsedMB: 0,
          whisperRoot: "/tmp/w",
        }) as any,
    },
  )
  await flush()

  const dl = await handleVoiceModelMessage(
    { type: "voice.model.download", modelId: "medium", source: "settings" },
    {},
    {
      probe: () => ({ status: "absent" }),
      downloadImpl: async () => {
        throw new Error("should not run")
      },
    },
  )
  assert.equal(dl.type, "error")
  assert.equal(dl.code, "DELETE_IN_PROGRESS")

  releaseDelete()
  await deleteP
  _resetVoiceModelHandlersForTests()
})

// --- delete forces browser when active local ----------------------------------

test("delete active model while engine=local → force browser", async () => {
  resetVoiceConfig({ sttEngine: "local", localModelId: "medium" })
  const r = await handleVoiceModelMessage(
    { type: "voice.model.delete", modelId: "medium", source: "settings" },
    {},
    {
      deleteImpl: async () => {
        /* ok */
      },
      buildState: async () =>
        ({
          type: "voice.model.state",
          sttEngine: getConfig().voice?.sttEngine ?? "browser",
          localModelId: "medium",
          recommendedModelId: "medium",
          models: { medium: { status: "absent" } },
          binary: { status: "not_found" },
          diskBudgetMB: 4096,
          diskUsedMB: 0,
          whisperRoot: "/tmp/w",
        }) as any,
    },
  )
  assert.notEqual(r.type, "error")
  assert.equal(getConfig().voice?.sttEngine, "browser")
})
