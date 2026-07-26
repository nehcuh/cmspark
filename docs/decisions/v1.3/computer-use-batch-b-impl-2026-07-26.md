# Batch B 实现记录（G4–G6）— 2026-07-26

## Scope

| ID | 内容 | 状态 |
|----|------|------|
| G4 | Notes create → list-notes re-read verify (`evaluateNotesCreateVerify`) | done |
| G5 | Mail host_read → field non-empty verify + `summary` | done |
| G6 | LLM Rule 12: semantic-first, single-task, posted≠verified | done |

## Files

- `companion/src/host-use/darwin/notes-verify.ts` — pure verify helpers
- `companion/src/server.ts` — host_read/host_write return posted/verified
- `companion/src/llm/adapter.ts` — macOS Rule 12 rewrite
- `companion/tests/notes-verify.test.ts`

## Verify

- notes-verify + trust G1: 14/14 pass
- companion `tsc` green

## Adversary fix (post REJECT)

Adversary REJECT on G4: id-list alone ≠ Q6 body re-read.

**Fix:**
- `runCreateNote` re-reads `name` + `body` from Notes after create; returns JSON `body_preview`
- `evaluateNotesCreateVerify` **requires** `reReadBody` contains needle (first line of written body)
- Optional list-notes membership is defense-in-depth only
- Loose `endsWith(suffix)` open match removed

## Residual

- Mail still top-1 only (Phase 1)
- Notes HTML wrapper: needle match uses `includes` (Notes often wraps HTML)
- G6 still prompt-only (by design Q14=B)
