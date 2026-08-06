I have enough evidence to issue a verdict. Let me compile my findings.

---

## Review: shell-abort-timeout (working tree vs HEAD `018d346`)

I inspected the working tree (matched the patch), read `companion/src/capability/shell.ts`, `companion/src/server.ts`, `chrome-extension/src/...`, the test files, and the ADR-020 checklist; ran `node --test` for the new companion test (17/17 pass, including the POSIX grandchild marker test on Darwin) and `node --test` for the chrome-extension unit file (8/8 pass at runtime). Capability declaration is consistent with the change (L2 shell, single-thread Autonomy, no new Surface/Compose/Trust regression — abort is a safe direction and L2 `security_token` gate is unchanged at server.ts:3684-3690).

### Blocking issue

**1. `chrome-extension/tests/shell-card-utils.test.ts:100` breaks `npm test`.**
The new case uses `assert.doesNotMatch(formatShellMetaLine(card), /超时/)`. The repo has no `@types/node` in `chrome-extension`; instead `chrome-extension/tests/node-shims.d.ts:7-17` declares a hand-rolled `Assert` interface that exports `equal/deepEqual/notStrictEqual/ok/match` only — no `doesNotMatch`. Result:

```
$ npx tsc -p tsconfig.test.json
tests/shell-card-utils.test.ts(100,10): error TS2339: Property 'doesNotMatch' does not exist on type 'Assert'.
EXIT=2
```

`npm test` is `tsc -p tsconfig.test.json && node --test ...` (package.json `test`), so the `&&` halts before any test runs. I confirmed HEAD (without this PR) exits 0; with the PR it exits 2. The implementer's "tests claimed green" only holds if you bypass tsc and run `node --test` on emitted `.test-dist/...` directly — not the project's documented pipeline. Fix is one line: either extend `node-shims.d.ts` with `doesNotMatch(actual: string, expected: RegExp, message?: string): void`, or rewrite as `assert.ok(!/超时/.test(formatShellMetaLine(card)))`.

### Non-blocking nits

- `companion/src/capability/shell.ts:101-104` — win32 `taskkill` is spawned with `stdio:"ignore"` and never awaited; if it throws asynchronously after `spawn()` returns, the catch won't see it. POSIX is well-tested; win32 tree-kill has no test. Orphan risk on Windows is real but acceptable for this batch (bug report was POSIX-focused).
- `companion/src/server.ts:6408-6437` — `shell.exec.abort` without `tool_call_id` falls back to whole-thread kill. Any paired WS peer that learns a `thread_id` can stop shells in that thread. Acceptable because abort is a safe direction and L2 still gates execution, but worth a one-line note in the tool description that stop-by-thread is intentional.
- `chrome-extension/src/sidepanel/components/ChatView.tsx:623` — `useAgentStore()` is now subscribed inside `ToolCallCard`, so every tool card re-renders on agent-state changes. Minor; not load-bearing for this fix.
- No integration test for `chat.abort` → `executeCompanionTool({signal})` → `shellExec` end-to-end. Mitigated by defense-in-depth: `server.ts:6393-6404` calls `abortShellRunsForThread(tid)` directly on `chat.abort`, independent of signal plumbing.
- `companion/src/capability/shell.ts:461-467` — registry `set` and `signal.addEventListener` are sequenced after the pre-abort check; a signal that aborts in the gap between the `aborted` check (463) and `addEventListener` (466) would be lost. In practice `AbortController.abort()` schedules a microtask, so this is not reachable, but moving `addEventListener` before the registry `set` would make the ordering self-evidently safe.

VERDICT: REJECT
