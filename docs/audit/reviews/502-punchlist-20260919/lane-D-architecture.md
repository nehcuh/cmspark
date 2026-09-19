# Lane D — ARCHITECTURE
HEAD: 022b2f60
VERDICT: REJECT

## Wiring maps (compact tables)

Evidence tag on every cell: **I** = [inspected] HEAD source; **T** = [inspected] test that imports/scans the production symbol; **A** = [assumed] not executed this lane.

### Tools added/changed on this branch

| Layer | `fleet_suggest_propose` | `spawn_worker` (#514 goal+kick) | `spawn_expert_team` | `propose_expert_team` |
|---|---|---|---|---|
| catalog json | I `tool-definitions-catalog.json:1049` | I `:996` required `goal` `:1040-1042` | I `:1104` | I `:1078` |
| COMPANION_TOOLS | I `companion-tools.ts:39` | I `:37` | I `:41` | I `:40` |
| zod `tool-schemas.ts` | I `:399-402` `.strict()` | **missing** → `GENERIC_FALLBACK` `:498` | I `:227-235` | I `:223-226` |
| executor case | I `companion-dispatch.ts:2255` | I `:173` goal+brief+kick `:176-349` | I `:385` | I `:374` |
| surface strip (summoner spoof) | I `server.ts:696-701` | n/a (not surface-stripped) | n/a | n/a |
| SUMMONER_ACL | I dispatch deny if summoner/null `:2258-2259` | L2 tool; overlay-eligible regex | overlay-eligible | overlay-eligible |
| PLAN_READONLY | I allowlisted `plan-readonly.ts:63` | denied (default) | denied | denied (read-only but not listed) |
| WORKER_HARD_DENY + runtime | I `constants.ts:50` + dispatch `:2267` + `thread-manager.ts:1324` | I `:33` | I `:35` | I `:34` |
| validate.ts inbound | n/a (tool, not WS type) | n/a | n/a | n/a |
| message-router case | n/a | n/a | n/a | n/a |
| useWebSocket | outbound `fleet.suggest` I `:1135` | n/a | expert_team on confirm I `:917` | n/a |
| agentStore | `SET_FLEET_SUGGEST` I `:1300` | n/a | n/a | n/a |
| SW forward | n/a | n/a | n/a | n/a |
| tests import prod | T `fleet-suggest-dispatch.test.ts` `executeCompanionTool` + wiring scan | T same file `#514` goal/kick/catalog lock | T `expert-team-i5.test.ts` | T `expert-team-i5.test.ts` |

`ORCHESTRATOR_TOOL_ALLOWLIST` (`constants.ts:54-69`) includes `spawn_worker` / `spawn_expert_team` / `propose_expert_team`, **not** `fleet_suggest_propose`. Propose is intended pre-promotion (parent still `normal`); after first spawn the parent is an orchestrator and talks `spawn_worker` directly. Not a user-visible hole for the #513 card.

### WS types added/changed

| Layer | `fleet.suggest` (outbound) | `fleet.suggest.dismiss` / `.dismissed` | `fleet.status` (push+pull) |
|---|---|---|---|
| validate.ts inbound | n/a (companion→panel) | I `validate.ts:261-267` | pre-existing I `:1302` |
| message-router | n/a | I `:3169-3176` → `fleet.suggest.dismissed` | I `:4353` pull; push via `broadcastFleetSnapshotIfWorkers` |
| SUMMONER_ALLOW | n/a | **not listed** `summoner-acl.ts:17-63` | not listed (overlay does not mount Glance) |
| SW `chrome.runtime.sendMessage` | n/a | I `background/index.ts:1644-1647` | I `:1512` |
| useWebSocket | I `:1135-1146` | I `:1148-1153` | I `:949-982` |
| agentStore | `SET_FLEET_SUGGEST` I `:635,:1300` | `CLEAR_FLEET_SUGGEST` I `:637,:1321` | `SET_FLEET` I `:1995-1996` |
| UI | `FleetSuggestCard` `LoopStatusRow.tsx:208` wired in `ChatView.tsx:582` | accept/dismiss send dismiss + `onCleared` I `:222-229` | `FleetStrip` only mounted when FocusBand `primary==="fleet"` I `FocusBand.tsx:163-166` |
| tests | T `fleet-suggest-card.test.ts` builders + store map | T validate behavioral in `fleet-suggest-dispatch.test.ts:273` | T `broadcastFleetSnapshotIfWorkers` `:282` |

`chat.send` is an SW-only alias (`background/index.ts:689-746`) → `chat.create` or `chat.steer`. Not a companion WS type. Fleet accept rides it (`LoopStatusRow.tsx:188-198`).

### Spawn vs expert-team vs fleet-accept → spawn

```
fleet.suggest.dismiss ── silence 10min (fleet-suggest.ts:16)
FleetSuggestCard accept
  ├─ chat.send (steer if threadBusy)  → model is told to spawn_worker (buildFleetAcceptText)
  └─ fleet.suggest.dismiss            → card cleared locally immediately
         │
         ▼  (model, after L2)
spawn_worker  ── persistWorkerBrief + kickWorkerChat + broadcastFleetSnapshotIfWorkers
spawn_expert_team ── persistWorkerBrief + invokeKick (fail-closed if unbound) + broadcast
```

#514 tip `022b2f60` **does** persist a role-aware brief and call `kickWorkerChat` on ordinary `spawn_worker` (`companion-dispatch.ts:315-349`). Same `kickWorkerChat` binding as expert-team (`server.ts:765`). `skipUserMessage: true` on the kick + `persistWorkerBrief` addMessage is lockstep (brief is the first user row; kick does not double-append). [inspected]

Remaining spawn-path divergences that are **not** the old dead-shell bug: see P-D-1 (shared kick bypasses abort map — now the default spawn path) and P-D-3 (unbound kick fail-open vs fail-closed).

### Fleet snapshot: who broadcasts, who subscribes

| Caller | Channel | When |
|---|---|---|
| `spawn_worker` | `execOpts.broadcast` = `broadcastToClients` | after persist+kick schedule I `companion-dispatch.ts:353-356` |
| `spawn_expert_team` | same | after team spawn I `:414-417` |
| `kickWorkerChat` finally | `broadcastToClients` | after worker `chatCreate` settles I `server.ts:785-786` |
| router `chat.create` run-end | **unicast** `session.sendToExtension` | after parent/worker-via-router run I `message-router.ts:1427-1431` |
| `fleet.stop_all` | reply `fleet.stop_all_result.fleet` | I `:4477` |
| panel pull | `fleet.status` | confirms I `useWebSocket.ts:921`; `worker.updated` `:989`; FleetStrip 4s `:66-71`; Cockpit 5s (own store) |

`broadcastFleetSnapshotIfWorkers` no-ops when no `agent_role==="worker"` (`fleet.ts:187`) — empty fleet is never pushed; Glance disappearance after last worker delete depends on a pull. [inspected]

Glance subscribe is **not** a WS subscription: FocusBand mounts `FleetStrip` only after `hasFleetActivity` (`FocusBand.tsx:163`). First paint under cruise (no confirm) **requires** the spawn/kick push — that part is wired. The 4s poll inside FleetStrip is the ongoing feed — and it defeats the fresh gate (P-D-2).

`latest_tool` / `brief` are write-path stamps (`thread-manager.ts:1207-1244`, `isAppend` captured **before** 1000-cap trim). Snapshot never reads transcripts. [inspected]

### Tool-history live vs hydrate

| Shape | Producer | Consumer |
|---|---|---|
| live `tool.start` | `server.ts:572` `ws.send` (origin executor) → `useWebSocket.ts:745` `role:"tool"` + flat `tool_name` | `groupToolTurnRows` buffers `role=tool` rows I `tool-history-view.ts:267-271` |
| live `chat.assistant` mid-turn | adapter `:1585` function-shape `tool_calls` | covered by following tool row; empty assistant skipped in `consolidateRunToolTurns` `:410-415` |
| hydrate disk | persist assistant function-shape + `role=tool` result rows (`adapter.ts:1632` / createToolResultMessage) | same grouping; prehistoric uncovered function-shape → synthetic tool block `:274-311` |
| inline cards | `shouldRenderInlineToolCards` I `:204` | MessageRow I `ChatView.tsx:837` — function-shape and `role=tool` never inline |

Block key `tools-${item.msgs[0].id}` (`ChatView.tsx:488`) is first tool of the consolidated run — stable across added rounds (page-follow relies on this). Page-follow: `userPaged` ref + effect I `:1124-1133`. Confirm set from **live round only** I `:1148-1151`. [inspected] Tests import the production grouping functions (`tool-history-view.test.ts`). No architecture mismatch producing duplicate/empty chips found on HEAD.

---

## Findings

### P-D-1 — BLOCK
- File: `companion/src/server.ts:765-782`; `companion/src/message-router.ts:196-198,230-246,1201-1203,4438`; `companion/src/llm/adapter.ts:771` (no `signal`); `companion/src/orchestrator/fleet.ts:67-77,107`; `companion/src/orchestrator/tool-pregate.ts:165-171`
- Evidence: [inspected] `kickWorkerChat` calls `adapter.chatCreate` **directly**. Router `chat.create` is the only production path that `abortControllers.set` (`message-router.ts:1201-1203`) and passes `signal: controller.signal`. Kick passes neither `signal` nor a controller. `listLlmActiveThreadIds` is `abortControllers.keys()`. `abortThreadChat` (used by `fleet.stop_all` / `worker.pause` / `chat.abort`) no-ops when the map has no entry — and **does not** `releaseMultiAgentLlmLoop` in that branch (release is inside `if (controller)`). Kick holds the cap via `scheduleWhenLlmSlotAvailable` (`llm-loop-gate.ts:95-97,126-128`) until `chatCreate` naturally settles. Pregate `th.paused` (`tool-pregate.ts:165`) only fails **subsequent tools**; the LLM HTTP loop keeps running. `#514` (`022b2f60`) routes **ordinary** `spawn_worker` through this same kick (`companion-dispatch.ts:346-348`), so the hole is no longer expert-team-only.
- Broken seam: kick path vs router `chat.create` abort/run-state registry. Two SoTs for "LLM is running": abort map (Glance / 全停 / steer) vs llm-loop-gate holders (cap). They do not meet on the kick path.
- User/runtime effect: after `spawn_worker` / `spawn_expert_team` kick, Glance `llm_active` stays false while the worker streams; `fleet.stop_all` paints `paused` and rejects new tools but **cannot abort** the in-flight LLM (tokens continue; cap slot stuck until the model gives up); `chat.steer` / `chat.abort` on that worker id return `no_active_run` / `stopped:false`. Dual-end: strip says 已暂停, transcript still ticks.
- Distinct because: this is the kick **control-plane** bypass, not the old "no brief" bug and not the snapshot-push wiring. Push after kick (`server.ts:785`) even advertises the hole: they knew kick bypasses router run-end, but only patched Glance refresh, not abort registration.
- Suggested fix: kick must go through the same slot as router `chat.create` — install `AbortController` on `abortControllers`, pass `signal` into `chatCreate`, set `llmLoopGeneration` / owner panel, and let `abortThreadChat` abort+release. Do not naked-`chatCreate`. Tests: spawn+kick then `abortThreadChat` must abort the worker HTTP loop; `listLlmActiveThreadIds` must include the kicked worker.

### P-D-2 — MAJOR
- File: `chrome-extension/src/sidepanel/components/FocusBand.tsx:64-75`; `FleetStrip.tsx:66-71`; `focus-band-priority.ts:223,237-239`; `companion/src/orchestrator/fleet.ts:155-156`; `agentStore.tsx:1995-1996`
- Evidence: [inspected] `#514` fresh gate: idle workers count as `active` only while `fresh !== false` (`focus-band-priority.ts:237-239`), and FocusBand computes `fleetFresh` from `state.fleet.at` vs `FLEET_SNAPSHOT_FRESH_MS` (10 min) (`FocusBand.tsx:64-75`). `FleetStrip` is mounted **only** when that classify returns `"active"` (`FocusBand.tsx:163-166`). On mount it starts a 4s `fleet.status` pull (`FleetStrip.tsx:66-71`). Pull handler `buildFleetSnapshot` always writes `at: new Date().toISOString()` (`fleet.ts:155-156`). `SET_FLEET` replaces the whole snapshot (`agentStore.tsx:1995-1996`) with no age preservation. `classifyFleetActivity` treats omitted `fresh` as fresh (`fresh !== false`); `fleetStripShouldShow` never passes `fresh`.
- Broken seam: the inspection-window clock is `snapshot.at`, but the only component that displays the window is also the component that **refreshes** `at` forever. Unmount (needed for `at` to go stale) requires `hasFleetActivity` to drop, which requires `at` to go stale.
- User/runtime effect: a finished idle fleet keeps FocusBand as `primary==="fleet"` for the life of the panel session — the `#514` "not a forever squat" claim does not hold. Tests pin classify in isolation (`tool-history-view.test.ts` / `message-quiet-pr6.test.ts`) and never mount FleetStrip+store together, so CI is green.
- Distinct because: this is Glance **clock vs poll** wiring, not the abort-map hole and not "push missing on spawn" (push is present).
- Suggested fix: either (a) stop polling when `worst_status==="idle"` && no locks/intents/llm_active, or (b) stamp a separate `activity_at` that pull does not bump, or (c) drive the gate off worker `llm_active` / lock / intent — not `snapshot.at`. Add a component test: idle snapshot + 4s tick must not keep `hasFleetActivity` true past `FLEET_SNAPSHOT_FRESH_MS`.

### P-D-3 — NIT
- File: `companion/src/tool/companion-dispatch.ts:345-370` vs `companion/src/orchestrator/expert-team.ts:395-398`
- Evidence: [inspected] `spawn_expert_team` `invokeKick` fail-closed if `kickWorkerChat` unbound. Ordinary `spawn_worker` succeeds with `kicked:false` and a note. Production `createToolExecutor` always binds kick.
- Broken seam: same "worker must start" invariant, two policies.
- User/runtime effect: none on the tray executor; tests/internal callers can still create a briefed-but-unkicked worker.
- Distinct because: leftover of the #514 kick patch, not the abort-map bypass (P-D-1 is "kick runs but is invisible to abort"; this is "kick may not run").
- Suggested fix: fail-closed like `invokeKick`, or treat missing kick as `SPAWN_KICK_FAILED` and roll back.

### P-D-4 — NIT
- File: `companion/src/bridge/tool-schemas.ts:498` (no `spawn_worker` key); catalog `tool-definitions-catalog.json:1040-1042`; adapter `tryParseToolArgs` `adapter.ts:1647`
- Evidence: [inspected] `#514` made catalog `goal` required and executor rejects missing goal (`companion-dispatch.ts:176-187`). Zod never learned: `schemaForTool("spawn_worker")` is `GENERIC_FALLBACK`. `spawn_expert_team` / `fleet_suggest_propose` have explicit schemas. A spawn_worker call without `goal` fails at the executor, not at parse (different error shape, still fail-closed).
- Broken seam: catalog vs zod for the same newly-required field. Not a second user-visible failure mode vs executor — counted as one NIT, not "tool not fully registered".
- User/runtime effect: LLM still sees catalog `required:["goal"]`; only a non-catalog caller skips the schema gate.
- Distinct because: registration completeness, not kick/abort/Glance.
- Suggested fix: add `spawn_worker: z.object({ goal: z.string().min(1), ... }).` matching catalog; lockstep test next to the catalog regex pin.

### P-D-5 — NIT
- File: `companion/src/message-router.ts:1427-1431` vs `companion-dispatch.ts:353-356` / `server.ts:785-786`
- Evidence: [inspected] Spawn/kick push uses `broadcastToClients` (all authenticated sockets). Router run-end push uses `session.sendToExtension`, which is unicast to the origin WS (`lifecycle.ts:1386-1389`).
- Broken seam: same `fleet.status` frame, two fan-out policies. Once FleetStrip is mounted the 4s pull covers other sockets on **that** React tree; a second surface (Cockpit has its own store + 5s pull `CockpitApp.tsx:123-128`) is fine; a side panel that never mounted FleetStrip and did not receive the unicast would lag until some other pull.
- User/runtime effect: low — first paint is broadcast on spawn. Residual skew if Glance was already up on a non-origin socket and workers only change at parent run-end.
- Distinct because: fan-out of an existing push, not missing push.
- Suggested fix: pass `broadcastToClients` (or `session.broadcast`) into `broadcastFleetSnapshotIfWorkers` at run-end, matching spawn/kick.

---

## Overturned

- **Ordinary `spawn_worker` creates a dead shell (no goal / no brief / no kick).** False on HEAD. Catalog requires `goal`; executor rejects empty goal; `persistWorkerBrief` + `kickWorkerChat` run; tests in `fleet-suggest-dispatch.test.ts` import `executeCompanionTool` and assert brief+kick. [inspected][T]
- **Expert-team snapshot push unwired.** False. Dispatch pushes after spawn (`:414-417`) and kick pushes after `chatCreate` (`server.ts:785`). [inspected]
- **Page-follow stranded at ‹ 1/N ›.** False. `userPaged` + follow-latest effect is in `ChatView.tsx:1124-1133`. [inspected]
- **Hydrate vs live tool chips duplicate or go empty.** False on HEAD. Live `role=tool` + hydrated function-shape are one grouping function; `shouldRenderInlineToolCards` blocks a second inline set; `consolidateRunToolTurns` is the run-level chip. Production functions imported by `tool-history-view.test.ts`. [inspected][T]
- **`fleet_suggest_propose` not fully registered.** False. Catalog, COMPANION_TOOLS, zod `.strict()`, dispatch, surface strip, PLAN_READONLY, WORKER_HARD_DENY, SUMMONER deny, validate+router for dismiss, SW case, store, ChatView card — all present. [inspected][T]
- **Kick deadlocks parent tool call** because `spawn_worker` `await`s `kickWorkerChat`. False. Production kick returns void; `scheduleWhenLlmSlotAvailable` is sync-schedule + fire-and-forget (`llm-loop-gate.ts:120-128`). [inspected]

## Residual

- Fleet accept while `threadBusy` uses `chat.steer` with no fallback: if the run ends between click and companion (`no_active_run`), the card is already `onCleared` and the dispatch text is a ghost echo (`background/index.ts:737` echoes even for steer). Same composer pattern; one-shot card makes retry worse. Not counted — race, not a missing type.
- `fleet.suggest.dismiss` is not on `SUMMONER_ALLOW`. Overlay never mounts `FleetSuggestCard`; propose is SUMMONER-denied. Dead ACL row, not a user path.
- `propose_expert_team` is observational but not PLAN_READONLY-allowlisted (unlike `fleet_suggest_propose`). Plan-mode cannot match experts.
- `latest_tool` Glance during a kicked run depends on 4s pull / write-path stamp, not `llm_active` (which is false — P-D-1). Suffix can show a stale tool until next pull.
- Kick `chatCreate` uses the **parent** tool-executor `ws` for `tool.start` (`server.ts:572` origin send). Inspect live-tool on another socket relies on broadcast tokens, not `tool.start`. Pre-existing executor origin bind; worse now that ordinary spawn kicks.

VERDICT: REJECT
