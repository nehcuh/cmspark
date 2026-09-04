// #259 — system engine (Windows SAPI) sessions in SttSessionService.
// Spec §3.1/§3.2: engine:"system" needs NO whisper model; end() feeds the
// reassembled 16kHz mono WAV to the SAPI helper; partials are skipped (batch).

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "cmspark-stt-system-svc-"),
)

import test from "node:test"
import assert from "node:assert/strict"

import { SttSessionService } from "../src/voice/stt-session-service"
import { WinSapiError, SAPI_HELPER_TIMEOUT_MS } from "../src/voice/win-sapi"

const DATA_DIR = process.env.CMSPARK_DATA_DIR!

type SapiCall = { wavPath: string; lang?: string; timeoutMs?: number }

function makeService(opts?: {
  runSapi?: (o: any) => Promise<{ text: string }>
  onCall?: (c: SapiCall) => void
}) {
  const calls: SapiCall[] = []
  const runSapi =
    opts?.runSapi ??
    (async (o: any) => {
      calls.push(o)
      opts?.onCall?.(o)
      return { text: "你好，系统识别。" }
    })
  const svc = new SttSessionService({ dataDir: DATA_DIR, runSapi, lang: "zh" })
  return { svc, calls }
}

const PCM = Buffer.alloc(16000 * 2, 0x01) // 1s of 16kHz mono s16le

function startSystem(svc: SttSessionService, sessionId = "sys-1") {
  return svc.start(
    {
      sessionId,
      modelId: "",
      engine: "system",
      format: "pcm_s16le",
      sampleRate: 16000,
      channels: 1,
    },
    "peer-1",
  )
}

test("system start: no whisper model required (modelId may be empty)", () => {
  const { svc } = makeService()
  const r = startSystem(svc)
  assert.equal(r.ok, true)
})

test("system end: WAV fed to SAPI helper, text returned, modelId empty", async () => {
  const { svc, calls } = makeService()
  assert.equal(startSystem(svc).ok, true)
  assert.equal(svc.chunk("sys-1", 0, PCM, "peer-1").ok, true)
  const r = await svc.end("sys-1", 1, "peer-1")
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.text, "你好，系统识别。")
    assert.equal(r.modelId, "")
  }
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.lang, "zh")
  assert.equal(calls[0]!.timeoutMs, SAPI_HELPER_TIMEOUT_MS)
  assert.ok(calls[0]!.wavPath.endsWith(".wav"))
})

test("system end: helper failure maps to system_engine_failed (honest)", async () => {
  const { svc } = makeService({
    runSapi: async () => {
      throw new WinSapiError("helper_error", "helper error: boom", "no_recognizer")
    },
  })
  startSystem(svc)
  await svc.chunk("sys-1", 0, PCM, "peer-1")
  const r = await svc.end("sys-1", 1, "peer-1")
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "system_engine_failed")
})

test("system end: unsupported culture maps to system_lang_unsupported", async () => {
  const { svc } = makeService({
    runSapi: async () => {
      throw new WinSapiError("system_lang_unsupported", "系统语音识别不支持当前语言", "unsupported_culture")
    },
  })
  startSystem(svc)
  await svc.chunk("sys-1", 0, PCM, "peer-1")
  const r = await svc.end("sys-1", 1, "peer-1")
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "system_lang_unsupported")
})

test("system end: helper unavailable maps to system_unavailable (no silent browser drop)", async () => {
  const { svc } = makeService({
    runSapi: async () => {
      throw new WinSapiError("unavailable", "helper sha256 mismatch")
    },
  })
  startSystem(svc)
  await svc.chunk("sys-1", 0, PCM, "peer-1")
  const r = await svc.end("sys-1", 1, "peer-1")
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "system_unavailable")
})

test("system partial: skipped (SAPI is batch — no progressive hypotheses)", async () => {
  const { svc } = makeService()
  startSystem(svc)
  await svc.chunk("sys-1", 0, PCM, "peer-1")
  const r = await svc.partial("sys-1", "peer-1")
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "partial_skipped")
})

test("system end: abort during helper run maps to aborted", async () => {
  const { svc } = makeService({
    runSapi: (o) =>
      new Promise((_, reject) => {
        o.signal?.addEventListener("abort", () =>
          reject(new WinSapiError("aborted", "helper run aborted")),
        )
      }),
  })
  startSystem(svc)
  await svc.chunk("sys-1", 0, PCM, "peer-1")
  const p = svc.end("sys-1", 1, "peer-1")
  // end() is awaiting the helper; abort from the owning peer
  setTimeout(() => {
    svc.abort("sys-1", "peer-1")
  }, 10)
  const r = await p
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "aborted")
})

test("system session: local model gates untouched — local start still requires ready model", () => {
  const { svc } = makeService()
  // engine absent → legacy local semantics: unknown modelId still invalid
  const r = svc.start(
    {
      sessionId: "loc-1",
      modelId: "not-a-model",
      format: "pcm_s16le",
      sampleRate: 16000,
      channels: 1,
    },
    "peer-1",
  )
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, "invalid_model")
})
