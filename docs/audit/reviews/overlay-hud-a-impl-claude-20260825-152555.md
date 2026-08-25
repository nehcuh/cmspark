All verification complete. Here is my review.

## Dual external review — Overlay HUD A implementation (`overlay-hud-a-impl`)

**Patch freshness** [executed]: worktree is the HUD A state; the patch file's duplicate `Tray.swift`/`swift-tray-bridge.ts` sections reflect the still-staged superseded Slice B (index) vs the live worktree — see nit 1. HEAD `2dee37a` matches.

### DoD verification

1. **NSPanel borderless HUD** [executed/inspected]: `SummonerOverlay.swift:933` `[.borderless, .fullSizeContentView, .nonactivatingPanel]`, `:936` `titleVisibility = .hidden`; Esc → `cancelOperation` → `hide()` (`:447-449`); `makeRail` deleted from source and absent from binary strings. No `summoner.pack.apply` emit — `applyPacks`/`applyThreads`/`applyMcp` are inert (`_ = json`) ✓. Worktree `Tray.swift:374`/`1409-1415` routes menu/hotkey to `summonerController.open`/`openFromHotKey` (native HUD, not `--app`) — R3 cleared.
2. **📎 closure** [inspected]: Swift `mimeTypeForAttach` default `application/octet-stream` — never `"type":"""`; Node `menu-bar-agent.ts:1125` coerces empty→octet-stream; `:1140` `claimOverlayIfLive` same claim form as submit/new_thread; hydrate only when `createdFresh` (`:1143`) so no transcript clobber; `client.ts` maps `file.upload_error`→`summoner.error` (behavioral test green).
3. **6MiB cap, skip visible** [inspected]: `SummonerOverlay.swift:606` `summonerFileMaxBytes = 6MiB`, `prefix(8)`, skip → visible `applyError` (`:621-623`), optimistic `你: 📎 names` line (`:626`).
4. **Hint** [executed]: binary contains `知识配置去侧栏` (`grep -ac` = 1); overlay source has zero Raycast/uTools matches.
5. **ACL** [executed]: `SUMMONER_WEB_DISPATCH_ALLOW` unchanged (`summoner-web.ts:18-33`); no `getUserMedia` anywhere in the file; `knowledge.list`/`voice.stt.start` asserted absent (tests green). Swift 🎙 is the pre-existing AVFoundation `summoner.mic.*` tray path (`SummonerOverlay.swift:538-571`), not HTML STT — within Trust declaration.
6. **validate.ts** [inspected]: `ws/validate.ts:781` truthy `type` intact; file untouched by diff.
7. **R5 pin** [executed]: `SWIFT_TRAY_SHA256` = `6ce8f1d8…` = `shasum -a 256 companion/dist/cmspark-tray`. Binary contains `application/octet-stream`, no `makeRail`.
8. **Tests** [executed]: 5 summoner suites 143 pass + `summoner-acl` 9 pass = **152/0** (matches claim); `markdown-breaks.test.ts` 2/0. `activePackId` in scope (`PacksPanel.tsx:875` vs use at `:911`).

### ADR-020 checklist

Declaration present and accurate (L0 Surface / none / no pack apply in overlay / n/a / ACL 不涨 / community). Pure Surface axis; pack UI removed rather than added; no confirm family; trust monotonic (file.upload rides existing lease + validate gates); no new `securityConfirmations.request` so originWs n/a; no new runtime. Clean.

### Nits (non-blocking)

1. **Index still holds the vetoed Slice B** — `Tray.swift`, `swift-tray-bridge.ts`, `summoner-web.ts`, `summoner-overlay.test.ts`, `summoner-web.test.ts` are `MM`: staged = Darwin→HTML routing with pin `367b3e29`; worktree = HUD A with pin `6ce8f1d8`. A commit of the index as-is ships mixed state (pin ≠ dist binary → auto-rebuild to the HTML-routing binary the user rejected). Re-stage before committing.
2. **Machine claim over-claims** [executed]: "Binary … does not contain … Raycast/uTools 形态" — the binary contains `Raycast / uTools` and `Raycast/uTools` (hotkey-stolen tooltips in `Tray.swift`, pre-existing at HEAD from `edc5fe0`, outside the overlay file and test scope; not a 形态 self-claim). The blanket negative is literally false even though R4's substance holds.
3. **Batched upload vs WS ceiling** [inspected]: `handleSummonerFiles` sends all files in one `file.upload` frame; 6MiB/file is only under `WS_SOFT_MAX` (~9.75MB, `lifecycle.ts:70-73`) for a single file. Two ~6MiB files get stamped `file.upload_error "Message too large"` (`lifecycle.ts:871-878`) → now visibly mapped in the HUD, so no silent loss — but the advertised "最多 8 个 × 6MB" can't be delivered in one batch. HTML path is HTTP POST, unaffected. Consider per-file frames or a total-payload cap in Swift.
4. **Empty-MIME coercion is only grep-tested**: the spec (§2) asked tests not be grep-only; `file.upload_error` mapping is behavioral, but the `""`→`octet-stream` coercion in `handleSummonerFiles` is only source-regex asserted (`summoner-overlay.test.ts:1068-1077`).
5. Redundant double-application of `breaks/gfm` (module `marked.use` + per-parse options in `ChatView.tsx:56`/`1535`) — harmless, already noted at direction review.

VERDICT: APPROVE_WITH_NITS
