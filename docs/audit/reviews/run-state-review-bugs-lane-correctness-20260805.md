# Correctness Lane — run-state-review-bugs

**Branch / range:** `fix/run-state-review-bugs` vs origin/main  
**Diff:** `docs/audit/reviews/run-state-review-bugs-diff-20260805-090257.patch`  
**Date:** 2026-08-05  
**Status:** WATCH  
**Recommendation:** APPROVE_WITH_NITS  
**Evidence mode:** live source + patch inspection `[inspected]`; targeted unit/integration suites **not re-executed** in this lane (no shell tool in reviewer runtime). Compiled artifacts under `companion/.test-dist` already embed the claimed symbols (`open_intents_by_run`, cruise reL2 carve-out, `forceConfirm = critical && !userFullAutonomy`) — treated as compile-time presence only, not as a green CI run.

---

## Executive summary

All four claimed fixes are **present, internally consistent, and correctly ordered** on the production paths they target:

| Claim | Status | Evidence |
|-------|--------|----------|
| 1. executor reL2: cruise + `forceInteractive` + `reL2ShouldPrompt` | **FIXED** | Cruise short-circuit is *after* force-interactive and only when `!reL2ShouldPrompt`; PROMPT_ALWAYS (incl. `foreground_yielded`) and empty/unknown tags fail-closed |
| 2. server `forceConfirm = critical && !userFullAutonomy` | **FIXED** | Browser-script + domain/god-mode alone no longer waive critical forceConfirm; three-flag cruise still waives |
| 3. `open_intents_by_run` + `resolveOpenIntentsForRun` (no global fallback when `runId` set) | **FIXED** | Companion emits map; WS hydrates; App / ChatView / RunBusyChip all use helper |
| 4. Tests updated (security-gates, computer-executor, thread-busy, orchestrator-tab-lease) | **PRESENT** | Expectations flipped for god-mode-alone critical; cruise negative + full-auto positive added; helper + fleet map tests added |

No **blocking** logic inversion found on the claimed surfaces. Residual issues are: (a) process-wide intent chrome outside the four RunBusy call sites, (b) board hosts without `orchestrator_run_id` still only land in the global counter, (c) test gaps that allow false confidence on cruise *positive* silence and cruise×`foreground_yielded`.

---

## Claim-by-claim verification

### 1. executor reL2 ordering `[inspected]`

**Live path:** `companion/src/computer/executor.ts` `reL2` (~636–684)

```
forceInteractive = tags ∩ FORCE_INTERACTIVE_DANGEROUS
  (danger_detected | experimental_suggestion)

if (!forceInteractive && !reL2ShouldPrompt(dangerous)) {
  // three-flag cruise → auto-approve
}
if (sessionId && app && !forceInteractive) {
  if (trust && !reL2ShouldPrompt(dangerous)) {
    // session trust → auto-approve
  }
}
// else interactive confirm
```

**Cross-check vs `session-trust.ts`:**

| Tag | FORCE_INTERACTIVE | PROMPT_ALWAYS / reL2ShouldPrompt | Cruise silence? | Session-trust silence? |
|-----|-------------------|----------------------------------|-----------------|------------------------|
| `danger_detected` | yes | true | no | no |
| `experimental_suggestion` | yes | true | no | no |
| `foreground_yielded` | **no** | true | no (via reL2ShouldPrompt) | no |
| `budget_exhausted` / `uncrossverified_exceeded` / `task_induced_dialog` | no | false | yes | yes (if trusted) |
| `[]` empty | no | **true** (fail-closed) | no | no |
| unknown tag | no | **true** (fail-closed) | no | no |

**Hunt result — dual `forceInteractive` vs `reL2ShouldPrompt`:**

- For current tag sets, cruise condition `!forceInteractive && !reL2ShouldPrompt` ≡ `!reL2ShouldPrompt` because FORCE_INTERACTIVE ⊂ PROMPT_ALWAYS.
- `foreground_yielded` is **only** in `reL2ShouldPrompt` / PROMPT_ALWAYS — correctly still prompts under cruise (not a hole).
- Empty tags fail-closed under cruise: `reL2ShouldPrompt([]) === true` → no short-circuit. **Not a bug.**
- Redundancy is defense-in-depth for danger/experimental; maintenance drift risk if FORCE_INTERACTIVE gains a tag not mirrored in PROMPT_ALWAYS (would only make *more* prompts via session-trust early skip — fail-safe, not fail-open).

**NIT (maintainability):** Comment says “Never short-circuit PROMPT_ALWAYS” while FORCE_INTERACTIVE is a narrower set. Prefer a single SoT (`reL2ShouldPrompt` only) for cruise, or document why FORCE_INTERACTIVE must stay for the session-trust `if (!forceInteractive)` gate.

---

### 2. server forceConfirm `[inspected]`

**Live path:** `companion/src/server.ts` ~1461–1472

```ts
const userFullAutonomy =
  auto_approve_dangerous && auto_approve_enterprise_tools && allow_all_schemes
const forceConfirm = criticalApis.length > 0 && !userFullAutonomy
```

**Removed:** `(browserScriptTool && skipConfirmation)` waiver.

**Interaction with `skipConfirmation`:** gate remains

```ts
if ((!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip)
```

| Scenario | skipConfirmation | forceConfirm | Confirm? |
|----------|------------------|--------------|----------|
| god-mode alone + critical `evaluate` | true (`allow_all_schemes`) | **true** | yes |
| auto_approve_dangerous alone + critical | true | **true** | yes |
| domain whitelist + critical | true | **true** | yes |
| god-mode alone + non-critical dangerous | true | false | **no** (auto) |
| three-flag cruise + critical | true | **false** | no (waived + audited) |
| default + critical | false | true | yes |

**Regression for non-critical god-mode auto_approve:** intentionally preserved. Test `M3' §6.2.9: god-mode + non-critical dangerous (innerHTML) → auto_approved` still asserts skip + `reason:"god_mode"`. **No regression on that axis.**

**Pre-existing (not introduced):** `userFullAutonomy` still clears forceConfirm for *all* `criticalApis` including capability tokens (`shell_exec`, `skill_install`, `spawn_worker`, `ask_user`, `board_complete`, `host_cli`). Cruise still relies on other paths (enterpriseSkip, tool implementation) where applicable. Comment “god-mode never skips host_cli/skill_install” remains true for **god-mode alone**; three-flag cruise is the explicit residual-risk product choice. Out of scope for this fix’s delta, but worth not re-opening as a false new finding.

---

### 3. open_intents_by_run + resolveOpenIntentsForRun `[inspected]`

**Companion emit:** `companion/src/orchestrator/fleet.ts` ~112–143

- Iterates non-worker hosts with `mission_board` / `board_mode`, `seenHosts` de-dupes by host thread id.
- `open_intent_count += n` always.
- `open_intents_by_run[rid] += n` only when host has non-empty `orchestrator_run_id` and `n > 0`.
- `countOpenIntents` resolves host via `resolveBoardHostThreadId` (worker → parent; host → self). **No double-count** of the same board via two host ids in normal topology; two distinct hosts with boards sum legitimately.

**WS hydrate:** `useWebSocket.ts` fleet.status — object (non-array) filtered to `Record<string, number>`. Missing field → `undefined` → helper treats as 0 when `runId` set (fail toward *not* sticky busy). Correct for mixed-version companions.

**Call-site consistency (claimed):**

| Site | Uses `resolveOpenIntentsForRun` | `anyHoldingTabs` run-scoped when `runId` |
|------|--------------------------------|----------------------------------------|
| `App.tsx` InputArea / composer | yes | yes |
| `ChatView.tsx` runBusyInput | yes | yes |
| `RunBusyChip.tsx` | yes | yes |
| `useWebSocket.ts` | hydrates map | n/a |

Helper semantics:

```ts
if (!runId) return openIntentCount ?? 0
return openIntentsByRun?.[runId] ?? 0   // NO global fallback
```

Matches SoT claim. Sticky false RunBusy from *another* run’s board intents is fixed when active thread has a run id.

#### Hunt: host without `orchestrator_run_id` “loses” intents

- Those intents remain in process-wide `open_intent_count`.
- They never appear in `open_intents_by_run`.
- Active thread **with** `runId`: correctly does **not** inherit them (desired non-sticky).
- Active thread **without** `runId` (board-only host, pre-spawn): still uses global count → still process-wide sticky, including other runs.

Not a double-count bug; residual incomplete isolation for the no-`runId` UI state. Spawn path assigns parent `orchestrator_run_id` on first worker (`spawn.ts`), so multi-agent runs after spawn are covered. Board-only / pre-spawn hosts remain on the old global path.

#### Hunt: double-count open intents

- UI never adds `open_intent_count + open_intents_by_run[runId]`.
- Map values are exclusive per run key; sum(map) ≤ global (strict `<` when any host lacks rid).
- **No double-count** on the new path.

#### Hunt: `anyHoldingTabs` still process-wide

- **RunBusy derivation:** scoped when `runId` in all three sites above.
- When `!runId`: intentionally process-wide (same as locks/llm fallback).
- Intermediate `const anyHoldingTabs = workers.some(...)` in App is only used as the `!runId` branch; not a leak into run-scoped derive.

#### Residuals outside claimed call sites (sticky chrome)

| Site | Still process-wide `open_intent_count`? | Impact |
|------|----------------------------------------|--------|
| `FocusBand.tsx` `classifyFleetActivity` | yes | Fleet can still claim FocusBand primary from another run’s intents |
| `FleetStrip.tsx` badge/meta | yes | Global fleet strip (arguably intentional) |
| `ChatView` `fleetProcessingLabel` | yes | Processing footer can still show “N intent” from other runs while `deriveRunBusy` is false |

These do **not** re-break composer lock / RunBusyChip truth for run-scoped threads, but they are incomplete sticky-UX cleanup if SoT meant all chrome.

---

### 4. Tests assessment `[inspected]`

| Suite | What it proves | Gaps / false confidence |
|-------|----------------|-------------------------|
| `security-gates.test.ts` | god-mode **alone**, auto_approve alone, domain whitelist → critical still forceConfirms; three-flag cruise evaluate + shell skip; non-critical god-mode still auto | `beforeEach` resets `allow_all_schemes` + `auto_approve_dangerous` but **not** `auto_approve_enterprise_tools` → mild cross-test pollution (usually still not three-flag) |
| `computer-executor.test.ts` | cruise does **not** auto-approve `danger_detected` | **No** cruise×`foreground_yielded` / `experimental_suggestion`; **no** positive “budget under cruise still auto-approves” (proves cruise silence not accidentally inverted) |
| `session-trust-v4.test.ts` (pre-existing) | empty tags / unknown / foreground PROMPT_ALWAYS at predicate level | Does not exercise executor cruise branch end-to-end |
| `thread-busy.test.ts` | helper no-fallback + null runId global | No React integration that App/ChatView/Chip wire the helper |
| `orchestrator-tab-lease.test.ts` | map scopes run-a vs run-b | **No** host without `orchestrator_run_id` (global vs map divergence) |

**False confidence summary:** Negative security reverts are strong. Cruise reordering is only half-proven (danger still prompts); silence path for routine tags under cruise is not re-asserted after the gate move.

---

## Findings

### F1 [LOW] — Residual process-wide intent chrome (FocusBand / processing label)

- **Files:** `FocusBand.tsx` (~56), `ChatView.tsx` processingLabel (~126), `FleetStrip.tsx` (~36)
- **Evidence** `[inspected]`
- **Issue:** After RunBusy is run-scoped, FocusBand can still light “fleet active” and chat footer can still suffix intent counts from foreign runs.
- **Risk:** UX inconsistency / residual sticky attention, not composer hard-lock false busy.
- **Fix (optional):** Route those labels through `resolveOpenIntentsForRun` when `activeThread.orchestrator_run_id` is set; keep FleetStrip global if product wants process fleet overview.

### F2 [LOW] — Hosts without `orchestrator_run_id` only in global counter

- **File:** `fleet.ts` ~123–129
- **Evidence** `[inspected]`
- **Issue:** Intents on board hosts that never received a run id never enter `open_intents_by_run`. UI with `runId` ignores them (good); UI without `runId` still process-wide sticky (pre-existing class).
- **Risk:** Board-only / pre-spawn hosts keep old sticky behavior across concurrent boards.
- **Fix (optional):** Attribute orphan-host intents under a stable pseudo-key (e.g. host thread id) or mint run ids when board is created; add fleet unit test for rid-less host.

### F3 [LOW] — Missing cruise positive + `foreground_yielded` under cruise tests

- **Files:** `computer-executor.test.ts`
- **Evidence** `[inspected]`
- **Issue:** Only “cruise does not auto-approve danger” was added. No assertion that budget/dialog still auto under three-flag cruise; no executor-level cruise×`foreground_yielded` (logic relies solely on `reL2ShouldPrompt` unit tests).
- **Risk:** Future reordering of `forceInteractive` / condition polarity could re-break silence or PROMPT_ALWAYS without CI catching both sides.
- **Fix:** Add (1) budget-exhausted under cruise → 0 confirms / task continues; (2) foreground_yielded under cruise → still surfaces.

### F4 [NIT] — Dual flag sets for reL2 (maintainability)

- FORCE_INTERACTIVE ⊂ PROMPT_ALWAYS today; cruise could use `!reL2ShouldPrompt` alone.
- Prefer single SoT to prevent future “half-updated set” bugs.

### F5 [NIT] — security-gates `beforeEach` incomplete security reset

- Does not clear `auto_approve_enterprise_tools`. Unlikely to create full cruise alone, but weakens isolation after full-autonomy tests.

---

## What is solid (do not regress)

1. **No global fallback when `runId` set** in App / ChatView / RunBusyChip — sticky false RunBusy from foreign board intents fixed at the gate that drives composer + chip. `[inspected]`
2. **Critical forceConfirm** restored for domain whitelist / god-mode / auto_approve alone; M3' domain≠content invariant back; three-flag cruise explicit waive + audit. `[inspected]`
3. **Non-critical under god-mode** still auto_approves (innerHTML test retained). `[inspected]`
4. **reL2 empty/unknown tags** fail-closed under both cruise and session trust via `reL2ShouldPrompt`. `[inspected]`
5. **`anyHoldingTabs` / locks / llm ids** already run-scoped alongside the new intent helper when `runId` is known. `[inspected]`
6. **WS validation** of `open_intents_by_run` rejects arrays / non-number values. `[inspected]`

---

## Residual / open questions

1. Should FleetStrip remain process-wide by design (global cockpit) while RunBusy is run-scoped? Product call; not a logic bug either way.
2. Confirm product still wants three-flag cruise to waive **capability** forceConfirm (`skill_install`, `ask_user`, …) — pre-existing, not introduced; security lane concern if reopened.
3. This lane did **not** execute test binaries; CI/`node --test` on the four suites should still be run before merge.

---

## Verdict rationale

Claimed correctness fixes are **complete on their stated surfaces** and **consistent across App / ChatView / RunBusyChip / useWebSocket**. Adversarial hunts (intent loss, dual flags, process-wide holding tabs, double-count, empty-tag cruise, non-critical god-mode regression) did **not** find a merge-blocking inversion. Remaining items are residual chrome stickiness, board-without-run-id isolation, and test polarity gaps — track as nits, not rework of the core patches.

**Recommendation: APPROVE_WITH_NITS**

Prefer landing F3 tests in the same PR if cheap; F1–F2 acceptable as follow-ups unless SoT explicitly required all intent chrome to be run-scoped.

---

## Severity index

| ID | Severity | Topic | Blocks merge? |
|----|----------|--------|---------------|
| — | CLEAR | reL2 cruise + forceInteractive + reL2ShouldPrompt ordering | No |
| — | CLEAR | forceConfirm only under !userFullAutonomy | No |
| — | CLEAR | open_intents_by_run + no global fallback when runId | No |
| — | CLEAR | non-critical god-mode auto_approve preserved | No |
| F1 | LOW | FocusBand / footer still process-wide intents | No |
| F2 | LOW | Host sans run_id only in global counter | No |
| F3 | LOW | Missing cruise positive + fg_yielded×cruise tests | Soft (CI confidence) |
| F4 | NIT | Dual FORCE_INTERACTIVE / PROMPT_ALWAYS sets | No |
| F5 | NIT | beforeEach enterprise flag leak | No |

**Evidence tags:** Findings F1–F5 `[inspected]`. Execution of targeted suites: not run this session (`[assumed]` green only if CI matches source).

---

**VERDICT: APPROVE_WITH_NITS**
