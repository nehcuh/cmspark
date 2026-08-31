# Dual re-review — CMspark W1e shell allowlist spec (Node 1, plan only)

You are an **independent** senior reviewer. You did **not** write the strawman or the four-lane synthesis. Confirm, refute, or block the **path**. READ-ONLY — do not edit the repo.

Work in: `/Users/huchen/Projects/cmspark` branch `fix/shell-allowlist-w1e`

## Capability declaration

```text
Surface:      L2 shell_exec (existing)
L2-classes:   shell
Compose:      none
Autonomy:     n/a
Trust:        allowlist last-line when L2 skipped
Channel:      enterprise
Blast:        T3
```

## Inputs (read with tools)

1. Folded spec: `docs/superpowers/specs/2026-08-31-shell-allowlist-w1e.md`
2. Plan: `docs/superpowers/plans/2026-08-31-shell-allowlist-w1e.md`
3. Four-lane synthesis: `docs/audit/reviews/shell-w1e-adversary-synthesis-2026-08-31.md`
4. Live code: `companion/src/capability/shell.ts` (tokenizeSimpleArgv, commandMatchesAllowlistEntry, deny matchers, spawn)
5. Tests that must stay green / flip: `companion/tests/batch-c-host-p1.test.ts`, `capability-shell-netsec.test.ts`

## Rules

1. This is a **plan** review. No production patch yet.
2. REJECT if implementing as written would still allow POSIX `spawn({shell:true})` to honor `-c`/`-e` on a bare allowlisted interpreter via wrapping quotes, intra-token empty quotes, backslash, adjacent-quote split (`"-"c`), or tokenize-null fallback.
3. REJECT if DoD tests would stay green without T-join / L-b-on-interpreters / L-c (the strawman failure CORR named).
4. Calibration: T3 last-line of allowlist+enterprise skip, **not** unauth default RCE. Do not demand GTFOBins / P1b shell:false / adapter #4.
5. If four-lane pins are folded correctly, say so. If a BLOCK pin is still missing from the numbered DoD, REJECT.
6. Do not reward long prose.
7. Final line MUST be exactly one of:

VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT

## Required sections

## Verdict rationale
## Confirmed pins
## Missing / still BLOCK
## Nits
## Recalibrated: implement now? YES only if APPROVE*
