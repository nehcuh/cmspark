# Dual external review: Thread History IA — Gap 优化设计（多路对抗合成）

**Batch:** `thread-history-ia-gap-opt`  
**Stage:** Product / UX / architecture **design SoT** — gap 复盘 + Wave A/B/C 优化；**实现未开始**  
**Date:** 2026-08-11  
**Blast tier:** T1–T2 design（docs only today）

## Capability declaration (proposed if landed)

```text
Surface:      L0 chat UX / thread navigation metadata only
L2-classes:   (none)
Compose:      none new — digest/tags/related are Thread index metadata, NOT Skill/Knowledge/Pack
Autonomy:     n/a for graph; worker display stays flat+badge
Trust:        batch_delete / extract do not change trust semantics; delete still per-id releaseTrust
Channel:      community | enterprise unchanged
```

## Required reading (order)

1. **Primary SoT (under review)**  
   `docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md`  
   **全文必读** — especially §3 lanes A–G locks, §5 Waves, §7 GAP pins, §9 anti-goals.

2. **Prior SoT (must not contradict without explicit override)**  
   `docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md`  
   Focus: principles (time/tag/graph axes), P1–P2 scope, anti-goals, pre-dev pins §7.1.

3. **Prior dual synthesis**  
   `docs/audit/reviews/thread-history-ia-dual-synthesis-20260806.md`  
   Confirm this gap doc does not reopen P1–P14 pins without justification.

4. **Ontology**  
   `docs/adr/020-capability-model-three-axes.md` (§1–3)  
   `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

5. **Grounding code (spot-check claims — do not rubber-stamp)**  
   - `chrome-extension/src/sidepanel/components/ThreadList.tsx`  
     (extract entry, `⋯` menu items, `panelMaxHeight`, `overflow`, tagCloud, tldr display or lack)  
   - `companion/src/threads/digest.ts`  
   - `companion/src/message-router.ts` — `thread.extract_digest` (max 20)  
   - `chrome-extension/src/sidepanel/components/AtThreadPopover.tsx` (P1.5 exists)  
   - Confirm **absence** of `thread.related` implementation via grep  

6. **External reference (optional context, NOT SoT)**  
   llm_wiki pattern: persistent wiki + graph — synthesis claims borrow method only (locks E1–E3).

## Product premise (must not weaken without REJECT-level argument)

```text
1. IA-2026-08-06 direction stands: time = default axis, tags = retrieval, graph = explore.
2. User pain is real: extract entry hard to find; tags view empty without digests;
   menu clipping suspected in tags view; cross-thread graph never shipped (P2).
3. Do NOT productize llm_wiki inside ThreadList (no entity wiki, no default full graph,
   no Thread→Knowledge dual-write).
4. Wave A (discoverability + UI fix + tldr show + batch extract untagged ≤20) ships first;
   Graph (Wave C) is gated on digest coverage path existing.
5. "Automatic" means user-triggered one-click batch (A) or opt-in idle (B) — never silent full-library.
```

## Your job

Independent senior **product + UX + architecture** review of the **gap optimization synthesis**.  
There is **no implementation diff required** — git may only show new docs.  
Use tools to verify **current** code matches the status table in the synthesis.

### Must answer

1. Do multi-lane locks A–G hold? Any **blocking** contradiction with ADR-020 or IA-2026-08-06?  
2. Is Wave A right-sized for the reported U1/U2? Missing blocking items?  
3. Is U2 root-cause hypothesis (overflow/clipping) good enough to implement, or must reproduce first?  
4. Are llm_wiki locks E1–E3 correctly scoped (borrow method, forbid product transplant)?  
5. Wave C signal table: should `@` edges be required in C-1 or explicitly deferred?  
6. Should **worker/orchestrator** threads be excluded from「为未标注提取」batch by default?  
7. Approve starting **workflow implementation Wave A first** after dual-review both_ok?

### Adversarial personas (touch each)

- Power user with 200+ mostly untagged threads, limited API budget  
- User who expected “full auto tag everything overnight”  
- User who wants a knowledge graph like llm_wiki / Obsidian graph  
- Security-minded reviewer: batch LLM + tldr leakage to index  
- Implementer: can Wave A be done without companion protocol changes?

### Rejection gates (any fail → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | Synthesis makes Graph/default brain-map the primary navigation |
| R2 | Requires Thread→Knowledge dual-write or full llm_wiki ingest as Wave A |
| R3 | Silent full-library LLM digest with no cap / no default-off |
| R4 | Introduces L2 / new confirm dialect / Pack-first chrome for this feature |
| R5 | Reopens IA pre-dev pins P1–P14 without explicit justified override table |
| R6 | Wave A cannot be independently shipped/accepted (forces Graph in same slice) |

### Nit vs blocking

- **Blocking**: violates R1–R6, ADR-020, or leaves U1 with no real entry path  
- **Nits**: copy, exact menu order, whether bullets show in list, Graph viz library choice  

## Output format

1. Summary (5–10 lines)  
2. Code spot-check notes (file:line for confirm/refute of status table)  
3. Blocking issues (if any)  
4. Nits (non-blocking)  
5. Answers to Must answer §1–7  
6. Explicit recommendation: start Wave A workflow? yes/no  
7. Final line exactly one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
