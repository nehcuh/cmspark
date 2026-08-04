# Dual re-review — S41 multi-adversarial (main #110–#114)

## Context

Internal 4-lane multi-adversarial review completed on range `2e7cf2f..79d7420` (tip `79d7420` after pull).

**Master synthesis (read first):**  
`docs/audit/reviews/multi-adversarial-review-20260804-main-110-114.md`

**Lane reports (adversarial evidence):**  
- `/tmp/cmspark-review-s41/lane-security.md`  
- `/tmp/cmspark-review-s41/lane-correctness.md`  
- `/tmp/cmspark-review-s41/lane-architecture.md`  
- `/tmp/cmspark-review-s41/lane-compat.md`  

**Production diff:**  
`docs/audit/reviews/s41-main-pull-diff-20260804-092610.patch`  
(also `git diff 2e7cf2f..79d7420 -- companion/src chrome-extension/src`)

## Internal synthesis claim

- Final: **REQUEST_CHANGES**  
- Architectural status: **WATCH**  
- P0 cluster: skill_install Trust (no L2 + free `content` + zip budget + dest_path honesty), config.test empty base_url, POSIX argv `FOO=1`/`~`  
- Solid: cookie gate, shell L2 + win32 argv, outbound scaffold unwired, FocusBand, downloads_find Downloads-only  

## Your job (independent re-review)

1. **Do not rubber-stamp.** Read synthesis + at least the P0 file:lines in real sources (`skill-install.ts`, `skill-engine.ts`, `server.ts` L2_GATE_TOOLS + skill_install case, `message-router.ts` config.test, `capability/shell.ts` tryParse/shouldUseArgvSpawn, Settings Coding Plan preset).  
2. **Confirm or refute each P0** with file:line evidence. Mark false positives.  
3. **Hunt misses** the lanes under-weighted (security regressions, dead routing, build breaks, ADR-020 Trust monotonicity).  
4. Apply ADR-020 checklist (`docs/audit/reviews/_templates/dual-review-capability-checklist.md`).  
5. Verdict on whether main at this tip is acceptable for “shipped S40/S41” vs needs fixes first.

## Capability declaration (implementer — this range)

```text
Surface:      L0 chrome (FocusBand) + L1 browser tools + L2 shell (enterprise) + config UI
L2-classes:   shell (existing); skill_install currently NOT L2
Compose:      skill_install + outbound-mcp Phase0 skeleton
Autonomy:     none
Trust:        skill source allowlist (partial); shell argv; cookie trusted_domains unchanged
Channel:      community (shell enterprise when enabled)
```

## Verdict rules

- **REJECT** if any confirmed HIGH Trust/correctness blocker remains unaddressed for production claims, or lanes missed a CRITICAL.  
- **APPROVE_WITH_NITS** if P0s are overstated / acceptable residual with explicit HANDOFF.  
- **APPROVE** only if Trust packaging matches marketing and no high findings stand.

End with exactly one line:

VERDICT: APPROVE  
or  
VERDICT: APPROVE_WITH_NITS  
or  
VERDICT: REJECT  
