# Dual-review synthesis: shell-abort-timeout

**Date:** 2026-08-06  
**Feature:** shell_exec chat.abort kill + process-tree timeout + individual stop  

## Verdict table

| Round | Claude | Pi | Gate |
|-------|--------|-----|------|
| R1 impl | **REJECT** | **REJECT** | extension `tsc` / `npm test` broken by `assert.doesNotMatch` |
| R2 fix | **APPROVE** | **APPROVE** | `both_approve: true` |

## R1 blocking (both independent)

`chrome-extension/tests/shell-card-utils.test.ts` used `assert.doesNotMatch`, which is **not** on the hand-rolled `Assert` in `chrome-extension/tests/node-shims.d.ts`.  
`npm test` = `tsc -p tsconfig.test.json && node --test …` → CI hard-fail.

**Fix:** `assert.ok(!/超时/.test(meta), …)` — verified `tsc` exit 0 + 8/8 unit tests.

## R1 non-blocking nits (deferred; both reviewers agreed non-block)

| Nit | Source | Notes |
|-----|--------|--------|
| win32 `taskkill` not awaited | Claude, Pi | POSIX path tested; Windows orphan residual |
| No full WS `chat.abort` integration test | both | Mitigated by registry path on `chat.abort` |
| `shell.exec.abort` thread fallback | both | Safe direction; any paired peer can stop |
| `ToolCallCard` re-subscribes store | Claude | Perf nit |
| `abortAllShellRuns` unused export | Pi | Dead API surface |
| Error/pre-abort payload shape vs close | Pi | Minor contract inconsistency |

## Gate artifacts

- R1: `shell-abort-timeout-verdict-20260806-192609.json`
- R2: `shell-abort-timeout-r2-verdict-20260806-193231.json`
- Prompt: `shell-abort-timeout-dual-review-prompt-20260806.md` / `…-r2-…`
- Reviews: `…-claude-…` / `…-pi-…` under `docs/audit/reviews/`

## Merge readiness

**Yes for dual-external gate** after R2 both APPROVE.  
Implementer should still restart companion + reload extension for manual smoke: long `sleep`, Stop dialog, per-card 停止, timeout.
