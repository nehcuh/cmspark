All checks complete. I walked every link of the F1–F10 claims in the actual code, the new test file, and both protocol-compat directions. Here is the review.

---

# Post-#191 Fix-Batch Review — Findings

## Findings

**NIT 1 — Third behavior change not in the accepted list.** `adapter.ts:1513-1515` (`provisionalTitleFromUserText`) now delegates to `aliasFromFirstUserText`, which strips politeness prefixes (`alias-commit.ts:66` — `^(请|帮我|麻烦|请问)[，,\s]*`). The old immediate-title path stripped only `[文件…]`; a title like `请帮我总结文档` now renders `总结文档`. This is consistent with the batch path and clearly the F10 intent, but it is a user-visible title change beyond the two documented accepted changes (16→17 chars, maxLen 40→16) and should be documented.

**NIT 2 — F1 pass-through seams untested directly.** `message-router.ts:444-447` and `:855-858` (`rest.clientMessageId → chatCreate` param) have no unit test; the chain is covered piecemeal (adapter echo tests, reducer adopt tests, background diff). Trivially simple code, low risk — not a gate issue.

**NIT 3 — `fileUploadedEffects` constant branch.** `useWebSocket.ts:107-114` returns `bumpComposerUploadClear: true` unconditionally; only `applyToPanel` varies. Cosmetic over-engineering that makes F3 testable — acceptable.

**NIT 4 — UI-only paths untested directly.** F2 optimistic bubble (`App.tsx:1239-1251`) and the F6 dedupe early-return (`App.tsx:1292-1294`) live in React code with no direct unit test; covered indirectly via reducer tests and the `isFrameBudgetRefusal` marker test.

**NIT 5 (latent, pre-existing pattern)** — temp id `${threadId}_user_${Date.now()}` collides if two sends in the same thread land in the same millisecond (second bubble would `sameIdIdx`-merge into the first, `agentStore.tsx:530`). Pre-existing in the chat.send path; F2 reuses the pattern. No real-world impact at human typing rates.

**Note (not a finding)** — when the persist echo is dropped by the `shouldApplyStreamEvent` gate (`useWebSocket.ts:299`) due to a mid-flight thread switch, the F2 bubble keeps its temp id (never adopted). Cosmetic only; gating is pre-existing.

## Must-answer 1–7

**1. F1 contract end-to-end — every link exists and types match.**
- EXT: `background/index.ts:544,560` (chat.create both send sites) + `:606` (file.upload, conditional) send camelCase `clientMessageId`; SW falls back to `${threadId}_user_${Date.now()}` when absent (`:519-528`). Panel supplies it on both send paths (`App.tsx:1239,1314`).
- COMP: `message-router.ts:444-447` (chat.create) and `:855-858` (file.upload) pass `rest.clientMessageId` (survives the `{type, ...rest}` spread — `msg` is `any`, no strict typing strips it) into `chatCreate`.
- Echo: `adapter.ts:397-401` emits snake_case `client_message_id`, conditionally — omitted when absent.
- EXT parse: `useWebSocket.ts:311-331` reads `msg.client_message_id` onto `Message.client_message_id` (`types.ts:288-293`).
- Adopt: `agentStore.tsx:551-578` — exact match on `m.id === clientMessageId && role==="user" && same thread_id`; no-match → plain append; legacy last-temp adopt (`:581-600`) only when field absent.
- No path drops it: the only other chat.create senders are the quick-action fallback (`background/index.ts:339,346`) with no panel bubble (no adopt needed). **Chain complete.**

**2. Each fix correctly applied.**
- **F1** — correct as walked above; multi-surface race actually resolved (traced panel/Cockpit both-send and out-of-order echo interleavings through the reducer — no cross-adopt, no duplicate).
- **F2** — optimistic upload bubble restored (`App.tsx:1236-1251`); bubble id == `clientMessageId` sent on file.upload; old companion (no echo) leaves the bubble in place (legacy adopt), so the turn never vanishes.
- **F3** — `BUMP_COMPOSER_UPLOAD_CLEAR` dispatched before the `shouldApplyStreamEvent` gate (`useWebSocket.ts:1691-1699`), split into `fileUploadedEffects`.
- **F5** — `firstErr` accumulates the first per-file loop rejection (`App.tsx:1396-1453`); priority capErr > refuse > loopErr (`image-compose.ts:30-41`) exactly as claimed.
- **F6** — `isFrameBudgetRefusal` checks the stamped `diag.over_companion_10mb` (`ws-frame-budget.ts:16-26`); panel early-returns after busy/processing cleanup, before its own bubble (`App.tsx:1286-1294`); SW side already broadcasts the correct `file.upload_error` (`background/index.ts:610-615`).
- **F7** — dir-scan fallback parses each name and exact-compares `parsed.msgId === m.id` (`image-sidecar.ts:280-284`); the `abc`/`abc-1` test would fail pre-fix.
- **F8** — mode-bit asserts guarded `process.platform !== "win32"` (×2); symlink cases use `junction` on win32 (×3 call sites); Node lstat reports junctions as symlinks so the refusal behavior assertions are preserved.
- **F9** — catch deletes sidecars only when `getMessages(thread_id)` lacks `reservedUserMessageId` (`message-router.ts:871-884`) — correct direction, not inverted.
- **F10** — single `aliasFromFirstUserText` in `alias-commit.ts:55` used by `classifyAlias` (`:83`), `digest.ts:91` (re-export), `adapter.ts:1514`; batch_auto_title passes explicit 16 (`message-router.ts:1486`); round-trip tests prove batch-written aliases classify `provisional_user`. Accepted changes verified: title length 16→17; maxLen default 40→16, grep confirms no dependent relies on >16.
- The only blemish: the third (undocumented) title behavior change (NIT 1). No superficial/mismatched fixes found.

**3. New bugs/regressions.**
- Protocol compat both directions: **new ext + old companion** — old companion spreads `rest` without validation and echoes no `client_message_id` → new ext falls back to legacy adopt (incl. upload bubble, which old companion's echo positionally adopts — the exact F2 intent). **old ext + new companion** — old ext's parser copies only known fields, so `client_message_id` is ignored; companion omits the field when absent; old positional behavior unchanged. No visible break in either direction (verified against `message-router.ts:162` spread and the reducer legacy tails).
- Behavior changes: the two accepted ones, plus NIT 1. `classifyAlias` on a pure `[文件 x]` now yields a non-empty provisional reference (fallback `|| s`), resolving the synthesis P3 inconsistency rather than breaking it.
- Error-handling/state: F5/F6/F3 paths all release busy/processing state before early returns; no stuck-busy holes found. `mergeAttachments` retains optimistic captions on adopt (existing semantics).

**4. Tests real and non-vacuous.** Each new test fails against pre-fix code: adapter echo emit/omit (`adapter-usage.test.ts`); multi-surface adopt, out-of-order adopt, no-match append, legacy fallback (`sidepanel-state.test.ts` — positional adopt would mis-adopt all four); `fileUploadedEffects` gating (`stream-thread-gate.test.ts` — pre-fix had no such helper and BUMP was gated); loopErr priority (`image-compose.test.ts`); `isFrameBudgetRefusal` marker (`ws-frame-budget.test.ts`); sidecar prefix exact-compare (`thread-image-sidecar.test.ts`); F9 sidecar-keep/orphan-delete (`file-upload-sidecar-keep.test.ts` — abort-after-persist case fails pre-fix); F10 round-trips + delegation (`alias-commit.test.ts`, `thread-provisional-title.test.ts`). Gaps are only the untested UI seams (NIT 2/4) — no fix has zero meaningful coverage.

**5. Synthesis P2 all addressed.** F1, F2, F3, F5, F6, F7, F8, F9, F10 all fixed; F4 (P3) explicitly documented as deferred in the fix table. Nothing silently dropped.

**6. Cross-batch seams hold.**
- EXT↔COMP-chat F1: full wire walk in answer 1 — field names match at every joint (camelCase request / snake_case echo).
- F2 bubble ↔ F1 adopt: bubble id == wire `clientMessageId` == echoed `client_message_id` → exact adopt; old-companion fallback keeps the bubble.
- F9 ↔ F1: the adopted bubble's persisted id is `reservedUserMessageId`, which is exactly the id whose sidecars F9 preserves — one id, two uses, consistent (`adapter.ts:381-383` + `message-router.ts:871-884`).

**7. What would make me REJECT:** a broken/wrong-case F1 link (none), a visible compat break in either direction (none — both degrade gracefully), F9 inversion (none), an unaddressed P2 (none), or a vacuous test (none). Only nits found.

## Gate checklist

| # | Gate | Result |
|---|------|--------|
| R1 | F1 chain broken / wrong case / positional adopt when field present | **PASS** |
| R2 | New protocol incompatibility either direction | **PASS** |
| R3 | F9 inverted (delete on persisted / keep on orphan) | **PASS** |
| R4 | P2 unaddressed without documented reason | **PASS** |
| R5 | Vacuous new tests | **PASS** |

VERDICT: APPROVE_WITH_NITS
