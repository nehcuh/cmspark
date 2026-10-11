# Pi ordered final review (#592 / #593)

Executed after the complete incremental adversary report ended APPROVE.
Pi CLI exited 0. Original verdict follows unchanged. Editorial clarification:
makensis ran on macOS and generated a Windows PE harness, not a Mach-O installer.
Native Windows CI is still required; this was compile-only evidence.

## Scope

Read-only incremental T3/DoD review of #592 + same-class #593 on `codex/windows-reliability` @ **HEAD 50c04f25** (base/main `50c04f25`, frozen as staged+unstaged diff). No repo file written, no commit/push, no installer/uninstaller/Windows script executed, no real user config, Known Folder contents, scheduled task or browser touched. All my artifacts are in `/tmp`.

## Frozen-surface identity (verified, not assumed)

- I regenerated the code-only diff myself (`git diff HEAD -- .github/workflows/ci.yml companion/launch-hidden.vbs companion/launch.bat companion/src companion/tests companion/uninstall.bat scripts/installer.nsi scripts/tests`): `cmp` with `/tmp/cmspark-windows-593-code.diff` → **byte-identical**, SHA-256 `725c185c2be6b1af52e2d0c4d776c21c352f543ffa7d0515144d5c1b76406747` (matches the supplied hash). Re-ran after the whole review: still byte-identical → **no source drift during this pass**. The full diff's non-doc file set equals the tree's non-doc file set (`SAME`).
- `git diff --cached --name-only | grep node_modules` → **0**; `?? companion/node_modules` remains untracked/unstaged (25 status entries, unchanged). Nothing would be staged.

## Independent verification I actually ran

1. **Node `path.win32` semantics of the new canonical-root guard.** `/tmp/ptest.js` (disposable) against `path.win32.normalize` + `path.parse().root`:
   `C:\`→equal; `C:\Redirected`→not equal; `\\server\share`→normalize `\\server\share\` = root → equal; `\\server\share\`→equal; `\\server\share\folder\..`→equal; `\\server\share\sub`→not equal. So `adapter.ts:120` (`realPath === path.parse(realPath).root`) rejects drive **and** UNC share roots even though libuv's realpath returns them without a trailing separator. The prior "canonical junction gap" class is genuinely closed — I could not refute it.
2. **NSIS harness actually compiles.** Reproduced `win-installer-stop-smoke.ps1`'s own extraction regex `(?ms)^!macro StopInstalledAgentUnshared\r?\n.*?^!macroend` and its harness template against the live `scripts/installer.nsi`, then `makensis` **3.12** → **rc=0, stop-smoke.exe built**; the reintroduction guard `daemon\s+stop|/IM\s+cmspark-agent` → no match on the current macro. The Windows CI step cannot fail for a compile/extraction reason.
3. **Machine evidence re-derived from the logs** (not from the summary): `/tmp/cmspark-windows-593-{host,arm64}.log` both end `# tests 111 / # pass 106 / # fail 0 / # cancelled 0 / # skipped 5`; all nine new regressions are present as `ok` (lines 15/16, 45/46, 87–92, 128–143 host & arm64); the 5 skips are the 3 win32 `acp-win-spawn` cases + native Known Folder resolver + native taskkill-tree. `-build.log` = clean `tsc`; `-package.log` = **156 passed, 0 failed**. These are macOS/arm64 + aarch64-container results, i.e. injected-boundary evidence only — I treat them as such, not as Windows proof.

## Adjudication of prior findings (confirm/refute with line evidence)

| Prior finding | Verdict | Evidence |
|---|---|---|
| Pi #2 / adversary P1 — ZIP `uninstall.bat` machine-wide `taskkill /im node.exe` | **FIXED (confirmed)** | `companion/uninstall.bat:13-15` — env-carried `%~dp0`, image-name whitelist, `ExecutablePath.StartsWith($r,…OrdinalIgnoreCase)` with `TrimEnd('\')+'\'`; no `/IM` anywhere. Pi finding #1 resolved. |
| Pi #2 / adversary P1 — resolver accepted a volume root | **FIXED (confirmed)** | `known-folders.ts:24` (+ `adapter.ts:120` canonical layer, verified empirically above). |
| Pi #4 (nit) — `terminal.close` audit deferred on win32 | **FIXED (confirmed)** | `session.ts:219-227` audits at `closeLive` entry, before `finish()`; `finish` only sends the frame (`:228-241`). Test asserts audit == 1 while cleanup is pending. |
| Pi #5 (nit) — CI ran 3 of 4 targeted files | **FIXED (confirmed)** | `ci.yml:240` now includes `.test-dist/tests/acp-win-spawn.test.js`; file exists in `companion/tests/`. |
| Adversary P2 — close freed the slot / emitted frame before cleanup | **FIXED (confirmed)** | `session.ts:216-217,245-247`; `isPtyBusy` covers `closing` (`:136`), `spawnPtySession:336`; identity guard `:229`. `spawnPtySession` is fully synchronous (no `async/await` in the file), so `live` can never be set while `closing !== null` → the "overwrite `closing`" concern is unreachable, not just guarded. |
| Adversary P2 — natural exit taskkilled a reused PID | **FIXED (confirmed)** | `session.ts:243` `exited` short-circuit; `:480` sets `exited:true`; regression asserts `treeKills===0`, `killed===false`, code 7. |
| Adversary P2 — bounded fallback | **FIXED (confirmed)** | `windows-tree.ts:7-26` once-only `release`, `error`+`close`, 5 s timer kills only its own child; fake-timer/ENOENT tests pass. |
| Kimi residual — `killAllPty()` ignores a pending `closing` | **CONFIRMED, bounded, non-blocking** | `session.ts:191` (`if (live) closeLive`). During shutdown the spawned taskkill child is ref'd, so the loop survives until the unref'd 5 s timer fires → `finish()` still runs; and the audit is already recorded at entry, so the trail survives even a hard kill. |
| Kimi residual — system-Node tray escapes the scoped stop | **CONFIRMED as documented boundary** | see P2-1. |
| Pi #7 / spec — legacy `capability/shell.ts` PATH `taskkill` | **CONFIRMED residual, explicitly out of scope** | spec "Follow-ups deliberately outside this batch". |

## Findings

**P0: 0. P1: 0.**

- **P2-1 (semantic, new behavior — worth a follow-up issue).** Runtime launched with *system* Node is outside the installation root, so the scoped stop misses it: `uninstall.bat:14` requires `ExecutablePath` under `%~dp0`, while `launch.bat:19-27`/`launch-hidden.vbs` legitimately allow a system-Node launch (ZIP without bundled `node.exe`). In that configuration uninstall leaves the tray/daemon alive while deleting `cmspark-agent.log/.lock`. The spec names this boundary ("system Node outside the installation … not newly certified"), so it does not block; the accurate identity for system-Node launches is the command line referencing `<instdir>\cmspark-agent.js` (or requiring bundled node).
- **P2-2 (residual, listed followup).** Natural exit skips `handle.kill()` (`session.ts:230-231`). On Unix I confirmed node-pty self-closes (`@lydell/node-pty-darwin-arm64/lib/unixTerminal.js:109` → `_close()`), but the Windows `WindowsPtyAgent` package is not installable here, so ConPTY release on natural exit remains **unverified**; the pending native test covers taskkill of a *live* tree only. Exposure is bounded (one PTY slot).
- **P2-3 (test strength, nit).** `host-use-win-adapter.test.ts:139` `assert.rejects(adapter.readOne(id))` accepts any rejection; assert `WinPathOutsideAllowlist` like the sibling test at `:125`.
- **P2-4 (test strength, nit).** The installer-stop smoke's sibling fixture is `node.exe` only (`win-installer-stop-smoke.ps1:15-21`), so an image-wide `/IM cmspark-agent.exe` reintroduction is caught only by the textual guard at `:26`. Adding a `cmspark-agent.exe` sibling fixture would make the assertion behavioral (the ZIP smoke does own both images, `win-uninstall-smoke.ps1:20-24`).
- **P2-5 (nit).** `ci.yml:228` choco-pins NSIS only when no makensis is present; a runner-image makensis of another version silently bypasses the 3.12 pin used for local compile evidence.
- **P2-6 (nit, defense-in-depth).** `$INSTDIR` at a volume root (`C:\`) makes the appended `'\'` scope match every process on that volume; NSIS `InstallDir` is `$LOCALAPPDATA\CMspark` (`installer.nsi:30`), so this needs a deliberate directory-page choice. Mirrors the adapter's canonical-root rule if you want symmetry.
- **P2-7 (nit).** `new test` `assert.rejects(resolveKnownFolders(...))` is good; the smoke scripts' own syntax could not be parsed here (no `pwsh` on this host) — see boundaries.

## T3 / DoD assessment

- **Launcher quoting (R3):** confirmed in source — VBS passes `NODE_PATH` via `objShell.Environment("PROCESS")` and never builds a `cmd /c` line; BAT uses `DisableDelayedExpansion`, no `!VAR!` left, quoted `start "" /MIN "%LAUNCH_EXE%"` with `NODE_PATH=%~dp0`. No variable is set-and-read inside the same block, so the delayed-expansion removal is semantics-preserving. Native special-char matrix (`win-launcher-smoke.ps1:455-478`) is the right shape but has not executed.
- **Installation-scoped stop (R4):** single termination path in both artifacts (macro at `installer.nsi:64-72`, BAT at `uninstall.bat:14`); `%SYSDIR`/`%SystemRoot%\System32` PowerShell is pinned; the env-carried root removes quote/apostrophe injection; the trailing separator gives correct sibling-prefix semantics. Sibling-prefix survival is asserted in both smokes, and a vacuous pass is impossible (identical fixture-start method for inside+sibling; a dead fixture trips the sibling assertion).
- **Known Folders (R11):** fixed GUIDs, `KF_FLAG_DONT_VERIFY 0x4000`, fail-closed parse (`known-folders.ts:16-24`), one snapshot per operation (`adapter.ts:112,156,231,300`; test asserts `resolutions` increments once per op), lexical + canonical checks on the **target** for list/read (tightens the previous symlinked-file hole), resolver failure surfaced (production path `getWinAdapter()` → `new WinHostAdapter()` with **no** `userProfile`, `adapter.ts:408-409`). `known-folders.ps1` is staged by glob (`stage:win-scripts`, `package.sh:410`, `installer.nsi:91 File /r`) — no enumeration gap that would ship a helper-less binary; I checked this specifically.
- **Capability class unchanged:** no profile/grant/outbound/capability-gate file in the diff; the authority *source* for `win:fs` moved from a `%USERPROFILE%` guess to OS policy (intended tightening for guessed paths, intentional widening for redirected folders — including a network-share Documents — which is the stated #593 DoD). T3 classification stands; `node_modules` is not staged.

## Remaining evidence boundaries (must not be overclaimed)

No native Windows execution is inferred from anything above. Still unproven until the Windows CI step (`ci.yml:225-241`) goes green: launcher special-char matrix, **full-BAT ZIP uninstall smoke**, full-macro NSIS stop smoke, native Known Folder API resolution, real owned process-tree kill, the 5 new/changed smoke scripts' own parse/execution, and ZIP/NSIS install-upgrade-uninstall. Also uncertified: interactive ConPTY/UIA/Office/OneDrive policy behavior, natural-exit ConPTY teardown (P2-2), PS helper latency, real PID reuse, and the documented filesystem TOCTOU + CIM enumerate→`Stop-Process -Id` race. My `makensis` rc=0 is compile-only (a Mach-O build of the harness), not harness execution.

## VERDICT

**APPROVE** — 0 × P0, 0 × P1. I independently confirm the adversary's final `VERDICT: APPROVE`: the frozen source `725c185c…` @ `50c04f25` is unchanged during review, the R3/R4/R11 acceptance items are satisfied at source level, the earlier blockers (unscoped stop, PTY completion/identity, natural-exit PID kill, canonical junction-to-volume authority) are genuinely fixed rather than re-described, and the native smoke fixtures are isolation-valid and non-vacuous. The P2 items above are follow-ups/nits, three of which (P2-2, P2-1, P2-6-class scope) are already recorded in the spec's "outside this batch" list. Conditions (not new code work): the Windows `smoke (windows-latest)` step must actually pass before merge, and no Windows behavior may be asserted from the macOS/arm64 results quoted here.
