All verification complete. Here is my independent review.

## Dual external review — overlay-dogfood-slice-ab IMPLEMENTATION

### Patch freshness
Patch base `2dee37a` == current HEAD; `git status` file list matches the patch exactly. Not stale. ✓

### DoD verification (all executed against live repo)

**Slice A**
- `ChatView.tsx:56` `marked.use({ gfm: true, breaks: true })` + per-parse options (`:1535`). Only one `marked.parse` site in the extension; DOMPurify already allows `br`. ✓
- `PacksPanel.tsx:911` meetingCard accent **only** when `activePackId === "meeting-minutes"`; default background `tokens.bg` (was unconditional accent). ✓
- `PacksPanel.tsx:997-1002` `itemActive` for `isActive` rows; `isActive` = `activePackId === p.id` (exclusive per row). ✓
- New `markdown-breaks.test.ts` passes; full extension suite 819/819 green.

**Slice B**
- R2: menu summoner → `jsonLine(["type":"click","action":"summoner"])`; `handleSummonerHotKeyPressed` → same. No `summonerController.open` from menu/hotkey. Node side `case "summoner"` → `openSummonerWebShell()` (`menu-bar-agent.ts:1345-1346`) → loopback HTML. ✓
- 📎 `label for="files"` over hidden `<input type=file>`; hint copy honestly reroutes 听写/知识配置 to sidebar. ✓
- R1: `SUMMONER_WEB_DISPATCH_ALLOW` (16 entries) unchanged — no `knowledge.*` / `voice.stt.*` / confirm; no `getUserMedia` in summoner-web.ts (only pre-existing side-panel voice tabs). ✓
- R4: no knowledge admin in overlay. ✓

**R3 pin (the adversarial dispute — settled)**
`shasum -a 256 companion/dist/cmspark-tray` = `367b3e29b0f7355c5ee26f6eb64bbc8c1aa368eb003f0acb5b19eb3473b9e862` — **exactly** the pinned `SWIFT_TRAY_SHA256`. The impl r2 REJECT claim was indeed false (overlay-split pin was `77139e17`). Binary integrity additionally confirmed rebuilt-from-source: binary mtime 14:07 > `Tray.swift` 14:06, `strings` contains `"action": "summoner"` and **no** `openFromHotKey`. src → binary → pin all in lockstep. ✓

**R5 AppKit freeze**
`SummonerOverlay.swift` untouched by this diff; `micButton?.isHidden = true` (921), `attachButton?.isHidden = true` (909), zero `NSOpenPanel` in tray Swift. Remaining `summonerController.open` (`Tray.swift:560`) lives only in the stdin `summoner.open` handler, and **no Node code emits `summoner.open`** anymore (protocol.ts types only) — dead, unreachable path, consistent with "frozen-but-not-deleted". Hotkey picker stays as the spec's allowed Swift config surface. ✓

**Tests**: companion 3567+20 pass / 0 fail (incl. new "Tray.swift menu and hotkey open C-thin HTML" + extended summoner-web assertions); extension 819 pass / 0 fail.

### ADR-020 checklist
Declaration present and accurate (Surface L0 / L2 none / Compose pack-highlight UI only / Autonomy n/a / Trust ACL unchanged + no getUserMedia / Channel unchanged) — matches actual blast. Pure Surface-axis; no new tools/gates/runtime; no "中层 Agent" language; workbench not merged into radio; trust monotonic; `originWs` n/a. Clean.

### Nits (non-blocking)
1. When `meeting-minutes` is the applied scene, both the workbench card (911) and the pack row (997) highlight — DoD-literal, but the card's "不是「已选场景」" spirit is slightly blurred; visual check recommended.
2. Dead Swift hydrate/composing path (`summoner.open` stdin, removed composing guard) — spec-sanctioned, but deserves a tracked cleanup ticket so it can't re-grow.
3. `markdown-breaks.test.ts` asserts source-text regexes (`/breaks:\s*true/`) on ChatView/PacksPanel — brittle under refactor; the live `marked.parse` render assertion mitigates.
4. `marked.use` global + per-parse options double-applies (harmless, as direction nit #5 noted).

No blocking issues. All five reject gates hold; every factual premise and the pin dispute check out against the live repo.

VERDICT: APPROVE_WITH_NITS
