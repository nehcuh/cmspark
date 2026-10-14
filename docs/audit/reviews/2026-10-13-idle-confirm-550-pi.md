I read `pi-context.md` completely, then independently cross-checked the frozen diff against the real worktree source, the final machine card, and both reports. I did not edit anything.

# Final review — Batch #550

## VERDICT: APPROVE_WITH_NITS

No blocking (P0/P1) defect. The independent adversary **APPROVE** is **confirmed in substance**, with two corrections: its Linux line is superseded by the final machine card, and the Kimi report's line citations are context-packet offsets, not real file lines.

---

## 1. Frozen artifact integrity

- `diff.patch` content == the `COMPLETE DIFF` embedded in `context.md` (byte-for-byte match on inspection).
- The real worktree source `/Users/huchen/.codex/worktrees/issue-convergence/cmspark/companion/src/orchestrator/tab-lease.ts` contains exactly the guarded line and the updated docs; the new test cases exist at lines 805 and 830. Only `tab-lease.ts` + `orchestrator-tab-lease.test.ts` are in scope, matching "Scope only tab-lease + test."
- `diff_sha256` is stated identically in `machine.json`, `context.md`, and `pi-context.md`; `kimi.stderr` shows the same hash recomputed over `diff.patch`. No threshold/timeout constant changed (`SOFT_LEASE_SKEW_MS`, `SOFT_LEASE_MS`, `DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS` untouched).

## 2. Functional verification (against real source, not packet offsets)

The only behavior change is one additive keep-condition in `releaseIdleLeasesForThread` (real file **line 740**, not `:849`):

```ts
if ((lease.state === "SOFT_RESERVED" || lease.state === "HELD_PENDING_L2") && keepSoftForLiveConfirm(tabId, lease, t)) continue
```

- **Guard ordering preserved:** `mutationHolds` → unexpired `createdHoldUntil` → `resolveHasPending` → new confirm guard. The added clause can only *prevent* a delete that the pre-#550 code performed; it cannot free anything previously kept. #545 protections are not weakened.
- **State scoping is correct:** a live L2 dialog only exists in `SOFT_RESERVED` (fresh) or `HELD_PENDING_L2` (promoted from HARD, real lines 473/487). Deny returns to `HARD_HELD` and clears `confirmId` (line 574). `HARD_HELD` cannot carry a live confirm, so excluding it is right.
- **Throwing hook:** `keepSoftForLiveConfirm` (line 202) catches and returns `true`, retaining the lease — matches DoD "throwing confirm hook keeps lease."
- **Release resumes:** once `hasPendingConfirmation` returns false and no mutation/create/pending hold remains, fall-through delete fires — matches DoD and the tests.

### Hard / cancel / owner checks

| Axis | Finding |
|---|---|
| **Hard cap** | Unchanged. `freeAtHardMax` / `sweepPerCallLease` do not consult the confirm hook, so hard-max still frees `HELD_PENDING_L2`. Confirm: `keepSoftForLiveConfirm` never writes `hardMaxDeadline`. (Caveat correctly raised by the adversary: the `SOFT_RESERVED` soft-expiry branch never reaches hard-max — *pre-existing*, not introduced, and out of scope.) |
| **Cancel** | Unchanged and independent. Cancel uses `releaseLeasesForThreadPendingAware` / `releaseTabLease`; the idle path is not on the cancel route. `hardReacquireAfterConfirm` still yields `POST_CONFIRM_CANCELLED` after a cancel. |
| **Owner** | Guard preserves the original holder; rival acquire still hits `existing.holderThreadId !== holderThreadId` (line 441) → `TAB_BUSY_CONFIRMING`/`TAB_LOCKED`. Tests assert rival denial. |

No functional defect found; I could not construct a regression from the added clause.

## 3. Machine card — no false claim found, one inconsistency flagged

Final card is internally consistent: host `5833 + 52 = 5885`, `fail: 0`, `host_test_exit: 0`, `build_exit: 0`; `linux_pending: false` with `linux_arm64 79/79, build_exit 0, test_exit 0`; `reproduction 43/40/3, exit 1` (the 2 parameterized + 1 throw case = exactly the 3 red tests).

- **Inconsistency (not a false claim):** the frozen `context.md` and the prompt prose still say "Linux fresh snapshot pending," while the final machine card marks `linux_pending: false`. The card explicitly supersedes. The adversary's "Linux … still `linux_pending:true` at review time" was accurate then and is now stale — it is not a fabricated green, and must not be read as Linux-red either.
- **Not independently reproducible here:** I have read-only file access, so I confirm the reported numbers are self-consistent and the red-on-baseline logic is sound; I do not re-infer the host/Linux/ARM runs from the card. Those remain attributed supplied evidence.

## 4. Adversary.md — confirmation / refutation

- **Confirmed:** T3 classification; additive guard; no dispatch/approval/authority change; hard cap not touched; cancel/owner semantics unchanged; missing-hook vs throwing-hook distinction; "do not overclaim new absolute-cap or extended confirmation window."
- **Corrected:** its "Linux pending" note is superseded; its rerun (61 passed on `orchestrator-tab-lease` + `orchestrator-l2-flight`) and fake-clock probes are accepted as supplied, not re-inferred.

## 5. Kimi.md — substantive verdict confirmed, citation accuracy refuted

Kimi's reasoning and verdict (`APPROVE_WITH_NITS`) are correct, but its **line numbers are offsets from the combined packet, not the real files** (the exact trap `pi-context.md` warned about):

| Kimi cites | Real file line | Offset source |
|---|---|---|
| `tab-lease.ts:849` (added guard) | **740** | context.md `:849` |
| `tab-lease.ts:311-325` (`keepSoftForLiveConfirm`) | **202** | context.md `:311` |
| `tab-lease.ts:550`, `:582`, `:683` | **441, 473, 574** | +109 |
| test `:1866-1875` | test **830-839** | +1036 |

The described logic is accurate; only the citations are wrong. This is a report-accuracy nit, not a code defect.

## 6. Nits (distinguished by severity)

**Patch nits (style only, non-blocking):**
1. Added guard line 740 (~125 chars) and doc line 729 exceed the surrounding wrap width (`kimi` P2 #1) — formatting only.
2. Doc comment at lines 728-729 is now a run-on sentence after the edit — readability only.

**Pre-existing / hardening observations (not introduced by this patch, not defects):**
3. If `hasPendingConfirmation` is *unregistered* (not throwing), `keepSoftForLiveConfirm` returns false, so an idle worker mid-confirm could lose the lease on the next snapshot. This matches existing `sweepExpired` soft-expiry semantics, and production registers all hooks together from `server.ts` bootstrap (line 173); the pre-registration window is fail-closed via `resolveHasPending`. Hardening note only (`kimi` P2 #2, adversary §"Production hook visibility").
4. `SOFT_RESERVED` never reaches hard-max in `sweepPerCallLease` while the confirm predicate stays true — pre-existing semantics deliberately kept by this batch.

**Test nit (optional coverage):**
5. The throwing-hook test asserts only retain + state; it could also assert rival denial / `softDeadline` extension, symmetric with the live case (`kimi` P2 #3).

## 7. DoD scorecard

| DoD item | Result |
|---|---|
| Idle `SOFT_RESERVED` / `HELD_PENDING_L2` keep exclusive ownership while confirm live | Pass |
| Rival denied | Pass |
| Once confirm not live and no other hold, release resumes | Pass |
| Throwing confirm hook keeps lease | Pass |
| Existing mutation/CDP/create/hard-max/cancel behavior unchanged | Pass (no touched paths) |

**Conclusion:** the patch is correct, minimal, and blast-radius-appropriate (T3, no new authority or side effects). The adversary's APPROVE is confirmed; the only real deltas are non-blocking report/style nits and the stale `linux_pending` prose, which the final card supersedes. **VERDICT: APPROVE_WITH_NITS.**
