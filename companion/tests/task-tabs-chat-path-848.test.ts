import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { CanonicalStreamEvent } from "../src/llm/provider"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-task-tabs-chat-"))
process.env.CMSPARK_DATA_DIR = root
process.env.HOME = root

test("actual chatCreate finalization closes a captured task tab through its normal executor", async () => {
  const { initDataDir } = await import("../src/config"); await initDataDir()
  const { chatCreate } = await import("../src/llm/adapter")
  const { ThreadManager } = await import("../src/threads/thread-manager")
  const { SkillEngine } = await import("../src/skills/skill-engine")
  const { OpenAIProvider } = await import("../src/llm/providers/openai")
  const { captureLocalPageResult } = await import("../src/business-evidence/executor")
  const { readBrowserSources } = await import("../src/business-evidence/task-pages")
  const originalStream = OpenAIProvider.prototype.streamChat, originalComplete = OpenAIProvider.prototype.complete
  const tm = new ThreadManager(), thread = tm.create("single source")
  tm.update(thread.id, { agent_role: "worker", parent_thread_id: "synthetic-parent" })
  let round = 0, closed = 0
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/task-tabs-848.json"), "utf8"))
  OpenAIProvider.prototype.complete = async () => ({ content: "source" })
  OpenAIProvider.prototype.streamChat = async function* (): AsyncIterable<CanonicalStreamEvent> {
    round++
    if (round < 3) yield { type: "tool_call_delta", index: 0, id: "call-" + round,
      name: round === 1 ? "create_tab" : "get_page_text",
      arguments: JSON.stringify(round === 1 ? { url: "https://example.test/source", active: false } : { tabId: 7 }) }
    else yield { type: "token", text: "已读取来源" }
    yield { type: "done", finish_reason: round < 3 ? "tool_calls" : "stop" }
  }
  try {
    await chatCreate({ threadId: thread.id, message: "读取这个来源", skillIds: [],
      config: { base_url: "http://localhost:9999", api_key: "fixture", model_name: "fixture", temperature: 0, context_window: 32000, context_compaction: "off" },
      threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: async () => 0 } as any,
      sendToExtension: () => {}, executeTool: async (id, name, args) => {
        if (name === "create_tab") return structuredClone(fixture.create)
        if (name === "get_page_text") return captureLocalPageResult(root, { kind: "chat", threadId: thread.id }, id, name, structuredClone(fixture.read))
        if (name === "close_tab") {
          assert.equal(args.__task_tab_cleanup.automatic, true)
          assert.equal(readBrowserSources(root, { kind: "chat", threadId: thread.id }).data.sources[0].state, "closing")
          closed++; return structuredClone(fixture.close)
        }
        throw Error("unexpected executor " + name)
      } })
    assert.equal(closed, 1)
    assert.equal(readBrowserSources(root, { kind: "chat", threadId: thread.id }).data.sources[0].state, "closed")
    assert.equal(tm.get(thread.id)?.last_run_terminal, null)
  } finally {
    OpenAIProvider.prototype.streamChat = originalStream; OpenAIProvider.prototype.complete = originalComplete
    fs.rmSync(root, { recursive: true, force: true })
  }
})
