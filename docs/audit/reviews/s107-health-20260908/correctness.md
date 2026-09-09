# Lane B — CORRECTNESS (s107-health-20260908)

Independent adversarial pass. Read-only except this file. HEAD `4a63de56` (main), product lockstep **0.6.6**. Evidence tagged `[executed]` (ran installed CLI / listed INSTDIR) or `[inspected]` (read the code path). Did not treat prior review files as truth.

## Verdict

**APPROVE_WITH_NITS**

No BLOCK-class data-loss or wrong-thread bug was evidenced in the live code paths named below. Several **MAJOR** user-visible CLI / Windows launch-diagnostic contracts are broken, plus packaging overlay leftovers and residual test-isolation holes. None of those currently corrupt user `config.json` through the official `npm --prefix companion test` runner.

## Summary

- **Packaging (Windows NSIS)**: official producer refuses SEA; installer deletes leftover `cmspark-agent.exe`; VBS prefers `node.exe + cmspark-agent.js`. INSTDIR has **no** SEA. `@lydell/node-pty` (win32-x64), onnxruntime-node napi `win32/x64` only, whisper exe + sibling DLLs are present. `File /r` overlays and **does not wipe** INSTDIR → leftover `gif.jpg` / `gifcode_test` from Aug 30 remain by design of the installer, not a staging bug.
- **CLI**: `cmspark-agent --version` is not a command (`Unknown command`, exit 1) after printing the usage banner. `status` / `stop` are documented in usage and unimplemented. Recommended `tray` never writes `daemon.pid`, so `tray status` / `daemon status` cannot see a tray-started companion.
- **#432 terminal**: default-off, user_gesture + always-on `requestConfirmation` (not l2-admission skip), plan_readonly deny, cwd containment, env strip of `CMSPARK_*` / `api_key` / `ws_secret`. Darwin-only with an honest Windows `unsupported` frame.
- **#291/#307/#308**: `chat.abort` returns `{stopped, cancelled}`, `clearNextRun` on user stop, generation CAS on `drainNextRun`. UI helpers disclose cancelled and do not clear busy on `stopped === false`.
- **Knowledge**: exact-dup gate is server-side (`force !== true` → `knowledge.import_rejected`); PDF path uses `readAsDataURL`; organize lane fails as `ok` + `organize_error` (does not kill the canvas).
- **#423**: Python worker and TS `normalizeQwenVlPoint` both map `v/1000 * W/H` then clamp; TS parse layer calls the helper.
- **#483/#485**: ACP control verbs reject wrong `thread_id` before side effects; store events cannot borrow the active thread as owner; UI status/apply/start feedback is owner-gated.
- **#404 isolation**: official runner `--require test-data-dir.cjs` pins a live `CMSPARK_DATA_DIR` per process. Residual: files that `delete process.env.CMSPARK_DATA_DIR`, modules still importing frozen `DATA_DIR`, and direct `node --test` without the preload.

## Findings

### C-01 — MAJOR — `cmspark-agent --version` is not a command

**Evidence** `[executed]` INSTDIR `%LOCALAPPDATA%\CMspark`:

```
cmspark-agent v0.6.6
Usage: …
Unknown command: --version
exit=1
```

`[inspected]` `companion/src/index.ts:469-491`: only `-h` / `--help` are handled; `--version` falls through `default` → `Unknown command: ${command}` + `printUsage()` + `process.exit(1)`. Usage header hardcodes `cmspark-agent v0.6.6` (`index.ts:31`) and does **not** list `--version`.

**Impact**: Version probes (scripts, support, `cmspark-agent --version` after install) fail with exit 1. The banner already printed the version, then contradicted itself.

**Fix hint**: Accept `--version` / `-V` (and optionally `version`) before the unknown-command path; print one line and exit 0. Prefer `companion/package.json` over a hardcoded string.

### C-02 — MAJOR — Documented `status` / `stop` are stubs

**Evidence** `[executed]` `cmspark-agent status` → `Status command not yet implemented (use 'daemon status' instead)` exit 0.

`[inspected]` `index.ts:34-36` usage advertises:

- `cmspark-agent start` 启动 Companion
- `cmspark-agent stop` 停止 Companion
- `cmspark-agent status` 查看服务器状态

`index.ts:334-340` both `stop` and `status` print “not yet implemented” and exit 0.

**Impact**: The first three commands in the usage block are a lie (`start` works; `stop`/`status` do not). Exit 0 on a no-op `stop` is worse than exit 1 — callers think the server stopped.

**Fix hint**: Implement `status` against the live listen port (not only `daemon.pid`), or remove the commands from usage and exit 1 with the existing “use daemon …” pointer.

### C-03 — MAJOR — Tray-started companion is invisible to `tray status` / `daemon status`

**Evidence** `[inspected]`:

- `writePidFile` is only called from `handleDaemonStart` (`index.ts:182`). `menu-bar-agent.ts` and `ws/lifecycle.ts` never write `daemon.pid`.
- Official Windows start is tray: `installer.nsi:144-146` `StartAgent` → `launch-hidden.vbs` → `cmspark-agent.js tray` (`companion/launch-hidden.vbs:22-23`).
- `handleTrayStatus` (`index.ts:88-89`) and `handleDaemonStatus` (`index.ts:268-273`) both key “running” off `daemon.pid` + `isProcessRunning`.

`[executed]` after this install tree: `daemon.pid` contains stale `17588`; `daemon status` → `Process: dead (stale)` exit 1; `tray status` → `Companion: 已停止` while printing `WebSocket: ws://127.0.0.1:23401`. No cmspark node process was alive at replay time (open question below), but the **code contract** is independent of that: a healthy tray session never creates the PID file these commands read.

**Impact**: The recommended Windows launch path cannot be diagnosed with the recommended status commands. Support/scripts conclude “not running” while the Side Panel is connected.

**Fix hint**: `startServer` / tray should write (and clear) `daemon.pid`, **or** status should probe `ws://127.0.0.1:${port}` / named-pipe lock instead of the PID file. Use `isDaemonRunning` (or a tray-command-line check) if PID identity is kept.

### C-04 — MAJOR — `daemon status` still uses recycled-PID-unsafe `isProcessRunning`

**Evidence** `[inspected]` `handleDaemonStart` (`index.ts:134-139`) documents the Windows recycle hazard and uses `isDaemonRunning`. `handleDaemonStatus` (`index.ts:268`) and `handleTrayStatus` (`index.ts:88-89`) still use `isProcessRunning`. `isDaemonRunning` (`daemon.ts:330-336`) requires the command line to contain both `cmspark` and `daemon`.

**Impact**: A stale `daemon.pid` whose PID was reused by `RuntimeBroker.exe` (the example in the start-path comment) makes `daemon status` / `tray status` report **running**. Conversely, a live **tray** process would fail `isDaemonRunning`’s `daemon` substring even if status were switched over blindly — any fix must accept tray command lines (`cmspark-agent.js tray`).

**Fix hint**: Share one liveness helper: PID alive **and** command line matches `cmspark` + (`daemon` OR `tray` OR `start`). Unavailable command line → not running (same fail-open as `isDaemonRunning` today).

### C-05 — MAJOR — `daemon logs` ignores `CMSPARK_DATA_DIR` / `getConfigDir()`

**Evidence** `[inspected]` `index.ts:282-283`:

```ts
const logDir = path.join(require("os").homedir(), ".cmspark-agent", "logs")
```

`getLogDir()` (`config.ts:1543-1545`) is `path.join(getConfigDir(), "logs")` and is live-env aware (`config.ts:1537-1540`).

**Impact**: Custom data-dir installs and tests that retarget `CMSPARK_DATA_DIR` get empty/wrong logs. On Windows this is also the only logs command in usage.

**Fix hint**: Use `getLogDir()`. Do not use `os.homedir()`.

### C-06 — MAJOR — Residual test isolation holes (not #404 live-write via official runner)

**Evidence** `[inspected]`:

- Official runner **does** isolate: `companion/scripts/run-tests.mjs:56-59` `--require scripts/test-data-dir.cjs`; preload (`test-data-dir.cjs:10`) sets `process.env.CMSPARK_DATA_DIR = mkdtemp(CMSPARK_TEST_RUN_DIR/process-*)`. Comment in `run-tests.mjs:10-11`: direct `node --test` bypasses this.
- `getConfigDir()` is live (`config.ts:1537-1540`). Frozen `export const DATA_DIR` (`config.ts:19`) is still imported by `user-env.ts:10,148` (default path for `user-env.json` writes), `computer/evidence.ts:25,91`, `computer/qwen-vl-download.ts`, `computer/python-runtime.ts`, `computer/unattended-grant.ts`.
- Tests that `delete process.env.CMSPARK_DATA_DIR` then import config (e.g. `companion/tests/daemon.test.ts:28-31`, `tests/integration/daemon-cli.test.ts:10-12`) fall back to `os.homedir()` — **Windows ignores `HOME`** (comment already in `adapter-usage.test.ts:23-25`). `adapter.test.ts:16-30` / `adapter-recovery.test.ts:18-31` / `history.test.ts:13-20` set `HOME` only and call `initDataDir()`. Safe under the preload; unsafe as a standalone `node --test` file on Windows.
- `initDataDir()` (`config.ts:658-661`) writes `config.json` only when missing — so a developer’s existing live file is not overwritten by `initDataDir` alone, but `saveConfig` / `HistoryStore` / `user-env` writes against frozen `DATA_DIR` still can be.

**Impact**: Official `npm --prefix companion test` is not the 0.6.0 #404 accident. Direct test invocation on Windows, and any module still using frozen `DATA_DIR` after a live env retarget, can still touch `%USERPROFILE%\.cmspark-agent`.

**Fix hint**: (1) Make frozen `DATA_DIR` a function or alias of `getConfigDir()`. (2) Ban `delete process.env.CMSPARK_DATA_DIR` without an immediate re-pin, or teach those tests to assert path *shape* with a stub. (3) Keep the preload; fail tests that import `config` before the env pin.

### C-07 — NIT — NSIS overlay leaves previous INSTDIR files

**Evidence** `[inspected]` `installer.nsi:87-94`: `StopInstalledAgent` + `Delete "$INSTDIR\cmspark-agent.exe"` then `File /r "..\dist-package\cmspark-windows-x64\"` with no `RMDir /r` of INSTDIR first. Uninstall *does* `RMDir /r "$INSTDIR"` (`installer.nsi:140`).

`[executed]` INSTDIR still contains `gif.jpg` and `gifcode_test` (dated from an earlier tree). Staging / Setup payload do not need to include them for this to happen.

**Impact**: Upgrade ≠ replace. Stale assets can confuse support (“why is gif.jpg in CMspark?”). VBS already prefers `node.exe + js` over leftover SEA (`launch-hidden.vbs:21-23`); installer also deletes SEA. Not a launch defect.

**Fix hint**: Before `File /r`, delete known leftover names, or wipe INSTDIR except `uninstall.exe` / user data (user data is **not** in INSTDIR; it lives in `~\.cmspark-agent`).

### C-08 — NIT — Silent `/S` does not start the tray

**Evidence** `[inspected]` `StartAgent` is only `MUI_FINISHPAGE_RUN_FUNCTION` (`installer.nsi:48-50,144-146`). NSIS silent mode skips UI pages, so `/S` never calls `StartAgent`. Autostart is still written (`installer.nsi:109` HKCU Run → `launch-hidden.vbs`). No `IfSilent` Exec.

**Impact**: Silent / enterprise install waits until next logon (or a manual shortcut) for the tray. Interactive finish-page “Start CMspark now” works. Not a wipe/data bug.

**Fix hint**: `IfSilent` → `Call StartAgent` at the end of `SecMain` if product intent is “install and it is running”.

### C-09 — NIT — `printUsage` version string is hardcoded

**Evidence** `[inspected]` `index.ts:31` `cmspark-agent v0.6.6` vs `companion/package.json` `"version": "0.6.6"` (currently match). Packaging lockstep is `package.sh:53-59` companion vs extension, not CLI banner vs package.json.

**Impact**: Next bump can ship a lying banner without failing REL-4.

**Fix hint**: Read `require("./package.json").version` or inject at bundle time.

### C-10 — NIT — #432 env strip is narrower than CHANGELOG “密钥”

**Evidence** `[inspected]` `pty/env.ts:5-16` strips `CMSPARK_*`, exact `api_key`/`API_KEY`/`ws_secret`/`WS_SECRET`. Does **not** strip `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` from `process.env`. `getUserEnvVars()` is merged **in** (comment: “user-env secrets in, companion credentials out”). CHANGELOG 0.6.4 claims “env 剥离 CMSPARK_*/密钥”.

**Impact**: If the daemon process environment carries provider keys, the login PTY inherits them. User-env secrets are intended. Not a default-on terminal (C-12).

**Fix hint**: Strip `/_?API_?KEY$/i` and `*_SECRET` / `*_TOKEN` from the **inherited process.env** map; keep user-env injection as documented.

## Must-inspect results (contracts that hold)

### Embedded terminal #432 — default-off, L2, cwd, env

`[inspected]` Default `embedded_terminal.enabled: false` (`config.ts:579-581`). Open requires `user_gesture:true` and `enabled === true` (`pty/handler.ts:68-72`). L2 is `session.requestConfirmation` (`pty/handler.ts:118-122`) — **not** `l2-admission.ts`, so `auto_approve_dangerous` / domain whitelist / cruise cannot skip it. UI stores `auto_confirm_eligible: msg.auto_confirm_eligible ?? false` (`useWebSocket.ts:848`). `plan_readonly` denied (`handler.ts:89-91`). Darwin-only with honest `unsupported` on Windows (`handler.ts:74-81`, `session.ts:224-229`). Start cwd contained under workspace/sandbox (`pty/cwd.ts:36-40`). One live PTY (`session.ts:231-232`). CHANGELOG “Windows/Linux 另票” matches code; shipping `@lydell/node-pty-win32-x64` is dead weight until that ticket, not a false-enable.

### run_progress / chat.abort / nextRun (#291 / #307 / #308)

`[inspected]` `abortThreadChat(..., { clearQueue: true })` (`message-router.ts:2046`) → `clearNextRun` (`run-queues.ts:133-137`). ACK `{ type: "chat.aborted", thread_id, stopped, cancelled }` (`message-router.ts:2090`). `drainNextRun` generation-guards so an aborted predecessor cannot steal the queue (`message-router.ts:356-362,1382-1421`). UI `chatAbortedAckText` / `shouldClearBusyOnChatAborted` (`useWebSocket.ts:167-185`) match the ACK contract. `handleRunProgressToggle` does not coerce sticky `null` to `{items:[]}` (`handlers/run-progress.ts:18-21`). `chat.abort` also `flipAllComputerTaskAborts` (`lifecycle.ts:1192-1193`); CU is a **global single-task** mutex (`companion-dispatch.ts:1784-1800`) so this is not a cross-thread CU kill.

### Knowledge exact-dup / PDF / organize

`[inspected]` Preview hints `duplicate_of` (`message-router.ts:3773`); import without `force:true` returns `knowledge.import_rejected` and does not call `importKnowledge` (`message-router.ts:3828-3836`). UI “仍导入” is the only `force: true` path (`KnowledgeImportModal.tsx:201-203`). Browser file import uses `FileReader.readAsDataURL` of the whole file (`KnowledgeSubPanel.tsx:384-438`) — comment documents the old chunk-`btoa` PDF corruption. Organize is user_gesture + 2–19 lane; failures attach `organize_error` on an `ok` graph frame (`message-router.ts:3687-3743`), matching #427 “don’t kill the canvas”.

### Qwen-VL #423 `v/1000`

`[inspected]` `qwen-vl-worker.py:153-154` and `qwen-vl-coords.ts:26-27` both `round(v/1000 * dim)` then clamp. `gui-action-parse.ts:15,119-169` always runs points through `normalizeQwenVlPoint`. Tests in `computer-qwen-vl-coords.test.ts` pin in-bounds relative values (e.g. 174 on 640 → 111, not 174).

### Workspace / coding-handoff ownership #483 / #485

`[inspected]` `handleAcpWsMessage` (`acp/handlers.ts:52-91`): explicit `thread_id` that doesn’t match the session owner errors **before** cancel/prompt/followup/apply; replies carry stored owner; invalid explicit owner does not fall back to `ctx.threadId`. Reducer `ACP_SESSION_EVENT` (`agentStore.tsx:1738-1776`): unknown ownerless events ignored; existing owner is immutable. `codingMessageTargetsThread` (`useWebSocket.ts:27-29`) gates apply/start/denied status. `acp.handback.message` only `ADD_MESSAGE`s when `msg.thread_id === activeThreadRef.current` (`useWebSocket.ts:1608-1616`); the session-event dispatch still goes to the store, which is per-session-id / per-owner (tests in `coding-session-owner-483.test.ts`). `workspace.set` / `pick` bind the requested `thread_id` only (`message-router.ts:5119-5159`); UI `UPSERT_THREAD` requires `msg.thread.id` (`useWebSocket.ts:1462-1463`).

### Listen-first

`[inspected]` `attachWssListenThenStartMcp` (`ws/lifecycle.ts:444-456`): `httpServer.listen` then fire-and-forget `startMcp()`. Tests in `listen-first-mcp.test.ts` lock the source order.

## Packaging notes

| Item | Result |
| --- | --- |
| Version anchors | `installer.nsi:12-14` fallback `0.6.6`; `build-windows-installer.sh:22` reads `companion/package.json`; `package.sh:53-59` companion↔extension lockstep. |
| SEA | `build-windows-installer.sh:95-98` refuse staging `cmspark-agent.exe`; `installer.nsi:89` `Delete` leftover SEA. `[executed]` INSTDIR and `dist-package/cmspark-windows-x64` have **no** `cmspark-agent.exe`. |
| Overlay leftovers | See C-07. `[executed]` `gif.jpg`, `gifcode_test` still in INSTDIR. |
| `@lydell/node-pty` | `package.sh:217-220` copies `@lydell` tree. `[executed]` INSTDIR has `node-pty` + `node-pty-win32-x64` only (Windows optional-dep install). Terminal still darwin-gated (C-12 / must-inspect). |
| ORT napi strip | `package.sh:261-290,381`. `[executed]` only `napi-v6/win32/x64`. |
| Whisper DLLs | `package.sh:416-427` copy sibling `*.dll`. `[executed]` `bin/cmspark-whisper-win-x64.exe` + `ggml*.dll` + `whisper.dll`. |
| Silent `/S` start | See C-08. HKCU Run is written. |
| VBS launch | `node.exe + js` wins over SEA (`launch-hidden.vbs:21-40`). |
| NSIS INSTDIR apostrophe | Documented residual in `installer.nsi:64-65` (username `O'Brien` breaks the PowerShell GetFullPath quote). `daemon stop` + `taskkill` still run. |

## Open questions

1. **Companion liveness at review time.** Facts said ws `127.0.0.1:23401` LISTENING and systray2 running after the fresh NSIS install. This replay found **no** cmspark `node.exe`, port 23401 idle, stale `daemon.pid` `17588`, `tray status` = 已停止. Could be user-closed, crash, or C-03 making a live tray undiagnosable — not evidenced either way. Check `~\.cmspark-agent\logs\` / `vbs-launcher.log` if a crash is suspected.
2. **Is `--version` an advertised contract?** Usage does not list it; operators still type it. C-01 is MAJOR because exit 1 + “Unknown command” after printing a version banner is hostile, not because REL-4 claims `--version`.
3. **Silent install product intent.** If `/S` is only for CI unpack, C-08 stays NIT. If silent is how IT deploys, missing `IfSilent StartAgent` is MAJOR.
4. **Frozen `DATA_DIR` vs live env in production.** Production sets `CMSPARK_DATA_DIR` before process start, so import-time `DATA_DIR` equals live. The remaining blast is tests and late env mutation (C-06).

## BLOCK / MAJOR list (for the parent agent)

- **BLOCK**: none evidenced.
- **MAJOR**: C-01 `--version` unknown/exit 1; C-02 documented `status`/`stop` stubs; C-03 tray never writes `daemon.pid` so status lies; C-04 status uses recycle-unsafe `isProcessRunning`; C-05 `daemon logs` ignores `getConfigDir()`; C-06 residual isolation (official runner OK; standalone Windows tests / frozen `DATA_DIR` not).
