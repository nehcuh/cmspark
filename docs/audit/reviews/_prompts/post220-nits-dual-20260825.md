# Dual external re-review (Claude + Pi) — post-#220 residual nits

Repo: /Users/huchen/Projects/cmspark
Branch: `fix/post220-residual-nits`
Base: `1d16b0e` (origin/main, PR #220)
Head: `9deff00`

You are the **second gate**, after independent four-lane adversary. Confirm or reject the adversary. Do **not** rubber-stamp. Read live source + the frozen patch + the lane reports. Run tests if tools allow.

## Frozen patch

- `docs/audit/reviews/post220-nits-diff-20260825-092457.patch`
- SHA256 `2625238075ef8720b4dc8ca73124742b068b54c8b7d721b1dfd2d4c793274b51`
- `git diff 1d16b0e..9deff00 -- companion`

## Adversary (must read, not just the synthesis)

- Synthesis: `docs/audit/reviews/post220-nits-adversary-synthesis-20260825.md`
- A: `docs/audit/reviews/post220-nits-lane-a-llm-20260825.md` → AWN
- B: `docs/audit/reviews/post220-nits-lane-b-drain-20260825.md` → AWN
- C: `docs/audit/reviews/post220-nits-lane-c-lease-20260825.md` → AWN
- D: `docs/audit/reviews/post220-nits-lane-d-redact-20260825.md` → AWN

All four **APPROVE_WITH_NITS**, no BLOCK. Your job: confirm HOLDs or REJECT if a claimed fold is still live / over-claimed.

## Capability (implementer — challenge)

```text
Surface:      L0
L2-classes:   none
Compose:      none
Autonomy:     steer / nextRun queue plumbing
Trust:        persistence redaction tighter (passwd, non-string secret keys)
Channel:      overlay bind/reclaim live-gate
```

Blast T2. Escalate T3 only if overlay is Allow/Deny, confirm skip, or claimed secrets persist.

## Machine (optional but preferred)

```
cd companion
npx tsc --noEmit -p tsconfig.json
npx tsx --test tests/run-queues.test.ts tests/tool-batch-heal.test.ts tests/adapter-steer-overflow.test.ts tests/message-router-nextrun-drain.test.ts tests/tool-persistence-redact.test.ts tests/history.test.ts tests/summoner-overlay.test.ts tests/overlay-session.test.ts
```

## Rules

1. Inspect real code. Cite file:line.
2. ADR-020 checklist: `docs/audit/reviews/_templates/dual-review-capability-checklist.md`
3. If a lane BLOCK is still live → REJECT.
4. Over-strict nits may stay nits (AWN). Do not invent blockers.
5. Out of slice (do not REJECT solely): generic `value` blanket redact; M3 pack.apply tests; N1 idle flash; N9 length budget.
6. Final line of your response MUST be exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
