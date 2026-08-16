# Lane A — Security / Trust

> **TS**: 20260816-090554  
> **Scope**: Windows ACP spawn + Mode C (`acp-win-spawn-20260816`)  
> **Tool**: independent subagent (read-only)

Capability declaration: **pass** (no new L2 dialect, no worker-ACP, Mode C still snapshot-gated).

## Findings

| ID | Sev | File:line | Status |
|----|-----|-----------|--------|
| S-01 | P1 | `win-spawn.ts:158-171` + `launch-presets.ts:56-62` | wrapViaCmd + Claude `-p` prompt / page_context through `cmd /c`; `\"` is wrong cmd escape; `%` unescaped |
| S-02 | P1 | `open-local-terminal.ts:288-296`, `:908-924` | unwrap miss → `& cmd /d /s /c agent.cmd $task`; `$task` reparsed by cmd |
| S-03 | P2 | Mode C tmp `.md`/`.ps1` | no O_EXCL / no unlink / `.ps1` not 0o600 |
| S-04 | P2 | `open-local-terminal.ts:378-380` | `start` line quotes only on whitespace |
| S-05 | P2 | `killAcpChild` | bare `taskkill`; no `'error'` handler |
| S-06 | nit | `spawnAcpChild` | does not force `shell: false` |
| S-07 | nit | configured `evil.cmd` | expected after L2; not new skip |

Confirmed-safe: no `shell:true` on ACP spawn; protocol prompt is JSON-RPC not argv; happy-path unwrap avoids cmd; Mode C banner single-quoted; `open_local_terminal_snapshot` still gates Mode C.

VERDICT: REJECT
