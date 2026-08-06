# S51 P0 Adversarial Verification — Trust Trash + Mid-loop M2

**Date**: 2026-08-07  
**Branch**: `fix/s51-trust-trash-m2-midloop` (workspace: `C:\Users\HuChen\Projects\cmspark`)  
**Mode**: Live code inspection (not claim-only). Evidence tags: `[inspected]` unless noted.  
**Scope**: Fix 1 trust cookie soft-delete; Fix 2 mid_loop M2 re-attach; nits (voice Windows copy, single hard-delete broadcast).

---

## Fix 1 — Trust cookie on soft-delete

### Claim checklist

| Claim | Live verdict | Evidence |
| --- | --- | --- |
| `releaseTrustBeforeThreadGone` restore **then** clear cookie | **PASS** | `[inspected]` `companion/src/packs/pack-engine.ts` L398–431: `restoreTrustFromThreadCookie` → `releaseTrustJournalIfMatch` → `threadManager.update(..., { mission_pack_trust_snapshot: null })` (or in-place null without TM) |
| Clear persisted via `threadManager.update` | **PASS** | `[inspected]` L412–413; `ThreadManager.update` Object.assigns + `saveIndex()` (`thread-manager.ts` L521–598) |
| Callers pass `threadManager` | **PASS** | `[inspected]` `message-router.ts`: `thread.delete` L1193; `thread.batch_delete` L1259; `thread.cleanup_empty` L1355 — all pass `threadManager` |
| Idempotent when cookie already null | **PASS** | `[inspected]` early return L407 `if (!isPackTrustSnapshot(...)) return false`; tests L471–473, L541 |
| trash → Settings OFF → hard-delete does not re-elevate | **PASS** | `[inspected]` test `S51 P0: trash then Settings flip...` L481–547; second `releaseTrustBeforeThreadGone` returns false; cruise stays false |
| trash A then apply B then hard-delete A does not clobber B | **PASS** | `[inspected]` test L550–607 |
| `clearTrustCookieWithoutRestore` used without re-restore on purge/list path | **PASS** | `[inspected]` `message-router.ts` L1387–1405: list trashed cookies → clear no-restore **before** `purgeExpiredTrash` |
| No remaining double-restore on **post-S51** soft→hard path | **PASS** | Soft path clears cookie; hard path calls release again but no-ops |

### Call graph (delete / trash / purge)

```
thread.delete (trash|hard)
  └─ releaseTrustBeforeThreadGone(thr, "thread.delete", threadManager)  // always
  └─ trash() | delete() + broadcast thread.deleted mode:hard

thread.batch_delete
  └─ per id: releaseTrustBeforeThreadGone(..., "thread.batch_delete", threadManager)
  └─ hard → broadcast thread.deleted; soft → thread.trashed

thread.cleanup_empty
  └─ releaseTrust on empty threads with threadManager
  └─ cleanupEmpty() + broadcast thread.deleted

thread.list (lazy TTL)
  └─ clearTrustCookieWithoutRestore on only_trashed rows (no restore)
  └─ purgeExpiredTrash(30) + broadcast reason trash_ttl
```

### Adversarial probes

1. **Persistence after soft-delete**  
   `trash()` mutates the same index row after `update` cleared the cookie (`thread-manager.ts` L378–386). No re-write of a stale snapshot. Cookie stays null on disk. `[inspected]`

2. **Double-restore paths**  
   - Post-S51: soft release+clear → hard release no-op. **Fixed.**  
   - `unapply` / `uninstall` still restore from cookie when present — correct for live threads, not a trash re-fire.  
   - **Residual (migration, not S51 regression)**: Pre-S51 trashed rows that still hold a cookie **and** skip `thread.list` (no clear) will still hit `releaseTrustBeforeThreadGone` on hard-delete and re-restore. Mitigation: list/TTL path clears without restore first. No dedicated hard-delete branch for `trashed_at` that prefers clear-only. Severity: low; only upgrade leftovers.

3. **`clearTrustCookieWithoutRestore` misuse**  
   Only used on `thread.list` trash rows — correct for “release already ran” / pre-S51 leftovers. Not used on soft-delete (would leave sticky cruise). `[inspected]`

4. **findOtherTrustHolders**  
   Uses `list()` (excludes trash). Soft-delete clears cookie, so trashed holders do not block new Trust apply; hard-delete of A after B applied cannot re-fire A’s cookie post-S51. Test L550–607 covers clobber. `[inspected]`

5. **Missing `threadManager` at call sites**  
   No production caller omits it. Optional param is for tests/best-effort only. `[inspected]`

### Fix 1 verdict: **PASS** (migration residual only)

---

## Fix 2 — mid_loop M2 re-attach (`adapter.ts`)

### Claim checklist

| Claim | Live verdict | Evidence |
| --- | --- | --- |
| After mid_loop M1 compact, re-call `attachRollingSummaryToMessages` with kept summary | **PASS** | `[inspected]` `adapter.ts` L561–580: when `phase === "mid_loop" && keepSummary && mode === "m1"`, re-attach from `prevMeta.rolling_summary` |
| Event/mode becomes `m2` | **PASS** | L577 `mode = "m2"`; logger L605–607 and `sendToExtension` L622–630 use `mode`; UI gets `mode: "m2"` + `rolling_summary` |
| `shouldRunM2` still skips mid_loop generation | **PASS** (by design) | `context-budget-m2.ts` L82–89: `phase === "mid_loop" → false` — re-attach is the intended substitute |
| Double summary **notices in request messages** | **PASS** (no double) | `attachRollingSummaryToMessages` replaces existing omit/summary notice in-place (`context-budget.ts` L328–343); unit test asserts single notice L195 |
| Meta wipe of prior rolling_summary on mid_loop M1 | **PASS** | `keepSummary` prefers fresh then `prevMeta.rolling_summary` for mid_loop; written back L591 |

### Dual-notice / UX

- Each successful compact pass still emits one `thread.context_compacted` (pre_loop and mid_loop independently). That is **two events over a long tool loop**, not two simultaneous omit lines in the model request. Store `SET_CONTEXT_COMPACTED` overwrites per thread. **Not a S51 regression**; no extra notice injection beyond re-attach-in-place. `[inspected]`

- Unit coverage: `context-budget.test.ts` “S51 P0: mid_loop recompact re-attaches…” L154–196 exercises the two-pass message transform. Full adapter integration test for the meta+event path is thinner (logic is local to `runContextBudgetPass`) — acceptable for P0 given unit + static path.

### Fix 2 residual (non-blocking)

- Re-attached summary is the **pre_loop** M2 text; mid_loop drops (e.g. huge tool results) are not re-summarized. Preferable to wiping M2; not a re-elevate / wrong-mode bug.

### Fix 2 verdict: **PASS**

---

## Nits

### Voice permission Windows copy

`[inspected]` `chrome-extension/src/tabs/voice-permission.tsx` L44–54:

- Windows: `Windows「设置 → 隐私和安全性 → 麦克风」`
- macOS: `macOS「系统设置 → 隐私与安全性 → 麦克风」`
- Fallback: `系统麦克风隐私设置`

**PASS** — OS-specific copy present; Windows path matches Settings IA.

### Single hard-delete broadcast

`[inspected]` `message-router.ts` L1206–1210: single `thread.delete` hard path now `session.broadcast({ type: "thread.deleted", ..., mode: "hard" })` in addition to the request response.

- Batch hard path already broadcast per id (L1267).  
- Requesting client may receive **response + broadcast** (same type). Extension `REMOVE_THREAD` is idempotent (`useWebSocket.ts` L750–752). Multi-panel sync is the intent of the nit.

**PASS** — broadcast present; dual delivery to requester is harmless.

---

## Tests present (static)

- `companion/tests/packs-engine.test.ts`: S46 release + S51 trash/hard + A/B clobber  
- `companion/tests/context-budget.test.ts`: mid_loop re-attach single notice  

No automated test found specifically for `clearTrustCookieWithoutRestore` on `thread.list` or for single-delete broadcast — nits only; not user-facing blockers.

---

## Remaining REAL user-facing blockers

**None** for the S51 P0 scope on a post-fix soft→hard lifecycle.

### Non-blocking residuals

1. **Pre-S51 trash cookies + hard-delete without prior `thread.list`**: may still re-restore once (migration). List/TTL path mitigates.  
2. **Mid_loop re-uses stale pre_loop summary** for newly dropped tool content (quality, not correctness of mode/meta).  
3. **Requester double `thread.deleted`** (response + broadcast) — UI-safe.

---

## VERDICT: PASS

All P0 claims hold under live inspection. Nits are implemented. Residuals are migration/quality only, not ship blockers for the trash→settings→hard-delete re-elevate bug or mid_loop M2 wipe.
