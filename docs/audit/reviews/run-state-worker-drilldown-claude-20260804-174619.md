## Findings — Independent re-review of `run-state-worker-drilldown` design SoT

**Scope confirmed:** This is a **design-SoT-only** review (implementation not started). The actual artifacts are the new spec `docs/superpowers/specs/2026-08-04-run-state-and-worker-drilldown.md` and adversary synthesis. The attached `.patch` file (`run-state-worker-drilldown-diff-20260804-174619.patch`) is **stale/misleading** — its contents are unrelated outbound-mcp / autopilot-tier hunks captured from the dirty working tree, not run-state diff. I verified all spec claims directly against the source.

### Grounding claims verified `[inspected]`

| Claim | Code anchor | Verdict |
|---|---|---|
| Composer gates only on `streamingContent` | `App.tsx:287,294-299` (`canSend = !isStreaming && ...`) | ✓ true |
| Stop button only on streaming | `App.tsx:646,667` (`!isStreaming`, `isStreaming ?`) | ✓ true |
| `SET_ACTIVE_THREAD` clears busy | `agentStore.tsx:274-282` (`streamingContent:"", isProcessing:false`) | ✓ true — drill-down causes false-idle |
| `tool.start` has no `thread_id` | `useWebSocket.ts:360-377` (uses `activeThreadRef.current`) | ✓ true — `tool.progress` already filters via `shouldApplyStreamEvent` (line 400) but `tool.start` does not |
| `enterWorker` exists but unreachable in Panel | `FleetStrip.tsx:67-71,73-80` (`focusBand` → `cockpit.open`, never expands in-band) | ✓ true — W1 is net-new nav, not copy change |
| `classifyFleetActivity` treats idle workers as active | `focus-band-priority.ts:135,138` (`worstStatus === "idle"` → active; missing status fail-open) | ✓ true — explicitly forbidden as RunBusy driver in §2.1 |
| Fleet `worst_status` only `idle/paused/holding_tabs` | `companion/src/orchestrator/fleet.ts:16,33,53-78` | ✓ true — idle ≠ done |
| FocusBand ≤80px + overflow:hidden | `FocusBand.tsx:199-200` (`maxHeight:FOCUS_BAND_MAX_PX`, `overflow:"hidden"`) | ✓ portal required (F-I2) |
| Abort ≠ next to Send | UIUX v2 `2026-07-31-sidepanel-uiux-redesign.md:190` | ✓ R7 satisfied |

### Rejection gates R1–R7

| Gate | Status | Evidence |
|---|---|---|
| R1 RunBusy ≠ worker_count / unfiltered idle-active | ✓ | §2.1 pure-fn forbids it; §6 explicit "禁止用「有 idle worker」触发"; §10 risk mitigation |
| R2 W1 not shipped without W2-min / thread_id | ✓ | §8 Q4-lock "W0 + companion thread_id + W1 + W2-min 同 ship"; §8 explicit prohibition |
| R3 No auto-spawn / worker L2 lift / mid-layer runtime | ✓ | Capability decl `Trust: no elevation`; F-S7 floor; §9 non-goals ("新「中层 Agent」runtime" forbidden by ADR-020) |
| R4 Follow-up doesn't steal lease / no default force-release | ✓ | §2.3, §5.3, F-S3, F-S4 — force-release is 次级 in lock partition only |
| R5 Stop-target can't silently use wrong activeThread when stamp exists | ✓ at design level | F-S1 explicit "缺戳记 deny-safe，禁止静默 fallback". **Note:** current `MinimalConfirm.tsx:32,88` does `request.worker_id || activeThreadId` — silent fallback today; spec mandates change. |
| R6 Confirm priority not demoted under fleet popover | ✓ | §7 "FocusBand 不改优先级"; F-S6; portal goes to root (§5.2 F-I2) so cannot bury MinimalConfirm |
| R7 Composer Abort ≠ L2 急停 relocation | ✓ | §4.2 explicit "Composer 停止 ≠ L2 急停"; UIUX §4.3 line 190 honored |

### Adversary floors absorption (16/16)

All F-UX1–5, F-S1–6, F-C1–3, F-I1–4 are written into the SoT with anchors in §2.1, §4.2, §5.0–5.5, §6, §7, §8, §12. In particular F-C1 (RunBusy pure fn + P0 scope honesty) and F-I3 (W1 history-only) are explicit, not just implied.

### ADR-020 capability checklist

Declaration complete and accurate. No Surface lift, no new L2-classes, no new confirmation family, no Surface→Autonomy confusion. Pack-first N/A (no new scenario surface). Trust monotonicity preserved (Composer Stop is a non-L2 thread abort; does not weaken any L2/CU/spawn gate). Worker drill-down is **navigation + visibility**, not a new agent runtime — no "bare 中层 Agent" violation.

---

### Non-blocking nits

1. **Stale patch file.** `docs/audit/reviews/run-state-worker-drilldown-diff-20260804-174619.patch` contains unrelated outbound-mcp/autopilot hunks. Process nit only — doesn't affect design correctness, but should be regenerated or relabeled to avoid reviewer confusion.
2. **Multi-run banner pollution (P0 scope).** §6 banner predicate uses process-wide `lockCount/openIntents/anyHoldingTabs` (sourced from `FleetStrip.tsx:33-37` summed across all workers). When two `orchestrator_run_id`s coexist, another run's locks can drive this run's "编排本轮已结束 · 子任务还在跑" banner. §2.1 acknowledges ("P1 可按 orchestrator_run_id 过滤") but no acceptance test guards the P0 false-positive. Consider adding to §11 acceptance: "filter §6 banner by active orchestrator_run_id when known."
3. **`llm_active` shape undecided.** §2.1 hedges ("companion abortControllers keys 或 fleet.llm_active") and §8 marks it 可选. Either is fine but should be pinned before W0 ships.
4. **F-S1 implementation gap.** Current `MinimalConfirm.tsx:32,88` `request.worker_id || activeThreadId` performs silent fallback. Spec floor mandates deny-safe behavior when stamp missing in multi-agent. Tracking issue recommended so implementer doesn't preserve today's silent fallback.
5. **Glossary tokens (F-UX4).** Exact Chinese copy for "停止本轮 / 停止该子任务 / 全停" and the "进入子任务" CTA (vs "查看进展") not pinned in §13; deferred to implementation. Listed as non-blocking per prompt.
6. **ScopeBar ≤28px budget self-check.** §5.2 sets the budget but §7 closes with "竖向预算自检（实现前填实数）" — fine, but the spec could note the ChatStream worst-case band (UIUX v2 §P7 "L2+confirm ≥40%") explicitly to prevent ScopeBar erosion.

VERDICT: APPROVE_WITH_NITS
