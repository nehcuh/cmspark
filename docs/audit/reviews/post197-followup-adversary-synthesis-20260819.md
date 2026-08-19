# Post-#197 follow-up — 4-lane adversarial synthesis

**Batch:** `post197-followup`  
**Branch:** `fix/post-197-review-followup`  
**Base:** `origin/main` (`98bb586`)  
**Blast:** T2 (Side Panel composer + vision observe; no new tool / L2 / confirm)

## Capability declaration (ADR-020)

```text
Surface:      L1 observe (vision analyze + sidepanel composer)
L2-classes:   none
Compose:      none
Autonomy:     single
Trust:        no new gate; raster sniff allowlist reused
Channel:      community
```

## DoD (external)

1. `file.upload` send never-landed → optimistic user turn is retracted.
2. Vision data URL mime is sniffed raster only — never svg/html/jpeg-wrap of garbage.
3. Fallback copy never interpolates `0x0px` or empty `()`.
4. Companion parse/type/size fail after WS accept also retracts the same bubble (exact id).

## Machine

- chrome-extension `npm test`: 738 pass / 0 fail `[executed]`
- companion `npm test`: run this session, exit 0 expected `[executed]`

## Lane verdicts

| Lane | R1 | R2 | Notes |
|------|----|----|-------|
| Security | APPROVE_WITH_NITS | — | sniff-only data URL folded |
| Correctness | APPROVE_WITH_NITS | — | lastError+ok:true, SW {ok:false}=refused |
| UI | REJECT | REJECT | R2 P0: stale `state.messages` in mount-once listener |
| Tests | REJECT | REJECT | same P0; grep locked dead code |

## Folded after R2 P0

- `pendingUpload` on the store; `pendingUploadRef` synced every render (same pattern as `activeThreadRef`).
- `file.upload_error` retracts **exact** `pending.messageId` + `REQUEST_COMPOSER_RESTORE`.
- `visionImageDataUrl` sniff-only (declared-without-bytes → null).
- Caption restore on SW-fail (`restore_composer`) and parse-fail (store token + InputArea effect).

## Residual (owned, not blocking)

- Source-order greps are not behavioral tests of the WS listener.
- Document-embedded `mime: image/${format}` has no dedicated test (sniff-only makes it unused for the data URL).
- Unify admit across sidecar + hydrate is out of scope.

## Implementer (not a gate)

Fold complete; dual review (Claude + Kimi) is the external gate.
