import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { retainTerminalCommandLine } from "../src/acp/progress-caps"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-coding-522-"))
process.env.CMSPARK_DATA_DIR = root
let config: typeof import("../src/config")
let manager: typeof import("../src/acp/manager")
let terminal: typeof import("../src/acp/open-local-terminal")
let handlers: typeof import("../src/acp/handlers")
before(async () => {
  config = await import("../src/config"); await config.initDataDir()
  manager = await import("../src/acp/manager")
  terminal = await import("../src/acp/open-local-terminal")
  handlers = await import("../src/acp/handlers")
})
after(async () => {
  terminal.__testSetOuterOpeners()
  await manager.getAcpManager().shutdown()
  fs.rmSync(root, { recursive: true, force: true })
})

test("command budget counts UTF-8 bytes and declines complete oversized commands instead of truncating", () => {
  const boundary = "🧪".repeat(8192)
  assert.equal(retainTerminalCommandLine(boundary), boundary)
  assert.equal(retainTerminalCommandLine(boundary + "x"), undefined)
  assert.equal(retainTerminalCommandLine("🧪".repeat(8193)), undefined)
  assert.equal(retainTerminalCommandLine(""), undefined)
  assert.equal(retainTerminalCommandLine(undefined), undefined)
})

test("actual outer-terminal result retains the complete original command in owner-stamped progress", async (t) => {
  const command = fs.realpathSync(process.execPath)
  // Native Linux discovery runs before the outer-opener seam. Supply a scoped owned binary
  // selector so a headless image exercises the successful fake opener without requiring a GUI.
  const previousTerminal = process.env.TERMINAL
  t.after(() => {
    if (previousTerminal === undefined) delete process.env.TERMINAL
    else process.env.TERMINAL = previousTerminal
  })
  process.env.TERMINAL = command
  config.saveConfig({ acp: { enabled: true, servers: { fixture: { enabled: true, protocol: "cli", command, args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000)"], policy: { profile: "review_readonly" } } } },
    coding_handoff: { open_local_terminal: true, local_terminal_app: "auto" }, embedded_terminal: { enabled: false } } as any)
  let launched = ""
  terminal.__testSetOuterOpeners({
    darwin: async script => { launched = script; return { appLabel: "owned-fixture", ranScript: true } },
    linux: (term, script) => { assert.equal(term, command); launched = script },
    windows: async script => { launched = fs.readFileSync(script, "utf8"); return { appLabel: "owned-fixture" } },
  })
  const mgr = manager.getAcpManager()
  const events: any[] = []
  const off = mgr.onEvent(event => events.push(event))
  t.after(off)
  const offered = mgr.propose({ threadId: "owner-522", agentId: "fixture", goal: "Synthetic copy-command regression", workspaceRoot: root })
  assert.equal(offered.ok, true)
  if (!offered.ok) return
  let running: ReturnType<typeof mgr.start> | undefined
  try {
    // Real manager lifecycle/CLI producer; only the outer native terminal opener is isolated.
    running = mgr.start(offered.session.session_id)
    void running.catch(() => {})
    const deadline = Date.now() + 5000
    while (offered.session.local_terminal === "pending" && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(launched.length > 0)
    const last = events.at(-1)
    assert.equal(last.session_id, offered.session.session_id)
    assert.equal(last.thread_id, "owner-522")
    assert.equal(last.transport, "cli")
    assert.ok(last.terminal_command_line?.includes(command), "actual generated command, not a guessed live-config command")
    assert.equal(last.terminal_command_line, (offered.session as any).terminal_command_line)
    assert.ok(last.terminal_command_expires_at > Date.now())
    assert.ok(last.terminal_command_expires_at <= Date.now() + 60_000)
    const tools = await import("../src/tool/companion-dispatch")
    const { ThreadManager } = await import("../src/threads/thread-manager")
    const threads = new ThreadManager()
    tools.bindCompanionDispatchRuntime({ getThreadManager: () => threads, getSkillEngine: () => null,
      getComputerEstopEnsureOverride: () => null } as any)
    const status = await tools.executeCompanionTool("acp_get_status", { session_id: offered.session.session_id, _thread_id: "owner-522" })
    assert.equal(status.success, true)
    assert.equal(JSON.stringify(status).includes(last.terminal_command_line), false, "UI command is not projected into model tool results")
    assert.equal(Object.hasOwn(status.data, "terminal_command_line"), false)
    const livePromptRefused = await handlers.handleAcpWsMessage("acp.session.prompt", { session_id: offered.session.session_id, thread_id: "owner-522", text: "synthetic concurrent prompt" }, {})
    assert.equal(livePromptRefused.type, "error")
    assert.equal(livePromptRefused.thread_id, "owner-522")
    const refused = await handlers.handleAcpWsMessage("acp.session.cancel", { session_id: offered.session.session_id, thread_id: "other-owner" }, {})
    assert.equal(refused.type, "error")
    assert.equal(offered.session.state, "running", "wrong owner cannot stop the running bridge")
    const receipt = await handlers.handleAcpWsMessage("acp.session.cancel", { session_id: offered.session.session_id, thread_id: "owner-522" }, {})
    assert.equal(receipt.type, "acp.session.cancel.ack")
    assert.equal(receipt.thread_id, "owner-522")
    assert.ok(events.at(-1).timeline.some((row: any) => row.label.includes("监视已停止")))
    config.saveConfig({ acp: { enabled: false } } as any)
    const followupRefused = await handlers.handleAcpWsMessage("acp.session.followup", { session_id: offered.session.session_id, thread_id: "owner-522", goal: "synthetic closed followup" }, {})
    const promptRefused = await handlers.handleAcpWsMessage("acp.session.prompt", { session_id: offered.session.session_id, thread_id: "owner-522", text: "synthetic closed prompt" }, {})
    const applyRefused = await handlers.handleAcpWsMessage("acp.apply_diff", { session_id: offered.session.session_id, thread_id: "owner-522" }, {})
    for (const error of [followupRefused, promptRefused, applyRefused]) {
      assert.equal(error.type, "error")
      assert.equal(error.thread_id, "owner-522")
      assert.equal(error.session_id, offered.session.session_id)
      assert.equal(error.family, "acp")
    }
    if (process.env.CMSPARK_RECORD_CODING_FIXTURE) {
      const normalize = (value: unknown): unknown => typeof value === "string"
        ? value.replaceAll(offered.session.session_id, "fixture-session").replaceAll(fs.realpathSync(root), "/fixture/workspace").replaceAll(root, "/fixture/workspace").replaceAll(command, "/fixture/node")
          .replace(/\/[^'\s]*cmspark-mode-c-[^/'\s]+\/task\.md/g, "/fixture/prompt/task.md")
        : Array.isArray(value) ? value.map(normalize) : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)])) : value
      const initial = events.find(event => event.transport === "cli" && !event.terminal_command_line)
      assert.ok(initial)
      const proposed = events.find(event => event.state === "offered")
      assert.ok(proposed)
      fs.writeFileSync(process.env.CMSPARK_RECORD_CODING_FIXTURE, JSON.stringify(normalize({ proposed, initial, progress: last, livePromptRefused, refused, receipt, stopped: events.at(-1), followupRefused, promptRefused, applyRefused }), null, 2) + "\n")
    }
  } finally {
    config.saveConfig({ acp: { enabled: true } } as any)
    mgr.cancel(offered.session.session_id)
    if (running) await running
    off(); terminal.__testSetOuterOpeners()
  }
})

test("actual Linux no-terminal or refused-opener path preserves its honest manual-command fallback", async (t) => {
  const previousTerminal = process.env.TERMINAL
  t.after(() => {
    terminal.__testSetOuterOpeners()
    if (previousTerminal === undefined) delete process.env.TERMINAL
    else process.env.TERMINAL = previousTerminal
  })
  delete process.env.TERMINAL
  const nativeTerminal = terminal.resolveLinuxTerminalBinary({})
  let calls = 0
  terminal.__testSetOuterOpeners({ linux: () => { calls++; throw new Error("owned fixture opener refused") } })
  const command = fs.realpathSync(process.execPath)
  const result = await terminal.openLocalTerminalForAgent({ command, cwd: root, terminalApp: "auto", platform: "linux", goalHint: "synthetic unavailable terminal" })
  assert.equal(result.ok, false)
  assert.ok(result.commandLine?.includes(command), "a refused/no-terminal result still carries the complete real manual fallback")
  assert.equal(result.level, undefined, "failure must not claim an opened L1/L0 terminal")
  if (nativeTerminal === null) {
    assert.equal(calls, 0, "no installed emulator stops at preflight before the opener seam")
    assert.equal(result.detail, "no terminal emulator found; paste command manually")
  } else {
    assert.equal(calls, 2, "an installed emulator attempts isolated L1 then L0 without any native open")
    assert.equal(result.detail, "owned fixture opener refused")
  }
})

test("actual closed progress bounds rich payload before listeners while full saved result/diffs remain canonical", async () => {
  const { timelineItem } = await import("../src/acp/timeline")
  const { CODING_PROGRESS_MAX_BYTES, codingHandbackView } = await import("../src/acp/ui-progress")
  const { ThreadManager } = await import("../src/threads/thread-manager")
  const { formatHandbackChatMessage } = await import("../src/acp/handback-format")
  const threads = new ThreadManager()
  const owner = threads.create("synthetic producer budget")
  config.saveConfig({ acp: { enabled: true, servers: { fixture: { enabled: true, command: process.execPath,
    display_name: "汉".repeat(100000), protocol: "cli", policy: { profile: "review_readonly" } } } } } as any)
  const mgr = new manager.AcpManager()
  const events: any[] = []
  mgr.onEvent(event => events.push(event))
  mgr.setHandbackSink(({ session, handback }) => {
    threads.addMessage(owner.id, { thread_id: owner.id, role: "assistant", content: formatHandbackChatMessage({
      agentId: session.agent_id, mode: session.mode, partial: session.partial, handback,
      diffSummary: session.diff_summary || null, paths: (session.pending_diffs || []).map(diff => diff.relPath),
    }) })
  })
  const proposed = mgr.propose({ threadId: owner.id, agentId: "fixture", goal: "synthetic large display payload",
    workspaceRoot: root, mode: "propose_diff" })
  assert.ok(proposed.ok)
  if (!proposed.ok) return
  const session = proposed.session
  session.timeline = Array.from({ length: 60 }, () => timelineItem("tool", "synthetic operation", { detail: "汉".repeat(2000), path: "huge-path".repeat(10000) }))
  const body = "```diff\n" + Array.from({ length: 100 }, (_, i) => `diff --git a/fixture-${i}.txt b/fixture-${i}.txt\nnew file mode 100644\n--- /dev/null\n+++ b/fixture-${i}.txt\n@@ -0,0 +1 @@\n+${"汉".repeat(5000)}\n`).join("") + "```"
  try {
    ;(mgr as any).finishSession(session, body, 1_000_000, 0)
    const closed = events.at(-1)
    assert.equal(closed.state, "closed")
    assert.equal(closed.thread_id, owner.id)
    assert.equal(closed.session_id, session.session_id)
    assert.equal(closed.output_truncated, true)
    assert.ok(events.every(event => Buffer.byteLength(JSON.stringify(event), "utf8") <= CODING_PROGRESS_MAX_BYTES))
    assert.ok(closed.pending_diffs.some((diff: any) => diff.applyable === true))
    assert.equal(closed.pending_diffs.some((diff: any) => "newContent" in diff || "hunk" in diff), false)
    assert.equal(session.pending_diffs?.length, 100, "stored actionable diffs are not evicted/truncated")
    assert.ok(session.pending_diffs?.[99].newContent?.includes("汉".repeat(5000)))
    const savedMessage = threads.getMessages(owner.id).at(-1)!
    const saved = savedMessage.content
    assert.ok(typeof saved === "string" && saved.includes("汉".repeat(5000)))
    assert.ok(Buffer.byteLength(saved, "utf8") > 8000, "ordinary saved history is outside live-browser projection budget")
    const wire = codingHandbackView(session, savedMessage)
    assert.ok(wire)
    assert.equal(wire.output_truncated, true)
    assert.ok(Buffer.byteLength(JSON.stringify(wire), "utf8") <= CODING_PROGRESS_MAX_BYTES)
    assert.ok(wire.pending_diffs.some(diff => diff.applyable === true))
    assert.equal(threads.getMessages(owner.id).at(-1)!.content, saved, "live projection never overwrites canonical history")
  } finally { await mgr.shutdown() }
})

test("oversized producer identity is withheld without rewriting session ownership or authoritative state", () => {
  const { boundCodingProgress } = require("../src/acp/ui-progress") as typeof import("../src/acp/ui-progress")
  const actual = JSON.parse(fs.readFileSync(process.env.CMSPARK_RECORD_CODING_FIXTURE || path.join(__dirname, "../../../chrome-extension/tests/fixtures/coding-control-522.json"), "utf8")).progress
  const input = { ...actual, agent_id: "synthetic oversized agent key".repeat(10000) }
  assert.equal(boundCodingProgress(input), null)
  assert.equal(input.thread_id, actual.thread_id)
  assert.equal(input.session_id, actual.session_id)
})
