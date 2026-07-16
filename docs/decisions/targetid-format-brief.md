# TargetId Format Contract — 3-Way Advisor Brief

> **Date**: 2026-07-16
> **Decision needed**: TargetId opaque string format on each platform + cross-platform validation rules + stale-target detection.
> **Authority**: Round 2 §2.1 (HostAdapter interface) + Kimi Round 2 #14 (branded type needs runtime validator).
> **Status**: pre-review brief for Kimi + Pi-sub.

## Context

`HostAdapter.listReadTargets(kind)` returns `TargetId[]` (branded opaque string). `readOne(targetId)` and `writeOne(targetId, ...)` consume the same TargetId. The contract must answer:

1. **Stability**: TargetId must be stable enough that list-now → read-later works (inbox may have changed)
2. **Cross-platform**: darwin/linux/win each emit TargetIds in their own format — what's the contract?
3. **Validation**: `validateTargetId(raw)` must reject malformed input from LLM without executing it
4. **Staleness**: if Mail inbox changes between list and read, should TargetId encode a snapshot/version, or just fail at read time?

## Three candidate designs

### Option A: Platform-native stable ID

```
darwin:  "macos:com.apple.mail:account-12345:msg-67890"   (account + message id)
linux:   "linux:atspi:/org/a11y/atspi/accessible/42"       (AT-SPI object path)
win:     "win:hwnd:0x1234:automationId:MessageRow.5"        (UIAutomation cache key)
```

- ✅ Each platform's ID is its native format, minimal translation
- ✅ Stable across inbox changes (message id is permanent)
- ❌ Prefix leaks platform info into TargetId — violates "opaque" principle?
- ❌ validateTargetId must know all 3 platform formats → adapter must expose validator

### Option B: URI-style unified scheme

```
"cmspark-target://darwin/com.apple.mail/account-12345/msg-67890"
"cmspark-target://linux/atspi/org/a11y/atspi/accessible/42"
"cmspark-target://win/hwnd/0x1234/MessageRow.5"
```

- ✅ Uniform prefix easy to validate (`/^cmspark-target:\/\/(darwin|linux|win)\//`)
- ✅ Self-describing — log/debug friendly
- ✅ Future-proof (other platforms just add new scheme)
- ❌ More verbose; LLM may struggle to reproduce exactly
- ❌ URL-encoding rules add escaping complexity

### Option C: Random UUID + adapter-side map

```
"01J2K3H4N5P6Q7R8S9T0UVWXYZ"   (26-char ULID)
```
Adapter maintains `Map<Uuid, PlatformNativeId>`. listReadTargets returns UUIDs; readOne looks up.

- ✅ Truly opaque — no platform leakage
- ✅ Trivial validateTargetId (ULID format check)
- ❌ Adapter state — breaks if companion restarts (Phase 1 daemon mode makes this worse)
- ❌ Can't survive across companion restarts — UX worse
- ❌ Phase 1 W5 implementation requires in-process state that survives across LLM tool calls but not process restart

## Open questions for advisors

### Q1: Positional index vs stable message ID on macOS?

Mail AppleScript has both:
- `message 1 of inbox` — positional, fragile
- `id of message 1 of inbox` — stable integer (account-scoped)

Stable is obviously better but requires the read path to look up by id:
```applescript
tell application "Mail"
  repeat with m in messages of inbox
    if id of m is targetMsgId then return m
  end repeat
end tell
```
O(n) scan. Phase 0 read top-1 doesn't need this; Phase 1 list+read needs it.

**Should TargetId encode the stable message id, accepting O(n) lookup?**

### Q2: Cross-platform prefix — leak or hide?

Option A leaks platform prefix (e.g., `macos:`). Option B uses URI scheme. Option C hides entirely (UUID map).

**Is platform leakage acceptable for opacity?** Companion shouldn't inspect TargetId internals, but a leaked prefix doesn't necessarily mean inspection happens.

### Q3: validateTargetId — strict or permissive?

Strict: reject any string not matching exact platform format.
Permissive: accept any non-empty string, fail at adapter call.

Strict catches LLM hallucinations earlier. Permissive is simpler.

### Q4: Stale-target detection — encode snapshot or fail at read?

If inbox changes between list and read, the TargetId may now point to a different message (positional) or no longer exist (deleted).

**Should the adapter verify "this is still the same message the user saw"?** Options:
- Encode message hash into TargetId — fail if hash mismatches
- Always fail at read time if message disappears
- Don't detect — user's problem

### Q5: Phase 1 W5 implementation scope

The minimal viable path is Option A with stable message IDs. Option B is nicer but more work. Option C is over-engineered for Phase 1.

**Pick one and justify**.

## Existing constraints (do not re-debate)

- 3-method interface (Round 2 §2.1)
- branded type + runtime validator (Kimi Round 2 #14)
- LLM never produces AppleScript source, only JSON args (Round 1 D3)
- Vault-app bundle ids blocked unconditionally (Round 1 D5)
- Phase 1 ships macOS-only until Linux/Windows RUNBOOK executed

## Reference

- `docs/decisions/host-adapter-interface.md` — interface design (Kimi Round 2 reviewed)
- `docs/decisions/computer-use-round2-synthesis.md` §2.1 — rule-of-three
- `companion/src/host-use/host-adapter.ts` — interface file with `validateTargetId(_)` stub

## Reviewer ask

For each of Q1-Q5, give:
- Recommendation
- Trade-off acknowledged
- Alternative rejected + why

Strict critical perspective. No nice-to-have suggestions — only "this will break" or "this is fine".
