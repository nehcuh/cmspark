# Dual re-review — 502 punchlist synthesis

You are an **independent** senior reviewer. Do **not** rubber-stamp the synthesis. Read HEAD source yourself. Confirm or kill each unique finding.

## Repo

- Workspace: C:\Users\HuChen\Projects\cmspark
- Branch: `fix/502-adversarial-punchlist`
- HEAD: `022b2f60`
- Base: `origin/main` `93923c1d`
- Diff: `git -c color.ui=false -c color.diff=false diff 93923c1d..HEAD`
- Synthesis (claims to verify, not truth): `docs/audit/reviews/502-punchlist-20260919/synthesis.md`
- Lane reports (optional, do not copy): `docs/audit/reviews/502-punchlist-20260919/lane-*.md`

Ignore uncommitted `memory/project-knowledge.md`.

## ADR-020 declaration (implementer)

```text
Surface:      Side Panel stream + Settings + existing full-page terminal tab
L2-classes:   none new; spawn_worker L2 preview/HMAC missing goal after #514 kick
Compose:      Fleet ADR-015 threads; ACP Composition
Autonomy:     fleet accept must not arm; kick must not bypass abort map
Trust:        archive stub dialect; persist_full opt-in
Channel:      community
Blast:        T2
```

Read `docs/audit/reviews/_templates/dual-review-capability-checklist.md`.

## What you must do

1. Read the synthesis §2 unique findings X1–X10.
2. For **each** Xn, open the cited files at HEAD and mark:
   - **TRIGGERED** — you independently see the failure mode
   - **DOWNGRADED** — real but over-severed (say to MAJOR/NIT and why)
   - **NOT_TRIGGERED** — synthesis is wrong (cite the code that falsifies it)
   - **DUPLICATE** — same root as another Xn (name which)
3. Do not add a new BLOCK unless you have file:line and a concrete failing scenario the six lanes missed.
4. Check ADR-020 axes. Missing declaration is a nit unless a new tool/gate/primary chrome skipped a gate.
5. You may run targeted tests. Do **not** run the full companion suite on Windows (it hangs). Spawn fixture claim X9 was already executed by the orchestrator (5 fail / goal missing); you may re-run `companion` `scripts/run-tests.mjs` on compiled `p2-deep-diagnosis-batch` and `spawn-rollback-demote` if you recompile.

## Capability / product NEVER to watch

- no auto-spawn; fleet accept ≠ `task_loop.arm`
- L2 / 急停 never buried
- archive stubs must not swallow L2 evidence; redact must not relax
- Goal Driver (slice D) and Observatory are out of this branch except G1

## Output format

```
# Dual re-review (claude|kimi)
HEAD: 022b2f60

## Per-finding
- X1: TRIGGERED|DOWNGRADED|NOT_TRIGGERED|DUPLICATE — one sentence + file:line
- X2: ...
...
- X10: ...

## New findings (only if grounded)
### N-1 — BLOCK|MAJOR|NIT
- File:
- Evidence: [inspected|executed]
- Failure mode:

## ADR-020
one line per axis pass/fail

## Notes
```

End the entire answer with exactly one of:

VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT

If REJECT, blocking issues with file:line must appear before the VERDICT line.
If APPROVE_WITH_NITS, only non-blocking nits before VERDICT.
