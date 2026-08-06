## Review complete

**Patch freshness:** Confirmed — `git diff`/`git status` output matches the review patch (same 10 files, same stats; `shell-abort-timeout.test.ts` present as new file).

### What I verified by reading code and running tests

**Signal chain (bug #1 fix):** `chat.abort` → `abortThreadChat` (message-router.ts:117) → `controller.abort()` → `chatCreate(signal)` (adapter.ts:652) → `executeTool(tc.id, ..., signal)` (adapter.ts:770) → `createToolExecutor` closure passes `signal` into `executeCompanionTool` (server.ts:2576) → `shellExec({ signal })` (server.ts:3706). Server-side `chat.abort` handler (server.ts:6393) additionally kills by thread id — belt-and-braces, not redundant. `stop_thread` path (server.ts:3008) also wired.

**Registry/flight (checklist item 3):** `activeShellRuns` keyed by `runKey = toolCallId`; `cleanup()` deletes on `close`/`error`; `abortShellRunById`/`ForThread` delete + kill. `doKill` is `settled`-guarded (no double-kill). `releaseFlight` runs in `finally` only after `shellExec` resolves (post-close) → no SHELL_BUSY stuck. Pre-abort signal refuses before spawn; no spawn/abort race (spawn is synchronous, listener registered same tick).

**Process-tree kill (bug #2 fix):** POSIX `detached: true` on both spawn paths (`shellSpawnOptions`, `shellSpawnArgvOptions`) → group leader; `process.kill(-pid, SIGKILL)` scoped to the new group. win32 keeps `windowsHide: true` and uses `taskkill /pid /T /F`. No other `shell:true` spawn path without `detached`.

**Tests:** Companion suite — **17/17 pass** (compiled via `tsc -p tsconfig.test.json` + `node --test`), including the POSIX grandchild-kill marker test. Extension suite runtime tests pass 8/8.

**Trust/LLM contract:** abort does not waive L2; stop button is kill-only; `success:true` + `aborted`/`timed_out` + `exit_code:-1` is consistent with the pre-fix timeout contract and the UI flags failed. ADR-020 axes fit (L2 shell lifecycle enhancement, single autonomy, no new confirm family, no originWs regression, no new runtime/agent).

### BLOCKING ISSUE (REJECT)

**`chrome-extension/tests/shell-card-utils.test.ts:100`** — the new test calls `assert.doesNotMatch(formatShellMetaLine(card), /超时/)`, but the extension's module shim `chrome-extension/tests/node-shims.d.ts` declares `node:assert/strict` with an `Assert` interface containing only `equal/deepEqual/notStrictEqual/ok/match` — **no `doesNotMatch`**. This is the *only* error in `npx tsc -p tsconfig.test.json` (exit code 2), and the extension's `npm test` script is `tsc -p tsconfig.test.json && node --test …`, so the whole extension test build **fails at the tsc gate**. CI runs `cd chrome-extension && npm test` (`.github/workflows/ci.yml:83-90`). The claimed "tests green" therefore does not hold for the extension side — this is a machine-checkable, CI-breaking defect introduced by the diff. (Fix is trivial: add `doesNotMatch(actual, expected, msg?)` to the shim or rewrite the assertion.)

### Non-blocking nits

1. `child.on("error")` (shell.ts:499) and pre-abort result (shell.ts:396) omit `exit_code`/`timeout_ms` present in the `close` payload — minor contract inconsistency.
2. `resolveShellTimeoutMs` is applied both in `executeCompanionTool` (server.ts:3705) and inside `shellExec` — redundant (idempotent).
3. win32 tree-kill has no test (timeout tree test skips win32) and no async-failure fallback re-kill if `taskkill` spawns but fails silently — best-effort, unlikely.
4. `shell.exec.abort` with a stale/mismatched `tool_call_id` falls back to whole-thread kill (could hit a newer run in the same thread); safe direction, `matched` in ack surfaces it — acceptable.
5. No integration test for the full WS `chat.abort`/`stop_thread` → server → registry wiring (only `shellExec`-level + registry-level tests).
6. `abortAllShellRuns` (shell.ts:75) is exported but unused in production code.

VERDICT: REJECT
