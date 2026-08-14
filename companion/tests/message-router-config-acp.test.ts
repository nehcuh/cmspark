// P0-1 / P1-1: config.set ACP allow-list — only boolean `enabled`;
// servers/policy must not be writable via config.set (adopt/disk only).

import "./_config-router-setup" // MUST be first — pins DATA_DIR before config import.

import test, { before } from "node:test"
import * as assert from "node:assert/strict"

let handleMessage: typeof import("../src/message-router").handleMessage
let getConfig: typeof import("../src/config").getConfig
let saveConfig: typeof import("../src/config").saveConfig
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  const mr = await import("../src/message-router")
  const cfg = await import("../src/config")
  handleMessage = mr.handleMessage
  getConfig = cfg.getConfig
  saveConfig = cfg.saveConfig
  initDataDir = cfg.initDataDir
  await initDataDir()
})

async function postConfigSet(config: Record<string, unknown>) {
  return handleMessage({ type: "config.set", config } as any, {} as any)
}

const SEED_SERVER = {
  enabled: true,
  display_name: "Seed Agent",
  transport: "stdio" as const,
  protocol: "auto" as const,
  command: "/usr/local/bin/seed-agent",
  args: ["--review"],
  policy: {
    profile: "review_readonly" as const,
    session_timeout_ms: 15 * 60_000,
    max_handback_chars: 48_000,
    allow_write: false,
    allow_exec: false,
  },
  startup_timeout_ms: 30_000,
}

function seedAcpWithServer() {
  saveConfig({
    acp: {
      enabled: false,
      servers: {
        seed: SEED_SERVER,
      },
      policy: {
        require_workspace: true,
        force_confirm_session_start: true,
        default_profile: "review_readonly",
      },
    },
  })
  const acp = getConfig().acp
  assert.equal(acp?.enabled, false)
  assert.ok(acp?.servers?.seed, "seed server must exist before assertions")
  assert.equal(acp!.servers!.seed!.command, "/usr/local/bin/seed-agent")
}

test("config.set: acp.enabled=true flips enabled and PRESERVES existing servers", async () => {
  seedAcpWithServer()
  const r: any = await postConfigSet({ acp: { enabled: true } })
  assert.equal(r.type, "config.updated")
  const acp = getConfig().acp
  assert.equal(acp?.enabled, true, "enabled must flip to true")
  assert.ok(acp?.servers?.seed, "existing servers must be preserved")
  assert.equal(
    acp!.servers!.seed!.command,
    "/usr/local/bin/seed-agent",
    "seed command must survive enabled-only config.set",
  )
})

test("config.set: acp.servers evil payload is IGNORED (does not persist command)", async () => {
  seedAcpWithServer()
  const r: any = await postConfigSet({
    acp: {
      enabled: true,
      servers: {
        evil: { command: "/tmp/x", display_name: "Evil" },
      },
    },
  })
  assert.equal(r.type, "config.updated")
  const acp = getConfig().acp
  assert.equal(acp?.enabled, true, "boolean enabled still applied")
  assert.equal(
    acp?.servers?.evil,
    undefined,
    "evil server must not be accepted via config.set",
  )
  assert.ok(acp?.servers?.seed, "seed server must remain")
  assert.equal(acp!.servers!.seed!.command, "/usr/local/bin/seed-agent")
  // Ensure no server command is /tmp/x
  for (const s of Object.values(acp?.servers || {})) {
    assert.notEqual((s as { command?: string }).command, "/tmp/x")
  }
})

test("config.set: non-boolean acp.enabled is ignored", async () => {
  seedAcpWithServer()
  assert.equal(getConfig().acp?.enabled, false)
  const r: any = await postConfigSet({
    acp: { enabled: "yes" as unknown as boolean },
  })
  assert.equal(r.type, "config.updated")
  assert.equal(getConfig().acp?.enabled, false, "string enabled must not flip master switch")
  assert.ok(getConfig().acp?.servers?.seed, "servers unchanged")
})

test("config.set: acp.policy-only payload does not mutate policy", async () => {
  seedAcpWithServer()
  const before = JSON.stringify(getConfig().acp?.policy)
  const r: any = await postConfigSet({
    acp: {
      policy: {
        require_workspace: false,
        force_confirm_session_start: false,
      },
    },
  })
  assert.equal(r.type, "config.updated")
  assert.equal(JSON.stringify(getConfig().acp?.policy), before, "policy must not change via config.set")
  assert.equal(getConfig().acp?.enabled, false)
})
