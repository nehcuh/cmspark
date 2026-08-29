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

test("D1: skill-engine production paths do not construct ThreadManager", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "skills", "skill-engine.ts"),
    "utf8",
  )
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
