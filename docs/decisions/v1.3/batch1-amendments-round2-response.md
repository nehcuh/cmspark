# Batch 1 — Amendments Applied (Round 2 → Round 3)

**Date**: 2026-07-24
**Reviewer**: Grok
**Request**: Confirm Round 2 amendments are sufficient. APPROVE / FURTHER AMENDMENTS / REJECT.

## Amendments applied

### Must-fix (all done)

**A1 — S-P0-1 deny path test** ✓
- Added `companion/tests/host-use-darwin-adapter.test.ts:423-438` "S-P0-1: CMSPARK_HOST_BIN without opt-in flag throws (A1 — deny path)".
- Asserts `CMSPARK_HOST_BIN` set + `CMSPARK_ALLOW_HOST_BIN_OVERRIDE` unset → throws `/CMSPARK_HOST_BIN override ignored/`.

**A3 — S-P0-2 brief accuracy** ✓
- Corrected `docs/decisions/v1.3/batch1-security-p0-brief.md` Fix 2 section.
- Replaced aspirational `/proc/<pid>/exe` / `proc_pidpath` / `lsof` claim with the actual implementation: `fs.statSync(pre.realpath)` on the **path** (`statInodeDev`).
- Documented that this catches rename-swap but NOT same-inode content rewrite; process-image identity check deferred to P1 per A4.

**A5 — S-P0-2 checkIntegrity unit tests** ✓
- Exported `checkIntegrity` + `getExpectedHash` from `swift-tray-bridge.ts`.
- Added `companion/tests/swift-tray-integrity.test.ts` with 4 tests:
  1. ENOENT → `{ok:false, inode:-1, dev:-1, realpath:""}`
  2. Hash mismatch → `{ok:false}` + metadata still populated (used for TOCTOU re-stat)
  3. Inode/dev/realpath captured correctly (verified via independent sha256)
  4. Symlink target resolved via `fs.realpathSync`
- macOS gotcha: `/var` is a symlink to `/private/var`, so `realpath` assertions compare against `fs.realpathSync(binPath)` not the literal input.

**A6 — S-P0-3 whitespace-before-protocol** ✓
- `chrome-extension/src/background/page-sanitizer.ts:51-66` — regex now allows `\s*` after `=["']` before `(javascript|data):`.
- Added test `removeJavaScriptUrls strips leading-whitespace protocol bypass (A6)` covering `href=" javascript:..."` and `href="\tjavascript:..."`.

**A8 — S-P0-4 multi-label eTLD residual documented** ✓
- Added an explicit **A8 RESIDUAL** block in `security.ts:validateWildcardPattern` docstring.
- Lists the residual wildcard patterns (`*.github.io`, `*.appspot.com`, etc.) that pass validation.
- Real fix (`publicsuffix-list` npm package) tracked as P1.
- **A10 (partial)**: added the top multi-tenant suffixes to PUBLIC_SUFFIXES — `github.io`, `appspot.com`, `vercel.app`, `pages.dev`, `herokuapp.com`, `netlify.app`, `gitlab.io`, `onrender.com`, `s3.amazonaws.com`, etc.
- Test `security: saveConfig filters multi-tenant eTLD wildcards (A10, Grok round 2)` verifies these are now filtered.

### Should-fix (done where cheap)

**A11 — crypto.timingSafeEqual** ✓
- `companion/src/security-policy.ts:1-4` — `import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto"`.
- Wrapper at line ~196 — `if (a.length !== b.length) return false; return cryptoTimingSafeEqual(Buffer.from(a), Buffer.from(b))`.
- Same length-check semantics as before; consistent with `ws-auth.ts` / `settings-web.ts`.

**A12 — Map-miss early-return comment** ✓
- Updated `validateToken` docstring (security-policy.ts:106-128) to explicitly note:
  - Map-miss early return is inherent (no constant-time Map primitive exists)
  - `sigOk` re-check is integrity-of-Map only — always true for un-tampered entries because `token` is the Map key
  - Real residual oracles are field/TTL/length paths AFTER Map hit, which require attacker to hold a live token — bounded.

### Nice-to-have (deferred)

**A2 — Codesign / SecStaticCodeCheckValidity**: P1, requires a macOS-only runtime check.
**A4 — Keep fd open + spawn via /dev/fd/N**: P1, requires platform-specific socket-fd passing.
**A7 — Null-byte strip + HTML entity decoding**: P1, broad sanitizer hardening.
**A9 — Filter on config load too**: P1, separate from saveConfig; needs migration path for existing configs.
**A10 (full)** — switch to `publicsuffix-list` npm package: P1, runtime dependency + update mechanism.

## Test results

```
companion:        1726 tests, 1707 pass, 3 fail (pre-existing, unrelated)
chrome-extension: 200 tests,  199 pass, 1 fail  (pre-existing, unrelated)
tsc:              clean both sides
```

Pre-existing failures (unchanged from Round 2):
- `comparison is case-insensitive (NTFS)` — Windows-only behavior on macOS host
- `apps.add lolbin → lolbin_denied` — returns `absolute_path_required` (path check first)
- `deletes companion date logs older than retention` — UTC vs local TZ
- `appsPlatformSupported: win32 + unknown` — Windows detection on macOS host

## Summary

All 5 must-fix + 2 should-fix amendments applied. All Batch-1-touched tests green. No new regressions.

**Awaiting**: APPROVE / FURTHER AMENDMENTS / REJECT.
