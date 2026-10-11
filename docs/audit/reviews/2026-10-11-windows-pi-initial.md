## Pi final independent review — frozen Windows batch #592 (R3/R4/R11)

**Read-only confirmed**: no repo file modified by this review (all artifacts in `/tmp`; `git status` entry count unchanged at 21 = 19 changed + 2 pre-existing untracked).

### 0. Frozen-surface identity (verified, not assumed)

- `git diff HEAD` == `/tmp/cmspark-windows-frozen.diff` byte-for-byte, SHA-256 `37d1874553aa…586e1f`, 19 files / 682+/94−, base `2abb87f5`. The diff handed to me is the real tree.
- Compiled surface is current: `tsc -p tsconfig.test.json` into a temp outDir produces **byte-identical** `.test-dist` for `session.js`, `windows-tree.js`, `known-folders.js`, `adapter.js`, and the 3 new/changed test files → the reported evidence corresponds to this source.
- Kimi's recorded `603ce40d…` resolves: it is `git diff HEAD -- . ':(exclude)docs'` — i.e. the **code-only** surface of this same revision (docs-only edits landed after 12:49:46). Both independent reviews cover the identical code surface.

### 1. Adjudication of the adversary's initial findings (against CURRENT source)

| Finding | Verdict | Evidence |
|---|---|---|
| **P1** installer ran unscoped `daemon stop` + image-wide `taskkill /IM` before its scoped filter | **RESOLVED** | `scripts/installer.nsi:64-70` — whole macro (`StopInstalledAgentUnshared`, used by install and uninstall) has exactly one termination path: env-carried root + CIM filter. `grep` for `daemon stop`, `/IM`, `taskkill` in installer.nsi → 0 hits. Smoke now extracts the **complete** macro and rejects reintroduction (`win-installer-stop-smoke.ps1:20-24`). No register clobber hazard: `$0/$1` are reassigned before use in both sections (`:101`, `:130`). |
| **P2** close emitted `terminal.closed` and freed the slot before cleanup finished | **RESOLVED** | `session.ts:83` `closing` slot; `isPtyBusy():136` covers it (`spawnPtySession:336`); `finish()` (`:218-241`) is the only place that releases the handle, clears `closing`, audits and emits; identity guard `closing !== s` (`:219`) makes duplicate/late completion harmless. Data/input/resize/ack/context all key off `live` → all reject while closing. Test asserts no closed frame and `terminal_busy` before release. |
| **P2** natural exit scheduled a fresh numeric-PID taskkill | **RESOLVED** | `onExit` (`:480`) passes `exited:true`; `:243` short-circuits to `finish()` which skips both taskkill and the redundant handle kill; regression asserts `treeKills === 0`, `killed === false`, closed code 7. Natural exit during an in-flight cleanup is a no-op via `if (live !== session) return`. |
| Bounded fallback / async startup error | **RESOLVED** | `windows-tree.ts:11-26` — once-only `release`, `error`+`close` listeners, 5 s timer kills **only** its own taskkill child; fake-timer + ENOENT/first `close` tests cover all three. |
| File TOCTOU; CIM enumerate→`Stop-Process -Id` | **CONFIRMED AS RESIDUAL** (unchanged, and honestly documented) | `adapter.ts` lexical+canonical checks per op; `installer.nsi:67` PID lookup race. Docs/`known-folders` comments do **not** claim OS-handle ownership or race-proof containment. |

### 2. DoD verification (source-level, independent)

- **Launcher special-char paths**: `launch-hidden.vbs` now puts `NODE_PATH` in the *process* env and `Run`s the runtime directly — the path never enters cmd syntax; `launch.bat` uses `setlocal DisableDelayedExpansion` with no `!VAR!` left and a quoted `start "" /MIN "%LAUNCH_EXE%"` fallback + `NODE_PATH=%~dp0`. Guarded by `S1/S2` with a special-name state and new BAT with/without VBS (`win-launcher-smoke.ps1:455-478`). ✅ logic verified; native execution pending.
- **Installer stop restricted to its installation**: ✅ (see P1 above). I additionally **compiled both artifacts with local makensis 3.12**: full `installer.nsi` → rc 0 (`CMspark-Setup-v0.6.13.exe`, 82 843 B) and the exact harness template from the smoke with the live macro → rc 0.
- **PTY lifecycle**: one slot through cleanup ✅; no early closed / late-callback corruption ✅; natural exit never taskkills an exited PID ✅ (`session.ts:213-252,480`).
- **Known Folders / containment / no cached authority**: fixed GUIDs `FDD39AD0…`/`B4BFCC3A…`/`374DE290…`, `KF_FLAG_DONT_VERIFY 0x4000`, fail-closed parse (`known-folders.ts:16-22`), one root snapshot per operation (`adapter.ts:112,151,226,295`; test asserts `resolutions === 1 per op`), canonical check now on the **target** for list/read (`:163,:234`) — closes the previous symlinked-*file* escape — and production never uses the `%USERPROFILE%` guess (`getWinAdapter()` → no `userProfile`). ✅
- **Evidence reproduced on current source (by me)**:
  - host (Node 22.23.2, macOS arm64): **109 tests / 104 pass / 5 skip / 0 fail / 0 cancelled** (4 targeted files);
  - fresh `cmspark-cooperation-validation:590` **aarch64** container, current src/tests copied in, container's own `node_modules`, tsc 5.9.3: **109 / 104 / 5 / 0 / 0**;
  - `test-package-gates.sh`: **156 passed, 0 failed**;
  - makensis 3.12 compile: rc 0 (above).
- **Capability/scope**: no permission-profile, grant, outbound or capability-gate file in the diff; terminal `user_gesture` + host-approval gates untouched; T3 classification unchanged. Docs update the *authority source* for fs roots (OS policy) without widening the capability class. ✅

### 3. My additional findings (none blocks the frozen diff)

1. **[P2 — pre-existing, same class, outside frozen diff] The shipped zip uninstaller still does machine-wide kills.** `companion/uninstall.bat:13-14` runs `taskkill /f /im node.exe` and `/im cmspark-agent.exe`, and `scripts/package.sh:564` ships it in the official Windows zip. That is the identical antipattern this batch removed from NSIS and will SIGKILL unrelated Node processes (dev servers, editor helpers) with no user expectation. Recommend an issue (Issue-first) + next-batch fix mirroring the installer (env-carried `%~dp0` + image-name + CIM path filter).
2. **[P2 — source-confirmed gap] `resolveKnownFolders` accepts a volume root, which silently authorizes a whole volume.** I executed the compiled module: `documents:"C:\\"` is **accepted** (`path || /^[a-z]:[\\/]/` and `win32.isAbsolute` both pass), and with `path.sep === "\\"` the `isWithinRoot` trailing-separator branch makes `C:\Windows\System32` "inside" `C:\`. `KF_FLAG_DONT_VERIFY` means the value is trusted as configured, so a redirected/registry-configured Documents of `C:\` (or `\\server\share\`) widens the allowlist from 3 folders to an entire volume. Both sibling-prefix protections are correct (verified). Fix: reject `path.win32.parse(v).root === v` (and share roots) + a negative test. Low likelihood, cheap, defense-in-depth; the capability class does not change.
3. **[P2 residual, unverified] Natural exit no longer calls `handle.kill()`.** On Unix I confirmed in the vendored binding that `kill()` is only `process.kill(pid, SIGHUP)` and `_onProcessExit → _close()` closes the pty regardless, so behavior is unchanged for darwin. The Windows @lydell/node-pty `WindowsPtyAgent.kill()` may also tear down the ConPTY socket; that is **not** established by this patch, and the pending Windows CI test only covers taskkill of a *live* owned tree. Add one Windows assertion (no orphaned conhost/OpenConsole child per natural exit) or file a follow-up. Exposure is bounded (one PTY at a time).
4. **[nit] `terminal.close` audit is now deferred on win32** (it lives inside `finish()`, `session.ts:225`, i.e. after taskkill/5 s). Previously the audit was synchronous at close. If the companion exits inside that window the close is never audited, and the exit hook (`killAllPty`) does not cover a pending `closing` session at all. Cheap fix: audit at `closeLive` entry, emit the frame at completion.
5. **[nit] CI runs 3 of the 4 targeted files** (`ci.yml:238`); `acp-win-spawn.test.js` (which is the file whose win32 tests are skipped everywhere else) is compiled but not executed on Windows, so the "109-test" evidence is not the CI shape. Add the 4th path (or `npm test`).
6. **[nit] NSIS pin is conditional** (`ci.yml:228`): a runner image already carrying a different makensis skips the 3.12 install.
7. **[nit, pre-existing] `capability/shell.ts:99-104` still spawns PATH-resolved `"taskkill"` with no async `error` listener** — a missing/hijacked taskkill would either raise an uncaught `error` event or run an attacker-chosen binary; `windows-tree.ts` is the right shape to reuse. Follow-up ticket, do not expand this freeze.
8. **[operational, must be handled at commit] `companion/node_modules` is a symlink into your home directory and is NOT gitignored** (`git check-ignore` → not ignored, `--porcelain` shows `??`). `git add -A` would commit it. Also `docs/audit/reviews/2026-10-11-windows-kimi-final.md` is untracked and **outside** the frozen diff — include or drop deliberately (its recorded hash covers the docs-excluded diff; that should be stated if it is committed).

### 4. Behavior deltas / regressions reviewed

`%USERPROFILE%\…` → policy-redirected Known Folders (intended; previously a redirected Documents was invisible, now visible — and one resolver failure now fails all fs ops, an accepted fail-closed availability trade-off); per-op PowerShell spawn (latency unmeasured, intentionally uncached per DoD); files/symlinks resolving outside the roots are now hidden/refused (tightening); installer now force-kills this installation's runtimes instead of a graceful `daemon stop` (no graceful SIGTERM path remains on upgrade — acceptable per the scoping requirement, worth noting for unflushed-write risk); a "terminal_busy" window of ≤5 s after closing a Windows tab (the embed intent is correctly put back, `handler.ts:232`). No gate, profile or wire-contract change.

### 5. Not certified (matching the stated limits)

No native Windows execution is inferred: launcher matrix, full NSIS macro execution, KnownFolder API, real process-tree kill, interactive ConPTY/UIA/Office, OneDrive policy mutation, or PID-reuse reality remain **pending CI**. Filesystem TOCTOU and CIM PID-lookup are residual path-based-confinement limitations, not proven OS-handle ownership. KnownFolder helper latency is unmeasured by design.

### VERDICT

**APPROVE** (confidence: high on the frozen diff and evidence — 0 × P0, 0 × P1; all three initial blockers verified resolved against current source and both artifacts compile with makensis 3.12; 109/104/5/0 reproduced on host *and* fresh aarch64 container; 156/156 gates).

Conditions attached to the approve (not new code work for this batch):
1. `companion/node_modules` must not be committed (see finding 8).
2. The new `smoke (windows-latest)` step must actually go green before merge; no Windows behavior may be asserted from macOS/linux results.
3. Findings 1 and 2 should be filed as issues (Issue-first) and fixed next — finding 1 (zip `uninstall.bat` image-wide `taskkill`) is the highest user-impact residual I found and is the same class this batch fixed elsewhere.
