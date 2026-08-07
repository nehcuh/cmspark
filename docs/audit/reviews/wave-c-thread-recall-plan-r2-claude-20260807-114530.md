I verified the patch is current (`HEAD=06c05dc`, plan file mtime 11:45:11 < patch mtime 11:45:30; plan file untracked, so the patch content is the plan itself), read the patched plan, both prior REJECT reviews, the F-S5 redact code in `context-budget.ts`, the persisted Message shape (`thread-manager.ts:170-179`), `createToolResultMessage` (`adapter.ts:136-147`), `__thread_id` injection (`adapter.ts:984-985`), and `isToolAllowed` (`thread-manager.ts:789-806`).

## Verdict analysis

### Capability declaration (ADR-020)

`Surface: L0 read-only`, `L2-classes: (none)`, `Compose: none`, `Autonomy: n/a — single-thread only`, `Trust: no elevation; F-S5 redact on output`, `Channel: community | enterprise unchanged`. All six axes declared. No new Side Panel chrome (explicit non-goal). No new confirm family, no originWs regression, no new runtime. Pack-first respected (C-D9 honors `tool_whitelist`). ✓

### Rejection gates

**R1 (cross-thread):** `__thread_id` is injected **after** `...params` spread at `companion/src/llm/adapter.ts:984-985`, so a caller-supplied foreign id is overwritten. C-D2 + C-D12 lock scope. Catalog schema (Task 2) declares only `query`/`max_hits`; executor hard-rejects missing `__thread_id`. **PASS.**

**R2 (bare content-only mini messages → F-S5 bypass):** This was the prior REJECT (both reviewers). Plan now specifies:
- `RecallSourceMessage` type carries `tool_calls[].id` / `tool_name` / `name` / `function.name` (lines 80-88)
- `toCanonicalForRedact(msg, prevAssistant?)` returns `CanonicalChatMessage[]` preserving tool identity (id + function.name)
- Redact strategy step 2 builds mini list `[paired assistant with tool_calls if found, tool msg with tool_call_id set]`
- Test "bare `{role,content}` path is **not** used" explicitly verifies B1 fix
- C-D7 fail-closed: unresolvable sensitive tool → drop hit

**PASS** — the conversion layer is concrete enough to engage `COMPACT_SENSITIVE_COOKIE_TOOLS` (`context-budget.ts:19-24`) and `COMPACT_SENSITIVE_CODE_TOOLS` (`context-budget.ts:27-37`).

**R3 (Trust elevation):** C-D8 explicitly no L2, read-only. **PASS.**

**R4 (Logs query/excerpts):** C-D11 logs `{ thread_id, hit_count, query_len }` — explicitly excludes query text, terms_count, excerpts. **PASS.**

### Prior nits absorbed

- CJK bigrams in `tokenizeQuery` (C-D4) — addresses N1 ✓
- Hint gated by `isToolAllowed` in adapter, not unconditional (C-D10 final form) — addresses Pi-N2 / Claude-N2 ✓
- Unified `THREAD_RECALL_HINT` constant — addresses N4 ✓
- `RecallSourceMessage` expanded with `tool_call_id` / `tool_name` / `function.name` paths — addresses N3 ✓
- Char math (total clamp dominates ≥7 hits) documented intentional — addresses N2 ✓

### Nits (non-blocking)

**N1. `toCanonicalForRedact` no-prevAssistant path is under-specified.** `docs/superpowers/plans/2026-08-07-wave-c-thread-recall.md:96-106, 118-127`. When a tool hit has no paired assistant in the window (orphaned/orphan-history case), the description "set tool_call_id from `tool_calls[0].id`" alone does NOT populate `idToName` — `redactMessagesForCompaction` would resolve `name="tool"` and skip `COMPACT_SENSITIVE_*`. The test "cookie tool result (get_cookies shape) → excerpt is `[get_cookies: redacted]`" only passes if the implementation either (a) synthesizes an assistant with `tool_calls=[{id, function:{name: tool_name}}]` from the tool msg's own `tool_calls[0].tool_name`, or (b) does a direct name-set check before calling F-S5. C-D7's fail-closed covers the unsafe case, but the implementer could naively produce `[tool msg]` only and rely on the post-hoc "heuristic optional" check. Make the canonicalization rule explicit: synthesize the paired assistant when missing.

**N2. "heuristic optional" wording in C-D6 step 2 (line 125).** "if tool name was in COMPACT_SENSITIVE_* and redacted content still looks like raw JSON cookies (heuristic optional) — prefer fail-closed drop." Either commit to the post-redact classifier (defense-in-depth) or remove it; "optional" invites skip. C-D7's name-resolution drop is the load-bearing gate; the optional heuristic adds ambiguity without forcing a decision.

**N3. `RecallSourceMessage.tool_calls[]` resolution order.** Lines 80-88 list `tool_name` / `name` / `function.name` as candidate name sources without stating precedence. Persisted assistant msgs use `function.name`; persisted tool msgs use `tool_name` (via `createToolResultMessage:143`). State the resolution order (`tool_name` → `name` → `function?.name`) so implementers don't guess.

**N4. R2-file mismatch nit (carry from prior):** Plan still describes the recall response total cap as **4000 chars** (C-D5) but `searchAndRedact` is referenced once in Task 2 (line 171) without being declared in Task 1's exports. Minor — implementer will define it; just call it `buildRecallResponse` consistently with Task 1's `export function buildRecallResponse`.

### ADR-020 P1 watchlist

P1-1 (god-mode): not touched. P1-2 (originWs): no new `securityConfirmations.request`. P1-3 (evaluate integrity): not touched. P1-4 (shell structure): not touched. **No P1 exposure.**

VERDICT: APPROVE_WITH_NITS
