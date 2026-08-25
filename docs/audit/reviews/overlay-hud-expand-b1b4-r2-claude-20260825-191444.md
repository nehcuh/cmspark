Verification complete. Compiling the review.

## Dual external review — overlay-hud-expand-b1b4-r2 (compose workbench)

**Patch freshness [executed]:** the 191444 patch bundles both the staged Slice-B layer and the r2 unstaged worktree on top. Current `git status` matches; the r2 delta is real in the worktree. Per instructions I judged the **worktree** (staged+unstaged vs HEAD `2dee37a`).

### Machine claims — reproduced [executed]
- All 8 summoner suites: **171 pass / 0 fail** (claim said 119 — actual is higher, all green). `chrome-extension` markdown-breaks: 2 pass.
- `tsc --noEmit` exit 0.
- Pin lockstep: worktree `SWIFT_TRAY_SHA256` (`swift-tray-bridge.ts:59`) == `shasum -a 256 companion/dist/cmspark-tray` == `ed4dbfa0…` ✓.

### REJECT gates — all hold [inspected + executed]
- **R1**: `mcp.add`/`knowledge.import`/`config.set` absent from `SUMMONER_ALLOW` (summoner-acl.ts:14-44) and `SUMMONER_WEB_DISPATCH_ALLOW` (summoner-web.ts:20-42); test-enforced. T3 paths ride the tray `companionClient` (handshake surface=tray, menu-bar-agent.ts:1855); mcp.add still passes `requireMcpStdioSpawnConfirm` (handlers/mcp.ts:244-262) which **fails closed** without a confirmation channel.
- **R2**: `applySummonerPayloadPolicy` (summoner-acl.ts:71-126) forces thread.update → alias-only and thread.delete → mode=trash. Applied in lifecycle.ts:1038-1051 **after** ACL and **before** `stampCmsparkSurface` — server-stamped, unspoofable; also applied at summoner-web `dispatchAllowed`. Web test proves `{alias, tool_whitelist:null}` dispatches as `updates == {alias}` only.
- **R3**: zero Allow/Deny/确认 chrome in SummonerOverlay.swift (test-enforced `doesNotMatch /允许|拒绝|Allow|Deny|确认/`). The L2 stdio confirm reuses the pre-existing `show-confirm` tray command (Tray.swift:505) and `showConfirmDialog` bridge — no new dialect; NSAlerts are 添加/导入/取消 input dialogs.
- **R5**: pack.apply summoner path (message-router.ts:3004-3043) still forces overlay-eligible manifest check, strips workspace_path/force_takeover/confirmation_phrase, rejects trust cookie, and `allowTrust: !overlayApply`.
- **R6**: policy strips extra keys + caps 32 string ids; router (message-router.ts:2644-2660) filters ids against `skillEngine.listKnowledge()` known set.

### Folded fixes — verified in worktree
- ● state reads `thread.list` full threads (`active_skill_ids`/`active_knowledge_ids` from `listThreads()` in `pushSummonerRail`) ✓
- `companionClient.onAppMessage` answers `security.confirmation.request` via `showConfirmDialog` (menu-bar-agent.ts:1827-1847); mcp.add timeout 60s ✓. C-thin HTML toggle-on has no confirmation responder (`security.confirmation.response` ACL-denied on summoner) → fails closed at timeout ✓
- knowledge.import sends UTF-8 `content`; router `loadKnowledgePayload` has the `rest.content` string branch (message-router.ts:411-413) ✓
- C-thin HTML has the 5 tabs + `/api/*`; PATCH/DELETE are origin-gated (summoner-web.ts:357-361) ✓

### ADR-020 checklist
Declaration present and accurate. Composition axis correct (packs/skills/knowledge/MCP as compose, no “中层 Agent”); pack-first respected; no new confirm family (reuses L2 stdio spawn + tray dialog); trust monotonic (summoner strictly weaker; stdio toggle-on still L2); originWs — confirm rides the requesting socket itself; no new runtime. Clean.

### Nits (non-blocking)
1. **Index hygiene (must fix before commit, not before merge judgment)**: staged index still carries superseded Slice-B (Tray.swift HTML routing + pin `367b3e29…`). Worktree is correct; restage so `git commit` can't snapshot the stale pin/routing. This was external r2's BLOCK — resolved in worktree, pending restage.
2. **Binary knowledge import degrades silently**: SummonerOverlay.swift `knowledgeImportClicked` falls back to `base64EncodedString()` for non-UTF-8 files, but menu-bar sends it as `content` (text branch) — picking a .docx/.pdf imports base64 gibberish. Restrict `NSOpenPanel.allowedContentTypes` to text types, or route the base64 fallback via `file:{name, content}`.
3. **Router-level unknown-id filter untested**: message-router.ts:2652-2654 (ids ⊆ knowledge list) has no direct unit test; the policy test only covers key-stripping/type filtering.
4. **Stale dist artifacts**: `companion/dist/*.js` (pin `9716da43…`, no knowledge.set_active) lags src. Gitignored so outside the diff, but a production `npm start` right now mismatches the tray hash → auto-rebuild; rebuild dist before packaging.

VERDICT: APPROVE_WITH_NITS
