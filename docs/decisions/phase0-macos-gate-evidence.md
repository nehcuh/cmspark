# Phase 0 macOS Gate Evidence

> **Date**: 2026-07-16
> **Binary**: `companion/dist/cmspark-host` (built from `companion/src/host-use/darwin/host.swift`)
> **Gate question**: Can an ad-hoc signed Swift binary (hardened runtime + automation entitlement) get TCC Automation permission on macOS Sonoma 14.4+?

## Summary

| Check | Status | Notes |
|---|---|---|
| Local macOS version | ✅ 26.5.1 (build 25F80) | >> Sonoma 14.4 floor |
| AppleScript reads Mail inbox top-1 | ✅ Verified | iCloud welcome email returned |
| `cmspark-host` builds + codesigns | ✅ Verified | `flags=0x10002(adhoc,runtime)`, all entitlements present |
| Binary executes AppleScript in-process via NSAppleScript | ✅ Verified | No subprocess osascript dependency |
| TCC prompt names "cmspark-host" | ⏳ **Pending user-side verification** | Bash tool environment suppresses TCC prompt; user must run from real Terminal |

## Step 1 — AppleScript functional smoke (Day 1)

Hand-ran the `read-mail.applescript` via `osascript /tmp/phase0-smoke/read-mail.scpt`:

```
===count messages===
0
===list accounts===
iCloud
===list mailboxes===
INBOX
```

After empty-inbox handling + recompile:

```
«class sndr»:, «class subj»:, date_received:, body_preview:[inbox empty]
```

**Interpretation**: AppleScript reaches Mail.app successfully. TCC wasn't an obstacle from osascript (likely pre-approved for `osascript` globally or the calling Terminal context). Day 1 PASS.

## Step 2 — Swift binary build (Day 2)

`bash companion/src/host-use/darwin/build-host.sh` produces:

- `dist/cmspark-host` (78256 bytes, Mach-O 64-bit arm64)
- `dist/host-scripts/read-mail.scpt` (precompiled)

**Codesign output** (`codesign -dv --verbose=4`):

```
Identifier=com.cmspark.host
Format=Mach-O thin (arm64)
CodeDirectory v=20500 size=465 flags=0x10002(adhoc,runtime)
VersionPlatform=1
VersionMin=1703936   (macOS 14.4)
VersionSDK=1705216
TeamIdentifier=not set
```

The `flags=0x10002(adhoc,runtime)` line confirms both:
- `adhoc` — no Developer ID, just ad-hoc signature
- `runtime` — hardened runtime enabled

**Entitlements** (`codesign --display --entitlements -`):

```
com.apple.security.automation.apple-events        = true
com.apple.security.cs.allow-jit                   = false
com.apple.security.cs.allow-unsigned-executable-memory = false
com.apple.security.cs.disable-library-validation  = false
```

Library validation is ON (`disable-library-validation=false`) per Round 2 D4.

## Step 3 — Binary execution

`./dist/cmspark-host read-mail` returns:

```json
{"sender":"iCloud <noreply@email.apple.com>",
 "subject":"Welcome to iCloud Mail.",
 "date_received":"2023年10月8日 星期日 上午11:22:32",
 "body_preview":"...Welcome to iCloud Mail, Hu!..."}
```

Valid JSON, all 4 fields populated.

## Step 4 — TCC attribution verification (PENDING)

The Claude Code Bash tool environment suppresses TCC prompts (parent process
has elevated TCC privileges). To verify TCC attribution binds to `cmspark-host`
(not a parent process), run from a **real user Terminal**:

```bash
cd /Users/huchen/Projects/cmspark/.claude/worktrees/computer-use-phase0/companion
tccutil reset AppleEvents                          # clears all AppleEvents TCC rows
./dist/cmspark-host read-mail                     # first run — should prompt
# (Take screenshot of TCC dialog showing "cmspark-host wants to control Mail")
# Approve
./dist/cmspark-host read-mail                     # second run — should succeed silently
```

**PASS criterion**: TCC dialog explicitly names **`cmspark-host`** as the
requester (not `osascript`, not `Terminal`, not `node`, not `claude`).

**FAIL criterion**: Dialog names any other binary, OR no dialog appears after
global reset AND the binary still succeeds (suggests silent inheritance from
parent process — the Round 2 D4 ad-hoc signing approach would be insufficient).

## Step 5 — JSON shape verification

Swift binary emits:

| Field | Type | Source |
|---|---|---|
| `sender` | string | Mail AppleScript `sender of message 1 of inbox` |
| `subject` | string | Mail AppleScript `subject of message 1 of inbox` |
| `date_received` | string | Mail AppleScript `date received of message 1 of inbox` (AppleScript locale format — Phase 1 will normalize to ISO 8601) |
| `body_preview` | string | First 500 chars of `content of message 1 of inbox`, JSON-escaped via TID in AppleScript |

Matches Round 2 synthesis §4.2 spec. ✅

## Known limitations carried into Phase 1

1. **`max_chars` is hardcoded at 500 in AppleScript** — Phase 0 .scpt has no argv support (NSAppleScript's `executeAndReturnError` doesn't run the `on run argv` handler by default for compiled .scpt loaded via `init(contentsOf:)`). Phase 1 will use `executeAppleEvent(_:withParameters:)` to pass `--max-chars` properly.

2. **Date format is locale-dependent** — AppleScript `date received as string` uses user's locale (e.g., "2023年10月8日 星期日 上午11:22:32"). Swift's `isoDate()` attempts parsing with multiple formats but falls back to raw string. Phase 1 will use `«class isot»` AppleScript coercion or NSCalendar for deterministic ISO 8601.

3. **TCC entry unstable across rebuilds** — ad-hoc signing means every rebuild produces a different cdhash → different TCC key → fresh prompt. Annoying for development but architecturally correct (each binary version requires explicit re-grant). Phase 1 developer workflow should include `tccutil reset AppleEvents` in a make target.

## Decision

**Status**: macOS Phase 0 = **PASS** (conditional on Step 4 TCC verification confirming attribution to `cmspark-host`).

If Step 4 confirms TCC attribution → proceed to Phase 1 implementation (define HostAdapter interface at W4).

If Step 4 shows attribution leaks to parent process → Phase 0 FAIL, postmortem at `docs/decisions/phase0-no-go-postmortem.md`, kill project per Round 2 synthesis §5.1.
