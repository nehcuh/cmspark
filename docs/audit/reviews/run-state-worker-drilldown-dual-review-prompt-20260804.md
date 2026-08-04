# Dual external re-review: Run-state visibility + worker drill-down (design SoT)

**Stage:** Product design SoT — **implementation NOT started**  
**Date:** 2026-08-04  
**Batch id:** `run-state-worker-drilldown`  
**Repo:** `/Users/huchen/Projects/cmspark`

## Required reading (order)

1. **Design SoT (post-adversary)** — `docs/superpowers/specs/2026-08-04-run-state-and-worker-drilldown.md`  
   Focus: deriveThreadBusy / deriveRunBusy, Composer gate, F-S1–F-S7, W0+W1+W2-min ship, portal popover, tool thread_id.

2. **Adversary synthesis** — `docs/audit/reviews/run-state-worker-drilldown-adversary-synthesis-20260804.md`  
   Product MAJOR_REVISE resolution; floors table.

3. **Grounding code (spot-check claims)**  
   - `chrome-extension/src/sidepanel/App.tsx` — canSend / Stop only on streaming  
   - `chrome-extension/src/sidepanel/store/agentStore.tsx` — SET_ACTIVE_THREAD clears busy  
   - `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` — tool.start no thread_id  
   - `chrome-extension/src/sidepanel/components/FleetStrip.tsx` — focusBand → cockpit; enterWorker  
   - `chrome-extension/src/sidepanel/components/FocusBand.tsx`  
   - `companion/src/orchestrator/fleet.ts` — idle|paused|holding_tabs  
   - `chrome-extension/src/sidepanel/components/focus-band-priority.ts` — classifyFleetActivity  

4. **Parent specs**  
   - `docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md` §4.3 FocusBand  
   - `docs/multi-agent-user-guide.md` — wait_workers poll; lease  
   - ADR-015 / ADR-020 capability (Autonomy vs Composition; worker ≠ 中层 Agent)

## Capability declaration (from SoT)

```text
Surface: n/a | L2-classes: none | Compose: none
Autonomy: multi-worker | single-thread run-state
Trust: no elevation | Channel: n/a
```

## Product premise (must not weaken without REJECT)

```text
1. Fix false-idle Composer (gate ThreadBusy, not only streaming).
2. Allow Observe drill-down into workers without pretending job is done.
3. RunBusy must NOT treat residual idle workers as "still running".
4. W1 drill-down ships with W2-min busy map + tool.* thread_id (not W1 alone claiming live continuity).
5. No auto-spawn, no worker L2 surface lift, no mid-layer agent runtime.
6. Confirm FocusBand P0 priority unchanged; stop targets stamped.
7. Follow-up does not steal tab leases.
```

## Your job

Independent **product + security + ADR + implementability** review of **design SoT only** (docs). Spot-check real code so claims are true.

### Must answer

1. Did the post-adversary SoT adequately resolve Product MAJOR_REVISE (W2-min coupling, always-on RunBusy chip, steer contract, chrome budget, naming)?  
2. Is `deriveRunBusy` safe against sticky idle workers and multi-run pollution (P0 global scope honesty)?  
3. Are F-S1–F-S7 sufficient for wrong-worker confirm/stop under primary drill-down?  
4. Is portal popover + ScopeBar ≤28px compatible with UIUX FocusBand ≤80px?  
5. Is companion `tool.* thread_id` correctly mandatory before multi-agent live claims?  
6. Any remaining **blocking** hole that should force REJECT of design freeze?

### Rejection gates (any → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | Design allows RunBusy = worker_count>0 or unfiltered fleet-idle-as-active for §6 banner |
| R2 | Design ships W1 “live full continuity” without W2-min / tool thread_id |
| R3 | Auto-spawn, worker L2 lift, or new mid-layer agent runtime |
| R4 | Follow-up steals lease / force-release as default unjam on ScopeBar |
| R5 | Confirm stop-target may silently use wrong activeThread when stamp exists |
| R6 | FocusBand priority demotes Confirm under fleet popover |
| R7 | Composer Abort replaces or relocates L2 急停 next to Send as CU control |

### Non-blocking nits

- Per-run fleet filter timing, llm_active shape, Board W3 copy, estimate tweaks, exact chip placement tokens

### Output

1. Findings: **blocking** vs **nits**, with file:line when code-backed  
2. Whether adversary floors are fully absorbed in SoT  
3. Final line exactly one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
