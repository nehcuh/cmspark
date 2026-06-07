// Privilege Manager unit tests

import test from "node:test"
import assert from "node:assert/strict"

import { PrivilegeManager, privilegeManager } from "../../src/security/privilege-manager"

test.beforeEach(() => {
  privilegeManager.clear()
})

test("PrivilegeManager starts in standard mode by default", () => {
  const pm = new PrivilegeManager()
  assert.equal(pm.getMode("thread-1"), "standard")
})

test("PrivilegeManager allows UI-initiated mode switch", () => {
  const pm = new PrivilegeManager()
  const result = pm.setMode("thread-1", "advanced", true)
  assert.equal(result, true)
  assert.equal(pm.getMode("thread-1"), "advanced")
})

test("PrivilegeManager rejects non-UI-initiated mode switch", () => {
  const pm = new PrivilegeManager()
  const result = pm.setMode("thread-1", "advanced", false)
  assert.equal(result, false)
  assert.equal(pm.getMode("thread-1"), "standard")
})

test("PrivilegeManager allows switching to readonly from UI", () => {
  const pm = new PrivilegeManager()
  pm.setMode("thread-1", "readonly", true)
  assert.equal(pm.getMode("thread-1"), "readonly")
})

test("PrivilegeManager remembers confirmed code hash per thread", () => {
  const pm = new PrivilegeManager()
  pm.setMode("thread-a", "advanced", true)
  pm.recordConfirmation("thread-a", "hash-abc")
  assert.equal(pm.canAutoExecute(
    { total: 4, breakdown: { apiRisk: 3, codeComplexity: 0, domainTrust: 1, historyPattern: 0 }, matchedPatterns: ["fetch"], reason: "" },
    "thread-a",
    "hash-abc"
  ), true)
  assert.equal(pm.canAutoExecute(
    { total: 4, breakdown: { apiRisk: 3, codeComplexity: 0, domainTrust: 1, historyPattern: 0 }, matchedPatterns: ["fetch"], reason: "" },
    "thread-a",
    "hash-xyz"
  ), false)
  assert.equal(pm.canAutoExecute(
    { total: 4, breakdown: { apiRisk: 3, codeComplexity: 0, domainTrust: 1, historyPattern: 0 }, matchedPatterns: ["fetch"], reason: "" },
    "thread-b",
    "hash-abc"
  ), false)
})

test("PrivilegeManager auto-downgrades after consecutive high-risk operations", () => {
  const pm = new PrivilegeManager()
  pm.setMode("thread-a", "advanced", true)
  pm.autoDowngrade("thread-a", 3)
  assert.equal(pm.getMode("thread-a"), "standard")
})

test("PrivilegeManager does not downgrade on isolated high-risk operations", () => {
  const pm = new PrivilegeManager()
  pm.setMode("thread-a", "advanced", true)
  pm.autoDowngrade("thread-a", 2)
  assert.equal(pm.getMode("thread-a"), "advanced")
})

test("PrivilegeManager standard mode allows auto-execute for low scores", () => {
  const pm = new PrivilegeManager()
  assert.equal(pm.getMode("thread-a"), "standard")
  assert.equal(pm.canAutoExecute(
    { total: 1, breakdown: { apiRisk: 1, codeComplexity: 0, domainTrust: 0, historyPattern: 0 }, matchedPatterns: [], reason: "" },
    "thread-a",
    "hash-any"
  ), true)
})

test("PrivilegeManager readonly mode blocks all write-like scores", () => {
  const pm = new PrivilegeManager()
  pm.setMode("thread-a", "readonly", true)
  assert.equal(pm.canAutoExecute(
    { total: 3, breakdown: { apiRisk: 3, codeComplexity: 0, domainTrust: 0, historyPattern: 0 }, matchedPatterns: ["fetch"], reason: "" },
    "thread-a",
    "hash-any"
  ), false)
})

test("PrivilegeManager advanced mode auto-approves remembered hashes for medium scores", () => {
  const pm = new PrivilegeManager()
  pm.setMode("thread-a", "advanced", true)
  pm.recordConfirmation("thread-a", "hash-xyz")
  assert.equal(pm.canAutoExecute(
    { total: 4, breakdown: { apiRisk: 3, codeComplexity: 0, domainTrust: 1, historyPattern: 0 }, matchedPatterns: ["fetch"], reason: "" },
    "thread-a",
    "hash-xyz"
  ), true)
})

test("PrivilegeManager advanced mode still blocks for score 9+", () => {
  const pm = new PrivilegeManager()
  pm.setMode("thread-a", "advanced", true)
  pm.recordConfirmation("thread-a", "hash-xyz")
  assert.equal(pm.canAutoExecute(
    { total: 9, breakdown: { apiRisk: 4, codeComplexity: 2, domainTrust: 2, historyPattern: 1 }, matchedPatterns: ["eval"], reason: "" },
    "thread-a",
    "hash-xyz"
  ), false)
})

test("PrivilegeManager clear removes all sessions", () => {
  const pm = new PrivilegeManager()
  pm.setMode("thread-a", "advanced", true)
  pm.recordConfirmation("thread-a", "hash-abc")
  pm.clear()
  assert.equal(pm.getMode("thread-a"), "standard")
})

test("PrivilegeManager auto-downgrades standard to readonly after 5 consecutive high-risk", () => {
  const pm = new PrivilegeManager()
  pm.setMode("thread-a", "standard", true)
  pm.autoDowngrade("thread-a", 5)
  assert.equal(pm.getMode("thread-a"), "readonly")
})
