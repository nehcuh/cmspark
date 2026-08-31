# Plan: shell allowlist W1e (folded)

**Spec**: `docs/superpowers/specs/2026-08-31-shell-allowlist-w1e.md` (FOLDED)  
**Branch**: `fix/shell-allowlist-w1e`  
**Files**: `companion/src/capability/shell.ts`, `companion/tests/batch-c-host-p1.test.ts`, `companion/tests/capability-shell-netsec.test.ts`, `companion/tests/shell-progress-windowsHide.test.ts` (T-join `"foo""bar"`), `CHANGELOG.md`

## TDD order

1. Write W1e + W1b-flip + T-join parse tests. Confirm RED.
2. T-join in `tokenizeSimpleArgv` (continue word after quote if next char is not IFS).
3. `normalizeShellTokenForFlagMatch` as first line of both deny matchers.
4. `commandMatchesAllowlistEntry`: tokenize null → false; delete fallback-allow helpers.
5. Comments + CHANGELOG Unreleased.
6. Targeted: `tsc -p tsconfig.test.json` then `node --test` the three test files.

## Stop

No adapter/whisper/outbound/UI. No L-a metachar widening. No GTFOBins.
