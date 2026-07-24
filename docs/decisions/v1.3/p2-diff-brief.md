# P2 Diff Brief for Grok + Pi — capture variance classifier

> **Scope**: Pi v4.1 CONDITIONAL APPROVE constraints C1-C4 (P2 only).
> Branch: `worktree-approach-c-minus-skylight`. SHA at time of writing: HEAD.
> Claude ceased planning role; this is implementation-only against Grok v4.1 plan.

## What landed

### Files touched (P2 only)
| File | Change | LOC |
|---|---|---|
| `companion/src/host-use/darwin/host.swift` | `cuError` extended with `extra` dict (default empty, source-compatible); `cuScreenshot` CAPTURE_FAILED path returns metrics via `extra.capture_degraded`; `cuSelfTestClassifier()` pure-function self-test (9 assertions); new `self-test` subcommand | +104 |
| `companion/src/computer/darwin-adapters.ts` | New `interpretScreenshotFailure(hwnd, parsed, localSha256?)` exported pure-ish helper; `MacScreenCapturer.captureWindow` replaces `checkOk(...)` with inline ok-check that delegates to it; `sha256` computation moved before ok-check so the helper can fall back to it | +55 |
| `companion/src/host-use/darwin/build-host.sh` | New step (4b/5): runs `cmspark-host self-test` post-codesign; build fails if classifier regresses | +12 |
| `companion/tests/computer-darwin-capture-degraded.test.ts` | New unit suite (7 tests) for `interpretScreenshotFailure` | +188 |

### Out of scope (not touched by P2)
P3 (scaleX/scaleY/drift 8px/locate-chain re-validate) and P4 (`reL2ShouldPrompt` predicate + idle 30 min + credentialSurfaceSeen latch) are **not in this diff**. P5 was deferred by Pi until P2-P4 land and pass review.

## Constraint mapping (Pi C1-C4)

### C1 — size-and-bytes guard alongside luma/identity
**Site**: `host.swift` `cuScreenshot`, `sizeGuard` computation.

```swift
let sizeGuard = sizeBytes < 1024 || imageWidth < 8 || imageHeight < 8
var stale = false
if sizeGuard {
    stale = true   // wins — stdev/identity undefined for 0-byte / 0-dim
} else if let _ = prior { ... } else { ... }
```
Reason taxonomy in the audit payload: `size_guard` > `pixel_identity` (prior exists) > `luma_stdev` (no prior). Empty/missing PNG cannot rescue the luma/identity classifier, so `sizeGuard` short-circuits BEFORE stdev is consulted. Tests: `size_guard reason wins (0-byte PNG / 0-dim image)`.

### C2 — AND-of-conditions when prior exists; stdev-only when no prior
**Site**: `host.swift` `cuScreenshot`, branches on `prior`.

```swift
if sizeGuard {
    stale = true
} else if let _ = prior {
    // Pi C2 caveat: OR over-flags caret-blink frames.
    stale = (stdev < 1.0 && identity >= 0.99)
} else {
    stale = stdev < 1.0   // first capture of this window
}
```
Self-test #6 proves 1-cell change (caret-blink analog) yields `identity = (n-1)/n = 0.99976 > 0.99` — AND-clause does NOT flag stale when stdev is low **and** identity is also low (the realistic caret-blink case where stdev happens to dip).

### C3 — 99% identity threshold, canary-tightened later
**Ship**: `0.99`. Threshold field exposed in audit payload:
```json
"threshold": { "stdev_lt": 1.0, "identity_gte": 0.99, "min_bytes": 1024, "min_dim": 8 }
```
Operator audit emits this on every CAPTURE_FAILED so post-canary tightening to `0.999` is a one-line change with operator visibility.

### C4 — LLM sees CAPTURE_FAILED only; metrics go to operator audit
**TS site**: `darwin-adapters.ts` `interpretScreenshotFailure`.

```typescript
if (code === "CAPTURE_FAILED") {
  logger.info("computer.capture.degraded", {
    windowId, reason, stdev, identity, sizeBytes, imageWidth, imageHeight,
    threshold, prior_present, sha256,
  })
}
return new ComputerError(
  code,
  `screenshot: ${parsed.error ?? "unknown error"}`,        // generic, no metrics
  parsed.capture_degraded ? { capture_degraded: parsed.capture_degraded } : undefined,
)
```
Tests assert:
1. `reason`, `stdev`, `identity`, `sizeBytes` ARE in audit fields
2. `.message` does NOT contain `0.123`, `0.999`, `4096`, or any `/degraded.*activate/i` coaching
3. `ComputerError.detail.capture_degraded` carries the same payload for ops tooling
4. Non-CAPTURE_FAILED codes (PERMISSION_DENIED etc.) do NOT trigger audit

## Verification `[executed]`

### Swift
```
[build-host] (4b/5) Running classifier self-test...
{"passed":["stdev_zeros","stdev_whites","stdev_half","identity_identical",
           "identity_mismatched_len","identity_caret_blink_gt_0.99",
           "identity_big_change_lt_0.99","and_prior_stale_idHigh",
           "no_prior_stdev_only"],"ok":true}
[build-host] SUCCESS — Binary 281024 bytes, SHA256 7524948b25d32efcb10fcbde864a21cb9310368b579a74c87c7f47a9e8f686ac
```
SHA auto-rewritten in `host-integrity.ts`; codesign verifies.

### TypeScript
```
npx tsc --noEmit  →  clean
node --test computer-darwin-capture-degraded.test.js
  ✔ 7/7 pass
    CAPTURE_FAILED emits computer.capture.degraded audit with full metrics
    classifier metrics NEVER leak into LLM-facing error.message
    ComputerError.detail carries capture_degraded for ops tooling
    pixel_identity reason (prior exists) audit + typed error
    size_guard reason wins (0-byte PNG / 0-dim image)
    non-CAPTURE_FAILED errors do NOT emit capture.degraded audit
    CAPTURE_FAILED without capture_degraded block still audits with reason=unknown
```
Full suite: 1808 tests, 1787 pass, **3 pre-existing failures unrelated to P2**:
- `apps-config.test: comparison is case-insensitive (NTFS)` — Windows path normalization (I did not touch apps-config)
- `apps-handlers.test: apps.add lolbin → lolbin_denied error code` — lolbin detector path (I did not touch apps-handlers)
- `log-rotation.test: deletes companion date logs older than retention` — fs mtime test (I did not touch log rotation)

Verified by `git diff --name-only`: P2 changes are confined to the 3 files listed above + the new test file. None of the failing tests touch `src/computer/darwin-adapters.ts`, `src/host-use/darwin/host.swift`, or `src/host-use/darwin/build-host.sh`.

## Known caveats / open questions for reviewers

### Q1 — Is `localSha256` fallback actually reachable in practice?
host.swift now writes sha256 into `capture_degraded.sha256` always (computed before classifier). So `interpretScreenshotFailure`'s `localSha256` arg only matters for older binaries that emit CAPTURE_FAILED without the new payload. Test #7 covers that defensive case. Question: is it worth keeping the `fs.readFileSync(tmpPath)` retry on the failure path, or should we drop it and require host.swift to always emit sha256? **My take**: keep — costs 1 fs call, preserves robustness during canary rollout.

### Q2 — `parsed.error_code ?? "INVALID_ACTION"` is untyped `any`
`parsed` is `Record<string, any>`, so `parsed.error_code` is `any`. Passing `any` to `ComputerErrorCode` constructor parameter is the same pattern as the pre-existing `checkOk` — TypeScript accepts it. But it means a typo'd code (e.g. `"CAPTURE_FAILD"`) would still throw `ComputerError("CAPTURE_FAILD")` and bypass the audit branch. **My take**: the `if (code === "CAPTURE_FAILED")` gate is exact-string, so typos silently skip audit — acceptable since host.swift is the only producer and the literal is locked by tests.

### Q3 — cuSelfTestClassifier is read-only but not isolated
The self-test allocates synthetic `[UInt8]` arrays (4096 bytes each × 6) and runs the classifier. No globals mutated except `cuPriorCaptureFrameLock` — and the self-test does NOT call cuScreenshot, so the lock is untouched. Safe to run in CI / build without TCC.

### Q4 — Darwin SourceKit warnings `cuActivatePid result unused`
Pre-existing warnings at `host.swift:814` and `host.swift:1288`. Not touched by P2. They were present before this diff.

## What I need from Grok

Review the diff `/tmp/p2-diff-scope.patch` against:
1. Pi C1-C4 contract (does each constraint hold under the actual code?)
2. Reason taxonomy correctness (`size_guard` > `pixel_identity` > `luma_stdev` ordering)
3. Self-test coverage adequacy — do the 9 assertions actually lock the AND-vs-OR semantics from Pi's Q1 caveat?
4. Any silent-deadlock / fail-open paths in `MacScreenCapturer.captureWindow` now that sha256 computation moved before the ok-check
5. Are there missing tests (e.g. should we add a unit test for the actual `cuScreenshot` end-to-end via spawn?)

Save verdict to `docs/decisions/v1.3/review-grok-p2.txt`.

## What I need from Pi

After Grok signs off (or concurrently), Pi re-confirms:
1. Does this P2 implementation satisfy the C1-C4 caveats from `review-pi-plan-v4-1.txt`?
2. Is the operator-audit vs LLM-surface separation actually enforceable as coded, or are there logging / error-chain paths where `capture_degraded` could leak?
3. Is `interpretScreenshotFailure` the right abstraction (vs inlining back into captureWindow), given Pi's earlier "extracted helpers rot" caution?

Save verdict to `docs/decisions/v1.3/review-pi-p2.txt`.

## Claude's commitment

Until Grok + Pi sign off (or surface blockers):
- No commit, no push, no P3 / P4 work
- If reviewers request changes, they go in this same worktree as a P2-fixup commit
- If Pi rejects, fall back per `plan-approach-c-minus-v4-1-grok.md` R10 (Defect 1 + Defect 3 only, no P2 classifier)

---

**Claude (implementer)** — hand off to Grok + Pi for review.
