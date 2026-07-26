# Dual external review — Batch A (computer-use G1–G3)

Implementer claims Batch A of grill-locked plan is done:
- G1: posted/verified on steps + TYPE_NO_EFFECT with 1 re-focus retry
- G2: L2 checkbox "本会话自动同意同类"; explicit_opt_in required for initial-L2 skip
- G3: trust key thread:<id> preferred; ws: keys cannot initial-skip

Read docs/decisions/v1.3/computer-use-grill-locked-2026-07-26.md and
docs/decisions/v1.3/computer-use-batch-a-impl-2026-07-26.md then inspect:
- companion/src/computer/session-trust.ts
- companion/src/server.ts (trust skip + grant)
- companion/src/security-confirmation.ts
- companion/src/computer/executor.ts (posted/verified, TYPE_NO_EFFECT)
- chrome-extension sidepanel App.tsx + security-confirmation-payload.ts
- companion/tests/computer-session-trust-g1.test.ts

Rules:
1. Real code inspection; find incomplete fixes / security holes.
2. End with EXACTLY one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
