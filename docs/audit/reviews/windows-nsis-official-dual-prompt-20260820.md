# Dual review: official Windows NSIS Setup.exe (Claude + Kimi)

## Context

User wanted a Windows installer (chose **A**: consumer double-click, official GitHub Release). Locked spec: `docs/superpowers/specs/2026-08-20-windows-nsis-official-installer-design.md`. Three independent adversary lanes all **REJECT**ed the first spec; synthesis and absorbed P0/P1: `docs/audit/reviews/windows-nsis-official-adversary-synthesis-20260820.md`.

Implementer is this session. **You are independent.** Do not rubber-stamp. Read real files + `git diff` + untracked new scripts.

## Capability declaration (ADR-020)

```text
Surface:      n/a — distribution wrapper, no new tools / confirm / primary UI
L2-classes:   none
Compose:      none
Autonomy:     n/a
Trust:        per-user HKCU install; no new auto-approve; unsigned Setup.exe (REL-1)
Channel:      community
```

## Blast tier

**T2** — packaging/release. MERGE only if both reviewers APPROVE*.

## Machine (already run this session)

- `[executed]` `bash scripts/tests/test-package-gates.sh` → **97 passed, 0 failed**
- `[executed]` `bash -n scripts/build-windows-installer.sh` and `scripts/package.sh`
- `[executed]` Ruby YAML load of `release.yml` + `ci.yml`

You may re-run gates. Full Windows `package.sh` + real `makensis` was **not** run (macOS host).

## What the change claims (verify, don't trust)

1. Official Setup.exe producer is **only** `scripts/build-windows-installer.sh`, called from `package.sh` after the windows zip. `build-windows-exe.ps1` no longer calls `makensis`.
2. Wrapper fail-closed: `CMSPARK_REQUIRE_NSIS=1` if makensis missing; refuses staging without `node.exe`/`cmspark-agent.js`/`launch-hidden.vbs`/`chrome-extension/`; **refuses** if `cmspark-agent.exe` present.
3. Git Bash: `MSYS_NO_PATHCONV=1` + `-DPRODUCT_VERSION=` (never bash `/D`).
4. CI: pin `choco install nsis --version=3.12.0`; `GITHUB_PATH` to `C:\Program Files (x86)\NSIS`; REQUIRE=1 only windows-x64.
5. Artifacts: **second** upload `cmspark-windows-x64-setup` path **only** `CMspark-Setup-v*.exe`; flatten by that name; SHA256 includes exe; `fail_on_unmatched_files: true`; flatten errors if exe missing (no zip-only release).
6. nsi: `StopInstalledAgent` on install+uninstall (daemon stop + taskkill SEA + PowerShell kill by ExecutablePath prefix); File /r complete tree; HKCU Run only (no new Startup lnk); delete leftover `cmspark-agent.exe` before copy.
7. `make package-windows` → `package.sh windows-x64` (SEA remains ps1 / bat).

## Hostile focus (must try to break)

1. Can GitHub Release still go green zip-only? (globs, unmatched files, matrix fail-fast, two upload names)
2. Can SEA/mixed tree still produce `CMspark-Setup-v*.exe`?
3. Does uninstall actually kill **tray** `node.exe` under `$INSTDIR`? PowerShell quoting in NSIS `$$` / `$INSTDIR`?
4. MSYS `/D` regression?
5. Stale docs/tests still teaching ps1 NSIS?
6. `IfFileExists ... 0 +3` skip count?
7. Trust: HKLM / UAC / auto-approve regressions?

## Output

Findings with file:line. Then exactly one final line:

VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
