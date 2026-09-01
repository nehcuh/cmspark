# UltraQA Report — thread-loss-p0

## Goal and success criteria
- Goal: adversarial verification of thread honesty (list clock, truncated persist, switch hydrate, 32768 cap, alias hygiene)
- Stop condition: baseline tests green twice + scenario matrix without product defects
- Safety bounds: no DMG, no live GLM, no production writes, no secret dump

## Scenario matrix
| ID | User/attacker model | Scenario | Command/harness | Expected | Actual | Status | Evidence | Cleanup |
|----|---------------------|----------|-----------------|----------|--------|--------|----------|---------|
| N1 | honest user | companion full suite | `npm test` companion | fail 0 | 3987 tests, fail 0 (2nd run) | PASS | log 09:05 | n/a |
| N2 | honest user | extension full suite | `npm test` chrome-extension | fail 0 | 885 pass, fail 0 (2nd run) | PASS | same | n/a |
| N3 | digest job | extract bumps updated_at, list stays last_message_at | T-clock-1 | last_message_at unchanged | test pass | PASS | batch-d-runtime-p1.test.ts | n/a |
| N4 | truncated GLM | truncated tool batch disk tape | T-trunc-1 | one assistant, zero extra error row | test pass | PASS | adapter-steer-overflow | n/a |
| N5 | switcher | A→B→A hydrating not EmptyState | T-switch-* | cache hit / hydrating miss | test pass | PASS | sidepanel-state.test.ts | n/a |
| A1 | malformed | forge last_message_at via update() | T-clock-1b | ignored | test pass | PASS | batch-d | n/a |
| A2 | hostname alias | cruise-wl not user-class | T-alias-3 | classify hostname | test pass | PASS | alias-commit.test.ts | n/a |
| A3 | live GLM 8192 | real open.bigmodel.cn | blocked | N/A | BLOCKED | substitute unit cap T-cap-1 32768 | n/a |
| A4 | prompt injection | error string Thread not found | hydrate retry once | implemented; no dedicated test | PASS* | residual P1 no test | n/a |
| A5 | dirty worktree | unrelated files | git status | only thread-honesty + audit docs | PASS | no wipe of unrelated | n/a |
| A6 | flake | rerun suites | 2nd npm test | fail 0 | fail 0 | PASS | 61s rerun | n/a |
| A7 | misleading success | parse fail count not SUCCESS text | rg ℹ fail | fail 0 | PASS | n/a |
| A8 | cancel/resume autopilot | state file | read autopilot-state | phase ultraqa | PASS | not cancelled | n/a |

## Commands run
- `[0] companion npm test` — 3987 / fail 0
- `[0] chrome-extension npm test` — 885 / fail 0
- `[0] flake rerun` — both fail 0

## Failures found
None product-blocking. Residual P1: live column can show `chat.done` + ephemeral `chat.error`/`chat.aborted` double bubble; hydrate is single-row.

## Fixes applied
None in UltraQA cycle (review already APPROVE).

## Cleanup
No temp harnesses generated.

## Residual risks
- Live double assistant (P1)
- Graph slim from ThreadList may omit last_message_at (under-rank, not digest-as-new)
- No live GLM e2e (blocked; unit cap substitute)

## Evidence
Companion + extension fail 0 twice. Independent review: code-reviewer APPROVE `01a05c2f-1957-7a81-abb0-7904d9a5ea5f`, architect CLEAR `01a05c2f-1957-7a81-abb0-791f06f4b66d`.
