# Lane C — test runner isolation / flake fix

**Range**: PR #209 `511bc87` `companion/scripts/run-tests.mjs`  
**HEAD**: `be52585`  
**Worktree**: `subagent-01a021d7-0f4f-7473-9747-b54ab4738b37`

## HOLD

- `extraArgs` only on settings-web spawn, not main suite
- settings-web still last and alone (1 of 242 compiled tests)
- Node **v22.23.2**: `--experimental-test-isolation=none` accept; unflagged `--test-isolation` **exit 9**
- Node **v24.16.0**: both spellings accept
- Flag **after** `--test` is effective (`NODE_TEST_CONTEXT=null`)
- settings-web **20/20** isolation=none on Node 22 and 24
- isolation=none does **not** swallow assertion failures (probe exit 1)
- leftover interval/listen hang class is **shared** with default isolation
- Full 241-file suite **not** claimed green

## Nits

1. Wrong upstream cite: node#49844 vs actual stack **#64061 / c8ctl#182** (workaround still correct)
2. `engines >=20` but flag needs Node ≥22
3. Commit “15 subtests” vs TAP **20**
4. Basename uniqueness not type-pinned
5. `process.exit` intercept now hits the runner — do not copy into main suite
6. Experimental spelling may vanish on a future Node

VERDICT: APPROVE_WITH_NITS
