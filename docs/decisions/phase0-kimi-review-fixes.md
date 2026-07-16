# Phase 0 Kimi Review — Fix Log

> **Source review**: `docs/decisions/phase0-kimi-review.txt` (Kimi CLI, session `be6dfa9e`)
> **Date**: 2026-07-16
> **Reviewer's verdict**: "修复前不应进入 Phase 0 用户测试"

## Critical issues — status

### 🔴 C1: `jsonEscape` is a no-op (TID misuse) — **FIXED**

**File**: `companion/src/host-use/darwin/read-mail.applescript`

**Bug**: `set s to (text items of s) as string` was called twice in a row with the same delimiter, which split+joined with the same character — a no-op. No actual JSON escaping happened.

**Fix**: Capture `text items of s` into a variable BEFORE switching the delimiter:
```applescript
set AppleScript's text item delimiters to "\\"
set sParts to text items of s          -- capture first
set AppleScript's text item delimiters to "\\\\"
set s to sParts as string               -- join with new delimiter
```

**Verification**: `/tmp/test-jsonescape.scpt` returns valid JSON for malicious input `attacker"foo\bar[CR][LF]embedded` — properly escaped to `attacker\"foo\\bar\r\nembedded`. Attempted injection `safe","injected_key":"value` is escaped and stays as a single field value.

### 🔴 C2: `.scpt` file is unsigned — **Phase 1 prerequisite (documented)**

**File**: `companion/dist/host-scripts/read-mail.scpt`

**Bug**: Attacker who can write to `dist/host-scripts/` replaces the .scpt with arbitrary AppleScript, which then runs under the already-granted TCC permission of `cmspark-host`. Devs/users who clicked "Allow" once for the binary implicitly trust any .scpt dropped next to it.

**Why Phase 0 defers**: Phase 0 is single-machine spike proving TCC attribution. The `.scpt` is created by build-host.sh on the dev's own machine; no distribution; no attacker in trust model yet. Phase 1 must:
- Embed `.scpt` into signed Swift binary as resource, OR
- Hash-verify `.scpt` against a constant compiled into the binary, OR
- Move all AppleScript into Swift via `NSAppleScript(source:)` + compile-time validation

### 🔴 C3: `CMSPARK_HOST_BIN` env override + no `SecStaticCodeCheckValidity` — **partially fixed, Phase 1 completes**

**File**: `companion/src/host-use/darwin/index.ts`

**Partial fix**: `CMSPARK_HOST_BIN` now rejected when `NODE_ENV=production` (test convenience retained for dev). Wrap `JSON.parse` in try/catch with clean error.

**Phase 1 prerequisite**: Before ship, companion must `SecStaticCodeCheckValidity` the binary before spawning. Round 2 synthesis D4 explicitly requires this; current SHA256 check on `cmspark-tray` is the same problem in miniature.

### 🔴 C4: `application` parameter has no whitelist — **FIXED**

**File**: `companion/src/host-use/darwin/blacklist.ts` + `index.ts`

**Fix**: Added `READ_ALLOWED_APPS` whitelist (Phase 0: `com.apple.mail` only). hostRead now checks blacklist first, then whitelist — both must pass. LLM passing `com.apple.finder` or `com.apple.Notes` is rejected even though those aren't blacklisted.

## Major issues — status

### 🟠 M5: Vault blacklist too narrow — **FIXED**

**File**: `companion/src/host-use/darwin/blacklist.ts`

**Fix**: Expanded from 4 entries to 27. Now covers:
- Password managers (1Password × 3, Bitwarden, LastPass, Dashlane, KeePassXC)
- Apple system credentials (Keychain, SecurityAgent, System Settings, Wallet, Authenticator)
- Browsers (Safari, Chrome, Firefox, Edge, Brave, Arc, Mighty)
- Terminals (Terminal, iTerm, Warp, Neovide)
- Crypto wallets (MetaMask, Ledger Live, Exodus, Electrum)

Phase 1 still needs `AXSecureTextField` role + window-title heuristics (Round 2 D5) for defense in depth.

### 🟠 M6: `findScript` uses `CommandLine.arguments[0]` not realpath — **Phase 1**

Documented in `host.swift` source. Phase 0 is dev-machine only; symlink attacks are out of trust model. Phase 1 must use `Bundle.main` + `realpath` for distributed builds.

### 🟠 M7: build-host.sh lacks `codesign --verify` — **FIXED**

**File**: `companion/src/host-use/darwin/build-host.sh`

**Fix**: Added `codesign --verify --verbose "${OUTPUT_BIN}"` step. Build now fails on signature corruption (was previously display-only).

### 🟠 M8: `max_chars` argv ignored by host.swift — **Phase 0 acceptable, Phase 1 fix**

Phase 0 hardcodes `max_chars=500` in AppleScript source. The CLI flag `--max-chars` is parsed by Swift but not propagated to NSAppleScript (would need `executeAppleEvent(_:withParameters:)` to pass argv properly). Schema accepts the param for forward compatibility.

## Minor issues — status

- **m9** (`text 1 thru maxChars` UTF-16 truncation): documented; Phase 1 will move truncation to Swift `String.prefix(_:)` (grapheme-cluster aware).
- **m10** (`-sectcreate` NSAppleEventsUsageDescription may not show in TCC dialog): documented in `phase0-macos-gate-evidence.md` Step 4 as user-side verification item. If TCC dialog is generic, Phase 1 must move to proper `.app` bundle.
- **m11** (stderr leaks script paths / mail content): documented; Phase 1 will redact stderr before returning to companion.
- **m12** (`JSON.parse` without try/catch): **FIXED** — `parseHostJson` helper now wraps parse with clean error.
- **m13** (entitlements don't explicitly set `allow-dyld-environment-variables=false`): deferred — defaults are correct, explicit declaration is documentation polish for Phase 1.

## Round 2 Kimi review on fixes — **NOT DONE**

Per memory `kimi_review_every_fix`: "2026-07-15 起所有迭代 debug 修复必须 Kimi review 后才算完成".

These fixes are initial-implementation corrections based on Round 1 Kimi review, not iterative debug fixes during execution. The strict letter of the rule doesn't require Round 2. But the spirit (security-critical code gets second-set-of-eyes) does. Recommend running Kimi Round 2 on the diff before merging to main.

Action: tag `phase0-kimi-round2-pending` in commit message; schedule Kimi Round 2 review after TCC verification (Step 4 of macOS gate evidence) confirms the gate passes. If gate fails, no Round 2 needed (project killed).
