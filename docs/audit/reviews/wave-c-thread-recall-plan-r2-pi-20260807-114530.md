The r2-pi review file is an empty stub — I'll write my independent review there and print it here. I now have everything verified.

---

# Pi review — Wave C `thread_recall` plan R2 (post-REJECT fix)

**Verified current:** plan mtime 11:45:11 < patch mtime 11:45:30, HEAD=`06c05dc`; plan is untracked so the patch carries no code diff — the plan itself is the artifact. Read: plan, both R1 REJECT reviews, `context-budget.ts` (F-S5), `adapter.ts` (`createToolResultMessage` @136-147, StreamToolCall persist @731-734/829-833, `__thread_id` injection @985), `server.ts` dispatch + `isToolAllowed` (@thread-manager.ts:789-806), whitelist schema filter (@adapter.ts:479-484).

## Gates

- **R2 cross-thread: PASS.** `__thread_id` is injected *after* the params spread (`adapter.ts:985`), overwriting any model-supplied value; propagates via `finalParams` (`server.ts:697`) into `executeCompanionTool`; executor hard-rejects missing tid. Catalog declares only `query`/`max_hits`.
- **R3 trust: PASS.** C-D8 no L2, read-only, not in high-risk sets; no elevation anywhere.
- **R4 logs: PASS.** C-D11 logs `{thread_id, hit_count, query_len}` only — no query text, terms, or excerpts.
- **C-D4 CJK: PASS.** Overlapping bigrams for Han runs ≥2; "登录" matches "用户登录失败" (bigram set contains 登录). Test specified.
- **C-D10 hint: PASS.** Final locked form gates via adapter `isToolAllowed(tid,"thread_recall")`; `isToolAllowed` returns true on `whitelist===null`; whitelist schema filter also removes the tool from LLM-visible set when excluded (no force-inject, C-D9).
- **ADR-020:** Full six-axis declaration; L0 tool on Surface axis (no bare "中层 Agent"), Pack-first honored, no confirm family / originWs / new runtime / UI chrome; P1 watchlist untouched. No blocking checklist issue.

## BLOCKING — R1 is not fully closed: orphaned tool rows still route sensitive payloads through F-S5's generic branch

The paired path is genuinely fixed (persisted assistant `tool_calls` are StreamToolCall `{id, function:{name}}` — exactly what F-S5's `idToName` reads at `context-budget.ts:149-155` — and tool rows carry the same `id` via `createToolResultMessage`), and the cookie/shell tests would pass for it. But the plan specifies a leak path for unpaired tool rows:

1. **Plan line 122**: "require `tool_calls[0].tool_name` … **or** paired assistant" — the `OR` means a persisted tool row with its own `tool_name` passes the gate with **no assistant in the mini list**. Mini list = `[tool msg]` only.
2. F-S5 then builds `idToName` from assistant rows only → `name = "tool"` → not in `COMPACT_SENSITIVE_COOKIE_TOOLS`/`CODE_TOOLS` (`context-budget.ts:19-37`) → **generic branch** (`context-budget.ts:164-165`) returns `scrubSecretPatterns(content.slice(0,400))`. `SECRET_BODY_RE` matches only `sk-`/Bearer/PEM — cookie JSON (`{"cookies":[{"name":"session","value":…}]}`) passes through unredacted into the excerpt.
3. **Plan line 127** — the fail-closed drop fires only on "`role===tool` **and no name**". Persisted tool rows always carry `tool_name` (`createToolResultMessage` sets it unconditionally, `adapter.ts:143`), so the drop **never fires for real data**.
4. **Plan line 125** — the only safety net for this case (post-redact "looks like raw JSON cookies") is explicitly marked "(heuristic **optional**)".
5. Orphaned tool rows are acknowledged real data in the codebase: `adapter.ts:164-166` ("Unpaired role=tool rows (orphan tool_call_id not in the open set) are skipped") — and cold-archive search targets exactly this legacy disk history.

Net: C-D7's stated intent ("fail closed if tool name unresolved after convert", plan line 35/124) is defeated by the plan's own operational definition of "unresolvable" (= "no name"), which does not match F-S5's actual resolution mechanism (id→name pairing via the assistant row). This reproduces R1's core failure — sensitive tool payload through a content-only mini message with unresolvable tool identity — for the orphan class.

**Fix (one sentence, then tests):** in `redactHitExcerpt`, when a tool hit has no paired assistant, synthesize `{role:"assistant", tool_calls:[{id: <tool_call_id>, function:{name: <tool_name>}}]}` so F-S5 resolves the real name (or check `tool_name` against `COMPACT_SENSITIVE_*` directly and redact/drop); make step 4's "unresolvable" mean "not resolvable by F-S5", not "no name"; delete the "optional" heuristic wording; add a test for an orphaned `get_cookies` row.

## Nits (non-blocking)

- Task 1 exports `searchThreadMessages`/`buildRecallResponse` but Task 2's executor calls `searchAndRedact` (plan line ~171) — pick one name.
- C-D10 still contains the superseded "if adapter cannot cheaply check allowlist, still append" fallback contradicting the final "Revised" gating (plan line ~40) — the final form wins; delete the stale fallback text.
- `RecallSourceMessage.tool_calls[]` lists `tool_name`/`name`/`function.name` without precedence — state `tool_name → name → function?.name`.

The primary B1 path is fixed and every other gate holds; the plan is one explicit rule + one test away from being implementable. As written it fails the R1 gate for orphaned sensitive tool rows, so:

VERDICT: REJECT
