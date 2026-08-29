/**
 * #245 A3 — Capture overlay true L0.
 *
 * Adapter offer+exec deny the full native executor set when surface is stamped
 * summoner. Overlay pack/skill/knowledge bind the overlay-held lease thread.
 * Client `surface` on chat.create is ignored (not in validate.ts).
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-overlay-l0-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let chatCreate: typeof import("../src/llm/adapter").chatCreate
let filterToolsForSurface: typeof import("../src/llm/adapter").filterToolsForSurface
let isSummonerNativeExecutorDenied: typeof import("../src/llm/adapter").isSummonerNativeExecutorDenied
let getToolDefinitions: typeof import("../src/bridge/tool-definitions").getToolDefinitions
let handleMessage: typeof import("../src/message-router").handleMessage
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let composerLeases: typeof import("../src/ws/composer-lease").composerLeases
let validateWsMessage: typeof import("../src/ws/validate").validateWsMessage
let SUMMONER_CDP_NEEDED: typeof import("../src/summoner/client").SUMMONER_CDP_NEEDED
let SUMMONER_L0_CHROME_DOWN: typeof import("../src/summoner/client").SUMMONER_L0_CHROME_DOWN
let SUMMONER_RENTER_CHROME_DOWN: typeof import("../src/summoner/client").SUMMONER_RENTER_CHROME_DOWN
let saveConfig: typeof import("../src/config").saveConfig

const ROOT = path.resolve(__dirname, "..", "..")
function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

const NATIVE_DENY_AT_LEAST = [
  "list_tabs",
  "navigate",
  "screenshot",
  "evaluate",
  "get_page_text",
  "get_page_html",
  "click",
  "osascript_eval",
  "shell_exec",
  "host_computer",
  "spawn_worker",
] as const

let server: http.Server
let baseUrl = ""
let capturedBodies: any[] = []
let streamCall = 0
type ResponseSpec = { status: number; headers: Record<string, string>; body: string }
let responder: (body: any, idx: number) => ResponseSpec

function sseChunk(delta: any, finish_reason?: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`
}
const DONE = "data: [DONE]\n\n"
function sse(chunks: string[]): ResponseSpec {
  return { status: 200, headers: { "content-type": "text/event-stream" }, body: chunks.join("") }
}
function json(obj: any): ResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) }
}

function resetCapture() {
  capturedBodies = []
  streamCall = 0
}

function toolNames(body: any): string[] {
  const tools = Array.isArray(body?.tools) ? body.tools : []
  return tools
    .map((t: any) => t?.function?.name)
    .filter((n: unknown): n is string => typeof n === "string")
}

before(async () => {
  const adapter = await import("../src/llm/adapter")
  const tools = await import("../src/bridge/tool-definitions")
  const router = await import("../src/message-router")
  const tm = await import("../src/threads/thread-manager")
  const se = await import("../src/skills/skill-engine")
  const lease = await import("../src/ws/composer-lease")
  const validate = await import("../src/ws/validate")
  const client = await import("../src/summoner/client")
  const config = await import("../src/config")
  chatCreate = adapter.chatCreate
  filterToolsForSurface = adapter.filterToolsForSurface
  isSummonerNativeExecutorDenied = adapter.isSummonerNativeExecutorDenied
  getToolDefinitions = tools.getToolDefinitions
  handleMessage = router.handleMessage
  ThreadManager = tm.ThreadManager
  SkillEngine = se.SkillEngine
  composerLeases = lease.composerLeases
  validateWsMessage = validate.validateWsMessage
  SUMMONER_CDP_NEEDED = client.SUMMONER_CDP_NEEDED
  SUMMONER_L0_CHROME_DOWN = client.SUMMONER_L0_CHROME_DOWN
  SUMMONER_RENTER_CHROME_DOWN = client.SUMMONER_RENTER_CHROME_DOWN
  saveConfig = config.saveConfig
  await config.initDataDir()
  saveConfig({
    llm: {
      base_url: "http://127.0.0.1:9",
      api_key: "sk-test",
      model_name: "test-model",
      temperature: 0.5,
      context_window: 8000,
    },
  } as any)

  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => {
      let body: any = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      } catch {
        /* ignore */
      }
      capturedBodies.push(body)
      let idx = -1
      if (body.stream) {
        streamCall++
        idx = streamCall
      }
      const spec = responder
        ? responder(body, idx)
        : json({ choices: [{ message: { content: "ok" } }] })
      res.writeHead(spec.status, spec.headers)
      res.end(spec.body)
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const addr = server.address()
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`
  saveConfig({
    llm: {
      base_url: baseUrl,
      api_key: "sk-test",
      model_name: "test-model",
      temperature: 0.5,
      context_window: 8000,
    },
  } as any)
})

after(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function llmConfig() {
  return {
    base_url: baseUrl,
    api_key: "sk-test",
    model_name: "test-model",
    temperature: 0.5,
    context_window: 8000,
  } as any
}

function claimOverlay(threadId: string): () => void {
  const before = composerLeases.get(threadId)
  const claimed = composerLeases.claim({ thread_id: threadId, holder: "overlay", rev: before.rev })
  assert.equal(claimed.ok, true)
  return () => {
    const cur = composerLeases.get(threadId)
    if (cur.holder === "overlay") composerLeases.release({ thread_id: threadId, rev: cur.rev })
  }
}

test("isSummonerNativeExecutorDenied covers the full executor set, not a 5-name list", () => {
  for (const name of NATIVE_DENY_AT_LEAST) {
    assert.equal(isSummonerNativeExecutorDenied(name), true, name)
  }
  assert.equal(isSummonerNativeExecutorDenied("get_cookies"), true)
  assert.equal(isSummonerNativeExecutorDenied("set_cookie"), true)
  assert.equal(isSummonerNativeExecutorDenied("host_read"), true)
  assert.equal(isSummonerNativeExecutorDenied("workspace_read_file"), true)
  assert.equal(isSummonerNativeExecutorDenied("acp_list_agents"), true)
  assert.equal(isSummonerNativeExecutorDenied("mcp__fs__read_file"), true)
})

test("filterToolsForSurface strips native executors only on summoner", () => {
  const native = getToolDefinitions()
  const tray = filterToolsForSurface(native, "tray")
  const overlay = filterToolsForSurface(native, "summoner")
  const trayNames = tray.map((t) => t.function.name)
  const overlayNames = overlay.map((t) => t.function.name)
  for (const name of ["list_tabs", "navigate", "screenshot", "evaluate"]) {
    assert.ok(trayNames.includes(name), `tray still offers ${name}`)
    assert.equal(overlayNames.includes(name), false, `summoner must not offer ${name}`)
  }
})

test("chatCreate surface=summoner does not offer list_tabs/navigate/screenshot/evaluate", async () => {
  resetCapture()
  responder = (body) => {
    if (!body.stream) return json({ choices: [{ message: { content: "T" } }] })
    return sse([sseChunk({ role: "assistant", content: "hi" }), sseChunk({}, "stop"), DONE])
  }
  const tm = new ThreadManager()
  const thread = tm.create("overlay-l0-offer", "overlay-l0-offer")
  await chatCreate({
    threadId: thread.id,
    message: "hello",
    skillIds: [],
    config: llmConfig(),
    threadManager: tm,
    skillEngine: new SkillEngine(),
    historyStore: { record: async () => 0 } as any,
    sendToExtension: () => {},
    executeTool: async () => ({ success: true, data: {} }),
    surface: "summoner",
  })
  const stream = capturedBodies.filter((b) => b.stream)
  assert.ok(stream.length >= 1, "LLM stream request captured")
  const names = toolNames(stream[0])
  for (const deny of ["list_tabs", "navigate", "screenshot", "evaluate"]) {
    assert.equal(names.includes(deny), false, `offered ${deny}`)
  }
})

test("chatCreate without summoner surface still offers list_tabs (Operate unchanged)", async () => {
  resetCapture()
  responder = (body) => {
    if (!body.stream) return json({ choices: [{ message: { content: "T" } }] })
    return sse([sseChunk({ role: "assistant", content: "hi" }), sseChunk({}, "stop"), DONE])
  }
  const tm = new ThreadManager()
  const thread = tm.create("panel-offer", "panel-offer")
  await chatCreate({
    threadId: thread.id,
    message: "hello",
    skillIds: [],
    config: llmConfig(),
    threadManager: tm,
    skillEngine: new SkillEngine(),
    historyStore: { record: async () => 0 } as any,
    sendToExtension: () => {},
    executeTool: async () => ({ success: true, data: {} }),
  })
  const stream = capturedBodies.filter((b) => b.stream)
  assert.ok(stream.length >= 1)
  assert.ok(toolNames(stream[0]).includes("list_tabs"))
})

test("executeTool(list_tabs) on summoner is hard-denied even when whitelist=null / hallucinated", async () => {
  resetCapture()
  const executed: string[] = []
  responder = (body, idx) => {
    if (!body.stream) return json({ choices: [{ message: { content: "T" } }] })
    if (idx === 1) {
      return sse([
        sseChunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_hallucinated_tabs",
              type: "function",
              function: { name: "list_tabs", arguments: "{}" },
            },
          ],
        }),
        sseChunk({}, "tool_calls"),
        DONE,
      ])
    }
    return sse([sseChunk({ role: "assistant", content: "done" }), sseChunk({}, "stop"), DONE])
  }
  const tm = new ThreadManager()
  const thread = tm.create("overlay-l0-exec", "overlay-l0-exec")
  assert.equal(tm.get(thread.id)?.tool_whitelist, null)
  const toolResults: any[] = []
  await chatCreate({
    threadId: thread.id,
    message: "list the tabs",
    skillIds: [],
    config: llmConfig(),
    threadManager: tm,
    skillEngine: new SkillEngine(),
    historyStore: { record: async () => 0 } as any,
    sendToExtension: (data) => {
      if (data?.type === "tool.result") toolResults.push(data)
    },
    executeTool: async (_id, name) => {
      executed.push(name)
      return { success: true, data: [{ id: 1 }] }
    },
    surface: "summoner",
  })
  assert.equal(executed.includes("list_tabs"), false, "inner executeTool must not run list_tabs")
  const tabResult = toolResults.find((r) => r.tool_name === "list_tabs")
  assert.ok(tabResult, "tool.result for hallucinated list_tabs")
  assert.equal(tabResult.result?.success, false)
  assert.match(String(tabResult.result?.error || ""), /SUMMONER_L0|denied|overlay/i)
})

test("handleMessage stamped summoner chat.create does not offer native executors", async () => {
  resetCapture()
  responder = (body) => {
    if (!body.stream) return json({ choices: [{ message: { content: "T" } }] })
    return sse([sseChunk({ role: "assistant", content: "hi" }), sseChunk({}, "stop"), DONE])
  }
  const tm = new ThreadManager()
  const thread = tm.create("stamped-offer", "stamped-offer")
  const release = claimOverlay(thread.id)
  try {
    await handleMessage(
      {
        type: "chat.create",
        thread_id: thread.id,
        message: "hello from overlay",
        __cmspark_surface: "summoner",
      },
      {
        threadManager: tm,
        skillEngine: new SkillEngine(),
        historyStore: { record: async () => 0 } as any,
      },
      {
        sendToExtension: () => {},
        executeTool: async () => ({ success: true, data: {} }),
        surface: "summoner",
      } as any,
    )
  } finally {
    release()
  }
  const stream = capturedBodies.filter((b) => b.stream)
  assert.ok(stream.length >= 1, "stamped chat.create must hit the LLM")
  const names = toolNames(stream[0])
  for (const deny of ["list_tabs", "navigate", "screenshot", "evaluate"]) {
    assert.equal(names.includes(deny), false, `stamped summoner offered ${deny}`)
  }
})

test("client-supplied surface on chat.create is ignored; only router stamp counts", async () => {
  resetCapture()
  responder = (body) => {
    if (!body.stream) return json({ choices: [{ message: { content: "T" } }] })
    return sse([sseChunk({ role: "assistant", content: "hi" }), sseChunk({}, "stop"), DONE])
  }
  const tm = new ThreadManager()
  const thread = tm.create("client-surface", "client-surface")
  await handleMessage(
    {
      type: "chat.create",
      thread_id: thread.id,
      message: "spoof",
      surface: "summoner",
    },
    {
      threadManager: tm,
      skillEngine: new SkillEngine(),
      historyStore: { record: async () => 0 } as any,
    },
    {
      sendToExtension: () => {},
      executeTool: async () => ({ success: true, data: {} }),
    } as any,
  )
  const stream = capturedBodies.filter((b) => b.stream)
  assert.ok(stream.length >= 1)
  assert.ok(
    toolNames(stream[0]).includes("list_tabs"),
    "unstamped create (panel) must still offer list_tabs",
  )
})

test("validate.ts chat.create does not grow a client surface field", () => {
  const src = fs.readFileSync(srcFile("ws", "validate.ts"), "utf8")
  const start = src.indexOf('"chat.create"')
  const next = src.indexOf('"chat.steer"', start)
  assert.ok(start >= 0 && next > start)
  assert.doesNotMatch(src.slice(start, next), /\bsurface\b/)
  assert.equal(
    validateWsMessage({ type: "chat.create", thread_id: "t1", message: "hi", surface: "summoner" })
      .valid,
    true,
    "unknown client surface is ignored, not schema-gated",
  )
})

test("message-router stamps ChatCreateParams.surface from stampedSurface at all chatCreate sites", () => {
  const src = fs.readFileSync(srcFile("message-router.ts"), "utf8")
  const parts = src.split("await chatCreate({")
  assert.equal(parts.length, 4, "three chatCreate call sites")
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i].slice(0, 900)
    assert.match(block, /surface:\s*stampedSurface/, `chatCreate site ${i} missing surface stamp`)
  }
})

test("overlay pack.apply with a thread_id that is not the overlay-held lease errors", async () => {
  const tm = new ThreadManager()
  const held = tm.create("held", "overlay-held")
  const other = tm.create("other", "not-held")
  const release = claimOverlay(held.id)
  try {
    const r = await handleMessage(
      {
        type: "pack.apply",
        pack_id: "meeting-minutes",
        thread_id: other.id,
        user_gesture: true,
        __cmspark_surface: "summoner",
      },
      {
        threadManager: tm,
        skillEngine: new SkillEngine(),
        historyStore: { record: async () => 0 } as any,
      },
    )
    assert.equal(r.type, "error")
    assert.match(String(r.error || r.error_code || ""), /OVERLAY_THREAD_MISMATCH|overlay/i)
  } finally {
    release()
  }
})

test("overlay skill.activate / knowledge.set_active on a non-held thread errors and does not write skill_selection_mode", async () => {
  const tm = new ThreadManager()
  const held = tm.create("held-skill", "overlay-held-skill")
  const other = tm.create("other-skill", "not-held-skill")
  assert.equal(other.skill_selection_mode, "auto")
  const release = claimOverlay(held.id)
  try {
    const sk = await handleMessage(
      {
        type: "skill.activate",
        thread_id: other.id,
        skill_name: "browse",
        __cmspark_surface: "summoner",
      },
      {
        threadManager: tm,
        skillEngine: new SkillEngine(),
        historyStore: { record: async () => 0 } as any,
      },
    )
    assert.equal(sk.type, "error")
    assert.equal(tm.get(other.id)?.skill_selection_mode, "auto")

    const kn = await handleMessage(
      {
        type: "knowledge.set_active",
        thread_id: other.id,
        ids: ["k1"],
        __cmspark_surface: "summoner",
      },
      {
        threadManager: tm,
        skillEngine: new SkillEngine(),
        historyStore: { record: async () => 0 } as any,
      },
    )
    assert.equal(kn.type, "error")
  } finally {
    release()
  }
})

test("Capture copy is 可以继续聊; Operate is 打开侧栏 — no overlay-operates-page promise", () => {
  assert.match(SUMMONER_L0_CHROME_DOWN, /可以继续聊/)
  assert.match(SUMMONER_L0_CHROME_DOWN, /打开侧栏/)
  assert.doesNotMatch(SUMMONER_L0_CHROME_DOWN, /需要打开浏览器/)
  assert.match(SUMMONER_CDP_NEEDED, /打开侧栏/)
  assert.doesNotMatch(SUMMONER_CDP_NEEDED, /网页操作需要浏览器/)
  assert.match(SUMMONER_RENTER_CHROME_DOWN, /打开侧栏/)
  assert.doesNotMatch(SUMMONER_RENTER_CHROME_DOWN, /浏览器没在/)
  const html = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(html, /id="operateOpen"/)
  assert.match(html, /打开浏览器并打开侧栏/)
})
