# P2 Fixup Brief for Pi — Grok blocker resolution + AND/OR design ruling

> **Role**: Pi (second-pass reviewer, plan-confirmer). Grok completed P2 review
> (`review-grok-p2.txt`) with **CONDITIONAL APPROVE** + 3 blockers + 2 material
> issues. Claude fixed all 5; this brief asks Pi to:
>   1. Verify Grok's 3 blockers are resolved as coded (re-derive from patch)
>   2. Re-confirm C2 AND-vs-OR design (Grok's material #4 — design ruling needed)
>
> Scope: P2 fixup only. Same files as initial P2 brief, no scope creep.

## Grok blockers — fix summary

### Blocker 1: C4 leak — FIXED (defense in depth, 2 layers)

**Host layer** (`host.swift` cuScreenshot CAPTURE_FAILED path):
```swift
return cuError(
    "stale or solid capture frame",     // generic — no metrics
    code: "CAPTURE_FAILED",
    extra: ["capture_degraded": [...metrics...]])
```
Metrics ride only in `extra.capture_degraded` + stderr fputs. The old `error` string contained `reason=…, stdev=…, identity=…, sizeBytes=…`; now it is a fixed 28-char generic.

**TS layer** (`darwin-adapters.ts` `interpretScreenshotFailure`):
```typescript
if (code === "CAPTURE_FAILED") {
  logger.info("computer.capture.degraded", {...metrics...})
  return new ComputerError(
    code,
    "screenshot: stale or solid capture frame",   // hardcoded, ignores parsed.error
    parsed.capture_degraded ? { capture_degraded: parsed.capture_degraded } : undefined,
  )
}
return new ComputerError(code, `screenshot: ${parsed.error ?? "unknown error"}`)
```
Defense-in-depth: even if a future host regression puts metrics back in `parsed.error`, the TS layer force-overrides `.message` to generic. CAPTURE_FAILED is the only code that gets this treatment; other codes (PERMISSION_DENIED, etc.) still echo `parsed.error` as before.

**Test** (`computer-darwin-capture-degraded.test.ts` new test):
```
✔ P2/C4 (Grok blocker 3): metrics in parsed.error are STRIPPED from .message (regression guard)
```
The test feeds the OLD host-shaped `parsed.error` (with `stdev=0.123, identity=0.456, sizeBytes=4096`) and asserts `.message === "screenshot: stale or solid capture frame"` — i.e. zero leak.

### Blocker 2: self-test exit gate — FIXED (binary + build script)

**Binary** (`host.swift` self-test case):
```swift
case "self-test":
    let testOut = cuSelfTestClassifier()
    print(testOut)
    if let data = testOut.data(using: .utf8),
       let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let ok = obj["ok"] as? Bool, !ok {
        FileHandle.standardError.write("cuSelfTestClassifier reported failure\n".data(using: .utf8)!)
        exit(1)
    }
    exit(0)
```
Short-circuits before the unified `print(out); exit(0)` main path. Verifies `[ok]:true` in JSON, not just non-empty stdout.

**Build script** (`build-host.sh` step 4b):
```bash
SELF_TEST_OUT=$("${OUTPUT_BIN}" self-test 2>/dev/null) || { ...exit 1 }
if ! echo "${SELF_TEST_OUT}" | grep -q '"ok":true'; then ...exit 1; fi
```
Double gate: non-zero exit AND `"ok":true` substring.

**Verified by injection** `[executed]`:
```
# Forced assertion failure (stdevZeros == 0.0 inverted)
[host] cuSelfTestClassifier FAIL: stdev_zeros: expected 0.0, got 0.0
cuSelfTestClassifier reported failure
{"ok":false,"error":"classifier self-test failed: ...","error_code":"SELF_TEST_FAILED"}
EXIT=1
```
Build would fail at step 4b. Restored host.swift to clean, re-ran build — passes.

### Blocker 3: false-green C4 test — FIXED (new regression-guard test)

See Blocker 1 test. Old `freshPayload()` used sanitized error string → no metrics in input → trivially "no leak". New test injects the actual host-shaped payload with metrics in `parsed.error` and asserts the TS layer overrides regardless.

## Grok material issues — fix summary

### Material 5: self-test real AND truth table — FIXED

Added 4 new assertions to `cuSelfTestClassifier`:
- `and_truth_low_low_not_stale` — low stdev ∧ low identity → NOT stale (caret-blink false-positive guard)
- `and_truth_high_high_not_stale` — high stdev ∧ high identity → NOT stale (contentful freeze)
- `and_truth_high_low_not_stale` — high stdev ∧ low identity → NOT stale (live frame)
- `empty_bitmap_contract` — empty downsample → stdev=0, identity=-1; documents the sizeGuard dependency

`build-host.sh` self-test now passes 13/13 (was 9/9).

### Material 6: empty-bitmap fail-closed — FIXED

`cuScreenshot` adds an explicit guard before the AND clause:
```swift
let downsampleEmpty = downsample.isEmpty
if sizeGuard || downsampleEmpty {
    stale = true
} else if let _ = prior { ... }
```
Reason taxonomy extended: `size_guard` > `downsample_failed` > `pixel_identity` > `luma_stdev`. Without this, a CGContext draw failure that wrote a non-empty PNG but produced an empty bitmap would silently pass (cuIdentity returns -1 on length mismatch → AND clause false → stale false).

## What still needs Pi ruling (Grok material #4)

### The design conflict

Grok v4.1 plan §2.4 originally specified:
> `stale = luma stdev < 1.0` **OR** `≥99% identity vs prior same windowId`

Pi's v4.1 review C2 caveat overrode this:
> use AND-of-conditions when a prior exists; use stdev-only when no prior exists. **OR (Grok's wording) is too permissive**: a stale frame with caret blink could miss the stdev test but match identity.

Grok's P2 review now objects to AND:
> AND under-detects stale freezes. Contentful frozen frame (high stdev ∧ high identity) → AND false → not flagged. Plan-level conflict.

Grok proposes:
> `stale = sizeGuard || stdev < 1.0 || (prior && identity >= 0.99)` with identity tightenable to 0.999 if caret FP shows in canary.

### Claude's reading of the threat model

Pi's original concern: SCK returning a fully black frame for an occluded background window. That class always has low stdev (frame is uniform black) — both OR and AND catch it.

Grok's new concern: a frozen but contentful frame (UI froze mid-render, displaying real pixels but not updating). Frame has high stdev (rich content), high identity (frozen). Neither OR nor AND with the current identity threshold catches this — *both* miss it.

The frozen-contentful class requires a different signal (e.g. 3+ consecutive identical captures, or a system "App Not Responding" probe) — outside P2 scope.

### Claude's question for Pi

For **P2 ship**, which classifier shape do you want?

| Option | Formula | Behavior | Trade-off |
|---|---|---|---|
| **A: keep AND** (current) | `sizeGuard \|\| downsampleEmpty \|\| (prior ? (stdev<1 ∧ id≥0.99) : stdev<1)` | Catches: blank/occluded frames, 0-byte PNGs. Misses: frozen-contentful frames, caret-blink with low stdev + low identity (probably impossible — caret changes cell luma → stdev not low). | Tighest; no false-positive risk. R1 partially closed (blank-frame class only). |
| **B: restore OR** (Grok v4.1) | `sizeGuard \|\| downsampleEmpty \|\| stdev<1 \|\| (prior ∧ id≥0.99)` | Catches: same as A + contentful frozen (id≥0.99). False-positive risk: caret-blink in a uniform field trips via id≥0.99 even with low stdev (caret flips 1 cell → id=0.99976 > 0.99 → stale=true even though frame is live). | False-positive on terminals, editors with blinking carets. Tightenable to 0.999 if FP shows. |
| **C: OR + tighter id** (Grok proposal) | `... \|\| (prior ∧ id≥0.999)` | Catches: same as B. FP-resistance: caret-blink flips 1 cell of 4096 = id=0.99976 > 0.999 → still trips. Need id≥0.9999 (max 0 cells changed, i.e. exact match only) to fully escape caret-blink FP — but then it's near-useless. | Marginal FP improvement vs B; same R1 closure. |

**Claude's recommendation**: **Option A (keep AND)**. Reasoning:
1. The threat class Pi originally named (occluded black frame) is fully caught by AND.
2. Frozen-contentful frames are a separate threat class that needs a different detector (consecutive-identical-count, ANR probe), not a weaker classifier.
3. AND has zero false-positive risk on terminals/editors — important because dev workflows (the user's primary scenario) are full of blinking carets.
4. Grok's "OR tightenable to 0.999" doesn't actually escape caret FP at any reasonable threshold.

If Pi prefers B/C, the swap is one line in `cuScreenshot` + updated `cuSelfTestClassifier` truth table. No architectural change.

## Verification `[executed]`

```
npx tsc --noEmit           → clean
npm test                   → 1809 tests, 1788 pass, 3 pre-existing failures (unchanged from pre-P2)
  └─ P2 capture-degraded suite: 8/8 pass (was 7/7; added Groker-3 regression-guard)
bash build-host.sh         → SUCCESS, 13/13 self-test assertions, exit 0
self-test injection test   → assertion failure exits 1, stdout "ok":false, build would fail

cmspark-host SHA256: 8473498be11d46dd3d07a74ef5a599937b32d40e3eb8f34b09f2aab8a72771d5
host-integrity.ts auto-rewritten with same SHA
```

## Files (P2 cumulative)

| File | Status | P2 LOC |
|---|---|---|
| `companion/src/host-use/darwin/host.swift` | modified | +186 (cuError extra, CAPTURE_FAILED metrics w/ generic msg, cuSelfTestClassifier w/ 13 assertions, self-test case w/ exit gate, downsampleEmpty guard, reason taxonomy) |
| `companion/src/computer/darwin-adapters.ts` | modified | +60 (interpretScreenshotFailure w/ defense-in-depth generic msg, sha256-before-okcheck) |
| `companion/src/host-use/darwin/build-host.sh` | modified | +16 (4b self-test gate w/ exit-code + "ok":true substring) |
| `companion/tests/computer-darwin-capture-degraded.test.ts` | new | +232 (8 tests including Grok blocker 3 regression guard) |

## What I need from Pi

1. **Blocker verification** — re-derive from `docs/decisions/v1.3/p2-fixup-diff.patch` that all 3 Grok blockers are actually resolved (not just claimed).
2. **C2 design ruling** — Option A (keep AND) / B (restore OR) / C (OR + tighter id). My recommendation: A.
3. **Material issue closure** — confirm material 5/6 fixes are sufficient or list additional gates needed.

Save verdict to `docs/decisions/v1.3/review-pi-p2.txt`. If APPROVE, P3 may start. If CONDITIONAL, list blockers. If REJECT, name the design path to take.

## Claude's commitment

Until Pi signs off:
- No commit, no push, no P3 work
- If Pi rules for Option B/C, the classifier swap is one line + updated self-test truth table — re-review only the swap, not full P2
- If Pi surfaces new blockers, they go in this same worktree

---

**Claude (implementer)** — hand off to Pi for final P2 sign-off.
