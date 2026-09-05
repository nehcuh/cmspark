import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  makeToast,
  pushToast,
  dismissToast,
  headToast,
  TOAST_KINDS,
  isToastKind,
} from "../src/sidepanel/ui/toastQueue"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

// GitHub: #321 PR-3 — 顶栏与 chrome 卫生 (StatusRail brand dot resident, ⋯ menu
// grouped 会话/能力/诊断, disconnect single-CTA, toast single queue). T1 chrome only.

test("PR-3 rail: brand dot (CompanionMark) is resident — no longer gated on cruise/disconnect", () => {
  const rail = src("src/sidepanel/components/StatusRail.tsx")
  // The old gate `{!(cruiseLabel || connectionState !== "connected") && …}` is gone.
  assert.ok(!/!\(cruiseLabel \|\| connectionState !== "connected"\)/.test(rail))
  assert.ok(!/CMspark<\/span>/.test(rail), "wordmark text replaced by mark")
  assert.match(rail, /CompanionMark size=\{16\}/)
})

test("PR-3 rail: ⋯ menu is grouped under 会话 / 能力 / 诊断 labels", () => {
  const rail = src("src/sidepanel/components/StatusRail.tsx")
  const menu = rail.slice(rail.indexOf('role="menu"'), rail.indexOf("const railStyles"))
  // Three group headers present, in order.
  const labels = [...menu.matchAll(/menuGroupLabel[^>]*>\s*([^\s<]+)/g)].map((m) => m[1])
  const zh = labels.filter((l) => /[会话能力诊断]/.test(l))
  const order = zh.join("")
  assert.ok(order.includes("会话"), `headers ${zh}`)
  assert.ok(order.includes("能力"), `headers ${zh}`)
  assert.ok(order.includes("诊断"), `headers ${zh}`)
  assert.ok(order.indexOf("会话") < order.indexOf("能力"), "会话 before 能力")
  assert.ok(order.indexOf("能力") < order.indexOf("诊断"), "能力 before 诊断")
  // Menu keeps the item texts (导出摘要 label may live in a status ternary).
  for (const item of ["提取技能", "导出为 Markdown", "NotebookLM 导入", "日志", "设置", "密钥与环境"]) {
    assert.ok(menu.includes(`<span>${item}</span>`), `menu item ${item}`)
  }
  assert.ok(menu.includes("\"导出摘要\"") || menu.includes("导出摘要"), "导出摘要 present")
  // NB rename: the "导出当前页 (NB)" English-abbrev label is gone.
  assert.ok(!/导出当前页 \(NB\)/.test(menu))
  assert.ok(menu.includes("离线导出当前页"), "NB item renamed to Chinese 离线导出当前页")
})

test("PR-3 rail: export menu item still sends the same thread.export_obsidian", () => {
  const rail = src("src/sidepanel/components/StatusRail.tsx")
  assert.match(rail, /type: "thread\.export_obsidian"/)
  assert.match(rail, /thread_id: state\.activeThreadId/)
  assert.match(rail, /scope: "thread"/)
  assert.match(rail, /include_reasoning: state\.exportIncludeReasoning === true/)
})

test("PR-3 disconnect: single recovery CTA — rail disconnected is passive, banner owns reconnect", () => {
  const rail = src("src/sidepanel/components/StatusRail.tsx")
  const app = src("src/sidepanel/App.tsx")
  // Rail disconnected renders a status pill (role=status), not a second CTA button
  // that jumps to connection settings.
  assert.match(rail, /connectionState === "connecting" \? \(/)
  // Connecting keeps the pill-as-button route (no banner shows then); disconnected is a span.
  assert.match(rail, /role="status"[^>]*aria-label=\{connLabel\}[^>]*title="Companion 未连接/)
  // DisconnectedBanner (bottom) is the single retry surface.
  assert.match(app, /<DisconnectedBanner\b/)
  assert.match(app, />\s*重新连接\s*</)
})

test("PR-3 LogBar entry sits in the 诊断 group", () => {
  const rail = src("src/sidepanel/components/StatusRail.tsx")
  const menu = rail.slice(rail.indexOf('role="menu"'), rail.indexOf("const railStyles"))
  const diagIdx = menu.indexOf("诊断")
  const logIdx = menu.indexOf("<span>日志</span>")
  assert.ok(diagIdx >= 0 && logIdx > diagIdx, "日志 after 诊断 label")
})

test("PR-3 toast: burst of 3 queues serially (bounded, no pile-up) with kinds", () => {
  let list = [] as ReturnType<typeof makeToast>[]
  for (let i = 0; i < 3; i++) {
    list = pushToast(list, makeToast(`toast-${i}`, i === 2 ? "warning" : "info"))
  }
  assert.equal(list.length, 3)
  // FIFO order preserved: head is the first toast.
  assert.equal(headToast(list)?.message, "toast-0")
  // A 4th burst drops the oldest (bounded queue) rather than overlapping.
  list = pushToast(list, makeToast("toast-3", "error"))
  assert.equal(list.length, 3)
  assert.equal(headToast(list)?.message, "toast-1")
  // dismiss removes exactly one.
  const afterDismiss = dismissToast(list, list[1].id)
  assert.equal(afterDismiss.length, 2)
})

test("PR-3 toast kinds are typed (info/warning/error) and isToastKind validates", () => {
  assert.deepEqual(TOAST_KINDS, ["info", "warning", "error"])
  assert.ok(isToastKind("info") && isToastKind("warning") && isToastKind("error"))
  assert.ok(!isToastKind("success") && !isToastKind(undefined))
})

test("PR-3 toast position is decoupled from the rail: no top:52 hardcode", () => {
  const app = src("src/sidepanel/App.tsx")
  // The old fixed `top: 52` toast styles were removed entirely (no toastStyles
  // object; only the explanatory comment mentions the removed value).
  assert.ok(!/toastStyles/.test(app))
  assert.ok(!/position: "fixed"[^}]*top: 52/.test(app))
  // ToastHost is anchored via a zero-height slot under StatusRail (no rail math).
  assert.match(app, /height: 0, flexShrink: 0/)
  assert.match(app, /<ToastHost toasts=\{toasts\} onClose=\{closeToast\} \/>/)
  assert.match(app, /useToastQueue\(\)/)
  // A single queue hook backs auto-skill + escalate + cmspark:toast listener.
  assert.match(app, /showToast\(/)
})
