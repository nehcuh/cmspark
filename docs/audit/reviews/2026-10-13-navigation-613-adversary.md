# #613 independent adversarial review

Base: `c570cb80c5799057e067ae0b55e6a3e4548288c3`. Reviewed the entire frozen nine-file source/test/harness/spec patch, SHA256 **a779f888ed566bc5d3f0ec03143f420647e2a0089684c7c92c8eee583a33b52b**. Independently verified that both `/tmp/cmspark-613-full.diff` and the worktree's staged diff have this hash. No implementation ownership in this patch. No product, configuration, dependency or Git mutations; this review document is the only written repository artifact.

## Outcome and trajectory

The concrete defect is a metadata timing gap: selecting an exact Fleet worker before `state.threads` contains it made StatusRail display a new conversation and hide the existing return action. The new helper uses the exact selected ID as a fallback and preserves the full Thread as the first authority (`chrome-extension/src/sidepanel/utils/task-relationship.ts:9-18`). It does not derive ownership from run IDs, titles, a different worker, or a presumed orchestrator. The Fleet producer also includes orchestrators/explicitly parented rows; an unparented orchestrator remains a normal title, without invented child ownership.

Known direct parents alone supply an enabled action. Missing, trashed, self-related and cyclic relationships retain child identity and omit the navigable parent ID (`task-relationship.ts:20-29`). The cycle walk follows only known explicit Thread links. Restored multi-level metadata chooses the direct parent, without enabling nested spawning. No shortcut selects an ancestor or guesses a missing parent from Fleet.

The actual presentation renders parent and child labels, independently focusable native return button, and unavailable reasons (`components/TaskRelationshipNav.tsx:6-21`). Its event guard and `disabled` state agree. StatusRail mounts that component and invokes only its preexisting `SET_ACTIVE_THREAD` plus `thread.select` action (`components/StatusRail.tsx:82,235-238`). The parent task is not restored, restarted, paused or otherwise controlled by selecting it. React renders titles as text rather than HTML.

## State and component checks

- Reviewed actual Fleet selection (`FleetStrip.tsx:118-121`, `FleetWorkerList.tsx:65-67`), Fleet ingestion and full Thread updates in `useWebSocket.ts`, the reducer's `SET_ACTIVE_THREAD`, and the existing stale-thread message-hydration guard. The patch adds no independent transcript selection or new asynchronous protocol, and retains the reducer's established message/busy caches and panel-wide composer requests.
- Examined the existing StatusRail ResizeObserver and shell flex styles together with the new CSS. Narrow layouts give the relationship its own row; its labels can shrink and ellipsize while the return button cannot shrink. Parent/child titles remain available in title/accessible labels. Inspected existing 320px and 900px actual-component screenshots; no clipping of the return button or horizontal overflow was visible.
- Independently ran the compiled `task-relationship`, `thread-timeline` and `thread-busy` suites under Node22.23.2: **71 passed, 0 failed, 0 skipped, exit 0**. Tests cover exact Fleet-first identity, full Thread precedence, unrelated same-run rows, title refresh, unavailable states, longer cycles/direct parent, real React output, guarded click, message caches, busy state and composer restore/clear sequence.
- Read the machine card and associated recorded full frontend/ARM64/UI logs. Full frontend **1517/1517**, fresh ARM64 focused **71/71**, actual production build and hygiene/type checks passed as recorded. These are supporting machine results, not additional live-extension sessions performed by this reviewer.

## Evidence limits

`companion/scripts/render-task-navigation-fixture.cjs:9-31` mounts the actual **TaskRelationshipNav/helper/reducer/workspace CSS** with synthetic surrounding controls. It does **not** mount the complete StatusRail/App, call `chrome.runtime.sendMessage`, or connect to a live Companion. The fixture records a synthetic `thread.select` descriptor after calling the real reducer; the nine click/Enter/Space callbacks therefore prove presentation activation and direct-parent selection, not a real WebSocket round-trip. Its no-overflow assertions apply to that isolated composition at 320/390/900px, not every combination of actual StatusRail badges/popovers. The machine card states this limitation accurately. Direct code inspection covers the unchanged production callback and existing reducer/transport boundary; no claim of live end-to-end validation is made.

The preexisting `SET_THREADS` behavior can clear an active ID omitted from a later list; this patch resolves an extant exact-ID Fleet selection while that ID remains active, and does not change list reconciliation. No introduced regression or new promise of backend/list hydration repair was found. No live user browser or Companion was accessed during this review.

## ADR-020 capability axes and safety

| Axis | Observed boundary |
|---|---|
| Surface | Existing sidepanel task-selection UI; no new browser DOM/CDP or host action. |
| L2 classes | None added. |
| Composition | Existing Thread/Fleet metadata only; no Pack, Skill, MCP or new runtime. |
| Autonomy | Explicit user navigation; no spawn, resume, retry or worker execution. |
| Trust | Exact identity and explicit direct-parent metadata; missing/trash/cycle states fail closed. |
| Channel | Existing `thread.select` transport and installation channels are unchanged; no new community/enterprise capability. |

No privilege, consent, capability-profile or draft-ownership boundary is widened. The visible contextual return control extends an existing affordance rather than creating a parallel task-navigation runtime.

## Findings and verdict

**No actionable P0/P1/P2 defect found in the frozen patch.** The isolated-harness coverage limits above are disclosed limitations, not evidence of a product failure. No style-only change request or speculative blocker is raised.

**VERDICT: APPROVE (push-ready for this independent review).** This does not substitute for the separate Pi/Kimi/required-CI gates.
