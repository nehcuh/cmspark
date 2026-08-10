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
