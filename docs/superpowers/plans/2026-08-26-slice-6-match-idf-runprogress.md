# Slice 6 — 匹配诚实 IDF + RunProgress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Plan dual:** r1 四路对抗 **3× REJECT + External AWN** → 下列 r2 针已折。未 dual 不得实现。合成：[slice-6-plan-adversary-synthesis-20260826.md](../../audit/reviews/slice-6-plan-adversary-synthesis-20260826.md)

**Goal:** Skill auto-match uses real IDF; an explicit pin (`/技能` this turn or 按需勾选) stops `matchSkills` union; the chat column shows a running checklist whose checks bind to `tool_result` (item id / declared tool) or an L0 Side Panel click — never model self-tick, never Mission Board, never overlay write.

**Architecture:** Keep `semantic-match.ts` as the only matcher; add corpus IDF for **skills only**. Matching honesty is **chat.create + resolveSkillIdsForThread**, not overlay `skill.activate`. RunProgress persists on thread `run_progress`, **seeded from `runtime_context_budget.handoff.open_todos`**. Mount only in `ChatView` (do not touch EmptyState / composer stack). Tick hook is `adapter.ts` after real `tool.result` `ok===true`. Overlay ACL does not grow.

**Tech Stack:** Companion Node/TS, Side Panel React, existing `node:test` + chrome-extension tests.

**SoT:** [product-form-deepening §11 slice 6](../specs/2026-08-26-product-form-deepening-design.md) · [summoner-strategy-rethink §8–9](../specs/2026-08-26-summoner-strategy-rethink-design.md)

```text
Surface:      L0 chat column RunProgress ; no overlay edit
L2-classes:   none
Compose:      existing SkillEngine + thread meta ; no Python matcher ; no thread.todo SoT
Autonomy:     n/a
Trust:        checks require tool_result or user gesture ; no security.confirmation dialect
Channel:      community
```

**Blast:** T2. Dual-review the **plan** before implement. Do **not** expand outbound profile. T1 bake-off remains a separate P0 process ([preflight 20260826](../../audit/reviews/outbound-mcp-p0d-preflight-20260826.md)).

**How tests run:** `cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/<file>.js`. Extension: `cd chrome-extension && npm test`.

**PR split:**

| PR | Scope |
|----|--------|
| **A** | IDF in `semantic-match` + `matchSkills` + **`/技能` / 按需 pin 后不再 union matchSkills** + GOAL/architecture/CLAUDE matching copy |
| **B** | `run_progress` + ChatView list + adapter `tool.result` hook + `thread.run_progress.toggle` lockstep (**denied** on summoner) |

**BLOCK:** Python / sentence-transformers；新 `thread.todo` SoT；模型 JSON 自勾或 `applyToolResult` 子串勾 `model_draft`；Mission Board 当 todo；overlay 编辑清单 / 把 toggle 加进 `SUMMONER_ALLOW`；改 outbound default profile；用 overlay `skill.activate` 当匹配诚实的门；动 EmptyState / `empty-state-copy` / `tokens.emptyTitle`；声称 T1 已跑。

**r2 pins (fold REJECT):**

1. **匹配诚实门** = Side Panel `/技能` 本轮 + `skill_selection_mode==="manual"` 的 `resolveSkillIdsForThread` **不得**再 union `matchSkills`。`chat.create` 也不得把 `rest.skill_ids` 当永久 auto 并集的借口：本轮 `/技能` 只并这一次，随后线程若仍是 auto，下一轮仍可 match（诚实：toast 必须说「本轮加了 X，自动匹配仍可能带入其他技能」）——**更好的产品针**：`/技能` 将线程切到 `manual` 并只激活该技能（与 按需勾选同一扇门）。**禁止** overlay `skill.activate` 写 `skill_selection_mode`（冻结 Trust；`surface==="summoner"` 不得 flip mode）。
2. **种子** = `thread.runtime_context_budget.handoff.open_todos`（H1），不是虚构的 `thread.open_todos`。无 handoff → 空列表可隐藏。草稿行须有 **具名 ingest**（companion 从模型 proposed 列表写入 `source:"model_draft"` 且 `done` 强制 false）；禁止 overlay ingest。
3. **`applyToolResult`** 只勾 `source:"seed"|"user"` 且 **item 声明了 `tool` 或 id 绑定**，永不对 `model_draft` 勾；永不 `text.includes(toolName)`。接线：`companion/src/llm/adapter.ts` 在 `tool.result` `ok===true` 之后。
4. **WS** `thread.run_progress.toggle`：`validate.ts` + router handler + `background/index.ts` case + lockstep 测。**不得**加入 `SUMMONER_ALLOW` / `SUMMONER_WEB_DISPATCH_ALLOW` / `thread.update` allowlist。summoner-acl 测：overlay → `SUMMONER_ACL`。
5. **UI** 只改 `ChatView` 消息列；空态保持切片 5。铬文案 **「本轮步骤」**，不用「进行中」（撞 Mission Board / HUD）。
6. **IDF 测** 必须让 overlap 计数相同、稀有词 **在语料内**；`idf` 对全文档词须 **小于** 未见词。`tokensToVec` 行为不变（Obsidian / related 回归测）。
7. **文档同 commit**：`docs/GOAL.md` G17 改为知识=站点匹配、技能 matchSkills=本 PR 后 TF-IDF、related/Obsidian 仍纯 TF；`docs/architecture.md` Skill Engine 行；`CLAUDE.md` A5。`docs/multi-agent-user-guide.md` 一句：聊天列步骤 ≠ 任务板。不改 `docs/mcp.md` T1 横幅。

---

## File map

| File | PR | Role |
|------|----|------|
| `companion/src/skills/semantic-match.ts` | A | `idfWeights`, `tfidfVec`, keep tokenize |
| `companion/src/skills/skill-engine.ts` | A | `matchSkills` uses IDF over skill corpus |
| `companion/src/message-router.ts` | A | `/技能` 与 按需：`manual` 后 resolve 不再 union matchSkills；**summoner `skill.activate` 不写 mode** |
| `companion/src/ws/validate.ts` + `summoner-acl.ts` + `background/index.ts` | B | toggle 注册；overlay **拒绝** |
| `companion/src/llm/adapter.ts` | B | `tool.result` ok 后 `applyToolResult` |
| `companion/tests/skills.test.ts` | A | IDF 稀有词在语料内；`tokensToVec` 回归 |
| `companion/src/threads/thread-manager.ts` | B | `run_progress` sanitize-on-read；cap 8×120 同 H1 |
| `companion/src/threads/run-progress.ts` | B | **Create.** seed from handoff.open_todos / applyToolResult / userToggle |
| `chrome-extension/src/sidepanel/components/RunProgress.tsx` | B | **Create.** ChatView only |
| `chrome-extension/src/sidepanel/components/ChatView.tsx` | B | 消息列；不碰 EmptyState |
| `docs/GOAL.md` `architecture.md` `CLAUDE.md` `multi-agent-user-guide.md` `DESIGN.md` | A/B | 匹配诚实文案 + 步骤≠任务板 |

---

### Task 1: IDF vectors (PR-A)

**Files:**
- Modify: `companion/src/skills/semantic-match.ts`
- Test: `companion/tests/skills.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("tfidfVec ranks a rare in-corpus token above a token in every document", () => {
  const { idfFromDocs, tfidfVec, cosineSimilarity } = require("../src/skills/semantic-match")
  const docs = [
    ["web", "alpha"],
    ["web", "beta"],
    ["web", "gamma"],
    ["web", "rareterm"],
  ]
  const idf = idfFromDocs(docs)
  const q = tfidfVec(["web", "rareterm"], idf)
  const commonOnly = tfidfVec(["web"], idf)
  const rareOnly = tfidfVec(["rareterm"], idf)
  assert.ok(cosineSimilarity(q, rareOnly) > cosineSimilarity(q, commonOnly))
  const { tokensToVec } = require("../src/skills/semantic-match")
  assert.deepEqual(tokensToVec(["a", "a", "b"]), { a: 2 / 3, b: 1 / 3 })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/skills.test.js --test-name-pattern "tfidfVec"`

Expected: FAIL — `idfFromDocs` / `tfidfVec` missing.

- [ ] **Step 3: Minimal implementation**

```ts
export function idfFromDocs(docs: string[][]): Record<string, number> {
  const df: Record<string, number> = {}
  const n = Math.max(1, docs.length)
  for (const doc of docs) {
    for (const t of new Set(doc)) df[t] = (df[t] || 0) + 1
  }
  const idf: Record<string, number> = {}
  for (const [t, c] of Object.entries(df)) {
    // Smoothed IDF: a term in every doc must score **below** an unseen term (unseen → 1).
    idf[t] = Math.log((n + 1) / (c + 1))
  }
  return idf
}

export function tfidfVec(tokens: string[], idf: Record<string, number>): Record<string, number> {
  const tf = tokensToVec(tokens)
  const vec: Record<string, number> = {}
  for (const [t, v] of Object.entries(tf)) vec[t] = v * (idf[t] ?? 1)
  return vec
}
```

Keep `tokensToVec` (pure TF) for Obsidian export / related which must stay no-IDF.

- [ ] **Step 4: Run tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add companion/src/skills/semantic-match.ts companion/tests/skills.test.ts
git commit -m "feat(skills): add IDF weights next to existing TF cosine"
```

---

### Task 2: matchSkills uses IDF (PR-A)

**Files:**
- Modify: `companion/src/skills/skill-engine.ts` `matchSkills`
- Test: `companion/tests/skills.test.ts`

- [ ] **Step 1: Failing test** — two skills share "web"; only one has a rare token from the query; rare skill ranks higher.

- [ ] **Step 2: Run** — expect FAIL (TF-only ranks the generic skill).

- [ ] **Step 3:** In `matchSkills`, build `idfFromDocs` from skill name+description+tags token lists once per call; compare `tfidfVec(query)` vs `tfidfVec(skillText)`. Comment must say TF-IDF (IDF live), not a lie.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `fix(skills): matchSkills uses corpus IDF`

---

### Task 3: pin door is `/技能` + 按需, not overlay activate (PR-A)

**Files:**
- Modify: `companion/src/skills/skill-engine.ts` `resolveSkillIdsForThread`
- Modify: `companion/src/message-router.ts` `chat.create` slash-skill path (or the handler that sees `/技能`)
- Modify: Side Panel only if 按需 already writes `skill_selection_mode` (it does via `thread.update`)
- **Do not** make overlay `skill.activate` write `skill_selection_mode`

- [ ] **Step 1:** Tests:
  1. `mode==="manual"` → result is active only (already exists; keep).
  2. `chat.create` with leading `/browse …` while mode auto → this turn includes `browse`, **and** thread becomes `manual` with `active_skill_ids` containing browse; **next** `resolveSkillIdsForThread` does not union `matchSkills`.
  3. overlay/`surface==="summoner"` `skill.activate` does **not** change `skill_selection_mode`.

- [ ] **Step 2: FAIL** (`/技能` today only unions `skill_ids` for one send).

- [ ] **Step 3:** Implement 2–3. Broadcast `thread.updated` so SkillsPanel shows 按需.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `fix(skills): slash-skill pin switches thread to manual`

---

### Task 4: run_progress helper (PR-B)

**Files:**
- Create: `companion/src/threads/run-progress.ts`
- Test: `companion/tests/run-progress.test.ts`

Schema (pin now):

```ts
export type RunProgressItem = {
  id: string
  text: string
  done: boolean
  source: "seed" | "model_draft" | "user"
}
export type RunProgress = { items: RunProgressItem[] }
```

Rules:
- Seed from `thread.runtime_context_budget?.handoff?.open_todos` (H1, cap 8×120). Else empty. **Not** `thread.open_todos`.
- Model-proposed rows = `source: "model_draft"`, `done: false` via a **named companion ingest** (not overlay, not LLM tool that sets done). Completing them requires **L0 click only** until the user (or a later seed) binds `tool?: string` on that row. `applyToolResult` **never** ticks `model_draft`.
- `applyToolResult(progress, { tool, ok })`: `ok===true` only; match `item.tool === tool` (exact internal name); at most one oldest undone seed/user row. No substring on `text`.
- Wire in `adapter.ts` after successful `tool.result`.
- Overlay does not get write verbs. Toggle not on `SUMMONER_ALLOW`.

- [ ] Steps: failing tests → implement → pass → commit `feat(thread): run_progress seed and evidence ticks`

---

### Task 5: ChatView list (PR-B)

**Files:**
- Create: `chrome-extension/src/sidepanel/components/RunProgress.tsx`
- Modify: `ChatView.tsx` **only** — list in the **chat column** when `items.length>0`. Do not edit EmptyState, `empty-state-copy.ts`, `tokens.emptyTitle`, or App composer stack.
- Test: source-scan (this repo has no RTL) that ChatView mounts RunProgress and that `summoner-acl` denies the toggle.

Copy: 「本轮步骤」；empty hidden；draft rows 「草稿」. **Not** 「进行中」.

Summoner: no new badge, no edit, no count chrome unless a number already exists (today: none → add nothing).

- [ ] TDD the toggle WS type through validate + router.
- [ ] Commit `feat(ui): RunProgress in chat column`

---

### Task 6: Docs + never Mission Board (PR-B)

- [ ] `DESIGN.md` one paragraph.
- [ ] Test or comment: `BoardPanel` is not imported from `RunProgress.tsx`.
- [ ] Commit `docs(design): RunProgress is L0 chat chrome`

---

## Self-review

| Spec | Task |
|------|------|
| IDF port 进现有 TS | 1–2 |
| 技能 activate 诚实 | 3 |
| 清单聊天列 L0 | 5 |
| 勾选绑 tool_result 或手势 | 4 |
| 不嵌 Python / 不用 Board / 无 thread.todo | BLOCK + 6 |

No TBD. `open_todos` seed is optional: missing field → empty list.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-26-slice-6-match-idf-runprogress.md`. Dual-review this plan before implement. Two execution options after APPROVE*:

1. Subagent-Driven (recommended)
2. Inline Execution
