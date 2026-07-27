import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  EnterpriseSessionTrust,
  ENTERPRISE_IDLE_MS,
  ENTERPRISE_HARD_TTL_MS,
  resolveEnterpriseTrustKey,
  familyOfTool,
  netsecScopeFingerprint,
} from "../src/capability/enterprise-session-trust"
import { checkNetsecScope, assertTargetsAllowed } from "../src/netsec/scope"
import { SecurityConfirmationManager } from "../src/security-confirmation"

describe("enterprise-session-trust", () => {
  let trust: EnterpriseSessionTrust

  beforeEach(() => {
    trust = new EnterpriseSessionTrust()
  })

  it("resolveEnterpriseTrustKey only accepts non-empty thread ids", () => {
    assert.equal(resolveEnterpriseTrustKey("t1"), "thread:t1")
    assert.equal(resolveEnterpriseTrustKey("  "), null)
    assert.equal(resolveEnterpriseTrustKey(null), null)
  })

  it("familyOfTool maps shell/netsec only", () => {
    assert.equal(familyOfTool("netsec_port_scan"), "netsec")
    assert.equal(familyOfTool("shell_exec"), "shell")
    assert.equal(familyOfTool("evaluate"), null)
  })

  it("grant is per-family (T12): netsec does not activate shell", () => {
    const key = "thread:t1"
    const t0 = 1_000_000
    trust.grant(key, ["netsec"], { now: t0 })
    assert.equal(trust.isActive(key, "netsec", t0 + 1000), true)
    assert.equal(trust.isActive(key, "shell", t0 + 1000), false)
  })

  it("idle expiry pure-read (T6): no activity extension without re-grant", () => {
    const key = "thread:t1"
    const t0 = 1_000_000
    trust.grant(key, ["netsec"], { now: t0 })
    assert.equal(trust.isActive(key, "netsec", t0 + ENTERPRISE_IDLE_MS - 1), true)
    assert.equal(trust.isActive(key, "netsec", t0 + ENTERPRISE_IDLE_MS + 1), false)
  })

  it("hard TTL from grantedAt sticky even if re-granted within idle (T16)", () => {
    const key = "thread:t1"
    const t0 = 1_000_000
    trust.grant(key, ["shell"], { now: t0 })
    // keep lastInteractiveAt fresh so idle does not fire first
    const almostHard = t0 + ENTERPRISE_HARD_TTL_MS - 60_000
    trust.grant(key, ["shell"], { now: almostHard })
    assert.equal(trust.isActive(key, "shell", almostHard + 1_000), true)
    assert.equal(trust.isActive(key, "shell", t0 + ENTERPRISE_HARD_TTL_MS + 1), false)
  })

  it("scope fingerprint mismatch deactivates netsec grant", () => {
    const key = "thread:t1"
    const t0 = 1_000_000
    const fp = netsecScopeFingerprint(["10.0.0.1"], ["10.0.0.1"])
    trust.grant(key, ["netsec"], { now: t0, scopeFingerprint: fp })
    assert.equal(trust.isActive(key, "netsec", t0 + 1000, fp), true)
    assert.equal(
      trust.isActive(key, "netsec", t0 + 1000, netsecScopeFingerprint(["10.0.0.2"], ["10.0.0.2"])),
      false,
    )
  })

  it("revoke and revokeFamily", () => {
    const key = "thread:t1"
    const t0 = 1_000_000
    trust.grant(key, ["netsec", "shell"], { now: t0 })
    trust.revokeFamily(key, "shell")
    assert.equal(trust.isActive(key, "netsec", t0 + 1), true)
    assert.equal(trust.isActive(key, "shell", t0 + 1), false)
    trust.revoke(key)
    assert.equal(trust.isActive(key, "netsec", t0 + 1), false)
  })
})

describe("checkNetsecScope", () => {
  it("denies empty allowlist (T10 core)", () => {
    const r = checkNetsecScope({
      targets: ["10.0.0.1"],
      allowlist: [],
      requireTaskAuth: false,
      moduleEnabled: true,
    })
    assert.equal(r.ok, false)
  })

  it("denies module disabled", () => {
    const r = checkNetsecScope({
      targets: ["10.0.0.1"],
      allowlist: ["10.0.0.1"],
      requireTaskAuth: false,
      moduleEnabled: false,
    })
    assert.equal(r.ok, false)
  })

  it("requires task auth when enabled", () => {
    const r = checkNetsecScope({
      targets: ["10.0.0.1"],
      allowlist: ["10.0.0.1"],
      requireTaskAuth: true,
      taskAuth: null,
      moduleEnabled: true,
    })
    assert.equal(r.ok, false)
  })

  it("allows in-scope with task auth", () => {
    const r = checkNetsecScope({
      targets: ["10.0.0.1"],
      allowlist: ["10.0.0.0/8"],
      requireTaskAuth: true,
      taskAuth: { authorized: true, targets: ["10.0.0.1"] },
      moduleEnabled: true,
    })
    assert.equal(r.ok, true)
  })

  it("assertTargetsAllowed rejects out-of-list", () => {
    const r = assertTargetsAllowed(["9.9.9.9"], ["10.0.0.0/8"])
    assert.equal(r.ok, false)
  })
})

describe("enterprise session trust anti-injection (G5)", () => {
  it("honors addToEnterpriseSessionTrust only when offered on shell/netsec (T7/T14)", async () => {
    const mgr = new SecurityConfirmationManager(5000)
    const p = mgr.request(
      () => {},
      {
        toolName: "netsec_port_scan",
        dangerousApis: [],
        code: "scan",
        offerEnterpriseSessionTrust: true,
      },
      undefined,
      "e1",
    )
    assert.equal(
      mgr.respondFrom("e1", true, undefined, undefined, {
        addToEnterpriseSessionTrust: true,
      }).outcome,
      "resolved",
    )
    const d = await p
    assert.equal(d.addToEnterpriseSessionTrust, true)
  })

  it("ignores inject on evaluate without offered flag (T14)", async () => {
    const mgr = new SecurityConfirmationManager(5000)
    const p = mgr.request(
      () => {},
      { toolName: "evaluate", dangerousApis: [], code: "1" },
      undefined,
      "e2",
    )
    mgr.respondFrom("e2", true, undefined, undefined, {
      addToEnterpriseSessionTrust: true,
    })
    const d = await p
    assert.equal(d.addToEnterpriseSessionTrust, undefined)
  })
})
