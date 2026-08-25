All verification complete. Here is my review.

## Dual external review — `overlay-hud-a-impl` (HUD A, SUPERSEDES Slice B)

### Patch freshness [executed]
`HEAD` = `2dee37a` = patch base. Working-tree diff for the key files matches the patch's **first** block. Note: the patch file is a concatenation — block 2 (pin `367b3e29`, C-thin `click action=summoner`) is the stale `overlay-dogfood-slice-ab-impl` diff (142137, already superseded). Only block 1 reflects HEAD. Not stale; cosmetic doc issue.

### DoD verification (all executed against repo)

1. **Native HUD shell** — `SummonerOverlay.swift:makeWindow` = `[.borderless, .fullSizeContentView, .nonactivatingPanel]`, `titleVisibility = .hidden`; `func makeRail` deleted with zero remaining `railThreadStack/railPackStack/railMcpField/mcpField` refs; Esc → `cancelOperation` → `hide()` → `orderOut` (:447, :232-235); no `summoner.pack.apply` anywhere in overlay (rail pack buttons deleted, `applyPacks` no-op). ✓
2. **📎 closed loop** — `mimeTypeForAttach` always returns non-empty MIME (default `application/octet-stream`), no `"type": ""`; Node `handleSummonerFiles` re-coerces empty → octet-stream and uses `claimOverlayIfLive` (mirrors `handleSummonerSubmit`); `mapChatMessageToSummonerCmd` maps `file.upload_error` → `summoner.error` with `upload_failed` + `thread_id`. `ws/validate.ts:781` truthy-`type` gate untouched (not in diff). ✓
3. **6MiB cap, skip visible** — `summonerFileMaxBytes = 6*1024*1024`; all-skip → explicit error; partial-skip → "部分附件已跳过"; optimistic `你: 📎 names` line. ✓
4. **Hint/copy** — Swift hint has `知识配置去侧栏` (present in source AND in live binary, UTF-8 byte check); no Raycast/uTools in HUD code/comments. ✓
5. **ACL** — `SUMMONER_WEB_DISPATCH_ALLOW` unchanged (no `knowledge.*`, no `voice.stt.*`); web test asserts `knowledge.list`/`voice.stt.start` absent. ✓
6. **Pin** — `SWIFT_TRAY_SHA256` = `6ce8f1d8…` == `shasum -a 256 companion/dist/cmspark-tray` = `6ce8f1d8…`. R5 holds. ✓

### ADR-020 checklist
Declaration present and accurate (L0 Darwin HUD / L2 none / Compose overlay no pack-apply + knowledge USE via thread ids / Autonomy n/a / Trust ACL unchanged + no HTML getUserMedia + 📎 via existing `file.upload` / Channel community). Pure Surface axis; no new tools/gates/confirms; no "中层 Agent" language; Pack-first respected (workbench not merged into radio); trust monotonic (file.upload already lease+conductor gated); originWs n/a. **Tests**: summoner core suites 143/0, supplementary summoner suites 819/0, chrome-extension markdown-breaks 2/0 — all green.

### Nits (non-blocking)

1. **Machine claim imprecision**: "binary does not contain Raycast/uTools" is technically false — the binary holds 2× "Raycast / uTools" strings from the **pre-existing** hotkey-occupancy registry (`Tray.swift:1345/1350` `SummonerHotKeyStolen`/`occupiedBy`), which is tray-menu conflict copy, not HUD 形态 self-description (F-UX-NOUN-1 holds). Wording should be "no Raycast/uTools 形态/self-claim".
2. **`attachFilesClicked` reads before capping** (`SummonerOverlay.swift:~599`): `Data(contentsOf:)` runs synchronously on the main thread with the 6MiB check applied *after* the read — a multi-GB file selection blocks the AppKit main thread. Prefer `URLResourceValues.fileSize` / stat before reading.
3. **Protocol decode caps neither size nor content length** (`protocol.ts` `summoner.files`): max 8 files and non-empty name/content enforced, but no base64-length cap at the decode boundary (producer is the SHA-pinned local binary, so low risk; a 6MiB raw → ~8MiB base64 mirror would harden it).
4. **Patch file concatenation**: `overlay-hud-a-impl-diff-20260825-152555.patch` appends the stale 142137 slice-ab diff; future reviewers could misread the C-thin/pin-`367b3e29` block as current. Keep the diff generation to `git diff HEAD` only.

No REJECT conditions (R1–R5) fire; DoD 1–6 all verified against live source, binary, and tests.

VERDICT: APPROVE_WITH_NITS
