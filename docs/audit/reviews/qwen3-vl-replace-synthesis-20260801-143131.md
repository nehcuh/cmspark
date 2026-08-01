# Dual-review synthesis: TinyClick → Qwen3-VL

**Date:** 2026-08-01 · **Batch:** `qwen3-vl-replace`  
**Reviewers:** Pi (`pi -p`) · Claude (`claude -p`)  
**Artifacts:**

| Role | Path |
|------|------|
| Prompt | `docs/audit/reviews/qwen3-vl-replace-dual-review-prompt-20260801.md` |
| Diff | `docs/audit/reviews/qwen3-vl-replace-diff-20260801-143131.patch` |
| Pi | `docs/audit/reviews/qwen3-vl-replace-pi-20260801-143131.md` |
| Claude | `docs/audit/reviews/qwen3-vl-replace-claude-20260801-143131.md` |
| Verdict JSON | `docs/audit/reviews/qwen3-vl-replace-verdict-20260801-143131.json` |

## Lane verdicts

| Lane | Verdict | Confidence |
|------|---------|------------|
| **Pi** | **APPROVE_WITH_CHANGES** | 86% |
| **Claude** | **APPROVE_WITH_NITS** | 82% |
| **Synthesis (stricter wins)** | **APPROVE_WITH_CHANGES** | — |

## Agreement

Both lanes agree:

1. **R1–R6 rejection gates hold** — re-L2 experimental gate, settings dual belt, license door rewritten for Qwen, `set_variant` disposes session.
2. **Architecture direction is right** — HF download + Python worker + catalog/UI resource tips.
3. **Coordinate heuristic is risky** on wide screens (Pi: blocking; Claude: high nit).
4. **Coverage thinned** on admission/handlers safety matrices; runtime/download/worker untested.
5. **Progress / disk budget** effectively decorative on the new path.
6. **Naming residue** (`tinyclickLocator`, denial `layer: "tinyclick"`).

## Blocking union (must fix before merge-ready)

| ID | Source | Issue | Fix direction |
|----|--------|-------|---------------|
| **B1** | Pi | `spawn` without `error` handler → companion crash if python missing at **infer/load** (not only download) | Add `child.on("error")` → reject pending with `ModelRuntimeError`; never unhandled |
| **B2** | Pi (+ Claude) | `_normalize` 0–1000 heuristic remaps **absolute pixel** coords on width>1000 | Prefer absolute when coords within image bounds; only treat as 0–1000 when clearly relative; add unit tests |
| **B3** | Pi | Extension mirror-interlock test fails; companion `MODEL_SWITCH_COPY` still says TinyClick | Sync extension test + companion `model-state-messages.ts` with new Qwen copy |

## Shared nits (fix soon)

1. Wire or drop HF download progress UI.  
2. Re-enforce `modelDiskBudgetMB` or remove claim.  
3. Align executor denial layer label to `qwen-vl`.  
4. Restore critical admission/handlers mutex / set_enabled tests.  
5. Document `trust_remote_code` + no sha256 pin as supply-chain decision; update THIRD_PARTY_NOTICES for Qwen.  
6. Runtime dispose: SIGTERM then SIGKILL grace.

## Synthesis recommendation

**Do not treat as merge-ready until B1–B3 are fixed.**  
After that, remaining items can ship as follow-up nits under `APPROVE_WITH_NITS`.

## Next step options

1. **Fix B1–B3 now** in this branch (recommended).  
2. Fix only B1 (crash) + B3 (CI) immediately; park B2 behind a “absolute-only coords” prompt change.  
3. Open issues for B1–B3 and keep the dual-review artifacts as the gate log.
