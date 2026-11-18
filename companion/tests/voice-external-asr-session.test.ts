import assert from "node:assert/strict"
import { readdirSync, statSync, truncateSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createExternalAsrSession } from "../src/voice/external-asr-session"

const external = {
  style: "deepseek" as const,
  baseUrl: "",
  model: "whisper-1",
  apiKey: "secret",
  maxDurationMs: 120000,
  maxBytes: 8388608,
  requestTimeoutMs: 180000,
}

function session(fetchImpl: (...args: any[]) => any, now: () => number) {
  return createExternalAsrSession({
    now,
    fetchImpl,
    config: () => ({ sttEngine: "external", external }),
  })
}

test("abort before end does not fetch", async () => {
  let calls = 0
  const s = session(async () => { calls += 1; return { status: 200, json: async () => ({ text: "x" }) } }, () => 0)
  assert.equal(s.start({ sessionId: "s", privacyAckExternalV1: true }).ok, true)
  s.chunk({ sessionId: "s", seq: 0, pcm: Uint8Array.of(0, 0) })
  const aborted = s.abort("s")
  assert.equal(aborted.sent, false)
  assert.equal(calls, 0)
})

test("15000ms without a chunk does not upload", async () => {
  let calls = 0
  let t = 0
  const s = session(async () => { calls += 1; return { status: 200, json: async () => ({ text: "x" }) } }, () => t)
  s.start({ sessionId: "s", privacyAckExternalV1: true })
  s.chunk({ sessionId: "s", seq: 0, pcm: Uint8Array.of(0, 0) })
  t = 15000
  const ended = await s.end("s")
  assert.equal(ended.sent, false)
  assert.equal(calls, 0)
})

test("3840044 bytes are accepted and posted once", async () => {
  let calls = 0
  let posted = 0
  const s = session(async (_url: string, init: { body: FormData }) => {
    calls += 1
    const file = init.body.get("file") as Blob
    posted = file.size
    return { status: 200, json: async () => ({ text: "好" }) }
  }, () => 0)
  s.start({ sessionId: "s", privacyAckExternalV1: true })
  const pcm = 120 * 32000
  const chunk = 256 * 1024
  let seq = 0
  for (let off = 0; off < pcm; off += chunk) {
    const n = Math.min(chunk, pcm - off)
    const part = s.chunk({ sessionId: "s", seq, pcm: new Uint8Array(n) })
    assert.equal(part.ok, true)
    assert.ok(n <= chunk)
    seq += 1
  }
  const ended = await s.end("s")
  assert.equal(calls, 1)
  assert.equal(posted, 44 + pcm)
  assert.equal(posted, 3840044)
  assert.equal(ended.ok && ended.text, "好")
})

test("chunks assemble more than 10MiB without one websocket payload", async () => {
  let calls = 0
  let posted = 0
  const wide = { ...external, maxBytes: 33554432, maxDurationMs: null }
  const s = createExternalAsrSession({
    now: () => 0,
    config: () => ({ sttEngine: "external", external: wide }),
    fetchImpl: async (_url: string, init: { body: FormData }) => {
      calls += 1
      posted = (init.body.get("file") as Blob).size
      return { status: 200, json: async () => ({ text: "长" }) }
    },
  })
  s.start({ sessionId: "s", privacyAckExternalV1: true })
  const chunk = 256 * 1024
  const total = 10 * 1024 * 1024 + chunk
  let seq = 0
  for (let off = 0; off < total; off += chunk) {
    const part = s.chunk({ sessionId: "s", seq, pcm: new Uint8Array(chunk) })
    assert.equal(part.ok, true)
    seq += 1
  }
  assert.ok(seq > 1)
  assert.equal((await s.end("s")).ok, true)
  assert.equal(calls, 1)
  assert.equal(posted, 44 + total)
  assert.ok(posted > 10 * 1024 * 1024)
  s.start({ sessionId: "next", privacyAckExternalV1: true })
  const tooBig = s.chunk({ sessionId: "next", seq: 0, pcm: new Uint8Array(chunk + 1) })
  assert.equal(tooBig.ok, false)
  assert.equal(calls, 1)
})

test("abort during post drops late text, and partialRequest does not fetch", async () => {
  let calls = 0
  const s = createExternalAsrSession({
    now: () => 0,
    config: () => ({ sttEngine: "external", external }),
    fetchImpl: (_url: string, init: { signal: AbortSignal }) => new Promise((resolve) => {
      calls += 1
      init.signal.addEventListener("abort", () => resolve({ status: 200, json: async () => ({ text: "late" }) }))
    }),
  })
  s.start({ sessionId: "s", privacyAckExternalV1: true })
  s.chunk({ sessionId: "s", seq: 0, pcm: Uint8Array.of(0, 0) })
  const pending = s.end("s")
  s.abort("s")
  const ended = await pending
  assert.equal(ended.ok, false)
  assert.equal(ended.code, "aborted")
  assert.notEqual(ended.text, "late")
  calls = 0
  const s2 = session(async () => { calls += 1; return { status: 200, json: async () => ({ text: "x" }) } }, () => 0)
  s2.start({ sessionId: "p", privacyAckExternalV1: true })
  assert.equal(s2.partialRequest("p").fetched, false)
  assert.equal(calls, 0)
})

function pcmPathFor(sessionId: string): string {
  const dirs = readdirSync(tmpdir())
    .filter((name) => name.startsWith(`cmspark-external-asr-${sessionId}-`))
    .map((name) => ({ name, mtime: statSync(join(tmpdir(), name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  assert.ok(dirs.length >= 1)
  return join(tmpdir(), dirs[0]!.name, "audio.pcm")
}

test("second start is session_busy and the first buffer stays", async () => {
  let posted = 0
  const s = session(async (_url: string, init: { body: FormData }) => {
    posted = (init.body.get("file") as Blob).size
    return { status: 200, json: async () => ({ text: "留" }) }
  }, () => 0)
  assert.equal(s.start({ sessionId: "first", privacyAckExternalV1: true }).ok, true)
  assert.equal(s.chunk({ sessionId: "first", seq: 0, pcm: Uint8Array.of(9, 9, 9, 9) }).ok, true)
  const again = s.start({ sessionId: "second", privacyAckExternalV1: true })
  assert.equal(again.ok, false)
  assert.equal(again.code, "session_busy")
  assert.equal(s.owns("first"), true)
  assert.equal(s.owns("second"), false)
  const ended = await s.end("first")
  assert.equal(ended.ok && ended.text, "留")
  assert.equal(posted, 48)
})

test("a chunk that crosses the cap keeps the aligned prefix and later chunks do not grow it", async () => {
  let posted = 0
  let calls = 0
  const capped = { ...external, maxDurationMs: 1000, maxBytes: 8_388_608 }
  const s = createExternalAsrSession({
    now: () => 0,
    config: () => ({ sttEngine: "external", external: capped }),
    fetchImpl: async (_url: string, init: { body: FormData }) => {
      calls += 1
      posted = (init.body.get("file") as Blob).size
      return { status: 200, json: async () => ({ text: "界" }) }
    },
  })
  assert.equal(s.start({ sessionId: "cross-1", privacyAckExternalV1: true }).ok, true)
  const crossing = s.chunk({ sessionId: "cross-1", seq: 0, pcm: new Uint8Array(40_000) })
  assert.equal(crossing.ok, true)
  assert.equal(statSync(pcmPathFor("cross-1")).size, 32_000)
  const extra = s.chunk({ sessionId: "cross-1", seq: 1, pcm: new Uint8Array(8_000) })
  assert.equal(extra.ok, true)
  assert.equal(statSync(pcmPathFor("cross-1")).size, 32_000)
  const ended = await s.end("cross-1")
  assert.equal(ended.ok && ended.text, "界")
  assert.equal(calls, 1)
  assert.equal(posted, 44 + 32_000)
})

test("continued chunks cannot save past the byte cap", async () => {
  let posted = 0
  const wideOpen = { ...external, style: "openai" as const, maxDurationMs: null, maxBytes: 30_044, model: "gpt-transcribe" }
  const s = createExternalAsrSession({
    now: () => 0,
    config: () => ({ sttEngine: "external", external: wideOpen }),
    fetchImpl: async (_url: string, init: { body: FormData }) => {
      posted = (init.body.get("file") as Blob).size
      return { status: 200, json: async () => ({ text: "停" }) }
    },
  })
  s.start({ sessionId: "malicious-1", privacyAckExternalV1: true })
  for (let seq = 0; seq < 5; seq += 1) {
    const part = s.chunk({ sessionId: "malicious-1", seq, pcm: new Uint8Array(256 * 1024) })
    assert.equal(part.ok, true)
  }
  assert.equal(statSync(pcmPathFor("malicious-1")).size, 30_000)
  const ended = await s.end("malicious-1")
  assert.equal(ended.ok && ended.text, "停")
  assert.equal(posted, 44 + 30_000)
})

test("a file already over the save cap is not read or fetched", async () => {
  let calls = 0
  let reads = 0
  const capped = { ...external, maxDurationMs: null, maxBytes: 30_044 }
  const s = createExternalAsrSession({
    now: () => 0,
    config: () => ({ sttEngine: "external", external: capped }),
    readFile: () => {
      reads += 1
      throw new Error("oversized pcm was read")
    },
    fetchImpl: async () => {
      calls += 1
      return { status: 200, json: async () => ({ text: "大" }) }
    },
  })
  s.start({ sessionId: "over-1", privacyAckExternalV1: true })
  s.chunk({ sessionId: "over-1", seq: 0, pcm: new Uint8Array(1_000) })
  truncateSync(pcmPathFor("over-1"), 100_000)
  const ended = await s.end("over-1")
  assert.equal(ended.ok, false)
  assert.equal(ended.code, "external_too_large")
  assert.equal(calls, 0)
  assert.equal(reads, 0)
})
