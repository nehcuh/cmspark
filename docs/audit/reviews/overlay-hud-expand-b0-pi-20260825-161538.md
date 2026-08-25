All verification complete. Here is my review.

## Dual external review — overlay-hud-expand-b0

### Patch reality check
The patch mixes two generations: the **first section is the live working tree** (HUD expand), the **second is the stale staged dogfood-Slice-B impl**. `git status` confirms 5 `MM` files (Tray.swift, swift-tray-bridge.ts, summoner-web.ts, summoner-overlay.test.ts, summoner-web.test.ts) where the index still holds the REJECTED C-thin reroute + pin `367b3e29`. I judged the working tree, which is the newest state (binary rebuilt 16:15, sources 15:22–16:15).

### DoD verification (all checked against real source)

| # | Claim | Evidence |
|---|---|---|
| 1 | Chevron ⌄/⌃, workbench above composer | `toggleExpandClicked` (SummonerOverlay.swift:372); `expandButton?.title = expanded ? "⌃" : "⌄"` (:1008); `stack.addArrangedSubview(workbench)` at :1187 before `stack.addArrangedSubview(fieldBox)` at :1323 → composer at bottom ✓ |
| 2 | Icon rail + one thread list, no makeRail, no pack.apply | 52pt `railCol` with 5 SF-Symbol buttons (:1361-1388); single `threadListStack` (200pt, :1411); other sections render honest "这一类下一刀开放" empty pane (:383-390). `grep func makeRail` / `pack.apply` / `railPack` → 0 hits ✓ |
| 3 | applyThreads fills threadListStack | `applyThreads` → `threadRows` → `refreshThreadList()` → `threadListStack` (:330-351) ✓ |
| 4 | canBecomeKey; 📎 MIME + runModal | `class SummonerPanel: NSPanel { canBecomeKey: true }` (:18-20); `mimeTypeForAttach` never empty (octet-stream default, :50-58); `panel.runModal()` (:692); NSApp.activate+makeKeyAndOrderFront before panel (:685-686) ✓ |
| 5 | Pin == binary | `shasum -a 256 companion/dist/cmspark-tray` = `d0164b70ee0d…c93ac` == `SWIFT_TRAY_SHA256` (swift-tray-bridge.ts:59) — byte-identical ✓ |
| 6 | No Allow/Deny; no knowledge.* | 0 matches for 确认/Allow/Deny in overlay; `summoner-acl.ts` untouched vs HEAD; `SUMMONER_ALLOW`/`SUMMONER_WEB_DISPATCH_ALLOW` have no `knowledge.*`/`mcp.add` ✓ |

### REJECT gates — none triggered
- **R1** ACL growth: summoner-acl.ts has zero diff; DISPATCH_ALLOW changed only in copy (hint) + 📎 label. New `summoner.files` is inbound-only (tray→Node), mapped to already-allowlisted `file.upload`; `file.upload_error` maps to a plain `summoner.error`. No knowledge/mcp.add/confirm ✓
- **R2** old 200pt stacked rail / pack.apply chrome: deleted ✓
- **R3** composer below workbench: yes ✓
- **R4** pin ≠ binary: pin == live binary == rebuilt-after-source ✓
- **R5** canBecomeKey: present ✓

### ADR-020 capability checklist
Declaration present and matches the actual blast (Surface L0 HUD collapse/expand; L2 none; Compose thread list/select only; Autonomy n/a; Trust ACL unchanged; Channel community). Pack-first: no new pack semantics (pack.apply stays pre-existing, not added to overlay chrome). Trust monotonic: ACL byte-identical, confirm remains native-tray, no overlay Allow/Deny dialect, no knowledge.*/mcp.add. originWs: n/a — no new `securityConfirmations.request` surface. No "中层 Agent" language. Clean.

### Tests
`summoner-overlay/protocol/talk/client` = 122/122 pass; `summoner-web` = 23/23 pass. New tests cover canBecomeKey, workbench-above-composer order, applyThreads→threadListStack, runModal, octet-stream coercion, pin copy lock, and lease claiming.

### Nits (non-blocking)
1. **Stale index hazard**: 5 `MM` files still stage the REJECTED dogfood Slice B (C-thin reroute, pin `367b3e29`, old hint copy). A bare `git commit` without re-adding those files would land the rejected impl. `git add` the working tree before committing; the combined patch is noisy for the same reason.
2. `applyPacks`/`applyMcp` are now honest no-ops (`_ = json` / `_ = names`) — fine for B0, but wire or delete them in B1+ to avoid dead surface.
3. `summoner.files` decode caps 8 files but no total-size bound at protocol layer (Swift caps 6MB/file locally); acceptable for the loopback surface, worth a comment.

No blocking issues. The B0 DoD is met on every point and the five REJECT gates hold.

VERDICT: APPROVE_WITH_NITS
