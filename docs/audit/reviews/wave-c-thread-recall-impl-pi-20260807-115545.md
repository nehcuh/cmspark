Review complete. I inspected the patch file, the working tree (confirmed identical — 86 insertions across 4 tracked files, 2 untracked), the plan, the checklist, and ran the machine gates.

## Gate results

**R1 — Cross-thread via client thread id: PASS.** The adapter injects `__thread_id: threadId` *after* spreading LLM params (`adapter.ts:993`, `{ ...params, tabId, __thread_id: threadId }`), so any model-supplied id is destroyed. Both the executor's `isToolAllowed` hard gate (`server.ts:743`) and the `thread_recall` case (`server.ts:3833`) read only the injected value; missing tid → fail-closed error.

**R2 — Cookie/shell excerpt leaks: PASS.** Every hit routes through `toCanonicalForRedact` → `redactMessagesForCompaction` (F-S5 reuse). The G5 fix is real: orphan tool rows synthesize an assistant declaring the tool's own resolved name (`thread-recall.ts:185-215`), so F-S5's `idToName` maps correctly and `[get_cookies: redacted]` / `[shell_exec: outcome redacted …]` result. Unresolvable name/id → hit dropped (fail closed). Assistant tool_call `arguments` are stripped by F-S5's output shape, so argument-embedded secrets don't leak. Tests pin orphan cookie + paired shell_exec.

**R3 — L2/Trust elevation: PASS.** Read-only same-thread L0 tool; not in any L2/high-risk confirm set; triple-gated (schema filter `adapter.ts:485` + executor `isToolAllowed` + hint gate), so blocked packs get no schema, no execution, no hint — no force-inject (C-D9).

**R4 — Query/excerpts in logs: PASS.** `thread.recall` logs only `thread_id/hit_count/query_len` (`server.ts:3849-3856`); `tool.start` via `summarizeToolParams` logs keys + `thread_id` only (query value not in allowlist); `tool.finish` via `summarizeToolResult` logs `data_keys` only.

**R5 — Tests: PASS.** `npx tsc -p tsconfig.test.json` clean; `node --test thread-recall + context-budget` → **22/22 pass**.

**ADR-020:** Capability declaration complete and accurate (Surface L0 / L2-classes none / Compose none / Autonomy n/a / Trust no-elevation F-S5). Pack-first respected, no new confirm family, no originWs change, no new runtime, trust monotonicity holds.

## Nits (non-blocking)

1. `companion/tests/thread-recall.test.ts` — plan listed `max_hits` clamp and 4000-char total-budget clamp tests; neither is present (only implicit default path exercised).
2. Only orphan get_cookies is tested; a *paired* get_cookies test would pin the exact paired-cookie redaction shape (paired shell_exec covers the branch mechanically, but not the cookie set).
3. Paired-path redaction trusts persisted assistant `function.name` == tool-row `tool_name` for a given id (consistent in-pipeline via `createToolResultMessage`); a comment documenting that assumption would help maintainers — a tampered-disk mismatch would mis-name for F-S5.
4. Informational: the adapter's `historyStore.record` persists the query string + 500-char redacted result_summary for thread_recall like every tool — local same-trust-domain DB, not the audit logger; consistent with C-D11 but worth knowing if stricter audit hygiene is ever desired.

VERDICT: APPROVE_WITH_NITS
