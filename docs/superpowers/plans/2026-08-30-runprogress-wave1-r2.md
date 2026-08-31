# Wave 1 r2 — RunProgress 改写 `9d45b7c2` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Plan dual:** 四路折针 → kimi r1 **REJECT**（文内两套 sticky）→ 折 r2b → **kimi AWN + Claude AWN**（`runprogress-256-plan-r2b-verdict-20260830-191538.json`）。nits 已折。可执行。  
> **合成:** [runprogress-256-plan-adversary-synthesis-2026-08-30.md](../../audit/reviews/runprogress-256-plan-adversary-synthesis-2026-08-30.md)  
> **GitHub:** [#256](https://github.com/nehcuh/cmspark/issues/256)  
> **Spec:** [2026-08-30-runprogress-sticky-collapse-design.md](../specs/2026-08-30-runprogress-sticky-collapse-design.md) **r2 LOCKED**

**Goal:** 把 `main` 上 `9d45b7c2` 的 r1 铬（永远默收、`aria-current="step"`、草稿进 `m`、展开 ul 无上限）改写成 spec r2：≤3 默开、wrap 永远 sticky、展开 ul 封顶内滚、可勾计数、禁步骤轨方言。

**Architecture:** 抽出无 React 纯函数 `run-progress-view.ts`（默开/计数/预览）供组件与 `node:test` 共用。`RunProgress.tsx` 只负责手势与样式。ChatView 挂载点已有 `key={activeThreadId}`，不改铬栈。Companion 协议 **零 diff**。Wave 2 / FocusBand **不准动**。

**Tech Stack:** Side Panel React + chrome-extension `node:test`（`npm --prefix chrome-extension test`）。无 RTL / jsdom。

**Spec:** `docs/superpowers/specs/2026-08-30-runprogress-sticky-collapse-design.md`

```text
Surface:      L0 RunProgress display in ChatView scroller only
L2-classes:   none
Compose:      existing thread.run_progress ; H1 seed-only
Autonomy:     n/a
Trust:        exact item.tool or Side Panel click ; overlay denied
Channel:      community
Blast:        T1
```

## Global Constraints

- 文案只许「本轮步骤」/「草稿」。禁「进行中」「任务清单」「当前步」当活计划、`aria-current="step"`、`%`、LIVE。
- Companion `run-progress.ts` / adapter tick / `SUMMONER_ALLOW` **零 diff**。
- 不改 `App.tsx`、`FocusBand.tsx`、`focus-band-priority.ts`。
- 不新增 thread 字段、sessionStorage、module Map。
- 不新增 `scrollIntoView`。
- 不宣称 #230 已闭合。
- 密度常数只许 live：StatusRail **48**、Scene **36**、popoutBar **36**、FB **80**、busy/worker **28**。禁抄 08-11 的 44/28。
- 测试：**改写** r1 三断言，禁止 append 两套锁。

**How tests run:** `cd chrome-extension && npm test`  
**Companion guard:** `git diff -- companion/src/threads/run-progress.ts companion/src/llm/adapter.ts companion/src/ws/summoner-acl.ts companion/src/summoner-web.ts` 必须空。

**BRANCH:** `fix/256-runprogress-r2` off `origin/main`. PR `Closes #256`（Wave 1 only；Wave 2 NO-GO 写进 PR 正文，不交付）。

---

## File map

| File | Role |
|------|------|
| **Create** `chrome-extension/src/sidepanel/components/run-progress-view.ts` | `defaultExpanded` / `countNM` / `previewText` / `skipHeaderChrome` |
| **Modify** `RunProgress.tsx` | 用纯函数；默开；wrap 永远 sticky；ul 封顶；去掉 `aria-current="step"` |
| **Modify** `ChatView.tsx` | `scrollPaddingTop` on `styles.container`；**保留** `key={activeThreadId}` |
| **Modify** `chrome-extension/tests/run-progress-ui.test.ts` | **替换** r1 Wave 1 块；加纯函数测 + 密度 fixture + overlay 源码锁 |
| **Modify** `docs/DESIGN.md` | Side Panel 行 + 若需 copy 合同一句 |
| **Forbidden** | `companion/src/threads/run-progress.ts`、`FocusBand*`、`App.tsx`、overlay 画清单 |

**r1 → r2 对照（执行者必改，不是新功能）：**

| r1 (`9d45b7c2`) | r2 |
|-----------------|-----|
| `useState(false)` 永远默收 | `useState(() => defaultExpanded(items.length))` |
| `doneCount/total` 草稿进 m | `countNM`：m = seed\|user |
| `aria-current="step"` | 删除；左条 + 字重 |
| `wrap` 永远 `position: "sticky"` | （r1 已 sticky；r2 **保持**，展开不卸）`<ul>` 加 maxHeight |
| 1 条仍两行芯片 | `skipHeaderChrome`：只有勾选行 |

**Sticky 锁定（折 Product B2 / Skeptic）：** `wrap` **永远** `position: "sticky"; top: 0`。展开不卸 sticky。`<ul>` 设 `maxHeight: "min(40vh, 240px)"` + `overflowY: "auto"`（禁 `%` 相对 `contentInner`）。pin-bottom 下点开 ≥4 条仍能勾。

**1 条：** 无芯片头（直接勾选行），**仍 sticky**。`skipHeaderChrome(items)` 仅当 `length===1` 且该条 `source` 为 seed|user。单条草稿：有芯片/`n/m`，不假装可勾行。

**源码锁：** 断言行为，禁止与 Task 3 代码互斥的正则。T2 **删除** r1「root is sticky… `position: "sticky"`」整测，改成永远 sticky + `ul` 有 maxHeight。折叠分支无 checkbox/`<ul>` 必须重新锁上。

**Overlay：** 从 `chrome-extension/../companion/src` glob `summoner-web.ts` + `summoner/**/*.ts`。0 文件 = FAIL。先剥注释再禁「本轮步骤」UI。`run_progress` 仅允许出现在 ACL 标识符。T5 `git diff -- companion/src/summoner-web.ts` 也必须空。指向已有 `run-progress.test.ts` SUMMONER_ACL 测，不另造弱 OR。

**previewText：** 未勾 seed|user → 其 text。全勾完只剩草稿 → `草稿 · {首条}`（meta，不得 `rowCurrent`）。无草稿且全勾 → `null`。

**DESIGN.md：** 与 Task 3 **同一 commit**（禁止 T1/T2 先合）。只改 Side Panel 行：≤3 摊开 / ≥4 默收；sticky 整卡（展开 ul 内滚）；`n/m` 可勾计数。Copy 合同仍禁「进行中」。ChatView 挂载注释去掉「默认收起」。

**密度 fixture（Wave 1）：** StatusRail `minHeight: 48`、Scene `maxHeight: 36`、`FOCUS_BAND_MAX_PX = 80`。不要断言 RunBusyChip=28（live minHeight 24）。popoutBar 无字面 `36`，不要造。

---

### Task 1: 纯函数 + 先红测

**Files:**
- Create: `chrome-extension/src/sidepanel/components/run-progress-view.ts`
- Modify: `chrome-extension/tests/run-progress-ui.test.ts`（先加纯函数测；下一步才删 r1 锁）

**Interfaces:**
- Produces:
```ts
export type RunProgressViewItem = {
  id: string
  text: string
  done: boolean
  source: "seed" | "model_draft" | "user"
}
export function defaultExpanded(itemCount: number): boolean
export function skipHeaderChrome(items: RunProgressViewItem[]): boolean
export function countNM(items: RunProgressViewItem[]): { n: number; m: number }
export function previewText(items: RunProgressViewItem[]): string | null
```

- [ ] **Step 1: Write failing tests** at top of `run-progress-ui.test.ts` (keep existing r1 tests until **Task 2** deletes them; Task 1 RED is only missing module):

```ts
import {
  defaultExpanded,
  skipHeaderChrome,
  countNM,
  previewText,
} from "../src/sidepanel/components/run-progress-view"

test("defaultExpanded: 0 false, 1–3 true, 4–8 false", () => {
  assert.equal(defaultExpanded(0), false)
  assert.equal(defaultExpanded(1), true)
  assert.equal(defaultExpanded(3), true)
  assert.equal(defaultExpanded(4), false)
  assert.equal(defaultExpanded(8), false)
})

test("skipHeaderChrome only for a single seed|user row", () => {
  assert.equal(skipHeaderChrome([{ id: "a", text: "A", done: false, source: "seed" }]), true)
  assert.equal(skipHeaderChrome([{ id: "d", text: "D", done: false, source: "model_draft" }]), false)
  assert.equal(
    skipHeaderChrome([
      { id: "a", text: "A", done: false, source: "seed" },
      { id: "b", text: "B", done: false, source: "seed" },
    ]),
    false,
  )
})

test("countNM excludes drafts from n and m", () => {
  const items = [
    { id: "a", text: "A", done: true, source: "seed" as const },
    { id: "b", text: "B", done: false, source: "user" as const },
    { id: "c", text: "C", done: true, source: "model_draft" as const },
    { id: "d", text: "D", done: false, source: "model_draft" as const },
  ]
  assert.deepEqual(countNM(items), { n: 1, m: 2 })
})

test("previewText is first undone non-draft; drafts-only fallback", () => {
  assert.equal(
    previewText([
      { id: "a", text: "done", done: true, source: "seed" },
      { id: "b", text: "next", done: false, source: "seed" },
    ]),
    "next",
  )
  assert.equal(
    previewText([{ id: "d", text: "hint", done: false, source: "model_draft" }]),
    "草稿 · hint",
  )
  assert.equal(
    previewText([{ id: "a", text: "done", done: true, source: "seed" }]),
    null,
  )
})
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

```bash
cd chrome-extension && npm test
```

Expected: cannot find `run-progress-view`.

- [ ] **Step 3: Implement helpers only**

```ts
// chrome-extension/src/sidepanel/components/run-progress-view.ts
export type RunProgressViewItem = {
  id: string
  text: string
  done: boolean
  source: "seed" | "model_draft" | "user"
}

export function defaultExpanded(itemCount: number): boolean {
  return itemCount >= 1 && itemCount <= 3
}

export function skipHeaderChrome(items: RunProgressViewItem[]): boolean {
  return items.length === 1 && items[0]!.source !== "model_draft"
}

export function countNM(items: RunProgressViewItem[]): { n: number; m: number } {
  let n = 0
  let m = 0
  for (const it of items) {
    if (it.source === "model_draft") continue
    m += 1
    if (it.done === true) n += 1
  }
  return { n, m }
}

export function previewText(items: RunProgressViewItem[]): string | null {
  const current = items.find((it) => it.done !== true && it.source !== "model_draft")
  if (current) return current.text
  const draft = items.find((it) => it.source === "model_draft")
  return draft ? `草稿 · ${draft.text}` : null
}
```

- [ ] **Step 4: Run tests — new four PASS**; r1 source-scan tests still PASS (code not rewritten yet).

- [ ] **Step 5: Commit** `test(ui): RunProgress r2 view helpers (defaultExpanded/countNM)`

---

### Task 2: 改写 r1 源码锁（先红）

**Files:** Modify `chrome-extension/tests/run-progress-ui.test.ts`

**Consumes:** helpers from Task 1.

- [ ] **Step 1: DELETE these r1 tests entirely** (do not leave them commented):
  - `"RunProgress defaults to collapsed; header is a button; checkboxes not in collapsed branch"` (`useState(false)`)
  - `"RunProgress exposes aria-current=step on the expanded current row"`
  - `"RunProgress collapsed summary: n/m count, current-step ellipsis, draft fallback"` 里「草稿计入分母」那句断言 `doneCount}/{total}`

Keep: copy `本轮步骤`/`草稿`/`!进行中`、不 import BoardPanel、background toggle、`key={activeThreadId}`、App.tsx 无 RunProgress、无 scrollIntoView。

**Also DELETE** `"RunProgress root is sticky to the scroll column top..."` (r1 always-sticky shape). Replace with the always-sticky + ul maxHeight test below. Re-lock: collapsed branch (`!expanded`) has no `checkbox` / `<ul`.

- [ ] **Step 2: ADD replacement source locks**

```ts
test("RunProgress uses defaultExpanded(items.length) not useState(false)", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.match(rp, /from ["']\.\/run-progress-view["']/)
  assert.match(rp, /defaultExpanded\(/)
  assert.ok(!/useState\(false\)/.test(rp))
  assert.ok(!/sessionStorage|localStorage/.test(rp))
  assert.match(rp, /aria-expanded=\{expanded\}/)
  const collapsedBranch = rp.slice(rp.indexOf("!expanded"), rp.indexOf("<ul"))
  assert.ok(!/type=["']checkbox["']/.test(collapsedBranch))
})

test("RunProgress wrap stays sticky; expanded ul has maxHeight", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.match(rp, /position:\s*["']sticky["']/)
  assert.match(rp, /top:\s*0/)
  assert.match(rp, /background:\s*tokens\.bgMuted/)
  assert.match(rp, /maxHeight:\s*["']min\(40vh,\s*240px\)["']/)
  assert.ok(!/aria-current/.test(rp))
  assert.ok(!/当前步/.test(rp))
})

test("RunProgress count comes from countNM not items.length denominator", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.match(rp, /countNM\(/)
  assert.ok(!/doneCount\}\s*\/\s*\{total\}/.test(rp))
})

test("RunProgress skipHeaderChrome hides the chip on 1 item", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.match(rp, /skipHeaderChrome\(/)
})

test("ChatView scrollPaddingTop is set on the scroller", () => {
  const chat = src("src/sidepanel/components/ChatView.tsx")
  assert.match(chat, /scrollPaddingTop/)
})

test("live density constants have not silently reverted to 44/28", () => {
  const rail = src("src/sidepanel/components/StatusRail.tsx")
  const scene = src("src/sidepanel/components/SceneStatusBar.tsx")
  const fb = src("src/sidepanel/components/focus-band-priority.ts")
  assert.match(rail, /minHeight:\s*48/)
  assert.match(scene, /maxHeight:\s*36/)
  assert.match(fb, /FOCUS_BAND_MAX_PX\s*=\s*80/)
  assert.ok(!/minHeight:\s*44/.test(rail))
})

test("overlay/summoner sources do not paint 本轮步骤 checklist", () => {
  const { readFileSync, existsSync } = require("node:fs")
  const { join } = require("node:path")
  const roots = [
    join(process.cwd(), "..", "companion", "src", "summoner-web.ts"),
    join(process.cwd(), "..", "companion", "src", "summoner", "client.ts"),
  ]
  for (const p of roots) {
    assert.ok(existsSync(p), `missing ${p}`)
  }
  const found = roots
  for (const p of found) {
    const stripped = readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
    assert.ok(!/本轮步骤/.test(stripped), p)
    assert.ok(!/run_progress/.test(stripped), p)
  }
})
```

Overlay: 0 surviving files after existsSync = **FAIL**. Comments stripped before deny. `run_progress` in remaining source = FAIL (ACL tests live in companion `run-progress.test.ts`, not this OR).

- [ ] **Step 3: Run — expect FAIL** on `useState(false)` / `aria-current` / sticky always / `doneCount/total`.

- [ ] **Step 4: Do not fix production yet.** Confirm RED is the r1 code, not a bad regex.

- [ ] **Step 5: Commit** `test(ui): replace RunProgress r1 locks with r2`

---

### Task 3: 改写 `RunProgress.tsx`

**Files:** Modify `chrome-extension/src/sidepanel/components/RunProgress.tsx`

**Consumes:** Task 1 helpers.

- [ ] **Step 1: Rewrite component** (full intended shape):

```tsx
import { useState } from "react"
import {
  countNM,
  defaultExpanded,
  previewText,
  skipHeaderChrome,
} from "./run-progress-view"

export function RunProgress({ threadId, items }: { threadId: string; items: ... }) {
  const count = items?.length ?? 0
  const [expanded, setExpanded] = useState(() => defaultExpanded(count))
  if (!items || count === 0) return null

  const { n, m } = countNM(items)
  const preview = previewText(items)
  const headerless = skipHeaderChrome(items)
  const listId = `run-progress-list-${threadId}`
  const firstUndone = items.find((it) => it.done !== true && it.source !== "model_draft")

  // toggle: unchanged, never model_draft

  // wrap: always sticky (styles.wrap.position = "sticky"). Expanded list caps itself.

  if (headerless) {
    const it = items[0]!
    return (
      <section aria-label="本轮步骤" style={wrapStyle}>
        {/* single checkbox row; no chip header */}
      </section>
    )
  }

  return (
    <section aria-label="本轮步骤" style={wrapStyle}>
      <button type="button" aria-expanded={expanded} aria-controls={listId} ...>
        本轮步骤 {n}/{m} {expanded ? "▴" : "▾"}
      </button>
      {!expanded ? (
        preview ? <div style={styles.currentLine} title={preview}>{preview}</div> : null
      ) : (
        <ul id={listId}>...</ul>
      )}
    </section>
  )
}
```

Headerless 1-item: wrap **仍 sticky**。禁止卸 sticky。

展开行：`fontWeight: 500` + `styles.rowCurrent` 左条。`li` **无** `aria-current`。

注释改成 r2：禁写「当前步」「默认收起」。预览行 class 可留 `currentLine` 作样式名，**可见文案**不得出现「当前步」。

- [ ] **Step 2: Run `cd chrome-extension && npm test`** — all PASS.

- [ ] **Step 3: Commit together with Task 4** `fix(ui): RunProgress r2 defaultExpanded + sticky ul cap + DESIGN.md`（禁止本 task 单独先合）

---

### Task 4: ChatView `scrollPaddingTop` + DESIGN.md（**与 Task 3 同一 commit**，不要单独 `git commit`）

**Files:**
- Modify `ChatView.tsx` `styles.container` add `scrollPaddingTop: 52`（收起头 ~44–52 + 不把锚点藏进卡）。**不要**改挂载顺序、**不要** `scrollIntoView`、**保留** `key={activeThreadId}`。
- Modify `docs/DESIGN.md` Side Panel 行，替换 `default **collapsed**`：

```
Chat column **本轮步骤** is L0 RunProgress (H1 seed): **≤3 items expanded, ≥4 collapsed**; wrap **always sticky**; expanded `<ul>` `maxHeight min(40vh,240px)` + inner scroll — never StatusRail / FocusBand / overlay. `n/m` counts tickable seed|user rows (drafts excluded). **`tool_result` ticks only when that seed row has an exact `tool`**; otherwise click-only. Existing `run_progress` is not overwritten by a later H1. **Not** Mission Board.
```

Copy 合同句保持禁「进行中」。不要加「当前步」。

- [ ] **Step 1: Edit both files**
- [ ] **Step 2: `npm --prefix chrome-extension test` PASS**
- [ ] **Step 3: Do not commit here** — files ride Task 3’s single commit. If this step is reached with T3 already committed alone, **amend is forbidden on origin**; fold into the next commit and do not merge the UI-only SHA.

---

### Task 5: 护栏

- [ ] **Step 1:** `git diff -- companion/src/threads/run-progress.ts companion/src/llm/adapter.ts companion/src/ws/summoner-acl.ts companion/src/summoner-web.ts companion/src/message-router` 必须空。若非空 = 停。
- [ ] **Step 2:** `git diff -- chrome-extension/src/sidepanel/App.tsx chrome-extension/src/sidepanel/components/FocusBand.tsx chrome-extension/src/sidepanel/components/focus-band-priority.ts` 必须空。
- [ ] **Step 3:** 源码 `rg aria-current RunProgress.tsx` 空；`rg 进行中 RunProgress.tsx` 空；`rg useState\(false\) RunProgress.tsx` 空。
- [ ] **Step 4:** `npm --prefix chrome-extension test` 全绿。
- [ ] **Step 5:** PR 正文写明：Wave 2 **NO-GO**；#230 未闭合；改写 `9d45b7c2` 不是新功能。`Closes #256`。

---

## Spec coverage

| Spec pin | Task |
|----------|------|
| 1 产品句 / 禁当前步 | T3 copy + T4 DESIGN |
| 2 ≤3 默开 ≥4 默收 | T1 `defaultExpanded` + T3 |
| 3 sticky 整卡 + ul 封顶 | T3 wrap 永远 sticky；`ul` maxHeight |
| 4 key + instance state | 已有挂载；T3 `useState(() => defaultExpanded)` |
| 5 n/m 不含草稿 | T1 `countNM` |
| 6 预览 / 禁 aria-current=step | T1 `previewText` + T3 |
| 7 compact 可滚走 / scroll-padding | T4 |
| 8–9 Wave 2 | **不出本 plan** |
| 10 overlay 不画 | T2 source lock |
| 11 改写 r1 测 | T2 |
| 12 DESIGN.md | T4 |
| 13 9d45b7c2 不是 SoT | 全文 |

## NEVER in this plan

FocusBand Glance、StatusRail 抽屉、`ComputerTaskBar`、companion tick、overlay toggle、thread 新字段、修 L2 40% 铬债。
