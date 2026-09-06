/**
 * #439 LLM search_threads / search_knowledge.
 *
 * Pins spec §5 / §7: independent clamp 5/10, omit score, redact secrets,
 * no messages field, empty hits, worker/orchestrator filter, plan_readonly
 * allow, L2 red-line, companion-local (not tool.forward), catalog preamble
 * distinguishes thread_recall.
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  clampLlmSearchLimit,
  LLM_SEARCH_LIMIT_DEFAULT,
  LLM_SEARCH_LIMIT_MAX,
  runSearchKnowledge,
  runSearchThreads,
} from "../src/tool/llm-search"
import {
  clampSearchLimit,
  isSearchableThreadRow,
  SUMMONER_SEARCH_LIMIT_DEFAULT,
  SUMMONER_SEARCH_LIMIT_MAX,
} from "../src/summoner/read-search"
import { isCompanionTool } from "../src/bridge/companion-tools"
import { getAllToolDefinitions } from "../src/bridge/tool-definitions"
import { isPlanReadonlyAllowed } from "../src/tool/plan-readonly"
import { L2_GATE_TOOLS } from "../src/tool/l2-admission"

const SK = "sk-ABCDEFGH12345678"
const API_KEY = "api_key=super-secret-value-xyz"
const GHP = "ghp_0123456789abcdefghij"
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0secretbody\n-----END RSA PRIVATE KEY-----"

function threadRow(
  id: string,
  alias: string,
  opts?: {
    tldr?: string
    tags?: string[]
    bullets?: string[]
    agent_role?: string | null
    updated?: string
  },
) {
  return {
    id,
    alias,
    agent_role: opts?.agent_role,
    last_message_at: opts?.updated || "2026-09-06T10:00:00.000Z",
    digest: opts?.tldr || opts?.tags || opts?.bullets
      ? { tldr: opts?.tldr, tags: opts?.tags, bullets: opts?.bullets }
      : undefined,
  }
}

test("#439 clamp is independent of summoner UI 10/20", () => {
  assert.equal(LLM_SEARCH_LIMIT_DEFAULT, 5)
  assert.equal(LLM_SEARCH_LIMIT_MAX, 10)
  assert.equal(SUMMONER_SEARCH_LIMIT_DEFAULT, 10)
  assert.equal(SUMMONER_SEARCH_LIMIT_MAX, 20)
  assert.equal(clampLlmSearchLimit(undefined), 5)
  assert.equal(clampLlmSearchLimit(null), 5)
  assert.equal(clampLlmSearchLimit(""), 5)
  assert.equal(clampLlmSearchLimit("nope"), 5)
  assert.equal(clampLlmSearchLimit(3), 3)
  assert.equal(clampLlmSearchLimit(999), 10)
  assert.equal(clampLlmSearchLimit(0), 1)
  assert.equal(clampLlmSearchLimit(-4), 1)
  assert.equal(clampSearchLimit(undefined), 10)
  assert.equal(clampSearchLimit(999), 20)
  assert.notEqual(clampLlmSearchLimit(undefined), clampSearchLimit(undefined))
  assert.notEqual(clampLlmSearchLimit(999), clampSearchLimit(999))
})

test("#439 search_threads: 0 hits is honest empty array", () => {
  const r = runSearchThreads(
    [threadRow("a", "zsh 配置", { tldr: "terminal prompt" })],
    "不存在的话题xyz",
  )
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.hits, [])
})

test("#439 search_threads: empty query errors (does not invent hits)", () => {
  const r = runSearchThreads([threadRow("a", "brew")], "   ")
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.error, /query required/)
})

test("#439 search_threads: omit score; no messages field; clamp 5", () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    threadRow(`t${i}`, `brew 排障 ${i}`, { tldr: `homebrew 问题 ${i}` }),
  )
  const r = runSearchThreads(rows, "brew")
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.hits.length, 5)
  for (const h of r.hits) {
    assert.deepEqual(Object.keys(h).sort(), ["alias", "snippet", "thread_id", "title", "updated_at"])
    assert.equal("score" in h, false)
    assert.equal("messages" in h, false)
  }
  const dumped = JSON.stringify(r.hits)
  assert.doesNotMatch(dumped, /"score"/)
  assert.doesNotMatch(dumped, /"messages"/)
  const capped = runSearchThreads(rows, "brew", 99)
  assert.equal(capped.ok, true)
  if (!capped.ok) return
  assert.equal(capped.hits.length, 10)
})

test("#439 search_threads: worker/orchestrator filtered (same predicate as thread.search)", () => {
  assert.equal(isSearchableThreadRow({ agent_role: "worker" }), false)
  assert.equal(isSearchableThreadRow({ agent_role: "orchestrator" }), false)
  assert.equal(isSearchableThreadRow({ agent_role: "normal" }), true)
  assert.equal(isSearchableThreadRow({}), true)
  const rows = [
    threadRow("user", "brew 用户会话", { tldr: "homebrew 安装" }),
    threadRow("w1", "brew worker", { tldr: "homebrew worker", agent_role: "worker" }),
    threadRow("o1", "brew orchestrator", { tldr: "homebrew orch", agent_role: "orchestrator" }),
  ]
  const r = runSearchThreads(rows, "brew")
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].thread_id, "user")
})

test("#439 search_threads: sk-/api_key=/PEM/ghp_ → [REDACTED]; no message bodies", () => {
  const rows = [
    threadRow("s1", "密钥排查", {
      tldr: `发现了 ${SK} 和 ${API_KEY} 以及 ${GHP} 还有 ${PEM} 需要轮换`,
    }),
  ]
  const r = runSearchThreads(rows, "密钥")
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.hits.length, 1)
  const snip = r.hits[0].snippet
  assert.match(snip, /\[REDACTED\]/)
  assert.doesNotMatch(snip, /sk-ABCDEFGH/)
  assert.doesNotMatch(snip, /api_key=super-secret/)
  assert.doesNotMatch(snip, /ghp_0123456789/)
  assert.doesNotMatch(snip, /BEGIN RSA PRIVATE KEY/)
  assert.doesNotMatch(snip, /MIIEowIBAAKCAQEA0secretbody/)
  const dumped = JSON.stringify(r)
  assert.doesNotMatch(dumped, /"messages"/)
})

test("#439 search_knowledge: 0 hits empty; omit score; snippet redacted", () => {
  const docs = [
    {
      id: "k1",
      name: "k1",
      title: "知识库索引设计",
      description: `派生索引 ${SK} ${API_KEY} ${GHP} ${PEM}`,
      tags: ["图谱"],
      folder: "notes",
    },
    { id: "k2", name: "k2", title: "其他", description: "", tags: [], folder: "" },
  ]
  const none = runSearchKnowledge(docs, "不存在的词")
  assert.equal(none.ok, true)
  if (!none.ok) return
  assert.deepEqual(none.hits, [])

  const r = runSearchKnowledge(docs, "知识库")
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(r.hits.length >= 1)
  const hit = r.hits[0]
  assert.deepEqual(Object.keys(hit).sort(), ["folder", "id", "snippet", "title"])
  assert.equal("score" in hit, false)
  assert.match(hit.snippet, /\[REDACTED\]/)
  assert.doesNotMatch(hit.snippet, /sk-ABCDEFGH/)
  assert.doesNotMatch(hit.snippet, /api_key=super-secret/)
  assert.doesNotMatch(hit.snippet, /ghp_0123456789/)
  assert.doesNotMatch(hit.snippet, /BEGIN RSA PRIVATE KEY/)
  const dumped = JSON.stringify(r.hits)
  assert.doesNotMatch(dumped, /"score"/)
  assert.doesNotMatch(dumped, /"messages"/)
})

test("#439 catalog: two L1 tools, distinct from thread_recall, local CMspark", () => {
  const defs = getAllToolDefinitions()
  const byName = new Map(defs.map((d) => [d.function.name, d]))
  for (const name of ["search_threads", "search_knowledge", "thread_recall"]) {
    assert.ok(byName.has(name), `${name} missing from catalog`)
  }
  const threads = byName.get("search_threads")!
  const knowledge = byName.get("search_knowledge")!
  const recall = byName.get("thread_recall")!
  assert.match(threads.function.description, /local CMspark/i)
  assert.match(threads.function.description, /thread_recall/)
  assert.match(threads.function.description, /OTHER/i)
  assert.doesNotMatch(threads.function.description, /peek/i)
  assert.match(knowledge.function.description, /local CMspark/i)
  assert.match(recall.function.description, /CURRENT conversation thread/i)
  assert.ok(isCompanionTool("search_threads"))
  assert.ok(isCompanionTool("search_knowledge"))
  assert.equal(isCompanionTool("list_tabs"), false)
})

test("#439 red line: not L2; plan_readonly allowed; no peek verb", () => {
  assert.equal(L2_GATE_TOOLS.includes("search_threads"), false)
  assert.equal(L2_GATE_TOOLS.includes("search_knowledge"), false)
  assert.equal(isPlanReadonlyAllowed("search_threads"), true)
  assert.equal(isPlanReadonlyAllowed("search_knowledge"), true)
  const names = getAllToolDefinitions().map((d) => d.function.name)
  assert.equal(names.includes("peek_thread"), false)
  assert.equal(names.includes("summarize_thread"), false)
  assert.equal(names.includes("cite_thread"), false)
})

function readSrc(...parts: string[]): string {
  const candidates = [
    path.join(process.cwd(), "src", ...parts),
    path.join(__dirname, "../../src", ...parts),
    path.join(__dirname, "../src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8")
  }
  throw new Error("src not found: " + parts.join("/"))
}

test("#439 catalog preamble distinguishes thread_recall and forbids routine scan", () => {
  const adapter = readSrc("llm", "adapter.ts")
  assert.match(adapter, /10c\. Local CMspark memory/)
  const idx = adapter.indexOf("10c. Local CMspark memory")
  const line = adapter.slice(idx, adapter.indexOf("\n", idx))
  assert.match(line, /search_threads/)
  assert.match(line, /thread_recall/)
  assert.match(line, /search_knowledge/)
  assert.match(line, /do not scan routinely/)
  assert.match(line, /THIS thread/)
  assert.doesNotMatch(line, /system_prompt_append/)
})

test("#439 shared predicate: message-router thread.search uses isSearchableThreadRow", () => {
  const src = readSrc("message-router.ts")
  assert.match(src, /isSearchableThreadRow/)
  assert.match(src, /\.filter\(isSearchableThreadRow\)/)
  const llm = readSrc("tool", "llm-search.ts")
  assert.match(llm, /isSearchableThreadRow/)
  assert.doesNotMatch(llm, /scoreRelatedKnowledge/)
  assert.doesNotMatch(llm, /tool\.forward/)
})

// ---------------------------------------------------------------------------
// Dispatch: companion-local, same shape, summoner/panel 同权
// ---------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-llm-search-"))
process.env.HOME = tmp
process.env.CMSPARK_DATA_DIR = tmp

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let bindCompanionDispatchRuntime: typeof import("../src/tool/companion-dispatch").bindCompanionDispatchRuntime
let executeCompanionTool: typeof import("../src/tool/companion-dispatch").executeCompanionTool

before(async () => {
  const config = await import("../src/config")
  await config.initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  const dispatch = await import("../src/tool/companion-dispatch")
  bindCompanionDispatchRuntime = dispatch.bindCompanionDispatchRuntime
  executeCompanionTool = dispatch.executeCompanionTool
})

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const knowledgeDocs = [
  {
    id: "k-secret",
    name: "k-secret",
    title: "密钥笔记",
    description: `泄漏 ${SK} ${API_KEY}`,
    tags: ["安全"],
    folder: "sec",
  },
]

function bind(tm: InstanceType<typeof ThreadManager>) {
  bindCompanionDispatchRuntime({
    getThreadManager: () => tm,
    getSkillEngine: () => ({ listKnowledge: () => knowledgeDocs }) as any,
    getCachedTabUrl: () => undefined,
    getTabUrlCache: () => new Map(),
    computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any,
    getComputerRateLimiterSingleton: () => null,
    securityConfirmations: {
      request: async () => ({ confirmationId: "", approved: false, reason: "disconnect" as const }),
    } as any,
    getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0,
    hasPendingForTab: () => false,
    rejectPendingForTab: () => 0,
  })
}

test("#439 dispatch search_threads: companion-local; summoner handshake 同权; worker hidden", async () => {
  const tm = new ThreadManager()
  const user = tm.create("brew 排障记录")
  tm.update(user.id, {
    digest: {
      extracted_at: "2026-09-06T00:00:00.000Z",
      content_fingerprint: "1:m",
      tldr: "Homebrew 安装失败排查",
      tags: ["brew"],
      source: "manual",
    },
  } as any)
  const worker = tm.create("brew worker 内部")
  tm.update(worker.id, {
    agent_role: "worker",
    digest: {
      extracted_at: "2026-09-06T00:00:00.000Z",
      content_fingerprint: "1:m",
      tldr: "Homebrew worker 任务",
      tags: ["brew"],
      source: "manual",
    },
  } as any)
  bind(tm)

  const r = await executeCompanionTool(
    "search_threads",
    { query: "brew", __thread_id: user.id },
    "tc-st",
    { handshakeSurface: "summoner" },
  )
  assert.equal(r.success, true)
  assert.ok(Array.isArray(r.data.hits))
  assert.ok(r.data.hits.some((h: { thread_id: string }) => h.thread_id === user.id))
  assert.equal(
    r.data.hits.some((h: { thread_id: string }) => h.thread_id === worker.id),
    false,
    "worker 不得入 LLM 检索",
  )
  for (const h of r.data.hits) {
    assert.equal("score" in h, false)
    assert.equal("messages" in h, false)
  }

  const r2 = await executeCompanionTool("search_threads", { query: "brew" }, "tc-st2")
  assert.equal(r2.success, true, "缺 handshakeSurface 仍可用（侧栏同权）")
})

test("#439 dispatch search_knowledge: redact snippet; empty query errors", async () => {
  const tm = new ThreadManager()
  bind(tm)
  const r = await executeCompanionTool("search_knowledge", { query: "密钥" })
  assert.equal(r.success, true)
  assert.ok(r.data.hits.length >= 1)
  const snip = String(r.data.hits[0].snippet)
  assert.match(snip, /\[REDACTED\]/)
  assert.doesNotMatch(snip, /sk-ABCDEFGH/)
  assert.doesNotMatch(JSON.stringify(r.data), /"score"/)
  assert.doesNotMatch(JSON.stringify(r.data), /"messages"/)

  const empty = await executeCompanionTool("search_knowledge", { query: "   " })
  assert.equal(empty.success, false)
  assert.match(String(empty.error), /query required/)
})
