/**
 * #430 × #504: content-risk quarantine must rewrite the live mirror,
 * otherwise same-process continue re-feeds the banned body.
 */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-cr-live-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let quarantinePersistedToolRow: typeof import("../src/llm/adapter").quarantinePersistedToolRow
let rebuildMessagesFromHistory: typeof import("../src/llm/adapter").rebuildMessagesFromHistory
let archiveToolPayload: typeof import("../src/security/tool-persistence-redact").archiveToolPayload

before(async () => {
  const config = await import("../src/config")
  await config.initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  const adapter = await import("../src/llm/adapter")
  quarantinePersistedToolRow = adapter.quarantinePersistedToolRow
  rebuildMessagesFromHistory = adapter.rebuildMessagesFromHistory
  archiveToolPayload = (await import("../src/security/tool-persistence-redact")).archiveToolPayload
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("#X8 quarantine rewrites live mirror so rebuild does not re-send the body", () => {
  const tm = new ThreadManager()
  const th = tm.create("cr-live")
  const banned = { success: true, data: { text: "BANNED-PAYLOAD-".repeat(40) } }
  tm.addMessage(th.id, {
    id: "asst-1",
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "tc-risk",
        type: "function",
        function: { name: "get_page_text", arguments: "{}" },
      },
    ],
  } as any)
  tm.addMessage(th.id, {
    id: "tool-1",
    role: "tool",
    content: JSON.stringify(banned),
    tool_calls: [{ id: "tc-risk", tool_name: "get_page_text", result: banned }],
  } as any)
  tm.rememberLiveToolResult(th.id, "tc-risk", { result: banned, tool_name: "get_page_text" })

  const ok = quarantinePersistedToolRow(tm, th.id, "tc-risk", JSON.stringify(banned))
  assert.equal(ok, true)
  const live = tm.getLiveMirror(th.id)?.toolResults.get("tc-risk")
  assert.equal((live?.result as any)?.quarantined, true)

  const rebuilt = rebuildMessagesFromHistory(tm.getMessages(th.id), tm.getLiveMirror(th.id))
  const toolMsg = rebuilt.find((m) => m.role === "tool")
  assert.ok(toolMsg)
  assert.doesNotMatch(String(toolMsg?.content), /BANNED-PAYLOAD/)
  assert.match(String(toolMsg?.content), /quarantined|content.risk|已移除|风控/i)
})

test("#X2 default archive stub carries omission=archive", () => {
  const { result } = archiveToolPayload(
    "navigate",
    { url: "https://example.com" },
    { success: true, data: { ok: true } },
    false,
  )
  assert.equal((result as any).omission, "archive")
  assert.equal((result as any).redacted, true)
})
