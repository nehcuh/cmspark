# Dual external review: Thread Graph Obsidian-style full-page view (design)

**Batch:** `thread-graph-obsidian-view`  
**Stage:** Pre-implementation **design gate** (docs only)  
**Date:** 2026-08-11  

## Capability declaration

```text
Surface:      L0 product UX (thread metadata visualization)
L2-classes:   (none)
Compose:      none — no Knowledge dual-write
Autonomy:     none
Trust:        no elevation
Channel:      unchanged
```

## Required reading

1. **Primary SoT** — `docs/superpowers/specs/2026-08-11-thread-graph-obsidian-view-design.md`（含 §11 用户 pins）  
2. **Parent IA** — `docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md` §B.3 Graph  
3. **Gap Wave C** — `docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md` C-1…C-3 · GAP pins  
4. **Current impl (spot-check)** — `chrome-extension/src/sidepanel/components/ThreadList.tsx` graphOpen 边列表；`sidepanel/utils/thread-related.ts` `buildRelatedEdges`  
5. **Pattern ref** — `chrome-extension/src/tabs/cockpit.tsx` / cockpit open path  
6. ADR-020 checklist — `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Product premise

```text
1. User expects Obsidian-like graph in a popped webpage with clickable nodes.
2. Current UI is a side-panel text edge list — acknowledged gap vs IA B.3 / C-3.
3. v1: extension tab page + force-directed canvas + open thread; keep graph tab open.
4. Remove side-panel edge-list graph UI (TG-4).
5. Local digest-based edges only; no embedding / no L2 / no Knowledge.
6. Empty graph must teach extract-digest, not fake density.
```

## Must answer

1. **Gap factual?** Is current graph really a text edge list in ThreadList portal?  
2. **IA alignment?** Does full-page tab satisfy B.3 “新标签打开” better than side-panel list?  
3. **Data plane?** Is `thread_graph.prepare` + `storage.session` snapshot sound vs Graph connecting Companion WS?  
4. **Pins TG-1…TG-6** — any REJECT-worthy product/security issue?  
5. **Scope:** Is force-layout v1 + maxEdges/N-cap enough, or under-specified?  
6. **Implementability:** Can implementer start without inventing schema?  
7. **ADR-020:** Any Compose/Trust/Surface violation?

### Rejection gates

| # | Gate |
|---|------|
| R1 | Design claims code facts that are false |
| R2 | Requires L2 / Knowledge dual-write / cloud graph / embedding as v1 |
| R3 | Makes graph the default thread navigation (replaces timeline) |
| R4 | Re-introduces side-panel-only graph as the only path while claiming Obsidian UX |
| R5 | Snapshot/privacy leak of full message bodies into graph page |

### Non-blocking nits

- d3-force vs hand-rolled force  
- Exact stroke/color tokens  
- Whether SW should mirror `thread.related` server scores  
- max nodes 300 vs 500  

### Output

1. Summary ≤10 lines  
2. Factual spot-check  
3. Blocking  
4. Nits  
5. Scope keep/cut  
6. Final line exactly:  
   `VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
