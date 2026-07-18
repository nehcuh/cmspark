// A7 evidence chain tests (plan G.3):
//  - TTL janitor + purge-all over an injected fake fs (retention property,
//    no real directory touched)
//  - ComputerEvidence over a REAL temp dir with a fake sealer — verifies the
//    sealer call sequence, blurRects pass-through, tmp cleanup, error wrap
//  - history.db redaction for host_computer via the REAL HistoryStore
//    (task / security_token / type.text hashed; result summary fully redacted)

import "./_computer-evidence-setup" // MUST be first — sets CMSPARK_DATA_DIR before src imports

import test, { before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import {
  ComputerEvidence,
  evidenceDigest,
  purgeAllEvidence,
  runEvidenceJanitor,
  EVIDENCE_TTL_MS,
  type EvidenceSealer,
  type JanitorFs,
} from "../src/computer/evidence"
import { ComputerError, type RectPx } from "../src/computer/types"

// --- fake sealer ---------------------------------------------------------------

class FakeSealer implements EvidenceSealer {
  calls: Array<{ inPath: string; outPath: string; blur: RectPx[] }> = []
  failOnIncludes?: string
  async protect(inPath: string, outPath: string, blurRects: RectPx[]): Promise<{ sha256: string }> {
    this.calls.push({ inPath, outPath, blur: blurRects })
    if (this.failOnIncludes && inPath.includes(this.failOnIncludes)) {
      throw new Error("seal boom")
    }
    // Production sealer semantics: output = transformed input, raw is consumed.
    const content = fs.existsSync(inPath) ? fs.readFileSync(inPath) : Buffer.from("PIXELS")
    fs.writeFileSync(outPath, content)
    try { fs.rmSync(inPath, { force: true }) } catch { /* best-effort */ }
    return { sha256: `sha-${path.basename(outPath)}` }
  }
}

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

// --- janitor (fake fs) -----------------------------------------------------------

function fakeJanitorFs(mtimes: Record<string, number>, opts: { exists?: boolean } = {}): {
  fsLike: JanitorFs
  removed: string[]
} {
  const table = { ...mtimes }
  const removed: string[] = []
  return {
    removed,
    fsLike: {
      readdir: () => Object.keys(table),
      statMtimeMs: (p) => table[path.basename(p)] ?? 0,
      rmrf: (p) => {
        removed.push(path.basename(p))
        delete table[path.basename(p)]
      },
      exists: () => opts.exists ?? true,
    },
  }
}

test("evidence janitor: task dirs older than the TTL are removed, fresh ones kept", () => {
  const now = 1_000_000_000_000
  const { fsLike, removed } = fakeJanitorFs({
    "task-old": now - EVIDENCE_TTL_MS - 1000,
    "task-fresh": now - 1000,
  })
  const out = runEvidenceJanitor({ baseDir: "X:\\evidence", now, fsLike })
  assert.deepEqual(out.sort(), ["task-old"])
  assert.deepEqual(removed, ["task-old"])
})

test("evidence janitor: missing base dir is a no-op", () => {
  const { fsLike } = fakeJanitorFs({}, { exists: false })
  assert.deepEqual(runEvidenceJanitor({ baseDir: "X:\\evidence", fsLike }), [])
})

test("evidence janitor: stat failure (mtime 0) is skipped, never deleted", () => {
  const now = 1_000_000_000_000
  const { fsLike, removed } = fakeJanitorFs({ "task-unstatable": 0 })
  const out = runEvidenceJanitor({ baseDir: "X:\\evidence", now, fsLike })
  assert.deepEqual(out, [])
  assert.deepEqual(removed, [])
})

test("evidence purge-all: wipes every task dir and returns the count", () => {
  const { fsLike, removed } = fakeJanitorFs({ a: 1, b: 2, c: 3 })
  const n = purgeAllEvidence({ baseDir: "X:\\evidence", fsLike })
  assert.equal(n, 3)
  assert.deepEqual(removed.sort(), ["a", "b", "c"])
})

test("evidence purge-all: missing base dir returns 0", () => {
  const { fsLike } = fakeJanitorFs({}, { exists: false })
  assert.equal(purgeAllEvidence({ baseDir: "X:\\evidence", fsLike }), 0)
})

// --- ComputerEvidence (real temp dir, fake sealer) --------------------------------

test("ComputerEvidence.init seals task metadata with empty blurRects and cleans the tmp", async () => {
  const base = tempDir("cmspark-ev-init-")
  const sealer = new FakeSealer()
  const ev = new ComputerEvidence("task-1", sealer, base)
  await ev.init({ app: "win.app.test", corpus: "abc" })
  assert.equal(sealer.calls.length, 1)
  const call = sealer.calls[0]
  assert.deepEqual(call.blur, [])
  assert.equal(call.outPath, path.join(ev.dir, "task.json.sealed"))
  // tmp consumed (fake sealer) or belt-removed — no raw metadata left behind
  const leftovers = fs.readdirSync(ev.dir).filter((f) => f.endsWith(".tmp"))
  assert.deepEqual(leftovers, [])
  // sealed content is the metadata JSON
  const sealed = JSON.parse(fs.readFileSync(call.outPath, "utf8"))
  assert.equal(sealed.app, "win.app.test")
})

test("ComputerEvidence.sealScreenshot passes blurRects through verbatim and consumes the raw", async () => {
  const base = tempDir("cmspark-ev-shot-")
  const sealer = new FakeSealer()
  const ev = new ComputerEvidence("task-2", sealer, base)
  await ev.init({})
  const raw = path.join(base, "raw-capture.png")
  fs.writeFileSync(raw, "RAW-PIXELS")
  const blur: RectPx[] = [{ x: 1, y: 2, width: 30, height: 40 }]
  const { sha256 } = await ev.sealScreenshot(raw, 7, "before", blur)
  assert.equal(sha256, "sha-before-7.png.sealed")
  const call = sealer.calls[1]
  assert.equal(call.inPath, raw)
  assert.equal(call.outPath, path.join(ev.dir, "before-7.png.sealed"))
  assert.deepEqual(call.blur, blur, "credential-neighborhood rects reach the sealer unmodified")
  assert.equal(fs.existsSync(raw), false, "raw capture consumed by the sealer")
})

test("ComputerEvidence.sealScreenshot wraps sealer failures as EVIDENCE_ERROR", async () => {
  const base = tempDir("cmspark-ev-fail-")
  const sealer = new FakeSealer()
  sealer.failOnIncludes = "raw-capture"
  const ev = new ComputerEvidence("task-3", sealer, base)
  await ev.init({})
  const raw = path.join(base, "raw-capture.png")
  fs.writeFileSync(raw, "RAW")
  try {
    await ev.sealScreenshot(raw, 1, "after", [])
    assert.fail("expected EVIDENCE_ERROR")
  } catch (err) {
    assert.ok(err instanceof ComputerError)
    assert.equal((err as ComputerError).code, "EVIDENCE_ERROR")
  }
})

test("ComputerEvidence.appendAction flushes the full record list after every append", async () => {
  const base = tempDir("cmspark-ev-actions-")
  const sealer = new FakeSealer()
  const ev = new ComputerEvidence("task-4", sealer, base)
  await ev.init({})
  await ev.appendAction({ seq: 1, action: "click", crossverified: true, uncrossverified: false, durationMs: 5 })
  await ev.appendAction({ seq: 2, action: "type", crossverified: false, uncrossverified: true, durationMs: 7 })
  const actionsPath = path.join(ev.dir, "actions.json.sealed")
  const stored = JSON.parse(fs.readFileSync(actionsPath, "utf8"))
  assert.equal(stored.length, 2, "second flush contains BOTH records")
  assert.equal(stored[1].action, "type")
  // init + 2 flushes = 3 sealer calls
  assert.equal(sealer.calls.length, 3)
})

test("ComputerEvidence.finalize seals the summary", async () => {
  const base = tempDir("cmspark-ev-final-")
  const sealer = new FakeSealer()
  const ev = new ComputerEvidence("task-5", sealer, base)
  await ev.init({})
  await ev.finalize({ ok: true, steps: 3 })
  const summaryPath = path.join(ev.dir, "summary.json.sealed")
  const stored = JSON.parse(fs.readFileSync(summaryPath, "utf8"))
  assert.equal(stored.ok, true)
  const leftovers = fs.readdirSync(ev.dir).filter((f) => f.endsWith(".tmp"))
  assert.deepEqual(leftovers, [])
})

test("ComputerEvidence sanitizes a hostile taskId into the base dir", () => {
  const base = tempDir("cmspark-ev-safe-")
  const ev = new ComputerEvidence("../../../etc/evil", new FakeSealer(), base)
  assert.ok(ev.dir.startsWith(base), `dir ${ev.dir} must stay under ${base}`)
  assert.ok(!ev.dir.includes(".."))
})

test("evidenceDigest is order-independent and stable", () => {
  const a = evidenceDigest(["aaa", "bbb", "ccc"])
  const b = evidenceDigest(["ccc", "aaa", "bbb"])
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{16}$/)
})

// --- history.db redaction (real HistoryStore) ---------------------------------------

let HistoryStore: typeof import("../src/history/store").HistoryStore

before(async () => {
  const config = await import("../src/config")
  await config.initDataDir()
  HistoryStore = (await import("../src/history/store")).HistoryStore
})

test("history redaction: host_computer task/token/type.text are hashed, summary fully redacted", async () => {
  const store = new HistoryStore()
  await store.waitReady()
  const params = JSON.stringify({
    task: "把青花瓷三个字输入到测试窗口",
    app: "win.app.test",
    security_token: "tok-secret-123",
    actions: [
      { action: "click", target: "确定" },
      { action: "type", text: "青花瓷" },
    ],
  })
  const summary = JSON.stringify({ steps: [{ untrustedText: "确定 取消 文件 编辑" }] })
  store.record({
    thread_id: "computer-redact-test",
    tool_name: "host_computer",
    params,
    result_summary: summary,
    error: null,
    success: 1,
    duration_ms: 42,
    created_at: new Date().toISOString(),
  })
  const rows = store.query({ thread_id: "computer-redact-test" })
  assert.equal(rows.length, 1)
  const storedParams = rows[0].params
  // nothing human-readable from the corpus survives
  assert.ok(!storedParams.includes("青花瓷"), "task/type.text literals must not persist")
  assert.ok(!storedParams.includes("tok-secret-123"), "security_token must not persist")
  const parsed = JSON.parse(storedParams)
  assert.match(parsed.task, /^<redacted:hash=[0-9a-f]{12},len=\d+>$/)
  assert.match(parsed.security_token, /^<redacted:hash=[0-9a-f]{12},len=\d+>$/)
  assert.match(parsed.actions[1].text, /^<redacted:hash=[0-9a-f]{12},len=\d+>$/)
  // non-secret structure is kept for auditability
  assert.equal(parsed.app, "win.app.test")
  assert.equal(parsed.actions[0].action, "click")
  assert.equal(parsed.actions[0].target, "确定")
  // result summary (may carry OCR text + evidence paths) collapses to hash+len
  assert.match(rows[0].result_summary, /^<redacted:len=\d+:sha256=[0-9a-f]{12}>$/)
  assert.ok(!rows[0].result_summary.includes("untrustedText"))
  store.close()
})

test("history redaction: non-sensitive tools pass through unchanged (control)", async () => {
  const store = new HistoryStore()
  await store.waitReady()
  store.record({
    thread_id: "computer-redact-control",
    tool_name: "navigate",
    params: JSON.stringify({ url: "https://example.com" }),
    result_summary: "ok",
    error: null,
    success: 1,
    duration_ms: 1,
    created_at: new Date().toISOString(),
  })
  const rows = store.query({ thread_id: "computer-redact-control" })
  assert.equal(JSON.parse(rows[0].params).url, "https://example.com")
  assert.equal(rows[0].result_summary, "ok")
  store.close()
})
