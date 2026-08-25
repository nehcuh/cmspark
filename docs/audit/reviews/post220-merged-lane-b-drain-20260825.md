# Lane B (post-merge) — nextRun drain / occupancy adversary

**Reviewer**: independent adversary (Lane B — nextRun drain / occupancy). Did **not** implement PR #220. Did **not** rubber-stamp r2 APPROVE.  
**Date**: 2026-08-25  
**Range**: `c5b4242..1d16b0e` (PR #220 squash merged to main)  
**Live HEAD**: `1d16b0ed8b7a8eb0fc75c529cd88e24089f9c2bb`  
**Frozen patch**: `docs/audit/reviews/post220-merged-diff-20260825-085108.patch`  
**SHA256**: `b5e936cbf1dc66afc3fc7aef5898fb417692ed63325b9a4ed8bb11caf5c86021` — **MATCH** `[executed]`

**Exclusive range** (read/attack only; no production edits left in tree):
- `companion/src/message-router.ts` (171-line delta)
- `companion/tests/message-router-nextrun-drain.test.ts` (744-line new file)
- Read-only contracts: `companion/src/llm/run-queues.ts`, `companion/src/ws/composer-lease.ts` (+ `l2-conductor.ts` for the conductor pre-check)

Evidence tags: `[executed]` ran on this host · `[inspected]` live path at HEAD · `[assumed]` not directly exercised.  
Attack posture: **default REFUTED** until `file:line` + evidence.

Blast: **T2**. No new confirm skip, overlay-as-Trust, or persistence leak found — do **not** escalate to T3.

---

## Capability table (ADR-020)

Implementer claim (challenge it):

```text
Surface:      L0 (steer/nextRun composer + overlay hub; no new L2)
L2-classes:   none
Compose:      none (overlay-eligible pack already on main)
Autonomy:     steer / nextRun queue
Trust:        overlay never Allow/Deny; persistence redaction must not leak
Channel:      composer lease / overlay session token
```

| Check | Score |
|-------|--------|
| Axes fit | **HOLD.** Drain/occupancy is Autonomy (queue) + Channel (composer lease). Not a new runtime. `[inspected]` |
| Pack-first | **N/A.** No new primary Side Panel chrome. |
| Confirm dialects | **HOLD.** No new confirmation family. Overlay drain reuses `gateChatCreateOnLease` + `gateChatCreateOnConductor`. |
| Trust monotonicity | **HOLD.** Overlay success drain does **not** skip L2 conductor: summoner + live host_computer → `L2_CONDUCTOR_ELSEWHERE`, queue kept. `[executed]` private hunt. |
| originWs | **N/A.** No new `securityConfirmations.request` in exclusive files. |
| Overlay-as-confirm | **REFUTED as attack.** Drain is Channel occupancy, not Allow/Deny. Conductor gate still blocks overlay while CU is live (`l2-conductor.ts:19-32`). |
| Missing declaration | **HOLD.** Channel = composer lease is accurate. No new tools/gates/primary UI. |

---

## Machine

```text
[executed] git rev-parse HEAD
→ 1d16b0ed8b7a8eb0fc75c529cd88e24089f9c2bb   MATCH 1d16b0e

[executed] git diff c5b4242..1d16b0e -- ':!docs/audit/reviews' | shasum -a 256
→ b5e936cbf1dc66afc3fc7aef5898fb417692ed63325b9a4ed8bb11caf5c86021   MATCH frozen patch

[executed] cwd companion/; npx tsx --test tests/message-router-nextrun-drain.test.ts
→ 11 pass / 0 fail
   duration_ms 492.037584
   tests 11  suites 0  fail 0  cancelled 0  skipped 0  todo 0
```

Per-test (all **PASS** `[executed]`):

| Test | Result | What it actually pins |
|------|--------|------------------------|
| P1 TOCTOU: create during upload parse → `run_active` | PASS | Entry claim before vision await |
| P1 cleanup: early return frees slot | PASS | `uploadError` releases claim |
| P1 drain gate: lease-rejected drain keeps queue | PASS | Overlay claim + panel session → `OVERLAY_STANDBY` **pushed**, `resp === null`, `peekNextRunCount===1` |
| P1 drain: overlay-held + summoner drains | PASS | **Success** path: `streamCalls===2`, queue 0, no standby |
| P1 drain gate: overlay-rejected upload still `file.uploaded` | PASS | **B-High pin** — see mutation-kill |
| P1 drain parity: upload drains nextRun | PASS | Panel success drain |
| P1 drain parity: regenerate drains nextRun | PASS | Panel success drain |
| P2 abort drain: picks up queued nextRun | PASS | Deferred `setImmediate` |
| P2 abort drain: gate-rejected pickup keeps queue + pushes error | PASS | Abort `sendToExtension` all-truthy |
| P2 D6: steer `client_message_id` | PASS | Echo + queue payload |
| P2 wire: rejection frames carry `thread_id` | PASS | Incl. overlay `chat.create` gate |

Harness note: first invocation of bare `npx tsx` before `companion/node_modules` existed resolved a global tsx and 11-failed on `Cannot find module 'js-yaml'`. After `npm install --ignore-scripts` in `companion/`, the **mandated command** is green. That is an environment bootstrap issue, not a product drain bug.

---

## Mutation-kill (B-High pin is load-bearing)

Private production mutation (restored; tree clean):

- Replaced upload drain at `message-router.ts:1143-1149` with the r1 replace-ack branch:
  `if (drainedAfterUpload) return drainedAfterUpload`
- Re-ran `--test-name-pattern 'overlay-rejected upload drain still returns file.uploaded'`

```text
[executed] 1 fail / 0 pass   duration_ms 421
AssertionError: upload ack must not be replaced by OVERLAY_STANDBY
  + actual - expected
  + 'chat.error'
  - 'file.uploaded'
  at tests/message-router-nextrun-drain.test.ts:432
```

**The in-tree assertion kills the r1 High.** A green suite without this mutation would not prove the fold. Source restored; `git diff companion/src/message-router.ts` empty. `[executed]`

---

## Must-falsify

### 1. B-High — gate-rejected drain must `sendToExtension` and KEEP original ack

**HOLD. Prior r1 High REFUTED on live main.** `[executed]` + mutation-kill.

Call sites at HEAD:

| Caller | Gate-reject | Original RPC | Evidence |
|--------|-------------|--------------|----------|
| **chat.create** `:601-608` | `session.sendToExtension(drained)` → `return null` | `null` (not `OVERLAY_STANDBY`) | PASS lease-rejected create; `resp === null` + pushed standby `:355-358` |
| **file.upload** `:1143-1148` then `:1149` | push gate, fall through | **always** `file.uploaded` on gate path | PASS `:432` + mutation-kill goes red if `return drainedAfterUpload` |
| **chat.regenerate** `:1491-1496` | push gate → `return null` | `null` | `[inspected]` (no overlay-gate regen integration test — nit N2) |
| **chat.abort** `:1238-1242` | `sendToExtension(drained)` (all truthy) | always `chat.aborted` `:1252` | PASS abort gate-rejected `:584-588` |

`OVERLAY_STANDBY` / `L2_CONDUCTOR_ELSEWHERE` are `type: "chat.error"` → `isDrainGateError` true (`:315-319`) → push, not replace. `[inspected]`

Create still `return drained` for **non-gate** truthy successor frames (`:607`). Happy-path successor `chat.create` returns `null`, so create RPC stays `null`. `[inspected]` `[executed]` overlay success + lease-reject.

No remaining path that returns `OVERLAY_STANDBY` as the original create/upload/abort RPC.

### 2. Overlay-surface **success** drain is `[executed]` (not only fail paths)

**HOLD.** `[executed]` `tests/message-router-nextrun-drain.test.ts:371-405`

- `makeSession(sent, "summoner")` sets `session.surface` (`:185-189`).
- Overlay lease claimed **before** first create (`:377-378`).
- Messages carry `__cmspark_surface: "summoner"` for admission; drain uses `session?.surface` inside `drainNextRun` (`:300`).
- After release: `streamCalls === 2`, `peekNextRunCount === 0`, no `OVERLAY_STANDBY` in `sent`.
- Enqueue does not start a stream (`holdStreams` held until after enqueue). The second `makeStream` is the drain’s recursive `chat.create`. Not attributable to a third caller.

Panel success drains (upload `:442-470`, regen `:472-500`) also PASS. `[executed]`

### 3. `drainNextRun` pre-checks lease+conductor BEFORE `takeNextRun`

**HOLD** for the claimed gates. `[inspected]` + `[executed]`

```287:312:companion/src/message-router.ts
async function drainNextRun(...) {
  ...
  const leaseErr = gateChatCreateOnLease(threadId, surface)
  if (leaseErr) return leaseErr
  const conductorErr = gateChatCreateOnConductor(threadId, surface)
  if (conductorErr) return conductorErr
  const queued = takeNextRun(threadId)
  ...
}
```

- Lease reject: in-tree PASS, queue depth 1. `[executed]`
- Conductor reject: **not in the in-tree suite**. Private hunt (summoner session + overlay claim + `getComputerTaskAbortRegistry().set(...)`): create ack stays `null`, `L2_CONDUCTOR_ELSEWHERE` pushed, `peekNextRunCount===1`, `streamCalls===1`. `[executed]` Deleted after.
- No `await` between `takeNextRun` and the recursive `chat.create` sync prefix (lease/conductor/`run_active`/`abortControllers.set`). Same-tick lease flip cannot interleave after dequeue. `[inspected]`

**Hole (nit N1, not a falsification of claim 3):** pre-check set is **only** lease+conductor. `thread_paused` / `thread_trashed` / missing thread / `MULTI_AGENT_LLM_CAP` still run **after** `takeNextRun` via recursive `handleMessage`. See residuals.

### 4. Classifier `isDrainGateError` breadth

```315:319:companion/src/message-router.ts
function isDrainGateError(frame: unknown): boolean {
  if (!frame || typeof frame !== "object") return false
  const t = (frame as { type?: unknown }).type
  return t === "error" || t === "chat.error"
}
```

| Attack | Result |
|--------|--------|
| Too broad — swallows happy-path successors | **REFUTED as ship-blocker.** Happy-path drain successor is `chat.create` → `null` (falsy). `null` is not classified. Overlay success still runs (`streamCalls===2`). `[executed]` |
| Too narrow — occupancy/`run_active` still replaces acks | **REFUTED.** `run_active` is `type: "error"` (`:433`). Classifier true → push + keep original ack. Tightening to `error_code ∈ {OVERLAY_STANDBY, L2_CONDUCTOR_ELSEWHERE}` would **re-open B-High** for occupancy frames. `[inspected]` |

Type-wide is the correct B-High posture: any error-shaped drain frame is pushed, never used as the original RPC. Soft observation: not an allowlist of gate codes (O2).

### 5. Abort-tick drain racing a fresh `chat.create` — must not silent-drop

**HOLD.** `[executed]` private hunts (deleted after) + `[inspected]` no-await slot claim.

`chat.abort` `:1236-1250` schedules `setImmediate(() => drainNextRun(..., myGeneration: null))`. `drainNextRun` `:295` no-ops if `abortControllers.has(threadId)` **before** `takeNextRun`. Recursive `chat.create` claims the slot synchronously (`:432-448`) before its first `await`.

Two orders exercised:

| Order | Outcome | Queue |
|-------|---------|-------|
| Fresh create in the same turn as abort return (before check-phase `setImmediate`) | Fresh occupies slot (`freshResp === null`); abort drain no-ops; fresh’s own drain runs the queued text | `peekNextRunCount→0`; `chat.user` blob contains `queued-before-abort` **and** `fresh-after-abort`; `streamCalls >= 3` |
| `setImmediate` flushed first | Abort drain starts queued run (`streamCalls===2`); queued text present in `sent` | Not dropped. Fresh may be `run_active` (occupancy), which is an error ack, not a silent drop |

In-tree abort tests (`:502-546`, `:549-593`) cover pickup + gate-reject; they do not race a fresh create. The race is not a silent-drop on live main.

### 6. Mutation-kill of keep-`file.uploaded`

**HOLD.** See Machine / Mutation-kill. Test goes red under the r1 replace branch. `[executed]`

---

## New findings from the 171-line squash (none blocking)

No new B-High-class ack-replace. Occupancy TOCTOU on `file.upload` entry claim HOLDS (`:663-676` before parse/vision await). Dead `existingUpload` supersede (`:675-681`) is unreachable: no `await` between `has` and `set`. `[inspected]`

Removed `chat.create` supersede (`existing.abort()` + `drainThreadOnSupersede`) is consistent with occupied → `run_active` (`:432-448`). `[inspected]`

---

## Residuals (non-blocking)

### N1 — Pause/trash after enqueue: take-then-reject drops nextRun

`drainNextRun` does **not** pre-check `thrGate.paused` / `trashed_at`. Recursive `chat.create` does (`:362-376`) **after** `takeNextRun` (`:305`).

Private hunt: in-flight create + `enqueue: true` + `tm.update(..., { paused: true })` + release stream.

```text
[executed] queuedAfter=0
pausedErr={ type:"chat.error", error:"thread_paused", data:{ error_code:"thread_paused" } }
streamCalls=1  resp=null
```

Queue is **empty** while the client still holds `chat.enqueued`. The paused frame **is** pushed (`isDrainGateError` true → create/upload keep original ack). Not silent, not an ack-replace, not a confirm skip. Trigger is an explicit pause during an in-flight run. `thread_trashed` is the same shape `[inspected]` not separately executed.

Recommend: add paused/trashed (and optionally cap) to the pre-check, **or** document that pause discards nextRun. Not a reopen of B-High.

### N2 — Regen overlay-gate integration untested

Regen drain (`:1491-1496`) is symmetric to create (push gate → `return null`) but the suite only executes **panel** regen success (`:472-500`). `[inspected]`

### N3 — Upload non-gate `return drainedAfterUpload`

`:1146-1147` can still replace `file.uploaded` if a future/non-null **non-error** successor frame appears. Today’s follow-up is always `followUpCreateFromQueue` → success `null` → fall through to `file.uploaded`. Latent cousin of B-High; current successor contract closes it. Prefer abort-style “always keep `file.uploaded`; push any drain frame”. Optional.

### N4 — Conductor drain not in the in-tree suite

Lease reject is pinned. Conductor reject was only `[executed]` in a private hunt. Add a summoner+CU-live case next to `:328`. Polish.

### O2 — Classifier is type-wide, not an `error_code` allowlist

Intentional overlap with abort’s push-all-truthy. Tightening would re-open occupancy ack-replace. Do not “fix” without a new pin.

---

## Disposition vs r1 / r2 (re-executed, not quoted as proof)

| Claim | This round |
|-------|------------|
| **B-High** gate drain replaces `file.uploaded` | **REFUTED** — push + `file.uploaded`; mutation-kill red `[executed]` |
| Overlay success drain only fail-path tested | **REFUTED** — summoner success PASS `streamCalls===2` `[executed]` |
| Pre-check after `takeNextRun` for lease/conductor | **REFUTED** for those two gates `[executed]` |
| Classifier swallows success / misses occupancy | **REFUTED as blocker** `[executed]`/`[inspected]` |
| Abort-tick × fresh create silent-drop | **REFUTED** both orders `[executed]` |
| Overlay drain skips L2 conductor / confirm | **REFUTED** `[executed]` conductor hunt |

---

## Eval card (T2)

| Gate | Result |
|------|--------|
| MACHINE | **PASS** 11/11 `[executed]` |
| Outcome | Gate-reject keeps ack + queue; overlay success drains; abort race does not silent-drop |
| Trajectory | Exclusive files only; no production leftover from mutation |
| Component | `drainNextRun` `:287` · `isDrainGateError` `:315` · upload `:1143` · create `:601` · abort `:1238` · regen `:1491` |

VERDICT: APPROVE_WITH_NITS
