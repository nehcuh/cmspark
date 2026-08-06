# Pi re-review: Voice Input product design SoT (post four-lane adversary)

**Batch:** `voice-input-design`  
**Stage:** External Pi confirmation after internal adversarial synthesis  
**Date:** 2026-08-06  

## Context

CMspark (Chrome Side Panel + Companion) wants optional **voice input** (dictation → composer draft).  
Four-lane adversary (Product/Security/Platform/Impl) produced MAJOR_REVISE ×2 + PASS_WITH_CHANGES ×2; floors were merged into SoT.

## Read these (in order)

1. `docs/superpowers/specs/2026-08-06-voice-input-design.md` — **SoT under review**
2. `docs/audit/reviews/voice-input-adversary-synthesis-20260806.md` — floors + conflict resolution
3. Optional contrast: `docs/superpowers/specs/2026-08-06-voice-input-design-strawman.md` (pre-adversary)
4. Spot-check composer gates: `chrome-extension/src/sidepanel/App.tsx` (`InputArea`, `canSend`, `showStop`, textarea `disabled`)
5. ADR-020 skim if needed: `docs/adr/020-capability-model-three-axes.md`

## Your job

Independent senior product/security/platform reviewer. **Do not rubber-stamp.**

1. Verify SoT actually absorbs adversary floors (F-UX*, F-S*, F-C*, F-I*) — call out any floor that is missing, weakened, or contradictory.
2. Check consistency with real `InputArea` busy/stop behavior (thread_busy disable, stop button).
3. Check privacy honesty (three-channel STT; no false “local only”).
4. Check ADR-020: L0 only; no Trust elevation; no new confirm dialect.
5. Flag residual ship-blockers for M1 (including permission bootstrap feasibility).
6. List **non-blocking nits** only if they should not stop dual-review/M0.5 spike.

## Verdict rules

End with **exactly one** of:

```text
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

- **REJECT** if SoT still allows auto-send in v1, lies about privacy, elevates Surface/Trust, or busy/mic matrix still conflicts with code without intentional change.
- **APPROVE_WITH_NITS** if floors are present but minor gaps remain (document them before VERDICT).
- **APPROVE** only if ready for M0.5 spike / dual-review without further SoT rewrite.

Use Read/Bash tools on the real files. Cite file paths for blocking issues.
