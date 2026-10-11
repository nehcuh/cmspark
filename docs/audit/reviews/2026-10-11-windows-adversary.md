# Windows reliability: independent adversarial review (#592)

Date: 2026-10-11. Reviewer: independent Codex adversary, not a production implementer.
Scope: `codex/windows-reliability` working/staged diff against `origin/main` / `2abb87f5`, including new files; R3/R4/R11 and `docs/superpowers/specs/2026-10-11-windows-reliability-592.md`.
Capability: T3; Surface L1/L2; existing shell/host-read/write gates; no outbound profile expansion.

## Initial blocking findings (resolved in incremental review)

### P1 — the installer still executes an unscoped daemon stop before its new scoped process filter

`scripts/installer.nsi:65–67` invokes the installed bundle's `daemon stop`. In `companion/src/index.ts:202`, `handleDaemonStop` reads `getPidFilePath()`, tests only whether that PID exists, and calls `process.kill(pid, "SIGTERM")` (later SIGKILL). `companion/src/config.ts:1576` resolves that PID file under the user-global data directory, independent of the installation directory. It does not establish that the process belongs to `$INSTDIR`, or even that the reused PID is still a CMspark daemon.

Consequently an upgrade/uninstall of installation A can kill installation B's daemon, or a different process occupying a stale PID, **before** the new PowerShell boundary check executes. Filtering the later CIM loop does not contain the earlier action. This contradicts the stated installation-scoped stop DoD.

The new `win-installer-stop-smoke.ps1` extracts only the PowerShell expression, so its sibling-survival check cannot exercise this path. Remove the unscoped preliminary stop or replace it with an installation-scoped identity mechanism. Validate the complete stop sequence against a sibling-owned PID record, not only its final expression.

Evidence is a direct production call-chain read; this reviewer did not kill any process or run an installer.

### P2 — PTY close reports completion and allows a second PTY before cleanup finishes

`companion/src/pty/session.ts:200` clears `live` before `killWindowsPtyTree` completes; `:222` emits `terminal.closed` immediately. Meanwhile the new cleanup deliberately keeps the original root alive until taskkill finishes or its five-second timeout expires. `spawnPtySession` gates exclusivity only on `live` (`:313`). This now creates a window with two live terminal roots and a misleading completion event after explicit cancellation, owner disconnect, or heartbeat cleanup.

Independent probe used the actual compiled session module, injected synthetic handles and a held cleanup callback. No OS process was spawned or signalled. Observed output (exit 0):

```json
{"first":{"ok":true,"pid":10000},"second":{"ok":true,"pid":10001},"oldHandleKilled":false,"pendingCleanup":[10000],"closedFrameBeforeCleanup":true}
```

Maintain an explicit closing/busy state until cleanup releases the handle, and report completed close at that boundary. Prevent stale callbacks from clearing a newer session. Regression should hold cleanup, attempt another spawn, then release cleanup and verify exactly one terminal-close event and successful subsequent spawn. Cover the timeout path with controlled timers; current helper tests cover error/close but not the five-second bound.

### P2 — natural process exit still starts a fresh taskkill against the exited numeric PID

`handle.onExit` at `companion/src/pty/session.ts:455` calls the same `closeLive` path, which invokes `/PID ... /T /F`. The root is already known to have exited; a new numeric-PID lookup is not an ownership proof. The native implementation's process-handle retention/PID-reuse lifetime is not established by this patch. A stale numeric PID must not become permission to kill a subsequently assigned process.

The independent session probe also fired the synthetic natural-exit callback and observed `naturalExitScheduledTaskkill:true`. This proves post-exit taskkill scheduling, **not** that Windows actually reused a PID or an unrelated process was killed.

Distinguish natural exit from explicit cancellation. Natural exit should release the owned PTY handle without starting a new bare-PID tree kill. If descendant cleanup after root exit is required, it needs retained process/job ownership, rather than a fresh PID-only command. Add an onExit regression asserting no tree-kill spawn.

## Other challenged boundaries

- **Installer scope:** the new environment-carried root avoids PowerShell quote injection, and the trailing directory separator prevents sibling-prefix matches. The image-name filter prevents arbitrary executable names under the installation from being indiscriminately killed. CIM enumeration followed by `Stop-Process -Id` still has a small PID lookup race; no claim of retained OS process ownership should be made.
- **File TOCTOU:** one Known Folder/canonical-root snapshot per operation prevents the resolver changing authority between checks. Lexical checks plus canonical target checks reject static nested junction/symlink escapes. A separate local process can still alter a junction between `realpathSync` and `statSync`/`renameSync`; synchronous JavaScript avoids in-process awaits, not external filesystem races. This is a residual inherited path-based confinement limitation, not newly demonstrated exploitation. Do not describe it as race-proof containment.
- **Known Folders:** fixed GUIDs, no caller-supplied script values, fail-closed parse/path validation, and skipping unavailable canonical roots fit the intended compatibility boundary. A legitimate Known Folder junction is correctly compared against its resolved root, while nested escape fixtures fail.
- **Cancellation timeout/PID reuse:** error listeners and once-only release improve the previous uncaught-error behavior. The taskkill timeout needs a machine test; already-sent process termination cannot be presented as a reversible cancellation. Natural exit is the blocking issue above.

## Outcome, trajectory and component assessment

Outcome: launcher quoting and Known Folder compatibility have meaningful implementation and test coverage; installation scoping and PTY completion/identity have the remaining gaps above.
Trajectory: source changes stay within the Windows batch. Packaging-test physical-path normalization is a fixture correction, not a weakened release guard. No unrelated permission profile changes were found.
Components: installer macro/CLI daemon-stop composition; PTY session lifecycle above the new helper; Known Folder resolver and file adapter. Helper-only tests do not substitute for testing their callers' ownership and completion semantics.

## Machine evidence and limits

Inspected `/tmp/cmspark-windows-targeted.log` and `/tmp/cmspark-windows-arm64.log`: 106 tests, 101 pass, 5 skip, 0 fail, 0 cancelled. Inspected `/tmp/cmspark-windows-package-gates.log`: 156 pass, 0 fail. NSIS compile success was supplied by the implementation agent and its compile log is available at `/tmp/cmspark-windows-nsis-compile.log`.

Independent compiled-session probe exited 0 with the two observations quoted above. Native Windows CI is pending. These results do not certify an interactive ConPTY session, real redirected/OneDrive account, native PID reuse behavior, Office/UIA, or complete NSIS upgrade/uninstall.

## Four-line regression case

1. Close an injected Windows PTY while tree cleanup is held, then immediately spawn another session; separately emit a natural exit.
2. A second session starts before the first handle is released, and natural exit schedules a numeric-PID taskkill.
3. Attribution: lifecycle integration gaps above an otherwise safer cleanup helper.
4. Protect: truthful terminal completion, one live terminal root, and process-ownership boundaries.

VERDICT: REJECT

## Incremental review: blockers resolved

The rejection above is retained as review history; the verdict below applies to the corrected frozen source.

- **Installer:** the entire production stop macro no longer calls `daemon stop` or image-wide taskkill. Its only process termination path is the installation-scoped CIM filter. The Windows smoke now extracts and compiles the complete macro into a disposable NSIS harness, runs it against owned inside/sibling runtime fixtures, and rejects reintroduction of the unscoped command patterns. CI installs the pinned NSIS version if necessary. This closes the earlier test/production composition gap; native execution evidence remains a required CI gate.
- **PTY closing:** a distinct `closing` slot reserves exclusivity after `live` is revoked. Input, resize, ACK, ownership lookup, data and prefill no longer target a closing session. The handle is released and `terminal.closed` emitted only at cleanup completion. The completion callback checks object identity, making duplicate/late completion unable to clear a newer session.
- **Natural exit:** the callback now marks `exited:true`, skips both numeric-PID tree kill and a redundant kill of the exited native handle, and finishes the session using the actual exit code. Natural exit during explicit cleanup does not schedule a second taskkill.
- **Bounded fallback:** a fake-timer regression exercises the five-second helper timeout, asserts only the owned taskkill child is killed, and verifies late error/close events do not release twice.

Independent updated compiled-session probe (exit 0) confirmed: a held cleanup blocks a second spawn and input; there is no early closed event; completion releases once; a duplicate completion preserves the subsequently opened session; natural exit schedules no tree kill and no handle kill. No OS process was created or signalled by that probe.

Fresh inspected host and arm64 logs report **109 tests, 104 pass, 5 skip, 0 fail, 0 cancelled**. The NSIS compile log ends with a successfully generated disposable installer. Packaging evidence remains 156 pass. The reviewer has made no source/test changes in this worktree.

No remaining code blocker found for R3/R4/R11 under the stated scope. The residual filesystem TOCTOU and CIM PID-lookup limitations above are unchanged; this does not certify race-proof OS ownership. Native Windows launcher/NSIS/Known Folder/process-tree CI is still required before merge, followed by the project's Pi confirmation. No interactive ConPTY/UIA/Office or OneDrive policy mutation claim is made.

VERDICT: APPROVE

## Issue #593 incremental review on main `50c04f25`

This pass is read-only for production/test files and examines existing logs. It does not execute Windows scripts, terminate processes, read real user configuration, or access Known Folder contents. The supplied frozen code-diff SHA-256 was independently read as `23c6f5dcc8e43ec2a75ea9a7daecd203361ec526f3c00cb4a2b6bb244cdbd917` in `/tmp/cmspark-windows-593-code.diff`. The implementation validation report and host/arm64/build/package logs were read first. Both target suites report 110 tests, 105 pass, 5 skips, zero failures; package gates report 156 pass. Native Windows CI is still pending.

### P1 — canonical Known Folder roots can still authorize a whole volume

Location: `companion/src/host-use/win/adapter.ts:117`, with the lexical-only rejection at `companion/src/host-use/win/known-folders.ts:22–24`.

The resolver rejects normalized drive/share roots, but rootPaths accepts the result of realpathSync without applying the same restriction. A Known Folder returned as `C:\Users\u\Documents` therefore passes validation even if that directory is a junction to `D:\`. The snapshot records `realPath: D:\`; isWithinRoot at adapter.ts:84–87 accepts every canonical descendant of that volume, and list/read/move use this snapshot. Access through the Documents alias can then reach arbitrary files on the volume. This is a deterministic static junction case, not the already documented check/use race. It defeats #593's explicit refusal to authorize an entire volume/share.

Required correction: reject or exclude canonical roots that normalize to a filesystem volume/share root, before publishing the per-operation snapshot. Add injected-filesystem regressions for a Known Folder junction to a drive root and UNC share root, checking that list/read/move do not operate. No real junction creation or user folder mutation is needed.

### Other incremental findings and checks

- `companion/uninstall.bat:2,13–15` disables delayed expansion and passes the installation path as environment data to a pinned PowerShell executable. Its trailing separator and case-insensitive ExecutablePath prefix prevent identically prefixed sibling installations from matching; node/SEA image filtering is installation-scoped. No shared daemon.pid or image-wide termination remains in this process-stop path. Existing shared scheduled-task/shortcut removal and optional user-data deletion are separate, pre-existing uninstall operations; this review does not describe the entire uninstaller as confined to installation files.
- `scripts/tests/win-uninstall-smoke.ps1:7–29,35–55` builds owned runtime fixtures under a random temporary root, copies the full BAT, supplies isolated APPDATA/USERPROFILE and substitutes native schtasks/chrome no-op executables via a fixture-first PATH. Its working directory is temporary, and its data-removal answer is N. Assertions cover owned process termination, sibling survival, fixture shortcut/log removal and retained declined data. Cleanup targets retained fixture process objects and the generated temporary root. No test step reads or deletes the real user's data directory.
- `scripts/tests/win-installer-stop-smoke.ps1:32–55` compiles only the complete production stop macro into a disposable harness, sets its installation root to the owned fixture and checks sibling survival. It does not execute installation/uninstallation registry sections. The native Known Folder test performs API resolution only; the real tree-cleanup test creates its own Node parent/child pair. Existing PID enumeration/termination races remain explicitly bounded claims, not process-handle identity guarantees.
- `companion/src/pty/session.ts:213–247` writes terminal.close audit synchronously after reserving closing and before asynchronous cleanup. The held-callback regression at `companion/tests/pty-terminal.test.ts:140–144` asserts exactly one audit while cleanup is pending, while the closed frame remains deferred. This closes the requested audit timing gap without releasing PTY exclusivity early.
- `.github/workflows/ci.yml:225–241` runs installer and ZIP uninstall native smoke, compiles tests, and invokes the isolated test runner with Windows reliability, host adapter, PTY and ACP Windows spawning suites. Non-Windows passes cannot replace this native gate.

The canonical-root finding above is the sole new blocker. Other conclusions from the earlier resolved review remain in effect. Outcome: #593 is not yet complete for junction-backed volume/share roots. Trajectory: scoped incremental repair with real production script coverage; component gap is the resolver-to-adapter authority handoff.

VERDICT: REJECT

### Issue #593 final reassessment: canonical-root blocker resolved

The preceding incremental rejection is historical. The corrected frozen code-diff SHA-256 is `725c185c2be6b1af52e2d0c4d776c21c352f543ffa7d0515144d5c1b76406747`, independently read from `/tmp/cmspark-windows-593-code.diff`.

`companion/src/host-use/win/adapter.ts:118–121` now normalizes the canonical realpath and excludes filesystem roots before constructing the authorization snapshot. A Known Folder junction to a drive/share root cannot authorize list/read/move. The injected regression at `companion/tests/host-use-win-adapter.test.ts:128–143` verifies all three entry points reject or return no targets and records zero rename calls. It covers the host-native volume root, with a Windows-only UNC-share variant; the existing permitted-junction-child and denied-nested-escape test remains intact. No real user directory or junction was accessed during this review.

Inspected final host and fresh arm64 logs: **111 tests, 106 pass, 5 platform skips, zero failures/cancellations** in each. The new canonical-root regression is present and passing in both logs. The implementation agent additionally confirmed both execution sessions exited 0. Production build passed; unchanged packaging gates remain 156 pass. `git diff HEAD --check` passes. This reviewer only read source/logs and changed this report, without executing installers, uninstallers, Windows scripts or process-management actions.

Outcome: the #593 additions satisfy the reviewed code-level scope, including installation-scoped runtime stopping, lexical and canonical root rejection, prompt close auditing and isolated native smoke fixtures. Trajectory: the additional authority-handoff gap was identified, fixed and protected by permanent fixtures before approval. Components: no unresolved blocking finding remains in the newly reviewed BAT, smoke harness, Known Folder adapter, PTY audit or CI selection paths.

Residual CIM PID lookup and filesystem TOCTOU limitations remain as documented. This approval does not establish native Windows success: the full native CI matrix, final Pi rereview and merge gates must still pass. It does not claim a full NSIS upgrade/uninstall or interactive ConPTY/UIA/Office validation.

VERDICT: APPROVE
