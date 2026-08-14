# Ship PR consensus — feat/coding-agent-panel residual

> **TS**: 20260814-223435  
> **Evidence**: B-ux (Pi), C-correctness (Pi), Pi dual full; A-security / Claude dual relaunched (slow buffer).  
> **Tests**: acp-*.test.ts **88 pass**; companion+extension tsc clean `[executed]`.

## Reviewer table

| 路 | 裁决 | Ship ready |
|----|------|------------|
| B UX | REQUEST_CHANGES | NO (pre-fix) |
| C Correctness | APPROVE_WITH_NITS | YES_WITH_NITS |
| Pi dual | REQUEST_CHANGES | NO (pre-fix) |
| A / Claude dual | pending at consensus time | — |

## Must-fix status (post-review patch)

| ID | Issue | Status |
|----|-------|--------|
| R1 applyable clobber | manager emit `applyable` on pending_diffs | **FIXED** |
| Cancel → 「完成」 | `cancel()` sets `partial=true` + Mode C timeline | **FIXED** |
| failed Stop label | exclude failed/skipped from modeCMonitorStop | **FIXED** |
| pending open after stop | `mode_c_open_cancelled` guard | **FIXED** |
| pendingStartAfterPick on close | clear on panel falling edge | **FIXED** |
| git exit 128 | stderr content only for not-a-repo | **FIXED** |
| Docs silent Terminal fallback | corrected | **FIXED** |
| Decision doc links | copied mode-c + dual-synthesis into worktree | **FIXED** |
| dist/ 981MB | added `dist/` to .gitignore | **FIXED** |

## Synthesis

**Pre-fix**: REQUEST_CHANGES (R1 Apply dead was ship-blocking).  
**Post-fix**: **YES_WITH_NITS** — open PR; follow-ups: prompt-file unlink, login-shell retry, WS throttle, serverEnv denylist.

## Ship decision

**OPEN PR** to main from `feat/coding-agent-panel` after commit of residual.
