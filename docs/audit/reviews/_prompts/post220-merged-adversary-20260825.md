# Independent post-merge adversary — PR #220 on main

**Date**: 2026-08-25
**Base**: `c5b4242` (S78 session-end; parent of squash)
**Head**: `1d16b0e` (PR #220 squash MERGED)
**Frozen patch**: `docs/audit/reviews/post220-merged-diff-20260825-085108.patch`
**SHA256**: `b5e936cbf1dc66afc3fc7aef5898fb417692ed63325b9a4ed8bb11caf5c86021`
**Diff**: `git diff c5b4242..1d16b0e -- ':!docs/audit/reviews'` (22 files, +2514/−109)

## Why this range

#220 already had an in-tree four-lane adversary (r1 A/C/D REJECT; r2 all APPROVE*; Pi AWN) **before** squash-merge. That review ran against an uncommitted working tree at `c5b4242`, not against the merged commit. This round is a **post-merge independent re-verify** of live `main`. Do **not** rubber-stamp r2.

Prior artefacts (context only — re-execute, do not quote as proof):

- r1 synthesis: `docs/audit/reviews/post219-kimi-nits-adversary-synthesis-20260825.md`
- r2 synthesis: `docs/audit/reviews/post219-kimi-nits-r2-synthesis-20260825.md`
- Pi: `docs/audit/reviews/post219-kimi-nits-r2-pi-20260825.md`

## Capability declaration (implementer claim — challenge it)

```text
Surface:      L0 (steer/nextRun composer + overlay hub; no new L2)
L2-classes:   none
Compose:      none (overlay-eligible pack already on main)
Autonomy:     steer / nextRun queue
Trust:        overlay never Allow/Deny; persistence redaction must not leak
Channel:      composer lease / overlay session token
```

Blast: **T2**. Escalate to T3 only if you find a new confirm skip, overlay as Trust surface, or persistence leak of secrets.

## Rules (mandatory)

1. You are an **independent adversary**, not the implementer. Default: REFUTED until `file:line` + `[executed]`/`[inspected]`.
2. Read **live files at HEAD `1d16b0e`**. Optionally verify frozen patch SHA256. Never invent file:line.
3. Score **outcome / trajectory / component**. Machine-checkable > prose.
4. Do not reward length. Tests existing ≠ tests pinning the bug. Mutation-kill if you claim a test holds.
5. You may mutate a **private copy** of tests (e.g. `/tmp` or `.test-dist-mut`) then delete. **Do not dirty the git worktree** except writing YOUR lane report.
6. Do not implement fixes. Do not edit production source.
7. Tag every claim `[executed]` / `[inspected]` / `[assumed]`.
8. Final line of the report MUST be exactly one of:
   `VERDICT: APPROVE`
   `VERDICT: APPROVE_WITH_NITS`
   `VERDICT: REJECT`
9. REJECT = blocking issues with file:line before the verdict.
10. APPROVE_WITH_NITS = non-blocking nits only.

## ADR-020

Read `docs/audit/reviews/_templates/dual-review-capability-checklist.md`. Challenge Trust monotonicity, overlay-as-confirm, originWs (should not apply), missing declaration if tools/gates/primary UI were added.

## Must-falsify (replay r1 BLOCKs even if r2 said GONE)

| ID | Attack |
|----|--------|
| A-BLOCK | `adapter-steer-overflow.test.ts` must hit `OpenAIProvider.prototype.streamChat`, not a dummy Completions class under `tsx` |
| A-High leftover | after leftover `takeSteer`, queue-full must NOT `dropSteer` (wipes successor/concurrent steers) |
| A-High filler | `replaceInterruptedFillerIfPresent` must be scoped to the in-flight assistant's contiguous tool block, not first-id-global |
| B-High | drain gate error must `sendToExtension` and **keep** `file.uploaded` / create success; never replace the original ack |
| C-High | `beginOverlaySession` then lagged `summonerThreadId` reclaim must NOT steal the newer live overlay |
| D-High | `Authorization`/`Bearer`/`apiKey` redacted; INTERRUPTED reconstructs without extras; code-tool `data` always collapsed |

Also hunt **new** defects introduced by the squash (CI follow-up type/path fixes, thread-manager, summoner client, lifecycle).

## Intentionally out of slice (do not REJECT solely for these)

- M3 overlay `pack.apply` router tests
- N1 `chat.done` idle flash / N9 length output budget
- Continue UI, persist `running=true`, pending_confirms
