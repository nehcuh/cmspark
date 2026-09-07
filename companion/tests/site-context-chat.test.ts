import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { siteTargetFromBrowser } from "../src/site-context/target"
import { recordSiteOpFailure, peekSiteOpBan } from "../src/tool/site-op-memory"
import { siteExperienceIdentity } from "../src/skills/site-experience-identity"

for (const initialTab of [123, undefined]) {
test(`real chat loop refreshes site knowledge and experience (initial tab ${initialTab ?? "legacy hint"})`, async () => {
  const root = mkdtempSync(join(tmpdir(), "cmspark-context-chat-"))
  const previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = root
  let proto: any, original: any
  try {
    const { initDataDir } = await import("../src/config")
    await initDataDir()
    const { SkillEngine } = await import("../src/skills/skill-engine")
    const { ThreadManager } = await import("../src/threads/thread-manager")
    const { chatCreate } = await import("../src/llm/adapter")
    const { default: OpenAI } = await import("openai")
    const manager = new ThreadManager()
    const thread = manager.create("cross site", `context-chat-${initialTab ?? "legacy"}`)
    const engine = new SkillEngine()
    engine.bindThreadManager(manager)
    const dir = join(root, "skills")
    mkdirSync(dir, { recursive: true })
    for (const [name, host, marker] of [["site-a", "a.test", "SITE_A_451"], ["site-b", "b.test", "SITE_B_451"], ["manual-c", "c.test", "MANUAL_C_451"]]) {
      engine.createExperienceSkill(name, "site_knowledge", host, ["manual"], {
        id: name, category: "tip", content: marker, recorded_at: new Date().toISOString(),
        confirmed_at: null, stale: false, stale_reason: "", replaced_by: "",
      })
    }
    const persistedId = siteExperienceIdentity("https://b.test").id
    engine.createExperienceSkill(persistedId, "site_knowledge", "b.test", ["auto", "site-op-memory"], {
      id: "persisted", category: "tip", content: "[auto] DO NOT retry click text:PERSISTED_451 on https://b.test: last ELEMENT_NOT_FOUND",
      recorded_at: new Date().toISOString(), confirmed_at: null, stale: false, stale_reason: "", replaced_by: "", schema_version: 1,
    })
    engine.refresh()
    manager.update(thread.id, { active_knowledge_ids: ["manual-c"], knowledge_selection_mode: "auto" })
    // Match the router's real cache producer (includes initial site knowledge).
    const initialSkills = await engine.resolveSkillIdsForThread(thread.id, "auto", "inspect", "a.test")
    assert.ok(initialSkills.includes("site-a"))
    for (let i = 0; i < 2; i++) recordSiteOpFailure(thread.id, "click", { tabId: 123, text: "SECRET_LOCATOR_451" }, "ELEMENT_NOT_FOUND", "https://a.test")
    const steps = [
      { name: "run_progress_propose", args: { items: [{ text: "read the pages" }] } },
      { name: "get_page_text", args: { tabId: 999 } },
      { name: "navigate", args: { tabId: 123, url: "https://b.test/next" } },
      { name: "get_page_text", args: { tabId: 123 } },
    ]
    const requests: string[] = []
    proto = Object.getPrototypeOf(new OpenAI({ baseURL: "http://localhost:9999", apiKey: "test" }).chat.completions)
    original = proto.create
    proto.create = async (params: any) => {
      requests.push(String(params.messages.find((m: any) => m.role === "system")?.content || ""))
      const step = steps.shift()
      return (async function* () {
        yield { choices: [{ delta: step ? { tool_calls: [{ index: 0, id: `call-${requests.length}`, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } : { content: "done" } }] }
        yield { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }
      })()
    }
    let actualUrl: string | undefined = "https://a.test/start"
    await chatCreate({
      threadId: thread.id, message: "inspect", skillIds: [], knowledgeIds: [],
      siteContextTabId: initialTab, hostname: "a.test",
      contextSelection: { kind: "thread", skillMode: "auto", knowledgeMode: "auto", cachedMatchedSkillIds: initialSkills },
      resolveSiteTarget: async (id: number) => { assert.equal(id, 123); return siteTargetFromBrowser(id, actualUrl, Date.now()) },
      config: { base_url: "http://localhost:9999", api_key: "test", model_name: "test", temperature: 0, context_window: 128000 },
      threadManager: manager, skillEngine: engine, historyStore: { record: () => 0 } as any,
      sendToExtension: () => {},
      executeTool: async (_id: string, name: string, args: any) => {
        if (name === "run_progress_propose") return { success: true, data: { items: [{ text: "read the pages" }] } }
        if (args.tabId === 999) return { success: false, error: "TAB_LOCKED", data: { error_code: "TAB_LOCKED" } }
        if (name === "navigate") { actualUrl = "https://b.test/next"; return { success: true } }
        assert.equal(name, "get_page_text")
        assert.ok(peekSiteOpBan(thread.id, "click", { tabId: 123, text: "PERSISTED_451" }, "https://b.test").banned,
          "successful target discovery must restore selected persisted experience, including legacy clients")
        rmSync(join(dir, "site-b.md"))
        engine.refresh()
        actualUrl = undefined
        return { success: true, data: { text: "page" } }
      },
    } as any)
    assert.equal(requests.length, 5)
    assert.ok(requests[0].includes("SITE_A_451"))
    assert.ok(!requests[0].includes("SITE_B_451"))
    assert.equal(requests[0].includes("SECRET_LOCATOR_451"), initialTab !== undefined)
    assert.ok(requests[2].includes("SITE_A_451"), "failed tab must not retarget context")
    assert.ok(requests[3].includes("SITE_B_451"))
    assert.ok(!requests[3].includes("SITE_A_451"), "cached router union must not preserve old site knowledge")
    assert.ok(!requests[4].includes("SITE_B_451"))
    assert.ok(!requests[4].includes("SITE_A_451"))
    assert.ok(!requests[4].includes("SECRET_LOCATOR_451"), "unavailable target must not project all-origin experience")
    for (const prompt of requests) {
      assert.ok(prompt.includes("MANUAL_C_451"))
      assert.ok(prompt.includes("SECURITY FOOTER (non-overrideable)"))
    }
  } finally {
    if (proto && original) proto.create = original
    if (previous === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = previous
    rmSync(root, { recursive: true, force: true })
  }
})
}
