# Run-state + Worker Drill-down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix false-idle Composer during complex turns; honest RunBusy chrome; worker drill-down with ScopeBar; multi-thread busy map + tool `thread_id` — per locked SoT.

**Architecture:** Pure `deriveThreadBusy` / `deriveRunBusy` drive Composer + chips. Companion stamps `thread_id` on tool.* and exposes LLM-active holders. Extension tracks `threadBusyById`, gates tool events, portals fleet worker list, mounts WorkerScopeBar. MinimalConfirm stop targets are stamp-first deny-safe.

**Tech Stack:** TypeScript · Chrome Extension (Plasmo/React) · Companion Node · `node:test` (extension) · companion unit/integration tests

**SoT:** [2026-08-04-run-state-and-worker-drilldown.md](../specs/2026-08-04-run-state-and-worker-drilldown.md)  
**Dual:** APPROVE_WITH_NITS `run-state-worker-drilldown-verdict-20260804-174619`

**Ship unit:** W0 + companion thread_id/llm_active + W1 + W2-min + F-S1 (same branch/PR). W3 out of scope.

---

## File map

| File | Role |
|------|------|
| `chrome-extension/src/sidepanel/utils/thread-busy.ts` | **Create** pure busy predicates + composer mode helpers |
| `chrome-extension/tests/thread-busy.test.ts` | **Create** unit matrix |
| `chrome-extension/src/sidepanel/App.tsx` | Composer canSend/Stop/placeholder; worker label |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | `threadBusyById`; clear on delete; SET_ACTIVE_THREAD policy |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | Gate tool.* ; update busy map; fleet llm_active |
| `chrome-extension/src/sidepanel/types.ts` | Fleet types + busy map types if needed |
| `chrome-extension/src/sidepanel/components/ChatView.tsx` | Fake-end strip clickable |
| `chrome-extension/src/sidepanel/components/WorkerScopeBar.tsx` | **Create** breadcrumb bar |
| `chrome-extension/src/sidepanel/components/FleetWorkerList.tsx` | **Create** shared list rows + enter |
| `chrome-extension/src/sidepanel/components/FleetStrip.tsx` | Portal popover; open list; 全停 copy |
| `chrome-extension/src/sidepanel/components/FocusBand.tsx` | Pass-through / open list callback |
| `chrome-extension/src/sidepanel/components/MinimalConfirm.tsx` | F-S1 stop target |
| `chrome-extension/src/sidepanel/components/RunBusyChip.tsx` | **Create** always-on chip when RunBusy |
| `companion/src/server.ts` | tool.start/result/progress + `thread_id` |
| `companion/src/orchestrator/fleet.ts` | `llm_active` on workers / snapshot |
| `companion/src/message-router.ts` | Export active LLM thread ids if needed |
| `docs/multi-agent-user-guide.md` | Drill-down + busy UX note |

---

### Task 1: Pure busy helpers + tests (W0 core)

**Files:**
- Create: `chrome-extension/src/sidepanel/utils/thread-busy.ts`
- Create: `chrome-extension/tests/thread-busy.test.ts`

- [x] **Step 1: Write failing tests** for `deriveThreadBusy`, `deriveRunBusy`, `resolveComposerMode`, `resolveParentThreadId`

```ts
// chrome-extension/tests/thread-busy.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import {
  deriveThreadBusy,
  deriveRunBusy,
  resolveComposerMode,
  resolveParentThreadId,
  resolveStopTargetId,
} from "../src/sidepanel/utils/thread-busy"

test("deriveThreadBusy: any of streaming/processing/tools", () => {
  assert.equal(deriveThreadBusy({ streaming: false, isProcessing: false, runningToolCount: 0 }), false)
  assert.equal(deriveThreadBusy({ streaming: true, isProcessing: false, runningToolCount: 0 }), true)
  assert.equal(deriveThreadBusy({ streaming: false, isProcessing: true, runningToolCount: 0 }), true)
  assert.equal(deriveThreadBusy({ streaming: false, isProcessing: false, runningToolCount: 1 }), true)
})

test("deriveRunBusy: idle residual workers alone are false", () => {
  assert.equal(
    deriveRunBusy({
      lockCount: 0,
      openIntents: 0,
      anyHoldingTabs: false,
      llmActiveThreadIds: [],
      workerBusyIds: [],
    }),
    false,
  )
})

test("deriveRunBusy: locks / holding / llm / workerBusy", () => {
  assert.equal(deriveRunBusy({ lockCount: 1, openIntents: 0, anyHoldingTabs: false, llmActiveThreadIds: [], workerBusyIds: [] }), true)
  assert.equal(deriveRunBusy({ lockCount: 0, openIntents: 1, anyHoldingTabs: false, llmActiveThreadIds: [], workerBusyIds: [] }), true)
  assert.equal(deriveRunBusy({ lockCount: 0, openIntents: 0, anyHoldingTabs: true, llmActiveThreadIds: [], workerBusyIds: [] }), true)
  assert.equal(deriveRunBusy({ lockCount: 0, openIntents: 0, anyHoldingTabs: false, llmActiveThreadIds: ["w1"], workerBusyIds: [] }), true)
  assert.equal(deriveRunBusy({ lockCount: 0, openIntents: 0, anyHoldingTabs: false, llmActiveThreadIds: [], workerBusyIds: ["w1"] }), true)
})

test("resolveComposerMode: taskActive wins; threadBusy stops send", () => {
  assert.equal(resolveComposerMode({ taskActive: true, threadBusy: true, runBusy: true, lockCount: 0 }), "l2_task")
  assert.equal(resolveComposerMode({ taskActive: false, threadBusy: true, runBusy: false, lockCount: 0 }), "thread_busy")
  assert.equal(resolveComposerMode({ taskActive: false, threadBusy: false, runBusy: true, lockCount: 2 }), "run_busy")
  assert.equal(resolveComposerMode({ taskActive: false, threadBusy: false, runBusy: false, lockCount: 0 }), "ready")
})

test("resolveStopTargetId: stamp first; multi-agent missing stamp null", () => {
  assert.equal(resolveStopTargetId({ workerId: "w1", activeThreadId: "a", multiAgentContext: true }), "w1")
  assert.equal(resolveStopTargetId({ workerId: null, activeThreadId: "a", multiAgentContext: true }), null)
  assert.equal(resolveStopTargetId({ workerId: null, activeThreadId: "a", multiAgentContext: false }), "a")
})

test("resolveParentThreadId order", () => {
  assert.equal(
    resolveParentThreadId({
      activeParentId: "p1",
      fleetParentId: "p2",
      orchestratorIdForRun: "o1",
    }),
    "p1",
  )
  assert.equal(
    resolveParentThreadId({
      activeParentId: null,
      fleetParentId: "p2",
      orchestratorIdForRun: "o1",
    }),
    "p2",
  )
  assert.equal(
    resolveParentThreadId({
      activeParentId: null,
      fleetParentId: null,
      orchestratorIdForRun: "o1",
    }),
    "o1",
  )
})
```

- [x] **Step 2: Implement `thread-busy.ts`** until tests pass

```ts
// chrome-extension/src/sidepanel/utils/thread-busy.ts
export type ThreadBusyInput = {
  streaming: boolean
  isProcessing: boolean
  runningToolCount: number
  mapBusy?: boolean
}

export function deriveThreadBusy(i: ThreadBusyInput): boolean {
  return !!(i.streaming || i.isProcessing || i.runningToolCount > 0 || i.mapBusy)
}

export type RunBusyInput = {
  lockCount: number
  openIntents: number
  anyHoldingTabs: boolean
  llmActiveThreadIds: string[]
  workerBusyIds: string[]
}

export function deriveRunBusy(i: RunBusyInput): boolean {
  if (i.lockCount > 0 || i.openIntents > 0 || i.anyHoldingTabs) return true
  if (i.llmActiveThreadIds.length > 0) return true
  if (i.workerBusyIds.length > 0) return true
  return false
}

export type ComposerMode = "l2_task" | "thread_busy" | "run_busy" | "ready"

export function resolveComposerMode(i: {
  taskActive: boolean
  threadBusy: boolean
  runBusy: boolean
  lockCount: number
}): ComposerMode {
  if (i.taskActive) return "l2_task"
  if (i.threadBusy) return "thread_busy"
  if (i.runBusy) return "run_busy"
  return "ready"
}

export function composerPlaceholder(mode: ComposerMode, opts?: { lockCount?: number; isWorker?: boolean; roleLabel?: string }): string {
  switch (mode) {
    case "l2_task":
      return "任务进行中 — 请在确认台发送指令或先急停"
    case "thread_busy":
      return "本对话处理中 · 停止后再指挥"
    case "run_busy": {
      const locks = opts?.lockCount && opts.lockCount > 0 ? ` · ${opts.lockCount} 锁仍活跃` : ""
      if (opts?.isWorker) return `子任务还在跑${locks} · 发送给子任务 · ${opts.roleLabel || "worker"}`
      return `子任务还在跑${locks} · 可继续指挥当前线程`
    }
    default:
      return opts?.isWorker ? `发送给子任务 · ${opts.roleLabel || "worker"}` : ""
  }
}

export function resolveStopTargetId(i: {
  workerId?: string | null
  activeThreadId?: string | null
  multiAgentContext: boolean
}): string | null {
  if (i.workerId) return i.workerId
  if (i.multiAgentContext) return null
  return i.activeThreadId || null
}

export function resolveParentThreadId(i: {
  activeParentId?: string | null
  fleetParentId?: string | null
  orchestratorIdForRun?: string | null
}): string | null {
  return i.activeParentId || i.fleetParentId || i.orchestratorIdForRun || null
}

/** Filter worker ids for busy map to an optional run */
export function filterIdsByRun(
  ids: string[],
  workers: Array<{ id: string; orchestrator_run_id?: string | null }>,
  runId?: string | null,
): string[] {
  if (!runId) return ids
  const allowed = new Set(workers.filter((w) => w.orchestrator_run_id === runId).map((w) => w.id))
  return ids.filter((id) => allowed.has(id))
}
```

- [x] **Step 3: Run tests** — PASS (extension suite green)

---

### Task 2: Composer gate (App.tsx)

**Files:**
- Modify: `chrome-extension/src/sidepanel/App.tsx`

- [x] **Step 1: Wire** `deriveThreadBusy` / `deriveRunBusy` / `resolveComposerMode` into InputArea

Logic sketch:

```ts
const runningTools = collectRunningTools(state.messages)
const mapBusy = !!state.threadBusyById?.[state.activeThreadId || ""]
const threadBusy = deriveThreadBusy({
  streaming: !!state.streamingContent,
  isProcessing: state.isProcessing,
  runningToolCount: runningTools.length,
  mapBusy,
})
const fleet = state.fleet
const activeThread = state.threads.find(t => t.id === state.activeThreadId)
const runId = activeThread?.orchestrator_run_id
const llmActive = (fleet?.llm_active_thread_ids || []).filter(/* run filter optional */)
const workerBusyIds = Object.entries(state.threadBusyById || {})
  .filter(([, b]) => b)
  .map(([id]) => id)
const runBusy = deriveRunBusy({
  lockCount: fleet?.lock_count ?? 0,
  openIntents: fleet?.open_intent_count ?? 0,
  anyHoldingTabs: (fleet?.workers || []).some(w => w.status === "holding_tabs"),
  llmActiveThreadIds: llmActive,
  workerBusyIds: filterIdsByRun(workerBusyIds, fleet?.workers || [], runId),
})
const mode = resolveComposerMode({ taskActive, threadBusy, runBusy, lockCount: fleet?.lock_count ?? 0 })
const canSend = mode !== "l2_task" && mode !== "thread_busy" && hasContent && connected && !!activeThreadId
// Stop when threadBusy (not only streaming)
// placeholder via composerPlaceholder + capability fallback when ready
```

- [ ] **Step 2: Manual smoke** — not required in CI; unit cover mode matrix in Task 1

---

### Task 3: Companion tool `thread_id` + fleet llm_active

**Files:**
- Modify: `companion/src/server.ts` (tool.start / tool.result / progress send)
- Modify: `companion/src/orchestrator/fleet.ts`
- Modify: `companion/src/message-router.ts` (export `listLlmActiveThreadIds` if not exists)
- Test: companion unit if easy; else extension gate test

- [ ] **Step 1: Add `thread_id` to tool WS payloads** where `actingThreadId` / tool context exists

```ts
ws.send(JSON.stringify({
  type: "tool.start",
  tool_call_id: toolCallId,
  tool_name: toolName,
  params: summarizeToolParams(finalParams),
  thread_id: actingThreadId || undefined,
}))
```

Same for `tool.result` and `tool.progress` send sites.

- [ ] **Step 2: Fleet snapshot** include `llm_active_thread_ids: string[]` from abortControllers / multiAgentLlmLoopSnapshot holders

```ts
// fleet.ts buildFleetSnapshot
llm_active_thread_ids: listLlmActiveThreadIds(), // from message-router
// optional per-worker llm_active: boolean
```

- [ ] **Step 3: Export** from message-router:

```ts
export function listLlmActiveThreadIds(): string[] {
  return [...abortControllers.keys()]
}
```

---

### Task 4: useWebSocket + agentStore busy map (W2-min)

**Files:**
- Modify: `chrome-extension/src/sidepanel/store/agentStore.tsx`
- Modify: `chrome-extension/src/sidepanel/hooks/useWebSocket.ts`
- Modify: `chrome-extension/src/sidepanel/types.ts` (FleetSnapshot)
- Create/Modify: `chrome-extension/tests/stream-thread-gate.test.ts` (tool gate note)

- [ ] **Step 1: State**

```ts
threadBusyById: Record<string, boolean>  // default {}
// Actions: SET_THREAD_BUSY { threadId, busy }
// REMOVE_THREAD: delete key
// SET_ACTIVE_THREAD: do NOT wipe threadBusyById; still clear local streaming/isProcessing/messages
```

- [ ] **Step 2: Events**

On `chat.user` / `chat.token` / `tool.start` (with thread_id): `SET_THREAD_BUSY true`  
On `chat.done` / `chat.aborted` / `chat.error`: `SET_THREAD_BUSY false` for that thread_id  

For tool.start/result:

```ts
case "tool.start": {
  const tid = typeof msg.thread_id === "string" ? msg.thread_id : ""
  if (tid) dispatch({ type: "SET_THREAD_BUSY", threadId: tid, busy: true })
  // Only ADD_MESSAGE if shouldApplyStreamEvent(tid || undefined, active) — if tid empty, legacy apply
  if (tid && !shouldApplyStreamEvent(tid, activeThreadRef.current)) break
  // existing ADD_MESSAGE
}
```

**Policy change (SoT):** when `thread_id` is present and non-active → do not pollute messages; still update busy map. When missing → legacy apply (compat).

- [ ] **Step 3: fleet.status** parse `llm_active_thread_ids`

---

### Task 5: F-S1 MinimalConfirm

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/MinimalConfirm.tsx`
- Create: `chrome-extension/tests/stop-target.test.ts` (pure helper already in thread-busy)

- [ ] Use `resolveStopTargetId({ workerId: request.worker_id, activeThreadId, multiAgentContext: !!(request.worker_id || fleet workers) })`  
- [ ] If stopThread && !stopTargetId → still deny confirm but **skip** chat.abort (or only respond without abort)  
- [ ] Keep worker label visible independent of active thread

---

### Task 6: FleetWorkerList + portal + RunBusyChip + WorkerScopeBar (W1)

**Files:**
- Create: `FleetWorkerList.tsx`, `WorkerScopeBar.tsx`, `RunBusyChip.tsx`
- Modify: `FleetStrip.tsx`, `FocusBand.tsx`, `App.tsx` / chat layout, `ChatView.tsx`

- [ ] **Extract** list UI from FleetStrip expand panel into `FleetWorkerList`  
- [ ] **FleetStrip focusBand** main click → setOpenPopover / portal (not only cockpit)  
- [ ] **Portal:** render list at document body or sidepanel root with fixed position under strip  
- [ ] **RunBusyChip:** when `runBusy && !threadBusy` or always when runBusy — click opens same list  
- [ ] **WorkerScopeBar:** if `activeThread.agent_role === "worker"` show bar; back via `resolveParentThreadId`  
- [ ] **ChatView:** fake-end when `!threadBusy && runBusy` with button open list (event or callback)  
- [ ] 全停 confirm copy includes 释放 tab 锁  

---

### Task 7: Docs + verification

**Files:**
- Modify: `docs/multi-agent-user-guide.md` (short § on 查看进展 / 运行态)
- Run: `npm --prefix chrome-extension test`  
- Run: targeted companion tests if any fleet/tool tests exist  

- [ ] Mark plan checkboxes done in this file as tasks complete  
- [ ] Update SoT status if needed (implementation in progress)

---

## Spec coverage checklist

| SoT item | Task |
|----------|------|
| deriveThreadBusy / RunBusy pure | T1 |
| Composer gate + Stop full ThreadBusy | T2 |
| Fake-end / RunBusy chip | T6 |
| tool thread_id | T3 |
| llm_active | T3 |
| threadBusyById | T4 |
| Portal worker list + enter | T6 |
| WorkerScopeBar | T6 |
| F-S1 stop | T5 |
| F-S2 worker placeholder | T2 |
| Run filter by orchestrator_run_id | T1 filter + T2 |
| No W3 Board/ThreadList | out |

---

## Execution note

User requested **plan then start**. Execute **inline** in order T1→T7 on branch `feat/run-state-worker-drilldown`. Do not commit unrelated dirty files (outbound-mcp / autopilot).

---

*Plan 2026-08-04*
