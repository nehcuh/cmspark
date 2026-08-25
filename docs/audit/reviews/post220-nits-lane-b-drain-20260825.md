# Lane B (nits fold) — nextRun drain / occupancy adversary

**Reviewer**: independent adversary (Lane B — nextRun drain / occupancy). Did **not** implement the nits fold. Did **not** rubber-stamp the implementer session.  
**Date**: 2026-08-25  
**Range**: `1d16b0e..9deff00` (`fix/post220-residual-nits`)  
**Live HEAD**: `9deff00da9ee3e1d9d3014b5da1d509ce91116b6` — **MATCH** `9deff00` `[executed]`  
**Frozen patch**: `docs/audit/reviews/post220-nits-diff-20260825-092457.patch`  
**SHA256**: `2625238075ef8720b4dc8ca73124742b068b54c8b7d721b1dfd2d4c793274b51` — **MATCH** `[executed]`  
**Shared prompt**: `docs/audit/reviews/_prompts/post220-nits-adversary-20260825.md`  
**Prior (context only, not reused as proof)**: `docs/audit/reviews/post220-merged-lane-b-drain-20260825.md` (S-B1/S-B2/S-B3 residuals)

**Exclusive range** (read/attack only; no production leftover):
- `companion/src/message-router.ts`
- `companion/tests/message-router-nextrun-drain.test.ts`
- Read-only: `companion/src/llm/run-queues.ts` (`NextRunItem` / `takeNextRun` / `enqueueNextRun` shape)

Evidence tags: `[executed]` ran on this host · `[inspected]` live path at HEAD · `[assumed]` not directly exercised.  
Attack posture: **default REFUTED** until `file:line` + evidence. Mutation copies in `/tmp` only; source SHA restored to HEAD.

Blast: **T2**. Drain/pause is Autonomy + Channel occupancy. Overlay is **not** Allow/Deny. No confirm skip. Do **not** escalate to T3.

---

## Capability table (ADR-020)

Implementer claim (challenge it):

```text
Surface:      L0
L2-classes:   none
Compose:      none
Autonomy:     steer / nextRun queue plumbing
Trust:        persistence redaction tighter (passwd, non-string secret keys)
Channel:      overlay bind/reclaim live-gate
```

| Check | Score |
|-------|--------|
| Axes fit | **HOLD.** This lane is Autonomy (nextRun drain / pause-trash pre-check) + Channel (composer lease + overlay conductor occupancy). Not a new runtime. Trust redaction is Lane D; overlay bind/reclaim live-gate is Lane C. `[inspected]` |
| Pack-first | **N/A.** No new primary Side Panel chrome. |
| Confirm dialects | **HOLD.** No new confirmation family. Drain reuses `gateChatCreateOnLease` + `gateChatCreateOnConductor`. |
| Trust monotonicity | **HOLD.** Overlay success drain does **not** skip L2 conductor: summoner + live `host_computer` → `L2_CONDUCTOR_ELSEWHERE`, queue kept. `[executed]` in-tree S-B2 conductor test. |
| originWs | **N/A.** No new `securityConfirmations.request` in exclusive files. |
| Overlay-as-confirm | **REFUTED as attack.** Drain is Channel occupancy, not Allow/Deny. Conductor still blocks overlay while CU is live (`companion/src/ws/l2-conductor.ts:19-31`). |
| Missing declaration | **HOLD as nit-level mismatch, not blocking.** Claimed Channel = “overlay bind/reclaim live-gate” is Lane C’s fold. Lane B’s Channel surface is composer-lease / conductor occupancy on drain. Axes still fit; do not treat as missing declaration. |

---

## Machine

```text
[executed] git rev-parse HEAD
→ 9deff00da9ee3e1d9d3014b5da1d509ce91116b6   MATCH 9deff00

[executed] openssl dgst -sha256 docs/audit/reviews/post220-nits-diff-20260825-092457.patch
→ 2625238075ef8720b4dc8ca73124742b068b54c8b7d721b1dfd2d4c793274b51   MATCH frozen patch

[executed] cwd companion/; npx tsx --test tests/message-router-nextrun-drain.test.ts
→ 15 pass / 0 fail
   duration_ms 604.003
   tests 15  suites 0  fail 0  cancelled 0  skipped 0  todo 0
```

First bare `npx tsx` in this worktree 15-failed on `Cannot find module 'js-yaml'` (no `companion/node_modules`). After symlink to the main-repo `companion/node_modules`, the **mandated command** is green. Environment bootstrap, not a product drain bug. Same class as post-merge Lane B.

Per-test (all **PASS** `[executed]`, post-mutation restore):

| Test | Result | What it actually pins |
|------|--------|------------------------|
| P1 TOCTOU: create during upload parse → `run_active` | PASS | Entry claim before vision await (pre-existing) |
| P1 cleanup: early return frees slot | PASS | `uploadError` releases claim |
| P1 drain gate: lease-rejected drain keeps queue | PASS | Overlay claim + panel session → `OVERLAY_STANDBY` pushed, queue 1 |
| P1 drain: overlay-held + summoner drains | PASS | Success path `streamCalls===2` |
| P1 drain gate: overlay-rejected upload still `file.uploaded` | PASS | **S-B3 RPC pin** — see mutation-kill |
| **P1 drain gate: paused thread keeps nextRun (S-B1)** | PASS | **S-B1 pin** — `thread_paused` pushed, `peekNextRunCount===1`, `streamCalls===1` |
| **P1 drain gate: overlay-rejected regenerate keeps queue (S-B2)** | PASS | Regen RPC `null`, `OVERLAY_STANDBY` pushed, queue 1 |
| **P1 drain gate: conductor-rejected overlay drain keeps queue (S-B2)** | PASS | Summoner + CU-live → `L2_CONDUCTOR_ELSEWHERE` pushed, queue 1 |
| **enqueue nextRun preserves clientMessageId (S-A1)** | PASS | Occupied enqueue `clientMessageId` → drained `chat.user.client_message_id` |
| P1 drain parity: upload drains nextRun | PASS | Panel success drain; RPC still `file.uploaded` |
| P1 drain parity: regenerate drains nextRun | PASS | Panel success drain |
| P2 abort drain: picks up queued nextRun | PASS | Deferred `setImmediate` |
| P2 abort drain: gate-rejected pickup keeps queue | PASS | Abort `sendToExtension` all-truthy |
| P2 D6: steer `client_message_id` | PASS | Echo + queue payload |
| P2 wire: rejection frames carry `thread_id` | PASS | Incl. overlay `chat.create` gate |

---

## Mutation-kill (private; source restored to HEAD SHA `6158570379dc…fb21b4`)

All mutations on a `/tmp` backup of `message-router.ts`. Restored with `/bin/cp -f` after each shot. Final `git diff` on exclusive files empty. `[executed]`

### S-B1 — delete drain pause pre-check (`drainNextRun` `thrGate.paused` return)

`--test-name-pattern 'paused thread keeps nextRun'`

```text
[executed] 1 fail / 0 pass   duration_ms 361
AssertionError: paused drain must not take the queued turn
  0 !== 1
  at tests/message-router-nextrun-drain.test.ts:472
```

Recursive `chat.create` still emits `thread_paused` (so push + `resp === null` would still hold). The pin that goes red is **queue depth**: take-then-reject drops the turn the client already holds as `chat.enqueued`.

### S-B2 regen overlay — skip `if (leaseErr) return leaseErr` inside `drainNextRun`

`--test-name-pattern 'overlay-rejected regenerate keeps the queue'`

```text
[executed] 1 fail / 0 pass   duration_ms 407
AssertionError: 0 !== 1
  at tests/message-router-nextrun-drain.test.ts:505
```

Lease reject still happens on the recursive `chat.create` (frame still `OVERLAY_STANDBY`, regen RPC still `null`). The pin that dies is **keep the queue**. Cheap and sufficient.

### S-B2 conductor — skip `if (conductorErr) return conductorErr` inside `drainNextRun`

`--test-name-pattern 'conductor-rejected overlay drain keeps the queue'`

```text
[executed] 1 fail / 0 pass   duration_ms 388
AssertionError: 0 !== 1
  at tests/message-router-nextrun-drain.test.ts:545
```

Same shape: conductor still fires after take; queue is emptied. In-tree pin is real.

### S-B3 — `if (drainedAfterUpload) return drainedAfterUpload` (drop `sendToExtension`)

`--test-name-pattern 'overlay-rejected upload drain still returns file.uploaded'`

```text
[executed] 1 fail / 0 pass   duration_ms 388
AssertionError: upload ack must not be replaced by OVERLAY_STANDBY
  + actual - expected
  + 'chat.error'
  - 'file.uploaded'
  at tests/message-router-nextrun-drain.test.ts:435
```

Unconditional `return drainedAfterUpload` re-opens the post-merge B-High. The overlay-reject test **does** kill that.

### S-A1 drain side — two independent kills

| Mutation | Test | Result |
|----------|------|--------|
| Drop `queued.clientMessageId` from `followUpCreateFromQueue(...)` | S-A1 | `undefined !== 'cm-enq-1'` at `:585` |
| Occupied `enqueueNextRun(thread, text)` without `enqueueId` | S-A1 | same `undefined !== 'cm-enq-1'` |

Both `[executed]`. The in-tree test pins **both** occupied enqueue **and** drain follow-up echo.

### Negative controls (honesty, not kills)

| Mutation | Suite / test | Result | Meaning |
|----------|--------------|--------|---------|
| Delete **trash** pre-check only (`thrGate.trashed_at` in `drainNextRun`) | full 15 | **15/15 PASS** | Trash half of S-B1 is **unpinned** in-tree |
| Restore **old** `if (isDrainGateError) send; else if (drained) return drained` on upload | overlay-rejected upload | **PASS** | Overlay test does **not** uniquely pin S-B3 “never `return drainedAfterUpload`” vs the already-fixed gate-push branch |

Private trash hunt (test file mutated in `/tmp` only: `tm.trash(thread.id)` + assert `thread_trashed` + `peekNextRunCount===1`): **PASS**. `[executed]` Production test file SHA restored.

---

## Must-falsify

### 1. S-B1 — pause/trash pre-check BEFORE `takeNextRun`

**HOLD** for pause (in-tree + mutation-kill). **HOLD** for trash (`[inspected]` + private hunt). Trash is **not** in-tree pinned.

```304:341:companion/src/message-router.ts
  // ... Pause/trash must run BEFORE
  // takeNextRun so a finishing run cannot dequeue a turn the client still
  // holds as chat.enqueued (S-B1).
  const thrGate = services.threadManager.get(threadId)
  if (!thrGate) {
    return { type: "chat.error", thread_id: threadId, error: "Thread not found" }
  }
  if (thrGate.trashed_at) { ... error_code: "thread_trashed" ... }
  if (thrGate.paused) { ... error_code: "thread_paused" ... }
  const surface = session?.surface === "summoner" ? "summoner" : "tray"
  const leaseErr = gateChatCreateOnLease(threadId, surface)
  if (leaseErr) return leaseErr
  const conductorErr = gateChatCreateOnConductor(threadId, surface)
  if (conductorErr) return conductorErr
  const queued = takeNextRun(threadId)
```

No `await` between pause/trash and `takeNextRun`. Same-tick pause cannot interleave after dequeue. `[inspected]`

In-tree S-B1 (`tests/message-router-nextrun-drain.test.ts:445-474`): in-flight create + `enqueue: true` + `tm.update(..., { paused: true })` + release.

```text
[executed] resp === null
pushed.data.error_code === "thread_paused"
pushed.thread_id === thread.id
peekNextRunCount === 1
streamCalls === 1
```

Create caller (`:635-639`) treats `chat.error` as `isDrainGateError` → `sendToExtension` + `return null`. Not silent, not an ack-replace.

**Trash:** same block, immediately before pause, still before take. Private hunt with `tm.trash` keeps queue + pushes `thread_trashed`. Removing the trash pre-check does **not** redden the 15-test suite. Coverage nit N1 below — not a product miss.

Post-merge residual S-B1 (take-then-reject drops nextRun) is **REFUTED** for pause on live `9deff00`.

### 2. S-B2 — regen overlay-gate and conductor overlay drain keep the queue

**HOLD.** Tests exist, `[executed]` pass, both mutation-killed.

**Regen overlay** (`:476-511` + regen caller `:1523-1528`):

- Regen is panel/tray session. Overlay claimed **after** regen entry (entry lease already passed).
- Drain pre-checks `gateChatCreateOnLease(threadId, "tray")` → `OVERLAY_STANDBY` **before** take.
- Regen RPC stays `null`; gate frame is pushed; `peekNextRunCount===1`; `streamCalls===1`.

**Conductor overlay** (`:513-552` + `l2-conductor.ts:19-31`):

- Summoner session + overlay lease (so lease gate allows the run).
- `getComputerTaskAbortRegistry().set("cu-live", true)` after enqueue, before release (`isComputerTaskLive` is `registry.size > 0`).
- Drain pre-checks conductor **before** take → `L2_CONDUCTOR_ELSEWHERE` pushed; queue 1; `streamCalls===1`.
- Overlay is not a Trust skip: CU-live still blocks overlay drain.

Skipping the matching pre-check (lease or conductor) takes the queue; recursive `handleMessage` still returns the gate frame; tests die on `peekNextRunCount`. That is the claimed pin.

Post-merge N2 (regen overlay-gate untested) and N4 (conductor only private hunt) are **REFUTED** as “no test”.

### 3. S-B3 — upload drain: any drain frame is `sendToExtension`; RPC always `file.uploaded`

**HOLD.** `[inspected]` + overlay-reject `[executed]` + unconditional-return mutation-kill.

```1177:1181:companion/src/message-router.ts
      const drainedAfterUpload = await drainNextRun(thread_id, uploadGeneration, services, session)
      if (drainedAfterUpload) {
        session.sendToExtension(drainedAfterUpload)
      }
      return { type: "file.uploaded", thread_id, files: uploadedNames }
```

- `rg "return drainedAfterUpload"` on live `message-router.ts` → **no matches**. `[executed]`
- Overlay-rejected upload (`:410-443`): `resp.type === "file.uploaded"`, `OVERLAY_STANDBY` in `sent`, queue 1, `streamCalls===1`. `[executed]`
- Happy-path upload drain (`:588-616`): successor `chat.create` returns `null`, so `drainedAfterUpload` is falsy, RPC still `file.uploaded`, `streamCalls===2`. `[executed]`
- `file.upload` requires `session` (`:685`). `sendToExtension` is not optional on this path. `[inspected]`

Honesty on the N3 tightening: restoring the **old** `isDrainGateError` push + `else if (drained) return drained` still **PASSES** the overlay-reject test, because `OVERLAY_STANDBY` is a gate error. That test uniquely pins “do not return gate frames as the upload RPC”, not “never `return drainedAfterUpload` for a future non-gate successor”. Today’s follow-up is always `followUpCreateFromQueue` → success `null`, so the else-return is currently unreachable. The source fold (push **any** truthy drain frame; always `file.uploaded`) is still live `[inspected]`. Residual N2 below.

### 4. S-A1 drain side — occupied enqueue `clientMessageId` → follow-up `chat.create` → `chat.user` echo

**HOLD.** `[executed]` + two mutation-kills.

Shape (read-only `run-queues.ts:16-64`): `NextRunItem = { text, clientMessageId? }`; `takeNextRun` returns that object, not a string.

Occupied enqueue (`message-router.ts:441-450`):

```441:450:companion/src/message-router.ts
      if (rest.enqueue === true && abortControllers.has(rest.thread_id)) {
        ...
        const enqueueId =
          typeof rest.clientMessageId === "string" && rest.clientMessageId
            ? rest.clientMessageId
            : undefined
        if (!enqueueNextRun(rest.thread_id, text, enqueueId)) {
```

Drain (`:337-338`):

```
followUpCreateFromQueue(threadId, queued.text, session?.surface, queued.clientMessageId)
```

`followUpCreateFromQueue` (`:261-279`) spreads `clientMessageId` onto the recursive `chat.create`. `chat.create` passes it into `chatCreate` (`:598-601`). Adapter echo (`adapter.ts:411-415`) as `client_message_id`.

In-tree (`:554-586`): occupied enqueue `clientMessageId: "cm-enq-1"` → drained `chat.user` with `content === "queued with bubble"` and `client_message_id === "cm-enq-1"`. `[executed]`

Leftover-steer conversion (`convertLeftoverSteerToNextRun`) is Lane A. This lane only claims the **occupied enqueue → drain echo** path.

---

## Other drain call sites (regression scan)

| Caller | Gate-reject | Original RPC | Evidence |
|--------|-------------|--------------|----------|
| **chat.create** `:635-641` | `isDrainGateError` → push → `return null` | `null` | PASS lease-reject + S-B1 pause |
| **file.upload** `:1177-1181` | push **any** truthy drain frame | **always** `file.uploaded` | PASS overlay-reject + S-B3 mutation |
| **chat.regenerate** `:1523-1528` | gate → push → `return null`; else `return drainedAfterRegen` | `null` on gate / success (`null` successor) | PASS S-B2 regen overlay + panel success |
| **chat.abort** `:1268-1274` | `sendToExtension` all truthy | always `chat.aborted` | PASS abort gate-reject |

`isDrainGateError` (`:344-349`) remains type-wide (`error` \| `chat.error`). Tightening to an `error_code` allowlist would re-open occupancy ack-replace. Do not “fix”. Pause/trash/thread-not-found frames are `chat.error` → pushed on create/regen. `[inspected]`

---

## Residuals (non-blocking)

### N1 — trash pre-check unpinned in-tree

S-B1 claim includes trash. Code and private hunt HOLD. Deleting only the `trashed_at` pre-check leaves the 15-test suite green. Add a sibling of `:445` (`tm.trash` + `thread_trashed` + `peekNextRunCount===1`) next round. Not a product miss.

### N2 — overlay-reject upload test does not uniquely pin “never `return drainedAfterUpload`”

The N3 fold (push any drain frame; never return successor as upload RPC) is live `[inspected]`. Overlay-reject still passes the **old** gate-push + else-return. Current successor contract (`chat.create` → `null`) closes the latent branch. Optional: assert `resp.type === "file.uploaded"` on a synthetic non-gate truthy drain, or keep the source as defense-in-depth without a unique pin.

### N3 — regen still `return drainedAfterRegen` for non-gate truthy frames (`:1528`)

Cousin of post-merge N3, upload-only fold. Success drain is `null`; gate is push + `return null`. Latent if a future non-null non-error successor appears. Not S-B3.

### N4 — `MULTI_AGENT_LLM_CAP` still after `takeNextRun`

Pause/trash/missing-thread/lease/conductor now pre-check. Recursive `chat.create` still `await import("./orchestrator/llm-loop-gate")` **after** take (`:487-500`). Cap reject drops the already-dequeued nextRun. Same-tick pause cannot race (no await between take and the recursive pause check); the cap `await import` can. Rare (cap after a finishing run). Residual of post-merge N1, not a reopen of S-B1.

---

## Disposition vs claimed folds

| ID | Claim | This round |
|----|--------|------------|
| **S-B1** | pause/trash before take; paused finishing run keeps queue + `thread_paused` | **HOLD** pause `[executed]`+mutation-kill; trash `[executed]` private hunt, in-tree unpinned (N1) |
| **S-B2** | regen overlay-gate + conductor overlay drain keep queue | **HOLD** both tests + both mutation-kills `[executed]` |
| **S-B3** | upload: push any drain frame; RPC `file.uploaded`; no `return drainedAfterUpload` | **HOLD** source + overlay RPC pin + unconditional-return kill; unique-pin gap N2 |
| **S-A1 drain** | occupied enqueue id → follow-up `chat.create` → `chat.user` echo | **HOLD** `[executed]` + enqueue-id and follow-up-id kills |
| Overlay-as-Trust / confirm skip | — | **REFUTED** conductor still blocks overlay `[executed]` |
| Blast T3 | — | **REFUTED** — stay T2 |

---

## Eval card (T2)

| Gate | Result |
|------|--------|
| MACHINE | **PASS** 15/15 `[executed]` (after worktree `node_modules` bootstrap) |
| Outcome | Pause drain keeps queue; overlay regen + conductor keep queue; upload RPC stays `file.uploaded`; occupied enqueue id echoes on drain |
| Trajectory | Exclusive files only; `/tmp` mutations restored; `git diff` exclusive files empty |
| Component | `drainNextRun` `:295` · pause/trash `:314-329` · take `:335` · follow-up `:261` · occupied enqueue `:441` · upload `:1177` · regen `:1523` · tests `:445/:476/:513/:554/:410` |

This session is the independent adversary gate, not a merge self-APPROVE.

VERDICT: APPROVE_WITH_NITS
