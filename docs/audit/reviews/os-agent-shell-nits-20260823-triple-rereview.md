# Triple rereview — OS Agent Shell reject-fold

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Branch | `feat/os-agent-shell` @ `659bbce` + dirty tree (reject fold) |
| Reviewer | Independent (not the implementer); inspected the real tree, ran the machine |
| Prior | ARCH/CORRECTNESS/PRODUCT-UX REJECT → fold; SECURITY/CODE-QUALITY APPROVE_WITH_NITS |
| Synthesis | `docs/audit/reviews/os-agent-shell-nits-20260823-synthesis.md` |
| Capability (ADR-020) | Surface L0 overlay · Trust lease + S23 · Channel community |

## Machine (executed on this tree)

| Step | Result |
|------|--------|
| `companion` `tsc -p tsconfig.test.json --pretty false` | exit 0, zero diagnostics |
| `node --test` overlay-session + composer-lease + summoner-journeys + companion-ui-rects | **48 pass / 0 fail** |
| `shasum -a 256 dist/cmspark-tray` | `ad1bb71639edc1a3e2e462433a5ad9f09ae7826bf75072935519ba895053596b` == `SWIFT_TRAY_SHA256` (`swift-tray-bridge.ts:59`) — **match** |
| Placeholder in binary | `说点什么，按回车发送…` present byte-exact ×1 in `dist/cmspark-tray` (UTF-8 byte scan; macOS `strings` misses multibyte CJK — a `strings`-based miss is a tooling false negative) |
| Full suite (extra, not required) | 15 failures reproduced (12 executor dialog/L2/budget/X1/WP2/M1 · 2 computer-uia-watch · 1 resolveAllowDirToOffer) — attribution below |

## Fold-claim verification (read in the real tree, not the synthesis)

1. **releaseAll only when overlay closed (`live === false`)** — VERIFIED. `overlay-session.ts:44-50` (`hydrateOverlayIfLive`) and `:58-63` (`claimOverlayIfLive`): after a claim, a stale token with a newer live generation returns `"abandoned"` **before** any `releaseAll`; release runs only when `live === false`. Behavioral tests hold it: `stale hydrate does not releaseAll while a newer overlay session is live`, `close during claim releases the overlay lease it just took`, `claimOverlayIfLive close-during-claim releases`. The pre-fold clobber (stale hydrate killing a newer live overlay's leases) is gone.
2. **handleSummonerReady begins session before listThreads** — VERIFIED. `menu-bar-agent.ts:672` `beginOverlaySession()` at entry; `listThreads()` at `:683`; token threaded into `handleSummonerNewThread(token)` (`:690`) and `hydrateSummonerThread(…, token)` (`:692`). The "submit before ready" hole closes structurally: `handleSummonerSubmit` (`:726-738`) claims via `claimOverlayIfLive` with the current token, and `submitSummonerTalk` (`client.ts:150-151`) aborts without `chat.create` when the claim no-ops (journeys test locks claim-before-chat.create ordering).
3. **hide() cancels searchTimer; emitSearch guards isOpen** — VERIFIED. `Tray.swift:1619-1621` invalidates + nils the timer before `orderOut`; `emitSearch` (`:1856-1858`) has `guard isOpen`. Esc (`cancelOperation` → `hide()`, `:1822-1825`) can no longer fire a post-close `#` search; `windowWillClose` → `emitClosedIfOpen` flips `isOpen` first, so any residual timer is a no-op.
4. **empty `#` → zero hits** — VERIFIED both sides. Node: `client.ts:85-89` empty needle → `encodeSummonerHits({ hits: [] })` — no newest-thread steal; `handleSummonerSearch` auto-hydrates only on exactly 1 hit (`menu-bar-agent.ts:777`). Swift: `refreshHits` clears hits for an empty needle (`Tray.swift:2031-2035`). Tested with `#`, `#   `, and `""`.
5. **companion.ui.rect WS → daemon applyCompanionUiRectEvent** — VERIFIED end-to-end. Swift emits Quartz-top-left rects on open/hide/relayout (`Tray.swift:42-58, :1616, :1623, :2260`) → bridge callback (`swift-tray-bridge.ts:543-546`) → forward over the summoner WS (`menu-bar-agent.ts:1233-1241`) → schema check (`validate.ts:81-86`) → ACL allow (`summoner-acl.ts:29`) → daemon applies into the module map (`message-router.ts:1038-1041`) → executor hard-denies click/scroll/drag against it (`executor.ts:1371-1383`, `assertClickClearsCompanionUi` throws `COMPANION_UI_CLICK_DENIED`). The S23 SoT now lives in the executor's process — the architecture BLOCK (rects stuck in the tray process) is closed. `self-ui.ts:53-56,91-102` process-continue deny for `cmspark-tray`/`com.cmspark.agent`/`com.cmspark.host` still holds.
6. **chat.regenerate lease + conductor gated** — VERIFIED. `message-router.ts:1106-1111` runs `gateChatCreateOnLease` then `gateChatCreateOnConductor`, mirroring `chat.create` (`:306-309`). `l2-conductor.ts:19-32` denies summoner-surface sends only while a computer task is live — no new conductor, no new L2 class.
7. **Placeholder in Swift and binary** — VERIFIED. `Tray.swift:1436` `说点什么，按回车发送…`; byte-exact in the hash-pinned binary (so the binary is the current source build, not a stale artifact).
8. **close clears summonerThreadId** — VERIFIED. `handleSummonerClosed` (`menu-bar-agent.ts:699-705`): invalidate session → `summonerThreadId = null` → release all overlay leases. Swift `emitClosedIfOpen` (`Tray.swift:1774-1779`) emits `summoner.closed` exactly once; server-side summoner-socket death also releases overlay holds (`composer-lease.ts:295-301`) — double coverage.

## Full-suite failures — attribution

15 failures reproduced on the dirty tree. They are **not fold-caused**:

- The fold's only `executor.ts` change is 10 lines: an import + three `assertClickClearsCompanionUi` guards that are provably inert while the rect map is empty (per-process module state; no test in `computer-executor.test.ts` registers rects).
- The two new S23 tests append at `:1212+`, after the failing tests (`:338+`), and exercise the FG-yield path, not rects.
- Failure names/assertions (re-L2 counting, budget, X1 dialog channels, watch pause, allow-dir) match the set the prior lane diffed against `origin/main` in clean worktrees: zero failures on the dirty tree that don't also fail on main.

These are pre-existing branch/main debt outside this fold's scope — tracked, not introduced here.

## Nits (non-blocking; new ones first)

1. **NEW — `#`-mode Enter with zero hits submits the literal search text.** `Tray.swift:1836-1844`: search-mode `insertNewline` with empty hits falls through to `submitComposer()`, and `submitComposer` (`:1892-1902`) has no `#` guard — bare `#` + Enter sends `"#"` as a chat message; `#needle` with no title match sends `"#needle"`. Visible in the transcript (not silent), but it contradicts the v2 contract "`#` 前缀=标题检索，其余=说话". Suggest: search-mode Enter with zero hits is a no-op (or strips the `#`).
2. **NEW — idle-resume setting is inert for 10/30.** `client.ts:187-194` `shouldStartNewSummonerThread` returns true only for `resumeIdleMinutes === 0`; `now`/`lastActivityAt` are never compared, so 10 (the default) and 30 behave exactly like -1 (always resume). The Swift settings row still promises "再打开 · 超时后新对话" with 10分钟/30分钟 buttons (`Tray.swift:2395-2417`), and the docstring overpromises. Either implement `now - lastActivityAt > idle` or collapse the UI to the two poles it implements.
3. **Drag → stale S23 rect.** No `windowDidMove` handler; the overlay is a movable `.titled` panel and the daemon rect refreshes only on open/hide/relayout (`refreshLog` re-lays-out only on height change). Fail-open at the overlay's new position, fail-closed at the old one. Already adjudicated NIT-5 by the security lane (fail-closed for L2 — overlay has no Allow/Deny); fold `windowDidMove` when overlay ships during CU.
4. **Tray-side dead rect map.** `swift-tray-bridge.ts:543` applies rects into the menu-bar process's module copy, which nothing reads in the dual-process topology (executor is in the daemon). Harmless redundancy; confusing duplicate SoT.
5. **Build hygiene.** `dist/tray/swift-tray-bridge.js` still embeds the old pin `2b4c23…` while the on-disk binary and source pin are `ad1bb716…`. Run `npm run build` before shipping or the runtime integrity check from `dist` will fight the correct binary. Untracked build output, not a branch defect.
6. **Rect events accept all surfaces** (hud/tray/pairing) from a summoner-surface socket with no size sanity cap — a paired local client can deny CU clicks over arbitrary screen areas (self-DoS, same-trust residual as the rest of the surface).
7. **Stale-claim residue (narrow race).** A claim started under generation N that completes after a close→reopen (generation N+1) holds thread X's overlay lease while the overlay shows Y; registry `claim` releases overlay siblings except the claimant, so a late stale claim can revoke the newer session's lease until the next select/reopen re-claims. Failure mode is a typed `OVERLAY_STANDBY` on the next overlay send with an obvious recovery; tests cover close-during-claim, not reopen-during-claim.
8. Carried nits, already approved with nits last round: `claim.holder` not bound to handshake surface (local HMAC composer DoS); `key`/`type` skip the rect gate; `sawBrowserUnavailable` survives hydrate; latent `com.cmspark.tray` bundle-id continue if ever bundled; y-coordinate uses `NSScreen.main` height only (multi-monitor); `Tray.swift` remains a ~2700-line god-file.

## Capability check (ADR-020)

- **Surface**: L0 overlay; composer is lease-gated on both `chat.create` and `chat.regenerate`; conductor gate while CU LIVE; close ≠ abort. No new L2 classes, no new tools. Holds.
- **Trust**: S23 coordinate hard-deny now enforced in the executor process against a daemon-side SoT; process-continue deny held; binary in SHA lockstep with the pinned hash. Holds, modulo the drag-staleness nit.
- **Channel community**: title-only `#` search with honest hint; empty needle no longer steals the newest thread. Holds.

## Bottom line

All eight fold claims are real in the tree, the machine is green, the three REJECT causes (S23 SoT topology, stale-hydrate lease clobber + submit-before-ready, search timer / empty-`#` / placeholder) are closed with code and behavioral tests that would go red on regression, and the fold introduces no new full-suite failures beyond pre-existing main debt. What remains is polish: one honest-contract slip in the `#` Enter fall-through, an inert settings control, and a list of already-adjudicated residuals.

VERDICT: APPROVE_WITH_NITS
