All verification complete. Here is my review.

## Dual external review — Overlay dogfood Slice A+B (IMPLEMENTATION)

**Patch freshness** [executed]: the patch file matches current staged `git status` exactly (8 code/test files + 7 docs, base `2dee37a`). Not stale.

### Adversarial claim — verified, correction upheld

[executed] `shasum -a 256 companion/dist/cmspark-tray` → `367b3e29b0f7355c5ee26f6eb64bbc8c1aa368eb003f0acb5b19eb3473b9e862` — equals the new src pin (`swift-tray-bridge.ts:59`) and the dist JS pin (`dist/tray/swift-tray-bridge.js:55`). The prior impl-r2 REJECT asserting `367b3e29` was the old hash is **false** — the diff itself shows the removed old pin was `77139e17…` (overlay-split). Build ritual is coherent: Tray.swift mtime 14:06 → binary rebuilt 14:07 → pin updated 14:18. The `summoner.composing` string still in the binary comes from unchanged `SummonerOverlay.swift:483`, not staleness.

### DoD verification

| Item | Evidence |
|---|---|
| A: `breaks: true` | `ChatView.tsx:56` module `marked.use({gfm:true,breaks:true})` + `:1535` per-parse; DOMPurify allows `br` (`:1538`) [inspected]; test 2/2 pass [executed] |
| A: meetingCard conditional | `PacksPanel.tsx:911` accent only if `activePackId === "meeting-minutes"`; default `background: tokens.bg` (`:1590`); `activePackId` = active thread's `mission_pack_id` (`:875-876`) — correct truth source [inspected] |
| A: pack `itemActive` | `PacksPanel.tsx:996` `isActive = activePackId === p.id`, exclusive highlight `:1000-1006`; workbench card stays outside the radio [inspected] |
| B: menu/hotkey → C-thin | `Tray.swift:374-376` menu → `jsonLine click action=summoner`; `:1408-1410` hotkey → same; only remaining `summonerController.open` is the stdin `summoner.open` handler (`:560`, frozen-by-design) [inspected] |
| B: Node side | `menu-bar-agent.ts:1345-1346` `case "summoner"` → `openSummonerWebShell()`; `summoner.ready` at `:1175` is a non-blocking event handler — no Mac-path wait [inspected] |
| B: 📎 label | `label class="btn ghost" for="files"` + hidden input in `summoner-web.ts`; tests assert 📎/`for="files"` [executed] |
| B: ACL clean | `SUMMONER_WEB_DISPATCH_ALLOW` (`summoner-web.ts:18-33`) unchanged — no `knowledge.*`/`voice.stt.*`; no `getUserMedia` anywhere in `companion/src` [inspected]; "dispatch allowlist is summoner-safe" test passes [executed] |
| SHA chain | src pin == dist JS pin == binary shasum, all three read directly [executed] |

### REJECT gates

R1 clear (no ACL growth, no getUserMedia) · R2 clear (no `summonerController.open` on menu/hotkey) · R3 clear (pin == live binary) · R4 clear (no knowledge admin in overlay) · R5 clear (`SummonerOverlay.swift` untouched, no NSOpenPanel, mic stays hidden). Tests [executed]: companion summoner suites 68/68, extension markdown-breaks 2/2.

### ADR-020 checklist

Declaration present and accurate (L0 Surface / none / UI-only / n/a / trust unchanged / channel unchanged). Pure Surface-axis honesty fix; no new tools, gates, or runtime; pack-first respected (workbench ≠ radio); trust monotonic (overlay allowlist byte-identical); no confirm/originWs surface touched. Clean.

### Nits (non-blocking)

1. `ChatView.tsx:56` + `:1535` — `gfm/breaks` applied twice (module `marked.use` and per-parse options). Harmless duplication; direction review predicted it.
2. `markdown-breaks.test.ts:10-19` — largely source-regex assertions; the behavioral half passes options straight to `marked`, so it validates the library rather than ChatView's wiring. Weak seam, acceptable without a DOM runner.
3. Hint copy: spec §3.3 says the hint should mention 听写 / 知识配置 / **批准** in the side panel; implemented hint (`summoner-web.ts:574`) omits 批准 and drops the prior 技能/MCP mention. Copy-level only.
4. Frozen Swift leftovers (`summoner.open` stdin handler `Tray.swift:560`, `summoner.composing` emitter, hydrate flow) retained per spec — direction review already requested a tracked cleanup ticket; still untracked.

VERDICT: APPROVE_WITH_NITS
