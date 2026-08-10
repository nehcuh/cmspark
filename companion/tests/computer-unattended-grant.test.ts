/**
 * ADR-021 unattended desktop grant — pure gate + arm/disarm process memory.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  armUnattended,
  disarmUnattended,
  evaluateUnattendedHostComputerSkip,
  getUnattendedStatus,
  isUnattendedArmed,
  resetUnattendedGrantForTests,
  unattendedInitialSkipEligible,
  UNATTENDED_HARD_TTL_MS,
  UNATTENDED_DEFAULT_MAX_BUDGET,
} from "../src/computer/unattended-grant"
import { SECURITY_ARM_CONFIRM_PHRASE } from "../src/security-arm"

beforeEach(() => {
  resetUnattendedGrantForTests()
})

describe("unattendedInitialSkipEligible (pure)", () => {
  const base = {
    armed: true,
    coordinateAllowed: true,
    experimental: false,
    modelEnabled: false,
    credentialLatched: false,
    budget: 15,
    actionCount: 3,
    maxBudgetCap: 30,
    maxActionsCap: 30,
    now: 1_000_000,
    expiresAt: 1_000_000 + UNATTENDED_HARD_TTL_MS,
  }

  it("T1-1 unarmed → false", () => {
    assert.equal(unattendedInitialSkipEligible({ ...base, armed: false }), false)
  })

  it("T1-2 !coordinateAllowed → false", () => {
    assert.equal(unattendedInitialSkipEligible({ ...base, coordinateAllowed: false }), false)
  })

  it("T1-3 experimental does NOT block unattended (owner 2026-08 risk-accepted)", () => {
    assert.equal(unattendedInitialSkipEligible({ ...base, experimental: true }), true)
  })

  it("T1-4 modelEnabled does NOT block unattended (owner 2026-08 risk-accepted)", () => {
    assert.equal(unattendedInitialSkipEligible({ ...base, modelEnabled: true }), true)
  })

  it("T1-5 credential latch does NOT block unattended initial skip", () => {
    assert.equal(unattendedInitialSkipEligible({ ...base, credentialLatched: true }), true)
  })

  it("T1-6 armed+coord+caps → true", () => {
    assert.equal(unattendedInitialSkipEligible(base), true)
  })

  it("expired → false", () => {
    assert.equal(
      unattendedInitialSkipEligible({
        ...base,
        now: base.expiresAt,
      }),
      false,
    )
  })

  it("budget over cap → false", () => {
    assert.equal(unattendedInitialSkipEligible({ ...base, budget: 31 }), false)
  })

  it("budget zero → false", () => {
    assert.equal(unattendedInitialSkipEligible({ ...base, budget: 0 }), false)
  })
})

describe("arm / disarm process memory", () => {
  it("T1-8 bad phrase rejects", () => {
    const r = armUnattended({ confirmation_phrase: "wrong" })
    assert.equal(r.ok, false)
    assert.equal(isUnattendedArmed(), false)
  })

  it("T1-6b good phrase arms; status reflects TTL", () => {
    const now = 5_000_000
    const r = armUnattended({
      confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE,
      now,
    })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.status.armed, true)
    assert.equal(r.status.armedAt, now)
    assert.equal(r.status.expiresAt, now + UNATTENDED_HARD_TTL_MS)
    assert.equal(isUnattendedArmed(now), true)
    assert.equal(isUnattendedArmed(now + UNATTENDED_HARD_TTL_MS), false)
  })

  it("T1-10 disarm clears", () => {
    armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE })
    assert.equal(isUnattendedArmed(), true)
    const st = disarmUnattended()
    assert.equal(st.armed, false)
    assert.equal(isUnattendedArmed(), false)
  })

  it("include_protocol stored on grant", () => {
    const r = armUnattended({
      confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE,
      include_protocol: true,
    })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.status.includeProtocol, true)
  })
})

describe("task-abort-registry (disarm share)", () => {
  it("flipAllComputerTaskAborts flips seeded tasks", async () => {
    const { flipAllComputerTaskAborts, getComputerTaskAbortRegistry } = await import(
      "../src/computer/task-abort-registry"
    )
    const reg = getComputerTaskAbortRegistry()
    reg.clear()
    reg.set("t1", false)
    reg.set("t2", false)
    assert.equal(flipAllComputerTaskAborts(), 2)
    assert.equal(reg.get("t1"), true)
    assert.equal(reg.get("t2"), true)
    reg.clear()
  })
})

describe("securityPolicy purge on disarm residual", () => {
  it("purgeIssuedTokensForTool drops only matching tool", () => {
    const { SecurityPolicy } = require("../src/security-policy") as typeof import("../src/security-policy")
    const pol = new SecurityPolicy()
    const a = pol.issueTokenFor("host_computer", { app: "com.tencent.xinWeChat", task: "t", actions: [] })
    const b = pol.issueTokenFor("host_cli", { app: "mac.cli.echo", subcommand: "run", args: ["x"] })
    assert.equal(pol.purgeIssuedTokensForTool("host_computer"), 1)
    assert.equal(
      pol.validateTokenFor(a.token, "host_computer", { app: "com.tencent.xinWeChat", task: "t", actions: [] }),
      false,
    )
    assert.equal(
      pol.validateTokenFor(b.token, "host_cli", { app: "mac.cli.echo", subcommand: "run", args: ["x"] }),
      true,
    )
  })
})

describe("evaluateUnattendedHostComputerSkip live grant", () => {
  it("unarmed → false", () => {
    assert.equal(
      evaluateUnattendedHostComputerSkip({
        coordinateAllowed: true,
        experimental: false,
        modelEnabled: false,
        credentialLatched: false,
        budget: 10,
        actionCount: 1,
      }),
      false,
    )
  })

  it("armed + eligible → true", () => {
    armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE })
    assert.equal(
      evaluateUnattendedHostComputerSkip({
        coordinateAllowed: true,
        experimental: false,
        modelEnabled: false,
        credentialLatched: false,
        budget: 10,
        actionCount: 1,
      }),
      true,
    )
  })

  it("armed + modelEnabled still skips (owner 2026-08 risk-accepted)", () => {
    armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE })
    assert.equal(
      evaluateUnattendedHostComputerSkip({
        coordinateAllowed: true,
        experimental: false,
        modelEnabled: true,
        credentialLatched: false,
        budget: 10,
        actionCount: 1,
      }),
      true,
      "modelEnabled must not force confirm under armed unattended",
    )
  })

  it("reset clears between tests (T1-10 spirit)", () => {
    armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE })
    resetUnattendedGrantForTests()
    assert.equal(getUnattendedStatus().armed, false)
    assert.equal(UNATTENDED_DEFAULT_MAX_BUDGET, 30)
  })

  it("T3-1 first-shot eligible after arm (zero initial L2 predicate)", () => {
    // Simulates first host_computer after arm: open_within_app, no prior G1 corpus.
    armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE })
    assert.equal(
      evaluateUnattendedHostComputerSkip({
        coordinateAllowed: true,
        experimental: false,
        modelEnabled: false,
        credentialLatched: false,
        budget: 15,
        actionCount: 5,
      }),
      true,
      "armed unattended must allow initial skip for coord app",
    )
  })

  it("T3-2 non-coord app denied at predicate", () => {
    armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE })
    assert.equal(
      evaluateUnattendedHostComputerSkip({
        coordinateAllowed: false,
        experimental: false,
        modelEnabled: false,
        credentialLatched: false,
        budget: 15,
        actionCount: 1,
      }),
      false,
    )
  })

  it("T3-9 god-only flags do not create unattended grant", () => {
    // R1: allow_all_schemes alone never arms unattended
    assert.equal(isUnattendedArmed(), false)
    assert.equal(
      evaluateUnattendedHostComputerSkip({
        coordinateAllowed: true,
        experimental: false,
        modelEnabled: false,
        credentialLatched: false,
        budget: 10,
        actionCount: 1,
      }),
      false,
    )
  })
})

describe("PROMPT_ALWAYS / re-L2 floors (G1 session-trust spirit)", () => {
  // reL2ShouldPrompt is for G1/cruise — unattended bypasses reL2 entirely in executor.
  it("reL2ShouldPrompt still marks danger / experimental / foreground as must-prompt for G1", async () => {
    const { reL2ShouldPrompt } = await import("../src/computer/session-trust")
    assert.equal(reL2ShouldPrompt(["computer.danger_detected"]), true)
    assert.equal(reL2ShouldPrompt(["computer.experimental_suggestion"]), true)
    assert.equal(reL2ShouldPrompt(["computer.foreground_yielded"]), true)
    assert.equal(reL2ShouldPrompt(["computer.budget_exhausted"]), false)
  })
})

describe("C1 dual-write cruise snapshot lifecycle", () => {
  it("arm capture → disarm restores snapshot via handler", () => {
    let restored: any = null
    const {
      captureCruiseSnapshot,
      registerCruiseRestoreHandler,
      restoreCruiseFromSnapshot,
      getCruiseSnapshot,
      armUnattended,
      disarmUnattended,
      resetUnattendedGrantForTests,
    } = require("../src/computer/unattended-grant") as typeof import("../src/computer/unattended-grant")
    resetUnattendedGrantForTests()
    registerCruiseRestoreHandler((snap) => {
      restored = snap
    })
    captureCruiseSnapshot({
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: false,
      allow_all_schemes: false,
    })
    armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE })
    assert.ok(getCruiseSnapshot())
    disarmUnattended()
    const snap = restoreCruiseFromSnapshot()
    assert.equal(snap?.auto_approve_dangerous, true)
    assert.equal(snap?.auto_approve_enterprise_tools, false)
    assert.equal(restored?.auto_approve_dangerous, true)
    assert.equal(getCruiseSnapshot(), null)
    registerCruiseRestoreHandler(null)
  })

  it("TTL expire restores cruise once", () => {
    let restoreCount = 0
    const {
      captureCruiseSnapshot,
      registerCruiseRestoreHandler,
      armUnattended,
      isUnattendedArmed,
      getUnattendedStatus,
      resetUnattendedGrantForTests,
      UNATTENDED_HARD_TTL_MS,
    } = require("../src/computer/unattended-grant") as typeof import("../src/computer/unattended-grant")
    resetUnattendedGrantForTests()
    registerCruiseRestoreHandler(() => {
      restoreCount++
    })
    captureCruiseSnapshot({
      auto_approve_dangerous: false,
      auto_approve_enterprise_tools: true,
      allow_all_schemes: false,
    })
    const now = 10_000_000
    armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE, now })
    assert.equal(isUnattendedArmed(now), true)
    // Expire
    assert.equal(isUnattendedArmed(now + UNATTENDED_HARD_TTL_MS), false)
    assert.equal(restoreCount, 1)
    // Second status check does not re-fire
    getUnattendedStatus(now + UNATTENDED_HARD_TTL_MS + 1)
    assert.equal(restoreCount, 1)
    registerCruiseRestoreHandler(null)
  })

  it("no snapshot → restore without forceNull is no-op (Pi nit: bare disarm)", () => {
    let got: any = "unset"
    const {
      registerCruiseRestoreHandler,
      restoreCruiseFromSnapshot,
      resetUnattendedGrantForTests,
    } = require("../src/computer/unattended-grant") as typeof import("../src/computer/unattended-grant")
    resetUnattendedGrantForTests()
    registerCruiseRestoreHandler((snap) => {
      got = snap
    })
    const snap = restoreCruiseFromSnapshot()
    assert.equal(snap, null)
    assert.equal(got, "unset", "handler must not run without snapshot unless forceNull")
    registerCruiseRestoreHandler(null)
  })

  it("forceNull clears flags when user requests clear_cruise wipe", () => {
    let got: any = "unset"
    const {
      registerCruiseRestoreHandler,
      restoreCruiseFromSnapshot,
      resetUnattendedGrantForTests,
    } = require("../src/computer/unattended-grant") as typeof import("../src/computer/unattended-grant")
    resetUnattendedGrantForTests()
    registerCruiseRestoreHandler((snap) => {
      got = snap
    })
    restoreCruiseFromSnapshot({ forceNull: true })
    assert.equal(got, null)
    registerCruiseRestoreHandler(null)
  })

  it("shouldRestoreCruiseOnDisarm mirrors message-router gate", () => {
    const { shouldRestoreCruiseOnDisarm } = require("../src/computer/unattended-grant") as typeof import("../src/computer/unattended-grant")
    assert.equal(shouldRestoreCruiseOnDisarm({ had_grant: false, had_snapshot: false, clear_cruise: false }), false)
    assert.equal(shouldRestoreCruiseOnDisarm({ had_grant: true, had_snapshot: false, clear_cruise: false }), true)
    assert.equal(shouldRestoreCruiseOnDisarm({ had_grant: false, had_snapshot: true, clear_cruise: false }), true)
    assert.equal(shouldRestoreCruiseOnDisarm({ had_grant: false, had_snapshot: false, clear_cruise: true }), true)
  })

  it("durable file + boot reconcile restores cruise after process restart", () => {
    const os = require("os") as typeof import("os")
    const path = require("path") as typeof import("path")
    const fs = require("fs") as typeof import("fs")
    const {
      captureCruiseSnapshot,
      registerCruiseRestoreHandler,
      setCruiseSnapshotPathForTests,
      reconcileUnattendedCruiseOnBoot,
      resetUnattendedGrantForTests,
      getCruiseSnapshot,
    } = require("../src/computer/unattended-grant") as typeof import("../src/computer/unattended-grant")
    resetUnattendedGrantForTests()
    const tmp = path.join(os.tmpdir(), `cmspark-cruise-snap-test-${process.pid}.json`)
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    setCruiseSnapshotPathForTests(tmp)
    let restored: any = null
    registerCruiseRestoreHandler((snap) => {
      restored = snap
    })
    captureCruiseSnapshot({
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: true,
      allow_all_schemes: false,
    })
    assert.ok(fs.existsSync(tmp), "durable snapshot file written")
    // Simulate process restart: wipe memory, keep file contents
    const raw = fs.readFileSync(tmp, "utf-8")
    resetUnattendedGrantForTests()
    setCruiseSnapshotPathForTests(tmp)
    fs.writeFileSync(tmp, raw, { encoding: "utf-8", mode: 0o600 })
    assert.equal(getCruiseSnapshot(), null)
    restored = null
    registerCruiseRestoreHandler((snap) => {
      restored = snap
    })
    const r = reconcileUnattendedCruiseOnBoot()
    assert.equal(r.restored, true)
    assert.equal(restored?.auto_approve_dangerous, true)
    assert.equal(restored?.auto_approve_enterprise_tools, true)
    assert.equal(fs.existsSync(tmp), false, "file cleared after boot reconcile")
    registerCruiseRestoreHandler(null)
    setCruiseSnapshotPathForTests(null)
  })
})

describe("C16 unattended re-L2 silence (grant armed)", () => {
  it("isUnattendedArmed true while grant live (executor short-circuit condition)", () => {
    const {
      armUnattended,
      isUnattendedArmed,
      resetUnattendedGrantForTests,
    } = require("../src/computer/unattended-grant") as typeof import("../src/computer/unattended-grant")
    resetUnattendedGrantForTests()
    assert.equal(isUnattendedArmed(), false)
    armUnattended({ confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE })
    assert.equal(isUnattendedArmed(), true)
    // executor.ts reL2: if (isUnattendedArmed()) return true without confirm
  })
})
