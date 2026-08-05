# Multi-Adversarial Code Review — run-state review-bugs fix

**Date**: 2026-08-05  
**Branch**: `fix/run-state-review-bugs` (uncommitted working tree)  
**Base**: `origin/main` @ `4a2d02f`  
**Blast tier**: **T3** (Trust / confirm floors / full-autonomy cruise)  
**Method**: 4 independent adversarial lanes in parallel (Security / Correctness / Architecture / Compat)  
**Orchestrator**: Grok Build · Eval Engineering gate v1.1  
**Diff artifact**: [`run-state-review-bugs-diff-20260805-090257.patch`](run-state-review-bugs-diff-20260805-090257.patch)

**Lane reports**:
- [`run-state-review-bugs-lane-security-20260805.md`](run-state-review-bugs-lane-security-20260805.md)
- [`run-state-review-bugs-lane-correctness-20260805.md`](run-state-review-bugs-lane-correctness-20260805.md)
- [`run-state-review-bugs-lane-architecture-20260805.md`](run-state-review-bugs-lane-architecture-20260805.md)
- [`run-state-review-bugs-lane-compat-20260805.md`](run-state-review-bugs-lane-compat-20260805.md)

**Origin**: Post-merge re-review of PR #117 findings (Issues 1–3) fixed on a new branch after `feat/run-state-worker-drilldown` was deleted.

---

## Lane verdicts

| Lane | Status | Recommendation |
|------|--------|----------------|
| Security | WATCH | **APPROVE_WITH_NITS** |
| Correctness | WATCH | **APPROVE_WITH_NITS** |
| Architecture | WATCH | **APPROVE_WITH_NITS** |
| Compat/Platform | WATCH | **APPROVE_WITH_NITS** |

## Final synthesis

| Field | Value |
|-------|--------|
| **Architectural status** | WATCH |
| **Internal multi-lane** | **APPROVE_WITH_NITS** (no HIGH open bypass; no REQUEST_CHANGES) |
| **Merge-ready (post dual)?** | Pending Claude+Pi dual-external-review |
| **Product ship / default-on?** | N/A — restore floors, not new default-on |
| **UX note required?** | Yes — god-mode alone / domain whitelist alone no longer skip critical evaluate |

### Deterministic merge gate (internal)

- Architect ≠ BLOCK  
- Security has **no HIGH** residual partial-flag bypass → multi-lane **APPROVE_WITH_NITS**  
- Correctness / Compat agree: claimed fixes complete; residual nits non-blocking  
- **T3 still requires dual Claude+Pi** before merge claim  

### Evidence levels

- Lanes: primarily `[inspected]` live source + patch  
- Orchestrator machine re-check `[executed]` (2026-08-05):
  - security-gates M3'/full-autonomy pattern: **10/10 pass**
  - computer-executor danger_detected (+ cruise): **2/2 pass**
  - fleet open_intents_by_run: **1/1 pass**
  - chrome-extension suite: **424/424 pass**

---

## Scope (what this fix claims)

| # | Claim | Primary files |
|---|--------|----------------|
| 1 | Full-autonomy cruise early-return does **not** waive force-interactive re-L2 (`danger_detected` / `experimental_suggestion`; also `reL2ShouldPrompt` for `foreground_yielded` / unknown) | `companion/src/computer/executor.ts` |
| 2 | Critical `forceConfirm` waived **only** under three-flag `userFullAutonomy` — not domain whitelist / god-mode alone / `auto_approve_dangerous` alone | `companion/src/server.ts` |
| 3 | RunBusy open intents are **run-scoped** when `orchestrator_run_id` known (`open_intents_by_run`; no global fallback) | `fleet.ts`, `thread-busy.ts`, App/ChatView/RunBusyChip, useWebSocket |

**Not claiming**: product ship of three-flag cruise as default-on; autopilot matrix copy refresh; full RunBusy builder extraction.

---

## Cross-lane agreed positives

1. **M3' domain ≠ content restored** for evaluate/osascript critical APIs under partial skips.  
2. **Cruise danger carve-out** correctly gates on `forceInteractive` + `reL2ShouldPrompt` before three-flag auto-approve.  
3. **Run-scoped intents** consistent across the three RunBusy consumers that drive composer/chip; intentional no-fallback avoids sticky false RunBusy.  
4. **Tests inverted** to match restored policy (god-mode alone forceConfirms critical); three-flag cruise still has positive waive path for evaluate critical + shell.

## Cross-lane nits (non-blocking, multi-mention)

| ID | Lanes | Summary |
|----|-------|---------|
| N1 | Sec F2, Arch F3 | Stale M3' **section banner** in `security-gates.test.ts` still describes old weaker policy (regression magnet) |
| N2 | Sec F3 | Stale host_computer comments overclaim “god-mode never skips” under three-flag |
| N3 | Corr F1, Arch F2 | FocusBand/FleetStrip still process-wide intents; RunBusy still triple-built |
| N4 | Corr F3, Sec F* | Missing cruise **positive** silent path test (budget) + cruise×`foreground_yielded` |
| N5 | Compat | Ship extension+companion together; release note for UX shock under single-flag unattended |
| N6 | Sec F1 | Three-flag cruise still broad capability waive (product residual, not this regression) |

## No open HIGH

No lane found a residual path where **only** domain whitelist / god-mode / auto_approve_dangerous skips critical evaluate forceConfirm after this fix.

---

## Capability declaration (implementer)

```text
Surface:      n/a (no new tools)
L2-classes:   (none new; restores critical forceConfirm floors)
Compose:      fleet snapshot additive field open_intents_by_run
Autonomy:     multi-worker RunBusy honesty; three-flag cruise residual elevation unchanged in breadth
Trust:        monotonic restore M3' domain≠content; danger re-L2 always HITL even under cruise
Channel:      community
```

---

## Next step

`scripts/dual-external-review.sh run-state-review-bugs docs/audit/reviews/_prompts/run-state-review-bugs-dual-review.md origin/main`

---

## Dual external re-review (Claude + Pi)

**Timestamp**: 20260805-091127  
**Script**: `scripts/dual-external-review.sh` (+ Claude re-run after first empty stdout)  
**Verdict JSON**: [`run-state-review-bugs-verdict-20260805-091127.json`](run-state-review-bugs-verdict-20260805-091127.json)

| Judge | Verdict | Path |
|-------|---------|------|
| Claude | **APPROVE_WITH_NITS** | [`run-state-review-bugs-claude-20260805-091127.md`](run-state-review-bugs-claude-20260805-091127.md) |
| Pi | **APPROVE_WITH_NITS** | [`run-state-review-bugs-pi-20260805-091127.md`](run-state-review-bugs-pi-20260805-091127.md) |
| **both_approve** | **true** | exit path green for T3 dual gate |

### Dual agreed
- Claims A/B/C verified with file:line + targeted tests executed
- No residual HIGH partial-flag critical bypass
- Trust monotonic restore (narrower than origin/main)
- Shared nits: stale M3' banner, comment drift, FocusBand process-wide intents, missing cruise positive silent tests

### Gate card
```
Blast tier: T3
MACHINE: PASS (security-gates 10 targeted + executor 2 + fleet 1 + extension 424)
ADVERSARY: APPROVE_WITH_NITS ×4 lanes
DUAL: APPROVE_WITH_NITS + APPROVE_WITH_NITS
MERGE: YES after nits filed or optional N1 banner fix — not blocked on HIGH
```
