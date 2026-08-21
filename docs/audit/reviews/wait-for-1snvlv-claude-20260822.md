All verification complete. Here is my second-judge assessment.

---

# Dual re-review (second judge) — wait_for 1snvlv, post-fold tree

## Machine `[executed]` (re-run by me, not trusted from prompt)

| Gate | Result |
|------|--------|
| companion `tsc -p tsconfig.test.json` | **0** |
| companion targeted (wait-for-params, tool-schemas, bridge, security-thread, web-act-loop-wave1) | **130/130** |
| chrome `tsc --noEmit` + test tsc | **0** |
| chrome wait-for-mode | **7/7** |
| 1snvlv shape replay through compiled zod → normalize → resolver → classifyError | **ran** (below) |

## 1. Would the 1snvlv first-shot ⚠️ still happen?

**No.** Full replay on compiled artifacts `[executed]`:

```
tryParseToolArgs("wait_for", {tabId:1492094196}) → ok          // no selector|network_idle refine
normalizeWaitForParams → {tabId, network_idle:true}            // old unpacked ext takes its idle branch, no throw
resolveWaitForMode     → {kind:"network_idle", timeoutMs:12000, settleMs:2000}   // 14s < 15s WS
classifyError("WAIT_CONDITION_REQUIRED: selector or network_idle is required") → recoverable
classifyError("permission denied: selector or network_idle…")  → non_recoverable  // ordering intact
```

`create_tab` now waits under a 12s cap (browser-bridge.ts:488) — a hung page still returns `{id}` before the 15s WS timeout, which closes the orphan-tab retry hole. The 4ms non_recoverable throw path is unreachable for the incident shape in all four mixed-deploy combinations (inject for old ext, resolver default for new ext).

## 2. Adversary verdicts

| Adversary | Verdict | My ruling |
|-----------|---------|-----------|
| Runtime | APPROVE_WITH_NITS | **CONFIRM** — not over-loose. Its worst findings were fold-worthy and actually got folded: N1's hung-`create_tab`-no-tab-id → 12s cap; N2 dead `wait_for_load` → zod+catalog keep it; N4 ws-selector drift → stripped in normalize (verified: `"  "` → `{network_idle:true}` on both sides). |
| Product | APPROVE_WITH_NITS | **CONFIRM** — replay of Q1–Q6 holds on the current tree. Its non-blocking calls (timeout-is-a-cap not sleep; keep rule 6; keep opt-out out of the catalog in spirit) are correct product judgment. Note fold 5 chose to *document* `wait_for_load` rather than hide it — acceptable: default stays `true` and the description warns url/title may be empty with `false`, so it doesn't re-train the hollow-tab shape. |
| Trust | APPROVE_WITH_NITS | **CONFIRM** — independently verified: security/non_recoverable short-circuit before the new recoverable needles `[executed]`; `selectorJsLiteral` ≡ `JSON.stringify` `[inspected]` (selector-js-literal.ts:12-14), so the inlined literal at browser-bridge.ts:1539 is not a new CDP injection; diff is 13 on-claim files, no `security-confirmation` / `tool-forward` / `l2-admission` / config touch; `TAB_L2_TOOLS = {evaluate}` unchanged. |

No rubber-stamping detected: each adversary falsified claims with executed probes and surfaced real holes, and the fold addresses them.

## 3. Remaining nits — non-blocking?

- **SPA `complete` too early** — non-blocking. Degrades to recoverable `element_not_found`; rule 6 still teaches `wait_for({tabId, selector})`. Removing it would starve SPA hydrate.
- **`waitForTabLoad` always-success** — non-blocking, pre-existing (shared with `navigate`). Closed-tab during idle wait → false success → next tool fails recoverable no-tab. Cosmetic lie, not a gate skip.
- **CSS-only `wait_for`** — pre-existing, WAVE-1 parity scope. Interpolation verified safe.

**Post-fold nits I found in the current tree (new information, all non-blocking):**

1. **Catalog doc drift**: catalog `timeout` says “默认 15000” but code default/cap is 12_000 (wait-for-mode.ts:11). One-line fix.
2. **Selector-path timeout uncapped**: browser-bridge.ts:1532 uses raw `params.timeout` (no 12s cap) — `timeout:20000` selector poll still loses to the 15s WS timeout. Pre-existing; only the idle path was capped.
3. **Settle ceiling arithmetic**: 12s load + 5s max settle = 17s > 15s WS. Requires an explicit model `settle_ms ≥ 3000` on a full-duration load; default 2s is safe. Failure is a recoverable timeout.

## 4. ADR-020 checklist

| Check | Result |
|-------|--------|
| Declaration present + axes fit (Surface L1) | pass — `SURFACE_BY_TOOL` untouched; wait is tab/DOM semantics |
| Pack-first | N/A — no new scenario/UI chrome |
| Confirm dialects | pass — no new `securityConfirmations.request`; `suggested_action` is a recovery hint, not HITL |
| Trust monotonicity | pass — no Surface deepening; makes an already-catalog-legal call do the documented wait; ordering verified `[executed]` |
| originWs (P1-2) | pass — tool-forward.ts not in diff |
| No new runtime | pass — same tool loop |
| Experimental layers | pass — untouched |
| P1-1 god-mode / P1-3 evaluate / P1-4 shell | untouched |

## Summary

Outcome: 1snvlv ⚠️ dead on every mixed-deploy path, bounded at 14s < 15s WS. Trajectory: 13 on-claim files, fold verifiably landed, tripwire tests lock the no-refine invariant. Component: the weak spot is now only doc drift and pre-existing selector-path bounds, not the default. Gate order (MACHINE → adversary → this re-review) satisfied; implementer did not self-approve.

VERDICT: APPROVE_WITH_NITS
