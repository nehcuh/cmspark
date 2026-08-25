Review complete. All checks executed against the real tree, tests run, and patch freshness verified.

## Review summary — knowledge-honesty-wave2

**Patch freshness** `[executed]`: `docs/audit/reviews/knowledge-honesty-wave2-diff-20260825-132009.patch` = header + `git diff HEAD` (byte-identical to the current working tree) + a redundant appended `git diff --cached` copy. Not stale; it fully covers the tree.

**Machine** `[executed]`: `cd companion && npm test` → exit 0; 3541 pass + 20 settings-web, 0 fail (23 skipped). Claim said 3539 — under-claimed by 2, no over-claiming. Wave 2 test files (`distill`, `knowledge-related`, `knowledge-active-ids`, `summoner-web`) verified passing individually.

**DoD / REJECT criteria** `[inspected + executed]`:
- **R1** — Tests are real: `tests/single/files.test.ts:554` asserts `thread.distill_preview` redacts `ghp_` AND knowledge dir file count unchanged; `:580` asserts router cap 3 with 6 candidates; `summoner-web.test.ts:446-456` negatively asserts `knowledge.related` / `thread.distill_preview` / `knowledge.import` on both ACL layers. All can fail.
- **R2** — No ACL growth: `summoner-web.ts:18-33` (HTTP dispatch) and `ws/summoner-acl.ts:12-35` (WS surface ACL) both exclude the new types; overlay page never opens companion WS (CSP `connect-src 'self'`).
- **R3** — `message-router.ts:2052-2069` handler is read-only; distill lands in `SET_KNOWLEDGE_PREVIEW` (`useWebSocket.ts:974`) and persists only via the existing modal's 确认导入 with `user_gesture: true` (`ChatView.tsx:620-633`).
- **R4** — `knowledge-related.ts` is a pure co-tag+TF scorer (no persist, no edges); `topic_folder` is a plain sanitized string (`distill.ts:55-63`, enforced `thread-manager.ts:792-794`); no Project/taxonomy.
- **R5** — No `securityConfirmations` / `auto_approve` / `sidePanel.open` code changes (all diff hits are docs); spec §5 explicitly defers WS-level `user_gesture` enforcement on `knowledge.import` (line 184) and the UI main path carries the gesture.
- **R6** — No banned nouns: `ThreadGraphApp.tsx` renames 关联图谱→相关会话； overlay copy is C-thin（召唤器（实验）· 批准在侧栏 · 去侧栏处理）； Raycast/uTools appear only in the distribution-only doc with explicit no-`ws_secret` prohibitions.

**ADR-020 checklist**: capability declaration present and accurate; Composition+L0 axes fit; no new confirm family (reuses import modal); trust monotonicity untouched; no originWs surface (no new `securityConfirmations.request`); no new runtime; overlay labeled 实验. P1 watchlist untouched.

## Nits (non-blocking)

1. `useWebSocket.ts:1850-1856` + `agentStore.tsx:921-927` — an `error` frame matching `/knowledge|预览|…/i` merges into the preview modal while the reducer **retains the previous `payload`**. With a stale payload present, the modal shows the error text but 确认导入 would import the old content. Gesture intact and content was previously previewed, so minor — but error previews should clear `payload`.
2. `distill.ts:45` — per-message `slice(0, 400)` truncates before redaction; a secret straddling the boundary can survive as a too-short fragment to be useful. Trivial.
3. `message-router.ts:2048` ignores the client `limit` field that `background/index.ts:906` sends — dead wire field; honor it clamped or drop it.
4. `summoner-web.ts:407-466` — `/api/packs`, `/api/packs/apply`, `/api/mcp` endpoints remain after the overlay UI stopped calling them. Pre-existing ACL-gated surface; consider removal in a later slimming pass.
5. Patch artifact bundles a redundant second copy of the staged diff (~8.8k duplicated lines) — reviewers should read only the first `git diff HEAD` half. Process nit.

VERDICT: APPROVE_WITH_NITS
