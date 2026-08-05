I have everything needed. Writing the verdict.

---

## Summary

Independent senior security + correctness + design-fidelity re-review of the run-state review-bugs diff (3 files core: `server.ts`, `executor.ts`, `fleet.ts` + `thread-busy.ts`; 4 consumers + 4 test files). All three product claims are correctly implemented at the cited file:line. No residual HIGH bypass found. 5 inverted M3' tests, 1 new positive cruise waive test, 1 new P0-C cruise danger test, and the run-scope fleet/UI tests all pass `[executed]`. Stale comment block in `security-gates.test.ts` (synthesis N1) and missing positive cruise×`foreground_yielded` test (N4) are non-blocking. Trust monotonicity under ADR-020 is restored.

## Claim verification

**A) Cruise does not auto-approve `danger_detected` / `experimental` re-L2 — VERIFIED ✓**

`companion/src/computer/executor.ts:641-644`:
```ts
const forceInteractive = dangerous.some((d) => FORCE_INTERACTIVE_DANGEROUS.has(d))
if (!forceInteractive && !reL2ShouldPrompt(dangerous)) { /* three-flag cruise skip */
```
`FORCE_INTERACTIVE_DANGEROUS` = `{danger_detected, experimental_suggestion}` (`executor.ts:89-92`). `reL2ShouldPrompt` (`session-trust.ts:151-158`) returns true for any tag in `PROMPT_ALWAYS_TAGS` (which adds `foreground_yielded`) and for any unknown tag (fail-closed). So cruise skip is gated by **two independent predicates**; the implementation is in fact stricter than the claim — `foreground_yielded` and unknown tags also block the cruise skip via `reL2ShouldPrompt`. Verified `[executed]`: new test `executor P0-C: full autonomy cruise does NOT auto-approve computer.danger_detected` passes (`computer-executor.test.ts:1420-1453`).

**B) Critical forceConfirm waived only under three-flag userFullAutonomy — VERIFIED ✓**

`companion/src/server.ts:1461-1472`:
```ts
const userFullAutonomy =
  securityConfig.auto_approve_dangerous === true &&
  securityConfig.auto_approve_enterprise_tools === true &&
  securityConfig.allow_all_schemes === true
...
const forceConfirm = criticalApis.length > 0 && !userFullAutonomy
```
The previous branch `(browserScriptTool && skipConfirmation)` is removed; `domain whitelist / god-mode / auto_approve_dangerous alone` no longer waive. The downstream gate `(!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip` at `server.ts:1540` keeps forceConfirm authoritative even when `skipConfirmation` is true. For evaluate / osascript_eval, `hostComputerGated=false` and `familyOfTool` returns null → `hostComputerTrustSkip` and `enterpriseSkip` cannot fire. Verified `[executed]`: 5 inverted M3' tests (`security-gates.test.ts:852-1057`) + `auto_approve_dangerous`-alone + domain-whitelist all force-confirm and deny; positive three-flag cruise waive at `security-gates.test.ts:1059-1086` passes with `critical_api_waived`+`full_autonomy_cruise` audit lines.

**C) Run-scoped open intents; no global fallback when runId set — VERIFIED ✓**

`chrome-extension/src/sidepanel/utils/thread-busy.ts:113-117`:
```ts
if (!runId) return openIntentCount ?? 0
return openIntentsByRun?.[runId] ?? 0
```
When `runId` is set and is absent from the map, returns 0 — never falls back to process-wide. Wire-level validation in `useWebSocket.ts:589-598` filters to `Record<string, number>` (defense-in-depth against companion JSON injection). All three RunBusy consumers (`App.tsx:343-347`, `ChatView.tsx:104-109`, `RunBusyChip.tsx:51-55`) pass `fleet?.open_intent_count`, `fleet?.open_intents_by_run`, and active `runId`. Companion side: `fleet.ts:113-127` populates the map only when `rid` is non-empty AND `n>0`. Verified `[executed]`: `resolveOpenIntentsForRun: with runId does not fall back to global` (`thread-busy.test.ts:197-201`) and `fleet open_intents_by_run scopes board intents by orchestrator_run_id` (`orchestrator-tab-lease.test.ts:347-393`) both pass.

## Residual hunt

Searched `companion/src` for `critical_api_waived` / `criticalApis.length > 0` / `forceConfirm` (`Grep`): single chokepoint at `server.ts:1472`. No other path silently drops critical forceConfirm.

- **`enterpriseSkip`** (`server.ts:1484-1537`): Plan A/B enterprise scope∩first carve-out for `shell_exec` / `netsec_port_scan` only — explicit ADR-014 G1 product residual, gated by scope check returning ok. Not a new hole; documented at `server.ts:1449-1451`.
- **`hostComputerTrustSkip`** (`server.ts:1125-1302`): only fires when `hostComputerGated` is true (`host_computer` tool, whose criticalApis is forced to `["computer.coordinate_injection"]`). This is ADR-021 session-trust / unattended grant — corpus-subset or explicit unattended mode — and is **the initial L2**, not the executor's danger re-L2. ADR-020 explicitly blesses this exception. Not a regression.
- **`host_computer` critical waive under three-flag cruise**: yes — `userFullAutonomy` waives `forceConfirm` for `host_computer` too. This is documented as "same three-flag gate" (`server.ts:1446-1448`) and matches the implementer's residual-elevation claim. Note the executor's re-L2 still gates danger under cruise (Claim A) — so the three-flag cruise opens the *initial* task L2 but not the *danger re-L2*. Trust packaging, not surface downgrade.
- **Host without `orchestrator_run_id` edge** (Claim C): if a host thread has open intents but no run_id, those intents contribute to `open_intent_count` only, not to any run bucket. When the active thread has a `runId`, those orphan intents are not counted in RunBusy — intentional (avoids sticky false-busy per synthesis) and conservative (under-reporting busy is strictly safer than false-positive sticky busy that the user can never clear). Nit-worthy at most.
- **Inverted M3' tests**: real — old assertions like `result.success === true` for `god-mode + critical fetch` are now `result.success === false`; new tests also assert `confirmation.critical_apis.includes("fetch")` to confirm the critical detection still triggers. Confirmed `[executed]`.

No residual HIGH bypass. The only forceConfirm waive under partial flags is via `userFullAutonomy` three-flag, which is the documented product residual.

## Nits

- **N1 (confirmed, multi-site)**: Stale section banner at `security-gates.test.ts:737-744` still says "Product 2026-08: when skipConfirmation is already true ... evaluate/osascript_eval NO LONGER forceConfirm on critical APIs" — directly contradicts the restored policy. Also stale inline at `security-gates.test.ts:719-720` ("critical payloads under god-mode also skip after 2026-08 product change (see M3' waive tests)"). Regression magnets for future readers; trivial 2-line comment update.
- **N2**: Stale `host_computer` comments overclaiming "god-mode never skips" without the three-flag caveat (per synthesis; not re-verified line-by-line in this pass).
- **N4 (test gap)**: No positive test that cruise **does** silent-approve a `reL2ShouldPrompt=false` reason (e.g., `budget_exhausted` / `task_induced_dialog`) under three-flag — the existing cruise tests cover evaluate forceConfirm and shell, not the executor's cruise silent path. Logic is verified `[inspected]` at `executor.ts:644-664`; a one-line test would close the gap. Also no cruise × `foreground_yielded` test (the prompt's hunting target — logic is correct via `reL2ShouldPrompt`, but untested).
- **N3 (out-of-scope)**: FocusBand / FleetStrip still consume process-wide intents; RunBusy still triple-built in App/ChatView/RunBusyChip. Pre-existing; not this PR's scope.
- **N6 (product residual)**: Three-flag cruise is broad capability waive (evaluate + osascript + shell + netsec + host_computer coordinate). The capability declaration acknowledges this; narrowing per-tool would be a separate initiative.

## ADR-020

Trust monotonicity **restored** — god-mode alone / auto_approve_dangerous alone / domain whitelist alone no longer silently skip critical evaluate forceConfirm (M3' domain≠content invariant). ADR-017 CU task-level L2 invariant preserved (`host_computer` initial L2 still every-task, never thread-trusted); ADR-021 unattended-session carve-out unchanged (initial L2 only; danger re-L2 always HITL — now also reinforced by the cruise carve-out at `executor.ts:644`). Capability declaration matches diff: Surface n/a, no new L2 classes, Compose additive `open_intents_by_run`, Autonomy RunBusy honesty, Trust monotonic restore, Channel community. No new Surface L2 / Composition / Autonomy elevation introduced; the only residual elevation is the pre-existing three-flag cruise, which is product-explicit.

VERDICT: APPROVE_WITH_NITS
