# Triple rereview — OS Agent Shell reject-fold

**Reviewer**: independent (not the implementer). **Branch**: `feat/os-agent-shell` @ `659bbce` + dirty tree. **Method**: read the real tree, ran the machine, cross-checked every fold claim against source and binary, and diffed full-suite failures against `origin/main` via clean worktrees to separate fold regressions from pre-existing breakage.

---

## Machine (executed on this tree)

| Step | Result |
|------|--------|
| `tsc -p tsconfig.test.json` | exit 0 |
| 4 required test files | **48 pass / 0 fail** |
| `shasum -a 256 dist/cmspark-tray` | `ad1bb716…0596b` = `SWIFT_TRAY_SHA256` (src) **MATCH** |
| Placeholder in binary | `说点什么，按回车发送…` present as UTF-8 at offset 153184 (raw byte scan; `strings` misses multibyte) |

## Fold claims — all 8 verified against the tree

1. **releaseAll only when closed** — `overlay-session.ts`: both `hydrateOverlayIfLive` and `claimOverlayIfLive` return `"abandoned"` via `if (live)` **before** `releaseAllLeases()`. Close (`invalidate` → `live=false`) still releases — locked by `close during claim releases` + `claimOverlayIfLive close-during-claim releases`. The P1-1 regression test `stale hydrate does not releaseAll while a newer overlay session is live` exists and is **behavioral** (drives the real function, asserts `released === 0`); it would go red if the fold regressed.
2. **ready begins session before listThreads** — `menu-bar-agent.ts:672` `const token = beginOverlaySession()` at entry, then `await client?.listThreads()` (`:683`), then the token is passed into `hydrateSummonerThread(token)` / `handleSummonerNewThread(token)` (`:690-696`). Closes P1-2 (submit-during-ready silent drop): a submit now has a live token.
3. **hide() cancels searchTimer; emitSearch guard** — `Tray.swift:1619-1621` `searchTimer?.invalidate(); searchTimer = nil` before `orderOut`; `emitSearch` (`:1856`) has `guard isOpen`. Esc (`cancelOperation` → `hide()`) can no longer fire a delayed `#` search post-close. Closes UX B1.
4. **empty # → zero hits** — `summonerHitsFromQuery` returns `hits: []` for empty needle (`client.ts:87-89`); behavioral test `empty # query yields zero hits (does not steal newest thread)` passes; `handleSummonerSearch` only hydrates on exactly 1 hit.
5. **rect WS → daemon apply** — full chain: Swift `emitCompanionUiRect` (top-left coords, `hidden:true` on nil) → `swift-tray-bridge` `onCompanionUiRect` → `menu-bar-agent.ts:1233-1240` forwards via `sendAppMessage("companion.ui.rect")` → `validate.ts` schema → `summoner-acl` allows → `message-router.ts:1038-1040` `applyCompanionUiRectEvent` **in the daemon** → `executor.ts:1371+` `assertClickClearsCompanionUi` (click/scroll/drag). Arch BLOCK-1 (rects stuck in tray process) is closed.
6. **chat.regenerate lease + conductor gated** — `message-router.ts:1107-1110` `gateChatCreateOnLease` + `gateChatCreateOnConductor`; `l2-conductor.ts` denies `surface==="summoner"` while a computer task is live; 4 behavioral conductor tests pass.
7. **placeholder in Swift and binary** — source `Tray.swift:1436`, binary contains the full string; sha lockstep matches.
8. **close clears summonerThreadId** — `menu-bar-agent.ts:701` `summonerThreadId = null` right after `invalidateOverlaySession()`, before the release RPC.

## Full-suite regression sweep

I ran the **entire** companion suite on the dirty tree and on `origin/main` (clean worktrees). Dirty: 3107 pass / 15 fail. Main: 17 distinct failures. **`comm` diff of failure sets: zero failures on the dirty tree that don't also fail on main** — the 12 executor dialog-pause/L2/budget/M1 failures, 2 `computer-uia-watch` failures, and `resolveAllowDirToOffer` are all pre-existing on main (out of this branch's scope). `settings-web.test.js` actually *passes* on the branch. The fold's own new S23 executor tests (`cmspark-tray FG yield → re-L2`) pass.

## Nits (non-blocking)

1. **Stale dist artifact**: `dist/tray/swift-tray-bridge.js` still embeds the *old* hash `2b4c23…` while the on-disk binary is `ad1bb7…`. Run `npm run build` before shipping, or the runtime integrity check from `dist` will refuse the (correct) binary. Untracked build output, not a branch defect.
2. **`claimOverlayComposerLease` still returns `Promise<void>`** and swallows CAS failure — a failed claim proceeds to `sendChatCreate` and soft-fails via server `OVERLAY_STANDBY` (prior P2, unchanged). `submitSummonerTalk` now aborts on `claimed === false`, but the void path can't express failure.
3. **Claim 2 has no behavioral test at the glue layer** — ready-begins-before-listThreads is verified by inspection; primitives are tested but `handleSummonerReady`/`handleSummonerSubmit` ordering is not driven. Residual P2 race: a submit during ready's `listThreads` may target a different thread than ready's resolved target; failure mode is defined (`chat.error`/`OVERLAY_STANDBY`), not silent.
4. **`chat.regenerate` gate test is source-grep** (`composer-lease.test.ts:188`), not behavioral; the conductor gate itself is behaviorally covered.
5. **Tray process applies rects locally** (`swift-tray-bridge.ts:543`) — a dead rect map in the menu-bar process (executor lives in the daemon); harmless, slightly confusing.
6. **Rect events accept all surfaces** (hud/tray/pairing) from a summoner surface — a paired, integrity-checked client could deny CU clicks over arbitrary areas. Consistent with ADR-020 "Trust lease + S23", but worth noting.
7. Prior security/code-quality nits (latent bundle-id continue, `key`/`type` skip rect check, overlay drag no rect refresh, Tray.swift god-file) remain — already approved with nits last round.

## Bottom line

All three REJECT lanes are substantively closed with code **and** behavioral tests that would fail on regression, the machine is green, the binary is in sha lockstep and contains the new placeholder, and the fold introduces **zero** new test failures beyond what main already carries. Remaining issues are build-hygiene and soft-fail P2s.

VERDICT: APPROVE_WITH_NITS
