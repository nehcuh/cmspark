/**
 * Slice 6 PR-A Task 3: `/技能` this turn pins the named skill and flips the
 * thread to skill_selection_mode=manual (按需). Overlay skill.activate must
 * not write mode. Drive chat.create through handleMessage (AbortError LLM).
 */
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-slash-skill-pin-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let handleMessage: typeof import("../src/message-router").handleMessage
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let saveConfig: typeof import("../src/config").saveConfig
let getConfigDir: typeof import("../src/config").getConfigDir

let originalCreate: any = undefined
let completionsProto: any = undefined
let createImpl: () => Promise<never> = async () => {
  throw new Error("unset mock")
}

function writeSkillFile(dir: string, filename: string, frontmatter: Record<string, unknown>, content: string) {
  const lines = ["---"]
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`)
      for (const item of v) lines.push(`  - ${item}`)
    } else {
      lines.push(`${k}: ${v}`)
    }
  }
  lines.push("---", "", content)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, filename), lines.join("\n"))
}

before(async () => {
  const mr = await import("../src/message-router")
  const tm = await import("../src/threads/thread-manager")
  const se = await import("../src/skills/skill-engine")
  const cfg = await import("../src/config")
  handleMessage = mr.handleMessage
  ThreadManager = tm.ThreadManager
  SkillEngine = se.SkillEngine
  saveConfig = cfg.saveConfig
  getConfigDir = cfg.getConfigDir
  await cfg.initDataDir()

  saveConfig({
    llm: {
      base_url: "http://localhost:9999",
      api_key: "sk-test",
      model_name: "gpt-4o",
      temperature: 0.5,
      context_window: 4000,
    },
  } as any)

  const openaiMod = await import("openai")
  const OpenAI = (openaiMod as any).default || openaiMod
  const dummyClient = new OpenAI({ baseURL: "http://localhost:9999", apiKey: "sk-test" })
  completionsProto = Object.getPrototypeOf(dummyClient.chat.completions)
  originalCreate = completionsProto.create
  completionsProto.create = async function () {
    return createImpl()
  }
})

after(() => {
  if (completionsProto && originalCreate) {
    completionsProto.create = originalCreate
  }
  fs.rmSync(tempHome, { recursive: true, force: true })
})

beforeEach(() => {
  createImpl = async () => {
    const e = new Error("simulated abort after user-message echo")
    e.name = "AbortError"
    throw e
  }
  const threadsDir = path.join(getConfigDir(), "threads")
  if (fs.existsSync(threadsDir)) {
    for (const f of fs.readdirSync(threadsDir)) {
      try {
        fs.rmSync(path.join(threadsDir, f), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
  const skillsDir = path.join(getConfigDir(), "skills")
  if (fs.existsSync(skillsDir)) {
    for (const f of fs.readdirSync(skillsDir)) {
      try {
        fs.rmSync(path.join(skillsDir, f), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
})

function makeSession(sent: any[]) {
  const viaBroadcast: any[] = []
  const viaDirect: any[] = []
  return Object.assign(
    {
      sendToExtension: (data: any) => {
        viaDirect.push(data)
        sent.push(data)
      },
      executeTool: async () => ({ success: true, data: {} }),
      broadcast: (data: any) => {
        viaBroadcast.push(data)
        sent.push(data)
      },
    },
    { viaBroadcast, viaDirect },
  ) as any
}

test("slash-skill pin: chat.create /browse while auto flips manual and next resolve is active-only", async () => {
  const skillsDir = path.join(getConfigDir(), "skills")
  writeSkillFile(skillsDir, "browse.md", {
    name: "browse",
    description: "Browse websites",
    type: "prompt_template",
  }, "# Browse")
  writeSkillFile(skillsDir, "code.md", {
    name: "code",
    description: "Write code zxqvcodewrite programming",
    tags: ["programming", "zxqvcodewrite"],
    type: "prompt_template",
  }, "# Code")

  const tm = new ThreadManager()
  const thread = tm.create("", "slash-chat-create")
  assert.equal(thread.skill_selection_mode, "auto")

  const engine = new SkillEngine()
  const origResolve = engine.resolveSkillIdsForThread.bind(engine)
  let thisTurn: string[] | undefined
  engine.resolveSkillIdsForThread = async function (...args: Parameters<typeof origResolve>) {
    thisTurn = await origResolve(...args)
    return thisTurn
  }

  const sent: any[] = []
  const session = makeSession(sent)
  await handleMessage(
    {
      type: "chat.create",
      thread_id: thread.id,
      message: "/browse how do I zxqvcodewrite",
      skill_ids: thread.active_skill_ids,
    },
    { threadManager: tm, skillEngine: engine, historyStore: { record: () => 0 } as any },
    session,
  )

  const after = tm.get(thread.id)
  assert.equal(after?.skill_selection_mode, "manual")
  assert.ok(after?.active_skill_ids.includes("browse"))
  assert.ok(thisTurn?.includes("browse"), "this turn must include the slash-named skill")
  assert.ok(
    !thisTurn?.includes("code"),
    "this turn must not union matchSkills after slash pin (manual)",
  )

  const updated = sent.find((m) => m.type === "thread.updated" && m.thread?.id === thread.id)
  assert.ok(updated, "must broadcast thread.updated so SkillsPanel shows 按需")
  assert.equal(updated.thread.skill_selection_mode, "manual")
  // R3a: production broadcast already reaches the initiating panel socket —
  // the same payload object must never also go through sendToExtension.
  const doubleDelivered = session.viaBroadcast.filter((p: any) => session.viaDirect.includes(p))
  assert.deepEqual(
    doubleDelivered,
    [],
    "no payload may be delivered via both broadcast and sendToExtension (R3a double-send)",
  )

  const next = await origResolve(
    thread.id,
    after?.skill_selection_mode,
    "how do I write code zxqvcodewrite programming",
  )
  assert.ok(next.includes("browse"))
  assert.ok(!next.includes("code"), "next resolveSkillIdsForThread must not union matchSkills")
})

test("slash-skill pin: rest.skill_ids without leading slash does not flip mode", async () => {
  const skillsDir = path.join(getConfigDir(), "skills")
  writeSkillFile(skillsDir, "browse.md", {
    name: "browse",
    description: "Browse websites",
    type: "prompt_template",
  }, "# Browse")

  const tm = new ThreadManager()
  const thread = tm.create("", "slash-skill-ids-not-a-pin")
  assert.equal(thread.skill_selection_mode, "auto")

  const sent: any[] = []
  await handleMessage(
    {
      type: "chat.create",
      thread_id: thread.id,
      message: "how do I browse the web",
      skill_ids: ["browse"],
    },
    { threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any },
    makeSession(sent),
  )

  const after = tm.get(thread.id)
  assert.equal(
    after?.skill_selection_mode,
    "auto",
    "extension always sends skill_ids; that must not be the pin door",
  )
})
