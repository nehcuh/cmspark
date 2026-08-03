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

  it("T1-3 experimental → false", () => {
    assert.equal(unattendedInitialSkipEligible({ ...base, experimental: true }), false)
  })

  it("T1-4 modelEnabled → false", () => {
    assert.equal(unattendedInitialSkipEligible({ ...base, modelEnabled: true }), false)
  })

  it("T1-5 credential latch → false", () => {
    assert.equal(unattendedInitialSkipEligible({ ...base, credentialLatched: true }), false)
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

  it("armed but modelEnabled → false", () => {
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
      false,
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

describe("PROMPT_ALWAYS / re-L2 floors still force prompt (T3-3..5 spirit)", () => {
  // Unattended must not weaken mid-task force-interactive tags.
  it("reL2ShouldPrompt still forces danger / experimental / foreground", async () => {
    const { reL2ShouldPrompt } = await import("../src/computer/session-trust")
    assert.equal(reL2ShouldPrompt(["computer.danger_detected"]), true)
    assert.equal(reL2ShouldPrompt(["computer.experimental_suggestion"]), true)
    assert.equal(reL2ShouldPrompt(["computer.foreground_yielded"]), true)
    // Known non-PROMPT_ALWAYS can silent when trusted by reL2 path
    assert.equal(reL2ShouldPrompt(["computer.budget_exhausted"]), false)
  })
})
