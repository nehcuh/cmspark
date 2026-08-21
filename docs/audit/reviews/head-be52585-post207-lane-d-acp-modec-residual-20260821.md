# Lane D — ACP Mode C residual at HEAD

**HEAD**: `be52585`  
**Fix**: `57a4979` (PR #207)  
**ACP files `57a4979..HEAD`**: empty diff `[executed]`  
**Worktree**: `subagent-01a021d7-0f50-7561-bdf5-76479379f9f0`

## P1 HOLD

| ID | HEAD |
|----|------|
| P1-1 opencode `--prompt` POSIX+Windows | HOLD `[executed]` constructor matrix |
| P1-2 kimi Windows omit `$task` (L1 / L0 / paste) | HOLD `[executed]` |

claude/grok/unknown trailing-task shape unchanged. `resolveProtocolArgs` kimi/opencode `["acp"]`.

ACP four test files after recompile: **86/86**. Stale main `.test-dist` (Aug 20 18:18) did **not** contain `--prompt` branches — not used.

## Residual nits (still P2)

R1 L0 `agentId` untested · R2 `openLocalTerminalForAgent` passthrough untested · R3 笔记库 copy untested · R5 `vault 路径不存在` strings · R6 opencode `--prompt` prefills, does not auto-submit.

kimi POSIX still bare `exec kimi`. Do **not** “fix” with `-p` (print mode). Product paste gap, not a missed TUI flag.

No new Mode C regression since `57a4979`.

VERDICT: APPROVE_WITH_NITS
