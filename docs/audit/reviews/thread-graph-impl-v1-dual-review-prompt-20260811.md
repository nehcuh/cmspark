# Dual external review: Thread Graph v1 **implementation**

**Batch:** `thread-graph-impl-v1`  
**Stage:** Implementation gate after design APPROVE_WITH_NITS  
**Date:** 2026-08-11  

## Capability declaration

```text
Surface:      L0
L2-classes:   (none)
Compose:      none
Autonomy:     none
Trust:        no elevation
Channel:      unchanged
```

## Required reading

1. Design SoT — `docs/superpowers/specs/2026-08-11-thread-graph-obsidian-view-design.md` (§11 pins TG-1…TG-6)  
2. Design verdict — `docs/audit/reviews/thread-graph-obsidian-view-verdict-20260811-174739.md` / `.json`  
3. **Impl files**  
   - `chrome-extension/src/tabs/thread-graph.tsx`  
   - `chrome-extension/src/thread-graph/ThreadGraphApp.tsx`  
   - `chrome-extension/src/thread-graph/force-layout.ts`  
   - `chrome-extension/src/background/thread-graph.ts`  
   - `chrome-extension/src/background/index.ts` (thread_graph.* cases)  
   - `chrome-extension/src/sidepanel/components/ThreadList.tsx` (openThreadGraph; graph overlay removed)  
   - `chrome-extension/src/sidepanel/utils/thread-related.ts` (`kind` on edges)  
   - tests: `force-layout.test.ts`, `thread-graph-bg.test.ts`, kind test in `thread-related.test.ts`  

## Product pins (must hold)

- TG-1 full-page tab, not side-panel list  
- TG-3 open thread keeps graph tab open  
- TG-4 side-panel edge list removed  
- R5 slim snapshot (no message bodies)  
- Local edges only  

## Must answer

1. Does ☰→关联图谱 open `tabs/thread-graph.html` with prepare+snapshot?  
2. Is force-directed canvas present (not text edge rows)?  
3. Does open_thread select thread without closing graph?  
4. Privacy: snapshot slim only?  
5. Tests: force-layout finite; edge kind; path constants?  
6. Any ADR-020 / security regression?

### Rejection gates

| # | Gate |
|---|------|
| R1 | Graph UI still only side-panel text list |
| R2 | Message bodies in snapshot |
| R3 | L2/Knowledge elevation |
| R4 | Missing tests for layout energy / kind / path |
| R5 | open_thread closes graph tab by design (violates TG-3) |

### Output

Same structure as design review; end with exact VERDICT line.
