All verification complete. Here is my review.

## Dual external review — `overlay-hud-expand-b1b4-r2` (compose workbench)

### Patch freshness (executed)
`git diff HEAD --stat` matches the patch header exactly (26 files, +2037/−295, base `2dee37a`). Spot-checked `summoner-acl.ts`, `message-router.ts`, `menu-bar-agent.ts`, `swift-tray-bridge.ts` against the patch — in sync. **Not stale.**

### Machine claims (verified)
- `tsc --noEmit` → exit 0 (companion).
- Companion suite: **3567 pass / 0 fail** (incl. `summoner-acl`, `summoner-overlay`, `summoner-web`, `summoner-protocol`, `summoner-client`, `summoner-talk`, new `summoner-thread-manage`, `summoner-workbench-compose`).
- Chrome-extension suite: **819 pass / 0 fail** (incl. `markdown-breaks.test.ts`).
- `shasum -a 256 companion/dist/cmspark-tray` = `ed4dbfa0…` == `SWIFT_TRAY_SHA256`. **R4 holds.**

### REJECT gates (all hold)
- **R1** — Overlay ACL (`ws/summoner-acl.ts` `SUMMONER_ALLOW`) and `SUMMONER_WEB_DISPATCH_ALLOW` (summoner-web.ts) contain **no** `mcp.add` / `knowledge.import` / `config.set`. Both allowed-lists tested (`summoner-workbench-compose.test.ts`, `summoner-acl.test.ts`).
- **R2** — `applySummonerPayloadPolicy` (summoner-acl.ts:60-122) mutates `thread.update` to `{alias}` only and requires `thread.delete mode=trash`; applied on both the WS path (`ws/lifecycle.ts:1047`) and the web `dispatchAllowed` path. Web `/api/thread` PATCH hardcodes `updates:{alias}`; test sends `tool_whitelist:null` and asserts it is stripped.
- **R3** — Swift HUD has zero Allow/Deny/确认 chrome (grep of `SummonerOverlay.swift` clean; dialogs are 重命名/取消, 移到回收站/取消, 添加/取消, 导入/取消). `summoner.confirm.*` rejected in protocol decode.
- **R4** — pin == binary (verified above).
- **R5** — Router `pack.apply` (message-router.ts:2990-3048) forces `allowTrust: !overlayApply` (false on summoner), `isOverlayEligiblePack` check, forbidden-field block, `user_gesture:true` server-side (both `CompanionClient.applyPack` and web endpoint hardcode it).
- **R6** — `knowledge.set_active`: payload policy strips extra keys (`tool_whitelist` test); router filters ids against `skillEngine.listKnowledge()` names (message-router.ts:2644-2659) and caps at 32.

### Folded requirements (verified in code)
- Skill/knowledge ● state reads full `thread.list` (`menu-bar-agent.ts` `pushSummonerRail` → `listThreads()`, `active_skill_ids`/`active_knowledge_ids`), not `thread.select.thread`. ✓
- Tray `companionClient.onAppMessage` (menu-bar-agent.ts:1827-1847) answers `security.confirmation.request` via `showConfirmDialog` (Swift `show-confirm` → native dialog, self-timeout → deny); `mcp.add` from tray uses 60s timeout. Fails closed — overlay WS `security.confirmation.response` is ACL-denied before the lifecycle intercept. ✓
- `knowledge.import` tray path sends UTF-8 `content` (not `file.content` base64); router `loadKnowledgePayload` accepts `content`. ✓
- C-thin HTML has 对话/场景/知识/技能/MCP tabs + `/api/*` fetches; no `/api/mcp/add`, no `/api/knowledge/import`. ✓
- Pack/mcp/skill/knowledge rails live in Swift; menu-bar maps compose stdin to overlay-safe (`summonerClient`) vs tray-origin (`companionClient`) paths correctly (`handleSummonerMcpAdd`/`handleSummonerKnowledgeImport` use `companionClient`; toggles/attach use `summonerClient`). ✓

### ADR-020 capability checklist
Declaration present and accurate: L0 HUD workbench Surface; no L2 classes on HUD (mcp.add stdio spawn reuses tray L2); Compose = threads + packs.apply + mcp.toggle + skill toggle + knowledge USE + HITL import; Autonomy n/a; Trust monotonic (overlay strictly weaker — new writes are trash/alias-only/known-id-filtered, `mcp.add`/`knowledge.import` stay off overlay WS; tray confirm is user-mediated native dialog, no auto-approve); Channel community unchanged. No bare "中层 Agent", no Allow/Deny dialect, no `originWs`-new-confirm concern (new confirms are tray-surface, user-clicked).

### Nits (non-blocking)
1. **HTML skills tab is one-way** — `summoner-web.ts` HTML onclick hardcodes `on:true` for `/api/skills/toggle`, so the C-thin shell can activate but never deactivate a skill, and shows no on/off state. Swift HUD toggles properly; DoD 8 "toggle" is only half-satisfied in HTML.
2. **HTML knowledge tab replaces selection** — `ids:[id]` overwrites the thread's active set on each click (no toggle, no multi-select, no detach), unlike the Swift HUD's add/remove toggle.
3. **`knowledge.import` base64 fallback** — `SummonerOverlay.swift` `knowledgeImportClicked` sends `content: String(data, encoding:.utf8) ?? data.base64EncodedString()`; a non-UTF8 file (e.g., PDF) is imported as a base64 text blob rather than failing with a clear error.
4. **HTML enabling a disabled stdio MCP server stalls ~45s** — `mcp.toggle_server` needs an L2 confirm the overlay WS cannot answer (correctly denied), so the HTML MCP tab times out and errors; fails closed but is a slow dead UX. The Swift HUD path (tray confirm dialog) is fine.
5. Untracked-but-unstaged `summoner-thread-manage.test.ts` / `summoner-workbench-compose.test.ts` should be staged with the rest when committing (worktree judged per instruction, so not blocking).

No incomplete fixes, no security regressions, no wrong file:line claims, no over-claiming found. All six reject conditions hold; DoD 1–8 met.

VERDICT: APPROVE_WITH_NITS
