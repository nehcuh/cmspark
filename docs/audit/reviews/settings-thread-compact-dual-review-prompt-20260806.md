# Dual / Pi external review: Settings IA · Timeline fold · Runtime context budget

**Batch:** `settings-thread-compact`  
**Stage:** Product design SoT — **post-adversary floors absorbed**; implementation starting W0  
**Date:** 2026-08-06  

## Capability declaration

```text
Surface:      L0 chat UX + request-path context budget
L2-classes:   (none)
Compose:      none — runtime budget ≠ Digest / Export / Pack
Autonomy:     n/a — per-thread budget only
Trust:        no elevation; armed chrome must remain discoverable
Channel:      community | enterprise unchanged
```

## Required reading (order)

1. **Design SoT (post-adversary)** — `docs/superpowers/specs/2026-08-06-settings-thread-compact-ux.md`  
2. **Adversary synthesis** — `docs/audit/reviews/settings-thread-compact-adversary-synthesis-20260806.md`  
3. **History IA amend (Timeline SoT)** — `docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md` §B.1  
4. **Grounding code**  
   - `chrome-extension/src/sidepanel/components/ThreadList.tsx` (~today/yesterday L497–525)  
   - `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` (sections, arm, advancedGatesOpen)  
   - `companion/src/llm/adapter.ts` (~rebuild + head-drop L426–457)  
   - `companion/src/config.ts` (`context_window` default)  
   - `companion/src/threads/digest.ts` / `summary-export.ts` (other two summary systems)

Also: `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Product premise (must not weaken without REJECT)

```text
1. Settings: progressive disclosure via accordion; Secrets first-class; no capability deletion.
2. Timeline: today default expand + collapsible; yesterday default collapse + collapsible; History IA is SoT.
3. Runtime budget: request-path only; disk/UI full; dual-truth durable UI with behavior change; no silent-only ship.
4. Default context_window 1e6 honesty: do not claim auto-compress for default users without UI honesty.
5. No Trust elevation; armed flags force-open security section > LS.
6. Three systems stay separate: Digest / Export / Runtime budget.
```

## Your job

Independent **product + security + implementability** review of **design SoT** (and History IA B.1 amend). Spot-check code so claims hold.

### Must answer

1. Are F-UX1–7, F-S1–8, F-I1–6, F-C1–7 adequately absorbed in SoT?  
2. Is yesterday-default-collapse + unified LS safe vs existing ThreadList?  
3. Is M1 algorithm closed enough to implement without invention?  
4. Dual-truth + omit wire recipe: residual REJECT-level hole?  
5. Settings accordion: can armed Trust still be hidden?  
6. Any ADR-020 / three-summary smuggling left?

### Rejection gates (any → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | Secrets buried only under collapsed junk drawer with no first-class path |
| R2 | S3 ships improved silent head-drop without dual-truth UI contract |
| R3 | Compaction writes omit/summary into persisted thread messages by default |
| R4 | Armed elevated Trust can stay collapsed with no badge (LS wins) |
| R5 | Runtime budget merged into ThreadDigest or default export |
| R6 | Design claims default 1e6 users get auto-compress without honesty |

### Output

1. Blocking vs nits  
2. Whether floors are fully in SoT  
3. Final line exactly one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
