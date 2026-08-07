# Compat/Platform Lane — S52 post-ship multi-adv
**Range**: 14e1b28..d34bac2
**Recommendation**: PASS_WITH_NITS
**Status**: WATCH

## Findings

### F1 — Severity: Low (nit) — NSIS fallback version still a second SoT
**Where**: `scripts/installer.nsi` (`!ifndef PRODUCT_VERSION` → `!define PRODUCT_VERSION "0.4.0"`)
**Evidence**: Preferred path injects `/DPRODUCT_VERSION=$Version` from `companion/package.json` via `build-windows-exe.ps1`. Manual `makensis scripts/installer.nsi` still uses hardcoded `0.4.0`. `test-package-gates.sh` asserts `!ifndef PRODUCT_VERSION` and `/DPRODUCT_VERSION=` but does **not** assert fallback equals `companion/package.json` version.
**Impact**: Preferred SEA/NSIS packaging path is correct. Manual/CI footgun if someone bumps package.json and builds installer without the ps1 wrapper → DisplayVersion / OutFile name can lag.
**Ask**: Optional gate: parse nsi fallback and fail if ≠ package.json; or document “never invoke makensis without /D” as release checklist only.

### F2 — Severity: Low (nit) — Extension↔companion version mismatch is warn-only
**Where**: `scripts/build-windows-exe.ps1` (cross-check `$ExtVer -ne $Version` → `Write-Warning`)
**Evidence**: Both packages currently report `0.4.0`. Mismatch does not fail the build.
**Impact**: Windows zip/installer can ship with MV3 manifest version ≠ companion SEA version if lock-step is broken at tag time. Comment and package.sh docs already say keep lock-step.
**Ask**: Consider fail-closed (`Write-Error; exit 1`) for release builds; keep warn for local dev if needed.

### F3 — Severity: Low (nit) — Gates ban specific `0.2.0` strings, not generic stale stamps
**Where**: `scripts/tests/test-package-gates.sh`
**Evidence**:
- `assert_file_lacks create-dmg 's/0\.2\.0/'`
- `assert_file_lacks ps1 'CMspark-v0\.2\.0'`
- Info.plist correctly gated: must use `__CMSPARK_VERSION__`, must lack `>x.y.z<`
**Impact**: Re-introducing a different hardcoded stamp (e.g. `s/0.4.0/`) in create-dmg would not trip the 0.2.0-specific checks; placeholder + Info.plist gates still block the main macOS trap. Residual is historical-regex narrowness.
**Ask**: Prefer asserting “no sed of literal semver” / “no `$Version = "…"` assignment” over pinning one bad version forever.

### F4 — Severity: Info (residual UX, out of #132 primary file) — Side Panel voice error-map still OS-agnostic
**Where**: `chrome-extension/src/sidepanel/voice/error-map.ts` (`not-allowed` → “系统隐私”)
**Evidence**: #132 fixed the **bootstrap tab** (`voice-permission.tsx`) with Win/macOS/generic hints. Composer-path map still says generic “系统隐私” for both OSes.
**Impact**: Windows users who deny mic from Side Panel (not the permission tab) get less actionable copy than the new permission page.
**Ask**: Follow-up only; not a ship blocker for this range.

### F5 — Severity: None / residual OK — Hard-delete multi-panel double REMOVE
**Where**: `message-router.ts` single `thread.delete` hard path now `session.broadcast({ type: "thread.deleted", … mode: "hard" })`; extension `REMOVE_THREAD` is filter-based.
**Evidence**: Initiator already optimistically `REMOVE_THREAD` in `ThreadList.tsx`; `broadcastToClients` fans out to all authenticated sockets including originator → second REMOVE is idempotent. Batch / TTL purge / cleanup_empty already broadcasted.
**Impact**: Pre-fix desync (panel B keeps ghost row until refresh) is closed for single hard-delete. No functional residual beyond harmless double dispatch.

### F6 — Severity: None — Trust/trash has no platform path coupling
**Where**: `pack-engine.ts` `releaseTrustBeforeThreadGone` / `clearTrustCookieWithoutRestore`; `message-router` trash/list paths
**Evidence**: Cookie clear goes through `threadManager.update` / in-memory mutation + config restore helpers. No new `path.join`, drive letters, or `~` expansion. S51 tests cover trash→Settings flip→hard-delete, pre-S51 leftover cookie, and trash-A/apply-B/hard-delete-A without clobbering B.
**Impact**: Cross-platform (macOS/Windows data dir under platform DATA_DIR) unaffected by this delta.

---

## Packaging SoT
- **Verdict**: **Fixed for preferred paths; residual manual/fallback drift only.**
- **Windows SEA**: `build-windows-exe.ps1` reads `companion/package.json` via `ConvertFrom-Json`; no hardcoded `$Version = "0.4.0"`. Artifact names use `$Version`. [inspected]
- **NSIS**: Preferred `makensis "/DPRODUCT_VERSION=$Version"` injects SoT. Fallback `0.4.0` remains (F1). [inspected]
- **macOS Info.plist**: Template uses `__CMSPARK_VERSION__` for `CFBundleShortVersionString` and `CFBundleVersion`; `create-dmg.sh` sed-stamps from package.json and **fails closed** if placeholder remains. [inspected]
- **create-dmg / package.sh**: Both `VERSION="$(node -p "require(...companion/package.json).version")"`. Makefile documents Windows version SoT. [inspected]
- **Gates**: Catch stale `0.2.0` in create-dmg sed and ps1 headers; require placeholder, PRODUCT_VERSION inject, `!ifndef`. Do not fully prove nsi fallback lock-step or fail on ext≠companion (F1–F3). [inspected]
- **AGENTS.md**: Version badge 0.2.0 → 0.4.0 lock-step note with companion. [inspected]

## Voice permission copy
- **Verdict**: **Honest and correct for primary surfaces in scope.**
- **Windows**: UA `/Windows/i` → `Windows「设置 → 隐私和安全性 → 麦克风」` — accurate for Win10/11 zh-CN Settings tree; still points users at Chrome site settings + OS mic privacy. [inspected]
- **macOS**: UA `/Mac|iPhone|iPad|iPod/i` → prior correct `macOS「系统设置 → 隐私与安全性 → 麦克风」` retained. [inspected]
- **Other (Linux/ChromeOS/unknown)**: Generic `系统麦克风隐私设置` — honest non-macOS-only fallback; no false macOS-only instruction. [inspected]
- **Order**: `isWin` before `isMac` avoids exotic dual-match edge cases. [inspected]
- **Residual**: Composer `error-map.ts` still generic (F4); permission **page** is the ship fix.

## Summary
Compat/Platform ship bar is met: voice-permission no longer lies to Windows users; packaging preferred paths share `companion/package.json` as SoT with Info.plist placeholder + post-stamp assert and gates against the old `0.2.0` trap; Trust cookie clear/restore is platform-agnostic; single hard-delete now broadcasts so multi-panel lists stay aligned (batch/TTL already did).

Nits worth tracking, not blocking: NSIS fallback second SoT, extension version warn-only, gates overly specific to `0.2.0`, optional Side Panel error-map OS hints. **PASS_WITH_NITS / WATCH** — no REQUEST_CHANGES or BLOCK from this lane.
