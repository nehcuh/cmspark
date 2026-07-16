# Phase 1 W8 Biometric Tier — Final Decision (Kimi+Pi 三方共识)

> **Date**: 2026-07-16
> **Process**: brief → Kimi + Pi-sub 3-way advisor → this final.
> **Outcome**: Option A — all writes biometric. W6 behavior changes (Notes create + Finder move from ask-once to biometric).

## Decision: Option A — All Phase 1 writes biometric

### Reasoning (Kimi + Pi-sub independent agreement)

1. **W7 Q1 ship blocker already locked**: `docs/decisions/w7-trusted-apps-final.md:28-32` says "Writes always require biometric per call, never thread-trusted." Option B/C reopen this — would-block-Phase-1-ship.

2. **Round 2 §4.2 literal**: "biometric: Touch ID 用于 write". No exceptions for reversible verbs.

3. **Tier collapse risk** (Pi-sub): If Notes create is ask-once and Mail send is biometric, future engineer adding destructive verbs sees the L2 code path and ships without biometric audit. The invariant "writes go through biometric manager" is the only defense that survives verb addition without re-audit.

4. **Round 1 §4.5 reversibility**: Still tracked via `WriteResult.undoable` field for UX hint (show "可撤销" badge in audit log), NOT for tier gating. Reversibility and confirmation tier are orthogonal.

### What changes in W8

| Behavior | W6 (current) | W8 (after) |
|---|---|---|
| `host_write create` Notes | ask-once (45s dialog) | **biometric** (Touch ID per call) |
| `host_write move` Finder | ask-once (45s dialog) | **biometric** (Touch ID per call) |
| `host_write update` | rejected "Phase 1 W7+" | **biometric** (Phase 1 W8 implements) |
| `host_write delete` | rejected "requires biometric" | **biometric** + double-confirm (Phase 1 W8 implements) |

### Implementation plan

**Swift binary** (`companion/src/host-use/darwin/host.swift`):
- New `biometric-verify --nonce <N> --reason <text>` subcommand
- Uses `LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` 
- `localizedFallbackTitle = ""` — NO password fallback (would collapse tier per Pi-sub)
- `LAError.userCancel` / `systemCancel` → exit non-zero, non-retryable
- `LAError.biometryLockout` → exit with specific code, message points to System Settings
- Returns `{"verified": true, "nonce": "<N>"}` JSON on success
- Pipe through existing `cmspark-host` binary (NOT side channel) so `SecStaticCodeCheckValidity` covers biometric path too

**WS protocol** (`companion/src/security-confirmation.ts` + `server.ts`):
- Extend `SecurityConfirmationRequest` with `risk_level: "biometric"` option
- Add `nonce: string` field (6-char random for Linux; arbitrary for macOS biometric binding)
- Add `biometric_reason: string` field (shown in Touch ID dialog)
- New message `security.biometric.challenge` sent from companion to extension BEFORE Swift binary spawn (extension shows "请在 Touch ID 上确认..." prompt)
- After Swift binary returns success, confirmation resolves approved

**Server-side** (`companion/src/server.ts`):
- `host_write` case: detect kind, if write → route to biometric confirmation (NOT ask-once)
- For each write call: generate random nonce, bind to tool_call_id, invoke Swift binary
- Audit log `security.biometric.verified` with all 5 fields per W7 Q8

**Extension UI** (`chrome-extension/src/sidepanel/App.tsx` SecurityConfirmationDialog):
- When `risk_level === "biometric"` AND platform is darwin: show Touch ID prompt UI ("请在 Touch ID 上确认: <reason>") + spinner; actual Touch ID triggered by companion-side Swift binary
- When `risk_level === "biometric"` AND platform is linux: show "请输入确认码: <ABC123>" + text input (Round 2 §2.3 Kimi加严: 不可复制粘贴, must type)
- Disable Approve button until biometric verification completes (companion-driven)

**Tests**:
- biometric-verify success path
- biometric-verify user cancel (non-retryable)
- biometric-verify biometryLockout (specific error)
- Linux nonce: typing correct → approved; typing wrong → denied after 3 attempts
- W6 regression: Notes create + Finder move now require biometric (NOT ask-once)

## Phase 2 backlog

- Time-bounded biometric session (5min) if W8 ship shows fatigue (W7 Q1 Phase 2 escape hatch)
- Persistent biometric trust (NEVER — same as thread whitelist Q1 blocker)

## Kimi+Pi artifacts

- `docs/decisions/w8-biometric-scope-brief.md` (pre-review)
- `docs/decisions/adversary-kimi-w8.txt` (Kimi output)
- Pi-sub Agent review (conversation history)
