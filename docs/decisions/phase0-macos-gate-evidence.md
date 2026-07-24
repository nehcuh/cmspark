# Phase 0 macOS Gate Evidence

> **Date**: 2026-07-16
> **Binary**: `companion/dist/cmspark-host` (built from `companion/src/host-use/darwin/host.swift`)
> **Gate question**: Can an ad-hoc signed Swift binary (hardened runtime + automation entitlement) get TCC Automation permission on macOS Sonoma 14.4+?
>
> **Evidence convention** (per behaviors.md R1.2 Calibrated Reporting):
> - `[executed]` = ran the command in this session, observed the captured output
> - `[inspected]` = read the code / static artifact, no runtime observation
> - `[assumed]` = inferred from documentation or pattern, not directly verified

## Summary

| Check | Status | Evidence | Notes |
|---|---|---|---|
| Local macOS version | ✅ | `[executed]` `sw_vers` → 26.5.1 build 25F80 | >> Sonoma 14.4 floor |
| AppleScript reads Mail inbox top-1 | ✅ | `[executed]` `osascript read-mail.scpt` returned iCloud welcome email 4-tuple | sender/subject/date/body_preview |
| `cmspark-host` builds + codesigns | ✅ | `[executed]` `npm run build:host` + `codesign -dv --verbose=4` output captured below | `flags=0x10002(adhoc,runtime)`, all entitlements present |
| Binary executes AppleScript in-process via NSAppleScript | ✅ | `[executed]` `./dist/cmspark-host read-mail` returned valid JSON; `[inspected]` host.swift uses `NSAppleScript(contentsOf:)` not subprocess | No osascript dependency |
| TCC prompt appears after global reset | ✅ | `[executed]` user-side Terminal: `tccutil reset AppleEvents` → `./dist/cmspark-host read-mail` → dialog appeared → user clicked OK → JSON returned | Dialog observed by user on 2026-07-16 ~14:37 |
| TCC prompt names "cmspark-host" specifically | ⚠️ SOFT-PASS | `[assumed]` user confirmed dialog appeared and approved; name in prompt not explicitly captured | Re-verification recommended: re-run reset+run, read prompt name explicitly |

## Step 1 — AppleScript functional smoke (Day 1)

`[executed]` Hand-ran the `read-mail.applescript` via `osascript /tmp/phase0-smoke/read-mail.scpt`:

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

`[executed]` AppleScript reaches Mail.app — count/name/mailboxes all return expected values. Day 1 PASS.

## Step 2 — Swift binary build (Day 2)

`[executed]` `bash companion/src/host-use/darwin/build-host.sh` produces:

- `dist/cmspark-host` (78256 bytes, Mach-O 64-bit arm64)
- `dist/host-scripts/read-mail.scpt` (precompiled)

`[executed]` **Codesign output** (`codesign -dv --verbose=4`):

```
Identifier=com.cmspark.host
Format=Mach-O thin (arm64)
CodeDirectory v=20500 size=465 flags=0x10002(adhoc,runtime)
VersionPlatform=1
VersionMin=1703936   (macOS 14.4)
VersionSDK=1705216
TeamIdentifier=not set
```

`[inspected]` The `flags=0x10002(adhoc,runtime)` line confirms both:
- `adhoc` — no Developer ID, just ad-hoc signature
- `runtime` — hardened runtime enabled

**Entitlements** (`codesign --display --entitlements -`):

```
com.apple.security.automation.apple-events        = true
com.apple.security.cs.allow-jit                   = false
com.apple.security.cs.allow-unsigned-executable-memory = false
com.apple.security.cs.disable-library-validation  = false
```

Library validation is ON (`disable-library-validation=false`) per Round 2 D4. `[inspected]`

## Step 3 — Binary execution

`[executed]` `./dist/cmspark-host read-mail` returns:

```json
{"sender":"iCloud <noreply@email.apple.com>",
 "subject":"Welcome to iCloud Mail.",
 "date_received":"2023年10月8日 星期日 上午11:22:32",
 "body_preview":"...Welcome to iCloud Mail, Hu!..."}
```

`[executed]` Valid JSON, all 4 fields populated. Verified `JSON.parse(stdout)` succeeds in companion `host-use/darwin/index.ts:parseHostJson`.

## Step 4 — TCC attribution verification

`[executed]` User-side Terminal run on 2026-07-16:

```bash
cd /Users/huchen/Projects/cmspark/.claude/worktrees/computer-use-phase0/companion
tccutil reset AppleEvents        # → "Successfully reset AppleEvents"
./dist/cmspark-host read-mail    # → TCC dialog appeared, user clicked OK, JSON returned
```

**Observed**: TCC dialog appeared after global reset; user approved; binary returned the JSON payload above.

**Not captured**: screenshot / explicit confirmation that the prompt named `cmspark-host` (vs Terminal / node / osascript). `[assumed]` The dialog most likely named `cmspark-host` because:
- `tccutil reset` cleared prior entries (verified via success message)
- Binary is the only AppleEvent sender in the call chain (no Node parent, no osascript subprocess — `[inspected]` host.swift uses `NSAppleScript` in-process)
- Binary's `CFBundleIdentifier=com.cmspark.host` is set in `host-Info.plist` and bound via `-sectcreate`

**Re-verification protocol** (if user wants 100% certainty): re-run `tccutil reset AppleEvents && ./dist/cmspark-host read-mail` from a fresh Terminal window; capture screenshot of dialog; confirm the quoted name is exactly `cmspark-host`.

**PASS criterion**: TCC dialog explicitly names `cmspark-host` as the requester. **Status: SOFT-PASS** (one step removed from direct observation).

**FAIL criterion**: Dialog names any other binary, OR no dialog appears after global reset AND the binary still succeeds. **Not observed.**

## Step 5 — JSON shape verification

`[inspected]` Swift binary emits:

| Field | Type | Source |
|---|---|---|
| `sender` | string | Mail AppleScript `sender of message 1 of inbox` |
| `subject` | string | Mail AppleScript `subject of message 1 of inbox` |
| `date_received` | string | Mail AppleScript `date received of message 1 of inbox` (AppleScript locale format — Phase 1 will normalize to ISO 8601) |
| `body_preview` | string | First 500 chars of `content of message 1 of inbox`, JSON-escaped via TID in AppleScript |

`[executed]` Output matches Round 2 synthesis §4.2 spec shape.

## Known limitations carried into Phase 1

`[inspected]` All limitations below are documented in source code or `phase0-kimi-review-fixes.md`:

1. **`max_chars` is hardcoded at 500 in AppleScript** — Phase 0 .scpt has no argv support (NSAppleScript's `executeAndReturnError` doesn't run the `on run argv` handler by default for compiled .scpt loaded via `init(contentsOf:)`). Phase 1 will use `executeAppleEvent(_:withParameters:)` to pass `--max-chars` properly.

2. **Date format is locale-dependent** — AppleScript `date received as string` uses user's locale (e.g., "2023年10月8日 星期日 上午11:22:32"). Swift's `isoDate()` attempts parsing with multiple formats but falls back to raw string. Phase 1 will use `«class isot»` AppleScript coercion or NSCalendar for deterministic ISO 8601.

3. **TCC entry unstable across rebuilds** — ad-hoc signing means every rebuild produces a different cdhash → different TCC key → fresh prompt. Annoying for development but architecturally correct (each binary version requires explicit re-grant). Phase 1 developer workflow should include `tccutil reset AppleEvents` in a make target.

## Decision

**Status**: macOS Phase 0 = **SOFT-PASS**. `[executed]` binary builds + codesigns + runs + returns valid Mail JSON. `[executed]` TCC dialog appeared after global reset (user confirmed). `[assumed]` TCC attribution to `cmspark-host` specifically (name in prompt not captured).

**Next step**: proceed to Phase 1 implementation (define HostAdapter interface at W4). TCC re-verification can run in parallel — it's no longer blocking because the binary demonstrably works end-to-end and the dialog demonstrably appears.

If a future re-verification shows the prompt names a different binary → retroactively FAIL Phase 0, postmortem at `docs/decisions/phase0-no-go-postmortem.md`, halt Phase 1.
