/**
 * Pure helpers from tool/l2-admission.ts (C10 Phase B).
 * Matrix-ready stubs — no WS / no confirm manager.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  isFullAutonomyCruise,
  isHostComputerPlatformGated,
  isHostAppPlatformGated,
  isHostCliPlatformGated,
  isAcpL2ForceTool,
  resolveL2ForceConfirm,
  hostComputerTrustSkipAlgebraOpen,
  hostComputerConfirmRelevantApps,
  L2_GATE_TOOLS,
} from "../src/tool/l2-admission"

describe("isFullAutonomyCruise", () => {
  it("true only when all three flags are true", () => {
    assert.equal(
      isFullAutonomyCruise({
        auto_approve_dangerous: true,
        auto_approve_enterprise_tools: true,
        allow_all_schemes: true,
      }),
      true,
    )
  })

  it("false when any flag missing or false", () => {
    assert.equal(
      isFullAutonomyCruise({
        auto_approve_dangerous: true,
        auto_approve_enterprise_tools: true,
        allow_all_schemes: false,
      }),
      false,
    )
    assert.equal(
      isFullAutonomyCruise({
        auto_approve_dangerous: true,
        auto_approve_enterprise_tools: false,
        allow_all_schemes: true,
      }),
      false,
    )
    assert.equal(
      isFullAutonomyCruise({
        auto_approve_dangerous: false,
        auto_approve_enterprise_tools: true,
        allow_all_schemes: true,
      }),
      false,
    )
    assert.equal(isFullAutonomyCruise({}), false)
    assert.equal(
      isFullAutonomyCruise({
        auto_approve_dangerous: true,
        auto_approve_enterprise_tools: true,
      }),
      false,
    )
  })
})

describe("host platform gated helpers", () => {
  it("win32 and darwin gated for computer/app/cli", () => {
    for (const p of ["win32", "darwin"] as const) {
      assert.equal(isHostComputerPlatformGated(p), true)
      assert.equal(isHostAppPlatformGated(p), true)
      assert.equal(isHostCliPlatformGated(p), true)
    }
  })

  it("linux and other platforms not gated", () => {
    for (const p of ["linux", "freebsd", "aix"] as const) {
      assert.equal(isHostComputerPlatformGated(p), false)
      assert.equal(isHostAppPlatformGated(p), false)
      assert.equal(isHostCliPlatformGated(p), false)
    }
  })
})

describe("ACP L2 forceConfirm (cruise cannot skip)", () => {
  it("L2_GATE_TOOLS includes all acp_* force tools", () => {
    for (const t of [
      "acp_propose_session",
      "acp_start_session",
      "acp_apply_diff",
    ] as const) {
      assert.ok(L2_GATE_TOOLS.includes(t), t)
      assert.equal(isAcpL2ForceTool(t), true)
    }
    assert.equal(isAcpL2ForceTool("shell_exec"), false)
  })

  it("resolveL2ForceConfirm stays true for ACP under full autonomy cruise", () => {
    for (const toolName of [
      "acp_propose_session",
      "acp_start_session",
      "acp_apply_diff",
    ]) {
      assert.equal(
        resolveL2ForceConfirm({
          toolName,
          capabilityForceConfirm: true,
          hostComputerGated: false,
          userFullAutonomy: true,
        }),
        true,
        `${toolName} must not waive under cruise`,
      )
      // RN dual-review: hostComputerGated does not change ACP short-circuit
      assert.equal(
        resolveL2ForceConfirm({
          toolName,
          capabilityForceConfirm: false,
          hostComputerGated: true,
          userFullAutonomy: true,
        }),
        true,
      )
    }
  })

  it("vault-browser one-shot never enters G1/unattended skip algebra and offers no G1 checkbox", () => {
    assert.equal(hostComputerTrustSkipAlgebraOpen(true), false)
    assert.equal(hostComputerTrustSkipAlgebraOpen(false), true)
    assert.deepEqual(hostComputerConfirmRelevantApps(true, "mac.app.google_chrome"), [])
    assert.deepEqual(hostComputerConfirmRelevantApps(false, "mac.app.google_chrome"), [
      "mac.app.google_chrome",
    ])
    assert.deepEqual(hostComputerConfirmRelevantApps(false, ""), [])
    assert.deepEqual(hostComputerConfirmRelevantApps(false, undefined), [])
  })

  it("vault-browser host_computer one-shot never waives under full autonomy cruise", () => {
    assert.equal(
      resolveL2ForceConfirm({
        toolName: "host_computer",
        capabilityForceConfirm: false,
        hostComputerGated: true,
        userFullAutonomy: true,
        vaultBrowserOneShot: true,
      }),
      true,
    )
    assert.equal(
      resolveL2ForceConfirm({
        toolName: "host_computer",
        capabilityForceConfirm: false,
        hostComputerGated: true,
        userFullAutonomy: true,
        vaultBrowserOneShot: false,
      }),
      false,
    )
  })

  it("non-ACP capability tools waive under full autonomy cruise", () => {
    assert.equal(
      resolveL2ForceConfirm({
        toolName: "evaluate",
        capabilityForceConfirm: true,
        userFullAutonomy: true,
      }),
      false,
    )
    assert.equal(
      resolveL2ForceConfirm({
        toolName: "evaluate",
        capabilityForceConfirm: true,
        userFullAutonomy: false,
      }),
      true,
    )
  })
})

describe("L2_GATE_TOOLS", () => {
  it("includes core L2 tools", () => {
    for (const t of [
      "evaluate",
      "osascript_eval",
      "host_read",
      "host_write",
      "shell_exec",
      "netsec_port_scan",
      "spawn_worker",
      "ask_user",
      "board_complete",
      "skill_install",
    ]) {
      assert.ok(L2_GATE_TOOLS.includes(t), `expected ${t} in L2_GATE_TOOLS`)
    }
  })
})
