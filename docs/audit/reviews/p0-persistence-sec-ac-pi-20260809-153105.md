Review complete. Summary of my independent verification:

**Patch integrity**: patch file matches working-tree diff for `adapter.ts` + `thread-manager.ts` exactly. Note: working tree also carries concurrent, out-of-scope SEC-B edits (`message-router.ts`, `server.ts`) not in this patch — the 4 current `tsc` errors live there, not in this batch's files.

**SEC-A (path escape)** — complete. Every `threadFilePath` caller is guarded: `create()` (sanitizeId), `delete()` (isSafeThreadId), `getMessages`/`updateMessage`/`deleteMessagesFrom` (early return), `addMessage` (assertSafeThreadId throws), `purgeExpiredTrash` (throw inside try). No other module in `companion/src` builds thread file paths directly (grep verified). Double guard (regex + `path.relative` escape check) is belt-and-braces.

**SEC-C (redaction)** — verified parity with `history/store.ts`:
- Cookies: metadata kept, `value` → hash; tools return objects/arrays only (verified `chrome.cookies.getAll/set` in browser-bridge.ts:1319-1352).
- Code/shell: params `code/expression/security_token/command/body` hashed — superset of history.db's keys; result data >200 chars collapsed; error capped at 200 (history.db stores the raw error, so this is strictly better).
- host_computer, thread_recall, MCP: equivalent policies (identical regexes for MCP).
- Benign tools pass through untouched — multi-turn rebuild verified via test (get_page_text persists).

**DoD 4 (in-flight raw)** — confirmed: persisted path at adapter.ts:1140/1277 goes through `createToolResultMessage`; in-flight `toolResults` at adapter.ts:1258-1264 uses raw `JSON.stringify(toolResult)`.

**Machine evidence** — reproduced: 38 pass / 0 fail on the three test files. New tests cover traversal ids, config.json protection, cookie/evaluate/MCP redaction, benign passthrough.

**ADR-020** — declaration present and accurate; no new Surface/tools/gates/confirms; trust monotonic (fail-closed + stricter persistence); originWs genuinely N/A. No scope creep.

Non-blocking nits:

1. **`companion/src/security/tool-persistence-redact.ts:68`** — `redactCookieData` returns non-object/array `data` unchanged (raw passthrough), while history.db (`redactCookieSummary`, store.ts:233-235) blanks such summaries. Unreachable today (cookie tools only return objects/arrays) but a future tool returning `data` as a JSON string would leak cookie values to disk — cheap to mirror history's blank-on-non-object behavior. Also untested.
2. **tool-persistence-redact.ts:200-201** — code-tool `error` is capped at 200 chars but not hashed; an evaluate/shell error that echoes the executed code body (e.g. SyntaxError) persists a truncated code fragment. Better than history.db (raw error), but hashing would be strict parity with the params handling.
3. **No backfill** — pre-existing `threads/*.json` written before this fix still contain unredacted cookie/shell tapes (history.db self-purges at 30d; thread files don't). T3 blast tier justifies a follow-up scrub/migration; DoD doesn't require it, so non-blocking.
4. **Test gaps** — no tests for `updateMessage`/`deleteMessagesFrom` unsafe-id no-op, `purgeExpiredTrash` with a poisoned index, or direct `host_computer`/`thread_recall` redaction; minor.
5. **Cosmetic** — existing thread digests go stale after upgrade (fingerprints computed over raw vs now-redacted content) and regenerate on next open; self-healing, no action needed.

VERDICT: APPROVE_WITH_NITS
