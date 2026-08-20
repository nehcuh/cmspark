# Dual review r2 — Windows NSIS official installer (after Claude B1)

Round 1: Claude **REJECT** (B1 NSIS `''` is not a quote escape; PowerShell kill token-split). Kimi APPROVE_WITH_NITS (wrong on `''`).

Fix applied: `scripts/installer.nsi` StopInstalledAgent now uses **backtick** nsExec strings (may contain `'` and `"`). Path prefix appends trailing `\`. Gate: `nsExec::ExecToLog \`` present; `GetFullPath(''` absent.

## Machine r2 `[executed]`

- `bash scripts/tests/test-package-gates.sh` → **99 passed, 0 failed**
- `makensis -V4 -DPRODUCT_VERSION=0.5.1 scripts/installer.nsi` (Homebrew NSIS 3.12, same pin as CI)
- Verbose compile shows **one** `Plugin command: ExecToLog powershell.exe ...` with the full -Command (not 3 tokens)
- Probe Setup.exe + fake staging **deleted** after compile

## Read

- `scripts/installer.nsi` StopInstalledAgent macro
- `scripts/tests/test-package-gates.sh` new backtick / no-`''` asserts
- Prior: spec, synthesis, r1 Claude REJECT (`windows-nsis-official-claude-20260820-152115.md`)

Hostile: is B1 actually closed? Any new quoting split? Macro IfFileExists +3 still correct after !insertmacro?

Final line exactly:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
