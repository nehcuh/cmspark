# Pi Re-Confirm Request: Integrated P2–P4 Diff (v4.1)

> **Source**: Claude (coding), per autonomous workflow
> **Reviewer**: Pi (claude CLI subagent)
> **Date**: 2026-07-24
> **Predecessor**: `plan-approach-c-minus-v4-1-grok.md` (Grok v4.1 patch)
> **Decision sought**: PROCEED to P5 (server.ts initial-L2 gate) or BLOCK?

## 1. Why this re-confirm

Your v4.1 review (in-conversation, 2026-07-24) cleared P2/P3/P4 individually but blocked P5 pending an **integrated diff review**. This brief is that review.

The user directive (2026-07-24): "后续的开发计划和流程不要你参与了，计划全部由 grok 来制定，pi agent 来确认，你只做开发" — so I am NOT proceeding to P5 without your re-confirm.

## 2. User's 3 reported defects and the fix mapping

| # | Defect | Fix layer | File(s) |
|---|--------|-----------|---------|
| 1 | Screenshot path activates target app (Hermes background contract broken) | P1 canary gate | `host.swift:797` |
| 2 | Per-action L2 confirmation cadence (Chrome prompt fatigue) | P4 reL2 gate + session-trust v4.1 | `executor.ts`, `session-trust.ts` |
| 3 | Coordinate space mismatch — `(722, 872)` OOB on `880x640` client | P2 imageWidth/Height/scale + P3 locate-chain scale mult + P4 coords autoscale + OOB diagnostics | `host.swift`, `darwin-adapters.ts`, `locate-chain.ts`, `coords.ts`, `executor.ts` |

## 3. Integrated diff — files and scope

```
companion/src/computer/darwin-adapters.ts   |  84 ++++++--  (P2 plumbing)
companion/src/computer/executor.ts          |  78 +++++++-  (P4 OOB diag + reL2 gate + credential latch)
companion/src/computer/locate-chain.ts      |  38 ++--      (P3 UIA→image scale fix)
companion/src/computer/session-trust.ts     | 184 ++++++++++++++--- (P4 v4.1 hardening)
companion/src/computer/types.ts             |  24 +++       (CaptureMeta imageW/H/scale)
companion/src/host-use/darwin/adapter.ts    |  10 +-        (S-P0-2 integrity spawn)
companion/src/host-use/darwin/build-host.sh |  26 +++       (auto-SHA rewrite)
companion/src/host-use/darwin/host.swift    | 293 +++++++++++++++++++++++++--- (P1+P2+S-P0-2)
companion/tests/computer-executor.test.ts   |  42 ++-       (P4 PROMPT_ALWAYS + trust-suppresses)
companion/src/computer/coords.ts            | 154 +++       (NEW: P4 autoscale helpers)
companion/src/host-use/darwin/host-integrity.ts | 153 +++   (NEW: S-P0-2 spawn gate)
companion/tests/computer-coords.test.ts     | 107 +++       (NEW: 12 tests)
companion/tests/computer-darwin-inject-contract.test.ts | 112 +++ (NEW)
companion/tests/host-use-darwin-integrity.test.ts | 146 +++ (NEW)
companion/tests/session-trust-v4.test.ts    | 172 +++       (NEW: 18 tests)
```

**Total**: 9 modified, 6 new, ~680 insertions + ~844 new-file lines.

## 4. P1 — Screenshot no-activate (Pi-cleared earlier)

`host.swift:797` cuActivatePid gated behind `CMSPARK_SCREENSHOT_FORCE_FG=1` canary env var. Production path falls through to no-activate (Hermes background capture).

## 5. P2 — Variance classifier + imageW/H/scale reporting

### host.swift changes

- `cuScreenshot` return JSON now includes `imageWidth`, `imageHeight`, `scaleX`, `scaleY`, `backingScale` (replaces the `dpi:72` lie).
- Variance classifier at cuScreenshot return: `cuDownsampleToBitmap(64x64 avg-pool)` → `cuLumaStdev` + `cuIdentity` against prior frame.
- Logic: `sizeGuard || (prior ? (stdev<1.0 && identity>=0.99) : stdev<1.0)` → `CAPTURE_FAILED`.
  - Your caveat honored: **AND-with-identity when prior exists** (caret-blink OR-too-permissive case).
- Per-windowId `CUBox<T>` lock-protected storage for `cuPriorCaptureFrameLock`.
- SHA256: `d263cffcbd4fb585dfc378e366777761754f3ded3eeb6dffaa664a9eb7e99a56`.

### CaptureMeta (types.ts)

```typescript
imageWidth?: number   // optional — Windows adapter doesn't yet report
imageHeight?: number
scaleX?: number
scaleY?: number
```

Optional with fallback to rect dims (no break to Windows adapter).

## 6. P3 — Locate-chain UIA→image scale fix (M5 line 259/356)

```typescript
const sxL = shot.scaleX ?? 1
const syL = shot.scaleY ?? 1
const img = {
  x: (uiaHit.x - shot.rect.x) * sxL,
  y: (uiaHit.y - shot.rect.y) * syL,
}
```

Without this, on Retina the UIA hit (screen-px) → image-px conversion was off by 2x → locate-chain returned image-pixel coords the LLM couldn't use.

## 7. P4 — Coords autoscale + executor reL2 gate + credential latch + session-trust v4.1

### 7.1 coords.ts (NEW, 154 lines)

Pure helpers:
- `imageToClient({image, imageW, imageH, clientW, clientH})`
- `clientToScreen({client, rect})`
- `screenToClient({screen, rect})`
- `maybeAutoscaleImageToClient({raw, imageW, imageH, clientW, clientH})`
  - Returns `{scaled, x, y, reason:"retina-scale"}` ONLY when: raw OOB ∧ scaled-in-bounds ∧ swapped-NOT-in-bounds.
  - **Your R5 caveat honored**: when both orientations land in client bounds (ambiguous), refuses autoscale. Real fix for `(722, 872)` case is OOB diagnostics, NOT autoscale.

### 7.2 executor.ts

- **Bounds check (line 857, was 862)**: tries `maybeAutoscaleImageToClient`; on failure throws OOB with diagnostic payload:
  ```
  [scale=2x2 image=1760x1280 client=880x640; if model used image-pixel coords, divide by scale]
  ```
- **Post-approval refresh OOB (line 1108)**: same diagnostic (no autoscale — point already validated once).
- **reL2 (line 620)**: changed from blanket `isTrusted` to `isTrusted && !reL2ShouldPrompt(dangerous)`. Uses the tag array, not the narrative reason (which has interpolated text).
- **After scanDanger (line 934)**: credential latch call:
  ```typescript
  if (deps.sessionId && params.app) {
    const trust = deps.sessionTrust ?? getComputerSessionTrust()
    const seen = scanOcr ? scan.credentialRects.length > 0 : null
    if (seen !== false) {
      trust.markCredentialSurfaceSeen(deps.sessionId, params.app, seen)
    }
  }
  ```
  - `seen === null` (OCR fail) → latches TRUE defensively (your caveat).

### 7.3 session-trust.ts (REWRITTEN, 184 → 221 lines)

- `IDLE_EXPIRY_MS = 30 * 60 * 1000` (mandatory per your v4.1 D3.4).
- `PROMPT_ALWAYS_TAGS = { computer.danger_detected, computer.experimental_suggestion, computer.foreground_yielded }`.
- `KNOWN_TAGS` = above + `computer.task_induced_dialog` + `computer.budget_exhausted` + `computer.uncrossverified_exceeded`.
- `reL2ShouldPrompt(tags: string[])`: fail-closed on empty/unknown, prompt if any PROMPT_ALWAYS.
- `GrantRecord`: appToken, grantedAt, lastTouchedAt, credentialSurfaceSeen.
- `isTrusted`: checks expiry (30 min) ∧ ¬credential latch.
- `markCredentialSurfaceSeen(sessionId, appToken, seen)`: `seen === null ? TRUE : ...` (your caveat).
- `clearSession`, `clearApp` retained (W7 parity).

## 8. Test evidence

### Three new test files (38 tests total)

- `computer-coords.test.ts` (12 tests): including "user-reported (722,872) class is AMBIGUOUS — refuses autoscale".
- `session-trust-v4.test.ts` (18 tests): reL2ShouldPrompt exhaustiveness + latch + multi-session isolation.
- `host-use-darwin-integrity.test.ts` (14 tests): S-P0-2 TOCTOU gate.
- `computer-darwin-inject-contract.test.ts` (8 tests): inject-contract regression.

### Updated test (computer-executor.test.ts)

- Rewrote `executor UX-spike: session trust suppresses re-L2 after the initial task L2` to use `budget_exhausted` (silent-eligible) instead of `foreground_yielded` (now correctly PROMPT_ALWAYS).
- Added `executor v4.1: PROMPT_ALWAYS re-L2 (foreground_yielded) still surfaces despite trust` — integration-level guard for reL2ShouldPrompt().
- Pre-existing `session trust does NOT help a different app — re-L2 still asks` unchanged (still passes).

### Full suite results

- **1780 tests total**
- **1759 pass**
- **3 fail (all pre-existing, unrelated)**:
  - `comparison is case-insensitive (NTFS)` — NTFS-specific, fails on macOS FS
  - `apps.add lolbin → lolbin_denied error code` — pre-existing path-validation order
  - `deletes companion date logs older than retention` — env-dependent

## 9. Your previously-stated caveats — conformance check

| Caveat | Where | Status |
|--------|-------|--------|
| Luma AND-with-identity when prior exists (not OR) | host.swift classifier | ✓ honored — `(prior ? (stdev<1.0 && identity>=0.99) : stdev<1.0)` |
| reL2ShouldPrompt must have exhaustiveness test | session-trust-v4.test.ts:52-71 | ✓ — emits every executor.ts call-site tag, fail-closed if unregistered |
| credentialSurfaceSeen null → TRUE defensively | session-trust.ts:176 + executor.ts:934 | ✓ — `seen === null ? true : ...` and `seen !== false` gate |

## 10. What P5 will do (BLOCKED on your sign-off here)

Per Grok v4 §11 + your conditional approval:

- **server.ts:465-470** — initial-L2 skip when:
  - `sessionTrust.isTrusted(sessionId, app)` ∧
  - `¬credentialLatch` ∧
  - `corpus ⊆ priorCorpus` ∧
  - no T3-only flags
- **server.ts:823-940** — corpus/trust recording after initial-L2 approval.

## 11. Decision requested

**PROCEED to P5** / **BLOCK with specifics** / **CONDITIONAL with new caveats**.

If PROCEED, I code P5 against the integrated diff above. If BLOCK, I stop and surface to user per autonomous workflow (only manual lab remaining → notify).

---

*Generated per autonomous workflow: Claude codes, Grok plans, Pi confirms.*
