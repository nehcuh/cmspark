# Dual review: post-#191 merge review-fix batch (post-implementation verification)

**Stage:** Fixes ALREADY IMPLEMENTED in the working tree (uncommitted) — verify completeness + correctness
**Date:** 2026-08-18
**Repo:** CMspark (`C:/Users/HuChen/Projects/cmspark`)
**Batch id:** `post191-review-fixes`
**You are:** an independent read-only reviewer. Do NOT edit any file. Do NOT run tests (they are green; just read them). Use `git diff` / `git status` and file reads only.

## Context

Main `750cf41..2e7751a` (clipboard image paste + thread hygiene + companion-canon sidepanel) was reviewed by 6 adversarial lanes → synthesis at `docs/audit/reviews/post191-merge-multidomain-review-synthesis-20260818.md` (read it first). 9 P2 findings (F1–F10, F4=P3 deferred) were then fixed in 3 parallel batches. All fixes are **uncommitted working-tree changes** — review them with `git diff` (tracked files) and by reading the one new untracked test file `companion/tests/file-upload-sidecar-keep.test.ts`.

**Ignore these pre-existing unrelated working-tree changes:** `companion/scripts/run-esbuild-bundle.mjs`, `scripts/tests/test-package-gates.sh`, `.tmp-*`, `docs/audit/reviews/*.patch`.

## The fixes to verify (claimed state)

| ID | Claim | Key locations |
|----|-------|---------------|
| F1 | `chat.user` echo carries optional `client_message_id`; extension adopts persisted id onto the optimistic bubble by EXACT id match, append on no-match, legacy last-temp adopt only when field absent. Full chain: `chrome-extension/src/background/index.ts` (sends `clientMessageId` on chat.create ×2 + file.upload) → `companion/src/message-router.ts` (pass-through at BOTH chat.create ~:444 and file.upload ~:853) → `companion/src/llm/adapter.ts` (echo ~:400) → `useWebSocket.ts` (parse) → `agentStore.tsx` `reduceAddMessage` (precise adopt) | as listed |
| F2 | Upload optimistic bubble restored in `App.tsx` (~:1236); temp id == clientMessageId sent with file.upload | `App.tsx`, `background/index.ts` |
| F3 | `BUMP_COMPOSER_UPLOAD_CLEAR` dispatched BEFORE the `shouldApplyStreamEvent` thread gate | `useWebSocket.ts` ~:1691, new `fileUploadedEffects` |
| F5 | Mixed-batch ingest errors accumulate (`loopErr`) into `nextFileErrorAfterIngest`, priority capErr > refuse > loopErr | `App.tsx` `addIncomingFiles`, `utils/image-compose.ts` |
| F6 | Frame-budget refusal deduped to a single correct error bubble via `isFrameBudgetRefusal` | `background/ws-frame-budget.ts`, `App.tsx` ~:1292 |
| F7 | `deleteSidecarsForMessages` dir-scan fallback parses each name and exact-compares `msgId` (no `startsWith` prefix match) | `companion/src/threads/image-sidecar.ts` ~:279 |
| F8 | Windows test guards: symlink cases use junction (behavior assertions kept), POSIX mode-bit assertions skipped on win32 | `companion/tests/thread-image-sidecar.test.ts` |
| F9 | chatCreate catch only deletes sidecars when the reserved user message was NOT persisted | `companion/src/message-router.ts` ~:865 |
| F10 | Provisional-alias derivation unified into one shared `aliasFromFirstUserText` (alias-commit.ts); `classifyAlias`, `digest.ts` (re-export), `adapter.ts provisionalTitleFromUserText` all use it | `alias-commit.ts`, `digest.ts`, `adapter.ts` |

**Known accepted behavior changes:** immediate title length 16→17 chars (unified with batch); `aliasFromFirstUserText` default maxLen 40→16 (grep-verified no dependents).

**Test state (already run, do not re-run):** chrome-extension 722/722 (`npm test`); companion affected files 59/59 (tsc -p tsconfig.test.json + node --test); thread-image-sidecar 11/11 on Windows.

## Must answer

1. Walk the F1 contract end-to-end in the actual code. Does every link exist and match types (`clientMessageId` camelCase on the wire request, `client_message_id` snake_case in echo)? Any path (chat.create / file.upload) that drops it?
2. Is each of F1–F10 actually, correctly fixed — or is any fix superficial, mismatched to its root cause, or only partially applied?
3. Did the fixes introduce NEW bugs or regressions (protocol compat vs old companion/old extension both directions, behavior changes beyond the accepted two, error-handling holes, React state issues)?
4. Are the new/updated tests REAL (would fail against pre-fix code) and do they cover the claimed contract? Any fix with zero meaningful coverage?
5. Is anything from the synthesis report's P2 list still unfixed or silently dropped?
6. Cross-batch seams: the 3 batches ran in parallel — check the joints (F1 contract between EXT and COMP-chat, F2 optimistic bubble vs F1 adopt, F9 catch vs F1 reservedUserMessageId interplay).
7. What would make you REJECT shipping this batch?

## Rejection gates (any fail → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | F1 chain broken anywhere (field dropped, wrong case, adopt still positional when field present) |
| R2 | New protocol incompatibility: new extension + old companion OR old extension + new companion visibly breaks chat or uploads |
| R3 | F9 inverted: sidecars deleted while the message IS persisted (or kept when NOT persisted → orphans) |
| R4 | Any P2 finding from the synthesis unaddressed without an explicit documented reason |
| R5 | New tests that cannot fail (vacuous) for a claimed fix |

## Output format

- Findings with severity (blocking / nit), `path:line` references.
- Explicit answers to must-answer 1–7.
- Gate checklist R1–R5 PASS/FAIL.
- Final line **exactly** one of:

```text
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
