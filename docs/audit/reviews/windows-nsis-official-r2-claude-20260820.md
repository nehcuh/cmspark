# Dual review r2 — Claude lane — Windows NSIS official installer (B1 fix)

Scope: r1 REJECT blocking issue B1 only (`''` is not an NSIS quote escape → PowerShell kill token-split). Machine r2 claims independently re-executed, not trusted.

## B1 closed — verified `[executed]`

- Real `installer.nsi` compiled under Homebrew **makensis 3.12** (CI pin), `-V4 -DPRODUCT_VERSION=0.5.1`, fake staging: **exit 0, zero warnings**. Verbose log shows the PowerShell kill as **one** `Plugin command: ExecToLog powershell.exe ... -Command "$$r = ... GetFullPath('$INSTDIR').TrimEnd('\') + '\'; ... }"` — full tail intact, at **both** `!insertmacro` sites (install + uninstall). r1's failure mode truncated at `GetFullPath(` into 3 params.
- Arity probe on the **exact line bytes** (installer.nsi:65 via sed → `!echo`): no `!echo expects 1 parameters, got N` error, exit 0. Control `!echo one two` → arity error + fatal abort, proving the check is real. (Quirk noted: `!echo` with a quoted/backtick param prints nothing — arity is still enforced before printing.)
- Zero warnings is itself evidence for `$$` → `$`: an unrecognized `$`-sequence in a string triggers NSIS's "unknown variable/constant" warning; `$$r`/`$$_` were consumed silently as the documented `$` escape + literal `[inspected]`, matching r1's runtime trace of the compiled param.
- Whole-file `''` sweep: only match is the explanatory comment (installer.nsi:59); no functional `''` remains. Gate `GetFullPath(''` absent ✓.

## No new quoting split `[inspected]`

- Daemon-stop line: backtick string containing `"` around both paths — legal, one param (log line confirms).
- `"` cannot occur in Windows paths at all, so the `"`-delimited `-Command` wrapper and quoted paths are safe on every realistic `$INSTDIR`.
- The PS command contains no backtick character (a backtick inside would terminate the NSIS string) — verified absent. Backslash is literal in NSIS (no `\` escaping), so `TrimEnd('\')` passes through untouched.
- Uninstaller `$INSTDIR` is initialized from uninstall.exe's own location (written to `$INSTDIR\uninstall.exe`, installer.nsi:113) — correct prefix for the same kill sweep.

## IfFileExists `0 +3` still correct `[inspected]`

`installer.nsi:61-64`: instructions after IfFileExists are +1 daemon-stop nsExec, +2 `Sleep 200`, +3 taskkill. Not-exists → skips daemon stop + Sleep, **lands on taskkill**; taskkill/PowerShell/`Sleep 400` run unconditionally — same structure r1 verified (docs §4.4). `!insertmacro` expands inline textually per function before jump assembly, so offsets are resolved independently and identically in `StopInstalledAgent` and `un.StopInstalledAgent`; both assembled exit 0.

## r1 nits disposition

- **N1 sibling-prefix (`CMspark-dev` false match): CLOSED** — `TrimEnd('\') + '\'` appends exactly one trailing separator before `StartsWith(..., OrdinalIgnoreCase)` (also correct for a root like `C:\`).
- **N2 apostrophe in `$INSTDIR`** (`C:\Users\O'Brien\...`; `'` is legal in Windows usernames, InstallDir is `$LOCALAPPDATA\CMspark`): retained by the backtick form. PS parse error → sweep logged-and-failed, stale tray survives, `File /r` may then hit locked `node.exe`. Narrow, loud-ish, pre-adjudicated non-blocking in r1 — carried.
- **N3 Windows-runner `-D` flag**: untouched by this fix; fail-closed direction; one `workflow_dispatch` dry-run before first tag remains the settle step.
- **N4 nsExec return values never popped**: unchanged pre-existing stack-hygiene nit (~5 entries/install).

## Machine r2 claims reproduced `[executed]`

- `bash scripts/tests/test-package-gates.sh` → **99 passed, 0 failed** (r1: 97 — the +2 are the new backtick-present / `GetFullPath(''`-absent asserts, test-package-gates.sh:192-195).
- makensis compile probe reproduced as above; probe `Setup.exe` + fake staging deleted afterward; `dist-package/` macOS artifacts untouched; `git status` unchanged.
- Windows runtime behavior (CreateProcess → powershell argv → kill) remains `[inspected]` — no Windows host in this round; compile-level tokenization is the fixed layer and is proven.

Cross-lane: Kimi r2 (`windows-nsis-official-r2-kimi-20260820.md`) independently reproduced gates + compile and ruled APPROVE_WITH_NITS on the same apostrophe nit — lanes converge.

VERDICT: APPROVE_WITH_NITS
