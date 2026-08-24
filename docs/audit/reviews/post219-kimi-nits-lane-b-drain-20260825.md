# Lane B — nextRun drain / lease surface stamp (PR #219 M1 re-attack)

**Reviewer**: independent adversarial (Lane B) — did **not** implement these changes; no source/test edits  
**Date**: 2026-08-25  
**Scope**: Autonomy nextRun drain + Surface L0 overlay/panel lease identity on drain (ADR-020). Trust unchanged.  
**Blast**: T2  

**Live HEAD**: `c5b424275285ecc5edffc1d822bcb28066ca40e4` (prompt cited `daf8bc9` = merged #219; live tree has uncommitted WIP)  
**Frozen patch**: `docs/audit/reviews/post219-kimi-nits-wip-20260825.patch`  
**SHA256**: `AD4794DCEFA42671E95C1FFA95466110C790FA9C15E92795743E3A48678F0AE4` — **MATCH** `[executed]` `Get-FileHash`  

**Exclusive range reviewed**:
- `companion/src/message-router.ts` — `drainNextRun`, `followUpCreateFromQueue`, `chat.create` occupancy, `chat.steer`, `file.upload` slot claim, `chat.regenerate`, `chat.abort` drain
- `companion/tests/message-router-nextrun-drain.test.ts` (untracked — read live)
- `companion/src/ws/composer-lease.ts` — **only** `gateChatCreateOnLease` / `incomingHolderFromSurface` / `stampCmsparkSurface` / follow-up surface mapping (overlay-session CAS → Lane C)

Evidence tags: `[executed]` ran on this Windows host · `[inspected]` read the live path · `[assumed]` not directly exercised.  
Attack posture: **default REFUTED** until proven.

---

## Capability table (ADR-020)

| Axis | Claim in fold | Lane B score |
|------|---------------|--------------|
| **Surface L0** | Drain stamps `__cmspark_surface` from `session.surface`; overlay-held lease no longer silent-drops nextRun | **HOLD** for M1 silent-drop fix. Residual **High**: gate-rejected drain can replace `file.uploaded` ack (see B1). |
| **Autonomy** | Shared `drainNextRun`; pre-check lease/conductor **before** `takeNextRun`; generation guard; abort deferred pickup; upload/regen drain parity | **HOLD** for queue-preservation + generation guard. |
| **Trust** | Unchanged in this blast | **N/A** (out of range) |

---

## Machine results

```text
[executed] Get-FileHash -Algorithm SHA256 docs/audit/reviews/post219-kimi-nits-wip-20260825.patch
→ AD4794DCEFA42671E95C1FFA95466110C790FA9C15E92795743E3A48678F0AE4  MATCH

[executed] cd companion; npx tsx --test tests/message-router-nextrun-drain.test.ts
→ 9 pass / 0 fail  (duration_ms ≈ 947)

[executed] cd companion; npx tsx --test tests/composer-lease.test.ts
→ 34 pass / 2 fail
  PASS: followUpCreateFromQueue stamps summoner so overlay nextRun drain keeps the lease
  PASS: chat.create gate OVERLAY_STANDBY when overlay holds and panel incoming
  PASS: stampCmsparkSurface overwrites client spoof always
  FAIL×2: static readFileSync of `../src/...` resolved to repo-root `src/` (ENOENT) —
           test harness path issue on this host, not a product drain bug.
```

| Test (nextrun-drain) | Result | What it actually proves |
|----------------------|--------|-------------------------|
| P1 TOCTOU: create during upload parse → `run_active` | PASS | Entry claim before vision await |
| P1 cleanup: early return frees slot | PASS | `uploadError` releases claim |
| P1 drain gate: lease-rejected drain keeps queue | PASS | Overlay claim + **panel** session → `OVERLAY_STANDBY`, `peekNextRunCount===1`, no second stream |
| P1 drain parity: upload drains nextRun | PASS | Panel lease path only (`makeSession` has no `surface`) |
| P1 drain parity: regenerate drains nextRun | PASS | Same |
| P2 abort drain: picks up queued nextRun | PASS | Deferred `setImmediate` + generation bump |
| P2 abort drain: gate-rejected pickup keeps queue + pushes error | PASS | Abort path uses `sendToExtension(drained)` |
| P2 D6: steer `client_message_id` | PASS | Echo + queue payload |
| P2 wire: rejection frames carry `thread_id` | PASS | Incl. overlay `chat.create` gate |

**Coverage hole**: no integration test claims overlay lease **and** drains with `session.surface === "summoner"` to assert **successful** overlay nextRun. Unit stamp+gate coverage exists in `composer-lease.test.ts` (`followUpCreateFromQueue` + `gateChatCreateOnLease`).

---

## Claims vs call sites

| # | Claimed fold | Call site | Status |
|---|--------------|-----------|--------|
| 1 | `drainNextRun` shared helper | `message-router.ts:287-312`; callers create `:594`, upload `:1130`, abort `:1222`, regen `:1474` | **HOLD** `[inspected]` |
| 2 | Pre-check lease/conductor **before** `takeNextRun` | `:301-305` then `:305` | **HOLD** — reject keeps queue `[executed]` gate tests |
| 3 | `followUpCreateFromQueue` stamps `__cmspark_surface` | `:261-271`; drain passes `session?.surface` `:308` | **HOLD** `[inspected]` + unit PASS |
| 4 | Overlay session drain keeps `session.surface` | lifecycle builds session with `surface: wsAuth.get(ws)?.surface` (`lifecycle.ts:1313`); overlay WS handshakes `surface: "summoner"` (`menu-bar-agent.ts:1488`) | **HOLD** `[inspected]` — not integration-executed here |
| 5 | Generation guard (predecessor cannot steal) | `:293`; abort bumps gen in `abortThreadChat` `:155` | **HOLD** `[inspected]` + abort drain PASS |
| 6 | `file.upload` claims LLM slot sync at entry | `:650-663` before any parse/vision await | **HOLD** `[executed]` TOCTOU test |
| 7 | upload / regenerate drain like create | `:1130`, `:1474` | **HOLD** parity PASS; see B1 for upload ack interaction |
| 8 | `chat.abort` deferred nextRun pickup | `:1219-1233` `setImmediate` + `myGeneration: null` | **HOLD** `[executed]` |
| 9 | `chat.steer` passes `client_message_id` | `:618-634` | **HOLD** `[executed]` |
| 10 | Dead `existing.abort()` on `chat.create` removed | Occupied path `:425-427` returns `run_active` only; set at `:441` with no abort | **HOLD** `[inspected]` (`file.upload` / `chat.regenerate` still supersede by design) |

---

## Must-falsify checklist

### 1. Overlay-held lease + enqueue + drain still OVERLAY_STANDBY / silent drop?

**Original M1 silent drop: REFUTED.**

- Pre-check returns `OVERLAY_STANDBY` **without** `takeNextRun` when panel/tray surface drains under overlay lease (`:300-302`). `[executed]` P1 drain-gate + P2 abort gate-rejected tests leave `peekNextRunCount === 1`.
- `incomingHolderFromSurface("tray") === "panel"` and `undefined`/non-summoner both map to panel (`composer-lease.ts:96-97`, `stampCmsparkSurface` `:118`). Stamping `"tray"` vs omitting is **gate-equivalent** for panel — the M1 hole was take-then-reject; pre-check closes it.
- **Successful** overlay drain requires `session.surface === "summoner"`. Attack “is surface actually summoner on overlay?” → **HOLD by inspection**: WS lifecycle stamps + passes handshake surface into `SessionCallbacks` (`lifecycle.ts:1046`, `:1313`); overlay client sets `surface: "summoner"`. `[inspected]` Not end-to-end exercised in `message-router-nextrun-drain.test.ts` (see Nit N1).

### 2. Gate reject AFTER `takeNextRun` anywhere (queue drop after `chat.enqueued`)?

**REFUTED** for the shared drain path.

- Order is gate → conductor → `takeNextRun` → `handleMessage` (`:301-310`).
- No `await` between `takeNextRun` and the recursive `chat.create` sync gate at the top of `handleMessage`, so same-tick lease flip cannot interleave. `[inspected]`

### 3. Drain while `abortControllers` still has the thread (re-supersede)?

**REFUTED.**

- `drainNextRun` early-outs if `abortControllers.has(threadId)` (`:295`).
- `abortThreadChat` deletes the controller **before** `setImmediate` drain (`:150`, `:1221-1222`). `[inspected]` + abort tests PASS.

### 4. `file.upload` TOCTOU: await parse/vision before `abortControllers.set` still live?

**REFUTED.**

- Sync claim at `:660-663` precedes partition/parse/vision awaits. `[executed]` TOCTOU test: `listLlmActiveThreadIds` includes thread during held vision; concurrent create → `run_active`; `streamCalls === 0` until release.

### 5. Occupied `chat.create` still aborts predecessor?

**REFUTED.**

- `:425-427` returns `{ error: "run_active" }` with no `abort()`. Comment at `:433-438` documents the invariant. `[inspected]`

### 6. Tests that never claim overlay lease then drain (the original hole)?

**PARTIAL — reject path covered; success path not.**

- Tests **do** claim overlay then drain, but only the **reject** (panel session) path.
- Missing: `composerLeases.claim(overlay)` + `session.surface = "summoner"` + assert drained run starts and queue empties. Unit stamp/gate PASS in `composer-lease.test.ts` mitigates but does not replace integration. → **Nit N1**.

### 7. `session?.surface !== "summoner" → "tray"` mapping — panel drain when overlay does **not** hold?

**HOLD.**

- Default lease is panel; tray stamp → `incomingHolderFromSurface` → panel → gate OK. `[executed]` upload/regen/abort success drains with `makeSession` (no surface).

---

## Findings

### High

#### B1 — Gate-rejected drain replaces `file.uploaded` ack (chips / pending upload can stick)

`companion/src/message-router.ts:1127-1132`

```1127:1132:companion/src/message-router.ts
      // P1: drain one queued nextRun now that the slot is free (parity with
      // chat.create) — generation-guarded + gate-pre-checked inside, so a
      // rejected drain keeps the message queued.
      const drainedAfterUpload = await drainNextRun(thread_id, uploadGeneration, services, session)
      if (drainedAfterUpload) return drainedAfterUpload
      return { type: "file.uploaded", thread_id, files: uploadedNames }
```

**Attack**: Panel `file.upload` starts under panel lease → enqueue nextRun during vision → overlay claims mid-flight → upload chat finishes → `drainNextRun` returns `chat.error` / `OVERLAY_STANDBY` → WS reply is **not** `file.uploaded`.

**UI impact** `[inspected]`:
- `useWebSocket.ts` clears chips / pending upload only on `file.uploaded` (`:1782-1791` `CLEAR_PENDING_UPLOAD` + `BUMP_COMPOSER_UPLOAD_CLEAR`).
- `chat.error` OVERLAY_STANDBY path sets standby and breaks (`:451-454`) — clears busy/processing but **not** upload chips / pending map.

**Contrast**: `chat.abort` correctly `sendToExtension(drained)` while still returning `chat.aborted` (`:1222-1225`). Upload should mirror that: always return `file.uploaded`, push gate frames via `sendToExtension`.

**Why not REJECT**: Original M1 silent queue drop is closed; this is a **new** residual on the upload-ack channel under lease flip + queued nextRun. Ship risk is real but scoped.

Same return-drain-error pattern exists on `chat.create` (`:594-595`); create historically returns `null` after stream, so impact is softer (test explicitly expects create promise → `OVERLAY_STANDBY`). Still prefer abort-style push (Nit N2).

### Nit

#### N1 — No integration test: overlay lease + `session.surface="summoner"` successful drain

`companion/tests/message-router-nextrun-drain.test.ts` never constructs a summoner session. Production wiring looks correct (`lifecycle.ts:1313` + stamp helpers), but the exact M1 success path remains `[assumed]` at the `handleMessage` seam.

#### N2 — `chat.create` returns drain gate error as the create WS reply

`:594-595` — after a successful stream, the request response becomes `chat.error`. Abort path’s `sendToExtension` is cleaner. Align create/upload with abort.

#### N3 — `file.upload` still supersedes an in-flight create

`:662-668` — asymmetric occupancy: create cannot abort upload (`run_active`), but upload can abort create. Claim only removed create-side abort; document or tighten if product wants strict non-preemption.

#### N4 — `composer-lease.test.ts` two static path assertions ENOENT on this host

Tests open `../src/message-router.ts` / `lifecycle.ts` relative to CWD in a way that resolves to repo-root `src/`. Unrelated to drain logic; fix paths in a follow-up.

---

## PR #219 adversary M1 disposition

| Item | Result |
|------|--------|
| Unstamped drain → panel → OVERLAY_STANDBY **after** take → silent drop | **REFUTED** — pre-check before take; stamp from session surface |
| Overlay success drain identity | **HOLD** by lifecycle/session wiring `[inspected]`; integration gap **N1** |
| Queue preserved on gate reject | **HOLD** `[executed]` |

---

## VERDICT: APPROVE_WITH_NITS

M1 silent nextRun drop is closed. Land with eyes open on **B1** (`file.uploaded` swallow under overlay claim + queued nextRun) — fix before calling the upload/drain parity fold done; N1–N3 are non-blocking residuals.
