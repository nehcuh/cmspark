I have completed a full independent re-review. Summary of my verification:

## Claims verification (confirmed with file:line + executed tests)

**Claim 1 — cruise does not swallow danger/experimental re-L2.** CONFIRMED. `companion/src/computer/executor.ts:640-656`: the three-flag auto-approve block is gated on `!forceInteractive && !reL2ShouldPrompt(dangerous)`. `FORCE_INTERACTIVE_DANGEROUS` (`executor.ts:89-93`) covers `danger_detected`/`experimental_suggestion`; `reL2ShouldPrompt` (`session-trust.ts:151-155`) additionally covers `foreground_yielded` and fail-closed unknown tags. Executed: `executor P0-C: full autonomy cruise does NOT auto-approve computer.danger_detected` passes.

**Claim 2 — critical forceConfirm only under three-flag.** CONFIRMED. `server.ts:1461-1472`: `forceConfirm = criticalApis.length > 0 && !userFullAutonomy`; the single L2 gate at `server.ts:1540` consumes it. The old `browserScriptTool && skipConfirmation` waive (any single-flag skip) is removed — strictly narrower. Executed: 6 inverted tests (god-mode alone, `auto_approve_dangerous` alone, domain-whitelist alone, `osascript_eval` god-mode alone → forceConfirm + deny) pass; three-flag cruise positive path (evaluate critical fetch + shell_exec) passes.

**Claim 3 — run-scoped intents, no global fallback.** CONFIRMED. `thread-busy.ts:107-117` (`openIntentsByRun?.[runId] ?? 0` when runId set); `fleet.ts:113-132` builds `open_intents_by_run` (open+claimed per host run id); `useWebSocket.ts:589-599` sanitizes; all three consumers (App.tsx:343, ChatView.tsx:104, RunBusyChip.tsx:51) scope runId consistently. Tests pass.

**Claims 4/5.** CONFIRMED. Security-gates 57/57; executor+tab-lease 178/178 (clean config); extension 424/424.

## Residual-bypass hunt — no HIGH found
- Partial-flag critical evaluate: closed (code + tests).
- Cruise×danger/experimental: closed; `foreground_yielded` still prompts.
- `enterpriseSkip`: shell/netsec families only (`enterprise-session-trust.ts:37-40`); scope checks run first; evaluate never in a family.
- `hostComputerTrustSkip`: computer-use G1/unattended grant only — separate designed trust (corpus-subset + budget caps + experimental block), untouched by this diff.
- Host-without-`orchestrator_run_id` edge: un-run-attributed intents simply don't appear in any run's scoped count; intentional no-fallback per SoT §2.1 (honesty signal, not a gate). Minor.
- **Trust monotonicity:** strictly restorative — both the reL2 cruise and the evaluate critical waive are narrower than `origin/main`; no new elevation.

## Environmental note (not a diff regression)
The dev machine's `~/.cmspark-agent/config.json` has all three autonomy flags on, causing 12 pre-existing executor re-L2 failures (budget/uncrossverified/dialog) under ambient config. With a clean `CMSPARK_DATA_DIR` all 178 pass; the diff actually *fixes* the danger tests that previously failed under this config. The suite's non-hermeticity to ambient config is a test-hygiene nit.

## Nits (non-blocking)
- **N1:** stale M3' section banner `security-gates.test.ts:738-743` still documents the old weaker policy ("evaluate/osascript_eval NO LONGER forceConfirm on critical APIs") — contradicts restored policy and the inverted tests below it; regression magnet.
- **N2:** stale comments `server.ts:997-999`, `1110-1113` ("god-mode / auto-approve do NOT skip it", "shown on every task, god-mode included, never trusted") overclaim under three-flag cruise where forceConfirm is waived.
- **N3:** FocusBand/FleetStrip still use process-wide `open_intent_count`; only the three RunBusy consumers are run-scoped.
- **N4:** no positive cruise silent re-L2 test (budget) nor cruise×`foreground_yielded` executor test.
- **N5:** three-flag predicate duplicated (`executor.ts:649` re-reads config; `server.ts:1461`, `server.ts:860`) — drift risk.
- **N6:** tests depend on ambient `config.json` (three-flag machine config); not hermetic.

ADR-020 checklist: declaration present and accurate; axes fit (Trust restore + Autonomy run-honesty); no new tools/gates/confirm dialects; originWs request site unchanged; no new runtime.

VERDICT: APPROVE_WITH_NITS
