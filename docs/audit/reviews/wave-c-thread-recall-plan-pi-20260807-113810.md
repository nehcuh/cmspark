Review complete. I verified the patch is current (`HEAD=06c05dc`, plan file untracked — genuine pre-code plan gate), read the plan, parent analysis, all grounding files, and traced the actual data flow.

---

## VERDICT ANALYSIS

### R1–R5 gate results

- **R1 (cross-thread)** — **PASS.** `__thread_id` is injected server-side *after* `...params` spread (`companion/src/llm/adapter.ts:984-985`), so a caller-supplied foreign id is overwritten, not honored. Catalog schema (Task 2) declares only `query`/`max_hits`; executor reads only `__thread_id` and hard-rejects missing. Even a synthetic `outbound_mcp:<caller>` id falls through `getMessages` → file miss → `[]` (thread-manager.ts:729-736).
- **R2 (redact cookie/shell payloads)** — **FAIL (blocking).** See below.
- **R3 (no L2 / no Trust elevation)** — PASS. L0 read-only; `COMPANION_TOOLS` execution path needs no L2; `isToolAllowed` gate applies (server.ts:760).
- **R4 (no embedding)** — PASS. Whitespace keyword scoring only.
- **R5 (no query/excerpt logging)** — PASS. `logger.info("thread.recall", { thread_id, hit_count, query_len })` — no query text, no excerpts.

### BLOCKING: C-D6 / Task 1 redact strategy cannot engage F-S5 sensitive-tool branches

The locked redact path says: *"map hits → mini CanonicalChatMessage list … build `{role, content: excerptRaw}` messages, run `redactMessagesForCompaction`"* (C-D6; Task 1 redact strategy step 2). This mechanism is structurally incapable of redacting cookie/shell tool payloads:

1. **Persisted tool messages carry no `tool_call_id`.** `createToolResultMessage` stores `{ role: "tool", content: JSON.stringify(result), tool_calls: [{ id, tool_name, params, result }] }` (`companion/src/llm/adapter.ts:136-147`); the `Message` interface has no `tool_call_id` field (`companion/src/threads/thread-manager.ts:170-179`).
2. **F-S5 keys tool identity off `tool_call_id`.** `redactMessagesForCompaction` builds `idToName` from assistant `m.tool_calls[].id` and matches via `m.tool_call_id` (`companion/src/llm/context-budget.ts:151-158, 169-170`).
3. **Result:** persisted tool messages fall to the default branch (`context-budget.ts:193-198`), which applies only `scrubSecretPatterns` (sk-/Bearer/PEM regex, `context-budget.ts:38,135`). Raw `get_cookies`/`list_all_cookies`/`shell_exec`/`evaluate` bodies — the exact payloads C-D7 and success criterion #3 forbid returning — pass through into excerpts.

The plan's own test *"redaction strips cookie tool shapes if present"* cannot pass as specified. A faithful implementation of the locked strategy leaks tool payloads.

**Fix directive:** specify a conversion layer before F-S5 — reuse the existing `rebuildMessagesFromHistory` (`adapter.ts:160+`) to canonicalize persisted messages (or map `tool_calls[0].id` → `tool_call_id` and include the paired assistant `tool_calls` in the mini list), so the `COMPACT_SENSITIVE_COOKIE_TOOLS`/`COMPACT_SENSITIVE_CODE_TOOLS` branches engage; alternatively add a recall-side classifier that drops any hit whose embedded tool name is in the sensitive sets. Add a test for unresolvable tool identity → drop the hit rather than pass it through the default branch.

### Nits (for revision)

1. **CJK tokenization** — whitespace-split yields a single term for Chinese queries; the tool description explicitly offers Chinese, yet recall degrades to full-phrase containment. Suggest punctuation split + char-bigram fallback, or scope this explicitly. (Test "scoring prefers multi-term" implicitly assumes whitespace-separable terms.)
2. **C-D10 hint vs C-D9 allowlists** — the hint is appended unconditionally in `buildOmitNotice`/`buildHandoffNotice`, but pack allowlists may exclude `thread_recall`; the model would be told to call a blocked tool. Gate on `threadManager.isToolAllowed(tid, "thread_recall")`.
3. **Wording drift** — C-D10: "If you need dropped details…" vs Task 3: "If you need details from omitted turns…". Unify.
4. **No zod schema registered** — `tryParseToolArgs` falls back to `GENERIC_FALLBACK` (`tool-schemas.ts:287,354-361`), so catalog `required: ["query"]` isn't enforced at the arg-validation layer. Executor-level checks cover it, but a registered schema is cheap and consistent.
5. **Global catalog cost** — adding the definition to `tool-definitions-catalog.json` puts it in every thread's toolset (~constant per-turn token cost pre-compaction). Same as other companion tools, so acceptable — worth a note in success criteria.

### ADR-020 checklist

- Declaration present and complete (Surface L0 / L2-classes none / Compose none / Autonomy n/a / Trust no elevation / Channel unchanged) — **OK**.
- Axes fit: correct L0 companion tool; no "中层 Agent" conflation — **OK**.
- Pack-first: no new primary Side Panel chrome (explicit non-goal); C-D9 respects pack whitelists — **OK**.
- Confirm dialects / originWs / new runtime: none introduced — **OK**.
- Trust monotonicity: no elevation; output redaction *intended* — blocked by the R2 gap above.

### Must-answer

1. Keyword score vs BM25: **adequate** for short LLM queries over one thread; BM25 (idf/length-normalization) is overkill. CJK tokenization is the real quality gap (nit 1).
2. C-D9 whitelist stance: **OK** — consistent with `isToolAllowed`, no force-inject.
3. Notice hint spam: **low risk** — one sticky notice, deduped via `isOmitNotice` (`context-budget.ts:119`), conditional phrasing, bounded cost (≤12 hits, 4000 chars, one disk read).
4. Implementable without invention: **yes, once the R2 conversion layer is specified** — `rebuildMessagesFromHistory` already exists; no new machinery needed.

---

VERDICT: REJECT
