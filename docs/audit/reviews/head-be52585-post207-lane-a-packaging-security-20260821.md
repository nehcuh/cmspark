# Lane A — Packaging Security / Trust

**Range**: `e8900bc`..`be52585`  
**HEAD**: `be52585a93dd8f04bc044c80d23809fb614f656d`  
**Patch SHA256**: `e6e3b78abe388fef11012a096324b544194f2d439055f4dbbfa81103303c3929` — match `[executed]`  
**Worktree**: `subagent-01a021d7-0f4f-7473-9747-b520df8fa40a`

Full findings: PATH `zip`/`7z` before Program Files; quoted `"${SEVENZ}"`; literals not `$PROGRAMFILES`; `installer.nsi` comments-only ASCII; `require('./…')` after `cd "${ROOT}"` not CDPATH/NODE_PATH hijackable; CI still runs package gates.

## Findings

- **N-01 P3**: `test-package-gates.sh:243` `grep -qP` fail-open on BSD grep (Darwin). CI GNU grep is live.
- **N-02 P3**: POSIX `C:/Program Files/...` is cwd-relative; planted fake 7z ran in `/tmp` replica. Unreachable on CI / when `zip` is on PATH.
- **N-03 P3**: 7-Zip assert pins the string, not PATH-first / quoting.

No P0/P1/P2. No new untrusted exec on the Windows local-dev threat model.

VERDICT: APPROVE_WITH_NITS
