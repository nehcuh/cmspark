/**
 * #502 B acceptance — the archive tier must not break the things the persisted
 * tool ROW is load-bearing for.
 *
 * Task 1/3 unit tests cover the payload shape. This file proves the invariants a
 * shape test cannot see, against a real ThreadManager writing real thread JSON:
 *
 *  1. a new thread's disk file has NO page body, but DOES have the tool row;
 *  2. rebuildMessagesFromHistory still pairs assistant.tool_calls → tool result
 *     (the #255 amnesia failure mode is a stripped tool_calls + the literal
 *     "(tool call failed)" fallback — never an acceptable trade for a stub);
 *  3. entry heal does not invent an INTERRUPTED filler for a paired call;
 *  4. the INTERRUPTED supersede-race contract survives: a filler written while
 *     compacted is still findable and replaceable by the real result;
 *  5. pre-existing thread files are NOT rewritten (no retroactive migration).
 */
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-archive-accept-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let createToolResultMessage: typeof import("../src/llm/tool-batch-heal").createToolResultMessage
let persistHealedToolRows: typeof import("../src/llm/tool-batch-heal").persistHealedToolRows
let replaceInterruptedFillerIfPresent: typeof import("../src/llm/tool-batch-heal").replaceInterruptedFillerIfPresent
let buildInterruptedDiskRow: typeof import("../src/llm/tool-batch-heal").buildInterruptedDiskRow
let rebuildMessagesFromHistory: typeof import("../src/llm/adapter").rebuildMessagesFromHistory
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let saveConfig: typeof import("../src/config").saveConfig
let initDataDir: typeof import("../src/config").initDataDir

const PAGE_BODY = "PAGE_BODY_SHOULD_NOT_BE_ARCHIVED " + "content ".repeat(200)

before(async () => {
  const config = await import("../src/config")
  saveConfig = config.saveConfig
  initDataDir = config.initDataDir
  await initDataDir()
  const heal = await import("../src/llm/tool-batch-heal")
  createToolResultMessage = heal.createToolResultMessage
  persistHealedToolRows = heal.persistHealedToolRows
  replaceInterruptedFillerIfPresent = heal.replaceInterruptedFillerIfPresent
  buildInterruptedDiskRow = heal.buildInterruptedDiskRow
  rebuildMessagesFromHistory = (await import("../src/llm/adapter")).rebuildMessagesFromHistory
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
})

after(() => {
  try {
    fs.rmSync(tempHome, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

beforeEach(() => {
  saveConfig({ persist_full_tool_history: false })
})

function diskText(threadId: string): string {
  return fs.readFileSync(
    path.join(process.env.CMSPARK_DATA_DIR!, "threads", `${threadId}.json`),
    "utf8",
  )
}

/** A thread whose assistant called get_page_text and got a real (large) result. */
function seedPageReadThread(tm: InstanceType<typeof ThreadManager>) {
  const thread = tm.create("acceptance page read", `acc-${Math.random().toString(36).slice(2, 8)}`)
  tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "read the page" })
  const assistant = tm.addMessage(thread.id, {
    thread_id: thread.id,
    role: "assistant",
    content: "reading",
    tool_calls: [{ id: "call_pg_1", function: { name: "get_page_text", arguments: '{"tabId":7}' } }],
  })
  tm.addMessage(
    thread.id,
    createToolResultMessage(
      thread.id,
      { id: "call_pg_1", function: { name: "get_page_text" } },
      { success: true, data: { text: PAGE_BODY } },
      { tabId: 7 },
    ) as any,
  )
  return { thread, assistantId: assistant.id }
}

test("acceptance 1: new thread disk has the tool row but no page body", () => {
  const tm = new ThreadManager()
  const { thread } = seedPageReadThread(tm)
  const disk = diskText(thread.id)
  assert.equal(disk.includes("PAGE_BODY_SHOULD_NOT_BE_ARCHIVED"), false, "page body reached disk")
  const parsed = JSON.parse(disk)
  const toolRows = parsed.messages.filter((m: any) => m.role === "tool")
  assert.equal(toolRows.length, 1, "the tool ROW must survive (rebuild pairing)")
  assert.equal(toolRows[0].tool_calls[0].id, "call_pg_1")
  assert.equal(toolRows[0].tool_calls[0].tool_name, "get_page_text")
  assert.equal(toolRows[0].tool_calls[0].result.redacted, true)
})

test("acceptance 2: rebuild still pairs the call — no '(tool call failed)' amnesia", () => {
  const tm = new ThreadManager()
  const { thread } = seedPageReadThread(tm)
  const rebuilt = rebuildMessagesFromHistory(tm.getMessages(thread.id) as any)
  const assistant = rebuilt.find((m) => m.role === "assistant" && (m as any).tool_calls?.length)
  assert.ok(assistant, "assistant tool_calls were stripped — exactly the #255 amnesia failure")
  assert.equal((assistant as any).tool_calls[0].id, "call_pg_1")
  const tool = rebuilt.find((m) => m.role === "tool")
  assert.ok(tool, "tool result missing from the rebuilt payload")
  assert.match(String((tool as any).content), /redacted/)
  assert.equal(
    rebuilt.some((m) => typeof (m as any).content === "string" && (m as any).content.includes("(tool call failed)")),
    false,
    "a compacted row must never degrade into a fake tool failure",
  )
})

test("acceptance 3: entry heal invents no INTERRUPTED filler for a paired call", () => {
  const tm = new ThreadManager()
  const { thread } = seedPageReadThread(tm)
  const healed = persistHealedToolRows(tm, thread.id)
  assert.equal(healed, 0, "paired call must not be healed")
  const disk = diskText(thread.id)
  assert.equal(disk.includes("INTERRUPTED"), false)
  assert.equal(disk.includes("interrupted"), false)
})

test("acceptance 4: a compacted INTERRUPTED filler is still replaceable (supersede race)", () => {
  const tm = new ThreadManager()
  const thread = tm.create("acceptance supersede", "acc-supersede")
  tm.addMessage(thread.id, {
    thread_id: thread.id,
    role: "assistant",
    content: "reading",
    tool_calls: [{ id: "call_race", function: { name: "get_page_text", arguments: "{}" } }],
  })
  // Filler written by the successor run's entry heal (compacted tier).
  tm.addMessage(thread.id, buildInterruptedDiskRow(thread.id, {
    id: "call_race",
    toolName: "get_page_text",
    args: "{}",
  }) as any)
  const filler = tm.getMessages(thread.id).find((m) => m.role === "tool") as any
  assert.equal(filler.tool_calls[0].result.error_code, "INTERRUPTED")

  // The old run's real result lands late: it must find and replace the filler.
  const realRow = createToolResultMessage(
    thread.id,
    { id: "call_race", function: { name: "get_page_text" } },
    { success: true, data: { text: "late real result" } },
  )
  const replaced = replaceInterruptedFillerIfPresent(tm, thread.id, "call_race", realRow)
  assert.equal(replaced, true, "filler must stay findable — collapsing it would append an orphan")
  const rows = tm.getMessages(thread.id).filter((m) => m.role === "tool")
  assert.equal(rows.length, 1, "replace must not append a duplicate row")
})

test("acceptance 5: cookie values never reach disk, either tier", () => {
  const secret = "COOKIE_VALUE_ON_DISK_DO_NOT_PERSIST"
  for (const full of [false, true]) {
    saveConfig({ persist_full_tool_history: full })
    const tm = new ThreadManager()
    const thread = tm.create(`acceptance cookie ${full}`, `acc-cookie-${full}`)
    tm.addMessage(thread.id, {
      thread_id: thread.id,
      role: "assistant",
      content: "c",
      tool_calls: [{ id: "call_ck", function: { name: "set_cookie", arguments: "{}" } }],
    })
    tm.addMessage(
      thread.id,
      createToolResultMessage(
        thread.id,
        { id: "call_ck", function: { name: "set_cookie" } },
        { success: true, data: { name: "sid", domain: "example.com", value: secret } },
        { name: "sid", value: secret },
      ) as any,
    )
    assert.equal(
      diskText(thread.id).includes(secret),
      false,
      `cookie value reached threads/*.json (persist_full_tool_history=${full})`,
    )
  }
})

test("acceptance 6: existing thread files are not retroactively rewritten", () => {
  const tm = new ThreadManager()
  const thread = tm.create("acceptance legacy", "acc-legacy")
  // A pre-#502 file: full body, written directly (as the old build would have).
  const legacyPath = path.join(process.env.CMSPARK_DATA_DIR!, "threads", `${thread.id}.json`)
  const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"))
  legacy.messages = [
    { id: "m1", thread_id: thread.id, role: "user", content: "read", created_at: new Date().toISOString() },
    {
      id: "m2",
      thread_id: thread.id,
      role: "assistant",
      content: "ok",
      created_at: new Date().toISOString(),
      tool_calls: [{ id: "call_old", function: { name: "get_page_text", arguments: "{}" } }],
    },
    {
      id: "m3",
      thread_id: thread.id,
      role: "tool",
      content: JSON.stringify({ success: true, data: { text: "LEGACY_BODY_STAYS" } }),
      created_at: new Date().toISOString(),
      tool_calls: [
        {
          id: "call_old",
          tool_name: "get_page_text",
          params: { tabId: 1 },
          result: { success: true, data: { text: "LEGACY_BODY_STAYS" } },
        },
      ],
    },
  ]
  fs.writeFileSync(legacyPath, JSON.stringify(legacy, null, 2))

  // Reading the thread must not migrate/rewrite history.
  const reread = new ThreadManager()
  reread.get(thread.id)
  reread.getMessages(thread.id)
  assert.equal(
    diskText(thread.id).includes("LEGACY_BODY_STAYS"),
    true,
    "existing thread JSON must not be retroactively compacted",
  )
})
