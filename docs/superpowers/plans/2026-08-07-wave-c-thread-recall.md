# Wave C: `thread_recall` cold archive search — Implementation Plan

> **Gates:** plan dual → implement → impl dual (same as Wave A/B)  
> **Parent SoT:** `docs/superpowers/specs/2026-08-07-context-memory-thinking-knowledge-adversarial-analysis.md` Wave C / §4.1 cold archive  
> **Depends:** Wave B H1 on main (`06c05dc` / PR #134)

**Goal:** Give the LLM a **same-thread, budgeted, redacted** tool to search full disk history when runtime context was compacted (or always for long threads), without embedding / cross-thread silent inject.

**Architecture:** New companion-side tool `thread_recall(query, max_hits?)` → `ThreadManager.getMessages(threadId)` → lightweight keyword score → top-K excerpts → **`redactMessagesForCompaction`** (reuse F-S5) → return JSON hits under char/token caps. Thread id from `__thread_id` only (never caller-supplied foreign id). Optional one-line hint in omit/handoff notice when compact ran.

**Tech Stack:** companion TS, tool catalog JSON, existing context-budget redact

---

## Capability declaration

```text
Surface:      L0 read-only companion tool (thread_recall)
L2-classes:   (none) — no confirm / no host / no shell
Compose:      none
Autonomy:     n/a — single-thread only
Trust:        no elevation; F-S5 redact on output
Channel:      community | enterprise unchanged
```

## Locked decisions

| ID | Decision |
|----|----------|
| C-D1 | Tool name: **`thread_recall`** |
| C-D2 | Scope: **current thread only** (`params.__thread_id`); reject missing thread |
| C-D3 | No embedding / no vector index this wave |
| C-D4 | Search terms: whitespace-split **plus** CJK bigrams for Han runs (so "用户登录" matches); case-insensitive score = sum of term hits in role+searchText; skip empty |
| C-D5 | Defaults: `max_hits=5` (cap 12), total response body ≤ **4000** chars after redact; per-hit ≤600 (total clamp dominates above ~6 hits — intentional) |
| C-D6 | **Redact (G5 dual B1 fix):** never pass bare `{role,content}` alone into F-S5. Convert persisted messages with `toCanonicalForRedact` (below) so cookie/shell/code tools hit COMPACT_SENSITIVE_* branches |
| C-D7 | Never return raw `reasoning_content` / cookie bodies / shell dumps; if tool name unresolved after convert → **drop hit** (fail closed) |
| C-D8 | Security: **no L2**; not in high-risk sets; read-only |
| C-D9 | Whitelist: available when `tool_whitelist=null`; when allowlist set, only if listed — **do not** force-inject into all packs |
| C-D10 | Hint (English, one line): `If you need details from omitted turns, call thread_recall with a short query.` Pure builders take `opts.recallHint?: boolean`. **Adapter only** sets `recallHint: true` when `threadManager.isToolAllowed(tid, "thread_recall")`. Never append when allowlist blocks the tool. |
| C-D11 | Audit: `logger.info("thread.recall", { thread_id, hit_count, query_len })` — **no query text, no terms_count, no excerpts** |
| C-D12 | Cross-thread: **forbidden**; `@` refs stay the only cross-thread path |

---

## File map

| File | Change |
|------|--------|
| `companion/src/threads/thread-recall.ts` | **Create:** `searchThreadMessages`, `buildRecallResponse`, caps |
| `companion/src/bridge/tool-definitions-catalog.json` | Add `thread_recall` definition |
| `companion/src/server.ts` | COMPANION_TOOLS + `case "thread_recall"` |
| `companion/src/llm/context-budget.ts` | C-D10 hint on omit / handoff / summary notices |
| `companion/tests/thread-recall.test.ts` | **Create** unit tests |
| Optional: pack allowlists | **none** this wave |

---

### Task 1: Pure search + redact (TDD) — **G5 dual B1 fixed**

```typescript
// thread-recall.ts
export type RecallHit = {
  message_id?: string
  role: string
  score: number
  excerpt: string  // already redacted, ≤ per-hit cap
}

export const RECALL_MAX_HITS_DEFAULT = 5
export const RECALL_MAX_HITS_CAP = 12
export const RECALL_TOTAL_CHARS = 4000
export const RECALL_PER_HIT_CHARS = 600

/** Persisted Message-like (thread-manager shape). */
export type RecallSourceMessage = {
  id?: string
  role: string
  content?: string
  reasoning_content?: string  // NEVER used for excerpt body (C-D7)
  tool_calls?: Array<{
    id?: string
    tool_name?: string
    name?: string
    function?: { name?: string; arguments?: string }
    params?: unknown
    result?: unknown
    arguments?: string
  }>
}

export function tokenizeQuery(q: string): string[]
// whitespace tokens + for each continuous Han run length≥2, add overlapping bigrams

export function scoreMessage(text: string, terms: string[]): number

/**
 * Tool name resolution order (locked): tool_name → name → function?.name
 */
export function resolveToolName(tc: ...): string | null

/**
 * Convert persisted message into CanonicalChatMessage[] for F-S5:
 * - user/system: content only (never reasoning_content)
 * - assistant: content + tool_calls with id + function.name
 * - tool: ALWAYS produce mini list that F-S5 can name-resolve:
 *   1) Prefer real previous assistant with matching tool_calls id
 *   2) Else if resolveToolName(tool_calls[0]) known: **synthesize**
 *      assistant { tool_calls: [{ id, function: { name } }] } + tool { tool_call_id, content }
 *   3) Else return [] → caller drops hit (fail closed — "unresolvable" = F-S5 cannot name)
 */
export function toCanonicalForRedact(
  msg: RecallSourceMessage,
  prevAssistant?: RecallSourceMessage | null,
): CanonicalChatMessage[]

export function redactHitExcerpt(...): string | null
export function searchAndRedact(messages, query, maxHits): RecallHit[]  // single name used by executor
```

**Redact strategy (locked after dual REJECT + R2 Pi):**

1. Score on searchText = role + content + tool names only (not reasoning_content; result dump capped for scoring).  
2. For each top hit: `mini = toCanonicalForRedact(...)`; if empty → drop.  
3. `redactMessagesForCompaction(mini)` then serialize redacted tool/assistant content for excerpt.  
4. Cap per-hit 600; total 4000.  
5. **Never** pass content-only tool mini without id→name pairing (synthetic assistant required for orphans).

- [ ] Tests:  
  - **paired** get_cookies → `[get_cookies: redacted]`  
  - **orphan** get_cookies (no prev assistant) → still redacted via synthetic assistant  
  - shell_exec redacted  
  - no name on tool → hit dropped  
  - CJK bigram; empty query; max_hits; total clamp  

---

### Task 2: Tool catalog + executor

Catalog:

```json
{
  "type": "function",
  "function": {
    "name": "thread_recall",
    "description": "Search the FULL on-disk history of the CURRENT conversation thread for relevant earlier turns (after context compaction dropped them from the model window). Same-thread only. Returns short redacted excerpts. Use a short keyword query (Chinese or English).",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "Short search query (keywords)" },
        "max_hits": { "type": "integer", "description": "1–12, default 5" }
      },
      "required": ["query"]
    }
  }
}
```

`executeCompanionTool`:

```typescript
case "thread_recall": {
  const tid = params.__thread_id
  if (!tid) return { success: false, error: "thread_recall requires active thread" }
  const q = typeof params.query === "string" ? params.query.trim() : ""
  if (!q) return { success: false, error: "query required" }
  if (q.length > 200) return { success: false, error: "query too long (max 200)" }
  const maxHits = clamp(params.max_hits, 1, 12, 5)
  const msgs = threadManager.getMessages(tid)
  const hits = searchAndRedact(msgs, q, maxHits)
  logger.info("thread.recall", { thread_id: tid, hit_count: hits.length, query_len: q.length })
  return { success: true, data: { hits, total_scanned: msgs.length, thread_id: tid } }
}
```

- [ ] Add to COMPANION_TOOLS array  
- [ ] tool-schemas if project validates required args  

---

### Task 3: Compact notice hint (C-D10, dual nits)

```typescript
// context-budget.ts
export const THREAD_RECALL_HINT =
  "If you need details from omitted turns, call thread_recall with a short query."

// buildOmitNotice / buildHandoffNotice / summary branch:
// opts?: { recallHint?: boolean }
// if recallHint: append "\n" + THREAD_RECALL_HINT outside the 2000-char summary body
// (hint not counted against rolling summary slice; notice total still reasonable)
```

**Adapter** (`runContextBudgetPass`): after attaching omit/handoff notice, if  
`threadManager.isToolAllowed(threadId, "thread_recall")`  
re-attach with `recallHint: true` (or pass flag into build*).  
If whitelist blocks tool → **no hint** (Pi nit).

---

### Task 4: Verify + dual

```bash
cd companion && npx tsc -p tsconfig.test.json
node --test .test-dist/tests/thread-recall.test.js .test-dist/tests/context-budget.test.js
```

Then dual-external-review on impl.

---

## Explicit non-goals

- Vector / embedding index  
- Cross-thread search  
- Auto-inject search results into every turn  
- UI chrome for recall (tool-only)  
- Changing Digest / Export  
- Force-adding tool to every pack allowlist  

---

## Success criteria

1. LLM can call `thread_recall` after compact and get redacted hits from dropped era  
2. Cannot target another thread id via params  
3. Cookie/shell-shaped tool payloads redacted in hits  
4. dual APPROVE*  
5. No new Trust surface  

---

## Workflow log

| Gate | Status |
|------|--------|
| Wave A/B | MERGED #134 |
| G5 Wave C plan dual | **REJECT×2** (R2 redact) · patched synthetic assistant |
| G5b plan re-dual | Claude APPROVE_WITH_NITS / Pi REJECT orphan path → plan locked synthetic |
| G6 Wave C impl dual | **both APPROVE_WITH_NITS** (`wave-c-thread-recall-impl-verdict-20260807-115545`) · tests 22 green |

## G5 dual nits absorbed

| Source | Item | Disposition |
|--------|------|-------------|
| Claude+Pi B1/R2 | bare {role,content} breaks F-S5 tool name map | **C-D6 rewrite + toCanonicalForRedact** |
| Claude N1 / Pi N1 | CJK whitespace | bigrams in tokenizeQuery |
| Pi N2 | hint when tool not allowed | adapter gates recallHint |
| Claude N4 / Pi N3 | hint wording drift | unified THREAD_RECALL_HINT |
| Claude N2 | total vs per-hit math | documented intentional |
| Pi N4 | zod schema | optional Task 2b if cheap; executor still validates |
| Claude N3 | tool_call_id in type | RecallSourceMessage expanded |
