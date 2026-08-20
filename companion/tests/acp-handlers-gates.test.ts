import "./_acp-gates-setup" // MUST be first — pins DATA_DIR before config/handlers import

import { describe, it, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { handleAcpWsMessage } from "../src/acp/handlers"
import { getAcpManager, _resetAcpManagerForTests } from "../src/acp/manager"
import * as protocolSession from "../src/acp/protocol-session"
import { getConfig, initDataDir, saveConfig } from "../src/config"

describe("acp WS gates", () => {
  before(async () => {
    await initDataDir()
  })

  beforeEach(() => {
    _resetAcpManagerForTests()
    // Master switch off for gate tests (independent of developer home config)
    saveConfig({
      acp: {
        enabled: false,
        servers: {},
        policy: {
          require_workspace: true,
          force_confirm_session_start: true,
          default_profile: "review_readonly",
        },
      },
    })
    assert.equal(getConfig().acp?.enabled, false)
  })

  it("ui_start fails closed when acp disabled", async () => {
    const r = await handleAcpWsMessage(
      "acp.ui_start",
      {
        thread_id: "t1",
        agent_id: "claude",
        goal: "review",
        cloud_disclosure_accepted: true,
        workspace_root: "/tmp/acp-gate-ws",
      },
      {
        requestConfirmation: async () => ({ approved: true } as any),
      },
    )
    assert.equal(r.type, "error")
    assert.match(String(r.error), /disabled/i)
  })

  it("apply_diff fails without session", async () => {
    const r = await handleAcpWsMessage(
      "acp.apply_diff",
      { session_id: "nope" },
      {
        requestConfirmation: async () => ({ approved: true } as any),
      },
    )
    assert.equal(r.type, "error")
  })

  it("cancel unknown session errors", async () => {
    const r = await handleAcpWsMessage("acp.session.cancel", { session_id: "x" }, {})
    assert.equal(r.type, "error")
  })

  it("list returns shape when disabled (agents still discoverable)", async () => {
    // Discovery is independent of master switch — empty only if nothing on PATH/config.
    // Spawn remains gated by enabled; list must not pretend "not found" when off.
    const r = await handleAcpWsMessage("acp.list", {}, {})
    assert.equal(r.type, "acp.list")
    assert.equal(r.enabled, false)
    assert.ok(Array.isArray(r.agents))
    // May be non-empty if claude/pi etc. are installed on the test host.
    for (const a of r.agents) {
      assert.ok(a.id)
      assert.ok(a.display_name)
      assert.ok(typeof a.command === "string")
    }
  })

  it("ui_start refuses worker threads", async () => {
    // Worker check is before enabled gate — no home DATA_DIR needed
    const r = await handleAcpWsMessage(
      "acp.ui_start",
      {
        thread_id: "worker-1",
        agent_id: "claude",
        goal: "review",
        cloud_disclosure_accepted: true,
      },
      {
        getAgentRole: () => "worker",
        requestConfirmation: async () => ({ approved: true } as any),
      },
    )
    assert.equal(r.type, "error")
    assert.match(String(r.error), /worker/i)
  })

  it("ui_start requires cloud_disclosure_accepted", async () => {
    const r = await handleAcpWsMessage(
      "acp.ui_start",
      {
        thread_id: "t1",
        agent_id: "claude",
        goal: "review",
      },
      {
        requestConfirmation: async () => ({ approved: true } as any),
      },
    )
    assert.equal(r.type, "error")
    assert.match(String(r.error), /cloud_disclosure/i)
  })

  it("session.prompt requires session_id and text", async () => {
    const r = await handleAcpWsMessage(
      "acp.session.prompt",
      { session_id: "", text: "" },
      {},
    )
    assert.equal(r.type, "error")
  })

  it("propose snapshots open_local_terminal for Mode C TOCTOU (not live config after)", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-mode-c-snap-"))
    try {
      saveConfig({
        acp: {
          enabled: true,
          servers: {
            echo: {
              enabled: true,
              display_name: "Echo",
              transport: "stdio",
              command: process.execPath,
              args: ["-e", "process.exit(0)"],
              protocol: "cli",
              policy: {
                profile: "review_readonly",
                allow_write: false,
                allow_exec: false,
              },
            },
          },
          policy: {
            require_workspace: true,
            force_confirm_session_start: true,
            default_profile: "review_readonly",
          },
        },
        coding_handoff: { open_local_terminal: true, auto_suggest: true },
      })
      assert.equal(getConfig().coding_handoff?.open_local_terminal, true)

      const mgr = getAcpManager()
      const proposed = mgr.propose({
        threadId: "t-mode-c",
        agentId: "echo",
        goal: "snapshot test",
        workspaceRoot: dir,
      })
      assert.equal(proposed.ok, true)
      if (!proposed.ok) return
      assert.equal(proposed.session.open_local_terminal_snapshot, true)

      // Flip live config after propose (simulate post-L2 toggle) — snapshot must hold.
      saveConfig({
        coding_handoff: { open_local_terminal: false, auto_suggest: true },
      })
      assert.equal(getConfig().coding_handoff?.open_local_terminal, false)
      const still = mgr.getSession(proposed.session.session_id)
      assert.equal(still?.open_local_terminal_snapshot, true)

      // L2 copy must still mention Mode C from snapshot, not live false
      const { formatAcpStartConfirmCode } = await import("../src/acp/confirm-copy")
      const code = formatAcpStartConfirmCode({
        agentLabel: "Echo",
        mode: still!.mode,
        workspaceRoot: still!.workspace_root,
        goal: still!.goal,
        sessionId: still!.session_id,
        openLocalTerminal: still!.open_local_terminal_snapshot === true,
      })
      assert.match(code, /模式 C/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      saveConfig({
        acp: {
          enabled: false,
          servers: {},
          policy: {
            require_workspace: true,
            force_confirm_session_start: true,
            default_profile: "review_readonly",
          },
        },
        coding_handoff: { open_local_terminal: false },
      })
    }
  })

  it("propose snapshots open_local_terminal=false so post-confirm enable cannot open terminal", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-mode-c-off-"))
    try {
      saveConfig({
        acp: {
          enabled: true,
          servers: {
            echo: {
              enabled: true,
              display_name: "Echo",
              transport: "stdio",
              command: process.execPath,
              args: ["-e", "process.exit(0)"],
              protocol: "cli",
              policy: {
                profile: "review_readonly",
                allow_write: false,
                allow_exec: false,
              },
            },
          },
          policy: {
            require_workspace: true,
            force_confirm_session_start: true,
            default_profile: "review_readonly",
          },
        },
        coding_handoff: { open_local_terminal: false },
      })
      const mgr = getAcpManager()
      const proposed = mgr.propose({
        threadId: "t-mode-c-off",
        agentId: "echo",
        goal: "no terminal",
        workspaceRoot: dir,
      })
      assert.equal(proposed.ok, true)
      if (!proposed.ok) return
      assert.equal(proposed.session.open_local_terminal_snapshot, false)

      saveConfig({ coding_handoff: { open_local_terminal: true } })
      assert.equal(getConfig().coding_handoff?.open_local_terminal, true)
      assert.equal(
        mgr.getSession(proposed.session.session_id)?.open_local_terminal_snapshot,
        false,
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      saveConfig({
        acp: {
          enabled: false,
          servers: {},
          policy: {
            require_workspace: true,
            force_confirm_session_start: true,
            default_profile: "review_readonly",
          },
        },
        coding_handoff: { open_local_terminal: false },
      })
    }
  })
})

describe("acp manager protocol argv wiring", () => {
  before(async () => {
    await initDataDir()
  })

  beforeEach(() => {
    _resetAcpManagerForTests()
  })

  it("start() passes resolveProtocolArgs(session.agent_id, server.args) to the protocol session", async (t) => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-proto-args-"))
    const agents = ["kimi", "opencode", "claude", "grok"] as const
    const expected: Record<string, string[]> = {
      kimi: ["acp"],
      opencode: ["acp"],
      claude: [],
      grok: [],
    }
    try {
      saveConfig({
        acp: {
          enabled: true,
          servers: Object.fromEntries(
            agents.map((id) => [
              id,
              {
                enabled: true,
                display_name: id,
                transport: "stdio" as const,
                command: process.execPath,
                args: [],
                policy: {
                  profile: "review_readonly" as const,
                  allow_write: false,
                  allow_exec: false,
                },
              },
            ]),
          ),
          policy: {
            require_workspace: true,
            force_confirm_session_start: true,
            default_profile: "review_readonly",
          },
        },
        coding_handoff: { open_local_terminal: false },
      })

      // Intercept the ACP handshake: record argv, return a fake handle so the
      // manager takes the transport="acp" path without spawning a real process.
      const captured: Array<{ agentId: string; args: string[] }> = []
      t.mock.method(
        protocolSession as any,
        "tryStartProtocolSession",
        async (opts: any) => {
          captured.push({ agentId: opts.session.agent_id, args: [...opts.args] })
          return {
            child: { pid: 43210 },
            client: null,
            agentSessionId: "agent-sess-stub",
            transport: "acp",
            prompt: async () => {},
            cancel: () => {},
            kill: () => {},
          }
        },
      )

      const mgr = getAcpManager()
      for (const agentId of agents) {
        const proposed = mgr.propose({
          threadId: `t-proto-${agentId}`,
          agentId,
          goal: "wiring check",
          workspaceRoot: dir,
        })
        assert.equal(proposed.ok, true, `propose ${agentId}`)
        if (!proposed.ok) continue
        const started = await mgr.start(proposed.session.session_id)
        assert.equal(started.ok, true, `start ${agentId}`)
        assert.equal(proposed.session.transport, "acp", `${agentId} must take the ACP path`)
      }

      assert.deepEqual(
        captured.map((c) => c.agentId).sort(),
        [...agents].sort(),
        "every agent reached the protocol session",
      )
      for (const c of captured) {
        assert.deepEqual(c.args, expected[c.agentId], `protocol argv for ${c.agentId}`)
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      saveConfig({
        acp: {
          enabled: false,
          servers: {},
          policy: {
            require_workspace: true,
            force_confirm_session_start: true,
            default_profile: "review_readonly",
          },
        },
      })
    }
  })
})
