# 当轮活计划 `run_progress_propose` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Plan dual:** Product **AWN** + Trust **AWN**（2026-08-31）。nits 已折：同请求二次 propose 拒写；`PROPOSE_REQUIRED` 在 `classifyError` **之前**短路；adapter 只调 `shouldBlockPageTool`。可执行。  
> **Spec:** [2026-08-31-runprogress-live-plan-design.md](../specs/2026-08-31-runprogress-live-plan-design.md) **r2b LOCKED**  
> **GitHub:** [#265](https://github.com/nehcuh/cmspark/issues/265)  
> **合成:** [runprogress-265-spec-adversary-synthesis-2026-08-31.md](../../audit/reviews/runprogress-265-spec-adversary-synthesis-2026-08-31.md)

**Goal:** 侧栏这一则用户消息里，第一次页面工具前必须成功 `run_progress_propose`，聊天列出现可勾「本轮步骤」，不必等 H1。

**Architecture:** Companion 具名工具写入 `thread.run_progress`（`source: seed`, id `live:{i}`）。adapter 每个 `chat.create` 闭包 `proposedThisRequest`；页面工具未 propose 则返回 `PROPOSE_REQUIRED` 且不执行。overlay 从 WS handshake 拒绝写入。ChatView 用 `listSig` 重挂 Wave 1 卡。

**Tech Stack:** Companion Node/TS + Side Panel React。测试：`companion` `tsc -p tsconfig.test.json` + `node --test`；`chrome-extension` `npm test`。

```text
Surface:      L0 ChatView RunProgress only
L2-classes:   none
Compose:      run_progress_propose + per-request PROPOSE_REQUIRED
Autonomy:     n/a
Trust:        exact item.tool or click; overlay handshake deny; no self-tick
Channel:      community
Blast:        T3
```

## Global Constraints

- 文案「本轮步骤」。禁「进行中」当清单标题。
- 不进 StatusRail / FocusBand / overlay 画勾。`SUMMONER_ALLOW` 不加 toggle。
- 不进 `l2-admission`。不进 outbound `cmspark__*`。
- `#230` 不修。不宣称 Wave 2。
- `RunProgress.tsx` 零行为 diff。
- 失败信封唯一：`{ success: false, error: string, data: { error_code } }`。
- `PROPOSE_REQUIRED` 不计入 `CONTINUOUS_FAILURE_LIMIT` 与 `recoverableFailureCounts`。

**How tests run:**

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/run-progress.test.js
cd chrome-extension && npm test -- --test-name-pattern "listSig|RunProgress key"
```

**BRANCH:** `feat/265-runprogress-live-plan` off `origin/main`. PR `Closes #265`.

---

## File map

| File | Role |
|------|------|
| Modify `companion/src/threads/run-progress.ts` | `mapProposeItems` `proposeRunProgress` `RUN_PROGRESS_PAGE_TOOLS` |
| Modify `companion/src/bridge/companion-tools.ts` | add name |
| Modify `companion/src/bridge/tool-definitions-catalog.json` | schema |
| Modify `companion/src/bridge/tool-schemas.ts` | zod |
| Modify `companion/src/tool/companion-dispatch.ts` | case + handshake |
| Modify `companion/src/tool/companion-dispatch.ts` `CompanionToolExecOptions` | `handshakeSurface` |
| Modify `companion/src/server.ts` | pass handshakeSurface; delete `surface` on propose params |
| Modify `companion/src/llm/adapter.ts` | gate, skip tick, skip fail-count, prompt branch, strip surface |
| Modify `companion/src/orchestrator/constants.ts` | `WORKER_HARD_DENY` |
| Modify `companion/tests/run-progress.test.ts` | spec tests 1–17 |
| Modify `chrome-extension/src/sidepanel/components/run-progress-view.ts` | `listSig` |
| Modify `chrome-extension/src/sidepanel/components/ChatView.tsx` | key |
| Modify `chrome-extension/tests/run-progress-ui.test.ts` | listSig lock |
| Modify `docs/DESIGN.md` | Side Panel 行 |
| Forbidden | `RunProgress.tsx` 行为、`FocusBand*`,`StatusRail.tsx`,`SUMMONER_ALLOW` 加 toggle |

---

### Task 1: 纯函数 ingest + 页面工具集合

**Files:**
- Modify: `companion/src/threads/run-progress.ts`
- Modify: `companion/tests/run-progress.test.ts`
- Modify: file header comment (seed = companion 可勾写入)

- [ ] **Step 1: Write the failing tests** (append to `run-progress.test.ts`; keep existing seed/tick tests)

```ts
import {
  mapProposeItems,
  proposeRunProgress,
  RUN_PROGRESS_PAGE_TOOLS,
  RUN_PROGRESS_PROPOSE_TOOL,
} from "../src/threads/run-progress"
import { TAB_LEASE_TOOLS } from "../src/orchestrator/constants"
import { getAllToolDefinitions } from "../src/bridge/tool-definitions"

test("mapProposeItems forces seed live:i done false and drops writer tool", () => {
  const items = mapProposeItems([
    { text: "打开列表", done: true, source: "user", id: "x", tool: "run_progress_propose" },
    { text: "  点第一封  ", tool: "click" },
  ])
  assert.equal(items.length, 2)
  assert.equal(items[0]!.id, "live:0")
  assert.equal(items[0]!.source, "seed")
  assert.equal(items[0]!.done, false)
  assert.equal(items[0]!.tool, undefined)
  assert.equal(items[1]!.tool, "click")
})

test("sanitize(rawModel) is not the propose success path", () => {
  const sneaky = sanitizeRunProgress({
    items: [{ id: "x", text: "hack", done: true, source: "seed" }],
  })
  assert.equal(sneaky.items[0]!.done, true)
  const mapped = mapProposeItems([{ text: "hack", done: true, source: "seed", id: "x" }])
  assert.equal(mapped[0]!.done, false)
  assert.equal(mapped[0]!.id, "live:0")
})

test("proposeRunProgress writes when undefined or empty items", () => {
  const a = proposeRunProgress({ run_progress: undefined }, [{ text: "一步" }], { replaceOk: true })
  assert.equal(a.ok, true)
  if (a.ok) assert.equal(a.progress.items[0]!.id, "live:0")
  const b = proposeRunProgress({ run_progress: { items: [] } }, [{ text: "一步" }], { replaceOk: true })
  assert.equal(b.ok, true)
})

test("proposeRunProgress CLEARED on sticky null using ===", () => {
  const r = proposeRunProgress({ run_progress: null }, [{ text: "x" }], { replaceOk: true })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error_code, "CLEARED")
})

test("proposeRunProgress EMPTY_ITEMS when all texts empty", () => {
  const r = proposeRunProgress({ run_progress: undefined }, [{ text: "  " }], { replaceOk: true })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error_code, "EMPTY_ITEMS")
})

test("proposeRunProgress replaceOk replaces leftover undone H1 seed", () => {
  const leftover = {
    run_progress: {
      items: [{ id: "seed:0", text: "旧", done: false, source: "seed" as const }],
    },
  }
  const denied = proposeRunProgress(leftover, [{ text: "新" }], { replaceOk: false })
  assert.equal(denied.ok, false)
  if (!denied.ok) assert.equal(denied.error_code, "ALREADY_HAS_STEPS")
  const ok = proposeRunProgress(leftover, [{ text: "新" }], { replaceOk: true })
  assert.equal(ok.ok, true)
  if (ok.ok) assert.equal(ok.progress.items[0]!.text, "新")
})

test("RUN_PROGRESS_PAGE_TOOLS covers TAB_LEASE plus extras, no read_page/drag", () => {
  for (const n of TAB_LEASE_TOOLS) assert.ok(RUN_PROGRESS_PAGE_TOOLS.has(n), n)
  for (const n of ["create_tab", "osascript_eval", "host_computer", "get_page_html", "dblclick", "fill_form", "drag_and_drop"]) {
    assert.ok(RUN_PROGRESS_PAGE_TOOLS.has(n), n)
  }
  assert.equal(RUN_PROGRESS_PAGE_TOOLS.has("list_tabs"), false)
  assert.equal(RUN_PROGRESS_PAGE_TOOLS.has("read_page"), false)
  assert.equal(RUN_PROGRESS_PAGE_TOOLS.has("drag"), false)
  const catalog = new Set(getAllToolDefinitions().map((t) => t.function.name))
  for (const n of RUN_PROGRESS_PAGE_TOOLS) {
    assert.ok(catalog.has(n) || TAB_LEASE_TOOLS.has(n), "unknown page tool " + n)
  }
})

test("applyToolResult still ticks live:0 seed with exact click", () => {
  const p = { items: [{ id: "live:0", text: "点", done: false, source: "seed" as const, tool: "click" }] }
  const next = applyToolResult(p, { tool: "click", success: true })
  assert.equal(next.items[0]!.done, true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/run-progress.test.js --test-name-pattern "mapProposeItems|proposeRunProgress|RUN_PROGRESS_PAGE_TOOLS"
```

Expected: FAIL — missing exports.

- [ ] **Step 3: Write minimal implementation** in `run-progress.ts`

At top, after existing imports, add:

```ts
import { TAB_LEASE_TOOLS } from "../orchestrator/constants"

export const RUN_PROGRESS_PROPOSE_TOOL = "run_progress_propose" as const

export const RUN_PROGRESS_PAGE_TOOLS = new Set<string>([
  ...TAB_LEASE_TOOLS,
  "create_tab",
  "osascript_eval",
  "host_computer",
])

export function mapProposeItems(raw: unknown): RunProgressItem[] {
  if (!Array.isArray(raw)) return []
  const rows: RunProgressItem[] = []
  for (let i = 0; i < raw.length && rows.length < RUN_PROGRESS_CAPS.max; i++) {
    const row = raw[i]
    if (!row || typeof row !== "object" || Array.isArray(row)) continue
    const o = row as Record<string, unknown>
    const text = scrubText(o.text, RUN_PROGRESS_CAPS.len)
    if (!text) continue
    let tool = scrubTool(o.tool)
    if (tool === RUN_PROGRESS_PROPOSE_TOOL) tool = undefined
    const item: RunProgressItem = { id: `live:${rows.length}`, text, done: false, source: "seed" }
    if (tool) item.tool = tool
    rows.push(item)
  }
  return rows
}

export function proposeRunProgress(
  thread: { run_progress?: RunProgress | null },
  items: unknown,
  opts: { replaceOk: boolean },
): { ok: true; progress: RunProgress } | { ok: false; error_code: string } {
  if (thread.run_progress === null) return { ok: false, error_code: "CLEARED" }
  const mapped = mapProposeItems(items)
  if (mapped.length === 0) return { ok: false, error_code: "EMPTY_ITEMS" }
  const cur = thread.run_progress
  const hasUndone =
    cur != null &&
    cur.items.some((it) => it.source !== "model_draft" && it.done !== true)
  if (hasUndone && opts.replaceOk !== true) return { ok: false, error_code: "ALREADY_HAS_STEPS" }
  return { ok: true, progress: { items: mapped } }
}
```

Also export:

```ts
export function shouldBlockPageTool(p: {
  toolName: string
  proposedThisRequest: boolean
  agentRole?: string
  runProgress: RunProgress | null | undefined
}): boolean {
  if (p.proposedThisRequest) return false
  if (p.agentRole === "worker") return false
  if (p.runProgress === null) return false
  return RUN_PROGRESS_PAGE_TOOLS.has(p.toolName)
}
```

Tests: `click` + not yet proposed + normal + `undefined` → true; `list_tabs` → false; worker `click` → false; sticky `null` `click` → false; after proposed → false.

Keep `scrubText` / `scrubTool` file-local.

Rewrite file header: seed = companion-written tickable (H1 or propose).

- [ ] **Step 4: Re-run tests — expect PASS** for this file's new names.

- [ ] **Step 5: Commit**

```bash
git add companion/src/threads/run-progress.ts companion/tests/run-progress.test.ts
git commit -m "feat(run-progress): mapProposeItems + proposeRunProgress (#265)"
```

---

### Task 2: catalog + COMPANION_TOOLS + zod + HARD_DENY

**Files:**
- Modify: `companion/src/bridge/tool-definitions-catalog.json` (insert after `thread_recall` object)
- Modify: `companion/src/bridge/companion-tools.ts` — add `"run_progress_propose"` after `"thread_recall"`
- Modify: `companion/src/bridge/tool-schemas.ts` — add schema
- Modify: `companion/src/orchestrator/constants.ts` — `WORKER_HARD_DENY.add` equivalent: put `"run_progress_propose"` in the Set literal
- Modify: `companion/tests/run-progress.test.ts` — lockstep tests
- Modify: `companion/tests/tool-catalog-lockstep.test.ts` only if it fails after COMPANION_TOOLS add (it should pass once catalog has the name)

Catalog object (Chinese, no 进行中):

```json
{
  "type": "function",
  "function": {
    "name": "run_progress_propose",
    "description": "在操作页面前提出本轮具体步骤（1–8 条）。每则用户消息最多成功一次。每条可附精确内部工具名（click、get_page_text、navigate），不要从中文猜。若返回 ALREADY_HAS_STEPS，不要在本则消息里重试。",
    "parameters": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "minItems": 1,
          "maxItems": 8,
          "items": {
            "type": "object",
            "properties": {
              "text": { "type": "string", "description": "具体步骤，≤120 字" },
              "tool": { "type": "string", "description": "可选精确内部工具名" }
            },
            "required": ["text"]
          }
        }
      },
      "required": ["items"]
    }
  }
}
```

zod (`.strict()` so `surface`/`done` cannot ride):

```ts
run_progress_propose: z.object({
  items: z.array(z.object({
    text: z.string(),
    tool: z.string().optional(),
  })).min(1).max(8),
}).strict(),
```

Tests to add:

```ts
test("run_progress_propose is catalog companion not L2 not outbound", () => {
  const { COMPANION_TOOLS } = require("../src/bridge/companion-tools")
  assert.ok(COMPANION_TOOLS.includes("run_progress_propose"))
  const { L2_GATE_TOOLS } = require("../src/tool/l2-admission")
  assert.equal(L2_GATE_TOOLS.includes("run_progress_propose"), false)
  const src = readSrc("tool", "l2-admission.ts")
  assert.doesNotMatch(src, /run_progress_propose/)
  const { isOutboundAllowed } = require("../src/outbound-mcp/profile")
  assert.equal(isOutboundAllowed("cmspark__run_progress_propose"), false)
  const { WORKER_HARD_DENY } = require("../src/orchestrator/constants")
  assert.ok(WORKER_HARD_DENY.has("run_progress_propose"))
})
```

Check `L2_GATE_TOOLS` actual export name in `l2-admission.ts` before writing the assert — if it is a Set called `L2_GATE_TOOLS`, use `.has`. Source grep is the lock.

- [ ] **Step 1:** tests first (catalog name missing → FAIL)
- [ ] **Step 2:** run
- [ ] **Step 3:** add JSON + array + zod + HARD_DENY
- [ ] **Step 4:** `cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/tool-catalog-lockstep.test.js .test-dist/tests/run-progress.test.js --test-name-pattern "run_progress_propose is catalog"`
- [ ] **Step 5:** commit `feat(tools): catalog run_progress_propose (#265)`

---

### Task 3: dispatch + handshake

**Files:**
- Modify: `companion/src/tool/companion-dispatch.ts` — `CompanionToolExecOptions` + case
- Modify: `companion/src/server.ts` — pass `handshakeSurface`; `delete finalParams.surface` before companion execute when name is propose (or always delete `surface` on companion params for this tool)

`CompanionToolExecOptions` add:

```ts
handshakeSurface?: "summoner" | "tray"
```

In `server.ts` `createToolExecutor`, inside `isCompanionTool` call, add:

```ts
handshakeSurface: (() => {
  const st = getWsAuthState(ws)
  if (!st) return undefined
  return st.surface === "summoner" ? "summoner" : "tray"
})(),
```

Dispatch case (before `default:`):

```ts
case "run_progress_propose": {
  if (execOpts?.handshakeSurface === "summoner" || execOpts?.handshakeSurface == null) {
    return { success: false, error: "SUMMONER_ACL: run_progress_propose denied", data: { error_code: "SUMMONER_ACL" } }
  }
  const tid = typeof params.__thread_id === "string" ? params.__thread_id : ""
  if (!tid) {
    return { success: false, error: "thread required", data: { error_code: "THREAD_REQUIRED" } }
  }
  const th = threadManager.get(tid)
  if (!th) {
    return { success: false, error: "thread required", data: { error_code: "THREAD_REQUIRED" } }
  }
  if (th.agent_role === "worker") {
    return { success: false, error: "workers cannot propose run_progress", data: { error_code: "WORKER_DENIED" } }
  }
  const decided = proposeRunProgress(th, params.items, { replaceOk: true })
  if (!decided.ok) {
    return { success: false, error: decided.error_code, data: { error_code: decided.error_code } }
  }
  const updated = threadManager.update(tid, { run_progress: decided.progress })
  if (updated) execOpts?.broadcast?.({ type: "thread.updated", thread: updated })
  return { success: true, data: { written: decided.progress.items.length } }
}
```

Import `proposeRunProgress` from `../threads/run-progress`.

Tests in `run-progress.test.ts` calling `executeCompanionTool` need `bindCompanionDispatchRuntime`. Prefer testing the case via a thin exported helper **or** through `handleMessage`/`executeCompanionTool` with mocked runtime. If dispatch tests are heavy, add `companion/tests/run-progress-propose-dispatch.test.ts` that:

1. bind a fake ThreadManager
2. `executeCompanionTool("run_progress_propose", { items: [...], __thread_id, surface: "tray" }, "id", { handshakeSurface: "summoner" })` → no write
3. handshakeSurface undefined → no write
4. handshakeSurface `"tray"` → write + broadcast called once
5. worker thread → WORKER_DENIED

Follow existing `bindCompanionDispatchRuntime` test pattern in `companion/tests` (grep it). If none, instantiate ThreadManager on tmp DATA_DIR like `run-progress.test.ts` already does and call `executeCompanionTool` after `bindCompanionDispatchRuntime`.

- [ ] Commit `feat(dispatch): run_progress_propose handshake gate (#265)`

---

### Task 4: adapter 准入 + skip tick + skip fail-count + prompt

**Files:** Modify `companion/src/llm/adapter.ts`

Inside `chatCreate`, after tools are filtered, `let proposedThisRequest = false`.

**Prompt:** after `basePrompt` is built, if `params.surface !== "summoner"`:

```ts
const runProgressHint =
  params.surface === "summoner"
    ? ""
    : "If this thread has no unfinished 本轮步骤 and you will operate the page (click / navigate / get_page_text / type / wait_for / …), call run_progress_propose first with 1–8 concrete steps. Optional exact internal tool names; never guess from Chinese. If the tool returns ALREADY_HAS_STEPS, do not retry this turn. Do not label steps 进行中."
```

Insert `runProgressHint` in the `systemPrompt` array **after** `basePrompt`, not inside the `basePrompt` const. Test: `readSrc("llm","adapter.ts")` — the `const basePrompt =` template string must **not** contain `run_progress_propose`; a later const/hint must.

**Strip surface** in execParams:

```ts
const normalized = { ...normalizeWaitForParams(toolName, params as Record<string, unknown>) }
delete (normalized as { surface?: unknown }).surface
const execParams = {
  ...normalized,
  tabId: resolvedTabId,
  __thread_id: threadId,
}
```

**Gate** immediately before `executeTool` (both isDomScriptTool branches and the else). Helper in adapter file:

```ts
function proposeRequiredResult(): { success: false; error: string; data: { error_code: "PROPOSE_REQUIRED" } } {
  return {
    success: false,
    error: "请先调用 run_progress_propose 提出本轮步骤（1–8 条），然后再执行该页面工具。",
    data: { error_code: "PROPOSE_REQUIRED" },
  }
}
```

```ts
const thNow = threadManager.get(threadId)
const skipProposeGate =
  thNow?.agent_role === "worker" || thNow?.run_progress === null
if (toolName === RUN_PROGRESS_PROPOSE_TOOL && proposedThisRequest) {
  toolResult = {
    success: false,
    error: "ALREADY_HAS_STEPS",
    data: { error_code: "ALREADY_HAS_STEPS" },
  }
} else if (
  shouldBlockPageTool({
    toolName,
    proposedThisRequest,
    agentRole: thNow?.agent_role,
    runProgress: thNow?.run_progress,
  })
) {
  toolResult = proposeRequiredResult()
} else {
  toolResult = await executeTool(...)
}
if (toolName === RUN_PROGRESS_PROPOSE_TOOL && toolResult.success) {
  proposedThisRequest = true
}
```

**Skip tick:**

```ts
if (toolResult.success && toolName !== RUN_PROGRESS_PROPOSE_TOOL) {
  // existing nextRunProgressAfterToolSuccess block
}
```

**Skip classifyError + fail-count** — `classifyError` **defaults to `non_recoverable`** and would `shouldStop` the turn before the model can propose. At the start of the `toolResult.success === false` block:

```ts
const proposeDenied =
  toolResult.data?.error_code === "PROPOSE_REQUIRED" ||
  toolResult.data?.error_code === "ALREADY_HAS_STEPS"
if (!proposeDenied) {
  // existing classifyError / recoverableFailureCounts / MAX_SAME_TOOL_RECOVERABLE_FAILURES
}
// always push tool result for the model when proposeDenied
```

Do **not** only wrap `recoverableFailureCounts`. The short-circuit must sit **above** `classifyError`.

**Tests:** source locks in `run-progress.test.ts`:

```ts
test("adapter prompt and gate source locks", () => {
  const ad = readSrc("llm", "adapter.ts")
  const baseStart = ad.indexOf("const basePrompt =")
  const baseEnd = ad.indexOf("const builtPrompt", baseStart)
  const base = ad.slice(baseStart, baseEnd)
  assert.doesNotMatch(base, /run_progress_propose/)
  assert.match(ad, /run_progress_propose/)
  assert.match(ad, /PROPOSE_REQUIRED/)
  assert.match(ad, /recoverableFailureCounts/)
  assert.match(ad, /error_code === "PROPOSE_REQUIRED"/)
  assert.doesNotMatch(ad, /进行中/)
})
```

The last `doesNotMatch 进行中` will FAIL because adapter already has other 进行中? Spec says new sentence must not contain 进行中. Check adapter for 进行中 — earlier grep of adapter.ts had 进行中 in computer playbook maybe. **Do not file-wide ban.** Lock only the hint string:

```ts
assert.match(ad, /Do not label steps/)
assert.doesNotMatch(ad, /Do not label steps 进行中/) // wait, the hint contains the Chinese ban words.

```

Hint uses 「进行中」 as a prohibition. Spec test 11: 新句无「进行中」— meaning don't title the list 进行中. The hint saying "Do not label steps 进行中" **contains** the substring. Fold: hint uses "Do not label steps as in-progress / 进行中" is the product copy. Keep the Chinese ban in the hint. Source lock: `assert.match(ad, /Do not label steps/)` and do **not** assert the whole file has zero 进行中.

Adapter-level behavioral tests for the gate: if existing adapter tests mock `executeTool`, add one in `companion/tests/adapter-run-progress.test.ts` **only if** a cheap mock harness exists. Otherwise source lock + dispatch tests. Prefer a small unit of the gate extracted:

```ts
export function shouldBlockPageTool(args: {
  proposedThisRequest: boolean
  pageTool: boolean
  worker: boolean
  stickyNull: boolean
}): boolean {
  if (args.proposedThisRequest || args.worker || args.stickyNull || !args.pageTool) return false
  return true
}
```

Put `shouldBlockPageTool` in `run-progress.ts` next to PAGE_TOOLS so Task 1 tests can cover it without booting the adapter. Task 4 adapter **calls** it. This avoids a 400-line adapter mock.

Add to Task 1 instead if not already there:

```ts
export function shouldBlockPageTool(p: {
  toolName: string
  proposedThisRequest: boolean
  agentRole?: string
  runProgress: RunProgress | null | undefined
}): boolean {
  if (p.proposedThisRequest) return false
  if (p.agentRole === "worker") return false
  if (p.runProgress === null) return false
  return RUN_PROGRESS_PAGE_TOOLS.has(p.toolName)
}
```

Tests: click+false+normal+undefined → true; list_tabs → false; worker click → false; sticky null click → false; after proposed → false.

- [ ] Commit `feat(adapter): PROPOSE_REQUIRED page-tool gate (#265)`

---

### Task 5: ChatView listSig

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/run-progress-view.ts`
- Modify: `chrome-extension/src/sidepanel/components/ChatView.tsx`
- Modify: `chrome-extension/tests/run-progress-ui.test.ts`

```ts
export function listSig(items: { id: string; text: string }[] | undefined | null): string {
  if (!items || items.length === 0) return "empty"
  return items.map((i) => `${i.id}\t${i.text}`).join("\n")
}
```

ChatView:

```tsx
<RunProgress
  key={`${activeThreadId}:${listSig(runItems)}`}
  threadId={activeThreadId}
  items={runItems}
/>
```

Tests (replace any `key={activeThreadId}` lock if present; append if not):

```ts
test("listSig changes when texts change even if ids stay live:0", () => {
  const a = listSig([{ id: "live:0", text: "开列表" }, { id: "live:1", text: "点" }])
  const b = listSig([{ id: "live:0", text: "开列表" }, { id: "live:1", text: "点" }, { id: "live:2", text: "标已读" }])
  const c = listSig([{ id: "live:0", text: "别的" }, { id: "live:1", text: "点" }])
  assert.notEqual(a, b)
  assert.notEqual(a, c)
  assert.equal(listSig([{ id: "live:0", text: "开列表", done: true } as any]), listSig([{ id: "live:0", text: "开列表", done: false } as any]))
})

test("ChatView keys RunProgress with listSig not first id only", () => {
  const cv = src("src/sidepanel/components/ChatView.tsx")
  assert.match(cv, /listSig\(runItems\)/)
  assert.doesNotMatch(cv, /<RunProgress key=\{activeThreadId\}/)
  assert.doesNotMatch(cv, /items\[0\]\?\.id/)
})
```

- [ ] `cd chrome-extension && npm test` — existing Wave 1 tests still pass; `RunProgress.tsx` untouched.
- [ ] Commit `fix(ui): remount RunProgress on listSig (#265)`

---

### Task 6: DESIGN.md + overlay glob + docs

**Files:**
- Modify: `docs/DESIGN.md` Side Panel cell: delete `~320px density budget unchanged`. Change `L0 RunProgress (H1 seed)` to `L0 RunProgress (H1 seed or run_progress_propose this user turn)`. Keep ≤3/≥4, sticky, maxHeight, n/m, exact tool, never StatusRail/FocusBand/overlay, later H1 does not overwrite existing `run_progress`.
- Overlay glob already in `run-progress-ui.test.ts` — run it; do not add 本轮步骤 to overlay HTML.
- `docs/superpowers/plans/2026-08-26-slice-6-match-idf-runprogress.md` header: one line that v1 seed-only-from-H1 is amended by #265 (optional; spec requires `run-progress.ts` header which Task 1 did).

- [ ] Commit `docs: RunProgress live propose copy (#265)`

---

### Task 7: 全量回归

```bash
cd companion && npm test -- --test-name-pattern "run_progress|RUN_PROGRESS|propose|listSig"
cd chrome-extension && npm test -- --test-name-pattern "run-progress|listSig|本轮步骤"
```

Then broader if time: `cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/tool-catalog-lockstep.test.js .test-dist/tests/p2-deep-diagnosis-batch.test.js`

- [ ] Commit empty if already committed; otherwise fix failures.

---

## Spec coverage

| Spec | Task |
|------|------|
| mapProposeItems / CLEARED / EMPTY / replaceOk | 1 |
| catalog / COMPANION / HARD_DENY / outbound / no L2 | 2 |
| dispatch handshake / broadcast / worker | 3 |
| PROPOSE_REQUIRED / skip tick / skip fail-count / prompt | 4 |
| listSig ChatView | 5 |
| DESIGN.md | 6 |
| overlay HTML glob | 5–6 existing test |

## Self-review

- No TBD. Error envelope one shape. `listSig` not first-id. Handshake from WS not model bag.
- `shouldBlockPageTool` defined in Task 1, used in Task 4 — same name.
- Do not increment `recoverableFailureCounts` on `PROPOSE_REQUIRED`.
