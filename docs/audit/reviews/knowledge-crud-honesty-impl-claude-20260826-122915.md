# Dual review — Knowledge CRUD Honesty (Wave 3 implementation)

## Patch currency

`docs/audit/reviews/knowledge-crud-honesty-impl-diff-20260826-122915.patch` embeds the diff twice (staged + combined); the combined copy is **byte-identical** to live `git diff HEAD` against a64744b. Not stale. Unstaged tree is empty.

## Machine (re-ran everything, fresh)

| Check | Result |
|---|---|
| companion `tsc -p tsconfig.test.json` | pass `[executed]` |
| node --test: knowledge-crud · knowledge-crud-ws · knowledge-related · summoner-acl · summoner-web | 57/57 pass `[executed]` |
| node --test: single/files.test.js (router tests) | 73/73 pass `[executed]` |
| chrome-extension `tsc --noEmit` / `npm test` | pass / 819/819 pass `[executed]` — matches claim |
| `computer-uia-watch` failures seen when the runner swept the full suite | reproduce at HEAD in a clean worktree → pre-existing, unrelated to this diff `[executed]` |

## Premise + rejection gates

- **R1 (overlay ACL)**: clean. `SUMMONER_ALLOW` has only `knowledge.list` + `knowledge.set_active` (summoner-acl.ts:41-42); `SUMMONER_WEB_DISPATCH_ALLOW` identical (summoner-web.ts:36-37); router re-denies get/update/export/delete/import_directory for `stampedSurface === "summoner"` (handlers/knowledge.ts:29, message-router.ts:2674, delete case). `has(...) === false` locked in three test files (summoner-acl.test.ts:31-33, summoner-web.test.ts:414-416, knowledge-crud-ws.test.ts:24-28). Surface stamp is server-side S20 (message-router.ts:396), not spoofable. `[inspected]`
- **R2 (graph/embedding)**: none. `allowlistKnowledgeFrontmatter` (skill-engine.ts:1557-1571) only emits description/type/site/tags — no `relations:`, no persisted edges; related computed per-request from the existing algorithm (knowledge-related.ts `attachRelatedTitles`), and stripped for summoner list with router test coverage.
- **R3 (id realloc)**: `updateKnowledge` writes the same `skill.source_file` via `writeRestrictedFile` (0o600, symlink-refusing — doc-identity.ts:125-141); no `allocateDocIdentity` on the update path; `data.name = skill.name`, `data.id = ident` (skill-engine.ts:1460-1461). CJK-title test locks id + filenameStem + no `notes-2`; legacy-name divergence test locks the adversary's fold. `[inspected + executed]`
- **R4 (HTML sink)**: no `dangerouslySetInnerHTML`/`innerHTML` in the touched UI; body renders via `<textarea>`/`<pre>` only. `[inspected]`
- **R5 (vault write)**: export → `redactSecrets` server-side, `redacted_hits` returned, 512KiB refuse with spec-exact error text; client does Blob + `TextEncoder` download (useWebSocket.ts `knowledge.exported`), companion never writes host paths. `[inspected]`
- **R6 (false claims)**: none found — all prompt claims reproduced.
- **R7 (empty shell)**: reader is real — row click / 「本轮附带」chip / related chips all issue `knowledge.get` → sheet with title/tags/description/body + confirm-gated save.
- user_gesture belt: validate.ts (update/export/delete/import_directory) **plus** router re-check (handlers/knowledge.ts:31-33, delete case) — the adversary's fold is present with router-level tests.
- `exportSkill` rejects knowledge ids (skill-engine.ts:897) and `exportKnowledge` rejects skill ids (1473); both tested.
- `getKnowledge` is called only from the WS handler — never wired into model context; body is raw for the editor.
- Banned-noun scan (F-UX-NOUN-1) over **added** lines: zero hits; README fold confirmed. The standalone 「相关」button is gone; related chips ≤3; download labeled 「下载 .md」; 512KiB disable + hint present; import_directory validate no longer requires `path`.
- ADR-020: capability declaration present and honest (L0 surface, compose-only, no new trust/confirm family/runtime). Diff scope is knowledge-CRUD only; set_active id-or-name known-set is Wave-3 item 3, in scope.

## Nits (non-blocking)

1. F-S-16 letter: `getKnowledge` has no >6MiB disk-file rejection — it truncates at the 512KiB wire cap; only `updateKnowledge` enforces the 6MiB cap. Wire stays bounded, so impact is nil.
2. `tooBigToExport` compares `char_count > 512*1024` (chars vs bytes — CJK under-counts). Harmless since server `truncated` is byte-based and the server refuses oversize export anyway.
3. Reader sheet is an inline bottom-sheet, not the existing `Modal`/`KnowledgeImportModal` chrome (F-UX-SHEET-1 letter) — adversary residual.
4. No extension-side unit test that delete/update runtime payloads carry `id` + `user_gesture` — adversary residual.
5. Backdrop click closes the editor and silently discards unsaved edits (no confirm on close-with-dirty-state).
6. `types.ts:459` union `"site_knowledge" | "domain_knowledge" | string` collapses to `string` — cosmetic type weakening.
7. background/index.ts delete relay keeps `message.id || message.name` fallback; companion validate still requires the `id` field so legacy WS payloads fail by design — compat shim only.
8. Byte-boundary truncation (`subarray(...).toString("utf8")`) can emit U+FFFD at the tail of truncated bodies.
9. summoner-acl deny-loop test lists get/update/export but not `knowledge.delete` (structurally covered by allowlist absence + router deny).

VERDICT: APPROVE_WITH_NITS
