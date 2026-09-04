// MCP inbound lifecycle state machine tests (issue #289)
//
// Pins the four state-machine defects:
//  1. A single failed connect must NOT double-count restartAttempts
//     (catch → error/cleanup AND onclose → disconnected each used to schedule).
//  2. disable-during-connect must NOT let scheduleRestart revive the server
//     from the stale startup config (scheduleRestart reads live config).
//  3. createTransport() sync throws (e.g. `new URL` on a bad http url) must
//     land in `error`, not leave the record stuck in `connecting` forever.
//  4. stderr / last_error from the previous attempt stay visible while a
//     retry is in `connecting` (cleared only on success or dead).
//
// Real McpClient / McpManager instances are used; transports are either
// injected fakes or a hermetic `node -e` subprocess (no network).

import test from "node:test"
import assert from "node:assert/strict"
import { McpClient } from "../src/mcp/client.js"
import { McpManager } from "../src/mcp/manager.js"
import type { McpServerConfig } from "../src/mcp/types.js"

// =============================================================================
// Helpers
// =============================================================================

const stdioCfg = (overrides: Partial<any> = {}): McpServerConfig => ({
  transport: "stdio",
  command: process.execPath,
  args: ["-e", "setTimeout(() => {}, 60000)"], // hangs: never answers initialize
  enabled: true,
  trust_level: "first-use",
  startup_timeout_ms: 8000,
  ...overrides,
} as McpServerConfig)

/** stdio config whose subprocess writes to stderr and exits → startup fails. */
const failingStdioCfg = (overrides: Partial<any> = {}): McpServerConfig =>
  stdioCfg({
    args: ["-e", "console.error('boom-stderr'); process.exit(2)"],
    ...overrides,
  })

/**
 * Fake SDK Transport whose start() rejects immediately (handshake failure).
 * close() fires onclose like the real SDK transports do.
 */
function makeFailingTransport(onStart?: () => void) {
  return {
    onclose: undefined as undefined | (() => void),
    onerror: undefined as undefined | ((e: Error) => void),
    onmessage: undefined as undefined | ((m: any) => void),
    async start() {
      onStart?.()
      throw new Error("boom: handshake failed")
    },
    async close() {
      this.onclose?.()
    },
    async send() {},
  } as any
}

type ManagerInternals = {
  clients: Map<string, any>
  currentConfig: any
  deadServers: Set<string>
  restartAttempts: Map<string, number[]>
  restartTimers: Map<string, NodeJS.Timeout>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// =============================================================================
// #289-3: createTransport sync throw (bad URL) → error, never stuck connecting
// =============================================================================

test("client.connect: invalid http URL surfaces error status (not stuck connecting)", async () => {
  const client = new McpClient("bad", {
    transport: "http",
    url: "not-a-url",
    enabled: true,
    trust_level: "first-use",
  } as McpServerConfig)

  await assert.rejects(() => client.connect())
  assert.equal(client.connection.status, "error",
    "sync throw from createTransport must land in error, not stay connecting")
  assert.ok(client.connection.last_error, "last_error must be populated")

  // A retry must be allowed — the connecting guard must not deadlock this instance.
  await assert.rejects(() => client.connect())
  assert.equal(client.connection.status, "error")
})

// =============================================================================
// #289-1: failed connect → error + no disconnected event (single accounting)
// =============================================================================

test("client.connect: startup failure stays error and never emits disconnected", async () => {
  const client = new McpClient("fs", failingStdioCfg())
  const statuses: string[] = []
  let disconnectedCount = 0
  client.on("status_changed", (s) => statuses.push(s))
  client.on("disconnected", () => { disconnectedCount++ })

  // The SDK rejects with "Connection closed" when the subprocess exits; the
  // stderr tail is folded into connection.last_error instead.
  await assert.rejects(() => client.connect())
  assert.match(client.connection.last_error ?? "", /boom-stderr/)

  assert.equal(disconnectedCount, 0,
    "cleanup of a failed connect must not emit disconnected (would double-count restarts)")
  assert.equal(client.connection.status, "error",
    "final status after failed startup must be error, not disconnected")
  assert.deepEqual(statuses, ["connecting", "error"],
    "status sequence must be connecting → error (no disconnected overwrite)")
})

// =============================================================================
// #289-4: stderr / last_error survive while a retry is connecting
// =============================================================================

test("client.connect: previous stderr and last_error stay visible during retry connecting", async () => {
  const client = new McpClient("fs", failingStdioCfg())
  await assert.rejects(() => client.connect())
  assert.match(client.connection.last_error ?? "", /boom-stderr/)
  assert.match(client.stderrTail, /boom-stderr/)

  // Second attempt: while status is connecting, the previous error and stderr
  // must still be exposed (UI must not lose diagnostics mid-retry).
  let seenConnecting = false
  let lastErrorDuringConnecting: string | undefined
  client.on("status_changed", (s) => {
    if (s === "connecting") {
      seenConnecting = true
      lastErrorDuringConnecting = client.connection.last_error
    }
  })

  const retry = client.connect({
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
    async start() { await sleep(100); throw new Error("boom2: still failing") },
    async close() { this.onclose?.() },
    async send() {},
  } as any).catch(() => {})
  // Sample mid-flight: the injected transport has not written new stderr, so
  // anything in the buffer is the PREVIOUS attempt's tail.
  await sleep(30)
  assert.equal(client.connection.status, "connecting")
  const stderrMidRetry = client.stderrTail
  const lastErrorMidRetry = client.connection.last_error
  await retry

  assert.equal(seenConnecting, true, "retry should pass through connecting")
  assert.match(lastErrorDuringConnecting ?? "", /boom-stderr/,
    "last_error from the previous attempt must survive the connecting phase")
  assert.match(lastErrorMidRetry ?? "", /boom-stderr/,
    "last_error must still be readable mid-retry")
  assert.match(stderrMidRetry, /boom-stderr/,
    "stderr tail from the previous attempt must not be wiped when the retry starts")
  assert.equal(client.connection.status, "error")
})

// =============================================================================
// #289-1 (manager side): one failed start == exactly one restart attempt
// =============================================================================

test("manager.startClient: a single failed start records exactly one restart attempt", async () => {
  const manager = new McpManager()
  const internals = manager as unknown as ManagerInternals
  const cfg = failingStdioCfg({
    restart_policy: { max_restarts: 5, backoff_base_ms: 60000, backoff_max_ms: 60000 },
  })

  try {
    await manager.start({ enabled: true, servers: { fs: cfg } })

    const attempts = internals.restartAttempts.get("fs") ?? []
    assert.equal(attempts.length, 1,
      `single failure must count once, got ${attempts.length} (double-accounting regression)`)

    const client = internals.clients.get("fs")
    assert.equal(client?.connection.status, "error",
      "failed server must rest on error, not disconnected")
    assert.match(client?.connection.last_error ?? "", /boom-stderr/,
      "stderr must be folded into last_error")
    assert.match(client?.stderrTail ?? "", /boom-stderr/)
  } finally {
    await manager.shutdown()
  }
})

// =============================================================================
// #289-2: disable-during-connect must not ghost-revive via stale config
// =============================================================================

test("manager: disabling a server mid-connect prevents scheduleRestart revival", async () => {
  const manager = new McpManager()
  const internals = manager as unknown as ManagerInternals
  // Handshake hangs (subprocess never answers). Backoff is long enough that
  // stopClient finishes BEFORE any stale restart timer fires — pre-fix, that
  // timer (scheduled from the stale enabled=true closure) survives stopClient
  // and revives the server; post-fix scheduleRestart bails on the live config.
  const cfg = stdioCfg({
    startup_timeout_ms: 30000,
    restart_policy: { max_restarts: 5, backoff_base_ms: 500, backoff_max_ms: 600 },
  })

  try {
    await manager.applyConfig({ enabled: true, servers: { fs: cfg } })
    // Wait until the client is actually in connecting (handshake in flight).
    for (let i = 0; i < 100; i++) {
      if (internals.clients.get("fs")?.connection.status === "connecting") break
      await sleep(10)
    }
    assert.equal(internals.clients.get("fs")?.connection.status, "connecting")

    // User flips the switch off while the handshake is still running.
    await manager.applyConfig({
      enabled: true,
      servers: { fs: { ...cfg, enabled: false } },
    })
    assert.equal(internals.clients.has("fs"), false, "stopClient must remove the client")

    // Give any stale-closure restart timer plenty of time to fire.
    await sleep(1000)

    assert.equal(internals.clients.has("fs"), false,
      "disabled server must NOT be revived by a stale-config scheduleRestart")
    assert.equal(internals.restartTimers.has("fs"), false,
      "no restart timer may survive for a disabled server")
    assert.equal(internals.restartAttempts.has("fs"), false,
      "no restart attempt may be recorded from the stale closure config")
    assert.equal(internals.deadServers.has("fs"), false)
  } finally {
    await manager.shutdown()
  }
})

// =============================================================================
// #289-2 (unit): scheduleRestart must read live config, not the stale closure
// =============================================================================

test("scheduleRestart: stale enabled=true cfg bails when live config is disabled", async () => {
  const manager = new McpManager()
  const internals = manager as unknown as ManagerInternals
  internals.currentConfig = { enabled: true, servers: { fs: stdioCfg({ enabled: false }) } }

  // Stale snapshot from when the start began (enabled=true) — the server has
  // since been disabled. Must not record an attempt or schedule a timer.
  ;(manager as any).scheduleRestart("fs", stdioCfg({ enabled: true }), "start failed")

  assert.equal(internals.restartAttempts.has("fs"), false)
  assert.equal(internals.restartTimers.has("fs"), false)
  await manager.shutdown()
})

test("scheduleRestart: stale cfg bails when server was removed from live config", async () => {
  const manager = new McpManager()
  const internals = manager as unknown as ManagerInternals
  internals.currentConfig = { enabled: true, servers: {} }

  ;(manager as any).scheduleRestart("fs", stdioCfg({ enabled: true }), "start failed")

  assert.equal(internals.restartAttempts.has("fs"), false)
  assert.equal(internals.restartTimers.has("fs"), false)
  await manager.shutdown()
})

test("scheduleRestart: restart timer restarts with the LIVE config, not the stale closure", async () => {
  const manager = new McpManager()
  const internals = manager as unknown as ManagerInternals
  const liveCfg = stdioCfg({
    command: "uvx", // changed since the failed start
    restart_policy: { max_restarts: 5, backoff_base_ms: 20, backoff_max_ms: 30 },
  })
  internals.currentConfig = { enabled: true, servers: { fs: liveCfg } }

  let startedWith: McpServerConfig | undefined
  const realStart = manager.startClient.bind(manager)
  ;(manager as any).startClient = async (name: string, cfg: McpServerConfig) => {
    startedWith = cfg
    // Do not actually spawn — just observe which config the restart used.
    void realStart
  }

  try {
    ;(manager as any).scheduleRestart("fs", stdioCfg({ command: "npx" }), "start failed")
    await sleep(200)
    assert.equal(startedWith, liveCfg,
      "restart must use the live config object (current command), not the stale startup snapshot")
  } finally {
    await manager.shutdown()
  }
})

// =============================================================================
// #289-5: readResource / getPrompt timeouts abort the SDK handler
//         (aligned with callTool's AbortController — no dangling handlers)
// =============================================================================

test("client.readResource: timeout aborts the SDK request via AbortSignal", async () => {
  const client = new McpClient("fs", stdioCfg({ call_timeout_ms: 50 }))
  let receivedSignal: AbortSignal | undefined
  ;(client as any).client = {
    readResource: (_params: any, opts: any) => {
      receivedSignal = opts?.signal
      return new Promise((_, reject) => {
        opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })
    },
  }
  ;(client as any)._capabilities = { tools: false, resources: true, prompts: false }

  await assert.rejects(
    () => client.readResource("file:///x"),
    /MCP timeout: read_resource/,
  )
  assert.ok(receivedSignal, "SDK call must receive an AbortSignal (like callTool)")
  assert.equal(receivedSignal!.aborted, true,
    "timeout must abort the signal so the SDK drops the in-flight handler")
})

test("client.getPrompt: timeout aborts the SDK request via AbortSignal", async () => {
  const client = new McpClient("fs", stdioCfg({ call_timeout_ms: 50 }))
  let receivedSignal: AbortSignal | undefined
  ;(client as any).client = {
    getPrompt: (_params: any, opts: any) => {
      receivedSignal = opts?.signal
      return new Promise((_, reject) => {
        opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })
    },
  }
  ;(client as any)._capabilities = { tools: false, resources: false, prompts: true }

  await assert.rejects(
    () => client.getPrompt("p1"),
    /MCP timeout: get_prompt/,
  )
  assert.ok(receivedSignal, "SDK call must receive an AbortSignal (like callTool)")
  assert.equal(receivedSignal!.aborted, true,
    "timeout must abort the signal so the SDK drops the in-flight handler")
})
