# Dual external review R2 — Dictation+ D1a (post-Pi REJECT fix)

**Batch**: `dictation-plus-d1a-r2`  
**Branch**: `feat/dictation-plus-d1a`  
**Prior**: Pi **REJECT** on r1 (`dictation-plus-d1a-pi-20260807-232859.md`); Claude APPROVE_WITH_NITS  
**Machine**: chrome-extension `npm test` — **547 pass**

## Capability declaration (ADR-020)

```text
Surface:      L0
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        mic + browser STT residual (continuous) + voice_privacy_ack_v3; no auto-send
Channel:      community
```

## Fixes since r1 REJECT (must verify)

1. **Fatal errors end continuous session** — `onerror` for any code ≠ `no-speech` sets `wantListening=false` before `onError`; subsequent `onend` delivers `onEnd` once and does **not** restart. Test: `continuous: fatal network error stops restart and ends once`.

2. **Stop during onend→restart microtask** — microtask, when `!wantListening`, still calls `handlers.onEnd()` once (`endedForGen` guard). Test: `continuous: stop during onend→restart microtask still delivers onEnd`.

## Scope reminder

D1a only: continuous browser + caps + v3 ack + classic regression. Not D1b/D2/Meeting.

## Reviewer instructions

1. Diff vs `main` merge-base (include fix commit `5a8bc1c`).
2. Confirm both Pi blocking issues are closed with tests.
3. End with exactly:

`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
