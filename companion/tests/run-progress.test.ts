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
  sanitizeRunProgress,
  seedRunProgress,
  type RunProgress,
  type RunProgressItem,
} from "../src/threads/run-progress"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-run-progress-"))
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

test("adapter source: applyToolResult on toolResult.success send, not abort/parse/validation", () => {
  const src = readSrc("llm", "adapter.ts")
  assert.match(src, /from ["']\.\.\/threads\/run-progress["']/)
  assert.match(src, /applyToolResult\(/)

  function windowAfter(marker: string, size = 900): string {
    const i = src.indexOf(marker)
    assert.ok(i >= 0, `missing marker: ${marker}`)
    return src.slice(i, i + size)
  }

  assert.doesNotMatch(windowAfter("function persistInterruptedRemainder"), /applyToolResult/)
  assert.doesNotMatch(windowAfter("Invalid JSON in tool arguments"), /applyToolResult/)
  assert.doesNotMatch(windowAfter("llm.tool_arg_validation_failed"), /applyToolResult/)

  const afterSend = windowAfter("Send tool result to extension for UI display", 1600)
  assert.match(afterSend, /toolResult\.success/)
  assert.match(afterSend, /applyToolResult/)
})
