# OS Agent Shell — reject-fold rereview (triple lane, independent)

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Branch | `feat/os-agent-shell` @ `659bbce` + dirty tree (reject fold applied) |
| Reviewer | Independent triple rereview (not implementer) |
| Prior | ARCH/CORRECTNESS/PRODUCT-UX REJECT → fold; SECURITY/CODE-QUALITY APPROVE_WITH_NITS |
| Synthesis | `docs/audit/reviews/os-agent-shell-nits-20260823-synthesis.md` |

## Machine results (all run, this tree)

| Step | Result |
|------|--------|
| `tsc -p tsconfig.test.json --pretty false` | exit 0, zero diagnostics |
| `node --test` overlay-session + composer-lease + summoner-journeys + companion-ui-rects | 48 pass / 0 fail |
| `shasum -a 256 dist/cmspark-tray` | `ad1bb716…53596b` == `SWIFT_TRAY_SHA256` (`swift-tray-bridge.ts:59`) ✓ |
| Placeholder in binary | `说点什么，按回车发送…` present ×1 in `dist/cmspark-tray` (byte-exact; earlier `strings`/`grep -a` miss was a tooling false negative, confirmed via byte search) |

## Fold-claim verification (each read in the real tree)

1. **releaseAll only when overlay closed** — VERIFIED. `overlay-session.ts:47-50,60-63`: after a claim, a stale token with `live === true` (newer generation) returns without touching leases; `releaseAll` runs only when `live === false`. Covered by tests `stale hydrate does not releaseAll while a newer overlay session is live` and `close during claim releases the overlay lease it just took`.
2. **handleSummonerReady begins session before listThreads** — VERIFIED. `menu-bar-agent.ts:672` `beginOverlaySession()` precedes `listThreads()` at :683; token threaded into `handleSummonerNewThread(token)` (:690) and `hydrateSummonerThread(…, token)` (:692). The prior "submit before ready" hole is closed structurally: `handleSummonerSubmit` (:729) claims via `claimOverlayIfLive` with the current token; `submitSummonerTalk` (`client.ts:150-151`) aborts without `chat.create` when the claim no-ops.
3. **hide() cancels searchTimer; emitSearch guards isOpen** — VERIFIED. `Tray.swift:1619-1621` invalidates+nils the timer; `emitSearch` at :1856-1858 has `guard isOpen`. Residual timer after `windowWillClose` (no hide) is a no-op because `emitClosedIfOpen` (:1774-1779) flips `isOpen` first.
4. **Empty `#` → zero hits** — VERIFIED both sides. Node: `client.ts:86-88` empty needle returns `hits: []` (no newest-thread steal). Swift: `refreshHits` (`Tray.swift:2031-2035`) clears hits when the needle is empty. Test `empty # query yields zero hits` passes.
5. **companion.ui.rect WS → daemon applyCompanionUiRectEvent** — VERIFIED. Swift emits Quartz-top-left rects (`Tray.swift:42-58`) on open/hide/relayout; bridge applies locally (`swift-tray-bridge.ts:543`) and menu-bar-agent forwards over WS (`menu-bar-agent.ts:1233-1241`); daemon router applies (`message-router.ts:1038-1040`) into the map the executor enforces (`executor.ts:1371-1383` click/scroll/drag hard-deny). S23 SoT now lives in the executor process — the architecture BLOCK is resolved. Type is validated (`validate.ts:81-86`) and ACL-allowed (`summoner-acl.ts:29`).
6. **chat.regenerate lease + conductor gated** — VERIFIED. `message-router.ts:1107-1110` runs `gateChatCreateOnLease` then `gateChatCreateOnConductor`, mirroring the `chat.create` gate (:306-309). Conductor denial is summoner-surface-only and only while a computer task is live (`l2-conductor.ts:19-32`).
7. **Placeholder in Swift and binary** — VERIFIED. `Tray.swift:1436` `说点什么，按回车发送…` (lengthened so it lands in `__cstring`); present byte-exact in the hash-pinned binary.
8. **Close clears summonerThreadId** — VERIFIED. `handleSummonerClosed` (`menu-bar-agent.ts:699-705`) invalidates the session, nulls `summonerThreadId`, then releases all overlay composer leases.

## Nits (non-blocking)

- N1 — Rect staleness on drag: no `windowDidMove` handler; the overlay is movable (`.titled` panel) and the daemon's S23 rect only refreshes on open/hide/relayout. A dragged overlay leaves a stale deny-zone (false denies at the old spot, false allows on the real one) until the next relayout. Recommend emitting on `windowDidMove`.
- N2 — Dual application: bridge applies the rect locally and the WS loopback applies it again into the same process map. Harmless redundancy; the WS path is the one that matters for the contract.
- N3 — `emitCompanionUiRect` converts y via `NSScreen.main` height only; secondary-display placement would misreport. Pre-existing pattern across hud/tray/pairing too.
- N4 — `Tray.swift` remains a ~2700-line god-file (carried-over code-quality nit; unchanged by this fold).

## Capability check (ADR-020)

- L0 overlay surface: lease-gated chat.create/regenerate; close ≠ abort. Holds.
- Trust lease + S23: lease registry with rev; S23 rects enforced in executor process. Holds, modulo N1.
- Channel community: `#` search is title-only with honest hint; empty needle no longer steals the newest thread. Holds.

VERDICT: APPROVE_WITH_NITS
