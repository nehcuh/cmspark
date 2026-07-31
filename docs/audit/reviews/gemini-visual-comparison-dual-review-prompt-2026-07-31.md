# Dual external review: Gemini-inspired visual comparison (pre-implementation)

**Batch:** `gemini-visual-comparison`  
**Stage:** Design SoT only (no code required for approve)  
**Date:** 2026-07-31  

## Capability declaration

```text
Surface:      n/a (visual presentation only; L0/L1/L2 chrome density changes)
L2-classes:   (none)
Compose:      none new (装配 IA unchanged)
Autonomy:     n/a
Trust:        existing content-split / 急停 preserved
Channel:      n/a
```

## Documents

1. **Primary:** `docs/superpowers/specs/2026-07-31-gemini-inspired-visual-comparison.md` (full)
2. **Baseline IA:** `docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md` (skim §0–5, §9)
3. **Ontology:** `docs/adr/020-capability-model-three-axes.md` (§1–3 if needed)

## Context

- CMspark shipped UIUX v2 AgentTeam (PR1–PR7) + Quiet Premium indigo pass.
- User feedback: better but still not “premium” like **Google Gemini in Chrome side panel**.
- Author researched public Gemini-in-Chrome product materials and proposes **“Gemini breath, CMspark bones”** visual direction without cloning trademarks or reopening ADR-020.

## Your job

Independent senior design/product review. Use Read tools on the primary doc.

Check:

1. Accuracy of Gemini synthesis (not over-claiming undocumented internals)  
2. Whether proposed direction is implementable without product-model breakage  
3. Discoverability risk of L0 chip collapse  
4. Safety chrome (FocusBand floating + 急停) still sound  
5. PR-G1…G4 realism  

## Output format

```markdown
## Summary
## Gemini synthesis quality
## ADR-020 / safety fit
## Discoverability (L0 chips)
## PR plan
## Blocking
## Nits
VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT
```
