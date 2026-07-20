// WP5 I3 登记项③ — computer.model.reset_circuit_breaker 围栏 +
// get_state 观测面。双层断言：validateWsMessage 形状围栏（server.ts 导出件）
// + handler 层来源核查（belt）+ 复位语义（有会话真复位、无会话诚实 no-op）。

import test from "node:test"
import assert from "node:assert/strict"

import { validateWsMessage } from "../src/server"
import {
  handleComputerModelMessage,
  type ComputerModelSessionHolder,
} from "../src/computer/model-handlers"

// --- fakes ------------------------------------------------------------------

function fakeSession(disabled = true) {
  return {
    resetCalls: 0,
    status: disabled ? "disabled" : "idle",
    faults: disabled ? 3 : 0,
    resetCircuitBreaker() {
      this.resetCalls += 1
      this.status = "idle"
      this.faults = 0
    },
    getStatus() {
      return this.status
    },
    getFaults() {
      return this.faults
    },
  }
}

function holderWith(session: any): ComputerModelSessionHolder {
  return { session }
}

// --- validateWsMessage 形状围栏（未知类型默认放行，故此层是真围栏） -------------

test("③ validateWsMessage：reset_circuit_breaker 缺 source → 拒绝", () => {
  const r = validateWsMessage({ type: "computer.model.reset_circuit_breaker" })
  assert.equal(r.valid, false)
  assert.match(r.error!, /source:"settings"/)
})

test("③ validateWsMessage：reset_circuit_breaker 非 settings 来源 → 拒绝", () => {
  for (const source of ["chat", "quick-action", "", 1, null]) {
    const r = validateWsMessage({ type: "computer.model.reset_circuit_breaker", source })
    assert.equal(r.valid, false, `source=${JSON.stringify(source)} 应被拒`)
  }
})

test("③ validateWsMessage：reset_circuit_breaker settings 来源 → 放行", () => {
  const r = validateWsMessage({ type: "computer.model.reset_circuit_breaker", source: "settings" })
  assert.equal(r.valid, true)
})

test("③ validateWsMessage：get_state 无字段要求 → 放行", () => {
  assert.equal(validateWsMessage({ type: "computer.model.get_state" }).valid, true)
})

// --- handler 层二次核查（belt：防直调/校验面变更） ------------------------------

test("③ handler：非 settings 来源 → INVALID_SOURCE，会话绝不被触碰", async () => {
  const session = fakeSession()
  for (const msg of [
    { type: "computer.model.reset_circuit_breaker" },
    { type: "computer.model.reset_circuit_breaker", source: "chat" },
  ]) {
    const r = await handleComputerModelMessage(msg, {}, holderWith(session))
    assert.equal(r.type, "error")
    assert.equal(r.family, "computer")
    assert.equal(r.code, "INVALID_SOURCE")
  }
  assert.equal(session.resetCalls, 0, "围栏拒绝时复位绝不发生")
})

// --- 复位语义 ----------------------------------------------------------------

test("③ handler：settings 来源 + 熔断会话 → 真复位 + 广播 ready 态", async () => {
  const session = fakeSession(true) // disabled, faults=3
  const broadcasts: any[] = []
  const r = await handleComputerModelMessage(
    { type: "computer.model.reset_circuit_breaker", source: "settings" },
    { broadcast: (d: any) => broadcasts.push(d) },
    holderWith(session),
  )
  assert.equal(session.resetCalls, 1)
  assert.deepEqual(r, { type: "computer.model.state", modelStatus: "ready", faults: 0 })
  assert.deepEqual(broadcasts, [{ type: "computer.model.state", modelStatus: "ready", faults: 0 }])
})

test("③ handler：settings 来源 + 无会话 → 诚实 no-op（不伪造复位、不广播）", async () => {
  const broadcasts: any[] = []
  const r = await handleComputerModelMessage(
    { type: "computer.model.reset_circuit_breaker", source: "settings" },
    { broadcast: (d: any) => broadcasts.push(d) },
    holderWith(null),
  )
  assert.equal(r.modelStatus, "absent")
  assert.equal(r.note, "no-session")
  assert.equal(broadcasts.length, 0, "无状态变化不广播")
})

// --- get_state 观测面 ----------------------------------------------------------

test("③ get_state：熔断会话 → modelStatus disabled + faults 计数", async () => {
  const session = fakeSession(true)
  const r = await handleComputerModelMessage({ type: "computer.model.get_state" }, {}, holderWith(session))
  assert.deepEqual(r, { type: "computer.model.state", modelStatus: "disabled", faults: 3 })
})

test("③ get_state：无会话 → absent / faults 0", async () => {
  const r = await handleComputerModelMessage({ type: "computer.model.get_state" }, {}, holderWith(null))
  assert.deepEqual(r, { type: "computer.model.state", modelStatus: "absent", faults: 0 })
})

test("③ handler：未知 computer.model 类型 → error", async () => {
  const r = await handleComputerModelMessage({ type: "computer.model.nope" }, {}, holderWith(null))
  assert.equal(r.type, "error")
  assert.match(r.error, /Unknown computer model message type/)
})
