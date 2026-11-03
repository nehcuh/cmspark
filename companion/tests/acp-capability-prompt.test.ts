import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import nativeOs = require("node:os")

test("chat exposes the actual coding handoff and embedded terminal capabilities", async t => {
  const root = mkdtempSync(join(tmpdir(), "cmspark-acp-prompt-"))
  const previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = root
  let proto: any, original: any
  try {
    const { initDataDir, saveConfig } = await import("../src/config")
    await initDataDir()
    saveConfig({ acp: { enabled: true, servers: {} } as any,
      embedded_terminal: { enabled: true }, coding_handoff: { open_local_terminal: true } })
    const { SkillEngine } = await import("../src/skills/skill-engine")
    const { ThreadManager } = await import("../src/threads/thread-manager")
    const { chatCreate } = await import("../src/llm/adapter")
    const { default: OpenAI } = await import("openai")
    const manager = new ThreadManager()
    const thread = manager.create("terminal handoff", "terminal-handoff")
    const engine = new SkillEngine()
    engine.bindThreadManager(manager)
    const requests: Array<{ prompt: string; tools: string[] }> = []
    proto = Object.getPrototypeOf(new OpenAI({ baseURL: "http://localhost:9999", apiKey: "test" }).chat.completions)
    original = proto.create
    proto.create = async (params: any) => {
      requests.push({ prompt: String(params.messages.find((m: any) => m.role === "system")?.content || ""),
        tools: params.tools.map((t: any) => t.function.name) })
      return (async function* () {
        yield { choices: [{ delta: { content: "done" } }] }
        yield { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }
      })()
    }
    const run = () => chatCreate({
      threadId: thread.id, message: "在我们的网页终端中进行修复吧", skillIds: [], knowledgeIds: [],
      config: { base_url: "http://localhost:9999", api_key: "test", model_name: "test", temperature: 0, context_window: 128000 },
      threadManager: manager, skillEngine: engine, historyStore: { record: () => 0 } as any,
      sendToExtension: () => {}, executeTool: async () => { throw new Error("no execution expected") },
    } as any)
    await run()
    const first = requests.at(-1)!
    assert.ok(first.tools.includes("acp_start_session"))
    assert.match(first.prompt, /CMspark 编程接力与网页终端/)
    if (process.platform === "darwin") {
      assert.match(first.prompt, /在本插件打开终端/)
      assert.match(first.prompt, /embed_intent/)
      assert.match(first.prompt, /embed_running/)
    }
    assert.match(first.prompt, /acp_list_agents.*acp_propose_session.*acp_start_session/)
    assert.match(first.prompt, /localhost/)
    assert.match(first.prompt, /独立进程/)
    assert.match(first.prompt, /本线程当前可查询的 ACP 会话：无/)
    assert.match(first.prompt, /后台重启.*会话 ID.*失效/)
    assert.match(first.prompt, /SECURITY FOOTER/)
    const { getAcpManager, _resetAcpManagerForTests } = await import("../src/acp/manager")
    saveConfig({ acp: { enabled: true, servers: { test: { enabled: true,
      command: "/bin/echo", args: [], policy: { profile: "review_readonly" } } } } as any })
    const offered = getAcpManager().propose({ threadId: thread.id, agentId: "test", goal: "review", workspaceRoot: root })
    assert.ok(offered.ok)
    await run()
    assert.ok(requests.at(-1)!.prompt.includes(offered.session.session_id))
    _resetAcpManagerForTests()
    await run()
    assert.match(requests.at(-1)!.prompt, /本线程当前可查询的 ACP 会话：无/)
    assert.ok(!requests.at(-1)!.prompt.includes(offered.session.session_id), "restart must remove stale runtime IDs from the prompt")
    const packs = await import("../src/packs/pack-engine")
    packs.ensureBuiltinPacksInstalled(engine)
    saveConfig({ modules: { shell: { available: true, enabled: true, policy: "confirm_per_command" } } } as any)
    assert.equal(packs.applyPack("coding-handoff", thread.id, manager, engine).ok, true)
    t.mock.method(nativeOs, "platform", () => "linux")
    await run()
    assert.ok(requests.at(-1)!.tools.includes("shell_exec"), "enabled shell must reach the provider in the coding scene")
    assert.match(requests.at(-1)!.prompt, /zenity.*shell_exec/)
    // A capability hint must respect the same tool whitelist as the provider request.
    manager.update(thread.id, { tool_whitelist: ["list_tabs"] })
    await run()
    assert.ok(!requests.at(-1)!.tools.includes("acp_start_session"))
    assert.doesNotMatch(requests.at(-1)!.prompt, /CMspark 编程接力与网页终端/)
    manager.update(thread.id, { tool_whitelist: null })
    saveConfig({ acp: { enabled: false, servers: {} } as any })
    await run()
    assert.match(requests.at(-1)!.prompt, /ACP 当前未启用/)
    assert.doesNotMatch(requests.at(-1)!.prompt, /acp_list_agents → acp_propose_session → acp_start_session/)
  } finally {
    if (proto && original) proto.create = original
    if (previous === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("#584 buildCodingHandoffContext: win32 + enabled 如实宣称网页终端可用", async () => {
  const { buildCodingHandoffContext } = await import("../src/acp/capability-context")
  const cfg = {
    acp: { enabled: true },
    embedded_terminal: { enabled: true },
    coding_handoff: { open_local_terminal: true },
  } as any
  const tools = new Set(["acp_list_agents", "acp_propose_session", "acp_start_session"])
  const win32 = buildCodingHandoffContext(cfg, "win32", tools)
  assert.match(win32, /网页终端已启用/, "win32 must advertise the embedded terminal (#584)")
  assert.doesNotMatch(win32, /需要 macOS/, "stale darwin-only claim would make the model deny the capability")
  const darwin = buildCodingHandoffContext(cfg, "darwin", tools)
  assert.match(darwin, /网页终端已启用/)
  const linux = buildCodingHandoffContext(cfg, "linux", tools)
  assert.match(linux, /需要 macOS \/ Windows/, "linux stays unsupported and the copy says so")
})

test("Linux coding handoff can recover missing picker dependencies through enabled shell", async () => {
  const { buildCodingHandoffContext } = await import("../src/acp/capability-context")
  const cfg = { acp: { enabled: true }, modules: { shell: { available: true, enabled: true } } } as any
  const tools = new Set(["acp_list_agents", "acp_propose_session", "acp_start_session", "shell_exec"])
  const context = buildCodingHandoffContext(cfg, "linux", tools)
  assert.match(context, /workspace_root.*选择工作区/)
  assert.match(context, /zenity.*shell_exec/)
  assert.match(context, /包管理器/)
  assert.match(context, /安装.*确认/)
  assert.match(context, /sudo -n/)
  assert.match(context, /安装成功.*选择工作区/)
  tools.delete("shell_exec")
  assert.doesNotMatch(buildCodingHandoffContext(cfg, "linux", tools), /可通过 shell_exec/)
  tools.add("shell_exec")
  cfg.modules.shell.enabled = false
  assert.doesNotMatch(buildCodingHandoffContext(cfg, "linux", tools), /可通过 shell_exec/)
  assert.doesNotMatch(buildCodingHandoffContext(cfg, "darwin", tools), /zenity/)
})
