# Slice 6 — 匹配诚实 IDF + RunProgress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skill auto-match uses real IDF (not TF-only mislabeled TF-IDF); pinning a skill is honest (activate → manual); the chat column shows a running checklist whose checks bind to `tool_result` or an L0 click — never model self-tick, never Mission Board.

**Architecture:** Keep `semantic-match.ts` as the only matcher. Add corpus IDF on the skill pool, reuse cosine. `skill.activate` writes `skill_selection_mode: "manual"`. RunProgress is thread runtime JSON on existing thread meta (`run_progress`), seeded from H1-shaped `open_todos` if present, rendered in `ChatView` above the composer — not a new confirm dialect, not overlay-owned.

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
| **A** | IDF in `semantic-match` + `matchSkills` comment/code lockstep + `skill.activate` → `skill_selection_mode: "manual"` |
| **B** | `run_progress` on thread + ChatView list + tick via tool_result or click |

**BLOCK:** Companion 内嵌 Python / sentence-transformers；新 `thread.todo` SoT；模型 JSON 自勾完成；Mission Board 当 todo；overlay 编辑清单；改 outbound default profile。

---

## File map

| File | PR | Role |
|------|----|------|
| `companion/src/skills/semantic-match.ts` | A | `idfWeights`, `tfidfVec`, keep tokenize |
| `companion/src/skills/skill-engine.ts` | A | `matchSkills` uses IDF over skill corpus |
| `companion/src/message-router.ts` | A | `skill.activate` sets `skill_selection_mode: "manual"` |
| `companion/tests/skills.test.ts` | A | IDF down-weights corpus-common tokens; activate flips mode |
| `companion/src/threads/thread-manager.ts` | B | `run_progress` field on thread |
| `companion/src/threads/run-progress.ts` | B | **Create.** seed / applyToolResult / userToggle |
| `chrome-extension/src/sidepanel/components/RunProgress.tsx` | B | **Create.** list in chat column |
| `chrome-extension/src/sidepanel/components/ChatView.tsx` | B | mount above stream end / below empty |
| `docs/DESIGN.md` | B | one paragraph: list is L0 chrome, not Board |

---

### Task 1: IDF vectors (PR-A)

**Files:**
- Modify: `companion/src/skills/semantic-match.ts`
- Test: `companion/tests/skills.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("tfidfVec down-weights a token that appears in every document", () => {
  const { tokenize, idfFromDocs, tfidfVec, cosineSimilarity } = require("../src/skills/semantic-match")
  const docs = [
    tokenize("browse the web page"),
    tokenize("browse the other web page"),
    tokenize("browse the third web page"),
  ]
  const idf = idfFromDocs(docs)
  const q = tfidfVec(tokenize("browse secret-unique-term"), idf)
  const common = tfidfVec(tokenize("browse the web page"), idf)
  const unique = tfidfVec(tokenize("secret-unique-term"), idf)
  assert.ok(cosineSimilarity(q, unique) > cosineSimilarity(q, common))
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
    idf[t] = Math.log((n + 1) / (c + 1)) + 1
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

### Task 3: activate is manual (PR-A)

**Files:**
- Modify: `companion/src/message-router.ts` `skill.activate`
- Test: existing skill-engine / router tests

- [ ] **Step 1:** Test: thread `skill_selection_mode` is `auto`; `skill.activate` → mode `"manual"` and `active_skill_ids` contains the name. `resolveSkillIdsForThread` after activate does **not** union `matchSkills`.

- [ ] **Step 2: FAIL** (activate today does not flip mode).

- [ ] **Step 3:** In `skill.activate` handler, `threadManager.update(id, { skill_selection_mode: "manual", active_skill_ids })`. Deactivate does not silently revert to auto.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `fix(skills): skill.activate pins thread to manual match`

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
- Seed from `thread.open_todos` if that array exists (H1); else empty.
- Model-proposed rows = `source: "model_draft"`, `done: false`. Completing them requires `userToggle` or `applyToolResult` (tool name+snippet match). **Never** set `done` from model JSON alone.
- `applyToolResult(progress, { tool, ok })` may mark at most one undoned item whose `text` includes the tool name (case-insensitive), only if `ok === true`.
- Overlay does not get write verbs.

- [ ] Steps: failing tests → implement → pass → commit `feat(thread): run_progress seed and evidence ticks`

---

### Task 5: ChatView list (PR-B)

**Files:**
- Create: `chrome-extension/src/sidepanel/components/RunProgress.tsx`
- Modify: `ChatView.tsx` (or App composer stack) — list visible in the **chat column**, not BottomBar, not BoardPanel
- Test: chrome-extension test for render + click handler posting `thread.run_progress.toggle`

Copy: 「进行中」；empty hidden；draft rows show 「草稿」 until first evidence/gesture.

Summoner: **count only** if a number is already shown; no edit.

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
