# Lane C — Correctness / Windows spawn

> **TS**: 20260816-090554  
> **Scope**: discover + unwrap + spawn wiring + tests

## Claimed bug

`where` lists POSIX shebang first → ENOENT; `spawn(.cmd)` → EINVAL. **Happy path (npm Claude / Pi) is fixed.**

## Findings

| ID | Sev | File:line | Note |
|----|-----|-----------|------|
| C1 | Medium | `win-spawn.ts:163-170` | `/s /c` missing outer quotes; spaces in path split |
| C2 | Medium | `quoteCmdArg` + Claude `-p` | same class as A/S-01; new exec vs old EINVAL |
| C3 | Low | tests | no lock that manager/protocol call `spawnAcpChild` |
| C4 | Low | unwrap regex | misses `%~dp0` (pnpm/codex npm) |
| C5 | Low | JS unwrap `process.execPath` | packaged `cmspark-agent.exe` may relaunch host |
| C6 | Nit | `joinDp0` | `\` not normalized; darwin CI may fail unwrap fixtures |
| C7 | Nit | `taskkill` on PATH | same as shell.ts |

Both stdio sites use `spawnAcpChild`. POSIX identity holds. Kill `/T` on all cancel/timeout/jsonrpc paths.

VERDICT: APPROVE_WITH_NITS
