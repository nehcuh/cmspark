# Lane B r2 — nextRun drain ack fold (B1 re-verify)

**Reviewer**: independent adversarial (Lane B) — did **not** implement; no source/test edits  
**Date**: 2026-08-25  
**Prior**: `docs/audit/reviews/post219-kimi-nits-lane-b-drain-20260825.md` → **APPROVE_WITH_NITS** (High **B1**: gate-rejected drain replaced `file.uploaded`)  
**Live HEAD**: `c5b4242` + uncommitted WIP (`message-router.ts` modified; `message-router-nextrun-drain.test.ts` untracked)  
**Scope**: re-attack claimed B folds only. Overlay-session CAS still Lane C.

Evidence: `[executed]` · `[inspected]` · `[assumed]`. Attack posture: **default REFUTED**.

---

## Machine

```text
[executed] cd companion; npx tsx --test tests/message-router-nextrun-drain.test.ts
→ 11 pass / 0 fail  (duration_ms ≈ 1039)
```

| New / changed assertion | Result |
|-------------------------|--------|
| lease-rejected create drain → `resp === null` + pushed `OVERLAY_STANDBY` | PASS |
| overlay-held + `session.surface=summoner` → `streamCalls===2`, queue 0 | PASS |
| overlay-rejected upload drain → still `file.uploaded` + pushed standby | PASS |

---

## Claimed folds vs call sites

### B-High — `isDrainGateError`: push gate frames; preserve original RPC ack

`companion/src/message-router.ts:314-319`

```314:319:companion/src/message-router.ts
/** Gate rejection is an error frame, not a successor run. Callers must ack the original RPC. */
function isDrainGateError(frame: unknown): boolean {
  if (!frame || typeof frame !== "object") return false
  const t = (frame as { type?: unknown }).type
  return t === "error" || t === "chat.error"
}
```

| Caller | Gate-reject behavior | Original RPC | Status |
|--------|----------------------|--------------|--------|
| **chat.create** `:601-608` | `sendToExtension(drained)` → `return null` | null (not OVERLAY_STANDBY) | **HOLD** `[inspected]` `[executed]` |
| **file.upload** `:1143-1149` | push gate → fall through | **always** `file.uploaded` on gate path | **HOLD** `[executed]` |
| **chat.regenerate** `:1491-1496` | push gate → `return null` | null | **HOLD** `[inspected]` |
| **chat.abort** `:1239-1242` | `sendToExtension(drained)` (all truthy) | always `chat.aborted` `:1252` | **HOLD** (unchanged, correct) |

**No remaining `if (drained) return drained` that returns `OVERLAY_STANDBY` as the original create/upload/abort RPC.**  
`OVERLAY_STANDBY` / `L2_CONDUCTOR_ELSEWHERE` are `type: "chat.error"` → `isDrainGateError` true → push, not replace. `[inspected]`

Create still `return drained` for **non-gate** truthy successor frames (`:607`). Happy-path successor `chat.create` returns `null`, so create RPC stays `null`. `[inspected]`

Upload still has `else if (drainedAfterUpload) return drainedAfterUpload` (`:1146-1147`) for non-gate truthy frames. Current successor success is `null` → falls through to `file.uploaded`. Latent only — see observation O1.

**Prior B1: REFUTED.**

---

## Must-falsify

### 1. Tests all pass?

**HOLD.** `[executed]` 11/11 pass (was 9; +overlay success + upload-ack gate tests).

### 2. Any remaining RPC replace of OVERLAY_STANDBY?

**REFUTED** for create / upload / abort / regen gate frames (table above).

### 3. Overlay success drain test: summoner session + claim-before-create? `streamCalls===2` from drain?

**HOLD.** `[inspected]` `tests/message-router-nextrun-drain.test.ts:371-405`

- `makeSession(sent, "summoner")` sets `session.surface` (`:185-189`).
- `composerLeases.claim(... holder: "overlay")` **before** first create (`:377-378`).
- Messages also carry `__cmspark_surface: "summoner"` for the admission gate on the initial create (strip path); **drain** uses `session?.surface` inside `drainNextRun` (`:300`).
- After release: `streamCalls === 2`, `peekNextRunCount === 0`, no standby in `sent`.
- Enqueue does not start a stream; only the deferred drain’s recursive `chat.create` explains the second `makeStream` call. Not attributable to a third caller.

### 4. Non-summoner → `"tray"` → panel; panel drain still works?

**REFUTED as regression.** `drainNextRun` still maps `session?.surface === "summoner" ? "summoner" : "tray"` (`:300`); `incomingHolderFromSurface("tray") === "panel"`. Panel parity tests (upload/regen drain without surface) still PASS. `[executed]`

### 5. `isDrainGateError` too broad (swallows a real successor error)?

**REFUTED as ship-blocker; soft observation only.**

- Classifier is **type**-wide (`error` \| `chat.error`), not `error_code ∈ {OVERLAY_STANDBY, L2_CONDUCTOR_ELSEWHERE}`.
- Effect: any such frame is **pushed** via `sendToExtension` and does **not** replace create/`file.uploaded`/regen ack. UI still sees the frame; it is not dropped.
- Abort already pushed **all** truthy drain results the same way.
- Successor early returns (`thread_paused`, `MULTI_AGENT_LLM_CAP`, …) are also `chat.error` / `error` — pushing + preserving original ack is the correct B1 posture.
- Does **not** classify success (`null`) or unrelated success object types as gates.

Not a falsification of the fold. Optional tighten to an allowlist would be polish, not a reopen of B1.

---

## Residual observations (non-blocking)

### O1 — Upload non-gate `return drainedAfterUpload`

`:1146-1147` can still replace `file.uploaded` if a future/non-null non-error successor frame appears. Today’s follow-up `chat.create` returns `null` on success, so B1 scenario is closed. Prefer “always `file.uploaded`; push any drain frame” for symmetry with abort — **optional**.

### O2 — Classifier breadth

Documented above; intentional overlap with abort push semantics.

---

## Disposition vs r1

| r1 finding | r2 |
|------------|-----|
| **B1 High** — gate drain replaces `file.uploaded` | **REFUTED** — push + `file.uploaded` `[executed]` |
| N1 — no overlay+summoner success integration test | **CLOSED** — new test PASS |
| N2 — create RPC replaced by gate error | **REFUTED** — `resp === null` + push `[executed]` |

---

## VERDICT: APPROVE
