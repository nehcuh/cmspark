// WP5-I4 WI-4.4 — 扩展 model 切片 store 测试(computer-task-state.test.ts 同风格,
// 纯逻辑 node:test):状态折叠 / 广播驱动刷新 / 无乐观更新。
//
// 覆盖(出口标准 1「扩展 model 状态折叠测试」锚):
//  - SET_COMPUTER_MODEL_STATE 全形落盘(含可选字段有无两支)
//  - progress 镜像:state 非下载中到达 → 清陈旧进度;下载中 → 保留
//  - license_required 载荷进 store / 清空(渲染原文,无复制)
//  - family:"computer.model" 错误位 set/clear
//  - 无乐观更新:initialState 恒 null;除 SET_COMPUTER_MODEL_STATE 外无任何
//    action 能改变 modelEnabled(reducer 结构断言)

import test from "node:test"
import assert from "node:assert/strict"

import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
import type { AgentAction } from "../src/sidepanel/store/agentStore"
import type { ComputerModelState } from "../src/sidepanel/types"

function modelState(over: Partial<ComputerModelState> = {}): ComputerModelState {
  return {
    modelEnabled: false,
    licenseAccepted: false,
    modelLicenseDeclined: false,
    modelStatus: "absent",
    variant: "hybrid",
    faults: 0,
    ...over,
  }
}

const PROGRESS = { variant: "hybrid", file: "encoder_model.onnx", receivedBytes: 50, totalBytes: 100 }

test("initialState:model 切片全 null(未查询态;无乐观更新起点)", () => {
  assert.equal(initialState.computerModel, null)
  assert.equal(initialState.computerModelProgress, null)
  assert.equal(initialState.computerModelLicenseDoor, null)
  assert.equal(initialState.computerModelError, null)
})

test("SET_COMPUTER_MODEL_STATE:全形落盘(可选字段齐)", () => {
  const s = modelState({
    modelEnabled: true,
    licenseAccepted: true,
    licenseAcceptedAt: "2026-07-21T00:00:00.000Z",
    modelStatus: "ready",
    sizeBytes: 705000000,
    faults: 1,
  })
  const next = agentReducer(initialState, { type: "SET_COMPUTER_MODEL_STATE", modelState: s })
  assert.deepEqual(next.computerModel, s)
})

test("SET_COMPUTER_MODEL_STATE:error reason 落盘(状态行词表消费)", () => {
  const s = modelState({ modelStatus: "error", error: "model-hash-mismatch" })
  const next = agentReducer(initialState, { type: "SET_COMPUTER_MODEL_STATE", modelState: s })
  assert.equal(next.computerModel?.error, "model-hash-mismatch")
})

test("progress 镜像:下载中 state 保留进度,非下载中 state 清陈旧进度", () => {
  let s = agentReducer(initialState, { type: "SET_COMPUTER_MODEL_PROGRESS", progress: PROGRESS })
  assert.deepEqual(s.computerModelProgress, PROGRESS)
  // 下载中 state 到达 → 进度保留(百分比继续渲染)
  s = agentReducer(s, { type: "SET_COMPUTER_MODEL_STATE", modelState: modelState({ modelStatus: "downloading" }) })
  assert.deepEqual(s.computerModelProgress, PROGRESS)
  // 完成/失败 state(ready/error/absent)到达 → 陈旧进度清除
  for (const terminal of ["ready", "error", "absent"]) {
    const t = agentReducer(s, { type: "SET_COMPUTER_MODEL_STATE", modelState: modelState({ modelStatus: terminal }) })
    assert.equal(t.computerModelProgress, null, `${terminal} 到达须清进度`)
    s = agentReducer(t, { type: "SET_COMPUTER_MODEL_PROGRESS", progress: PROGRESS })
  }
})

test("license_required 载荷:进 store → 清空(渲染原文通道)", () => {
  const door = { licenseText: "MIT License\n\n(载荷原文占位)", notice: "阅读并接受后可开启" }
  let s = agentReducer(initialState, { type: "SET_COMPUTER_MODEL_LICENSE_DOOR", door })
  assert.deepEqual(s.computerModelLicenseDoor, door)
  s = agentReducer(s, { type: "SET_COMPUTER_MODEL_LICENSE_DOOR", door: null })
  assert.equal(s.computerModelLicenseDoor, null)
})

test("model 错误位:set/clear(family:computer.model 路由落点)", () => {
  let s = agentReducer(initialState, { type: "SET_COMPUTER_MODEL_ERROR", error: "实验层许可证已被拒绝…" })
  assert.equal(s.computerModelError, "实验层许可证已被拒绝…")
  s = agentReducer(s, { type: "SET_COMPUTER_MODEL_ERROR", error: null })
  assert.equal(s.computerModelError, null)
})

test("无乐观更新:除 state 广播 action 外,modelEnabled 不可被任何 action 改写", () => {
  // 构造一组「用户操作后 UI 可能 dispatch 的非 state action」,断言 model 切片不动。
  const untouched: AgentAction[] = [
    { type: "SET_COMPUTER_MODEL_PROGRESS", progress: PROGRESS },
    { type: "SET_COMPUTER_MODEL_LICENSE_DOOR", door: { licenseText: "t", notice: "n" } },
    { type: "SET_COMPUTER_MODEL_LICENSE_DOOR", door: null },
    { type: "SET_COMPUTER_MODEL_ERROR", error: "x" },
    { type: "SET_COMPUTER_COORDINATE_STATE", enabled: true },
  ]
  for (const action of untouched) {
    const next = agentReducer(initialState, action)
    assert.equal(next.computerModel, null, `${action.type} 不得写 model 切片(无乐观更新)`)
  }
  // 唯一通道:companion state 广播/应答
  const on = agentReducer(initialState, {
    type: "SET_COMPUTER_MODEL_STATE",
    modelState: modelState({ modelEnabled: true, modelStatus: "ready" }),
  })
  assert.equal(on.computerModel?.modelEnabled, true)
})

test("广播驱动刷新链:license 接受 → ready 序列折叠正确", () => {
  // license_response accepted 后 companion 广播 state(下载中) → 完成后广播(ready)
  let s = agentReducer(initialState, {
    type: "SET_COMPUTER_MODEL_STATE",
    modelState: modelState({ licenseAccepted: true, licenseAcceptedAt: "2026-07-21T00:00:00.000Z", modelStatus: "downloading" }),
  })
  s = agentReducer(s, { type: "SET_COMPUTER_MODEL_PROGRESS", progress: PROGRESS })
  s = agentReducer(s, {
    type: "SET_COMPUTER_MODEL_STATE",
    modelState: modelState({ licenseAccepted: true, modelStatus: "ready", sizeBytes: 705000000 }),
  })
  assert.equal(s.computerModel?.modelStatus, "ready")
  assert.equal(s.computerModelProgress, null, "ready 到达后进度已清")
  assert.equal(s.computerModel?.modelEnabled, false, "state 未报 enabled 前不得显示开启")
})
