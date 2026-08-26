# Dual external review: overlay-post222-residual-fix

**Base:** `origin/main` `a58b78f` · uncommitted fold on `fix/overlay-post222-residual` · patch file matches live tree (the patch's second section is the intermediate staged state; I verified the **final worktree** — tests pass against it).

## Machine `[executed]` by this review

| Check | Result |
|---|---|
| `npx --offline tsx --test` (8-file subset) | **118 pass / 0 fail** — matches claim |
| `shasum -a 256 companion/dist/cmspark-tray` | **`34ed53a0…7b7c`** = live pin `swift-tray-bridge.ts:59` — **R4 clear** (the one gate all four lanes deferred to the dual) |
| Binary ↔ source correspondence | binary contains the I3 fail-close string (rg -a, 1 hit); mtimes: Swift 10:13:56 → binary 10:14:00 → pin 10:14:10 — binary built from current source, pin not swap-faked |

## R gates — all HOLD

- **R1** `SUMMONER_ALLOW` / `SUMMONER_WEB_DISPATCH_ALLOW` omit `mcp.add`/`knowledge.import`/`config.set`; router extra-denies `knowledge.import` on summoner surface (message-router.ts:2639-2641) `[inspected]`
- **R2** `applySummonerPayloadPolicy` rewrites `thread.update` to `{alias}` only (summoner-acl.ts:87-105); C-thin PATCH hardcodes alias (summoner-web.ts:432) `[inspected]`
- **R3** zero Allow/Deny/`summoner.confirm` in SummonerOverlay.swift (grep) + lock tests `[inspected]`
- **R4** executed above
- **R5** I1–I8 all genuinely CLOSED in live source (below); lock tests **strengthened** (summoner-web.test.ts:118-127 added flex/`.list-scroll`/`flex-shrink:0`/`w=720` asserts; :545-546 still demand `on:!on`/`ids:next`; shell-open test untouched, source moved to it) `[inspected]`
- **R6** `summoner-acl.ts` not in the 10-file diff; `dropped` is response-only; dispatch allow ⊆ WS allow `[inspected]`

## I1–I8 — all CLOSED, live tree

| ID | Live evidence |
|----|---------------|
| I1 | `on:!on` summoner-web.ts:1057; server maps false→deactivate (:476-483) |
| I2 | `ids:next` :1075 (union/difference of `active_knowledge_ids`) |
| I3 | Swift :734-735 UTF-8 fail-close; base64 only in `attachFilesClicked`/mic (:1004,:1048), not knowledge import |
| I4 | `/api/mcp/toggle` → `mcp.toggle_server` → `dispatchSummonerWeb(client,…)` (menu-bar-agent.ts:1650); menu-bar-agent diff touches only the rail cap |
| I5 | `prefix(64)` ×5 (:371,574,591,611,633); `listScroll.documentView = tStack` :1778; cap shared via `SUMMONER_RAIL_LIST_CAP` (protocol.ts:19, menu-bar-agent.ts:792) |
| I6 | message-router.ts:2624-2630 `dropped`; unit test really calls `handleMessage` with ghost-id (passed) |
| I7 | paper + flex live (:628,:650,:676); no `#12141c` (test-enforced); `720,120` shell-open.ts:55 |
| I8 | `skill-engine.ts` / `threads/distill.ts` / `content-sanitizer.ts` absent from the 10-file diff |

**Post-adversary nits both folded:** `placeWindow` `720×120` (summoner-web.ts:784) and column height pins (Swift :1789-1791, hanging off the fixed workbench height :1537 — satisfiable, no conflict with `alignment = .top`). Both postdate the adversary snapshots and predate the rebuild. Pin comment also updated to 2026-08-26.

## Adversary lanes — confirmed

All four APPROVE_WITH_NITS verdicts are **calibrated, not lenient**: each ran `[inspected]`-only on R4 and explicitly deferred the shasum to the dual (now executed); security/product/impl each caught real intermediate-state issues (500×140, unpinned column heights, stale pin comment) that were subsequently folded. I found no missed blocking issue: the summoner-web.ts diff is confined to the HTML template + JS (no route/handler/SSE/token surface changed), the `esc()` innerHTML switch is loopback-only and escaped, and the experimental label survives in `<title>`. Boundaries respected as adjudicated.

## ADR-020 checklist

Declaration present. No new axis entity, no bare 中层 Agent; Pack-first respected (rails expose existing `pack.apply`); no new confirm dialect (L2 stays tray); trust monotonicity intact (summoner strictly weaker than tray, second router gate added previously retained); originWs n/a (no new `securityConfirmations.request`); no new runtime.

## Nits (non-blocking)

1. `companion/dist/*.js` stale vs src (external/impl lanes): `npm start` would serve pre-fold dark HTML until `tsc` — rebuild before any runtime dogfood/ship.
2. Swift `prefix(64)` magic ×5 comment-coupled to TS `SUMMONER_RAIL_LIST_CAP` — drift risk.
3. `dropped` not surfaced in HUD/C-thin UI (protocol honest; click paths send known ids).
4. I3 copy says md/txt but accepts any non-empty UTF-8 (`.html` becomes markdown; still F-S-1 wrapped).
5. Cap-64 silent truncation; `#` search still `hits.prefix(6)` — no “还有 N 条” affordance.
6. I5/I7 not pixel-run (AppKit scroll-doc + Chrome `--app` flex accepted structurally only).
7. Pre-existing: no `wrapKnowledgeBlock` unit test; Win/Linux systray2 never-promise L2 dead click (adjudicated boundary).
8. C-thin titles use `innerHTML`+`esc()` where `textContent` would suffice (`&<>"` covered; low risk on token-gated loopback).
9. Process note: synthesis `merge: NO` pending Pi re-review — this verdict confirms the 4-lane APPROVE*; it does not waive that step.

Prior REJECT's R5 is genuinely repaired: paper HUD restored with dfab3eb flex layered on top, lock tests tightened, not retargeted.

VERDICT: APPROVE_WITH_NITS
