# Dual External Re-review — run-state-worker-drilldown (design SoT)

## Scope / diff sanity
`git status` matches the patch snapshot exactly (same tracked modifications + untracked docs) — patch is **not stale**. The batch delta is the new untracked design docs; the tracked-modifications portion of the snapshot is unrelated in-flight work (outbound-MCP P0c, autopilot full-autonomy cruise) — see Nit 3.

## Grounding spot-checks (code-verified)
| SoT claim | Reality | Status |
|---|---|---|
| `canSend = !streamingContent && …`; Stop 仅 `isStreaming` | `App.tsx:287,294-295`; Stop button only rendered inside `{isStreaming ? …}` (`App.tsx:667-668`) | ✅ |
| `SET_ACTIVE_THREAD` 清零 processing/streaming | `agentStore.tsx:281-282` | ✅ |
| `tool.start` 无 thread_id → activeThreadRef | `useWebSocket.ts:360-365` (fallback `activeThreadRef.current \|\| ""`); legacy empty-thread_id applies (`:98`, `shouldApplyStreamEvent`) | ✅ |
| FleetStrip focusBand 主点击 → Cockpit, 列表不可达 | `FleetStrip.tsx:74-76` `enterWorker` → `cockpit.open`; expandable list only `!focusBand` (`:126`) | ✅ |
| FocusBand 裁切 popover | `FocusBand.tsx:199-200,234` `maxHeight:FOCUS_BAND_MAX_PX; overflow:hidden` → portal requirement justified (F-I2) | ✅ |
| worker status 仅 idle/paused/holding_tabs, idle≠完成 | `fleet.ts:16,53-56` | ✅ |
| `classifyFleetActivity` idle worker → active | `focus-band-priority.ts:135-138` (`worstStatus==="idle"` → "active") — SoT **forbids** using this raw for §6 banner | ✅ |
| follow-up 不偷锁 (F-S4 basis) | `multi-agent-user-guide.md:74` | ✅ |

## Must-answer questions
1. **Product MAJOR_REVISE resolution**: All B1–B6 absorbed — W2-min same-ship (`§8` 同 PR, `§8` 禁止-only-W0+W1), always-on RunBusy chip as floor with ≤2-click SLA (`§5.1` 入口1, F-UX1), steer contract explicit (`§4.1` 中途纠偏 1–3), chrome budget capped ScopeBar ≤28px single-line + no triple-stack (`§5.2`, F-UX2), naming glossary F-UX4 (`§4.2`/`§5.3` copy). Resolved, not overridden. Adversary floors F-UX1–5, F-S1–7, F-C1–3, F-I1–4 all present in SoT.
2. **deriveRunBusy safety**: Pure fn, explicitly excludes paused_only and idle-residual workers, forbids raw `classifyFleetActivity` as driver — R1 satisfied. Multi-run pollution handled by honest P0 process-wide disclosure with P1 per-`orchestrator_run_id` filter as future (Nit 1).
3. **F-S1–F-S7 sufficiency**: Yes — F-S1 deny-safe stamp-priority with no silent activeThread fallback (R5 satisfied, correctly scoped "multi-agent 缺戳记时"), F-S5 mandatory lock-count chrome, F-S6 Confirm-primary, F-S7 spawn HITL/`WORKER_HARD_DENY`/no-lift regressions, all wired into `§11` acceptance.
4. **Portal + ScopeBar vs ≤80px**: Popover portaled outside FocusBand overflow (F-I2), fleet primary→popover keeps ≤80px + no third bar (`§12` UIUX footnote, `§7`), ScopeBar is Chat-top zone not FocusBand zone. Compatible.
5. **tool.\* thread_id mandatory**: Yes — companion step is in same ship (`§8`), `§5.4` W0+companion row, `§11` acceptance "tool.\* 带 thread_id；切线程不串台". R2 satisfied (W1 is history-only honest, F-I3).
6. **Blocking holes**: None found.

## Rejection gates — all pass
R1 ✅ (explicit prohibition, both §2.1 and §8) · R2 ✅ (same-ship lock + 禁止 clause) · R3 ✅ (§9 non-goals) · R4 ✅ (lease no-transfer + force-release secondary-only) · R5 ✅ (F-S1 deny-safe) · R6 ✅ (§7 priority unchanged + F-S6) · R7 ✅ (§4.2 Composer 停止 ≠ L2 急停; 急停 stays FocusBand/Safety).

## ADR-020 capability checklist
Declaration present in both prompt and SoT, axes fit (pure Autonomy/visibility work — no Surface lift, no Composition, no new runtime, no bare 中层 Agent language; worker ≠ 中层 runtime respected). No new confirmation family (F-S1 reuses MinimalConfirm stamps), no originWs change (no new `securityConfirmations.request`), no Pack-first violation (no new scenario/pack, chip is status chrome not a new surface). Trust monotonicity untouched by this design.

## Nits (non-blocking)
1. **`llm_active`/`llmActiveThreadIds` marked 可选** (`§8` companion step; `§2.1`). With locks/intents/holding absent and `llm_active` not shipped, a background pure-LLM turn (no streaming yet) can still read "就绪" — the original "突然又有回复" symptom is only fully closed for the *viewed* thread via ThreadBusy. Recommend making abortControllers-key push non-optional, or document the residual W0 window.
2. **§7 vertical budget placeholder**: "实现前填实数" — concrete numbers (chip + 28px ScopeBar + 80px FocusBand vs UIUX worst-path ChatStream ≥40%) still to be computed and verified; mandated but unproven at freeze.
3. **Patch snapshot contains unrelated in-flight changes** (`companion/src/server.ts` full-autonomy cruise waiving CRITICAL_API_GATE for browser script + cookie trusted-domain waive; `executor.ts` re-L2 auto-approve; `security-gates.test.ts` rewrite). Outside this batch's scope and tests are updated, but ensure that batch gets its own adversarial/dual gate before merge — it is a trust-monotonicity-adjacent change.
4. **F-S1 test item conditional**: `§8` lists "F-S1 stop 目标（若改 MinimalConfirm）" while F-S1 is an unconditional floor (`§5.5`) — make acceptance unconditional.
5. **Copy precision**: Composer stop on a worker shows subtitle「该子任务」— ensure glossary F-UX4 pins "停止该子任务" = abort-thread (worker keeps lease) vs "全停" = kill+release, so the F-S3 Pause≠Cancel≠全停 distinction holds in the worker context too.

VERDICT: APPROVE_WITH_NITS
