# Review Gate: voice auto-correct restore + ADR-022 grant-semantics sync (2026-08-31)

You are an independent adversarial reviewer for CMspark. READ-ONLY review of the
attached diff (`gate-kimi-fix-20260831.diff`). Verdict: PASS / PASS_WITH_NITS / BLOCK,
findings graded BLOCK/MAJOR/NIT with file:line evidence. Do NOT review style nits
outside the diff. Conclusions must be reproducible from the repo at HEAD 6e5083fb +
this diff.

## Background

A 4-lane adversarial review of pull range c39d7d3e..26949cbb produced 7 MAJORs.
Five were fixed by PRs #261/#262/#263 (already merged, NOT in this diff). This diff
fixes the remaining two:

- **MAJOR-A (arch)**: `voice.model.get_state` (a read endpoint) persisted an
  auto-correction of `localModelId` when the configured active model was not ready
  — and never restored the user's explicit choice once that model later became
  ready (one-way preference drift). `set_engine local` had the same silent
  overwrite class.
- **MAJOR-B (arch/docs)**: ADR-022's own shipping gate (line ~190) requires syncing
  the ADR when grant semantics change; commit 123eaf2b changed exfil gating to
  dual-track (HTTP per-key / stdio per-caller) without an ADR revision.

## What the diff does

1. `companion/src/config.ts`: new optional `voice.localModelAutoCorrectedFrom`
   ("small"|"medium"|"large-v3-turbo") + load-time tamper validation.
2. `companion/src/voice/whisper-handlers.ts`:
   - `autoCorrectActiveLocalModel` (get_state path): stashes the explicit
     `localModelId` before overwriting; never overwrites an existing stash;
     self-heals (restores + clears) when the stashed model probes ready.
   - `maybeAutoActivateModel` (download-complete / already-ready path): a stashed
     preference that probes ready is restored first, before A1 auto-activation.
   - `set_active`: explicit fresh choice clears the stash.
   - `set_engine local`: auto-picking over an explicit configured model stashes it.
   - `delete`: deleting the stashed model clears the stash (voided preference);
     combined with the existing forced-browser write into one setVoiceFields.
   - Defaults (unset localModelId) are NOT stashed — nothing to restore.
3. `companion/tests/voice-whisper-handlers.test.ts`: 8 new tests covering
   stash / no-overwrite / self-heal / download-restore / set_active clear /
   delete clear / set_engine stash / correction-kept-when-stash-not-ready.
4. `docs/adr/022-outbound-mcp-server.md`: L4+ revision note documenting the
   shipped dual-track exfil grant semantics (HTTP per-key via authenticated
   grant_id; stdio per-caller; HITL session stays per-caller on both tracks —
   intentional asymmetry), impl-map Grant row updated, changelog row.
5. `docs/adr/023-voice-local-stt-path-b.md`: revision (二) recording that
   auto-correct is now restorable.

## Deliberate boundaries (do NOT re-litigate)

- Stash is config.json-backed (not process memory) so it survives restarts;
  process-memory `lastDownloadErrorMem` precedent is intentionally NOT followed
  here because preference restore must outlive the daemon.
- Clearing uses `setVoiceFields({ localModelAutoCorrectedFrom: undefined })`;
  `JSON.stringify` drops undefined keys (existing setVoiceFields idiom).
- Only explicitly-set `localModelId` is stashed; the default ("medium") is not.
- ADR-022 note documents semantics AS SHIPPED in 123eaf2b; it does not change
  any gate behavior.
- No new WS message types; no extension-side changes.

## Review focus

- Correctness: any path where the stash is written but never cleared, or
  restored to a model that is not actually ready; interactions between
  self-heal in get_state and restore in maybeAutoActivateModel (double
  restore, stash resurrected after clear).
- Config hygiene: does `saveConfig`/`getConfig` round-trip the new field;
  tamper validation coverage; `setVoiceFields` merge semantics with undefined.
- Test quality: do the 8 new tests actually pin the restore semantics, or do
  they pass vacuously (e.g. stash already absent)?
- Doc accuracy: does the ADR-022 note match `facade.ts` denyOutboundExfilIfNeeded
  and `companion-http.ts` behavior verbatim; does ADR-023 note match the code.
- Regression: existing guarantees (set_engine local zero-write on no ready
  model; delete-active forces browser; A1 never touches sttEngine) still hold.
