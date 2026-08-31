/**
 * Slice 6 PR-B Task 4: run_progress seed (H1 open_todos) + evidence ticks.
 * v1 ingest = seed-only. No model_draft ingest. No overlay write verbs.
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import {
  applyToolResult,
  nextRunProgressAfterToolSuccess,
  sanitizeRunProgress,
  seedRunProgress,
  type RunProgress,
  type RunProgressItem,
} from "../src/threads/run-progress"
import { handleRunProgressToggle } from "../src/message-router/handlers/run-progress"
import { validateWsMessage } from "../src/ws/validate"
import { assertSummonerAllowed } from "../src/ws/summoner-acl"
import { SUMMONER_WEB_DISPATCH_ALLOW } from "../src/summoner-web"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-run-progress-"))
process.env.HOME = tmp
process.env.CMSPARK_DATA_DIR = tmp

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let initDataDir: typeof import("../src/config").initDataDir
let handleMessage: typeof import("../src/message-router").handleMessage

const mockSkillEngine = {
  activate: () => {},
  deactivate: () => {},
  getActiveForThread: () => [],
  matchSkills: () => [],
  get: () => undefined,
  list: () => [],
  refresh: () => {},
} as any

const mockHistoryStore = {
  query: async () => [],
  exportJSON: async () => ({ operations: [] }),
  record: async () => 0,
} as any

before(async () => {
  const config = await import("../src/config")
  initDataDir = config.initDataDir
  await initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  handleMessage = (await import("../src/message-router")).handleMessage
})

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function readSrc(...parts: string[]): string {
  const candidates = [
    path.join(__dirname, "..", "src", ...parts),
    path.join(__dirname, "../src", ...parts),
    path.join(process.cwd(), "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8")
  }
  throw new Error("src not found: " + parts.join("/"))
}

function item(over: Partial<RunProgressItem> & Pick<RunProgressItem, "id" | "text" | "source">): RunProgressItem {
  return { done: false, ...over }
}

test("run_progress seed copies handoff.open_todos into items source:seed done:false", () => {
  const progress = seedRunProgress({
    runtime_context_budget: {
      handoff: {
        open_todos: ["navigate example.com", "get_page_text on article"],
      },
    },
  })
  assert.equal(progress.items.length, 2)
  assert.equal(progress.items[0]!.text, "navigate example.com")
  assert.equal(progress.items[1]!.text, "get_page_text on article")
  for (const it of progress.items) {
    assert.equal(it.source, "seed")
    assert.equal(it.done, false)
    assert.equal(typeof it.id, "string")
    assert.ok(it.id.length > 0)
  }
  assert.notEqual(progress.items[0]!.id, progress.items[1]!.id)
})

test("#237 seed copies tool from H1 object todos; strings have no tool", () => {
  const progress = seedRunProgress({
    runtime_context_budget: {
      handoff: {
        open_todos: [
          { text: "打开已登录页", tool: "navigate" },
          "摘前五条标题",
          { text: "读正文", tool: "get_page_text" },
          { text: "忽略坏名", tool: "Navigate" },
        ],
      },
    },
  })
  assert.equal(progress.items.length, 4)
  assert.equal(progress.items[0]!.tool, "navigate")
  assert.equal(progress.items[0]!.source, "seed")
  assert.equal(progress.items[1]!.tool, undefined)
  assert.equal(progress.items[2]!.tool, "get_page_text")
  assert.equal(progress.items[3]!.tool, undefined, "case-sensitive; Navigate dropped")
  const ticked = applyToolResult(progress, { tool: "navigate", success: true })
  assert.equal(ticked.items[0]!.done, true)
  assert.equal(ticked.items[1]!.done, false)
  assert.equal(ticked.items[2]!.done, false)
})

test("run_progress seed missing handoff → empty", () => {
  assert.deepEqual(seedRunProgress({}).items, [])
  assert.deepEqual(seedRunProgress({ runtime_context_budget: null }).items, [])
  assert.deepEqual(
    seedRunProgress({ runtime_context_budget: { handoff: null } }).items,
    [],
  )
  assert.deepEqual(
    seedRunProgress({
      runtime_context_budget: { handoff: { open_todos: undefined } },
    }).items,
    [],
  )
})

test("run_progress seed ignores thread.open_todos (not SoT)", () => {
  const progress = seedRunProgress({
    open_todos: ["should-not-appear"],
    runtime_context_budget: {
      handoff: { open_todos: ["from-handoff"] },
    },
  } as { runtime_context_budget?: { handoff?: { open_todos?: string[] } | null } | null })
  assert.deepEqual(
    progress.items.map((i) => i.text),
    ["from-handoff"],
  )
  const empty = seedRunProgress({
    open_todos: ["should-not-appear"],
  } as { runtime_context_budget?: { handoff?: { open_todos?: string[] } | null } | null })
  assert.deepEqual(empty.items, [])
})

test("run_progress seed caps 8×120 same as H1", () => {
  const todos = Array.from({ length: 12 }, (_, i) => `${"x".repeat(200)}-${i}`)
  const progress = seedRunProgress({
    runtime_context_budget: { handoff: { open_todos: todos } },
  })
  assert.equal(progress.items.length, 8)
  for (const it of progress.items) {
    assert.ok(it.text.length <= 120)
  }
})

test("applyToolResult ticks oldest matching tool on seed/user", () => {
  const progress: RunProgress = {
    items: [
      item({ id: "a", text: "first navigate", source: "seed", tool: "navigate" }),
      item({ id: "b", text: "second navigate", source: "user", tool: "navigate" }),
      item({ id: "c", text: "page text", source: "seed", tool: "get_page_text" }),
    ],
  }
  const next = applyToolResult(progress, { tool: "navigate", success: true })
  assert.equal(next.items[0]!.done, true)
  assert.equal(next.items[1]!.done, false)
  assert.equal(next.items[2]!.done, false)

  const next2 = applyToolResult(next, { tool: "navigate", success: true })
  assert.equal(next2.items[0]!.done, true)
  assert.equal(next2.items[1]!.done, true)
})

test("applyToolResult never ticks model_draft even when tool matches", () => {
  const progress: RunProgress = {
    items: [
      item({ id: "d", text: "draft nav", source: "model_draft", tool: "navigate" }),
      item({ id: "s", text: "seed nav", source: "seed", tool: "navigate" }),
    ],
  }
  const next = applyToolResult(progress, { tool: "navigate", success: true })
  assert.equal(next.items[0]!.done, false)
  assert.equal(next.items[0]!.source, "model_draft")
  assert.equal(next.items[1]!.done, true)
})

test("applyToolResult does not tick on success:false", () => {
  const progress: RunProgress = {
    items: [item({ id: "a", text: "nav", source: "seed", tool: "navigate" })],
  }
  const next = applyToolResult(progress, { tool: "navigate", success: false })
  assert.equal(next.items[0]!.done, false)
  assert.equal(next, progress)
})

test("applyToolResult never substring-match text", () => {
  const progress: RunProgress = {
    items: [
      item({
        id: "t",
        text: "please navigate to example.com then screenshot",
        source: "seed",
      }),
      item({
        id: "u",
        text: "navigate is in the text",
        source: "user",
        tool: "get_page_text",
      }),
    ],
  }
  const next = applyToolResult(progress, { tool: "navigate", success: true })
  assert.equal(next.items[0]!.done, false)
  assert.equal(next.items[1]!.done, false)
  assert.equal(next, progress)
})

test("applyToolResult requires exact item.tool === tool", () => {
  const progress: RunProgress = {
    items: [
      item({ id: "a", text: "nav", source: "seed", tool: "navigate_page" }),
      item({ id: "b", text: "nav", source: "seed", tool: "Navigate" }),
      item({ id: "c", text: "nav", source: "seed", tool: "navigate" }),
    ],
  }
  const next = applyToolResult(progress, { tool: "navigate", success: true })
  assert.equal(next.items[0]!.done, false)
  assert.equal(next.items[1]!.done, false)
  assert.equal(next.items[2]!.done, true)
})

test("run_progress sanitize caps 8×120 and forces model_draft done=false", () => {
  const raw = {
    items: [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `i${i}`,
        text: "y".repeat(200),
        done: true,
        source: i === 0 ? "model_draft" : "seed",
      })),
      { id: "junk", text: "x", done: true, source: "llm" },
    ],
  }
  const s = sanitizeRunProgress(raw)
  assert.equal(s.items.length, 8)
  assert.equal(s.items[0]!.source, "model_draft")
  assert.equal(s.items[0]!.done, false)
  assert.ok(s.items.every((it) => it.text.length <= 120))
  assert.ok(s.items.every((it) => it.source === "seed" || it.source === "model_draft" || it.source === "user"))
})

test("thread-manager persist handoff.open_todos hydrates run_progress for ChatView", () => {
  const tm = new ThreadManager()
  const th = tm.create("run-progress-handoff-hydrate")
  const updated = tm.update(th.id, {
    runtime_context_budget: {
      last_at: new Date().toISOString(),
      mode: "h1",
      dropped_count: 0,
      tokens_before: 0,
      tokens_after: 0,
      handoff: {
        updated_at: new Date().toISOString(),
        goals: [],
        decisions: [],
        constraints: [],
        open_todos: [{ text: "打开已登录的页" }, { text: "摘前五条标题" }],
        artifacts: [],
      },
    },
  })
  assert.ok(updated?.run_progress)
  assert.equal(updated!.run_progress!.items.length, 2)
  assert.equal(updated!.run_progress!.items[0]!.text, "打开已登录的页")
  assert.equal(updated!.run_progress!.items[0]!.source, "seed")
  assert.equal(updated!.run_progress!.items[0]!.done, false)
  const got = tm.get(th.id)
  assert.equal(got!.run_progress!.items.length, 2)
})

test("#237 persist object todos hydrate run_progress.tool", () => {
  const tm = new ThreadManager()
  const th = tm.create("run-progress-object-todo-tool")
  const updated = tm.update(th.id, {
    runtime_context_budget: {
      last_at: new Date().toISOString(),
      mode: "h1",
      dropped_count: 0,
      tokens_before: 0,
      tokens_after: 0,
      handoff: {
        updated_at: new Date().toISOString(),
        goals: [],
        decisions: [],
        constraints: [],
        open_todos: [{ text: "打开页", tool: "navigate" }],
        artifacts: [],
      },
    },
  })
  assert.equal(updated!.run_progress!.items[0]!.tool, "navigate")
  assert.equal(updated!.run_progress!.items[0]!.text, "打开页")
  const got = tm.get(th.id)
  assert.equal(got!.run_progress!.items[0]!.tool, "navigate")
})

test("thread-manager does not overwrite existing run_progress when hydrating", () => {
  const tm = new ThreadManager()
  const th = tm.create("run-progress-no-clobber")
  tm.update(th.id, {
    run_progress: {
      items: [{ id: "keep", text: "already", done: true, source: "user" }],
    },
  })
  tm.update(th.id, {
    runtime_context_budget: {
      last_at: new Date().toISOString(),
      mode: "h1",
      dropped_count: 0,
      tokens_before: 0,
      tokens_after: 0,
      handoff: {
        updated_at: new Date().toISOString(),
        goals: [],
        decisions: [],
        constraints: [],
        open_todos: [{ text: "should-not-replace" }],
        artifacts: [],
      },
    },
  })
  const got = tm.get(th.id)
  assert.equal(got!.run_progress!.items.length, 1)
  assert.equal(got!.run_progress!.items[0]!.id, "keep")
})

test("thread-manager explicit run_progress clear (null) is sticky — never reseeded", () => {
  const tm = new ThreadManager()
  const th = tm.create("run-progress-clear-sticky")
  // Initial seed still works (run_progress never set + handoff has todos)
  const seeded = tm.update(th.id, {
    runtime_context_budget: {
      last_at: new Date().toISOString(),
      mode: "h1",
      dropped_count: 0,
      tokens_before: 0,
      tokens_after: 0,
      handoff: {
        updated_at: new Date().toISOString(),
        goals: [],
        decisions: [],
        constraints: [],
        open_todos: [{ text: "todo-would-reseed" }],
        artifacts: [],
      },
    },
  })
  assert.equal(seeded!.run_progress!.items.length, 1)
  // Explicit clear must win over the handoff reseed
  const cleared = tm.update(th.id, { run_progress: null })
  assert.equal(cleared!.run_progress, null)
  // Unrelated update must not resurrect the seed
  const unrelated = tm.update(th.id, { alias: "after-clear" })
  assert.equal(unrelated!.run_progress, null)
  // Read path must not re-hydrate a cleared thread either
  assert.equal(tm.get(th.id)!.run_progress, null)
  // null survives the index.json round-trip (undefined keys would drop out)
  const reloaded = new ThreadManager()
  assert.equal(reloaded.get(th.id)!.run_progress, null)
})

test("thread-manager caller-set empty run_progress is not reseeded by unrelated update", () => {
  const tm = new ThreadManager()
  const th = tm.create("run-progress-empty-no-reseed")
  tm.update(th.id, { run_progress: { items: [] } })
  tm.update(th.id, {
    runtime_context_budget: {
      last_at: new Date().toISOString(),
      mode: "h1",
      dropped_count: 0,
      tokens_before: 0,
      tokens_after: 0,
      handoff: {
        updated_at: new Date().toISOString(),
        goals: [],
        decisions: [],
        constraints: [],
        open_todos: [{ text: "should-not-fill-empty" }],
        artifacts: [],
      },
    },
  })
  const got = tm.get(th.id)
  assert.deepEqual(got!.run_progress, { items: [] })
})

test("thread-manager run_progress sanitize-on-read + cap", () => {
  const tm = new ThreadManager()
  const th = tm.create("run-progress-seed")
  tm.update(th.id, {
    run_progress: {
      items: [
        {
          id: "m",
          text: "z".repeat(300),
          done: true,
          source: "model_draft",
          tool: "navigate",
        },
        {
          id: "s",
          text: "ok",
          done: false,
          source: "seed",
          tool: "navigate",
        },
      ],
    },
  })
  const got = tm.get(th.id)
  assert.ok(got?.run_progress)
  assert.equal(got!.run_progress!.items[0]!.done, false)
  assert.ok(got!.run_progress!.items[0]!.text.length <= 120)
  assert.equal(got!.run_progress!.items[1]!.text, "ok")
})

function handoffThread(over: {
  run_progress?: RunProgress | null
  todos?: { text: string; tool?: string }[]
}) {
  return {
    run_progress: over.run_progress,
    runtime_context_budget: {
      handoff: {
        open_todos: over.todos ?? [{ text: "打开页", tool: "navigate" }],
      },
    },
  }
}

test("nextRunProgressAfterToolSuccess: null is sticky — does not reseed on tool tick", () => {
  const out = nextRunProgressAfterToolSuccess(
    handoffThread({ run_progress: null, todos: [{ text: "打开页", tool: "navigate" }] }),
    "navigate",
  )
  assert.equal(out, undefined)
})

test("nextRunProgressAfterToolSuccess: undefined seeds then ticks matching tool", () => {
  const out = nextRunProgressAfterToolSuccess(
    handoffThread({ todos: [{ text: "打开页", tool: "navigate" }] }),
    "navigate",
  )
  assert.ok(out)
  assert.equal(out!.items.length, 1)
  assert.equal(out!.items[0]!.done, true)
  assert.equal(out!.items[0]!.tool, "navigate")
})

test("nextRunProgressAfterToolSuccess: existing items tick without reseed", () => {
  const current: RunProgress = {
    items: [
      { id: "keep", text: "打开页", done: false, source: "seed", tool: "navigate" },
    ],
  }
  const out = nextRunProgressAfterToolSuccess(
    handoffThread({
      run_progress: current,
      todos: [{ text: "should-not-replace", tool: "navigate" }],
    }),
    "navigate",
  )
  assert.ok(out)
  assert.equal(out!.items[0]!.id, "keep")
  assert.equal(out!.items[0]!.done, true)
})

test("nextRunProgressAfterToolSuccess: existing items unmatched tool → no write", () => {
  const current: RunProgress = {
    items: [
      { id: "keep", text: "打开页", done: false, source: "seed", tool: "navigate" },
    ],
  }
  const out = nextRunProgressAfterToolSuccess(
    handoffThread({ run_progress: current }),
    "get_page_text",
  )
  assert.equal(out, undefined)
})

test("handleRunProgressToggle: null stays null (no empty-object coerce)", () => {
  const tm = new ThreadManager()
  const th = tm.create("run-progress-toggle-null")
  tm.update(th.id, { run_progress: null })
  const r = handleRunProgressToggle({ thread_id: th.id, item_id: "x" }, tm)
  assert.equal(r.type, "thread.updated")
  assert.equal(tm.get(th.id)!.run_progress, null)
})

test("adapter source: nextRunProgressAfterToolSuccess on toolResult.success send, not abort/parse/validation", () => {
  const src = readSrc("llm", "adapter.ts")
  assert.match(src, /from ["']\.\.\/threads\/run-progress["']/)
  assert.match(src, /nextRunProgressAfterToolSuccess/)

  function windowAfter(marker: string, size = 900): string {
    const i = src.indexOf(marker)
    assert.ok(i >= 0, `missing marker: ${marker}`)
    return src.slice(i, i + size)
  }

  assert.doesNotMatch(windowAfter("function persistInterruptedRemainder"), /nextRunProgressAfterToolSuccess/)
  assert.doesNotMatch(windowAfter("Invalid JSON in tool arguments"), /nextRunProgressAfterToolSuccess/)
  assert.doesNotMatch(windowAfter("llm.tool_arg_validation_failed"), /nextRunProgressAfterToolSuccess/)

  const afterSend = windowAfter("Send tool result to extension for UI display", 1600)
  assert.match(afterSend, /toolResult\.success/)
  assert.match(afterSend, /nextRunProgressAfterToolSuccess/)
  assert.doesNotMatch(afterSend, /seedRunProgress/)
  assert.doesNotMatch(afterSend, /applyToolResult/)
})

test("userToggle flips seed/user done (toggle) and is a no-op on model_draft", () => {
  const rp = require("../src/threads/run-progress") as typeof import("../src/threads/run-progress") & {
    userToggle?: (progress: RunProgress, itemId: string) => RunProgress
  }
  assert.equal(typeof rp.userToggle, "function", "userToggle must exist on run-progress")
  const progress: RunProgress = {
    items: [
      item({ id: "s", text: "seed", source: "seed", done: false }),
      item({ id: "u", text: "user", source: "user", done: true }),
      item({ id: "d", text: "draft", source: "model_draft", done: false }),
    ],
  }
  const t1 = rp.userToggle!(progress, "s")
  assert.equal(t1.items[0]!.done, true)
  assert.equal(t1.items[1]!.done, true)
  const t2 = rp.userToggle!(t1, "u")
  assert.equal(t2.items[1]!.done, false)
  const t3 = rp.userToggle!(t2, "d")
  assert.equal(t3.items[2]!.done, false)
  assert.equal(t3.items[2]!.source, "model_draft")
  const missing = rp.userToggle!(progress, "nope")
  assert.equal(missing, progress)
})

test("validate thread.run_progress.toggle requires thread_id and item_id", () => {
  assert.equal(
    validateWsMessage({ type: "thread.run_progress.toggle", thread_id: "t1", item_id: "i1" }).valid,
    true,
  )
  const missingItem = validateWsMessage({ type: "thread.run_progress.toggle", thread_id: "t1" })
  assert.equal(missingItem.valid, false)
  assert.match(String(missingItem.error), /item_id/)
  const missingThread = validateWsMessage({ type: "thread.run_progress.toggle", item_id: "i1" })
  assert.equal(missingThread.valid, false)
  assert.match(String(missingThread.error), /thread_id/)
  assert.equal(
    validateWsMessage({ type: "thread.run_progress.toggle", thread_id: "", item_id: "i1" }).valid,
    false,
  )
})

test("message-router thread.run_progress.toggle flips item and returns thread.updated", async () => {
  const tm = new ThreadManager()
  const th = tm.create("run-progress-toggle")
  tm.update(th.id, {
    run_progress: {
      items: [item({ id: "seed:0", text: "navigate", source: "seed", done: false, tool: "navigate" })],
    },
  })
  const response = await handleMessage(
    { type: "thread.run_progress.toggle", thread_id: th.id, item_id: "seed:0" },
    { threadManager: tm, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )
  assert.equal(response.type, "thread.updated")
  assert.equal(response.thread.run_progress.items[0].done, true)
  const again = await handleMessage(
    { type: "thread.run_progress.toggle", thread_id: th.id, item_id: "seed:0" },
    { threadManager: tm, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )
  assert.equal(again.thread.run_progress.items[0].done, false)
})

test("message-router thread.run_progress.toggle errors on missing thread", async () => {
  const tm = new ThreadManager()
  const response = await handleMessage(
    { type: "thread.run_progress.toggle", thread_id: "missing", item_id: "x" },
    { threadManager: tm, skillEngine: mockSkillEngine, historyStore: mockHistoryStore },
  )
  assert.equal(response.type, "error")
  assert.match(String(response.error), /not found/i)
})

test("summoner surface thread.run_progress.toggle is denied SUMMONER_ACL", () => {
  const r = assertSummonerAllowed("summoner", "thread.run_progress.toggle")
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "SUMMONER_ACL")
  assert.match(r.error, /thread\.run_progress\.toggle/)
  assert.equal(assertSummonerAllowed("tray", "thread.run_progress.toggle").ok, true)
})

test("thread.run_progress.toggle is not on overlay allowlists or thread.update keys", () => {
  const acl = readSrc("ws", "summoner-acl.ts")
  const allowBlock = acl.slice(acl.indexOf("const SUMMONER_ALLOW"), acl.indexOf("export function assertSummonerAllowed"))
  assert.doesNotMatch(allowBlock, /thread\.run_progress\.toggle/)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("thread.run_progress.toggle"), false)

  const routerSrc = readSrc("message-router.ts")
  const m = routerSrc.match(/case "thread\.update":[\s\S]*?for \(const key of \[([\s\S]*?)\]\)/)
  assert.ok(m, "thread.update allowlist not found")
  assert.doesNotMatch(m![1], /run_progress/)
})
