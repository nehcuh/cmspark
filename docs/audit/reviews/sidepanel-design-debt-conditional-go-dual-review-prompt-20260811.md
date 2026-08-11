# Dual external review: Side Panel design debt — CONDITIONAL GO

**Batch:** `sidepanel-design-debt-conditional-go`  
**Stage:** Pre-implementation design / plan gate — **docs + evidence only** (no impl PR yet)  
**Date:** 2026-08-11  
**Blast tier:** T0–T1 Panel chrome (copy + tokens + docs); optional density collapse if measured

## Capability declaration (proposed work)

```text
Surface:      L0 Panel chrome only
L2-classes:   (none)
Compose:      none
Autonomy:     none
Trust:        no elevation
Channel:      community | enterprise unchanged
```

## Required reading (order)

1. **Primary SoT (under review)** — `docs/superpowers/specs/2026-08-11-sidepanel-design-debt-conditional-go.md`
2. **Grounding code (must spot-check claims)**  
   - `chrome-extension/src/sidepanel/ui/flags.ts` (`bottomBarStrip`)  
   - `chrome-extension/src/sidepanel/App.tsx` (BottomBar gate; SceneStatusBar / RunBusyChip / WorkerScopeBar stack)  
   - `chrome-extension/src/sidepanel/components/StatusRail.tsx` (「关于更多面板」toast copy)  
   - `chrome-extension/src/sidepanel/composer/meta-slash.ts` + `ComposeDrawer.tsx` (real board/scene paths)  
   - `chrome-extension/src/sidepanel/ui/tokens.ts` vs `docs/DESIGN.md` color tables  
   - Empty-state uses of `tokens.textMuted` (ThreadList / ChatView / AtThreadPopover — sample)  
3. **Product density / P4** — `docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md` (§0–1 P4, density budget ≥55%/≥40%)  
4. **ADR-020 checklist** — `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Product premise (must not weaken without REJECT)

```text
1. Full redesign / FocusBand rewrite / Settings restructure / jargon rename = NO-GO.
2. CONDITIONAL GO is only: (W1) false bottom-bar discoverability copy,
   (W2) textMuted empty-state contrast policy, (W3) DESIGN.md ↔ tokens SoT,
   optional (W4) density measure + surgical dedupe/collapse if budget fails.
3. bottomBarStrip default false is intentional (PR5); teaching users "底栏更多"
   for board/scene is a product-truth bug if that chrome is not rendered.
4. tokens.ts is implementation SoT for hex; DESIGN.md must not fight it for AI implementers.
5. No Trust elevation, no L2 tool changes, no companion protocol changes.
6. Code factual claims in the SoT must be true on spot-check.
```

## Your job

Independent **product + UI integrity + factual accuracy** review of the **CONDITIONAL GO plan** (not an implementation PR). Verify code claims with Read/Grep. Challenge over-scoped work, under-scoped product bugs, and weak density claims.

### Must answer

1. **Factual E1:** Is StatusRail still teaching 底栏「更多」while `bottomBarStrip === false` and App does not render BottomBar?  
2. **Factual E2:** Do DESIGN.md hexes disagree with `tokens.ts` on accent/canvas (and is residual `#2563eb` still in sidepanel)?  
3. **Factual E3:** Is `textMuted` used on empty/guidance copy where AA contrast matters?  
4. **Scope:** Is the GO batch correctly bounded (W1–W3 + optional W4), or does it smuggle redesign energy?  
5. **Kill list:** Are NO-GOs (FocusBand rewrite, Settings, rename, polish pass) correct?  
6. **W4:** Should density work be required, optional, or cut entirely until measured?  
7. **Implementability:** Is acceptance A1–A6 closed enough to implement without inventing product behavior?  
8. **ADR-020:** Any Surface/Compose/Trust violation if landed as written?

### Rejection gates (any → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | SoT claims code facts that are **false** on spot-check (major) |
| R2 | Plan requires FocusBand priority rewrite / Settings restructure / second agent runtime as part of “GO” |
| R3 | Plan elevates Trust / auto_approve / new L2 tools under the guise of design debt |
| R4 | Plan re-enables permanent BottomBar strip as the “fix” for discoverability without product decision |
| R5 | Plan renames core ontology terms (装配 / Surface / L0–L2) as mandatory scope |

### Non-blocking nits (examples)

- Exact Chinese strings for the replacement toast/menu  
- Prefer W2 option A vs B  
- DESIGN.md table rewrite vs role-only table  
- Whether W4 measurement should be a shell script or manual checklist  
- Missing unit test for copy / flag interaction  

### Output format

1. **Summary** (≤10 lines)  
2. **Factual spot-check** (pass/fail per E1–E3 + key SoT claims, with file refs)  
3. **Blocking issues** (if any)  
4. **Nits** (non-blocking only)  
5. **Scope assessment** (W1–W4 keep / cut / reorder)  
6. Final line **exactly** one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

Do not rubber-stamp. Prefer machine-checkable code facts. Length of the SoT is not a quality signal.
