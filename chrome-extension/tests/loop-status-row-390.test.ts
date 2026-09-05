import test from "node:test"
import assert from "node:assert/strict"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

// L-4 (#390) loop UI acceptance:
//  - 状态行各态非空真渲染（#356 教训 — no silent empty state）
//  - done 永远不是「任务已完成」（#397 MAJOR-2 machine-tier 承接）
//  - 停止续跑 = task_loop.stop（≠ 急停 computer.task.abort）
//  - 建议卡点卡 = task_loop.arm 显式手势（source=suggestion_card + user_gesture）
//  - 320px 不加面板：in-transcript 横幅形态（非 overlay/portal/modal）

import {
  LoopStatusRow,
  LoopSuggestCard,
  backfillLoopView,
  loopArmMessage,
  loopStopMessage,
} from "../src/sidepanel/components/LoopStatusRow"
import type { LoopStatusView, Thread } from "../src/sidepanel/types"

const TID = "th_loop"

function view(partial: Partial<LoopStatusView>): LoopStatusView {
  return {
    phase: "advancing",
    label: "",
    detail: "",
    done: 0,
    total: 0,
    tier: "",
    status: "active",
    ...partial,
  }
}

function renderRow(v: LoopStatusView, pendingConfirms = 0): string {
  return renderToStaticMarkup(
    createElement(LoopStatusRow, { view: v, threadId: TID, pendingConfirms }),
  )
}

const PHASES: Array<LoopStatusView> = [
  view({ phase: "advancing", label: "推进中 2/5", detail: "", done: 2, total: 5, status: "active", tier: "巡航·全自动" }),
  view({ phase: "rerouting", label: "换路中", detail: "尝试 host_computer：仍走既有 L2 确认", status: "active" }),
  view({ phase: "awaiting_confirm", label: "等待确认", detail: "工具调用待你确认，续跑暂停中", status: "active" }),
  view({ phase: "blocked", label: "受阻：缺钥匙/登录", detail: "第 3 项需要登录后重试", status: "active" }),
  view({ phase: "done", label: "计划完成，待你确认", detail: "机器核验：清单全勾", status: "completed" }),
  view({ phase: "impossible", label: "无法完成：钥匙清单", detail: "it1：需要你登录；it2：需要 X 权限", status: "stopped_no_checklist" }),
  view({ phase: "stopped", label: "已停止续跑", detail: "要继续做完请点建议卡重新激活", status: "stopped_user" }),
  view({ phase: "halt", label: "安全熔断，未自动续跑", detail: "", status: "halt_security" }),
]

test("状态行各态非空真渲染（8 相位逐一）", () => {
  for (const v of PHASES) {
    const html = renderRow(v)
    assert.ok(html.length > 40, `${v.phase} 必须渲染出内容`)
    assert.ok(v.label.length > 0 && html.includes(v.label), `${v.phase} label 必须出现在标记里`)
    assert.match(html, /data-loop-phase="[^"]+"/, "相位可识别（data-loop-phase）")
  }
})

test("done 语义承接：机器核验完成呈现「计划完成，待你确认」，绝不出现「任务已完成」", () => {
  const done = PHASES.find((v) => v.phase === "done")!
  const html = renderRow(done)
  assert.ok(html.includes("计划完成，待你确认"), "machine-tier done 文案必须呈现待确认语义")
  for (const v of PHASES) {
    assert.ok(!renderRow(v).includes("任务已完成"), `${v.phase} 不得出现「任务已完成」`)
  }
  const backfilled = backfillLoopView({ loop_state: { status: "completed" } } as Thread)
  assert.equal(backfilled?.label, "计划完成，待你确认")
  assert.ok(!backfilled?.label.includes("任务已完成"))
})

test("受阻与无法完成区分：blocked 带原因、impossible 带钥匙清单", () => {
  const blocked = renderRow(PHASES.find((v) => v.phase === "blocked")!)
  assert.ok(blocked.includes("受阻：缺钥匙/登录"), "blocked = 受阻：原因")
  const impossible = renderRow(PHASES.find((v) => v.phase === "impossible")!)
  assert.ok(impossible.includes("无法完成：钥匙清单"), "impossible = 无法完成：钥匙清单")
})

test("awaiting_confirm 本地抬升：advancing + pendingConfirms>0 → 等待确认", () => {
  const advancing = PHASES.find((v) => v.phase === "advancing")!
  const html = renderRow(advancing, 1)
  assert.ok(html.includes("等待确认"), "有挂起确认时抬升为等待确认")
  assert.match(html, /data-loop-phase="awaiting_confirm"/)
  // 无挂起确认时保持推进中
  const plain = renderRow(advancing, 0)
  assert.ok(plain.includes("推进中 2/5"))
  assert.match(plain, /data-loop-phase="advancing"/)
})

test("停止续跑按钮仅在 loop active 时出现", () => {
  const withStop = renderRow(view({ phase: "advancing", label: "推进中 1/3", status: "active" }))
  assert.ok(withStop.includes(">停止续跑</button>"), "active 态必须有停止续跑按钮")
  for (const terminal of ["done", "impossible", "stopped", "halt"] as const) {
    const html = renderRow(PHASES.find((v) => v.phase === terminal)!)
    // 「已停止续跑」label 含子串 — 必须按按钮元素断言，不按裸子串
    assert.ok(!html.includes(">停止续跑</button>"), `${terminal} 终态不出现停止续跑按钮`)
  }
})

test("停止续跑手势 = task_loop.stop（不是急停 computer.task.abort）", () => {
  const msg = loopStopMessage(TID)
  assert.equal(msg.type, "task_loop.stop")
  assert.equal(msg.thread_id, TID)
  assert.equal(msg.user_gesture, true)
  const json = JSON.stringify(msg)
  assert.ok(!json.includes("computer.task.abort"), "停止续跑 ≠ 急停桌面")
})

test("建议卡点卡 = task_loop.arm 显式手势（source=suggestion_card + user_gesture）", () => {
  const msg = loopArmMessage(TID, false)
  assert.deepEqual(msg, {
    type: "task_loop.arm",
    thread_id: TID,
    source: "suggestion_card",
    user_gesture: true,
  })
  // budget 停止的建议卡 = checkpoint resume（新一轮预算窗口）
  assert.deepEqual(loopArmMessage(TID, true), {
    type: "task_loop.arm",
    thread_id: TID,
    source: "suggestion_card",
    user_gesture: true,
    resume: true,
  })
})

test("建议卡真渲染：非阻断文案 + 未完成清单 + 继续做完按钮", () => {
  const html = renderToStaticMarkup(
    createElement(LoopSuggestCard, {
      threadId: TID,
      unticked: [
        { id: "i1", text: "提交退款表单" },
        { id: "i2", text: "上传凭证截图" },
      ],
      budgetStopped: false,
      onDismiss: () => {},
    }),
  )
  assert.ok(html.includes("要继续做完吗？"), "非阻断问句文案")
  assert.ok(html.includes("提交退款表单") && html.includes("上传凭证截图"), "未完成清单可见")
  assert.ok(html.includes("继续做完"), "激活按钮存在")
  assert.ok(!html.includes("modal") && !html.includes("portal"), "非模态")

  const budget = renderToStaticMarkup(
    createElement(LoopSuggestCard, {
      threadId: TID,
      unticked: [{ id: "i1", text: "提交退款表单" }],
      budgetStopped: true,
      onDismiss: () => {},
    }),
  )
  assert.ok(budget.includes("续跑预算已尽"), "budget 停止变体文案")
})

test("320px 不加面板：状态行是 transcript 内联块（非 fixed/overlay）", () => {
  for (const v of PHASES) {
    const html = renderRow(v)
    assert.ok(!html.includes("position:fixed"), `${v.phase} 不是 overlay`)
    assert.ok(!html.includes("position:absolute"), `${v.phase} 不是浮层`)
    assert.ok(html.startsWith('<div data-testid="loop-status-row"'), "块级横幅形态")
  }
})

test("面板重开回填：loop_state.status 单字段也能给出非空 label", () => {
  assert.equal(backfillLoopView(undefined), null)
  assert.equal(backfillLoopView({ loop_state: null } as Thread), null)
  const active = backfillLoopView({ loop_state: { status: "active" } } as Thread)
  assert.equal(active?.phase, "advancing")
  assert.ok(active!.label.length > 0, "active 回填非空")
  const cases: Array<[string, string]> = [
    ["stopped_budget", "续跑预算已尽"],
    ["stopped_user", "已停止续跑"],
    ["halt_security", "安全熔断，未自动续跑"],
    ["stopped_no_checklist", "受阻：无机器可核验清单"],
  ]
  for (const [status, label] of cases) {
    const v = backfillLoopView({ loop_state: { status } as any } as Thread)
    assert.equal(v?.label, label, `${status} 回填文案`)
    assert.ok(!v?.label.includes("任务已完成"))
  }
})
