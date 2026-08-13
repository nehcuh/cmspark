# Dual-review synthesis: coding-handoff residual nits (PR #186)

**Date:** 2026-08-13  
**Batch:** `acp-coding-handoff-residual-nits`  
**Verdict JSON:** [`docs/audit/reviews/acp-coding-handoff-residual-nits-verdict-20260813-154232.json`](../audit/reviews/acp-coding-handoff-residual-nits-verdict-20260813-154232.json)

| Reviewer | Verdict | Artifact |
|----------|---------|----------|
| Claude | **APPROVE_WITH_NITS** | [`…-claude-20260813-154232.md`](../audit/reviews/acp-coding-handoff-residual-nits-claude-20260813-154232.md) |
| Pi | **APPROVE_WITH_NITS** | [`…-pi-20260813-154232.md`](../audit/reviews/acp-coding-handoff-residual-nits-pi-20260813-154232.md) |
| Combined | **both_ok=true** | — |

**Scope:** residual nits after multi-agent acceptance of PR #185; delta `b23cb7a..61b0ffe` (PR #186).  
**Prompt:** [`_prompts/acp-coding-handoff-residual-nits-20260813.md`](../audit/reviews/_prompts/acp-coding-handoff-residual-nits-20260813.md)

---

## Consensus

1. **No blockers.** All five claimed residual nits (N1–N5) are **actually fixed** in code.
2. **Product locks still hold:** default-off ACP, L2 never cruise-skip, worker HARD_DENY, containment apply, C5 审查/起草, closed FocusBand chip, disclosure checkbox + L2 cloud note.
3. **Tests green** (ACP + `l2-admission-pure` executed by both reviewers).
4. **ADR-020:** Composition table + capability declaration adequate for this Composition-only delta.

---

## Shared nits (union · non-blocking)

| ID | Source | Topic | Suggested action |
|----|--------|-------|------------------|
| **RN1** | Both | Modal sends `cloud_disclosure_accepted` but server does not assert it; real gate is L2 confirm text | Optional: assert flag server-side, or drop dead field |
| **RN2** | Claude | L2 vs dispatch thread-id resolver asymmetry (fail-closed) | Share one resolver helper |
| **RN3** | Claude | Catalog “workspace override” overpromises (thread root wins) | Soften catalog wording |
| **RN4** | Claude | Taint list omits `acp_apply_diff` (harmless — always forceConfirm) | Optional symmetry |
| **RN5** | Pi | No unit test for WS confirm *string* contents (mode / allow_delete / cloud note) | Optional snapshot test |

**No REJECT path.** Residual nits do not reopen ship bar for #185/#186.

---

## Bottom line

> **both_ok**: residual-nits closeout dual-approved. Coding-handoff / ACP Client remains **APPROVE_WITH_NITS** at product level; no further blocking work required for this batch.
