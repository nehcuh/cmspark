# Dual external review: shell_exec abort + timeout process-tree kill

**Batch:** `shell-abort-timeout`  
**Stage:** Implementation review (uncommitted working tree)  
**Date:** 2026-08-06  
**HEAD:** `018d346` (plus local uncommitted changes)

## User-reported bugs

1. **Stopping the conversation does not stop a running shell command**  
2. **Shell has no effective timeout / cannot be stopped individually**

## Capability declaration (ADR-020)

```text
Surface:      L2 (enterprise shell_exec lifecycle only — no new Surface class)
L2-classes:   shell
Compose:      none
Autonomy:     single (thread-scoped kill; no multi-worker new path beyond stop_thread)
Trust:        L2 security_token for shell_exec unchanged; abort is always safe direction
Channel:      enterprise (shell module)
```

## Claimed fix (verify in code, do not rubber-stamp)

### A. Process-tree kill (timeout effectiveness)

- `killProcessTree(child)` in `companion/src/capability/shell.ts`
  - POSIX: spawn with `detached: true` so pid is process-group leader; `process.kill(-pid, SIGKILL)`
  - win32: `taskkill /pid /T /F` (detached false)
- Timeout path uses `killProcessTree`, not bare `child.kill`
- Default still 60s; clamp via `resolveShellTimeoutMs` (1s–300s); optional `timeoutMs` in tool schema

**Verify:** bare SIGKILL of shell parent used to leave `sleep` orphans — tests claim process-group kill prevents marker file.

### B. chat.abort / stop_thread kill shell

- Active run registry: `activeShellRuns` keyed by `tool_call_id` / runKey
- `abortShellRunsForThread(threadId)` called from:
  - `server.ts` WS handler on `chat.abort` (alongside `flipAllComputerTaskAborts`)
  - `server.ts` `stop_thread` path after `abortThreadChat`
- `shellExec` accepts `signal?: AbortSignal` from LLM loop (`CompanionToolExecOptions.signal` → executeCompanionTool)
- Mid-run abort → `aborted: true` in result data; pre-aborted signal refuses before spawn

### C. Individual stop

- WS: `shell.exec.abort` with `tool_call_id` and/or `thread_id` → ack `shell.exec.abort.ack`
- Extension SW forwards `shell.exec.abort`
- Side Panel shell tool card: **停止** button while `status === "running"`
- UI meta: `aborted` → 「已停止」 (priority over 超时)

### D. Tests (claimed green)

- New: `companion/tests/shell-abort-timeout.test.ts`
  - AbortSignal mid-run, abort by thread, abort by id, timeout kills grandchildren (POSIX), pre-abort
- Updated: shell spawn detached flags; shell-card-utils aborted meta

**Note:** new test file may be untracked — read path directly if not in patch.

## Files to inspect

| Path | Role |
|------|------|
| `companion/src/capability/shell.ts` | kill tree, registry, signal, timeout |
| `companion/src/server.ts` | signal pass-through, chat.abort, stop_thread, shell.exec.abort |
| `companion/src/bridge/tool-schemas.ts` | timeoutMs |
| `companion/src/bridge/tool-definitions-catalog.json` | LLM docs |
| `companion/tests/shell-abort-timeout.test.ts` | abort/timeout tests |
| `companion/tests/shell-progress-windowsHide.test.ts` | detached flags |
| `chrome-extension/src/background/index.ts` | SW forward |
| `chrome-extension/src/sidepanel/components/ChatView.tsx` | stop button |
| `chrome-extension/src/sidepanel/utils/shell-card-utils.ts` | aborted UI |
| `chrome-extension/tests/shell-card-utils.test.ts` | UI unit |

## Attack / regression checklist (reviewer focus)

1. **POSIX process group:** Does `detached: true` + kill(-pid) risk killing unrelated processes if spawn fails to become group leader? Any path that still uses shell:true without detached?
2. **win32:** taskkill only; is windowsHide still set? Orphan risk if taskkill fails silently?
3. **Registry races:** double-kill, wrong-thread kill, flight release after abort (SHELL_BUSY stuck)?
4. **chat.abort vs signal:** both paths — is one sufficient? Does abort leave flight held?
5. **shell.exec.abort without tool_call_id:** falls back to whole thread — OK for product? Cross-thread attack via WS?
6. **Trust:** abort does not waive L2; stop button does not auto-approve shell
7. **LLM contract:** success:true with aborted/timed_out — consistent with non-zero exit? UI flags failed?
8. **Missing tests:** signal path through `createToolExecutor` / full chat.abort integration? win32 timeout tree?

## Required verdict shape

List blocking issues (if any) with **file:line**.  
Non-blocking nits separately.  
End with exactly one line:

```text
VERDICT: APPROVE
```
or
```text
VERDICT: APPROVE_WITH_NITS
```
or
```text
VERDICT: REJECT
```
