# Dual external review: Side Panel UI/UX Redesign v2

**Batch:** `sidepanel-uiux-v2`  
**Stage:** Design SoT after adversarial revision  
**Date:** 2026-07-31  

## Capability declaration

```text
Surface:      L0 | L1 | L2  (UI presentation only — no new surface tools)
L2-classes:   (none new)
Compose:      skill | knowledge | mcp-server | pack | user-env  (IA: 装配 drawer)
Autonomy:     board stays Autonomy chrome (not 装配)
Trust:        existing gates; content-split D10′ preserved
Channel:      n/a
```

## Documents to read (tools)

1. **Primary:** `docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md` (full)
2. **Adversarial A:** `docs/audit/reviews/sidepanel-uiux-v2-adversarial-A-2026-07-31.md`
3. **Adversarial B:** `docs/audit/reviews/sidepanel-uiux-v2-adversarial-B-2026-07-31.md`
4. **Ontology:** `docs/adr/020-capability-model-three-axes.md` (§1–3)
5. **Prior IA:** `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md` (§1–5, D1–D16)
6. Optional: `docs/DESIGN.md` tokens

## Context

- Three-mode L0/L1/L2 + Cockpit **already shipped**; this v2 is **shell/IA/visual** refinement after user feedback (ugly + inconvenient).
- Two independent adversarial critics both returned **MAJOR_REVISE**; author revised for: Board out of 装配, ContextPanelHost replace-before-remove, FocusBand hard state machine + 急停, P0 装配 entry, slash parity, Esc stack, honest height metrics, PR resequence.
- Research: agent UX principles (transparency, agency, progressive disclosure, status-first) + quiet-professional tokens.

## Your job

Independent senior design/product review. Challenge the **revised** design for:

1. ADR-020 fidelity (Composition vs Autonomy; no 中层 Agent)  
2. Whether adversarial blocking issues are actually closed  
3. Shippability of PR plan / FocusBand / Host migration  
4. Residual product risk in 320px panel  
5. Completeness for engineers to implement without guessing  

## Output format

```markdown
## Summary
## ADR-020 / three-mode fit
## Adversarial closure check
| Issue | Closed? | Evidence |
## Residual risks
## Blocking
## Nits
VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT
```

If REJECT: list concrete blocking gaps with section IDs.  
If APPROVE_WITH_NITS: nits only; design is implementable.
