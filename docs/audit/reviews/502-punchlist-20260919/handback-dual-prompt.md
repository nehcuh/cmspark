# Dual re-review — collect_handback honesty (3r2frm)

You are an **independent** senior reviewer. Do **not** rubber-stamp. Read HEAD source + the uncommitted diff yourself. Confirm or kill each claim.

## Repo

- Workspace: C:\Users\HuChen\Projects\cmspark
- Branch: `fix/502-adversarial-punchlist`
- Last commit: `dba48161`
- Uncommitted diff (THIS review): `git -c color.ui=false -c color.diff=false diff HEAD -- CHANGELOG.md chrome-extension/src/sidepanel/components/ChatView.tsx companion/src/board/schema.ts companion/src/board/service.ts companion/src/bridge/tool-definitions-catalog.json companion/tests/board-collect-handback.test.ts companion/tests/board-schema.test.ts`
- Ignore: `memory/project-knowledge.md`, `memory/session.md`

## Incident (ground truth, already reproduced)

Thread `3r2frm` spawned workers `286ryj`, `z1p2kd`, `mpvmhf`. Orchestrator called `collect_handback` on `286ryj` after Glance `llm_active=false`. Worker last assistant was a ~10k markdown C2C paper report containing math `C_F = { C_n(X) + F_n(...) }`. Host has `mission_board` so structured parse is required. First-brace extract JSON.parse'd the math fragment → tool error `handback JSON parse failed` shown as ⚠️. Sibling workers kept running. `collect_handback` never stops siblings.

## What the patch claims

1. Incidental braces in prose → `prose-only handback; no JSON structure`, **not** `handback JSON parse failed`.
2. If this worker's last row is a live tool card or assistant `finish_reason=tool_calls`, return `WORKER_STILL_RUNNING` **before** `ensureBoard`, recoverable, `suggested_action: wait_workers`, does not stop siblings.
3. Structured-path prose reject copy: `worker delivered a prose report, not structured handback JSON. Other workers are unaffected.`
4. Side Panel `toolResultUserHint` maps `WORKER_STILL_RUNNING` / `HANDBACK_MISSING_STRUCTURE` to Chinese honesty copy (error_code survives archive stub).
5. Catalog description tells the model not to collect while the worker is live.

ADR-016 board mode still **rejects** prose (success:false). This is copy + classification + premature-collect gate, not a silent accept of markdown as facts.

```text
Surface:      Side Panel tool-card hint + collect_handback
L2-classes:   none
Compose:      Fleet ADR-015 / MissionBoard ADR-016
Autonomy:     no new arm; collect does not stop workers
Trust:        structured handback still required when board present
Channel:      community
Blast:        T1
```

Read `docs/audit/reviews/_templates/dual-review-capability-checklist.md`.

## Attack these specifically

- Truncated real JSON (unclosed `{`) must still be prose-only / missing-structure, not silently accepted.
- A fenced ```json``` handback with incidental braces in surrounding prose must still parse (existing test).
- `WORKER_STILL_RUNNING` false-positive: last tool row with `result: null` after a failed tool — is that "still running" forever?
- `ensureBoard` skipped on in-flight: good, but does a later successful collect still init the board?
- Archive stub: is `error_code` still on the tool result after `stubFailureResult`? Hint depends on it.
- Does ChatView hint fire only on `success===false` (yes today) — if someone later returns success:true with a warning, hint dies.
- Catalog vs executor lockstep.
- Any new L2 / auto-spawn / arm? Must be none.

## Output

```
# Dual re-review (claude|kimi)
HEAD: dba48161 + uncommitted collect_handback diff

## Per-claim
- C1 incidental braces: TRIGGERED|DOWNGRADED|NOT_TRIGGERED|FIXED — file:line
- C2 in-flight gate: ...
- C3 prose copy: ...
- C4 UI hint vs archive stub: ...
- C5 catalog: ...

## New findings (only if grounded)
### N-1 — BLOCK|MAJOR|NIT
- File:
- Evidence: [inspected|executed]
- Failure mode:

## ADR-020
one line per axis

## Notes
```

End with exactly one of:

VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
