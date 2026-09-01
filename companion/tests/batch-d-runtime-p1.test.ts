/**
 * Batch D runtime P1 (#249) — TDD DoD.
 */
import test, { before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { wrapUntrusted } from "../src/llm/text-sanitize"
import { shrinkToolBodiesToFit } from "../src/llm/context-budget"
import type { CanonicalChatMessage } from "../src/llm/provider"
import { isSummonerLoopbackUrl, planSummonerShellOpen } from "../src/summoner/shell-open"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-batch-d-"))
process.env.HOME = tmp
process.env.CMSPARK_DATA_DIR = tmp

const ROOT = path.resolve(__dirname, "..", "..")
function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[candidates.length - 1]
}

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  const config = await import("../src/config")
  initDataDir = config.initDataDir
  await initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
})

test("D1: ThreadManager.get does not saveIndex (second snapshot cannot clobber live alias)", () => {
  const live = new ThreadManager()
  const th = live.create("batch-d-clobber")
  live.update(th.id, { alias: "first" })
  const stale = new ThreadManager()
  live.update(th.id, { alias: "second" })
  stale.get(th.id)
  const disk = new ThreadManager()
  assert.equal(disk.get(th.id)?.alias, "second")
})

test("T-clock-1: update digest does not change last_message_at", () => {
  const tm = new ThreadManager()
  const th = tm.create("clock-digest")
  tm.addMessage(th.id, { thread_id: th.id, role: "user", content: "hi" })
  const afterMsg = tm.get(th.id)!
  const last = afterMsg.last_message_at
  assert.ok(last)
  tm.update(th.id, {
    digest: { extracted_at: new Date().toISOString(), tldr: "x", tags: [], bullets: [], source: "manual" } as any,
  })
  assert.equal(tm.get(th.id)?.last_message_at, last)
})

test("T-clock-2: addMessage advances last_message_at", () => {
  const tm = new ThreadManager()
  const th = tm.create("clock-add")
  assert.ok(!th.last_message_at)
  const m = tm.addMessage(th.id, { thread_id: th.id, role: "user", content: "hi" })
  assert.equal(tm.get(th.id)?.last_message_at, m.created_at)
})

test("T-clock-1b: update() cannot forge last_message_at", () => {
  const tm = new ThreadManager()
  const th = tm.create("clock-forge")
  tm.update(th.id, { last_message_at: "2099-01-01T00:00:00.000Z" } as any)
  assert.notEqual(tm.get(th.id)?.last_message_at, "2099-01-01T00:00:00.000Z")
})

test("T-clock-4: listWithPreviews fills missing last_message_at from json", () => {
  const tm = new ThreadManager()
  const th = tm.create("clock-backfill")
  const m = tm.addMessage(th.id, { thread_id: th.id, role: "user", content: "hi" })
  const row = tm.get(th.id)!
  delete (row as { last_message_at?: string }).last_message_at
  const listed = tm.listWithPreviews().find((t) => t.id === th.id)
  assert.equal(listed?.last_message_at, m.created_at)
  assert.equal(tm.get(th.id)?.last_message_at, m.created_at)
})

test("T-clock-5: saveIndex merge-peer restores last_message_at from disk", () => {
  const live = new ThreadManager()
  const th = live.create("clock-peer")
  const m = live.addMessage(th.id, { thread_id: th.id, role: "user", content: "hi" })
  const stale = new ThreadManager()
  const staleRow = stale.get(th.id)!
  delete (staleRow as { last_message_at?: string }).last_message_at
  stale.update(th.id, { alias: "peer" })
  const disk = new ThreadManager()
  assert.equal(disk.get(th.id)?.last_message_at, m.created_at)
  assert.equal(disk.get(th.id)?.alias, "peer")
})

test("T-abort-2: drainThreadOnSupersede does not persist messages", () => {
  const src = fs.readFileSync(srcFile("message-router.ts"), "utf8")
  const start = src.indexOf("async function drainThreadOnSupersede")
  assert.ok(start >= 0)
  const end = src.indexOf("\ninterface Services", start)
  const body = src.slice(start, end > start ? end : start + 800)
  assert.match(body, /rejectPendingForThread/)
  assert.equal(body.includes("addMessage"), false)
  assert.equal(body.includes("persistAssistantDraft"), false)
})

test("D1: skill-engine production paths do not construct ThreadManager", () => {
  const src = fs.readFileSync(srcFile("skills", "skill-engine.ts"), "utf8")
  const hits = [...src.matchAll(/new ThreadManager\s*\(/g)]
  assert.equal(hits.length, 0, `unexpected new ThreadManager: ${hits.length}`)
})

test("D4: shrinkToolBodiesToFit keeps matching untrusted closer", () => {
  const inner = "PAGECONTENT".repeat(400)
  const wrapped = wrapUntrusted(inner, "callabc123xyz", "get_page_text")
  assert.match(wrapped, /<\/untrusted-callabc123xyz>/)
  const msgs: CanonicalChatMessage[] = [
    { role: "system", content: "s" },
    { role: "user", content: "u" },
    { role: "tool", content: wrapped, tool_call_id: "callabc123xyz" },
  ]
  const ok = shrinkToolBodiesToFit(msgs, 40)
  assert.equal(ok, true)
  const body = String(msgs[2]!.content)
  assert.match(body, /<untrusted-callabc123xyz/)
  assert.match(body, /<\/untrusted-callabc123xyz>/)
})

test("D3: thread query is joined with ? when URL has no token", () => {
  const base = "http://127.0.0.1:23403/"
  const join = base.includes("?") ? "&" : "?"
  const url = base + join + "thread=" + encodeURIComponent("abc123")
  assert.equal(isSummonerLoopbackUrl(url), true)
  assert.equal(isSummonerLoopbackUrl(base + "&thread=abc123"), false)
})

test("D3: --app URL must not carry a 64-hex token query", () => {
  const hex = "a".repeat(64)
  assert.equal(isSummonerLoopbackUrl(`http://127.0.0.1:23403/?token=${hex}`), false)
  assert.equal(isSummonerLoopbackUrl("http://127.0.0.1:23403/"), true)
  const plan = planSummonerShellOpen("http://127.0.0.1:23403/", {
    platform: "darwin",
    browserPath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  })
  assert.ok(!("error" in plan), (plan as any).error)
  const joined = (plan as { args: string[] }).args.join(" ")
  assert.doesNotMatch(joined, /[0-9a-fA-F]{64}/)
  assert.doesNotMatch(joined, /[?&]token=/)
})
