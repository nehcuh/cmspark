# Dual review: coding-handoff residual nits closeout (PR #186)

## Context

PR **#185** shipped 编程接力 / ACP Coding Client (ADR-025). Multi-agent acceptance was **APPROVE_WITH_NITS**.  
PR **#186** (`fix/coding-handoff-residual-nits`) closes those residual nits and is **merged to main**.

You are an **independent adversarial** reviewer of the **residual-nits delta** plus lockstep of surrounding ACP gates. Do **not** rubber-stamp.

## Scope (read with tools)

### Diff base
- `git diff b23cb7a..HEAD` (or the attached patch file) — residual nits only after #185 merge tip.

### Must read current sources
| Area | Paths |
|------|--------|
| L2 force algebra | `companion/src/tool/l2-admission.ts` (`isAcpL2ForceTool`, `resolveL2ForceConfirm`, ACP preview strings) |
| Token binding | `companion/src/security-policy.ts` (`acp_propose` mode+ws, `acp_apply` del=) |
| Dispatch normalize | `companion/src/tool/companion-dispatch.ts` (`acp_propose_session`) |
| WS confirm | `companion/src/acp/handlers.ts` (start mode label + cloud note; apply allow_delete) |
| Catalog | `companion/src/bridge/tool-definitions-catalog.json` (mode / allow_delete props) |
| Tests | `companion/tests/l2-admission-pure.test.ts`, `acp-handback-workspace.test.ts`, `acp-handlers-gates.test.ts` |
| UX | `chrome-extension/.../CodingSessionChip.tsx`, `CodingTaskPackageModal.tsx`, `coding-handoff/copy.ts` |
| Docs | `docs/adr/025-*.md`, `docs/adr/020-*.md` Composition, `docs/decisions/acp-coding-handoff-product-design-2026-08-13.md` §0/§6/§8, user guide |

## Product locks (must still hold)

1. `acp.enabled` default **false**
2. `acp_propose_session` / `acp_start_session` / `acp_apply_diff` **always** L2; **never** cruise/god-mode skip
3. Workers **HARD_DENY** all `acp_*`; UI start refuses worker
4. Apply: workspace realpath containment; no free shell; no silent write
5. C5: user modes **审查/起草** — not OS sandbox 只读 claim
6. FocusBand keeps **closed** chip when applyable / follow-up needed
7. Cloud disclosure: UI checkbox required before ACP start (plus L2 confirm text)

## Residual nits claimed fixed — verify each

| ID | Claim |
|----|--------|
| N1 | L2 preview shows mode + workspace; apply preview shows allow_delete |
| N2 | Token binds mode + workspace on propose; L2+dispatch normalize before issue/validate |
| N3 | Unit tests: cruise cannot skip ACP forceConfirm |
| N4 | Product SoT + ADR-020: gated apply GO; silent write/shell still NO-GO |
| N5 | Mode badge on chip; cloud disclosure checkbox gates start CTA |

## Capability declaration

```text
Surface:      L0/L1 evidence; coding handoff is not Side Panel IDE
L2-classes:   acp_propose / acp_start / acp_apply always HITL (forceConfirm)
Compose:      coding_handoff pack + ACP client + task package
Autonomy:     single-thread handoff; workers HARD_DENY acp_*
Trust:        originWs confirm; untrusted handback + taint; disclosure checkbox
Channel:      community; acp.enabled default false; gated apply GO
```

## Required checks (execute where possible)

1. `cd companion && npx tsx --test tests/acp-*.test.ts tests/l2-admission-pure.test.ts`
2. Grep: no user-facing mode label 「只读审查」in pack/copy/modal (C5)
3. Read forceConfirm algebra: under `userFullAutonomy=true`, ACP tools still forceConfirm
4. Confirm propose binding includes `mode=` and `ws=` and that rebinding mode fails token
5. Confirm FocusBand `hasCodingSession` includes `closed`
6. Confirm disclosure checkbox disables start when unchecked

## Output format

1. Short verification table (check → pass/fail + file:line)
2. **Blockers** (if any) with evidence
3. **Nits** (non-blocking only)
4. Final line **exactly** one of:
   - `VERDICT: APPROVE`
   - `VERDICT: APPROVE_WITH_NITS`
   - `VERDICT: REJECT`

Be adversarial. Prefer REJECT if any product lock is broken or a claimed nit is not actually fixed.
