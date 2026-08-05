# Security Lane
**Date:** 2026-08-05  
**Branch / scope:** `fix/run-state-review-bugs` uncommitted fixes vs `origin/main` (PR#117 review bugs)  
**Diff:** `docs/audit/reviews/run-state-review-bugs-diff-20260805-090257.patch`  
**Status:** WATCH  
**Recommendation:** APPROVE_WITH_NITS  
**Evidence mode:** patch + live source inspection `[inspected]`. Tests read; **not re-run** in this lane (`[inspected]`, not `[executed]`).

## Executive summary

This batch tightens three trust-adjacent surfaces. The **material security fix** is correct: critical `forceConfirm` is no longer waived by domain whitelist, god-mode alone, or `auto_approve_dangerous` alone. Only the three-flag full-autonomy cruise (`auto_approve_dangerous` ∧ `auto_approve_enterprise_tools` ∧ `allow_all_schemes`) waives it. Mid-task computer re-L2 under cruise no longer short-circuits `computer.danger_detected` / `computer.experimental_suggestion` (and still does not short-circuit `computer.foreground_yielded` via `reL2ShouldPrompt`). Run-scoped `open_intents_by_run` is primarily UI honesty for RunBusy (low auth impact).

No **HIGH** residual bypass of the intended M3' invariant was found in live source for partial flags. Residual risk is concentrated in (1) product-accepted three-flag residual blast radius, (2) stale comments/tests header that still describe the *old weaker* evaluate critical policy (regression magnet), and (3) dual tag sets / dual three-flag predicates that can drift.

**Do not rubber-stamp as “critical never auto-approves”** — under three-flag cruise, evaluate critical, host_computer initial L2, shell, and other capability-force tools all mint tokens without interactive confirm. That is explicit product residual risk, not a regression of this fix’s partial-flag tightening.

---

## Scope verification (what changed)

| Area | Claim | Live verdict |
|------|--------|--------------|
| `server.ts` forceConfirm | Waive only under three-flag `userFullAutonomy` | **FIXED** `[inspected]` `server.ts:1461-1472` — removed `browserScriptTool && skipConfirmation` carve-out |
| `executor.ts` reL2 cruise | Must not skip force-interactive danger/experimental | **FIXED** `[inspected]` `executor.ts:637-665` — cruise only when `!forceInteractive && !reL2ShouldPrompt(dangerous)` |
| Fleet / RunBusy | Open intents run-scoped via `open_intents_by_run` | **IMPLEMENTED** `[inspected]` `fleet.ts:112-143`, extension `resolveOpenIntentsForRun` |
| Tests | Assert stronger partial-flag policy | **Mostly FIXED** — body of M3' §6.2.9 tests inverted to forceConfirm; **section header still wrong** (F2) |

---

## Findings (F1…)

### F1 [MEDIUM] — Three-flag cruise still auto-mints L2 tokens for *all* capability-force tools (product residual, not partial-flag regression)

- **File:line**
  - `companion/src/server.ts:1461-1472` — `forceConfirm = criticalApis.length > 0 && !userFullAutonomy`
  - `companion/src/server.ts:1540` — confirm block only if `(!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip`
  - `companion/src/server.ts:2176-2180` — skip path still `issueTokenFor` → executor accepts token
  - Capability force set: `shell_exec`, `netsec_port_scan`, `spawn_worker`, `ask_user`, `board_complete`, `host_cli`, `skill_install`, plus `host_computer` synthetic `computer.coordinate_injection`, plus `detectCriticalApis(code)` for evaluate/osascript
- **Evidence** `[inspected]`
- **Attack path (when user has armed full cruise)**
  1. User enables three flags (Settings / `config.json` / `security.unattended.arm` with `include_protocol=true` → `message-router.ts:2291-2297`).
  2. Prompt-injected or unattended agent calls `evaluate` with `fetch(…+document.cookie)`, or `host_computer` with destructive click sequence, or `spawn_worker` / `skill_install`.
  3. `skipConfirmation=true`, `forceConfirm=false` → no Confirm Center; token minted; tool runs.
  4. For host_computer, mid-task `danger_detected` / `experimental_suggestion` / `foreground_yielded` still re-prompt (F1 is about *initial* gate + non-CU tools).
- **Risk**
  - Residual blast radius is **large** but **user-opted** and **pre-existing** under three-flag (this PR only removed the partial-flag browserScript waive).
  - Asymmetry: MCP critical (`forceMcpConfirm`) is **not** waived by three-flag (`server.ts:4609-4621`) while evaluate critical is — confusing threat model, not a new hole.
  - Comments still say “spawn_worker / ask_user / board_complete: real HITL” and “host_cli / skill_install: god-mode never skips” — true for god-mode **alone**, false under three-flag.
- **Fix / product decision**
  - If three-flag is meant only for browser+enterprise+scheme cruise: carve HITL-hard tools (`spawn_worker`, `ask_user`, `board_complete`, `skill_install`, optionally `host_cli` / initial `host_computer`) out of the waive (keep `forceConfirm` true regardless of `userFullAutonomy`).
  - Else: document composite cruise warning in `config.ts` and Settings UX; fix comments so “never skips” is scoped to partial flags only.
- **Blocks merge?** No for *this* PR’s stated intent (partial-flag tighten). Track as residual risk / product ADR.

### F2 [MEDIUM] — Stale M3' test section header still documents the *weaker* (pre-fix) evaluate policy

- **File:line**
  - `companion/tests/integration/security-gates.test.ts:737-743`
  ```
  // Product 2026-08: when skipConfirmation is already true (god-mode /
  // auto_approve_dangerous / domain whitelist), evaluate/osascript_eval NO LONGER
  // forceConfirm on critical APIs — user full-open means full-open for browser
  // script tools. shell/host_computer/spawn still force HITL under god-mode.
  ```
- **Evidence** `[inspected]` — **contradicts** live tests immediately below (god-mode alone + fetch still forceConfirms) and live `server.ts:1470-1472`.
- **Risk**
  - Maintainers / future “align code to comments” will reintroduce `browserScriptTool && skipConfirmation` waive — exact regression this PR closes.
  - Not a runtime hole today; regression magnet for T3 surface.
- **Fix**
  - Rewrite header to: partial flags **forceConfirm** critical; only three-flag cruise waives; shell/host_computer/spawn force HITL under god-mode **alone**.

### F3 [MEDIUM] — Stale host_computer gate comments overclaim “god-mode never skips / every task”

- **File:line**
  - `companion/src/server.ts:997-1000` — “task-level L2 dialog is shown EVERY task (god-mode / auto-approve do NOT skip it)”
  - `companion/src/server.ts:1110-1113` — “shown on every task, god-mode included (forceConfirm below), never trusted”
- **Evidence** `[inspected]` — under three-flag, `forceConfirm=false` and `skipConfirmation=true` → initial host_computer L2 **is** skipped (token auto-mint). Mid-task reL2 still protects danger/experimental after this PR.
- **Risk**
  - Operators reading comments believe god-mode/auto still force CU task dialog always; under full cruise that is false.
  - Severity MEDIUM as **threat-model honesty**, not as partial-flag bypass.
- **Fix**
  - Comment: god-mode / auto_approve **alone** still forceConfirm; three-flag cruise waives initial task L2; reL2 PROMPT_ALWAYS tags never cruise-skip.

### F4 [LOW] — Dual interactive-tag sets can drift (`FORCE_INTERACTIVE_DANGEROUS` ⊂ `PROMPT_ALWAYS_TAGS`)

- **File:line**
  - `executor.ts:89-92` — `FORCE_INTERACTIVE_DANGEROUS` = `{danger_detected, experimental_suggestion}` only
  - `session-trust.ts:117-121` — `PROMPT_ALWAYS_TAGS` also includes `foreground_yielded`
  - Cruise gate: `!forceInteractive && !reL2ShouldPrompt(dangerous)` (`executor.ts:644`) — **currently correct** for foreground
- **Evidence** `[inspected]`
- **Risk**
  - If a future cruise path checks only `forceInteractive`, `foreground_yielded` would auto-approve under cruise → inject into foreign foreground window.
  - Session-trust path already uses both; cruise uses both today. Maintainability / dual-source of truth.
- **Fix**
  - Single shared set (export `PROMPT_ALWAYS_TAGS` / use only `reL2ShouldPrompt`), or expand `FORCE_INTERACTIVE_DANGEROUS` to match PROMPT_ALWAYS.

### F5 [LOW] — Dual three-flag predicates (`userFullAutonomyCruise` vs `userFullAutonomy`)

- **File:line**
  - Cookie path: `server.ts:860-863` `userFullAutonomyCruise`
  - L2 path: `server.ts:1461-1464` `userFullAutonomy`
  - Same three fields, two names, no shared helper
- **Risk**
  - Drift if one path adds a fourth flag or relaxes equality; cookie trust waive and forceConfirm waive would diverge.
- **Fix**
  - One helper e.g. `isFullAutonomyCruise(sec)` used by both (and by executor cruise read).

### F6 [LOW] — `config.ts` god-mode warning is now accurate for partial flags, but missing composite cruise warning

- **File:line**
  - `config.ts:901-902` — claims CRITICAL still require confirmation under god-mode (**true after this fix**)
  - No warn when all three flags true that critical *is* waived
- **Risk**
  - Operator who arms unattended with protocol thinks only non-critical is open; actually evaluate critical + host_computer initial + shell path can zero-confirm.
- **Fix**
  - On saveConfig when three flags true, log explicit `full_autonomy_cruise` WARNING listing waived surfaces.

### F7 [LOW] — Test gaps (policy coverage, not failing assertions)

| Gap | Why it matters |
|-----|----------------|
| No cruise test for `computer.experimental_suggestion` | Same `forceInteractive` path as danger; danger covered, experimental not |
| No cruise test for `computer.foreground_yielded` | Relies on `reL2ShouldPrompt` not FORCE set |
| No negative tests for two-flag combos (auto+god without enterprise; enterprise+god without auto) still forceConfirm on evaluate critical | Documents invariant against accidental 2-of-3 waive |
| No integration test: host_computer under god-mode **alone** still forceConfirms initial L2 | Comment claims it; no live gate test found |
| open_intents: hosts with board but empty/missing `orchestrator_run_id` contribute to `open_intent_count` only — with `runId` set, `resolveOpenIntentsForRun` returns 0 for them | UX undercount, not auth bypass |

### F8 [LOW] — RunBusy `open_intents_by_run` security posture

- **File:line**
  - `fleet.ts:112-143`, extension `thread-busy.ts:111-118`, WS parse in `useWebSocket.ts`
- **Evidence** `[inspected]`
- **Risk**
  - Not an authorization surface: snapshot is companion-built; extension sanitizes numbers. Wrong busy state can hide/show stop UX → availability/operator confusion only.
  - Fallback when `runId` null uses process-wide count (sticky busy) — safer-for-busy than false idle; when `runId` set, missing map key → 0 (possible false idle if host lacks run id). Acceptable for SoT §2.1 intent of this fix.

### F9 [INFO / residual, out of PR regression] — Other skip paths still bypass forceConfirm without three-flag (by design)

| Path | Mechanism | Scope |
|------|-----------|--------|
| `enterpriseSkip` | Global enterprise flag or session trust after scope ∩ | shell / netsec only (`familyOfTool`) |
| `hostComputerTrustSkip` | G1 corpus subset + explicit opt-in, or unattended grant | host_computer initial L2 only |
| Token strip | LLM-supplied `security_token` stripped before gate (`server.ts:619+`) | prevents self-approve |

These are **not** reintroduced by this PR. enterpriseSkip remains sibling of forceConfirm (G1): enterprise alone can skip shell L2 without three-flag — intentional ADR-014.

---

## Path-by-path adversarial matrix (partial flags)

| Scenario | skipConfirmation | forceConfirm (live) | Confirm shown? |
|----------|------------------|---------------------|----------------|
| Default | false | true if critical | Yes |
| Domain whitelist + evaluate `fetch` | true | **true** (fixed) | Yes |
| God-mode alone + evaluate `fetch` | true | **true** (fixed) | Yes |
| `auto_approve_dangerous` alone + eval | true | **true** (fixed) | Yes |
| God-mode + non-critical `innerHTML` | true | false (no critical) | No (by design) |
| Three-flag + evaluate `fetch` | true | **false** (product) | No + `critical_api_waived` |
| Three-flag + shell | true | false / enterprise also | No |
| God-mode alone + shell | true | true (capability) | Yes (unless enterpriseSkip) |
| Three-flag + host_computer initial | true | false | No |
| God-mode alone + host_computer initial | true | true | Yes |
| Cruise reL2 `danger_detected` | n/a | n/a | **Yes** (fixed) |
| Cruise reL2 `budget_exhausted` | n/a | n/a | No if three-flag |
| MCP critical under three-flag | n/a | forceMcpConfirm | **Yes** (still) |

---

## Residual risks

1. **Full autonomy cruise** is a large residual capability surface (evaluate critical, CU initial task, shell, spawn, skill write). Must remain **hard** to enable (phrase + dual-ack for unattended arm; packs forbid keys — `FORBIDDEN_PACK_KEYS` includes all three). Sticky flags after disarm without `clear_cruise` remain an operator footgun (pre-existing).
2. **Comment / test-header drift (F2–F3)** is the most likely path to reintroduce the PR#117 bug.
3. **Regex `detectCriticalApis`** remains best-effort (obfuscation outside the table). Out of scope; unchanged.
4. **TOCTOU** on security flags between confirm enqueue and response is pre-existing single-threaded Node; not introduced here.
5. **MCP vs evaluate** three-flag asymmetry may push agents toward browser exfil under cruise rather than MCP — residual product.

---

## Machine checks

| Check | Result |
|-------|--------|
| Read patch | Yes — full `run-state-review-bugs-diff-20260805-090257.patch` |
| Live `server.ts` forceConfirm block | Yes — lines ~1380–2180 |
| Live `executor.ts` reL2 | Yes — lines ~636–713, emit sites |
| Live `session-trust` PROMPT_ALWAYS | Yes — lines ~117–158 |
| Live `fleet.ts` open_intents_by_run | Yes — lines ~112–147 |
| Extension resolveOpenIntentsForRun | Yes — `thread-busy.ts` + App/ChatView/RunBusyChip/useWebSocket |
| Re-ran unit/integration tests | **No** — prefer inspect unless easy; recommend CI run of `companion/tests/integration/security-gates.test.ts` + `computer-executor.test.ts` + `orchestrator-tab-lease.test.ts` + `chrome-extension/tests/thread-busy.test.ts` before merge |
| Evidence tags | All claims above `[inspected]` unless noted |

---

## Verdict rationale

- **Not BLOCK / REJECT:** No open HIGH partial-flag bypass; the review-bug fixes close the intended holes; tests for god-mode alone / domain whitelist / auto alone were inverted to stronger policy; cruise danger re-L2 covered by new unit test.
- **Not bare APPROVE:** F2 stale inverted policy text in security-gates is a real regression magnet; F1/F3 product residual and comment honesty need tracking; dual tag/predicate sets (F4–F5) are nits.
- **APPROVE_WITH_NITS + WATCH:** Ship the security tightening; fix F2 header (and preferably F3 comments + F6 composite warn) in the same PR or an immediate follow-up before treating M3' docs as source of truth.

---

## VERDICT: APPROVE_WITH_NITS

**Status: WATCH** — partial-flag critical gate and CU force-interactive re-L2 under cruise are correct in live source; residual is three-flag product residual + documentation/test-header drift, not an unfixed partial-flag bypass.
