// Front-end state management security tests — Module 5: Testing & Documentation
// Tests: privilegeMode switching, securityAuditLog recording, SecurityConfirmationRequest type extension

import test from "node:test"
import assert from "node:assert/strict"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
import type { SecurityConfirmationRequest, SecurityAuditEntry } from "../src/sidepanel/types"

// ---------------------------------------------------------------------------
// privilegeMode state switching
// ---------------------------------------------------------------------------

test("SET_PRIVILEGE_MODE updates privilegeMode in state", () => {
  const next = agentReducer(initialState, { type: "SET_PRIVILEGE_MODE", mode: "advanced" })
  assert.equal(next.privilegeMode, "advanced")
})

test("SET_PRIVILEGE_MODE can switch to readonly", () => {
  const next = agentReducer(initialState, { type: "SET_PRIVILEGE_MODE", mode: "readonly" })
  assert.equal(next.privilegeMode, "readonly")
})

test("SET_PRIVILEGE_MODE can switch back to standard", () => {
  const state = agentReducer(initialState, { type: "SET_PRIVILEGE_MODE", mode: "advanced" })
  const next = agentReducer(state, { type: "SET_PRIVILEGE_MODE", mode: "standard" })
  assert.equal(next.privilegeMode, "standard")
})

test("SET_PRIVILEGE_MODE does not affect other state fields", () => {
  const next = agentReducer(initialState, { type: "SET_PRIVILEGE_MODE", mode: "advanced" })
  assert.equal(next.connectionState, initialState.connectionState)
  assert.deepEqual(next.threads, initialState.threads)
  assert.equal(next.messages.length, initialState.messages.length)
})

// ---------------------------------------------------------------------------
// securityAuditLog recording
// ---------------------------------------------------------------------------

test("ADD_SECURITY_AUDIT appends entry to securityAuditLog", () => {
  const entry: SecurityAuditEntry = {
    id: "audit-1",
    ts: "2026-06-07T10:00:00.000Z",
    level: "warn",
    tool_name: "evaluate",
    action: "allowed",
    risk_level: "medium",
    risk_score: 5,
    defense_layer: 2,
    message: "允许执行 evaluate",
  }
  const next = agentReducer(initialState, { type: "ADD_SECURITY_AUDIT", entry })
  assert.equal(next.securityAuditLog.length, 1)
  assert.deepEqual(next.securityAuditLog[0], entry)
})

test("ADD_SECURITY_AUDIT preserves existing entries", () => {
  const entry1: SecurityAuditEntry = {
    id: "audit-1",
    ts: "2026-06-07T10:00:00.000Z",
    level: "warn",
    tool_name: "evaluate",
    action: "allowed",
    risk_level: "medium",
    risk_score: 5,
    message: "允许执行 evaluate",
  }
  const entry2: SecurityAuditEntry = {
    id: "audit-2",
    ts: "2026-06-07T10:01:00.000Z",
    level: "block",
    tool_name: "osascript_eval",
    action: "denied",
    risk_level: "high",
    risk_score: 9,
    message: "拒绝执行 osascript_eval",
  }
  const state1 = agentReducer(initialState, { type: "ADD_SECURITY_AUDIT", entry: entry1 })
  const state2 = agentReducer(state1, { type: "ADD_SECURITY_AUDIT", entry: entry2 })
  assert.equal(state2.securityAuditLog.length, 2)
  assert.equal(state2.securityAuditLog[0].id, "audit-1")
  assert.equal(state2.securityAuditLog[1].id, "audit-2")
})

test("securityAuditLog is empty array in initialState", () => {
  assert.deepEqual(initialState.securityAuditLog, [])
})

test("ADD_SECURITY_AUDIT entry with block level is recorded", () => {
  const entry: SecurityAuditEntry = {
    id: "audit-block-1",
    ts: "2026-06-07T10:00:00.000Z",
    level: "block",
    tool_name: "evaluate",
    action: "blocked",
    risk_level: "high",
    risk_score: 10,
    defense_layer: 1,
    message: "阻断执行 evaluate",
  }
  const next = agentReducer(initialState, { type: "ADD_SECURITY_AUDIT", entry })
  assert.equal(next.securityAuditLog[0].level, "block")
  assert.equal(next.securityAuditLog[0].action, "blocked")
})

test("ADD_SECURITY_AUDIT entry with info level is recorded", () => {
  const entry: SecurityAuditEntry = {
    id: "audit-info-1",
    ts: "2026-06-07T10:00:00.000Z",
    level: "info",
    tool_name: "screenshot",
    action: "allowed",
    risk_level: "low",
    risk_score: 0,
    message: "自动执行 screenshot",
  }
  const next = agentReducer(initialState, { type: "ADD_SECURITY_AUDIT", entry })
  assert.equal(next.securityAuditLog[0].level, "info")
  assert.equal(next.securityAuditLog[0].action, "allowed")
})

// ---------------------------------------------------------------------------
// SecurityConfirmationRequest type extension
// ---------------------------------------------------------------------------

test("SecurityConfirmationRequest includes risk_score field", () => {
  const request: SecurityConfirmationRequest = {
    confirmation_id: "confirm-1",
    tool_name: "evaluate",
    dangerous_apis: ["fetch("],
    code_preview: "fetch('/api')",
    risk_score: 5,
    risk_category: "network",
    risk_level: "medium",
    auto_confirm_eligible: false,
    defense_layer: 2,
  }
  assert.equal(request.risk_score, 5)
  assert.equal(typeof request.risk_score, "number")
})

test("SecurityConfirmationRequest includes risk_category field", () => {
  const request: SecurityConfirmationRequest = {
    confirmation_id: "confirm-1",
    tool_name: "evaluate",
    dangerous_apis: ["eval("],
    code_preview: 'eval("alert(1)")',
    risk_score: 9,
    risk_category: "code_execution",
    risk_level: "high",
    auto_confirm_eligible: false,
    defense_layer: 1,
  }
  assert.equal(request.risk_category, "code_execution")
  assert.equal(typeof request.risk_category, "string")
})

test("SecurityConfirmationRequest includes risk_level field with correct union type", () => {
  const request: SecurityConfirmationRequest = {
    confirmation_id: "confirm-1",
    tool_name: "screenshot",
    dangerous_apis: [],
    code_preview: "",
    risk_score: 0,
    risk_category: "none",
    risk_level: "low",
    auto_confirm_eligible: true,
  }
  assert.equal(["low", "medium", "high"].includes(request.risk_level!), true)
})

test("SecurityConfirmationRequest includes auto_confirm_eligible field", () => {
  const request: SecurityConfirmationRequest = {
    confirmation_id: "confirm-1",
    tool_name: "evaluate",
    dangerous_apis: ["fetch("],
    code_preview: "fetch('/api')",
    risk_score: 3,
    risk_category: "network",
    risk_level: "medium",
    auto_confirm_eligible: true,
    defense_layer: 2,
  }
  assert.equal(request.auto_confirm_eligible, true)
  assert.equal(typeof request.auto_confirm_eligible, "boolean")
})

test("SecurityConfirmationRequest includes optional defense_layer field", () => {
  const request: SecurityConfirmationRequest = {
    confirmation_id: "confirm-1",
    tool_name: "evaluate",
    dangerous_apis: ["eval("],
    code_preview: 'eval("alert(1)")',
    risk_score: 9,
    risk_category: "code_execution",
    risk_level: "high",
    auto_confirm_eligible: false,
    defense_layer: 1,
  }
  assert.equal(request.defense_layer, 1)
  assert.equal(typeof request.defense_layer, "number")
})

test("SecurityConfirmationRequest works without defense_layer", () => {
  const request: SecurityConfirmationRequest = {
    confirmation_id: "confirm-1",
    tool_name: "evaluate",
    dangerous_apis: ["fetch("],
    code_preview: "fetch('/api')",
    risk_score: 5,
    risk_category: "network",
    risk_level: "medium",
    auto_confirm_eligible: false,
  }
  assert.equal(request.defense_layer, undefined)
})

test("SecurityConfirmationRequest low risk has auto_confirm_eligible true", () => {
  const request: SecurityConfirmationRequest = {
    confirmation_id: "confirm-low",
    tool_name: "screenshot",
    dangerous_apis: [],
    code_preview: "",
    risk_score: 1,
    risk_category: "none",
    risk_level: "low",
    auto_confirm_eligible: true,
  }
  assert.equal(request.risk_level, "low")
  assert.equal(request.auto_confirm_eligible, true)
})

test("SecurityConfirmationRequest high risk has auto_confirm_eligible false", () => {
  const request: SecurityConfirmationRequest = {
    confirmation_id: "confirm-high",
    tool_name: "evaluate",
    dangerous_apis: ["eval(", "Function("],
    code_preview: 'eval("alert(1)"); new Function("return 1")',
    risk_score: 9,
    risk_category: "code_execution",
    risk_level: "high",
    auto_confirm_eligible: false,
    defense_layer: 1,
  }
  assert.equal(request.risk_level, "high")
  assert.equal(request.auto_confirm_eligible, false)
})

// ---------------------------------------------------------------------------
// Integration: reducer handles security-related actions together
// ---------------------------------------------------------------------------

test("reducer handles privilege mode change followed by audit log entry", () => {
  const state1 = agentReducer(initialState, { type: "SET_PRIVILEGE_MODE", mode: "advanced" })
  const entry: SecurityAuditEntry = {
    id: "audit-1",
    ts: "2026-06-07T10:00:00.000Z",
    level: "warn",
    tool_name: "evaluate",
    action: "allowed",
    risk_level: "medium",
    risk_score: 5,
    message: "允许执行 evaluate",
  }
  const state2 = agentReducer(state1, { type: "ADD_SECURITY_AUDIT", entry })
  assert.equal(state2.privilegeMode, "advanced")
  assert.equal(state2.securityAuditLog.length, 1)
  assert.equal(state2.securityAuditLog[0].tool_name, "evaluate")
})

test("reducer preserves audit log across privilege mode changes", () => {
  const entry: SecurityAuditEntry = {
    id: "audit-1",
    ts: "2026-06-07T10:00:00.000Z",
    level: "info",
    tool_name: "screenshot",
    action: "allowed",
    risk_level: "low",
    risk_score: 0,
    message: "自动执行 screenshot",
  }
  const state1 = agentReducer(initialState, { type: "ADD_SECURITY_AUDIT", entry })
  const state2 = agentReducer(state1, { type: "SET_PRIVILEGE_MODE", mode: "readonly" })
  assert.equal(state2.securityAuditLog.length, 1)
  assert.equal(state2.privilegeMode, "readonly")
})

test("initialState has privilege_mode in config", () => {
  assert.equal(initialState.config.privilege_mode, "standard")
  assert.equal(["readonly", "standard", "advanced"].includes(initialState.config.privilege_mode), true)
})

test("initialState has safety_skills_enabled in config", () => {
  assert.deepEqual(initialState.config.safety_skills_enabled, [])
  assert.equal(Array.isArray(initialState.config.safety_skills_enabled), true)
})
