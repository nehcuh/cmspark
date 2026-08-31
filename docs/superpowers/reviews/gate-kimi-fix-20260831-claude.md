# Review Gate Verdict — PASS_WITH_NITS

**0 BLOCK · 0 MAJOR · 4 NIT.** Both MAJOR fixes (A: restorable auto-correct; B: ADR-022 sync) are correctly implemented and documented; every doc claim in the ADR-022 note maps verbatim to shipped code.

## Findings

**NIT-1 (tests, misleading name)** — `companion/tests/voice-whisper-handlers.test.ts:652` — the test named *"download completion restores stashed preference once that model is ready"* asserts the **opposite**: probe keeps reporting the stashed model `absent` at completion, and the assertions pin **no restore** (keeps correction + stash). The actual restore is pinned by the sibling test at :677. Rename (e.g. "download completion keeps correction while stashed model still not ready").

**NIT-2 (test gap)** — no test pins "unset/default `localModelId` is not stashed" (ADR-023 revision-二 claim). The correction test at :546 and the new one at :595 both set `localModelId` explicitly, so a regression that stashes defaults would pass unnoticed. One extra assertion away.

**NIT-3 (test gap)** — no test reloads config from disk (`clearConfigCache()` + `getConfig()`) after a clear, so "stash stays cleared across restart" is never executed. Risk is low — `JSON.stringify` dropping `undefined` is deterministic (config.ts:1133) — but restart-survival, the stated rationale for the config.json backing, is only exercised for stash-*set* (via `resetVoiceConfig`'s real `saveConfig` → disk → reload, tests:51-68), never for stash-clear.

**NIT-4 (semantics wrinkle)** — `companion/src/voice/whisper-handlers.ts:582-597` — `set_engine local` lacks the restore-first check `maybeAutoActivateModel` has (:173-178): if a live stash's model is ready **and** the current `localModelId` is also ready, `set_engine` keeps the corrected model, then the first `get_state` (now engine=local) flips to the stashed model (:208-213) — a visible model switch right after enabling local. Only reachable when the stashed model became ready outside the download path (e.g. manual file placement) while engine was browser; self-correcting.

## Correctness verification `[inspected]`

- **Stash writers** — get_state :219-224 (`explicit && !stashed` guard: defaults not stashed, existing stash never overwritten); set_engine :586-620 (same guard, explicit+valid only).
- **Restore is probe-gated** — both sites restore only on `probeModel(...).status === "ready"` (:174, :209); never restores a non-ready model; neither touches `sttEngine`.
- **No double-restore / resurrection** — restore clears the stash in the same write and returns; afterwards active probes ready so both entry points early-return (:184, :215). After `set_active` (:542) active is ready by construction (gate at :531-541), so no writer re-fires.
- **Clears** — set_active :542; delete-of-stashed :489-501 combined into one `setVoiceFields` with the forced-browser write, which is preserved verbatim and engine-untouched when the deleted model isn't the active one (pinned by test :723).
- **Regressions hold** — set_engine zero-write on no ready model (:574-580 precedes all stash logic); delete-active→browser (:490-500); A1/A2 never touch `sttEngine`.

## Config hygiene `[inspected]`

Field type `"small"|"medium"|"large-v3-turbo"` is identical to `WhisperModelId` (session-caps.ts:31-32 → whisper-catalog.ts:8) — type-safe under `strict`. Round-trip: `setVoiceFields` spread puts `undefined` in memory; `JSON.parse(JSON.stringify(...))` drops the key on disk (config.ts:1118-1143). Tamper validation sits in the load-time voice block with the `modelRootDir` delete-on-invalid precedent (config.ts:941-949 vs :900-908), rejecting any non-union value including `null`/objects.

## Doc accuracy `[inspected]` — every ADR-022 claim maps to code

| Claim | Code |
|---|---|
| HTTP per-key (own `allow_page_export` only) | facade.ts:77-79; companion-http.ts:447-453, 495-498 |
| stdio per-caller (any live flagged grant) | bridge.ts:110, facade.ts:154-156 → outbound-grants.ts:336-347 |
| HITL session per-caller on both tracks | facade.ts:99 (`hasOutboundDisclosure(cid)`) |
| ack / `disclosure_accepted` ≠ consent | facade.ts:23-29; companion-http.ts:695-703 |
| `grant_id` from Bearer only, never body | companion-http.ts:303-344, 737-745 |
| `GRANT_CALLER_MISMATCH` binding | companion-http.ts:681-694, 724-736 |
| 32B token / sha256-only / revoke+expiry | outbound-grants.ts:130-132, 79-80, 344-345 & 362-363 |

ADR-023 revision-二 matches the code paths exactly. Placement satisfies ADR-022's own sync gate (note at 022:81, Grant row :222, changelog :237).

## Test execution caveat

The sandbox denied `npm test` / `node --test`, so **I did not execute the suite** — test-passing is `[assumed]`, not `[executed]`. Secondary evidence: `.test-dist` artifacts (config.js, whisper-handlers.js, test js) are all 14:55:54-55 today, strictly newer than the newest edited source (14:54:20), i.e. this exact state was compiled by the `npm test` pipeline locally. Recommend you confirm with `!npm --prefix companion test` before merging. The 8 new tests themselves are non-vacuous: setups round-trip the stash through real disk + tamper validation, and each asserts the stash field's transition.
