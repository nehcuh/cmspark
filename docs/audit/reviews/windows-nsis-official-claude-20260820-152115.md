All verification complete. Final review follows.

---

# Independent review — Windows NSIS official installer (dual-review, Claude lane)

## Blocking issues

### B1. `''` is not an NSIS escape — StopInstalledAgent's PowerShell kill silently no-ops

**`scripts/installer.nsi:64`** and **`scripts/installer.nsi:73`**:

```nsis
nsExec::ExecToLog 'powershell.exe ... -Command "$$r = [IO.Path]::GetFullPath(''$INSTDIR''); ... }"'
```

NSIS closes a quoted token at the **first** matching quote character; quote-doubling does not exist. The only escape is `$\'` (confirmed in NSIS 3.12 lexer, `Source/lineparse.cpp` `doline()`, and the official docs' `$\` escaping section). Three independent proofs, two of them `[executed]`:

1. `[executed]` makensis **3.12** (the exact CI pin) fed the exact byte sequence from line 64 via `!echo`: **`!echo expects 1 parameters, got 3.`** The line tokenizes into 3 plugin parameters, not 1.
2. `[executed]` The real `installer.nsi` compiles **exit 0, zero warnings** (726 instructions; I produced a real `CMspark-Setup-v0.5.1.exe`) — because plugin calls don't validate arity. **CI is structurally blind to this bug**: `CMSPARK_REQUIRE_NSIS=1`, the assert step, and the upload gates all pass.
3. `[inspected]` Runtime: nsExec executes only param[0] = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$r = [IO.Path]::GetFullPath(` — truncated and unterminated → PowerShell parse error, **zero processes killed**; the other two tokens leak onto the NSIS stack.

Why it matters: `daemon stop` only kills pid-file processes (per the file's own comment, installer.nsi:56) and `taskkill /IM cmspark-agent.exe` never matches the official tree (no SEA exe). This PowerShell line was the **only** mechanism killing tray `node.exe`. Consequences:
- **Upgrade-in-place**: tray `node.exe` stays running → `File /r` (installer.nsi:88) fails to overwrite locked `node.exe` → install errors/aborts.
- **Uninstall**: `RMDir /r "$INSTDIR"` (installer.nsi:133) can't delete in-use files → half-uninstalled product, tray still alive.

This directly defeats adversary-synthesis requirement F1 (stop-before-copy) and hostile-focus #3. Note: the Kimi lane asserted "`''` → literal `'`. Good." — disproven by execution above; and its saved log (`windows-nsis-official-kimi-20260820-152115.md`) ends mid-sentence with no verdict line.

**Verified fix** `[executed]`: either backtick-delimit the whole command (`` nsExec::ExecToLog `powershell.exe ... GetFullPath('$INSTDIR') ...` `` — backticks legally contain both `'` and `"`) or `$\'`-escape the inner quotes. Both compile as exactly **1** parameter under makensis 3.12. Recommend also adding a static gate (e.g. nsi must not contain `''` inside nsExec lines, or a `!echo`-arity probe), since nothing else catches reintroduction.

## Non-blocking nits

1. `installer.nsi:64/73` — `StartsWith($r, OrdinalIgnoreCase)` without a trailing separator also matches sibling directories (`...\CMspark-dev`). Append `\` to `$r` before matching.
2. Apostrophe in `$INSTDIR` (username like `O'Brien`) breaks the PS single-quoted path; fails loudly, rare. The backtick fix form keeps `'…'`, so consider escaping or double-quoting the path arg.
3. `-D` on **Windows** makensis is `[assumed]` (POSIX makensis verified `[executed]`; old ps1 used `/D` from PowerShell where MSYS conversion didn't apply). Failure mode is fail-closed (loud CI compile error). One `workflow_dispatch` dry-run of the Release workflow before the first tag would settle it on a real windows runner.
4. `nsExec::ExecToLog` return values never popped — pre-existing pattern, stack hygiene only.

## Claims verified (evidence-tagged)

- Gates re-run: **97 passed, 0 failed** `[executed]`.
- Single producer / fail-closed wrapper / MSYS_NO_PATHCONV + `-D` only / SEA+mixed-tree refusal incl. dynamic tests `[executed+inspected]`.
- Full nsi compile under pinned makensis 3.12, exit 0, no warnings; relative `..\dist-package` resolves script-relative (default no-`/NOCD` chdir) — exe landed in repo `dist-package/` `[executed]`; `File /r "dir\"` copies contents only, including extensionless files `[executed, -V4 probe]`.
- `choco nsis 3.12.0` exists (approved Apr 2026, → `nsis.install` to `C:\Program Files (x86)\NSIS`) `[web-verified]`.
- Zip-only green release impossible (REQUIRE=1 → package step; assert step; per-artifact `if-no-files-found: error`; flatten refusal + `fail_on_unmatched_files`; release `needs: package`) `[inspected]`.
- `IfFileExists ... 0 +3` skips exactly 2 instructions, lands on taskkill `[docs §4.4 + inspected]`.
- Trust: HKCU-only, `RequestExecutionLevel user`, no new Startup-folder autostart, no auto-approve/ADR-020 surface changes — capability declaration accurate `[inspected]`.

Test hygiene: my probe artifacts were removed (`dist-package/cmspark-windows-x64/` fake staging; the probe Setup.exe); Kimi's `.tmp` probe dirs were already cleaned; makensis 3.12 is now installed via Homebrew.

VERDICT: REJECT
