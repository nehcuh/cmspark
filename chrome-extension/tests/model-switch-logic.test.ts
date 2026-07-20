// WP5-I4 WI-4.4 — model-switch-logic 纯函数矩阵测试(apps-panel-logic.test.ts
// 先例,node:test 直驱):依赖提示优先级 / 许可证门触发 / 百分比 / 运行中旁注
// 判定(P2) / 状态行选择 / 禁用原因 / 错误路由守卫 + 镜像文案互锁断言
// (companion computer-model-states.test.ts 的 P2 断言姊妹面)。

import test from "node:test"
import assert from "node:assert/strict"

import {
  MODEL_STATE_MESSAGES,
  MODEL_SWITCH_COPY,
  downloadPercent,
  isComputerModelErrorMessage,
  licenseDoorShouldOpen,
  modelStateMessage,
  modelStatusLine,
  modelSwitchDisabledReason,
  modelSwitchHint,
  modelSwitchRunningNote,
} from "../src/sidepanel/components/model-switch-logic"
import type { ComputerModelState, ComputerTaskState } from "../src/sidepanel/types"

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

function task(status: ComputerTaskState["status"]): ComputerTaskState {
  return { taskId: "t1", status, resyncing: false, steps: [], abortAcked: false }
}

// --- 三层依赖提示优先级:masterOffHint > appNotAllowedHint > null(本体) ---

test("依赖提示优先级:主开关关 > app 未许可 > 本体(未知层不判)", () => {
  assert.equal(modelSwitchHint({ masterEnabled: false, appCoordinateAllowed: false }), MODEL_SWITCH_COPY.masterOffHint)
  assert.equal(modelSwitchHint({ masterEnabled: false, appCoordinateAllowed: true }), MODEL_SWITCH_COPY.masterOffHint)
  assert.equal(modelSwitchHint({ masterEnabled: true, appCoordinateAllowed: false }), MODEL_SWITCH_COPY.appNotAllowedHint)
  assert.equal(modelSwitchHint({ masterEnabled: null, appCoordinateAllowed: false }), MODEL_SWITCH_COPY.appNotAllowedHint)
  assert.equal(modelSwitchHint({ masterEnabled: true, appCoordinateAllowed: true }), null)
  assert.equal(modelSwitchHint({ masterEnabled: null, appCoordinateAllowed: null }), null)
})

// --- 许可证门触发 ---

test("许可证门触发:license_required 载荷非 null 即弹", () => {
  assert.equal(licenseDoorShouldOpen(null), false)
  assert.equal(licenseDoorShouldOpen({ licenseText: "MIT…", notice: "n" }), true)
})

// --- 下载百分比 ---

test("下载百分比:取整 + clamp + 零总量/空进度 → null", () => {
  assert.equal(downloadPercent({ variant: "hybrid", file: "a.onnx", receivedBytes: 50, totalBytes: 100 }), 50)
  assert.equal(downloadPercent({ variant: "hybrid", file: "a.onnx", receivedBytes: 1, totalBytes: 3 }), 33)
  assert.equal(downloadPercent({ variant: "hybrid", file: "a.onnx", receivedBytes: 200, totalBytes: 100 }), 100)
  assert.equal(downloadPercent({ variant: "hybrid", file: "a.onnx", receivedBytes: 0, totalBytes: 0 }), null)
  assert.equal(downloadPercent(null), null)
})

// --- P2 任务运行中旁注判定 ---

test("P2 运行中旁注:running/paused → 旁注(per-task + estop);finished/无任务 → null", () => {
  const note = modelSwitchRunningNote(task("running"))
  assert.ok(note !== null)
  assert.ok(note!.includes("当前任务结束后生效"), "per-task 生效语义(P2)")
  assert.ok(note!.includes("Ctrl+Alt+End"), "estop 引导(P2)")
  assert.ok(modelSwitchRunningNote(task("paused"))!.includes("当前任务结束后生效"))
  assert.equal(modelSwitchRunningNote(task("finished")), null)
  assert.equal(modelSwitchRunningNote(null), null)
})

// --- 状态行选择 ---

test("状态行:state=null → loading", () => {
  const v = modelStatusLine(null, null)
  assert.equal(v.kind, "loading")
})

test("状态行:error(reason) → 词表标题+详情+动作;absent → model-file-missing", () => {
  const v1 = modelStatusLine(modelState({ modelStatus: "error", error: "model-hash-mismatch" }), null)
  assert.equal(v1.kind, "error")
  assert.equal(v1.text, MODEL_STATE_MESSAGES["model-hash-mismatch"]!.title)
  assert.equal(v1.action, "删除并重新下载")
  const v2 = modelStatusLine(modelState({ modelStatus: "absent" }), null)
  assert.equal(v2.kind, "error")
  assert.equal(v2.text, MODEL_STATE_MESSAGES["model-file-missing"]!.title)
  assert.ok(v2.detail!.includes("不受影响"), "降级叙事必须透出")
})

test("状态行:downloading → 百分比文本(无进度 → 省略号)", () => {
  const v1 = modelStatusLine(modelState({ modelStatus: "downloading" }), {
    variant: "hybrid",
    file: "encoder_model.onnx",
    receivedBytes: 352500000,
    totalBytes: 705000000,
  })
  assert.equal(v1.kind, "info")
  assert.ok(v1.text.includes("50%"))
  assert.ok(v1.text.includes("encoder_model.onnx"))
  const v2 = modelStatusLine(modelState({ modelStatus: "downloading" }), null)
  assert.ok(!v2.text.includes("%"), "无进度不显示数字")
})

test("状态行:disabled → circuit-breaker 词表;ready → 就绪双态", () => {
  const v1 = modelStatusLine(modelState({ modelStatus: "disabled", faults: 3 }), null)
  assert.equal(v1.kind, "error")
  assert.equal(v1.text, MODEL_STATE_MESSAGES["circuit-breaker"]!.title)
  assert.equal(v1.action, "重置熔断")
  const v2 = modelStatusLine(modelState({ modelStatus: "ready", modelEnabled: true }), null)
  assert.equal(v2.kind, "ok")
  assert.ok(v2.text.includes("人工确认"), "开启态仍须 G4 叙事")
  const v3 = modelStatusLine(modelState({ modelStatus: "ready", modelEnabled: false }), null)
  assert.ok(v3.text.includes("未开启"))
})

test("状态行:error 字段优先于 modelStatus 分支", () => {
  const v = modelStatusLine(modelState({ modelStatus: "ready", error: "model-size-mismatch" }), null)
  assert.equal(v.kind, "error", "有 reason 即走词表(诚实边界:probe 异常不被 ready 掩盖)")
})

// --- 开关禁用原因(许可证已拒绝) ---

test("禁用原因:declined → 永久跳过提示;其余 → null", () => {
  const r = modelSwitchDisabledReason(modelState({ modelLicenseDeclined: true }))
  assert.ok(r !== null)
  assert.ok(r!.includes("永久跳过"))
  assert.equal(modelSwitchDisabledReason(modelState()), null)
  assert.equal(modelSwitchDisabledReason(null), null)
})

// --- 错误路由守卫 ---

test("错误路由守卫:仅 family=computer.model 命中(不用共享 code)", () => {
  assert.equal(isComputerModelErrorMessage({ family: "computer.model" }), true)
  assert.equal(isComputerModelErrorMessage({ family: "computer" }), false)
  assert.equal(isComputerModelErrorMessage({ family: "apps" }), false)
  assert.equal(isComputerModelErrorMessage({}), false)
  assert.equal(isComputerModelErrorMessage(null as never), false)
})

// --- 镜像文案互锁(companion computer-model-states.test.ts 姊妹面) ---

test("镜像互锁:P2 layerSemantics / runningNote / 熔断词表关键短语", () => {
  assert.ok(MODEL_SWITCH_COPY.layerSemantics.includes("当前任务结束后生效"))
  assert.ok(MODEL_SWITCH_COPY.layerSemantics.includes("Ctrl+Alt+End"))
  assert.ok(MODEL_SWITCH_COPY.switchRunningNote.includes("当前任务结束后生效"))
  assert.ok(MODEL_SWITCH_COPY.switchRunningNote.includes("Ctrl+Alt+End"))
  const cb = MODEL_STATE_MESSAGES["circuit-breaker"]
  assert.ok(cb, "circuit-breaker 词表条目必须镜像在案")
  assert.ok(cb!.detail.includes("无自动恢复"))
  assert.ok(cb!.detail.includes("不受影响"))
  // 兜底:词表外 reason 不崩
  assert.equal(modelStateMessage("some-future-reason").action, null)
  assert.ok(modelStateMessage("some-future-reason").detail.includes("some-future-reason"))
})
