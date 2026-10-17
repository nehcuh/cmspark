/** Existing MCP mutations must not revive a target changed during confirmation. */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import type { McpServerConfig } from "../src/mcp/types"

const dataDir = mkdtempSync(path.join(tmpdir(), "cmspark-mcp-pending-476-"))
const originalDataDir = process.env.CMSPARK_DATA_DIR
let config: typeof import("../src/config")
let handle: typeof import("../src/message-router/handlers/mcp").handleMcpFamily
before(async () => {
  process.env.CMSPARK_DATA_DIR = dataDir
  config = await import("../src/config")
  handle = (await import("../src/message-router/handlers/mcp")).handleMcpFamily
})
after(() => {
  if (originalDataDir === undefined) delete process.env.CMSPARK_DATA_DIR
  else process.env.CMSPARK_DATA_DIR = originalDataDir
  rmSync(dataDir, { recursive: true, force: true })
})
const server = (command: string, enabled = true): Extract<McpServerConfig, { transport: "stdio" }> => ({
  transport: "stdio", command, args: [], trust_level: "manual", enabled,
})
function command(value: McpServerConfig): string {
  assert.ok(value.transport === "stdio")
  return value.command
}
const original = server("owned_inert_original")
const sibling = server("owned_inert_sibling_old")
const threadManager = { get: (_id: string) => undefined, update: (_id: string, _patch: any) => undefined }

type Servers = Record<string, McpServerConfig>
async function pending(
  type: string, input: any, initial: Servers, mutate: () => void,
  approved = true,
) {
  config.replaceMcpServers(structuredClone(initial))
  const listeners = config.configEvents.listenerCount(config.CONFIG_CHANGE_EVENT)
  let release!: (value: { approved: boolean; reason: "user-approved" | "user-denied" }) => void
  let asked = 0
  const decision = new Promise<any>(resolve => { release = resolve })
  const response = handle(type, input, {
    requestConfirmation: async () => { asked++; return decision },
  }, threadManager)
  assert.equal(asked, 1)
  mutate()
  // An injected decision exercises the real handler; it is not a human/native approval.
  release({ approved, reason: approved ? "user-approved" : "user-denied" })
  const result = await response
  assert.equal(config.configEvents.listenerCount(config.CONFIG_CHANGE_EVENT), listeners)
  const current = config.getConfig().mcp!.servers
  const disk = JSON.parse(readFileSync(path.join(dataDir, "config.json"), "utf8"))
  assert.deepEqual(current, disk.mcp.servers)
  return { current, result }
}

for (const kind of ["remove", "disable", "ABA", "sibling"] as const) {
  test(`MCP pending update preserves ${kind}`, async () => {
    const { current, result } = await pending("mcp.update", {
      name: "owned_a", patch: { command: "owned_inert_approved" },
    }, { owned_a: original, owned_b: sibling }, () => {
      if (kind === "remove" || kind === "ABA") config.replaceMcpServers({ owned_b: sibling })
      if (kind === "disable") config.replaceMcpServers({ owned_a: server(original.command, false), owned_b: sibling })
      if (kind === "ABA") config.replaceMcpServers({ owned_a: original, owned_b: sibling })
      if (kind === "sibling") config.replaceMcpServers({ owned_a: original, owned_b: server("owned_inert_sibling_new") })
    })
    if (kind === "sibling") {
      assert.equal(result.type, "mcp.servers.updated")
      assert.equal(command(current.owned_a), "owned_inert_approved")
      assert.equal(command(current.owned_b), "owned_inert_sibling_new")
    } else {
      assert.equal(result.type, "error")
      if (kind === "remove") assert.equal(current.owned_a, undefined)
      if (kind === "disable") assert.equal(current.owned_a.enabled, false)
      if (kind === "ABA") assert.equal(command(current.owned_a), original.command)
    }
  })
}
for (const kind of ["target", "sibling"] as const) {
  test(`MCP pending add preserves ${kind}`, async () => {
    const { current, result } = await pending("mcp.add", {
      name: "owned_a", server: server("owned_inert_approved"),
    }, { owned_b: sibling }, () => config.replaceMcpServers(kind === "target"
      ? { owned_a: server("owned_inert_other_owner"), owned_b: sibling }
      : { owned_b: server("owned_inert_sibling_new") }))
    if (kind === "target") {
      assert.equal(result.type, "error")
      assert.equal(command(current.owned_a), "owned_inert_other_owner")
    } else {
      assert.equal(result.type, "mcp.servers.updated")
      assert.equal(command(current.owned_a), "owned_inert_approved")
      assert.equal(command(current.owned_b), "owned_inert_sibling_new")
    }
  })
}
for (const kind of ["remove", "target", "sibling"] as const) {
  test(`MCP pending enable preserves ${kind}`, async () => {
    const disabled = server(original.command, false)
    const { current, result } = await pending("mcp.toggle_server", {
      name: "owned_a", enabled: true,
    }, { owned_a: disabled, owned_b: sibling }, () => config.replaceMcpServers(kind === "remove"
      ? { owned_b: sibling }
      : kind === "target"
        ? { owned_a: server("owned_inert_other_owner", false), owned_b: sibling }
        : { owned_a: disabled, owned_b: server("owned_inert_sibling_new") }))
    if (kind === "sibling") {
      assert.equal(result.type, "mcp.servers.updated")
      assert.equal(current.owned_a.enabled, true)
      assert.equal(command(current.owned_b), "owned_inert_sibling_new")
    } else {
      assert.equal(result.type, "error")
      if (kind === "remove") assert.equal(current.owned_a, undefined)
      else {
        assert.equal(command(current.owned_a), "owned_inert_other_owner")
        assert.equal(current.owned_a.enabled, false)
      }
    }
  })
}
test("MCP pending approval retains ordinary success and denial", async () => {
  for (const approved of [false, true]) {
    const { current, result } = await pending("mcp.update", {
      name: "owned_a", patch: { command: "owned_inert_approved" },
    }, { owned_a: original }, () => {}, approved)
    assert.equal(result.type, approved ? "mcp.servers.updated" : "error")
    assert.equal(command(current.owned_a), approved ? "owned_inert_approved" : original.command)
  }
})

test("MCP pending update rejects an observed global disable and ABA", async () => {
  for (const restore of [false, true]) {
    const { current, result } = await pending("mcp.update", {
      name: "owned_a", patch: { command: "owned_inert_approved" },
    }, { owned_a: original }, () => {
      const enabled = config.getConfig().mcp!.enabled
      config.setMcpEnabled(!enabled)
      if (restore) config.setMcpEnabled(enabled)
    })
    assert.equal(result.type, "error")
    assert.equal(command(current.owned_a), original.command)
  }
})
test("MCP pending action owns its arguments rather than the mutable caller array", async () => {
  const input = { name: "owned_a", patch: { args: ["owned_reviewed_arg"] } }
  const { current, result } = await pending("mcp.update", input, { owned_a: original }, () => {
    input.patch.args[0] = "owned_changed_after_prompt"
  })
  assert.equal(result.type, "mcp.servers.updated")
  assert.ok(current.owned_a.transport === "stdio")
  assert.deepEqual(current.owned_a.args, ["owned_reviewed_arg"])
})
test("MCP pending confirmation rejection releases its listener without a write", async () => {
  config.replaceMcpServers({ owned_a: original })
  const listeners = config.configEvents.listenerCount(config.CONFIG_CHANGE_EVENT)
  await assert.rejects(handle("mcp.update", {
    name: "owned_a", patch: { command: "owned_inert_approved" },
  }, { requestConfirmation: async () => { throw new Error("OWNED_CONFIRM_REJECT") } }, threadManager), /OWNED_CONFIRM_REJECT/)
  assert.equal(config.configEvents.listenerCount(config.CONFIG_CHANGE_EVENT), listeners)
  assert.equal(command(config.getConfig().mcp!.servers.owned_a), original.command)
})
