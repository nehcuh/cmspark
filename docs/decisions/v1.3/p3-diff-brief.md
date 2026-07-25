# P3 Diff Brief for Grok (plan owner) + Pi (confirmer)

> **Phase**: P3 — D4.2 (M8 drift threshold named + executor wiring) and
> D4.3 (locate-chain `shot.rect` re-validation).
> **Predecessor**: P2 APPROVED (commit `ecb3341`); Pi cleared P3 start.
> **Spec source**: `plan-approach-c-minus-v4-1-grok.md` §4.2 + §4.3.
> **Grok verdict**: CONDITIONAL APPROVE — two blockers addressed in
> this revision (§"Grok blocker resolution" below). Awaiting Pi sign-off.
> **Decision sought from Pi**: APPROVE the revised plan or list
> blockers before I touch code.

## Why P3 is small

P2 closed R1 (capture variance) for blank / 0-byte / draw-fail / occluded
frames; caret-blink correctly NOT flagged (AND truth table). R12 + R13
recorded as residual classifier FP/FN threats. P3 closes **two more
non-blocking Q4 diffs** that Grok v4.1 §4 deferred:

- **D4.2**: M8 hwnd-drift check has been a documented gap since v4 —
  per-action `infoForHwnd(hwnd)` already runs but does not compare
  `info.rect` vs `shot.rect`; a window resize between capture and
  bounds check lets a stale `shot.client` bless an OOB click. Name the
  threshold (8 px, matches `WITNESS_TOLERANCE_PX`), wire the check.
- **D4.3**: `locate-chain.ts:259-265` assumes the UIA→image conversion
  runs against a fresh `shot.rect`; if the window moved mid-chain, the
  1:1 offset math silently lands in the wrong place. Bind `rect0` at
  chain entry, re-validate before each layer's hit return.

D4.1 (scaleX AND scaleY as separate fields) is **already shipped** via
commits `10127b2` (host.swift) + `d64824f` (types.ts + coords.ts). P3
does not touch it. The `backingScale: scaleX` legacy field in host.swift
stays (no TS consumer reads it; keep for old bridge period binaries).

## D4.2 — DRIFT_THRESHOLD_PX + executor M8 wiring

### 4.2.1 Constant

Add to `src/computer/locate-chain.ts` (alongside `WITNESS_TOLERANCE_PX`):

```typescript
/**
 * D4.2 (Grok v4.1 §4.2 / Pi v4.1 RESOLVED): per-action hwnd drift
 * threshold. If live window bounds (infoForHwnd) vs the cached
 * `shot.rect` differ by more than this many pixels on any of
 * {x, y, width, height}, the capture is stale — re-capture before the
 * bounds check instead of blessing an OOB click.
 *
 * Matches WITNESS_TOLERANCE_PX (8) on purpose: sub-8 px drift is below
 * the locate witness tolerance anyway, so the classifier's noise floor
 * already absorbs it; above 8 px we want a fresh frame.
 */
export const DRIFT_THRESHOLD_PX = 8
```

Single source of truth. The constant is exported so executor.ts can
import it without re-declaring.

### 4.2.2 Helper (pure, unit-testable)

In `src/computer/coords.ts` (already exists for v4 D3 conversions):

```typescript
/**
 * D4.2: max-axis drift between two rects. Returns the largest absolute
 * delta across {x, y, width, height}. Used by executor's M8 check and
 * by locate-chain's rect0 re-validation.
 */
export function rectDriftPx(a: RectPx, b: RectPx): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height),
  )
}
```

### 4.2.3 Executor wiring (M8) — POST-locate (Grok blocker 1 fix)

`src/computer/executor.ts`. The earlier draft placed the check next to
the ownership `infoForHwnd(hwnd)` at line ~738, but `shot` is not
created until line ~767 and the locate chain updates `shot` at line
~815. Bounds run at line ~868. The pre-locate check is therefore
structurally useless — drift is necessarily ~0 because the capture was
just taken. **Required site**: AFTER `shot = chain.shot` (line ~815),
BEFORE the bounds check (line ~868). Use a FRESH `infoForHwnd` call so
the live rect is current as of post-locate (the ownership call at 738
is too stale to reuse for drift comparison).

```typescript
// (existing) shot = chain.shot;  line ~815
// (existing) pointClient = chain.pointClient;  line ~817
// (existing) ... crossverified / uncrossverified / etc.

// D4.2 / Grok v4 §4.4 M8 (blocker 1 fix): POST-locate drift check.
// A resize / reposition that happened DURING the locate chain (or in
// the gap between locate-return and bounds) would let a stale
// `shot.client` bless an OOB click. Fresh infoForHwnd — the early
// ownership call at line 738 is too stale by construction. Single
// re-capture per action, no inner loop (livelock on animated windows).
const infoLive = await deps.windows.infoForHwnd(hwnd)
if (rectDriftPx(infoLive.rect, shot.rect) > DRIFT_THRESHOLD_PX) {
  log("computer.coords.drift_recapture", {
    taskId, seq, hwnd,
    locateRect: shot.rect,
    liveRect: infoLive.rect,
    driftPx: rectDriftPx(infoLive.rect, shot.rect),
  })
  shot = await trackCapture(hwnd)   // existing dep; updates shot.rect + client + scale
  shotAt = now()
  // NOTE: pointClient came from the locate chain against the PRE-recapture
  // frame. If the window drifted, the located target also moved. We do
  // NOT silently re-map pointClient — bounds check will fail OOB and the
  // LLM gets a diagnostic with the new client dims, prompting re-locate
  // on retry. This matches v4 §4.4 M8 "post-resize locate points may be
  // residual-stale" (Grok non-blocker ack).
}
```

`trackCapture` and `deps.windows.infoForHwnd` are already in scope on
the executor loop; no new plumbing. The re-capture path emits an
operator audit (`computer.coords.drift_recapture`) so a flapping window
(drift on every action) is visible.

**Failure mode**: if `trackCapture` throws (window dead, SCK error),
the existing try/catch surfaces the error as `CAPTURE_FAILED` — same
semantics as a fresh-capture failure. No new error code.

**Loop bound**: single re-capture per action, no inner loop. If the
window is still drifting after one re-capture, the NEXT action's check
catches it again. We do NOT loop until drift < threshold (livelock
risk); a single fresh frame + per-action check is the spec.

**Scroll / drag / explicit-coord paths**: locate chain does not run for
these (executor branches at line ~827). They still benefit from the
drift check because the check is post-locate-stub: `shot` is taken at
line 767, pointClient assigned from `action.x/y` at line ~828/837, and
the drift check fires before bounds. Single capture for these paths
already; drift re-capture is a strict improvement.

## D4.3 — locate-chain `shot.rect` re-validation

### 4.3.1 Bind `rect0` at chain entry + `driftRestarted` arg

`src/computer/locate-chain.ts` `locateTargetWithChain`. Grok blocker 2:
a closure-scoped `let restarted = false` would reset on every recursive
call, allowing unbounded recursion if every fresh frame still drifts
(animated window). The flag MUST ride on `args` so the recursive call
inherits it.

Add `driftRestarted?: boolean` to the args type:

```typescript
export async function locateTargetWithChain(args: {
  target: string
  hwnd: number
  shot: CaptureMeta
  deps: LocateChainDeps
  trackCapture: (hwnd: number) => Promise<CaptureMeta>
  releaseRaw: (path?: string) => Promise<void>
  staleOnNotFound?: boolean
  /** D4.3 (Grok blocker 2 fix): set to true by the in-function restart
   *  path so the recursive call knows it has already used its one
   *  restart. Default false. */
  driftRestarted?: boolean
}): Promise<ChainLocateResult> {
  const { target, hwnd, deps, trackCapture, releaseRaw } = args
  const restarted = args.driftRestarted === true   // read-once from args
  // ...
  // D4.3 (Grok v4.1 §4.3): snapshot the chain-entry rect. Before each
  // layer's hit return, re-validate against the CURRENT shot.rect — if
  // the window moved mid-chain (A1 freshness re-capture, or restarted
  // entry from a prior drift), abort the hit and restart ONCE. Returning
  // a UIA→image mapping computed against a stale rect is the (722, 872)
  // OOB class in slow motion.
  const rect0: RectPx = { ...args.shot.rect }
```

### 4.3.2 Per-layer guard (in-place, not closure-recursive)

Helper near the top of the function:

```typescript
const rect0DriftExceeded = (): boolean =>
  rectDriftPx(shot.rect, rect0) > DRIFT_THRESHOLD_PX

const restartChainOnce = async (): Promise<CaptureMeta> => {
  if (restarted) {
    throw new ComputerError(
      "STALE_SCREENSHOT",
      `computer: target "${target}" — window drift exceeded ${DRIFT_THRESHOLD_PX}px twice in one locate call; refusing to inject at unstable coordinates`,
    )
  }
  const fresh = await trackCapture(hwnd)
  await releaseRaw(shot.path)
  return fresh
}
```

Before **each** layer's `return { hit, ... }` (L0 UIA success at ~line
334, L0 UIA re-probe success at ~line 376, L1 OCR success at ~line 422,
L1 OCR re-probe success at ~line 446, L2 TinyClick success at ~line
482), insert:

```typescript
if (rect0DriftExceeded()) {
  log("computer.locate.drift_restart", {
    layer: "<layer-name>",
    rect0,
    currentRect: shot.rect,
    driftPx: rectDriftPx(shot.rect, rect0),
  })
  const fresh = await restartChainOnce()
  // Recursive call passes driftRestarted:true — the inner call's
  // `restarted` flag is true from args, so a second drift throws.
  return locateTargetWithChain({
    ...args,
    shot: fresh,
    staleOnNotFound: true,
    driftRestarted: true,
  })
}
```

### 4.3.3 Restart loop bound — proven via args

The inner `locateTargetWithChain` call inherits `driftRestarted: true`
via args, so its local `restarted` is `true` from the first line. A
second drift on the inner call throws `STALE_SCREENSHOT` from
`restartChainOnce`. **Max recursion depth = 1**, provable by
inspection of the args-flow.

Test (added to locate-chain suite): construct a mock where every
`trackCapture` returns a rect 100px shifted. Assert the second restart
throws STALE_SCREENSHOT (depth=1 proven).

**STALE_SCREENSHOT choice**: matches the existing stale-screen semantics
in executor — the LLM sees "target moved; re-shot and retry", which is
the correct cooperative behavior. Not a new CAPTURE_FAILED (the capture
succeeded; the window moved underneath us).

## Tests

### New unit tests (`tests/computer-coords.test.ts` additions)

- `rectDriftPx`: identical rects → 0; shifted x → |Δx|; resize → |Δw|;
  max-axis semantics (mix shift + resize → larger of the two).
- `rectDriftPx`: negative deltas handled (abs).

### Locate-chain tests (Grok's required coverage — points 1-4 below)

Grok flagged four missing test classes; the locate-chain suite must
cover all four. File: closest existing locate test file (TBD on
implementation; if none, fold into computer-coords.test.ts to avoid a
new file).

1. **L0 A1 mixed-rect class** (Grok point 1): construct an L0 UIA hit
   where the chain's internal A1 freshness re-capture (line 314)
   returns a frame whose `rect` drifted > 8px from `rect0`. Assert:
   - The L0 success return does NOT use mixed `img.x` (computed on
     pre-fresh rect0) with `pointClient = img.x - shot.client.x`
     (computed on post-fresh shot.client). Either restart once on the
     fresh frame, or throw STALE.
   - Currently this is the silent OOB class — the test must FAIL on
     the un-patched code and PASS once D4.3 lands.

2. **Depth=1 proof** (Grok point 2): mock `trackCapture` so every call
   returns a rect 100px shifted. Assert second drift → STALE_SCREENSHOT
   (not infinite recursion / stack overflow). Proves the args-bound
   restart invariant.

3. **Executor M8 late site** (Grok point 3): drive executor through
   the locate chain, then return `info.rect` drifting 20px from
   `shot.rect` on the post-locate `infoForHwnd`. Assert
   `trackCapture` is called exactly once between locate and bounds.

4. **releaseRaw on restart** (Grok point 4): when restartChainOnce
   fires, the superseded `shot.path` must be released via `releaseRaw`
   — no file leak. Assert releaseRaw called with the prior path before
   the recursive call.

Plus the cases from the earlier draft:

5. L0 UIA hit, drift > 8px before return → restart once → fresh frame →
   L0 hit succeeds on retry.
6. L1 OCR hit, drift exceeded → restart.
7. L2 TinyClick hit, drift exceeded → restart.
8. Drift exactly 8px → NOT triggered (boundary = pass).
9. Drift 9px → triggered.

### Executor test additions (`tests/computer-executor.test.ts`)

- Per-action post-locate `infoForHwnd` returns rect drifting 20px from
  `shot.rect` → executor calls `trackCapture` once before bounds check
  (Grok point 3).
- Drift 5px → no re-capture (boundary below 8).
- `trackCapture` throws on drift recapture → CAPTURE_FAILED propagates
  (existing catch path).
- Scroll / drag / explicit-coord action with drift > 8 → still
  triggers re-capture (the check is post-locate-stub, not gated on
  locate chain having run).
- After re-capture, pointClient from the PRE-recapture locate is NOT
  silently re-mapped; bounds check fails OOB with diagnostic payload
  (Grok non-blockler ack).

## Verification plan

```
npx tsc --noEmit                           # clean
npx tsx --test tests/computer-coords.test.ts
npx tsx --test tests/computer-executor.test.ts
# locate-chain test file (TBD based on existing files)
swiftc -O -typecheck src/host-use/darwin/host.swift ...   # no Swift changes; sanity only
npm test                                   # 1809+ tests, same 3 pre-existing failures
```

## Out of scope (NOT touched by P3)

- Frozen-contentful detector (Pi P2 condition 1) — separate temporal
  mechanism, deferred to P4+.
- `staleIdCaret` dead-var cleanup (Pi P2 condition 2) — cosmetic.
- CUBox lock discipline for daemon mode (Pi P2 condition 3) — reopens
  only when daemon mode ships.
- Mixed-DPI multi-monitor straddle (R-follow-up) — out of P3 scope.

## Files touched by P3

| File | Status | P3 LOC (est) |
|---|---|---|
| `companion/src/computer/locate-chain.ts` | modified | +45 (DRIFT_THRESHOLD_PX export, rect0 bind, driftRestarted arg, restartChainOnce with releaseRaw, per-layer guards) |
| `companion/src/computer/coords.ts` | modified | +12 (rectDriftPx) |
| `companion/src/computer/executor.ts` | modified | +22 (post-locate M8 drift check + audit log + scroll/drag/explicit-coord path coverage) |
| `companion/tests/computer-coords.test.ts` | modified | +20 (rectDriftPx cases) |
| `companion/tests/computer-executor.test.ts` | modified | +50 (M8 post-locate drift recapture + scroll/drag path + OOB-after-recapture case) |
| locate-chain test (TBD) | modified | +80 (Grok points 1-4 + cases 5-9 above) |

Total: ~230 LOC. Single thematic commit per Grok (ruling 7):
`fix(computer): P3 hwnd drift M8 + locate rect0 (D4.2/D4.3)`.

## Grok blocker resolution (CONDITIONAL APPROVE → ready for Pi)

Grok's review (`review-grok-p3.txt`) returned CONDITIONAL APPROVE with
two blockers; both are addressed by this revision:

1. **M8 site wrong** (brief placed check after `infoForHwnd` at ~738;
   `shot` not yet created until ~767, bounds run at ~868). **Fixed in
   §4.2.3**: check moved to POST-locate (after `shot = chain.shot` at
   ~815), with a FRESH `infoForHwnd` call. Late-site test added
   (Grok point 3).

2. **`restarted` dies on recursion** (closure-scoped `let restarted =
   false` resets on every recursive call → infinite loop on animated
   window). **Fixed in §4.3.1 + §4.3.3**: flag now rides on
   `args.driftRestarted`; inner call inherits `true` and throws on
   second drift. Depth=1 proven via args inspection + a dedicated test
   (Grok point 2).

Non-blockler acks:
- `staleOnNotFound: true` on restart (not-found → STALE): kept.
- M8 re-capture without re-locate for explicit coords: matches v4 §4.4
  M8 text; post-resize locate points may be residual-stale (noted in
  §4.2.3 comment).
- Constant lives in locate-chain.ts (alongside WITNESS_TOLERANCE_PX):
  kept.

Grok's other answers (2 single re-capture, 4 TinyClick re-run, 5
STALE_SCREENSHOT, 7 single commit) are reflected verbatim in the brief.

## Pi implementation reminders (non-blocking, fold into code)

Pi's final review (`review-pi-p3.txt`) returned APPROVE with three
non-blocking reminders that must be honored during execution:

1. **L0 drift-restart witness freshness**: when the L0 layer's drift
   guard fires and restart is called, the restarted return MUST carry
   a fresh `witness` field from the inner recursive call — NOT the
   outer scope's `witnessVerdict`. The recursive call's return value
   already includes its own witness; just propagate it.

2. **L1 OCR guard placement**: on the L1 OCR paths (success at line
   ~422, re-probe success at ~446), the drift guard must be inserted
   AFTER `shot = fresh` (the A1 re-capture line 417 / line 444). If
   placed before, the guard would compare `rect0` against the
   pre-re-capture `shot.rect` and trip spuriously on every A1 path.

3. **L2 TinyClick invariant test**: the L2 TinyClick path has no A1
   re-capture — `shot` is the original chain-entry frame throughout.
   The drift guard trivially never fires there (rect0 === shot.rect).
   Add ONE test pinning that invariant so a future regression that
   introduces a re-capture on L2 surfaces as a test failure rather
   than silent behavior change.

These are reminders, not blockers. Code may proceed.

## What I need from Grok (plan owner)

Grok has ruled (CONDITIONAL APPROVE → blockers addressed). No further
Grok round needed unless Pi surfaces a new design issue.

## What I need from Pi (confirmer)

1. **Plan APPROVE / CONDITIONAL / REJECT**. If CONDITIONAL, list
   blockers; if REJECT, name the path to take.
2. **Verify Grok's two blockers are actually resolved** as coded in
   this revised brief (re-derive from §4.2.3 + §4.3.1/§4.3.3, not just
   the §"Grok blocker resolution" summary).
3. **Confirm scope**: P3 = D4.2 + D4.3 only; no D4.1 backfill, no
   frozen-contentful detector, no daemon-mode CUBox fix.
4. **Commit split**: 1 thematic per Grok (ruling 7).

Save verdict to `docs/decisions/v1.3/review-pi-p3.txt`. If APPROVE,
P3 may start. Until then: no code, no commit.

## Claude's commitment

- No code changes until both Grok (plan) and Pi (confirm) sign off.
- If Grok or Pi rules for a different loop bound / error code / commit
  split, I update the brief in place and re-request sign-off — the diff
  is small enough that a second round is cheap.
- If new blockers surface during implementation, they go in this
  worktree as a fixup commit, not a separate branch.

---

**Claude (implementer)** — hand off to Grok for plan refinement, then
Pi for confirmation, then code.
