# Dual external review r2 — multi-adv deep COMPLETE gate

## Prior r1
Claude + Pi both **APPROVE_WITH_NITS** (`multi-adv-deep-wave012-verdict-20260810-233312.json`).
All C1–C16 done except C10 full god-file split DEFERRED.

## This r2 scope (nits absorbed)
Commit `304d33d` after r1:

1. **C1 restart residual closed**: durable `unattended-cruise-snapshot.json` under DATA_DIR; `reconcileUnattendedCruiseOnBoot` in `startServer`; capture persists file; restore/discard clears file.
2. **Bare disarm no longer clobbers cruise**: `restoreCruiseFromSnapshot` no-ops without snapshot unless `forceNull`; message-router only restores when `had_grant || hadSnapshot || clear_cruise===true`.
3. Tests: forceNull, boot reconcile durable file.

## Your job
1. Verify nits fixes are correct and complete (read code).
2. Spot-check that r1 C1/C5/C6/C7/C8 still hold (no regression).
3. Decide if optimization of multi-adversarial findings Wave0–2 is **COMPLETE**.
   - C10 full god-file split remaining DEFERRED with FREEZE comments is **acceptable** — not a REJECT.
   - Pre-existing computer-executor/uia-watch failures identical on base are **not** REJECT.
4. If COMPLETE and no blocking issues: VERDICT: APPROVE
   If only trivial residual nits: VERDICT: APPROVE_WITH_NITS
   If incomplete security: VERDICT: REJECT

Final line MUST be exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT

## Capability
Same as r1: Surface L2 honesty/bind/isolation; Composition pack phrase; Autonomy unattended lifecycle; Trust restore+boot; no new L2 tools.
