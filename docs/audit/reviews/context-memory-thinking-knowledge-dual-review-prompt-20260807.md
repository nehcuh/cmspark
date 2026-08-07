# Dual external review: Context memory · Thinking · Knowledge-in-scene (design analysis)

**Batch:** `context-memory-thinking-knowledge`  
**Stage:** Research / landing analysis SoT — **pre-implementation**; dual-review of the multi-adversarial analysis itself  
**Date:** 2026-08-07  
**Blast tier:** T0–T2 design (docs only today; Wave A/B would be T2 Compose / L0 Surface)

## Capability declaration (proposed work, if landed)

```text
Surface:      L0 chat UX (reasoning polish) + request-path context budget (M3 handoff)
L2-classes:   (none) — no new host/shell/netsec
Compose:      knowledge + pack (user-scene knowledge_ids) — Wave A
Autonomy:     n/a — per-thread budget / recall only; no new multi-worker
Trust:        no elevation; knowledge must not raise auto_approve; handoff redact
Channel:      community | enterprise unchanged
```

## Required reading (order)

1. **Primary SoT (under review)** — `docs/superpowers/specs/2026-08-07-context-memory-thinking-knowledge-adversarial-analysis.md`
2. **Related SoTs (must not contradict without explicit override)**  
   - `docs/superpowers/specs/2026-08-06-settings-thread-compact-ux.md` (§2 three-system glossary, M1/M2)  
   - `docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md` (Digest / @ref)  
   - `docs/superpowers/specs/2026-08-06-user-scene-tools-and-ai-create.md` (user scene — no knowledge yet)  
3. **Grounding code (spot-check claims)**  
   - `companion/src/llm/context-budget.ts` + `context-budget-m2.ts`  
   - `companion/src/llm/adapter.ts` (`runContextBudgetPass`, `rebuildMessagesFromHistory`)  
   - `companion/src/threads/digest.ts`, `context-refs.ts`  
   - `chrome-extension/src/sidepanel/components/ChatView.tsx` (`ReasoningBlock`)  
   - `chrome-extension/src/sidepanel/components/PacksPanel.tsx` (scene UI; knowledge absent?)  
   - `companion/src/packs/validator.ts` / `pack-engine.ts` (knowledge in pack.yaml)  
4. **ADR-020 checklist** — `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Product / research premise (must not weaken without REJECT)

```text
1. Four user optimization ideas evaluated: (a) session-end-style layered compact,
   (b) keep thinking UI default-collapsed, (c) absorb external "use thinking as
   compact source", (d) pre-bind knowledge in scenes.
2. Three summary systems stay separate: Digest / Export / Runtime budget.
3. Do NOT ship raw reasoning_content as the compressed payload.
4. Do NOT auto-write handoff into global knowledge without explicit user action.
5. User-scene knowledge gap is real if PacksPanel has no knowledge UI while pack.yaml supports knowledge.
6. Trust must not be elevated by knowledge or handoff features.
7. Claims about current code must be accurate (spot-check) — over-claiming is REJECT-worthy.
```

## Your job

Independent **product + architecture + security + factual accuracy** review of the **analysis document** (not an implementation PR). Verify code claims with Read/Grep. Challenge weak priorities, missing risks, glossary smuggling, and external-citation misuse.

### Must answer

1. **Factual**: Are claims about M1/M2, ReasoningBlock default fold, rebuildMessagesFromHistory dropping reasoning, and PacksPanel lacking knowledge **true** in current code?  
2. **Glossary**: Does the proposed M3 ThreadHandoff violate the three-system separation or correctly extend runtime budget only?  
3. **Thinking-as-compact**: Is “optional redacted input → structured handoff; never raw CoT payload” sound vs Anthropic thinking-block constraints and privacy?  
4. **Priority**: Is Wave A (scene knowledge) correctly ranked P0 over M3? Any product/ADR-020 objection?  
5. **Security floors**: Are F-S-* / redact / no cross-thread recall / no Trust via knowledge adequate, or are blockers missing?  
6. **Implementability**: Is the landing plan closed enough to open issues without inventing schema, or still too vague (→ nit or REJECT if critical paths inventable)?  
7. **External evidence**: Are external lessons applied correctly, or cherry-picked / overclaimed?

### Rejection gates (any → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | Analysis claims code facts that are **false** on spot-check (major) |
| R2 | Proposes merging Runtime budget into Digest/Export, or auto-persist omit into thread messages as default |
| R3 | Endorses raw `reasoning_content` / CoT as the primary compressed context payload |
| R4 | Proposes knowledge or handoff that **elevates Trust** / auto_approve without explicit design+test |
| R5 | Proposes default **cross-thread** silent full-history injection as compact recovery |
| R6 | Wave plan would require a **second agent runtime** instead of tools + pack + request-path budget |

### Non-blocking nits (examples)

- Missing schema field names, Chinese labels, exact WS message types  
- Wave effort estimates off by 2×  
- Optional polish items for reasoning settings  
- Citation polish / more precise file:line  

### Output format

1. **Summary** (≤10 lines)  
2. **Factual spot-check** (pass/fail per major claim, with file refs)  
3. **Blocking issues** (if any)  
4. **Nits** (non-blocking only)  
5. **Priority / Wave A–D assessment**  
6. Final line **exactly** one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

Do not rubber-stamp. Prefer machine-checkable code facts over prose quality. Length of the analysis is not a quality signal.
