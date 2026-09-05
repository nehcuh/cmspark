/**
 * #358 — origin-level failure aggregation auto-persists a site experience.
 *
 * End-to-end through chatCreate with a stubbed LLM stream:
 *  - rounds 1..4 issue CDP tool calls that fail (ELEMENT_NOT_FOUND) with a
 *    DIFFERENT tool name and locator each round (mirrors thread hgrsix where
 *    locator-level bans never fire) on the same origin https://x.com
 *  - the 4th failure must auto-persist an experience entry via skillEngine
 *    marked [auto] (tags: site-op-memory, auto)
 *  - a NEW thread on the same origin hydrates the persisted entry:
 *    machine ban refuses the exact persisted locator (SITE_OP_BANNED without
 *    dispatching to executeTool) and formatSiteOpMemoryPrompt surfaces it
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-autoexp-"))

let chatCreate: typeof import("../src/llm/adapter").chatCreate
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let resetSiteOpMemoryForTests: typeof import("../src/tool/site-op-memory").resetSiteOpMemoryForTests
let formatSiteOpMemoryPrompt: typeof import("../src/tool/site-op-memory").formatSiteOpMemoryPrompt
let applyTabNavigated: typeof import("../src/ws/tab-url-cache").applyTabNavigated
let clearTabUrlCacheForTests: typeof import("../src/ws/tab-url-cache").clearTabUrlCacheForTests

const logEvents: Array<{ level: string; event: string; data: Record<string, unknown> }> = []

let completionsProto: any = undefined
let originalCreate: any = undefined
/** Per-round scripted assistant responses; index = LLM round within current test. */
let roundScript: Array<{ tool?: { name: string; args: Record<string, unknown> }; content?: string }> = []

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
  delete process.env.DEEPSEEK_API_KEY

  const adapter = await import("../src/llm/adapter")
  const threadManager = await import("../src/threads/thread-manager")
  const config = await import("../src/config")
  const skillEngine = await import("../src/skills/skill-engine")
  const siteOp = await import("../src/tool/site-op-memory")
  const tabUrlCache = await import("../src/ws/tab-url-cache")

  chatCreate = adapter.chatCreate
  ThreadManager = threadManager.ThreadManager
  SkillEngine = skillEngine.SkillEngine
  resetSiteOpMemoryForTests = siteOp.resetSiteOpMemoryForTests
  formatSiteOpMemoryPrompt = siteOp.formatSiteOpMemoryPrompt
  applyTabNavigated = tabUrlCache.applyTabNavigated
  clearTabUrlCacheForTests = tabUrlCache.clearTabUrlCacheForTests

  await config.initDataDir()

  const loggerMod = await import("../src/logger")
  for (const lvl of ["info", "warn", "error"] as const) {
    const orig = loggerMod.logger[lvl].bind(loggerMod.logger)
    ;(loggerMod.logger as any)[lvl] = (event: string, data?: Record<string, unknown>, source?: string) => {
      logEvents.push({ level: lvl, event, data: data || {} })
      orig(event, data, source)
    }
  }

  const openaiMod = await import("openai")
  const OpenAI = (openaiMod as any).default || openaiMod
  const dummyClient = new OpenAI({ baseURL: "http://localhost:9999", apiKey: "sk-test" })
  completionsProto = Object.getPrototypeOf(dummyClient.chat.completions)
  originalCreate = completionsProto.create
  completionsProto.create = async function (params: any, _options?: any) {
    const round = roundScript.shift() ?? { content: "done" }
    const tool = round.tool
    if (tool) {
      const gen = (async function* () {
        yield {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: `call_${Math.random().toString(36).slice(2, 10)}`,
                type: "function",
                function: { name: tool.name, arguments: JSON.stringify(tool.args) },
              }],
            },
          }],
        }
        yield { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }
      })()
      return params.stream ? gen : (await gen.next()).value
    }
    const gen = (async function* () {
      yield { choices: [{ delta: { content: round.content ?? "done" } }] }
      yield { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }
    })()
    return params.stream ? gen : (await gen.next()).value
  }
})

after(() => {
  if (completionsProto && originalCreate) completionsProto.create = originalCreate
  fs.rmSync(tempHome, { recursive: true, force: true })
})

const ORIGIN = "https://x.com"

function buildParams(opts: {
  threadId: string
  skillEngine: InstanceType<typeof SkillEngine>
  manager: InstanceType<typeof ThreadManager>
  hostname?: string
  executeTool: (id: string, name: string, params: any) => Promise<any>
}) {
  return {
    threadId: opts.threadId,
    message: "bookmark this",
    skillIds: [],
    hostname: opts.hostname,
    config: {
      base_url: "http://localhost:9999",
      api_key: "sk-test",
      model_name: "test-model",
      temperature: 0.5,
      context_window: 4000,
    },
    threadManager: opts.manager,
    skillEngine: opts.skillEngine,
    historyStore: { record: () => 0 } as any,
    sendToExtension: (_data: any) => {},
    executeTool: opts.executeTool,
  } as any
}

const failResult = { success: false, error: "ELEMENT_NOT_FOUND: no node matched", data: { error_code: "ELEMENT_NOT_FOUND" } }

// Fresh threads carry an (empty) live plan — page tools are gated behind a
// successful run_progress_propose this request. Serve it from the stub.
const proposeOk = { success: true, data: { items: [{ text: "bookmark this page" }] } }
const proposeRound = { tool: { name: "run_progress_propose", args: { items: [{ text: "bookmark this page" }] } } }
const stubExecuteTool = async (_id: string, name: string) => (name === "run_progress_propose" ? proposeOk : { ...failResult })

test("4 origin failures (distinct tools+locators) auto-persist an [auto] experience", async () => {
  resetSiteOpMemoryForTests()
  clearTabUrlCacheForTests()
  applyTabNavigated(101, `${ORIGIN}/i/bookmarks`)
  logEvents.length = 0
  roundScript = [
    proposeRound,
    { tool: { name: "click", args: { tabId: 101, text: "收藏" } } },
    { tool: { name: "get_element_info", args: { tabId: 101, selector: "[data-testid='bookmark']" } } },
    { tool: { name: "type", args: { tabId: 101, text: "搜索", value: "搜索" } } },
    { tool: { name: "hover", args: { tabId: 101, selector: "a.ProfileCard" } } },
    { content: "given up" },
  ]

  const manager = new ThreadManager()
  const se = new SkillEngine()
  const thread = manager.create("auto persist", "test-autoexp-01")
  await chatCreate(buildParams({
    threadId: thread.id,
    skillEngine: se,
    manager,
    executeTool: stubExecuteTool,
  }))

  const persisted = logEvents.filter(e => e.event === "site_op.auto_experience_persisted")
  assert.equal(persisted.length, 1, "exactly one auto persist on the 4th origin failure")
  assert.ok((persisted[0].data.lines as number) >= 4, "MAJOR-3: persist covers every failed path, not just the 4th")

  const skill = se.get("x-com")
  assert.ok(skill, "site experience skill x-com must exist")
  assert.equal(skill.type, "site_knowledge")
  assert.ok(skill.tags?.includes("auto"), "tags must mark auto origin")
  assert.ok(skill.tags?.includes("site-op-memory"))
  const autoEntries = (skill.entries || []).filter(e => e.content.startsWith("[auto] DO NOT retry"))
  // MAJOR-3 (hgrsix form): each round failed a DIFFERENT locator — all of them
  // must survive into the skill so a new session blocks the earliest paths too.
  for (const frag of [
    "click text:收藏",
    "get_element_info css:[data-testid='bookmark']",
    "type text:搜索",
    "hover css:a.ProfileCard",
  ]) {
    assert.ok(autoEntries.some(e => e.content.includes(frag)), `missing persisted failed path: ${frag}`)
  }
  const entry = autoEntries[0]
  assert.match(entry!.id, /^auto-/)
  assert.equal(entry!.category, "problem")
  assert.match(entry!.content, /on https:\/\/x\.com: last ELEMENT_NOT_FOUND/)
  // LLM free text never lands: content is the machine template, not the model reply
  assert.doesNotMatch(entry!.content, /given up|bookmark this/)
})

test("3 origin failures persist nothing", async () => {
  resetSiteOpMemoryForTests()
  clearTabUrlCacheForTests()
  // distinct origin so persisted state from the previous test cannot collide
  applyTabNavigated(101, "https://y.com/home")
  logEvents.length = 0
  roundScript = [
    proposeRound,
    { tool: { name: "click", args: { tabId: 101, text: "a1" } } },
    { tool: { name: "type", args: { tabId: 101, text: "b2", value: "b2" } } },
    { tool: { name: "hover", args: { tabId: 101, text: "c3" } } },
    { content: "done" },
  ]

  const manager = new ThreadManager()
  const se = new SkillEngine()
  const thread = manager.create("under threshold", "test-autoexp-02")
  await chatCreate(buildParams({
    threadId: thread.id,
    skillEngine: se,
    manager,
    executeTool: stubExecuteTool,
  }))

  assert.equal(logEvents.filter(e => e.event === "site_op.auto_experience_persisted").length, 0)
  assert.equal(se.get("y-com"), undefined)
})

test("NEW thread on same origin: hydrated machine ban refuses persisted locator (no dispatch)", async () => {
  resetSiteOpMemoryForTests()
  // seed persisted experience directly through the same engine channel
  const manager = new ThreadManager()
  const se = new SkillEngine()
  se.createExperienceSkill("x-com", "site_knowledge", "x.com", ["site-op-memory", "auto"], {
    id: "auto-seed1",
    category: "problem",
    content: "[auto] DO NOT retry click text:收藏 on https://x.com: last ELEMENT_NOT_FOUND",
    recorded_at: new Date().toISOString(),
    confirmed_at: null,
    stale: false,
    stale_reason: "",
    replaced_by: "",
  })

  let dispatched = 0
  const threadB = manager.create("cross thread", "test-autoexp-03")
  clearTabUrlCacheForTests()
  applyTabNavigated(102, `${ORIGIN}/home`)
  roundScript = [
    { tool: { name: "click", args: { tabId: 102, text: "收藏" } } },
    { content: "blocked" },
  ]
  await chatCreate(buildParams({
    threadId: threadB.id,
    skillEngine: se,
    manager,
    hostname: "x.com",
    executeTool: async () => {
      dispatched += 1
      return { ...failResult }
    },
  }))

  const messages = manager.getMessages(threadB.id)
  const toolMsg = messages.find(m => m.role === "tool")
  assert.ok(toolMsg, "tool result message exists")
  assert.match(String(toolMsg.content), /SITE_OP_BANNED/, "persisted locator is machine-refused in the new thread")
  assert.equal(dispatched, 0, "refusal happens at peek — executeTool must not be called")

  const prompt = formatSiteOpMemoryPrompt(threadB.id, "x.com")
  assert.match(prompt, /Site op-memory/)
  assert.match(prompt, /收藏/)
  assert.match(prompt, /persisted/)
})

test("NIT: full dedup-skip persists nothing new and stays silent (no info event)", async () => {
  resetSiteOpMemoryForTests()
  clearTabUrlCacheForTests()
  applyTabNavigated(103, `${ORIGIN}/home`)
  logEvents.length = 0

  // Pre-seed every failed path this run will re-derive, so shouldPersistSiteOpExperience
  // dedup-skips all lines (idempotent re-run of the same failure storm).
  const manager = new ThreadManager()
  const se = new SkillEngine()
  const needed = [
    "click text:收藏",
    "get_element_info css:[data-testid='bookmark']",
    "type text:搜索",
    "hover css:a.ProfileCard",
  ]
  let existingSkill = se.get("x-com")
  for (const frag of needed) {
    const content = `[auto] DO NOT retry ${frag} on ${ORIGIN}: last ELEMENT_NOT_FOUND`
    if ((existingSkill?.entries || []).some(e => e.content === content)) continue
    const entry = {
      id: `seed-${Math.random().toString(36).slice(2, 10)}`,
      category: "problem" as const,
      content,
      recorded_at: new Date().toISOString(),
      confirmed_at: null,
      stale: false,
      stale_reason: "",
      replaced_by: "",
    }
    if (existingSkill) {
      se.addEntry("x-com", entry)
    } else {
      se.createExperienceSkill("x-com", "site_knowledge", "x.com", ["site-op-memory", "auto"], entry)
    }
    existingSkill = se.get("x-com")
  }
  const before = (se.get("x-com")?.entries || []).filter(e => e.content.startsWith("[auto] DO NOT retry")).length
  assert.ok(before >= 4, "all four failed paths pre-persisted for dedup")

  // No hostname → no hydration → the four calls reach recordSiteOpFailure and
  // cross the origin threshold, but every collected line already exists.
  const thread = manager.create("dedup skip", "test-autoexp-04")
  roundScript = [
    proposeRound,
    { tool: { name: "click", args: { tabId: 103, text: "收藏" } } },
    { tool: { name: "get_element_info", args: { tabId: 103, selector: "[data-testid='bookmark']" } } },
    { tool: { name: "type", args: { tabId: 103, text: "搜索", value: "搜索" } } },
    { tool: { name: "hover", args: { tabId: 103, selector: "a.ProfileCard" } } },
    { content: "done" },
  ]
  await chatCreate(buildParams({
    threadId: thread.id,
    skillEngine: se,
    manager,
    executeTool: stubExecuteTool,
  }))

  assert.equal(
    logEvents.filter(e => e.event === "site_op.auto_experience_persisted").length,
    0,
    "a full dedup-skip must not emit the persist info event",
  )
  const after = (se.get("x-com")?.entries || []).filter(e => e.content.startsWith("[auto] DO NOT retry")).length
  assert.equal(after, before, "no duplicate [auto] entries written")
})
