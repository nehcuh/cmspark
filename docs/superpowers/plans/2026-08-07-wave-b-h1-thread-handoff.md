# Wave B: H1 ThreadHandoff — Implementation Plan

> **For agentic workers:** Task-by-task. Dual gates: plan → impl.  
> **Parent SoT:** `docs/superpowers/specs/2026-08-07-context-memory-thinking-knowledge-adversarial-analysis.md` §4.1 / §4.3 / Wave B  
> **Naming:** **H1 ThreadHandoff** — NOT "M3" (M3 in compact-ux SoT = UI mid-message fold)

**Goal:** Replace/augment M2 prose rolling summary with a **structured, anchored session handoff** (goals / decisions / constraints / open_todos / artifacts) injected as `[context_handoff]` on the request path; persist meta for chip UI; keep M1 head-drop as floor.

**Architecture:** After turn-safe compact (M1), when `shouldRunM2` gates fire, call H1 extract instead of (or wrapping) M2 bullets. H1 takes redacted dropped transcript + **prior handoff JSON** (anchored merge) → structured object → render to request notice + `runtime_context_budget.handoff`. Failures fall back to M2 prose if possible, else M1 omit-only. Three-system glossary: still **runtime budget only** — not Digest/Export.

**Tech Stack:** companion TS, existing `llmExtract`, sidepanel ChatView chip

---

## Capability declaration

```text
Surface:      L0 request-path context budget (H1)
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        no elevation; handoff redact same as M2 F-S5
Channel:      unchanged
```

## Locked schema (frozen — dual must challenge here)

```typescript
/** H1 ThreadHandoff — session-end style hot core for runtime budget */
export interface ThreadHandoff {
  /** ISO time of last extract */
  updated_at: string
  /** ≤5 · 每条 ≤120 字 · 当前目标/任务 */
  goals: string[]
  /** ≤8 · ≤160 字 · 已做决策 + 可选 why 一句 */
  decisions: string[]
  /** ≤8 · ≤120 字 · 硬约束 / 禁区 */
  constraints: string[]
  /** ≤8 · ≤120 字 · 未完成 */
  open_todos: string[]
  /** ≤8 · ≤80 字 · 文件/URL/tab 名等产物线索 */
  artifacts: string[]
}

// Caps (enforce in sanitize + extract prompt)
const HANDOFF_CAPS = {
  goals: { max: 5, len: 120 },
  decisions: { max: 8, len: 160 },
  constraints: { max: 8, len: 120 },
  open_todos: { max: 8, len: 120 },
  artifacts: { max: 8, len: 80 },
} as const
```

**UI labels (zh):** 目标 · 决策 · 约束 · 待办 · 产物

### Locked decisions

| ID | Decision |
|----|----------|
| H-D1 | H1 **extends** runtime budget; does **not** write Digest/Export/global knowledge |
| H-D2 | Request inject prefix: **`[context_handoff]`** (alongside `[context_omitted]` / `[context_summary]`) |
| H-D3 | `isOmitNotice` treats all three prefixes as sticky budget notices |
| H-D4 | When H1 succeeds: `mode: "h1"` in meta; notice body = structured text (not raw JSON fence to model if fragile — prefer labeled bullets from schema) |
| H-D5 | Anchored merge: extract prompt receives **prior handoff** + **new dropped redacted span** only (not full history) |
| H-D6 | Failure cascade: H1 fail → try existing M2 prose if m2Enabled → else M1 omit |
| H-D7 | Reasoning: **optional** redacted slices from dropped msgs' `reasoning_content` if present, total cap **1500 tok** of transcript budget; never inject raw CoT into notice |
| H-D8 | mid_loop: same as M2 — **no new H1 extract**; retain prior handoff via retain helper |
| H-D9 | Audit: sha256 of serialized handoff + bytes; **no full handoff text in audit logs** |
| H-D10 | Config: reuse `context_compaction_m2` as gate for H1 (no new flag in Wave B); document as "structured handoff (H1) when m2 path runs" |

---

## File map

| File | Change |
|------|--------|
| `companion/src/llm/context-handoff.ts` | **Create:** schema, caps, sanitize, format for notice, merge helpers, extract prompt, `generateThreadHandoff` |
| `companion/src/llm/context-budget.ts` | HANDOFF_PREFIX; `isOmitNotice`; `buildHandoffNotice`; export |
| `companion/src/llm/context-budget-m2.ts` | Keep M2 as fallback; optional re-export |
| `companion/src/threads/runtime-context-budget.ts` | mode `"h1"`; optional `handoff?: ThreadHandoff`; sanitize |
| `companion/src/llm/adapter.ts` | runContextBudgetPass: H1 path; meta persist; mid_loop retain handoff |
| `companion/src/llm/context-budget.ts` or retain helper | extend `retainMidLoopRollingSummary` → handoff retain |
| `chrome-extension/.../types.ts` | Thread runtime_context_budget typing |
| `chrome-extension/.../ChatView.tsx` | chip modal: structured sections if handoff present |
| `chrome-extension/.../agentStore.tsx` / useWebSocket | pass handoff in contextCompacted if needed |
| `companion/tests/context-handoff.test.ts` | **Create:** sanitize, format, isOmitNotice, generate mock |
| `companion/tests/context-budget.test.ts` | handoff notice prefix |

---

### Task 1: Schema + sanitize + notice format (TDD)

- [ ] Create `context-handoff.ts` with caps, `sanitizeThreadHandoff`, `formatHandoffForNotice`, `HANDOFF_SYSTEM_PROMPT`
- [ ] Tests: empty → null; over-cap trimmed; secret-shaped lines scrubbed lightly (reuse SECRET patterns or drop line)
- [ ] `context-budget.ts`:

```typescript
const HANDOFF_PREFIX = "[context_handoff]"
// isOmitNotice: OMIT | SUMMARY | HANDOFF prefixes
export function buildHandoffNotice(droppedCount: number, handoff: ThreadHandoff): CanonicalChatMessage {
  const body = formatHandoffForNotice(handoff) // labeled bullets, ≤2000 chars
  return {
    role: "user",
    content: `${HANDOFF_PREFIX} Earlier ${droppedCount} messages omitted (turn-safe). Working memory (redacted, request-only):\n${body}\nFull history retained on disk.`,
  }
}
```

---

### Task 2: generateThreadHandoff (LLM extract)

```typescript
export async function generateThreadHandoff(opts: {
  droppedMessages: CanonicalChatMessage[]
  priorHandoff?: ThreadHandoff | null
  config: LlmExtractConfig
  signal?: AbortSignal
  /** optional redacted reasoning text already capped */
  reasoningSlices?: string
}): Promise<{ ok: true; handoff: ThreadHandoff; sha256: string; bytes: number } | { ok: false; error: string }>
```

- Redacted transcript via existing `buildRedactedTranscript(dropped, 2500)`
- User content:

```text
PRIOR_HANDOFF_JSON:
{... or null}

NEW_DROPPED_TRANSCRIPT:
...

OPTIONAL_REASONING_SLICES:
... or omit

Output ONE JSON object only:
{"goals":[],"decisions":[],"constraints":[],"open_todos":[],"artifacts":[]}
Rules: merge prior with new facts; drop stale todos; never secrets; same language as content; caps ...
```

- Parse JSON (fence unwrap); sanitize; set `updated_at`
- On parse fail → ok:false

- [ ] Unit test with mocked llmExtract or pure parse path

---

### Task 3: adapter integration

In `runContextBudgetPass` after M1 compact, when `shouldRunM2(...)`:

```typescript
const prior = prevMeta?.handoff // after sanitize
const h1 = await generateThreadHandoff({ droppedMessages, priorHandoff: prior, config, signal })
if (h1.ok) {
  messages = attachHandoffNotice(messages, droppedCount, h1.handoff)
  mode = "h1"
  // meta.handoff = h1.handoff; rolling_summary = formatHandoffForNotice for chip fallback
} else {
  // existing M2 generateRollingSummary path
}
```

- mid_loop retain: if prev mode h1 and handoff present, re-attach handoff notice (mirror retainMidLoopRollingSummary)
- `thread.context_compacted` event: include handoff fields for UI (no secrets beyond already redacted)
- logger: summary_sha256 / summary_bytes only

- [ ] Extend retain helper or add `retainMidLoopHandoff`

---

### Task 4: runtime_context_budget sanitize

```typescript
export type RuntimeContextBudgetMode = "m1" | "m2" | "h1"
// handoff?: ThreadHandoff — sanitize via sanitizeThreadHandoff
```

Backward: old meta without handoff still works.

---

### Task 5: UI chip

- ChatView summary modal: if `handoff` present, render 5 sections with zh labels; else existing rolling_summary prose
- agentStore / types: allow handoff on runtime_context_budget and contextCompacted payload

---

### Task 6: Verify + dual

```bash
npx tsc -p tsconfig.test.json
node --test .test-dist/tests/context-handoff.test.js .test-dist/tests/context-budget.test.js
# + any retain tests
```

Then `scripts/dual-external-review.sh wave-b-h1-thread-handoff-impl <prompt> HEAD`

---

## Explicit non-goals (Wave B)

- Wave C `thread_recall` / embedding  
- Auto-write project-knowledge  
- Default inject raw reasoning into notice  
- Changing Digest extract  
- New config key (use existing m2 gate)  
- mid_loop re-extract  

---

## Success criteria

1. Over-budget pre_loop with m2 on → meta.mode `h1` when extract ok; request has `[context_handoff]`  
2. H1 fail → M2 or M1 still works  
3. mid_loop does not call LLM extract for H1; retains prior handoff on request  
4. Chip shows structured sections  
5. dual APPROVE*  
6. No Digest/Export pollution  

---

## Workflow log

| Gate | Status |
|------|--------|
| Wave A G2 | DONE APPROVE_WITH_NITS |
| G3 Wave B plan dual | **both APPROVE_WITH_NITS** (`wave-b-h1-thread-handoff-plan-verdict-20260807-104642`) |
| G4 Wave B impl dual | **both APPROVE_WITH_NITS** (`wave-b-h1-thread-handoff-impl-verdict-20260807-105903`) · tests 26 green |
| G4b dual nits folded | **done** 2026-08-07 — parse/shouldRunH1 tests; mid_loop re-format handoff; Settings 文案; get() sanitize; D8 preserve test; reasoning scrub /g · **34/34** |
