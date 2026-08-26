All verification complete. Summary of my independent findings:

**Machine (re-executed myself):**
- 8-file tsx subset: **118 pass / 0 fail** ✓
- `shasum -a 256 companion/dist/cmspark-tray` = `34ed53a0…77b7c` = pin at `swift-tray-bridge.ts:59` ✓ (binary mtime 10:14:00 is newer than Swift source 10:13:56, so the rebuilt binary includes the post-adversary fold)
- Live tree matches the patch exactly (same 10 files / line counts via `git diff HEAD --stat`); patch not stale ✓

**I1–I8 on live source (all verified):**
- I1 `on:!on` `summoner-web.ts:1057`; I2 `ids:next` `:1075`; I3 UTF-8 fail-close `SummonerOverlay.swift:734-736`, base64 only on file-attach `:1048` (correct path); I4 tray ride `menu-bar-agent.ts:1629-1631` untouched; I5 `listScroll.documentView = tStack` `:1778`, `prefix(64)`×5, height anchors `:1789-1791`; I6 `dropped` `message-router.ts:2625-2630` + real `handleMessage` unit test; I7 paper HUD + flex layered, no `#12141c`; I8 `skill-engine.ts`/`distill.ts`/`content-sanitizer.ts` not in patch ✓

**R1–R6 (all HOLD, verified):**
- R1: `mcp.add`/`knowledge.import`/`config.set` absent from `SUMMONER_ALLOW` and `SUMMONER_WEB_DISPATCH_ALLOW`; R2: `thread.update` alias-only via `applySummonerPayloadPolicy`; R3: no Allow/Deny/`summoner.confirm.*` on HUD; R4: SHA pin == binary; R5: lock tests strengthened (flex/`.list-scroll`/`720,120`/`dropped`), not weakened; R6: ACL file untouched, `dropped` is additive response field ✓

**Post-adversary folds confirmed in live tree:** `placeWindow` collapsed 720×120 (`:784`, matches `shell-open.ts:55` and its lock); rail/list/log height pinned to workbench (addresses product-adversary nit #1). Both fold nits are now in the tree and test-locked.

**ADR-020:** declaration present and accurate; Surface HUD change with no new tools/gates, no new confirm dialect, trust monotonic, pack-first respected, no bare "中层 Agent".

Non-blocking nits:

1. Swift `prefix(64)` ×5 is a comment-coupled magic number vs TS `SUMMONER_RAIL_LIST_CAP` (`SummonerOverlay.swift:371,574,591,611,633`)
2. `dropped` is not surfaced in HUD/C-thin UI (protocol honesty only)
3. I3 copy says "md/txt" but any non-empty UTF-8 accepted (`SummonerOverlay.swift:734`)
4. I4 Win/Linux systray2 never-promise L2 remains a dead click (adjudicated; Darwin ride intact)
5. I7/I5 not pixel-run in a real Chrome `--app` / Mac HUD
6. I8 still lacks a `wrapKnowledgeBlock` breakout unit test (pre-existing)
7. Stale pin comment date ("2026-08-25 B1–B4"); `companion/dist/*.js` stale until `npm run build` (gitignored, ship-path only)
8. `esc()` omits `'` but is only used in text-node contexts — non-issue, note for future

VERDICT: APPROVE_WITH_NITS
