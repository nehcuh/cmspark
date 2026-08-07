#!/usr/bin/env node
/**
 * Path B Spike S5 — in-process session reassembly probe (no WS server).
 * Writes docs/audit/reviews/voice-pathb-s5-session-probe.json
 */
import { createRequire } from "node:module"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")

// Prefer compiled test-dist if present; else dynamic tsx not required — run after tsc test.
const candidates = [
  path.join(root, "companion/.test-dist/src/voice/stt-session-core.js"),
  path.join(root, "companion/dist/voice/stt-session-core.js"),
]

async function loadCore() {
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const mod = await import(c)
      return mod.SttSessionCore
    }
  }
  // Fallback: compile-on-the-fly via createRequire from source is hard;
  // use child process of companion tests instead.
  throw new Error(
    "stt-session-core.js not found — run: npm --prefix companion test (or tsc -p tsconfig.test.json)",
  )
}

const outPath =
  process.argv[2] ||
  path.join(root, "docs/audit/reviews/voice-pathb-s5-session-probe.json")

const cases = []
function rec(name, ok, detail) {
  cases.push({ name, ok, detail })
}

try {
  const SttSessionCore = await loadCore()
  const core = new SttSessionCore(() => 42)

  // happy path multi-chunk
  let r = core.start({
    sessionId: "s1",
    modelId: "medium",
    format: "wav",
    sampleRate: 16000,
    channels: 1,
  })
  rec("start", r.ok, r)
  const chunks = [Buffer.from("AAA"), Buffer.from("BBB"), Buffer.from("CCC")]
  for (let i = 0; i < chunks.length; i++) {
    r = core.appendChunk("s1", i, chunks[i])
    rec(`chunk_${i}`, r.ok, r)
  }
  r = core.end("s1", 3)
  rec("end", r.ok && r.audio?.equals(Buffer.concat(chunks)), {
    ok: r.ok,
    len: r.audio?.length,
  })
  core.clearIfEnded()

  // abort mid-stream
  core.start({
    sessionId: "s2",
    modelId: "small",
    format: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
  })
  core.appendChunk("s2", 0, Buffer.from("x"))
  r = core.abort("s2")
  rec("abort", r.ok, r)
  r = core.appendChunk("s2", 1, Buffer.from("y"))
  rec("late_chunk_after_abort", !r.ok && r.code === "session_unknown", r)

  const allOk = cases.every((c) => c.ok)
  const report = {
    spike: "pathb-s5-session",
    time: new Date().toISOString(),
    status: allOk ? "pass" : "fail",
    cases,
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  process.exit(allOk ? 0 : 1)
} catch (e) {
  const report = {
    spike: "pathb-s5-session",
    time: new Date().toISOString(),
    status: "fail",
    error: String(e?.message || e),
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.error(report)
  process.exit(1)
}
