/**
 * SEC-B: mcp.add/update stdio requires L2 confirmation.
 */
import test, { before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mcp-l2-"))

let initDataDir: typeof import("../src/config").initDataDir
let getConfig: typeof import("../src/config").getConfig
let handleMessage: typeof import("../src/message-router").handleMessage
let redactMcpServersForBroadcast: typeof import("../src/message-router").redactMcpServersForBroadcast

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
  delete process.env.DEEPSEEK_API_KEY
  const config = await import("../src/config")
  const mr = await import("../src/message-router")
  initDataDir = config.initDataDir
  getConfig = config.getConfig
  handleMessage = mr.handleMessage
  redactMcpServersForBroadcast = mr.redactMcpServersForBroadcast
  await initDataDir()
})

const stdioServer = {
  transport: "stdio" as const,
  command: "/bin/echo",
  args: ["hello"],
  trust_level: "manual" as const,
  enabled: true,
}

test("mcp.add stdio without requestConfirmation is denied", async () => {
  const res = await handleMessage(
    { type: "mcp.add", name: "evil1", server: stdioServer },
    { threadManager: {} as any, skillEngine: {} as any, historyStore: {} as any },
  )
  assert.equal(res.type, "error")
  assert.match(String(res.error), /L2 confirmation|requestConfirmation/i)
  assert.equal(getConfig().mcp?.servers?.evil1, undefined)
})

test("mcp.add stdio denied when user rejects L2", async () => {
  const res = await handleMessage(
    { type: "mcp.add", name: "evil2", server: stdioServer },
    { threadManager: {} as any, skillEngine: {} as any, historyStore: {} as any },
    {
      sendToExtension: () => {},
      executeTool: async () => ({ success: false }),
      requestConfirmation: async () => ({
        confirmationId: "x",
        approved: false,
        reason: "denied",
      }),
    },
  )
  assert.equal(res.type, "error")
  assert.match(String(res.error), /denied/i)
  assert.equal(getConfig().mcp?.servers?.evil2, undefined)
})

test("mcp.add stdio succeeds after L2 approve", async () => {
  let sawConfirm = false
  const res = await handleMessage(
    { type: "mcp.add", name: "okstdio", server: stdioServer },
    { threadManager: {} as any, skillEngine: {} as any, historyStore: {} as any },
    {
      sendToExtension: () => {},
      executeTool: async () => ({ success: false }),
      requestConfirmation: async (details) => {
        sawConfirm = true
        assert.equal(details.riskLevel, "high")
        assert.ok(details.criticalApis?.includes("mcp.stdio.spawn"))
        assert.match(details.code, /\/bin\/echo/)
        return { confirmationId: "y", approved: true, reason: "approved" }
      },
    },
  )
  assert.equal(sawConfirm, true)
  assert.equal(res.type, "mcp.servers.updated")
  assert.ok(getConfig().mcp?.servers?.okstdio)
  // Response must not leak env secrets if present
  const servers = res.servers as any[]
  assert.ok(Array.isArray(servers))
})

test("mcp.add http does not require stdio L2", async () => {
  const res = await handleMessage(
    {
      type: "mcp.add",
      name: "http1",
      server: {
        transport: "http",
        url: "https://example.com/mcp",
        trust_level: "manual",
        enabled: true,
        headers: { Authorization: "Bearer SUPERSECRET" },
      },
    },
    { threadManager: {} as any, skillEngine: {} as any, historyStore: {} as any },
  )
  // No session → ok for http (no local spawn)
  assert.equal(res.type, "mcp.servers.updated")
  const listed = (res.servers as any[]).find((s) => s.name === "http1" || s.config)
  // Redacted headers on wire
  const redacted = redactMcpServersForBroadcast([
    {
      name: "http1",
      config: {
        transport: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer SUPERSECRET" },
      },
    },
  ])
  assert.equal(redacted[0].config.headers.Authorization, "***")
  assert.ok(!JSON.stringify(redacted).includes("SUPERSECRET"))
})

test("redactMcpServersForBroadcast masks env", () => {
  const out = redactMcpServersForBroadcast([
    {
      name: "s",
      config: { transport: "stdio", command: "npx", env: { API_KEY: "k-secret" } },
    },
  ])
  assert.equal(out[0].config.env.API_KEY, "***")
  assert.ok(!JSON.stringify(out).includes("k-secret"))
})

test("mcp.update enabled-only on disabled stdio requires L2", async () => {
  // Seed a disabled stdio server via approve path
  await handleMessage(
    {
      type: "mcp.add",
      name: "disabledstdio",
      server: { ...stdioServer, enabled: false },
    },
    { threadManager: {} as any, skillEngine: {} as any, historyStore: {} as any },
    {
      sendToExtension: () => {},
      executeTool: async () => ({ success: false }),
      requestConfirmation: async () => ({
        confirmationId: "z",
        approved: true,
        reason: "approved",
      }),
    },
  )
  assert.equal(getConfig().mcp?.servers?.disabledstdio?.enabled, false)

  const res = await handleMessage(
    { type: "mcp.update", name: "disabledstdio", patch: { enabled: true } },
    { threadManager: {} as any, skillEngine: {} as any, historyStore: {} as any },
    // no requestConfirmation → must fail closed
  )
  assert.equal(res.type, "error")
  assert.match(String(res.error), /L2 confirmation|requestConfirmation/i)
  assert.equal(getConfig().mcp?.servers?.disabledstdio?.enabled, false)
})

test("mcp.update preserves secrets when client sends ***", async () => {
  await handleMessage(
    {
      type: "mcp.add",
      name: "secretenv",
      server: {
        ...stdioServer,
        env: { API_KEY: "real-secret-value" },
      },
    },
    { threadManager: {} as any, skillEngine: {} as any, historyStore: {} as any },
    {
      sendToExtension: () => {},
      executeTool: async () => ({ success: false }),
      requestConfirmation: async () => ({
        confirmationId: "s",
        approved: true,
        reason: "approved",
      }),
    },
  )
  // Trust-only update with redacted env echo (no spawn surface change except env keys as ***)
  const res = await handleMessage(
    {
      type: "mcp.update",
      name: "secretenv",
      patch: {
        trust_level: "trusted",
        env: { API_KEY: "***" },
      },
    },
    { threadManager: {} as any, skillEngine: {} as any, historyStore: {} as any },
  )
  assert.equal(res.type, "mcp.servers.updated")
  const stored = getConfig().mcp?.servers?.secretenv as any
  assert.equal(stored.env?.API_KEY, "real-secret-value")
  assert.equal(stored.trust_level, "trusted")
})
