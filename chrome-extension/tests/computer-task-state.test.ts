// 坐标 computer-use(WP4 WI-1)— computer.task.event 折叠状态机 + 守卫函数测试。
// 纯逻辑(node:test,apps-panel-logic.test.ts 先例):reducer 折叠在
// reduceComputerTaskEvent 纯函数里,组件保持纯渲染。
//
// 覆盖(验收映射「急停按钮与热键等效」行):
//  - ack 状态机(COMPUTER_TASK_ABORT_ACK 置位/不匹配/未命中)
//  - P4 迟连懒创建(面板迟连 → 首个 step 事件 → 任务条与急停按钮可用)
//  - 乱序/迟到事件丢弃(finished 后同 id step、未知 id finished)
//  - 时间线截断(30 步)+ 字节上限丢图保文字
//  - previewImageSafe 渲染守卫 / isValidEvidenceTaskId 清洗镜像

import test from "node:test"
import assert from "node:assert/strict"
import {
  COMPUTER_TIMELINE_MAX_IMAGE_BYTES,
  COMPUTER_TIMELINE_MAX_STEPS,
  PREVIEW_IMAGE_MAX_BYTES,
  capTimeline,
  isValidEvidenceTaskId,
  previewImageSafe,
  reduceComputerTaskEvent,
} from "../src/sidepanel/utils/computer-utils"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
import type { ComputerStepView, ComputerTaskEventView, ComputerTaskState } from "../src/sidepanel/types"

const NOW = 1_750_000_000_000

/** 断言非空并收窄类型(本仓库 @types/node 的 assert.ok/fail 不带 asserts 签名)。 */
function must<T>(v: T | null): T {
  if (v === null) throw new Error("expected non-null")
  return v
}

function startedEv(over: Partial<ComputerTaskEventView> = {}): ComputerTaskEventView {
  return { event: "started", taskId: "task-1", app: "网易云音乐", task: "播放每日推荐", total: 5, budget: 15, ...over }
}

function stepEv(over: Partial<ComputerTaskEventView> = {}): ComputerTaskEventView {
  return { event: "step", taskId: "task-1", seq: 1, action: "click", caption: "点击「每日推荐」", x: 100, y: 200, budgetLeft: 14, ...over }
}

// --- 基本折叠:started → step → finished ---

test("started 总是重置为全新任务状态(resyncing=false,空时间线)", () => {
  const s = must(reduceComputerTaskEvent(null, startedEv(), NOW))
  assert.equal(s.taskId, "task-1")
  assert.equal(s.app, "网易云音乐")
  assert.equal(s.task, "播放每日推荐")
  assert.equal(s.total, 5)
  assert.equal(s.budget, 15)
  assert.equal(s.status, "running")
  assert.equal(s.resyncing, false)
  assert.deepEqual(s.steps, [])
  assert.equal(s.abortAcked, false)
})

test("step 追加到同任务时间线;paused 后的 step 视为恢复(running)", () => {
  let s = must(reduceComputerTaskEvent(null, startedEv(), NOW))
  s = must(reduceComputerTaskEvent(s, stepEv({ seq: 1 }), NOW))
  s = must(reduceComputerTaskEvent(s, stepEv({ seq: 2, caption: "点击「播放」", budgetLeft: 13 }), NOW))
  assert.equal(s.steps.length, 2)
  assert.equal(s.steps[1].seq, 2)
  assert.equal(s.steps[1].budgetLeft, 13)
  assert.equal(s.status, "running")

  s = must(reduceComputerTaskEvent(s, { event: "paused", taskId: "task-1", seq: 3, reason: "屏幕内容变化,需重新确认" }, NOW))
  assert.equal(s.status, "paused")
  assert.equal(s.pauseReason, "屏幕内容变化,需重新确认")

  s = must(reduceComputerTaskEvent(s, stepEv({ seq: 3 }), NOW))
  assert.equal(s.status, "running")
  assert.equal(s.steps.length, 3)
})

test("finished 合并结果(ok/completed/errorCode/evidenceDir + finishedAt)", () => {
  let s = must(reduceComputerTaskEvent(null, startedEv(), NOW))
  s = must(reduceComputerTaskEvent(s, stepEv(), NOW))
  s = must(reduceComputerTaskEvent(s, {
    event: "finished",
    taskId: "task-1",
    ok: false,
    completed: 3,
    errorCode: "TASK_ABORTED",
    evidenceDir: "C:\\Users\\x\\computer-evidence\\task-1",
  }, NOW))
  assert.equal(s.status, "finished")
  assert.equal(s.ok, false)
  assert.equal(s.completed, 3)
  assert.equal(s.errorCode, "TASK_ABORTED")
  assert.equal(s.evidenceDir, "C:\\Users\\x\\computer-evidence\\task-1")
  assert.equal(s.finishedAt, NOW)
})

// --- 乱序/迟到事件 ---

test("finished 后同 taskId 的 step/paused/重复 finished 一律丢弃", () => {
  let s = must(reduceComputerTaskEvent(null, startedEv(), NOW))
  s = must(reduceComputerTaskEvent(s, { event: "finished", taskId: "task-1", ok: true, completed: 5 }, NOW))
  const frozen = s
  s = must(reduceComputerTaskEvent(s, stepEv({ seq: 99 }), NOW))
  assert.equal(s, frozen)
  s = must(reduceComputerTaskEvent(s, { event: "paused", taskId: "task-1", reason: "late" }, NOW))
  assert.equal(s, frozen)
  s = must(reduceComputerTaskEvent(s, { event: "finished", taskId: "task-1", ok: false, errorCode: "X" }, NOW))
  assert.equal(s, frozen)
  assert.equal(s.ok, true) // 首个 finished 的结果不被覆盖(幂等)
})

test("未知 taskId 的 finished 丢弃(从未跟踪的任务完结无需展示)", () => {
  assert.equal(reduceComputerTaskEvent(null, { event: "finished", taskId: "ghost", ok: true }, NOW), null)
  const running = must(reduceComputerTaskEvent(null, startedEv(), NOW))
  const s = reduceComputerTaskEvent(running, { event: "finished", taskId: "ghost", ok: true }, NOW)
  assert.equal(s, running)
})

test("重复 started 重置任务状态(同 id 重启语义)", () => {
  let s = must(reduceComputerTaskEvent(null, startedEv(), NOW))
  s = must(reduceComputerTaskEvent(s, stepEv({ seq: 1 }), NOW))
  s = must(reduceComputerTaskEvent(s, startedEv({ task: "新任务文本" }), NOW))
  assert.equal(s.task, "新任务文本")
  assert.deepEqual(s.steps, [])
  assert.equal(s.status, "running")
})

test("新任务的 started 取代旧任务状态(服务器串行化任务,旧任务必然已结束)", () => {
  let s = must(reduceComputerTaskEvent(null, startedEv(), NOW))
  s = must(reduceComputerTaskEvent(s, startedEv({ taskId: "task-2", task: "另一个任务" }), NOW))
  assert.equal(s.taskId, "task-2")
  assert.equal(s.task, "另一个任务")
})

test("畸形事件(缺 taskId / 空 taskId / 非对象)不改变状态", () => {
  const running = must(reduceComputerTaskEvent(null, startedEv(), NOW))
  assert.equal(reduceComputerTaskEvent(running, { event: "step" } as any, NOW), running)
  assert.equal(reduceComputerTaskEvent(running, { event: "step", taskId: "" }, NOW), running)
  assert.equal(reduceComputerTaskEvent(running, null as any, NOW), running)
  assert.equal(reduceComputerTaskEvent(null, { event: "step" } as any, NOW), null)
})

// --- P4:迟连懒创建(急停按钮的存在性优先于事件流整洁性) ---

test("P4:面板迟连 → 首个 step 事件懒创建「恢复同步」状态,任务条与急停按钮可用", () => {
  // 面板重开/迟连,错过 started;首个见到的是 step。
  const s = must(reduceComputerTaskEvent(null, stepEv({ taskId: "task-late", seq: 7 }), NOW))
  assert.equal(s.taskId, "task-late", "taskId 必须可用于 computer.task.abort 的急停按钮")
  assert.equal(s.status, "running")
  assert.equal(s.resyncing, true, "必须带「恢复同步」标记,与正常态区分")
  assert.equal(s.steps.length, 1)
  assert.equal(s.abortAcked, false)
  // app/task/total/budget 未知(started 未收到),为 undefined 而非伪造值。
  assert.equal(s.app, undefined)
  assert.equal(s.task, undefined)
  assert.equal(s.budget, undefined)
})

test("P4:未知 taskId 的 paused 同样懒创建(置 paused + 恢复同步标记)", () => {
  const s = must(reduceComputerTaskEvent(null, { event: "paused", taskId: "task-late", seq: 4, reason: "re-L2" }, NOW))
  assert.equal(s.status, "paused")
  assert.equal(s.resyncing, true)
  assert.equal(s.pauseReason, "re-L2")
})

test("P4:懒创建后 started 到达 → 转为正常显示(resyncing=false)", () => {
  let s = must(reduceComputerTaskEvent(null, stepEv({ taskId: "task-late", seq: 7 }), NOW))
  assert.equal(s.resyncing, true)
  s = must(reduceComputerTaskEvent(s, startedEv({ taskId: "task-late", task: "迟到的 started" }), NOW))
  assert.equal(s.resyncing, false)
  assert.equal(s.task, "迟到的 started")
})

test("P4:当前任务已完结后来自下一任务的 step → 懒创建新任务(旧完结态被取代)", () => {
  let s = must(reduceComputerTaskEvent(null, startedEv(), NOW))
  s = must(reduceComputerTaskEvent(s, { event: "finished", taskId: "task-1", ok: true }, NOW))
  s = must(reduceComputerTaskEvent(s, stepEv({ taskId: "task-2", seq: 1 }), NOW))
  assert.equal(s.taskId, "task-2")
  assert.equal(s.resyncing, true)
  assert.equal(s.status, "running")
})

// --- 时间线截断与字节上限 ---

function mkSteps(n: number, imageLen = 0): ComputerStepView[] {
  const steps: ComputerStepView[] = []
  for (let i = 1; i <= n; i++) {
    steps.push({
      seq: i,
      caption: `第 ${i} 步`,
      previewImage: imageLen > 0 ? "A".repeat(imageLen) : undefined,
    })
  }
  return steps
}

test("capTimeline:超过 30 步只保留最近 30 步", () => {
  const out = capTimeline(mkSteps(COMPUTER_TIMELINE_MAX_STEPS + 5))
  assert.equal(out.length, COMPUTER_TIMELINE_MAX_STEPS)
  assert.equal(out[0].seq, 6) // 最旧 5 步被丢弃
  assert.equal(out[out.length - 1].seq, 35)
})

test("capTimeline:预览图总字节超 4MB → 从最旧的图开始丢,文字行保留", () => {
  // 每张图 base64 长度使估算字节 ≈1MB → 5 张 ≈5MB > 4MB 上限。
  const perImage = Math.floor((1024 * 1024 * 4) / 3)
  const steps = mkSteps(5, perImage)
  const out = capTimeline(steps, 30, COMPUTER_TIMELINE_MAX_IMAGE_BYTES)
  assert.equal(out.length, 5, "步数不变——只丢图不丢行")
  const withImage = out.filter(s => typeof s.previewImage === "string")
  assert.ok(withImage.length < 5, "至少最旧的一张图被丢")
  assert.ok(withImage.length >= 3, "不应丢到一张不剩(4 张 ≈4MB 在限内或恰边界)")
  // 丢图顺序:最旧优先。
  assert.equal(out[0].previewImage, undefined)
  // 文字行始终保留。
  assert.equal(out[0].caption, "第 1 步")
  // 总字节回到限内。
  const total = out.reduce((sum, s) => sum + (s.previewImage ? Math.floor((s.previewImage.length * 3) / 4) : 0), 0)
  assert.ok(total <= COMPUTER_TIMELINE_MAX_IMAGE_BYTES)
})

test("capTimeline:未超限时原样保留(内容与顺序)", () => {
  const steps = mkSteps(3, 100)
  const out = capTimeline(steps)
  assert.equal(out.length, 3)
  assert.ok(out.every(s => typeof s.previewImage === "string"))
})

// --- previewImageSafe 渲染守卫 ---

test("previewImageSafe:非空 string 且 ≤300KB(估算)才放行", () => {
  assert.equal(previewImageSafe("QUJD"), true)
  // 恰好 300KB 边界放行。
  assert.equal(previewImageSafe("A".repeat(PREVIEW_IMAGE_MAX_BYTES * 4 / 3)), true)
  // 超 300KB 拒渲染。
  assert.equal(previewImageSafe("A".repeat(PREVIEW_IMAGE_MAX_BYTES * 4 / 3 + 4)), false)
  // 非 string / 空串拒渲染。
  assert.equal(previewImageSafe(""), false)
  assert.equal(previewImageSafe(undefined), false)
  assert.equal(previewImageSafe(null), false)
  assert.equal(previewImageSafe(12345), false)
})

// --- isValidEvidenceTaskId(镜像 evidence.ts 清洗规则) ---

test("isValidEvidenceTaskId:仅 [a-zA-Z0-9_-]+ 通过;路径穿越/空/非 string 拒绝", () => {
  assert.equal(isValidEvidenceTaskId("task-abc_123"), true)
  assert.equal(isValidEvidenceTaskId("ABC"), true)
  assert.equal(isValidEvidenceTaskId("../.."), false)
  assert.equal(isValidEvidenceTaskId("a/b"), false)
  assert.equal(isValidEvidenceTaskId("a\\b"), false)
  assert.equal(isValidEvidenceTaskId("a b"), false)
  assert.equal(isValidEvidenceTaskId("a.b"), false)
  assert.equal(isValidEvidenceTaskId(""), false)
  assert.equal(isValidEvidenceTaskId(undefined), false)
  assert.equal(isValidEvidenceTaskId(null), false)
  assert.equal(isValidEvidenceTaskId(42), false)
})

// --- reducer 集成:COMPUTER_TASK_EVENT / ABORT_ACK / SET_COMPUTER_COORDINATE_STATE ---

test("reducer:COMPUTER_TASK_EVENT 折叠进 computerTask 切片", () => {
  let s = agentReducer(initialState, { type: "COMPUTER_TASK_EVENT", event: startedEv() })
  const t1 = must(s.computerTask)
  assert.equal(t1.taskId, "task-1")
  s = agentReducer(s, { type: "COMPUTER_TASK_EVENT", event: stepEv() })
  assert.equal(must(s.computerTask).steps.length, 1)
})

test("reducer:COMPUTER_TASK_ABORT_ACK 仅 matched>0 且 taskId 匹配时置 abortAcked", () => {
  const s = agentReducer(initialState, { type: "COMPUTER_TASK_EVENT", event: startedEv() })
  // 不同 taskId → 不置位。
  let s2 = agentReducer(s, { type: "COMPUTER_TASK_ABORT_ACK", taskId: "other", matched: 1 })
  assert.equal(must(s2.computerTask).abortAcked, false)
  // matched=0(服务器未找到运行中的任务)→ 不置位。
  s2 = agentReducer(s, { type: "COMPUTER_TASK_ABORT_ACK", taskId: "task-1", matched: 0 })
  assert.equal(must(s2.computerTask).abortAcked, false)
  // 同 taskId 且 matched>0 → 置位(任务条据此显示「已急停,等待任务退出…」)。
  s2 = agentReducer(s, { type: "COMPUTER_TASK_ABORT_ACK", taskId: "task-1", matched: 1 })
  assert.equal(must(s2.computerTask).abortAcked, true)
  // 无任务时 ack 不创造状态。
  const s3 = agentReducer(initialState, { type: "COMPUTER_TASK_ABORT_ACK", taskId: "task-1", matched: 1 })
  assert.equal(s3.computerTask, null)
})

test("reducer:COMPUTER_TASK_ABORT_ACK task_id='*'(急停全部)对当前任务生效", () => {
  let s = agentReducer(initialState, { type: "COMPUTER_TASK_EVENT", event: startedEv() })
  s = agentReducer(s, { type: "COMPUTER_TASK_ABORT_ACK", taskId: "*", matched: 2 })
  assert.equal(must(s.computerTask).abortAcked, true)
})

test("reducer:SET_COMPUTER_COORDINATE_STATE 镜像 computer.state 全局开关", () => {
  let s = agentReducer(initialState, { type: "SET_COMPUTER_COORDINATE_STATE", enabled: true })
  assert.equal(s.computerCoordinateEnabled, true)
  s = agentReducer(s, { type: "SET_COMPUTER_COORDINATE_STATE", enabled: false })
  assert.equal(s.computerCoordinateEnabled, false)
  assert.equal(initialState.computerCoordinateEnabled, null)
})

test("reducer:P4 懒创建经 COMPUTER_TASK_EVENT 直达切片(面板迟连端到端路径)", () => {
  const s = agentReducer(initialState, { type: "COMPUTER_TASK_EVENT", event: stepEv({ taskId: "task-late", seq: 3 }) })
  const t = must(s.computerTask)
  assert.equal(t.resyncing, true)
  assert.equal(t.taskId, "task-late")
})

// --- finished 后的 step 事件不再追加时间线(防御:状态机越态) ---

test("finished 后同 id step 不追加时间线(经 reducer 集成路径)", () => {
  let s = agentReducer(initialState, { type: "COMPUTER_TASK_EVENT", event: startedEv() })
  s = agentReducer(s, { type: "COMPUTER_TASK_EVENT", event: stepEv({ seq: 1 }) })
  s = agentReducer(s, { type: "COMPUTER_TASK_EVENT", event: { event: "finished", taskId: "task-1", ok: true, completed: 1 } })
  const stepsAfterFinish = must(s.computerTask).steps.length
  s = agentReducer(s, { type: "COMPUTER_TASK_EVENT", event: stepEv({ seq: 2 }) })
  const t = must(s.computerTask)
  assert.equal(t.steps.length, stepsAfterFinish)
  assert.equal(t.status, "finished")
})
