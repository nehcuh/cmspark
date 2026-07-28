# Docs Reorg Phase1+2 Workflow Report

**Date:** 2026-07-28  
**Branch:** `docs/reorg-phase12-0.3.0`  
**Plan:** [docs/docs-reorg-plan-2026-07-28.md](../../docs-reorg-plan-2026-07-28.md)  
**Diagnosis:** [docs/audit/diagnosis-fanout-2026-07-28.md](../diagnosis-fanout-2026-07-28.md)

---

## Outcome

| Gate | Result |
|------|--------|
| Phase1 implement | **DONE** |
| Phase1 internal adversarial | **PASS** (r2 after TESTING path fix) |
| Phase1 Claude + Pi | **both_approve** — Claude `APPROVE_WITH_NITS`, Pi `APPROVE` |
| Phase2 implement | **DONE** (README hub + `docs/README.md`) |
| Phase2 Claude + Pi | **both_approve** — Claude `APPROVE_WITH_NITS`, Pi `APPROVE` |
| Local negative checks | **PASS** |
| **Overall** | **ready_to_commit** (docs only; do not include site-knowledge WIP unless intentional) |

---

## Dual-review artifacts

| Batch | Verdict JSON |
|-------|----------------|
| docs-reorg-p1 | `docs/audit/reviews/docs-reorg-p1-verdict-20260728-111325.json` |
| docs-reorg-p2 | `docs/audit/reviews/docs-reorg-p2-verdict-20260728-125948.json` |

Claude/Pi markdown reviews co-located with same timestamp prefixes.

---

## Workflow incidents (and recovery)

1. **`docs-reorg-phase12` failed** at Phase1-ExternalReview: Rhai `fn run_external` could not capture outer `root` / schema → fixed by explicit `repo_root` param + schema-in-fn.
2. **`docs-reorg-phase12-continue` blocked** at Final-Gate after Phase2:  
   - p1 dual review **OK**  
   - Phase2 implement **OK**  
   - Phase2 adversarial / r2 / final agents hit **Grok CLI proxy stream errors** (`reqwest error … cli-chat-proxy.grok.com`) → treated as failed; workflow set `p2=false` fail-closed.  
3. **Manual continuation:** re-ran `scripts/dual-external-review.sh docs-reorg-p2 …` after local verify; both Claude and Pi approved. Applied minor nits (data tree `packs/`, Skills/Knowledge matrix anchors).

---

## Files changed (docs scope)

| Path | Change |
|------|--------|
| `README.md` | FAQ L2/Cockpit; stage 0.3.0; Node≥20; Swift tray+pairing; tiered capability matrix; short sections (security/MCP/packs/export/desktop/multi-agent/upload); TOC; data dir; related docs |
| `docs/GOAL.md` | G8 real multi-gate security (no live risk-engine/privilege-manager) |
| `docs/architecture.md` | §4 real module tree; phantoms removed; companion HMAC note |
| `docs/TESTING.md` | Full 0.3.0 test map (~120+ companion / ~25 extension) |
| `docs/adr/016-mission-board.md` | Status **Implemented (P0)** |
| `docs/README.md` | **NEW** documentation navigation |

**Out of scope (unrelated WIP still dirty in worktree):** `companion/**`, `chrome-extension/**` site-knowledge hostname batch — do not bundle into docs commit unless intended.

---

## Local verification (executed)

```text
rg 等待用户确认机制完成后开放 README.md     → empty
ADR-016 尚未实现产品代码                   → empty
GOAL live risk-engine+privilege-manager  → empty (historical disclaimer only)
docs/README.md                           → exists
links mcp / mission-pack / confirm-center / TROUBLESHOOTING / ADRs → exist
```

---

## Residual nits (non-blocking)

- architecture §4 uses ellipsis for some subtrees (reviewer note; acceptable compression).
- package.json lacks `engines.node` field (nit from p2-adv-nr; out of docs-only scope).
- Full user guides for CU / host / NotebookLM still Phase 3.

---

## Suggested next steps

1. Commit **docs-only** on `docs/reorg-phase12-0.3.0` (or split PR).  
2. Optional: abandon/resume-complete blocked workflow UI state (work already done).  
3. Phase 3–4 per reorg plan when ready (user guides + archive wave).

---

*Orchestration: `.grok/workflows/docs-reorg-phase12.rhai` + `docs-reorg-phase12-continue.rhai` + manual dual-review recovery.*
