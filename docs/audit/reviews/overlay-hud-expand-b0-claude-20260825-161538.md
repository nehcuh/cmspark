All verification complete. Here is my review.

## Dual external review — Overlay HUD Expand B0

**Patch freshness** [executed]: the diff file (16:15:38) matches current working tree; `find -newer` shows no source/test file modified after capture; `git status` file set matches. The patch concatenates `git diff HEAD` (net state) + staged section — net effect is the native-HUD B0 on top of the staged Slice A / C-thin remnants.

### B0 DoD — all six verified

| # | Claim | Evidence |
|---|---|---|
| 1 | Chevron workbench above composer | [inspected] `toggleExpandClicked` → `expanded.toggle()`; vertical stack order `workbench` (SummonerOverlay.swift:1187) added before `fieldBox` (:1323), `hint` after (:1324); `relayout` adds 428 only when expanded |
| 2 | Icon rail + one list, no stacked labels | [inspected] 5 SF-symbol rail buttons (`railSpecs`), one `threadListStack`, honest “这一类下一刀开放” for non-对话； `makeRail`/`railThreadStack`/`railMcpField`/`railPackClicked` deleted; no `summoner.pack.apply` in overlay (`applyPacks` is a `_ = json` no-op) |
| 3 | `applyThreads` fills list | [inspected] `applyThreads` → `threadRows` → `refreshThreadList()` builds 12 rows with current-thread indigo highlight |
| 4 | `canBecomeKey` + 📎 MIME/runModal | [inspected] `SummonerPanel.canBecomeKey = true` (:19), panel constructed as `SummonerPanel(`; `attachFilesClicked` uses `runModal()`, `mimeTypeForAttach` defaults to `application/octet-stream` (never empty) |
| 5 | Pin == binary | [executed] `shasum -a 256 companion/dist/cmspark-tray` = `d0164b70…c93ac` == `swift-tray-bridge.ts:59`; binary (16:15:26) rebuilt after Tray.swift (15:22) and SummonerOverlay.swift (16:15:12) |
| 6 | No Allow/Deny; no knowledge.* | [inspected] No allowClicked/denyClicked/Allow/Deny in overlay; `SUMMONER_ALLOW` (ws/summoner-acl.ts, untouched by diff) has no `knowledge.*`/`mcp.add`/confirm; `SUMMONER_WEB_DISPATCH_ALLOW` unchanged (no `voice.stt.*`/`knowledge.*`) |

### Tests [executed]

- Full companion suite: exit 0 (includes 122 summoner tests + 23 web-shell tests, all green)
- chrome-extension: 819 pass / 0 fail (incl. new `markdown-breaks.test.ts`)

### REJECT gates R1–R5: none triggered

New `summoner.files` path mirrors the existing lease discipline (`claimOverlayIfLive` before upload, `OVERLAY_STANDBY` on conflict); `file.upload` is pre-existing on both ACLs; stdin decode validates shape (1–8 files, non-empty name/content).

### ADR-020 checklist

Declaration present and accurate (L0 Surface / none / thread-list-only Compose / n/a Autonomy / no trust growth / community). Pure Surface axis; pack-first respected (场景 rail slot is an honest placeholder, not merged); no new confirm dialect; trust monotonic; no `originWs` surface; no new runtime.

### Nits (non-blocking)

1. **Stale staged routing is a commit hazard**: the index still holds the user-rejected C-thin `Tray.swift` (menu → `click action=summoner`) with pin `367b3e29…`, which no longer matches the `d0164b70…` binary. Committing only the staged half would trip the S-P0-2 integrity hard-fail at launch. Re-stage the MM files together before committing.
2. **Optimistic 📎 line vanishes on fresh-thread path**: `attachFilesClicked` appends “你： 📎 …” before upload, but `handleSummonerFiles` hydrates with `lines: []` when it creates a new thread (menu-bar-agent.ts:~1135), clearing the acknowledgment. Cosmetic.
3. **Size cap asymmetry**: the 6MB/file + 8-file cap lives only in Swift; `decodeSummonerInbound` (protocol.ts) validates count/shape but not size, so a ~64MB base64 line rides the readline buffer unbounded. Trusted local pipe + user-chosen files, but mirroring a total-bytes cap in decode would harden the boundary.
4. **Dead UI retained**: `lastThreadField`/`footRow`/`sendButton`/`continueButton` are now permanently hidden (`applyPhase` hard-codes `isHidden = true`) but still constructed; `applyMcp`/`applyPacks` are no-op stubs. Fine for B0 reversibility — prune when B1–B4 land.
5. **No height ceiling in relayout**: pickerBox (310) + workbench (428) + base 72 = 810pt can exceed small screens; only a 72pt floor exists.

VERDICT: APPROVE_WITH_NITS
