# Dual / multi-adv review: Windows ACP coding-agent spawn

## Scope (ONLY these files)

Uncommitted Windows fix for “外部编程 Agent 启动失败”:

- `companion/src/acp/win-spawn.ts` **NEW**
- `companion/src/acp/discover.ts`
- `companion/src/acp/protocol-session.ts`
- `companion/src/acp/manager.ts`
- `companion/src/acp/jsonrpc-stdio.ts`
- `companion/src/acp/open-local-terminal.ts`
- `companion/tests/acp-win-spawn.test.ts` **NEW**
- `companion/tests/acp-open-local-terminal.test.ts`
- `CHANGELOG.md` (one Fixed bullet)

Patch: `docs/audit/reviews/acp-win-spawn-diff-20260816-090554.patch`

**Out of scope:** other dirty tree (`package-lock`, esbuild, test-package-gates, `.tmp-*`, memory/*).

## Claimed bug (must verify, not trust)

On Windows, `where claude` lists a POSIX `#!/bin/sh` shim first, then `claude.cmd`.
- `spawn(shebang)` → ENOENT
- `spawn(.cmd)` without shell → EINVAL
- ACP manager / protocol-session used raw `spawn(command, args)`
- Mode C `openLocalTerminalForAgent` hard-failed on win32

Fix: prefer `.exe`/`.cmd`; unwrap npm/Claude `.cmd` to PE or `node script.js`; Mode C via wt / `start` + PowerShell `-File`.

## Capability declaration

```text
Surface:      L0/L1 evidence; coding writes remain external process
L2-classes:   (none new); existing acp propose/start L2 unchanged
Compose:      acp client spawn path only
Autonomy:     single; no worker-ACP
Trust:        HITL start unchanged; no shell:true on prompt argv
Channel:      community
```

## Verify (all lanes)

1. Does the claimed Windows spawn failure actually get fixed at both discover + spawn seams?
2. No new free-exec surface (Mode C still after L2 snapshot; no `shell:true` on user prompt).
3. No new L2 dialect / no worker ACP / no 中层 Agent.
4. Kill of wrapped children (cmd.exe unwrap vs PE) does not leave orphans.
5. Tests lock the shebang/.cmd/unwrap cases; live tests are win32-skip elsewhere.

## Verdict

End with exactly one of:

- `VERDICT: APPROVE`
- `VERDICT: APPROVE_WITH_NITS`
- `VERDICT: REJECT`

REJECT = ship-blocking (security hole, spawn still broken, silent fail that lies to user).
APPROVE_WITH_NITS = nits only, no redesign.
Implementer self-APPROVE is not a gate.
