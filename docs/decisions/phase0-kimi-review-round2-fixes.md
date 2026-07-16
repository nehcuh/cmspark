# Phase 0 Kimi Round 2 Review — Fix Log

> **Source review**: `docs/decisions/phase0-kimi-review-round2.txt` (Kimi CLI, session `34c642e9`)
> **Date**: 2026-07-16
> **Scope reviewed**: diff `e40065b..HEAD` — `b13836b` standards-fixes + `9a92e85` HostAdapter design

## 🔴 Critical — FIXED

### C1: `host_read` doesn't validate `security_token` — **FIXED**

**File**: `companion/src/server.ts:1124` (host_read case)

`[inspected]` **Bug**: `evaluate` (line 447) and `osascript_eval` (line 1058) both call `securityPolicy.validateToken(...)` inside their executeCompanionTool cases. `host_read` did NOT — meaning any non-empty `security_token` value in params would bypass the L2 gate at `server.ts:303` (which only checks truthy) and `host_read` would execute without confirmation.

**Impact**: LLM could pass `security_token: "anything"` to silently trigger Mail read. Worse, a stale or cross-tool token would also work since validation was absent.

**Fix**: Mirror osascript_eval pattern in host_read case:
```ts
if (params.security_token) {
  const valid = securityPolicy.validateToken(
    String(params.security_token),
    "host_read",
    String(params.application || ""),
  )
  if (!valid) {
    return { success: false, error: "Invalid or expired security token for host_read" }
  }
}
```

Token binds to `(toolName="host_read", code=application, threadId)` — approving host_read for Mail does NOT auto-approve host_read for Notes (different `application`).

`[executed]` **Verification**: 2 new integration tests in `tests/integration/security-gates.test.ts`:
- `Kimi Round 2 Critical: host_read with invalid security_token is rejected (no L2 bypass)` — forged string token returns `/Invalid or expired security token/` and does NOT trigger confirmation request
- `Kimi Round 2 Critical: host_read with token issued for evaluate is rejected (toolName binding)` — cross-tool token (issued for evaluate) rejected for host_read

Both tests pass (verified via `npm test`).

## 🟡 Major — addressed

### M3-accuracy: god-mode comment misrepresents ADR-010 — **FIXED**

**File**: `companion/src/server.ts:303`

`[inspected]` **Issue**: Comment said "user must have explicitly opted into god-mode via the standard phrase gate per ADR-010". ADR-010 actually has TWO paths: UI confirmation phrase, OR direct config.json edit. The "standard phrase gate" wording implied only the UI path.

**Fix**: Comment now accurately describes both opt-in paths and explicitly references the `security.auto_approved` audit log event at line 428-435 as the audit trail.

### M-enum: TargetKind enum premature abstraction — **FIXED in interface doc**

**File**: `docs/decisions/host-adapter-interface.md`

`[inspected]` **Issue**: Original enum included `mail-thread` and `calendar-event` which were not validated by any of the 3 platform spikes (Round 1 Pi warned about early abstraction).

**Fix**: Trimmed to `mail-inbox | note | file` (only kinds Phase 1 actually plans to implement). Adding `mail-thread` / `calendar-event` deferred until ≥2 platforms have real implementations.

### M-payload: `WritePayload` not discriminated union — **FIXED in interface doc**

**File**: `docs/decisions/host-adapter-interface.md`

`[inspected]` **Issue**: Single interface with optional fields let invalid states be representable (e.g., `delete` with body, `create` without body).

**Fix**: Changed to discriminated union:
```ts
type WritePayload =
  | { kind: "create"; body: string }
  | { kind: "move"; destination: string }
  | { kind: "update"; body: string }
  | { kind: "delete" }
```

### M-readresult: `ReadResult` index signature weakened type safety — **FIXED in interface doc**

**File**: `docs/decisions/host-adapter-interface.md`

`[inspected]` **Issue**: `[key: string]: unknown` allowed platforms to emit arbitrary fields, making LLM prompt contracts unstable.

**Fix**: Removed index signature. Strict optional fields only. Added `file_path` for TargetKind="file". Phase 2 extends interface explicitly, not via index signature.

### M-list: `listReadTargets` race + perf — **FIXED in interface doc**

**File**: `docs/decisions/host-adapter-interface.md`

`[inspected]` **Issue**: Planned wrapper `readOne(listReadTargets("mail-inbox")[0])` would (a) materialize entire list just to take first (perf regression vs Phase 0 direct read), (b) introduce TOCTOU race (inbox changes between list and read), (c) crash on `[0]` of empty list.

**Fix**: Added `limit?: number; cursor?: string` options to `listReadTargets`. Phase 0's `hostRead(params)` direct top-1 path stays as-is; the adapter's `readOne` calls the binary directly for Mail top-1. `listReadTargets` is for future "list inbox, pick one" UX, not for the Phase 0 hot path.

### M-confirm: 4-tier confirmation responsibility unspecified — **FIXED in interface doc**

**File**: `docs/decisions/host-adapter-interface.md` (new "Confirmation responsibility" section)

`[inspected]` **Issue**: Interface was silent on where the 4-tier gradient lives. Risk: each platform adapter implementing its own confirmation (bad) or companion missing platform-specific Linux nonce.

**Fix**: Documented explicitly: confirmation lives in companion `security-confirmation.ts`, NOT inside adapter. Adapter contract: never prompt internally; surface failures as thrown errors. Decision matrix added mapping operation → tier → platform mechanism.

### M-targetid-brand: branded type needs runtime validator — **FIXED in interface doc**

**File**: `docs/decisions/host-adapter-interface.md`

`[inspected]` **Issue**: Brand alone is insufficient — TypeScript brands evaporate at `as` casts. Any code doing `rawString as TargetId` bypasses type safety.

**Fix**: Added `validateTargetId(raw: string): TargetId` runtime helper. Companion code MUST call this for any TargetId sourced from LLM input. Platform adapters cast internally at the boundary.

### M-empty-list: empty vs permission-denied error contract — **FIXED in interface doc**

**File**: `docs/decisions/host-adapter-interface.md`

`[inspected]` **Issue**: Original doc said "empty array is valid" but didn't distinguish empty inbox from permission failure. LLM could misreport "inbox empty" when actually blocked.

**Fix**: Documented explicitly: `[]` = valid empty; permission denied / TCC failure / AT-SPI bus unreachable = thrown error. Companion surfaces errors to LLM as `{success:false, error:"..."}`.

## 🟢 Already right (Kimi Round 2 confirmed)

- M1 evidence tags mostly accurate (`[executed]` for build/codesign/run, `[inspected]` for static reading, `[assumed]` for TCC prompt name)
- M2 platform guard removal correct (error surfaces via try/catch, no silent failure)
- 3-method interface abides by Round 2 §2.1 rule-of-three
- `TargetId` opaque string design correct (platform tokens don't leak)
- Windows Phase 1.5 gating honest (no vague "Phase 1.5" soft-landing)
- `build-host.sh` codesign --verify already in place

## Round 3 deferred items (Phase 1 prerequisites)

- Implement `validateTargetId` runtime helper per platform
- Implement `darwin/adapter.ts` with proper list+read separation (NOT the naive `[0]` wrapper)
- Document `security.godmode_bypassed` event specifically for host_read if ADR-010 strict reading required (currently `security.auto_approved reason:"god_mode"` serves as audit trail — acceptable per ADR-010 §3 commentary)
