Verification complete. All reject gates checked against live code, tests executed, adversary findings spot-checked.

## Dual external review — Overlay HUD Expand B0.5 (thread manage)

**Patch freshness** [executed]: working tree extends the patch (later batches nspanel-restore/hud-a/expand-b0 folded in same files); every B0.5-critical behavior re-verified against live files, not just the patch.

### REJECT gates — all dark [inspected + executed]

- **R1 (hard-delete)**: `applySummonerPayloadPolicy` (summoner-acl.ts:71-79) rejects any summoner-surface `thread.delete` whose `mode !== "trash"` — omitted and `hard` both → `SUMMONER_ACL`. Gate sits at both overlay entry paths: WS lifecycle (lifecycle.ts:1045, after method ACL, before `stampCmsparkSurface`) and HTTP `dispatchAllowed` (summoner-web.ts:166). Tray default stays hard (message-router.ts:1608, untouched). Tests cover trash/hard/omitted/tray (summoner-thread-manage.test.ts:39-67).
- **R2 (composition keys)**: `thread.update` rewritten to `{ alias }` only (summoner-acl.ts:81-100); `tool_whitelist`/`active_knowledge_ids` stripped when alias present, rejected when keys-only. Router's broad update key set (message-router.ts:2190-2207) stays reachable only for tray/sidepanel. HTTP PATCH is alias-only by construction (summoner-web.ts:424-426).
- **R3**: zero 允许/拒绝/Allow/Deny/确认/`summoner.confirm.*` in SummonerOverlay.swift [executed grep].
- **R4**: `shasum -a 256 companion/dist/cmspark-tray` == `SWIFT_TRAY_SHA256` `e06875…` [executed]; swift-tray-integrity test green.
- **R5**: both shells manage threads — Swift ⋯/right-click → NSAlert → `summoner.thread.rename/trash` → handlers (menu-bar-agent.ts:1172/1198); HTML PATCH/DELETE with buttons.
- **R6**: `SUMMONER_ALLOW` grows only `thread.delete`+`thread.update`; no `knowledge.*`/`mcp.add`/`thread.restore`/`thread.batch_delete` (tests lock the negatives).

Handover (DoD 6): trashed threads are excluded from `thread.list` default scope (thread-manager.ts:656-660) despite `trash()` bumping `updated_at`; Mac picks `sortRecentFirst[0]` else new-thread (menu-bar-agent.ts:1222-1228); HTML `refresh()` now sorts by `updated_at` (folded, verified). Both folded adversary claims confirmed live: HTML recency sort, and the DELETE test now sends `mode=hard` in query+body → still dispatches `trash` (passes at status 200).

**Machine** [executed]: 164/164 pass across the 7 summoner suites; 33/33 across thread-cleanup/file-parser/swift-tray-integrity/ws-router-lockstep; `npx tsc --noEmit` exit 0.

**ADR-020**: declaration present and accurate. Trust monotonic (overlay strictly narrower than tray); native NSAlert/`window.confirm` are UX only — trust enforced server-side; no originWs surface touched; no new runtime; no bare 中层 Agent.

### Nits (non-blocking)

1. `swift-tray-bridge.ts:58` pin comment 「无左轨」 is false since B0's icon rail — hash itself correct.
2. Manage depth: `pushSummonerRail` sends 8 threads (menu-bar-agent.ts:787) while Swift renders `prefix(12)`; `#` search hits can select but not rename/trash — manage loop incomplete beyond top-8.
3. Summoner `thread.create` still accepts `config_override` ungated (message-router.ts:1600; model-params keys only) — follow-up payload clause candidate.
4. Lifecycle/menu-bar wiring tests are source-regex (summoner-thread-manage.test.ts:115-162); policy itself is unit-tested, but no WS integration test (surface=summoner + mode=hard → SUMMONER_ACL, thread survives).
5. Whitespace-only alias on the stdin path silently no-ops (menu-bar-agent.ts:1174-1175) while WS/HTTP reject — inconsistent, no trust impact.
6. Busy thread is untrashable and the HUD has no abort (HTML has 停止) — honest safety tradeoff; document as parity limit, don't claim full manage parity.
7. Local `companion/dist` JS (17:06) predates the latest src edits — gitignored build artifact; rebuild before packaging (Swift binary is in lockstep).

B0.5's narrow claim holds: Companion-owned rename + trash on Mac HUD and C-thin HTML, overlay-safe at the payload level, pin lockstep, no confirm dialect, no ACL overreach. R1–R6 stay dark.

VERDICT: APPROVE_WITH_NITS
