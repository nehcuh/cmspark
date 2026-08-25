Review complete. Here is my assessment.

# Dual review — knowledge-honesty-wave0b1 (Wave 0b + Wave 1)

**Evidence levels:** `[executed]` = ran it; `[inspected]` = read code path.

## Patch freshness `[executed]`
Extracted the code section of `knowledge-honesty-wave0b1-diff-20260825-111451.patch` (lines 78–1844) and byte-compared against a fresh `git diff HEAD -- companion/src chrome-extension/src companion/tests` — **identical**. Patch is not stale. (The apparent duplication later in the file is nested `.patch` doc artifacts.)

## Tests `[executed]`
- `companion` doc-identity + skill-engine + skills: **151 pass / 0 fail**
- `chrome-extension` full suite: **817 pass / 0 fail**
- `companion` `tsc --noEmit`: clean

## DoD verification

**Wave 0b** `[inspected + executed via tests]`
- Preview-before-persist: `knowledge.preview` → `previewKnowledge` (skill-engine.ts:1358) is a pure string transform; test asserts directory unchanged. All three UI import paths (file/URL/chat-attachment card) now send `knowledge.preview` first; only `ChatView.tsx:624` sends `knowledge.import`, from the confirm modal with `user_gesture: true` + `pin_thread_id` handled at message-router.ts:2610-2628.
- F-S-4: `allowlistKnowledgeFrontmatter` (skill-engine.ts:1430) keeps only description/type/site/tags; `validateWildcardPattern` rejects public-suffix wildcards (`*.com`); `entries` dropped — test locks both.
- `parseFile` reused in `loadKnowledgePayload` — no second parser.
- Overlay: `summoner-web.ts` has **zero** `knowledge.*` matches → **R2 pass**.

**Wave 1** `[inspected + executed]`
- Ledger built companion-side in `pushKnowledge` (skill-engine.ts) at prompt-build time; heading is `## Knowledge: {title} [{id}]`. Safety-guard skills are pushed directly (`parts.push`, skill-engine.ts:661-666) and correctly stay **out** of the ledger.
- `chat.done` carries `retrieved_sources` (adapter.ts:1127); persisted on the final no-tool-call turn (`assistantMsg` is the tool_calls array, adapter.ts:1049/1054) → 1:1 with the reply. Hydration (`sanitizeHydratedMessages`, useWebSocket.ts:153-164) spreads messages through, so chips survive thread reload. **R3 pass** — the model never authors the field.
- Sanitization on all four retrieval paths: RAG (740), truncate (747), entries (778), searchKnowledge (1550) — tests cover each. No `query_knowledge` tool anywhere `[executed grep]`.

**ADR-020 checklist**: declaration present; knowledge hangs on Composition; L0-only surface; no new runtime/confirm dialect; trust unchanged (no auto_approve/originWs/god-mode touch); no Project/graph/taxonomy entities → **R4/R5 pass**; no false tests found → **R1 pass**.

## Nits (non-blocking)

1. **`ws/validate.ts:1056-1062`** — `knowledge.import` validator accepts `m.path` but the error string (and `loadKnowledgePayload`, message-router.ts:363) omits `path`; a path-only message validates then errors in the router. Fail-closed and pre-existing shape, but the validator/error disagree.
2. **Preview error UX** — if `knowledge.preview` fails (bad URL/parse), the generic `{type:"error"}` response never clears `knowledgePreview`, leaving the modal stuck at「正在解析…」until manual cancel (ChatView `KnowledgeImportModal` / useWebSocket.ts:1606).
3. **Missing extension-side chip test** — spec §6 test-plan row「扩展组件测芯片 ⊆ ledger」is unimplemented. Companion-side ledger-subset test exists (skill-engine.test.ts:769) and chips render only from `msg.retrieved_sources`, so the property is structural — but the spec's own test item is unfulfilled.
4. **`skill-engine.ts:1402-1404`** — legacy same-name re-import does `taken.delete(preferred)` and overwrites the existing file in place. Preserves pre-wave behavior and only for an identical legacy id, but F-I-5's literal「禁止静默覆盖」suggests a follow-up (overwrite confirm or versioning).
5. **`useWebSocket.ts:378`** — `if (doneThreadId && (content || reasoning))` drops a chat.done with empty content+reasoning even when `retrieved_sources` is non-empty (persisted companion-side; UI chips lost in that edge).
6. **`skill-engine.test.ts:784`** — `!retrieved_sources.some(s => s.title === "fake-invented.md")` is vacuous (nothing ever adds that title); the real guarantee is the structural one. Weaken or drop.
7. **`config.ts:1391`** — `getConfigDir()` reads live `CMSPARK_DATA_DIR` while `DATA_DIR` (still imported directly elsewhere, e.g. message-router.ts:30) is captured at import time; only tests mutate it mid-process, but the two sources can diverge.

VERDICT: APPROVE_WITH_NITS
