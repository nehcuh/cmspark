# Dual external review R2 — Dictation+ D1c (post-REJECT fix)

**Batch**: `dictation-plus-d1c-r2`  
**Prior**: Claude+Pi **REJECT** on r1  
**Machine**: chrome-extension **556 pass**; `tsc -p tsconfig.json --noEmit` clean

## Fixes (must verify)

1. **Idle abort**: continuous path records first; `voice.stt.start` only at upload (after captureStop), then chunks immediately — avoids companion 10s idle during 45s record.
2. **Stop during processing**: continuous+local `toggle` uses `stopEngine("stop")` without `USER_TOGGLE_STOP` so prior segment finals survive.
3. **tsc**: `result.ok === false` discriminant for non-strict build.
4. **Tests**: multi-segment with `segmentMs` override; idle-safe start ordering; graceful ENGINE_END keeps finals.

## Capability (ADR-020)

```text
Surface: L0 | L2: none | Compose: none | Autonomy: n/a
Trust: mic + local multi-segment residual; v3; no auto-send; no raised STT_MAX_RECORD_MS
Channel: community
```

End with: `VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
