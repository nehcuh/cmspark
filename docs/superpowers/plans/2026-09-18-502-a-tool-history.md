# 502-A 工具史折叠 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> GitHub: #502 · Spec: `docs/superpowers/specs/2026-09-18-agent-operate-surface-design.md` §2
> 线稿：`.impeccable/mocks/agent-ux-2026-09-18-wires.html` 切片 1
> Blast: **T1** · 纯 Side Panel 视图 · 不改 persist · overlay 不画

**Goal:** 同一 assistant 回合的工具卡：进行中只展开当前步；回合结束后收成一颗审计芯。

**Architecture:** 抽出纯函数 `tool-history-view.ts`（与 `run-progress-view.ts` 同层）。`ChatView` 的 `MessageRow` 对 `msg.tool_calls` 走该视图，不再无脑 `map` 全部 `ToolCallCard`。折叠是视图状态，不写 `thread.collapsed`。

**Tech Stack:** Chrome extension React · node:test（`chrome-extension/tests/`）

**NEVER:** 改 `run_progress` 语义；overlay 画工具史；把 L2 确认中的工具折进芯；FocusBand / 急停埋进芯。

---

### Task 1: 纯函数 + 失败测试

**Files:**
- Create: `chrome-extension/src/sidepanel/components/tool-history-view.ts`
- Create: `chrome-extension/tests/tool-history-view.test.ts`

工具形状（与 `ToolCallCard` 已消费的字段对齐，不要发明新协议）：

```ts
export type HistoryTool = {
  id?: string
  tool_name?: string
  status?: string // "running" | "success" | "error" | …
  result?: unknown
  error?: unknown
}

export type HistoryView =
  | { kind: "empty" }
  | {
      kind: "live"
      completed: HistoryTool[]
      current: HistoryTool
      failed: number
      expandedCompleted: boolean
    }
  | {
      kind: "done"
      tools: HistoryTool[]
      failed: number
      expanded: boolean
    }
```

规则（必须钉测试）：

1. `tools.length === 0` → `empty`
2. 任一 `status === "running"` 或 `pendingConfirmIds` 命中该 `id` → `live`：`current` = 最后一个 running / 确认中的；它之前的进 `completed`
3. 否则若 `threadBusy === true` 且最后一条尚未有 result → 仍 `live`（当前=最后一条）
4. 否则 → `done`
5. `failed` = `status === "error"` 或 `error` 有值的条数
6. `pendingConfirmIds` 命中的工具 **必须** 是 `current`，不得进芯
7. 单条成功且不 busy → `done` 仍出芯（1 步也收；不要特例铺开，线稿是「答案优先」）

- [ ] **Step 1: Write the failing test**

`chrome-extension/tests/tool-history-view.test.ts`：

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { viewToolHistory } from "../src/sidepanel/components/tool-history-view"

const nav = { id: "1", tool_name: "navigate", status: "success" }
const click = { id: "2", tool_name: "click", status: "success" }
const run = { id: "3", tool_name: "get_page_text", status: "running" }
const err = { id: "4", tool_name: "click", status: "error", error: "x" }

test("empty", () => {
  assert.equal(viewToolHistory([], { threadBusy: false }).kind, "empty")
})

test("live: completed chip + current running", () => {
  const v = viewToolHistory([nav, click, run], { threadBusy: true })
  assert.equal(v.kind, "live")
  if (v.kind !== "live") return
  assert.equal(v.completed.length, 2)
  assert.equal(v.current.id, "3")
  assert.equal(v.failed, 0)
})

test("L2 pending is current, never folded", () => {
  const v = viewToolHistory([nav, click], {
    threadBusy: true,
    pendingConfirmIds: new Set(["2"]),
  })
  assert.equal(v.kind, "live")
  if (v.kind !== "live") return
  assert.equal(v.current.id, "2")
  assert.equal(v.completed.length, 1)
})

test("done after turn: one audit chip", () => {
  const v = viewToolHistory([nav, click, err], { threadBusy: false })
  assert.equal(v.kind, "done")
  if (v.kind !== "done") return
  assert.equal(v.tools.length, 3)
  assert.equal(v.failed, 1)
})

test("copy helpers", () => {
  const { liveChipLabel, doneChipLabel } = await import(
    "../src/sidepanel/components/tool-history-view"
  )
  assert.equal(liveChipLabel(6, 0), "已完成 6 步 · 展开")
  assert.equal(liveChipLabel(6, 1), "已完成 6 步 · 1 失败 · 展开")
  assert.equal(doneChipLabel(8, 0), "8 步浏览器操作 · 0 失败 · 展开审计")
  assert.equal(doneChipLabel(8, 1), "8 步浏览器操作 · 1 失败 · 展开审计")
})
```

（若项目用同步 import，把 copy helpers 改成静态 import。）

- [ ] **Step 2: Run test to verify it fails**

```bash
nvm use 22
npm --prefix chrome-extension test -- tests/tool-history-view.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Minimal implementation** of `viewToolHistory` / `liveChipLabel` / `doneChipLabel` in `tool-history-view.ts`.

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit** `test(ext): tool history view grouping (#502 A)`

---

### Task 2: ChatView 接线

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/ChatView.tsx`（`MessageRow` 里 `msg.tool_calls?.map` 约 L756）
- Modify: `chrome-extension/tests/message-quiet-pr6.test.ts`（现有 ToolCallCard 断言不得被破坏：源码仍含 `ToolCallCard` / `data-testid`）

`MessageRow` 内：

```tsx
const [auditOpen, setAuditOpen] = useState(false)
const pendingConfirmIds = /* from store: pendingSecurityConfirmations[].tool_call_id 非空集合 */
const view = viewToolHistory(msg.tool_calls || [], {
  threadBusy: Boolean(isLast && threadBusy),
  pendingConfirmIds,
})
```

渲染：

- `empty`：不画工具
- `live`：若 `completed.length`：一颗 `button.chip`（`aria-expanded={auditOpen}`），展开则 `completed.map(ToolCallCard)`；然后 **始终** `ToolCallCard` for `current`
- `done`：一颗审计芯；`auditOpen` 时再 map 全部 `ToolCallCard`；默认不画卡

`threadBusy` 只对 **最后一条** assistant 消息为 true（`isLast`）。历史消息一律 `done`。

L2：`pendingSecurityConfirmations` 已在 `agentStore`。只把 **当前消息** `tool_calls[].id` 与 confirm 的 `tool_call_id` 相交。

键盘：芯片是 `button`，Enter/Space 由 button 自带。

- [ ] **Step 1:** 加一个源码扫描测试（与 `message-quiet-pr6` 同风格）：`ChatView.tsx` 含 `viewToolHistory`、`展开审计`、`aria-expanded`；**不含** overlay 工具史。

- [ ] **Step 2:** 接线。确认中的工具仍走现有 `ToolCallCard`（含停止按钮等），不得被芯吞掉。

- [ ] **Step 3:** `npm --prefix chrome-extension test -- tests/tool-history-view.test.ts tests/message-quiet-pr6.test.ts tests/running-tools.test.ts`

- [ ] **Step 4:** Commit `feat(sidepanel): collapse completed tool cards into audit chip (#502 A)`

---

### Task 3: 验收

- [ ] 一轮 ≥4 个 success 工具、thread 空闲：视口默认 1 芯 + 答案正文，不是 4 张卡
- [ ] 点芯能看到每一步 `ToolCallCard`
- [ ] running / L2 确认中：当前卡可见
- [ ] overlay 无改动（`SUMMONER_ALLOW` / overlay 组件 grep 无 tool-history）
- [ ] `run_progress` 文件未改

---

不在本 PR：归档 stub（B）、Goal（D 除 G1）、舰队（E）、终端（C）。
