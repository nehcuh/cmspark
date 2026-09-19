鈥?I'll verify each finding against HEAD source. First, locate the cited files.

鈥?While tests compile, verify the remaining X1 rendering details.

鈥?X9 re-executed: 5 failures confirmed. Now check whether the `embedded_terminal` toggle (X10) is new in this diff or pre-existing.

鈥?One more independent spot-check on the capability watch item (fleet accept must not arm):

鈥?All ten findings verified against HEAD source; X9 re-executed locally after recompiling (`tsc -p tsconfig.test.json`, then `run-tests.mjs` on the two compiled fixtures).

  # Dual re-review (kimi)
  HEAD: 022b2f60

  ## Per-finding

  - **X1: TRIGGERED** 鈥?`consolidateRunToolTurns` pops a trailing mid-turn assistant narration (with content + `tool_calls`) behind the tools block (`chrome-extension/src/sidepanel/components/tool-history-view.ts:386-391`), while `ChatView` feeds `threadBusy` / `pendingConfirmToolNames` only to `itemIsLast` (`ChatView.tsx:484-492`); `ToolHistoryBlock` then computes `live = threadBusy && lastView.kind==="live"` (`ChatView.tsx:1152-1153`), so a still-running/pending-confirm block renders as a done chip and the narration looks like the final answer. The `tool.start` fallback row that creates this shape is real (`useWebSocket.ts:713-743`).
  - **X2: TRIGGERED** 鈥?`archiveToolPayload` default tier collapses non-sensitive bodies into the `{redacted,len,sha256}` envelope with the comment explicitly stating the reuse is so the panel keeps saying "鍑轰簬瀹夊叏鏈寔涔呭寲" (`companion/src/security/tool-persistence-redact.ts:272-327`), and the panel copy is hardcoded security dialect (`ChatView.tsx:1724-1736`) 鈥?product omission is mislabeled as a security fold; I keep BLOCK because it launders the genuine SEC-C dialect's meaning.
  - **X3: TRIGGERED** (MAJOR correct) 鈥?spawn_worker L2 preview omits `goal` (`companion/src/tool/l2-admission.ts:329-330`) and the HMAC binding omits it too (`companion/src/security-policy.ts:95-101`), while sibling `spawn_expert_team` binds goal (`security-policy.ts:103-106`) and production dispatch hard-requires goal (`companion-dispatch.ts:179-187`); a swapped-goal token passes `validateTokenFor` inside TTL.
  - **X4: TRIGGERED** 鈥?`kickWorkerChat` (`companion/src/server.ts:765-794`) naked-calls `chatCreate` inside `scheduleWhenLlmSlotAvailable` with no `abortControllers.set`/signal; `abortThreadChat` without a controller returns `stopped:false` and does not release the gate (`message-router.ts:235-249`); `fleet.stop_all` funnels through it (`message-router.ts:4438`) and Glance `llm_active` is derived from the same abort-map keys (`companion/src/orchestrator/fleet.ts:70-73,107`) 鈥?kicked workers are unstoppable and invisible as busy.
  - **X5: TRIGGERED** (MAJOR correct) 鈥?circular keep-alive confirmed: `FocusBand` mounts `FleetStrip` only while `fleetFresh` (`FocusBand.tsx:66-75,163-167`), `FleetStrip` polls `fleet.status` every 4s (`FleetStrip.tsx:66-71`), `buildFleetSnapshot` always stamps `at: new Date()` (`fleet.ts:156`), and `SET_FLEET` wholesale-replaces it (`agentStore.tsx:1995-1996`) 鈥?an idle done-fleet squats on FocusBand for the panel session.
  - **X6: TRIGGERED** (MAJOR correct) 鈥?the archive toggle only dispatches `SET_CONFIG` and shows "宸插紑鍚? (`SettingsSlideout.tsx:3457-3464`); sibling toggles fire `config.set` immediately (`3253-3270`); persistence waits for footer save (`handleSave` 426-433); the slice spec itself says the toggle should `config.set` (`docs/superpowers/plans/2026-09-18-502-b-archive-stub.md` Task 2).
  - **X7: TRIGGERED** (MAJOR correct) 鈥?kernel emits `task_loop.suggest` for unarmed `round_limit` with unticked items (`companion/src/loop/loop-kernel.ts:365-379`), and `ChatView` renders `RoundLimitHint` ("鍥炲缁х画") and `LoopSuggestCard` (arm CTA) as independent blocks with no mutual exclusion (`ChatView.tsx:566-580`).
  - **X8: TRIGGERED** (MAJOR correct) 鈥?rebuild prefers the live mirror over the persisted row (`companion/src/llm/adapter.ts:436-441`), and `quarantinePersistedToolRow` only `updateMessage`s the persisted row, never touching `mirror.toolResults` (`adapter.ts:283-331`) 鈥?a same-process continuation re-feeds the quarantined body to the model.
  - **X9: TRIGGERED** 鈥?I re-executed after recompiling: 12 tests, 7 pass / 5 fail, every failure `INVALID_ARGS` vs expected `SPAWN_PACK_FAILED`/`SPAWN_INTENT_FAILED` (fixtures in `companion/tests/p2-deep-diagnosis-batch.test.ts:93-141` and `spawn-rollback-demote.test.ts` mint no `goal`); Linux CI will be identically red.
  - **X10: TRIGGERED** (MAJOR correct) 鈥?`handlers/config.ts` has no `embedded_terminal` branch (grep + `git log -S` show it never had one), so the UI's `config.set { embedded_terminal:{enabled} }` (`SettingsSlideout.tsx:3262-3270`) is silently dropped; pre-existing since #435, but this branch's C slice extends PTY gated on that flag (`companion/src/pty/handler.ts:74-75`) and fixed the identical bug class one allowlist entry away 鈥?fail-closed direction noted.

  ## New findings (only if grounded)

  None. Everything I saw decomposes into X1鈥揦10; no new BLOCK with an independent root.

  ## ADR-020

  - Surface: pass 鈥?declaration matches diff (side panel stream, Settings, existing full-page terminal tab; PTY handler is the declared C slice).
  - L2-classes: pass as declaration (no new class; spawn_worker preview/HMAC goal gap is honestly declared and tracked as X3).
  - Compose: pass 鈥?no new runtime; fleet stays ADR-015 threads, ACP stays composition.
  - Autonomy: **fail** 鈥?X4 (kick bypasses abort map / stop_all cannot stop); fleet-accept-does-not-arm independently verified OK (`LoopStatusRow.tsx:188-226` builds `chat.send`/steer, no `task_loop.arm`).
  - Trust: fail on dialect honesty (X2); redact monotonicity holds 鈥?redaction is unconditional before archive and archive never un-redacts (`tool-persistence-redact.ts:313-315`).
  - Channel: pass (community).
  - Blast: T2 declared; machine gate is red (X9), so the confirmation order fails at step 1 regardless of adversary verdicts.
  - originWs: no new/changed `securityConfirmations.request` found in the inspected #514 paths 鈥?no regression.

  ## Notes

  - I downgraded nothing; severities in the synthesis are defensible at every point I checked. X10 is pre-existing rather than diff-introduced, but the branch extends the gated feature, so MAJOR stands.
  - X9 is independently re-executed on this machine (not just the orchestrator's run): `node scripts/run-tests.mjs .test-dist/tests/p2-deep-diagnosis-batch.test.js .test-dist/tests/spawn-rollback-demote.test.js` 鈫?5/12 red.
  - Blocking issues: X1 (`tool-history-view.ts:386-391` + `ChatView.tsx:484-492`), X2 (`tool-persistence-redact.ts:272-283` + `ChatView.tsx:1724-1736`), X4 (`server.ts:765-794` + `message-router.ts:235-249,4438`), X9 (`companion/tests/p2-deep-diagnosis-batch.test.ts:93-141`, `companion/tests/spawn-rollback-demote.test.ts:65-90,184`).

  VERDICT: REJECT

