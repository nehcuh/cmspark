# Slice #237 — RunProgress H1 `tool` bind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GitHub:** [#237](https://github.com/nehcuh/cmspark/issues/237) · parent [#230](https://github.com/nehcuh/cmspark/issues/230)  
> **SoT:** slice 6 r2 pin 3 · `companion/src/threads/run-progress.ts`  
> **Blast:** **T2** · **未 dual 不得实现**

**Goal:** H1 待办可以带**精确内部工具名** `tool`；该工具 `tool.result` 成功后勾「本轮步骤」。纯字符串待办仍只能点。不按正文猜。

**Architecture:** Keep `applyToolResult` exact `item.tool === toolName`. Change **seed ingest** so `open_todos` entries may be `{text, tool?}` (strings still valid). `sanitizeThreadHandoff` persists objects. **Notice = `.text` only**（不把 tool 名写进「查看摘要」）。**Hash JSON 含 `tool`**（绑定变了要换 sha）。Unknown/missing `tool` → no auto-tick. Never `text.includes`. Never tick `model_draft`. Overlay ACL unchanged. **已有 `run_progress` 的线程不覆盖**（no-clobber）。

**Tech Stack:** companion `node:test` + chrome-extension 摘要列表把 todo 收成 text（否则 React 对对象子节点会炸）。

```text
Surface:      L0 chat column RunProgress
L2-classes:   none
Compose:      existing H1 handoff + run_progress
Trust:        ticks = tool_result success or Side Panel click; no overlay toggle
Channel:      community
```

---

## NEVER

- `text.includes(toolName)` / 从中文待办猜工具
- 模型 JSON 自勾 / tick `model_draft`
- Mission Board；overlay `thread.run_progress.toggle`
- 扩 outbound profile；F-S-10；overlay-acl-rollback
- 新 `thread.todo` SoT

---

## File map

| File | Role |
|------|------|
| `companion/tests/run-progress.test.ts` | seed 对象带 `tool`；字符串无 `tool`；apply 仍 exact |
| `companion/tests/context-handoff.test.ts` | sanitize 接受 string 与 `{text,tool}`；notice 用 text |
| `companion/src/llm/context-handoff.ts` | `HandoffTodo`；`capTodos`；prompt 一行 |
| `companion/src/threads/run-progress.ts` | `seedRunProgress` 抄 `tool`；`scrubTool` 与 `scrubToolName` 同一正则 |
| `chrome-extension/src/sidepanel/components/ChatView.tsx` | 「查看摘要」待办 `{t}` → 只渲染 text |
| `chrome-extension/src/sidepanel/types.ts` + `store/agentStore.tsx` | `open_todos` 宽成 `string \| {text:string, tool?:string}` |
| `docs/DESIGN.md` | 无 `tool` 只能点；已有清单不因新 H1 自动改 tool |

`adapter.ts` **不改**（已对 exact `item.tool` 勾）。

---

### Task 1: 红测 seed 对象 `tool`

**Files:** Modify `companion/tests/run-progress.test.ts`, `companion/tests/context-handoff.test.ts`

- [ ] **Step 1: Failing tests**

`run-progress.test.ts` 在 seed 字符串测之后追加：

```ts
test("#237 seed copies tool from H1 object todos; strings have no tool", () => {
  const progress = seedRunProgress({
    runtime_context_budget: {
      handoff: {
        open_todos: [
          { text: "打开已登录页", tool: "navigate" },
          "摘前五条标题",
          { text: "读正文", tool: "get_page_text" },
          { text: "忽略坏名", tool: "Navigate" },
        ],
      },
    },
  })
  assert.equal(progress.items.length, 4)
  assert.equal(progress.items[0]!.tool, "navigate")
  assert.equal(progress.items[0]!.source, "seed")
  assert.equal(progress.items[1]!.tool, undefined)
  assert.equal(progress.items[2]!.tool, "get_page_text")
  assert.equal(progress.items[3]!.tool, undefined, "case-sensitive; Navigate dropped")
  const ticked = applyToolResult(progress, { tool: "navigate", success: true })
  assert.equal(ticked.items[0]!.done, true)
  assert.equal(ticked.items[1]!.done, false)
  assert.equal(ticked.items[2]!.done, false)
})
```

`context-handoff.test.ts` 追加：

```ts
test("#237 sanitize open_todos accepts {text,tool} and keeps string todos", () => {
  const h = sanitizeThreadHandoff({
    open_todos: [
      "plain",
      { text: "go", tool: "navigate" },
      { text: "bad", tool: "not a tool!!" },
      { tool: "click" },
    ],
  })
  assert.ok(h)
  assert.equal(h!.open_todos.length, 3)
  assert.deepEqual(h!.open_todos[0], { text: "plain" })
  assert.deepEqual(h!.open_todos[1], { text: "go", tool: "navigate" })
  assert.deepEqual(h!.open_todos[2], { text: "bad" })
  const notice = formatHandoffForNotice(h!, 2000)
  assert.match(notice, /- plain/)
  assert.match(notice, /- go/)
  assert.doesNotMatch(notice, /navigate/)
})
```

「Navigate」与 `not a tool!!`：`scrubTool` 只保留 `^[a-z][a-z0-9_]{0,79}$`（全小写）。`Navigate` 含大写 → drop tool，保留 text。无 `text` 的对象 drop 整行。

- [ ] **Step 2: Run red**

```bash
cd companion && npx tsc -p tsconfig.test.json \
  && node --test .test-dist/tests/run-progress.test.js .test-dist/tests/context-handoff.test.js
```

Expected: `#237` tests FAIL（seed 把对象 `String(t)` 成 `[object Object]` 或忽略 tool）。

- [ ] **Step 3: Commit red**

```bash
git commit -am "test(run-progress): H1 object todos copy exact tool (#237)"
```

---

### Task 2: `HandoffTodo` + seed 抄 tool

**Files:** `companion/src/llm/context-handoff.ts`, `companion/src/threads/run-progress.ts`

- [ ] **Step 1: Types + capTodos**

在 `context-handoff.ts`：

```ts
export type HandoffTodo = { text: string; tool?: string }

export interface ThreadHandoff {
  updated_at: string
  goals: string[]
  decisions: string[]
  constraints: string[]
  open_todos: HandoffTodo[]
  artifacts: string[]
}

function scrubToolName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const t = raw.trim()
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(t)) return undefined
  return t
}

function capTodos(raw: unknown, max: number, len: number): HandoffTodo[] {
  if (!Array.isArray(raw)) return []
  const out: HandoffTodo[] = []
  for (const item of raw) {
    let text: string | null = null
    let tool: string | undefined
    if (typeof item === "string" || typeof item === "number") {
      text = scrubLine(String(item))
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as Record<string, unknown>
      if (typeof o.text !== "string") continue
      text = scrubLine(o.text)
      tool = scrubToolName(o.tool)
    }
    if (!text) continue
    const row: HandoffTodo = { text: text.slice(0, len) }
    if (tool) row.tool = tool
    out.push(row)
    if (out.length >= max) break
  }
  return out
}
```

`sanitizeThreadHandoff` 用 `capTodos` 替 `capList` 处理 `open_todos`。

`formatHandoffForNotice`：`open_todos` 用 `.map((x) => \`- ${x.text}\`)`，其它 field 仍是 `string[]`。抽出：

```ts
function linesFor(field: HandoffField, handoff: ThreadHandoff): string[] {
  if (field === "open_todos") return handoff.open_todos.map((t) => t.text)
  return handoff[field] as string[]
}
```

`serializeHandoffForHash` 保持 JSON 含 `tool`（有则写）。

`H1_HANDOFF_SYSTEM` 把 open_todos 示例改成可对象，并加一句：

```
open_todos items may be strings or {"text":"...","tool":"navigate"}. tool is optional exact internal name (lowercase [a-z][a-z0-9_]*). Omit if unknown. Never guess from Chinese. Never put secrets in text.
```

- [ ] **Step 2: seedRunProgress**

```ts
export function seedRunProgress(thread: {
  runtime_context_budget?: {
    handoff?: { open_todos?: unknown } | null
  } | null
} | null | undefined): RunProgress {
  const todos = thread?.runtime_context_budget?.handoff?.open_todos
  if (!Array.isArray(todos)) return { items: [] }
  return sanitizeRunProgress({
    items: todos.map((t, i) => {
      if (t && typeof t === "object" && !Array.isArray(t)) {
        const o = t as Record<string, unknown>
        return {
          id: `seed:${i}`,
          text: o.text ?? "",
          done: false,
          source: "seed" as const,
          tool: o.tool,
        }
      }
      return {
        id: `seed:${i}`,
        text: t,
        done: false,
        source: "seed" as const,
      }
    }),
  })
}
```

`sanitizeRunProgress` / `scrubTool` 已丢非法 `tool`。把 `scrubTool` 与 `scrubToolName` 对齐为同一正则（全小写）。

- [ ] **Step 3: Green**

```bash
cd companion && npx tsc -p tsconfig.test.json \
  && node --test .test-dist/tests/run-progress.test.js .test-dist/tests/context-handoff.test.js
```

Expected: PASS。修因 `HandoffTodo` 导致的 TS 红（`formatHandoffForNotice`、测试里 `open_todos: ["T1"]` 仍合法）。

- [ ] **Step 4: Persist + UI coerce**

`run-progress.test.ts` 追加（沿用已有 thread-manager 测）：

```ts
test("#237 persist object todos hydrate run_progress.tool", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rp-237-"))
  const tm = new ThreadManager(dir)
  const th = tm.createThread("t")
  tm.update(th.id, {
    runtime_context_budget: {
      handoff: {
        updated_at: new Date().toISOString(),
        goals: [],
        decisions: [],
        constraints: [],
        artifacts: [],
        open_todos: [{ text: "打开页", tool: "navigate" }],
      },
    },
  })
  const got = tm.get(th.id)
  assert.equal(got!.run_progress!.items[0]!.tool, "navigate")
  assert.equal(got!.run_progress!.items[0]!.text, "打开页")
})
```

（按文件里现有 `ThreadManager` import / tmp 写法对齐，不要另起一套。）

ChatView 摘要：

```tsx
{items.map((t, i) => (
  <li key={i}>{typeof t === "string" ? t : t?.text ?? ""}</li>
))}
```

types / agentStore：`open_todos?: Array<string | { text: string; tool?: string }>`

DESIGN：本轮步骤 = H1 seed；**仅当该行有精确 `tool` 时** `tool_result` 可勾；否则只能点。已有 `run_progress` 不因后来 H1 改 tool。

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(run-progress): seed exact tool from H1 todo objects (#237)"
```

---

## DoD

1. `{text, tool:"navigate"}` + 成功 `navigate` → 该行 `done`。
2. 纯字符串 seed + 成功任意工具 → 不自动勾。
3. `tool:"Navigate"` / 非法名 → 当无 tool。
4. `model_draft` 仍永不自动勾。
5. overlay 不能 toggle。
6. DESIGN 不再暗示所有步骤都会跟 tool_result 走。

## 闸门

T2：机核 → 独立对抗 → Pi。实现者不得自 APPROVE。
