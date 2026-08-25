All verification complete. Here is my review.

---

## Dual external review — overlay-hud-expand-b05 (thread manage)

### Patch freshness — verified current
`git status` shows all B0.5 in-scope files modified in the working tree; I read the live files (`summoner-acl.ts`, `lifecycle.ts`, `protocol.ts`, `menu-bar-agent.ts`, `summoner-web.ts`, `SummonerOverlay.swift`, `swift-tray-bridge.ts`, `summoner-thread-manage.test.ts`) and they match the patch hunks exactly. Tests pass against the live tree → patch not stale.

### Machine claims — independently re-run
- **131 pass** (`summoner-thread-manage` + acl/protocol/overlay/talk/web): ✔ 131/131
- **thread-cleanup + files + swift-tray + ws-router lockstep**: ✔ 65/65 + 159/159 in adjacent runs
- **Full companion suite**: 3583 tests, 3560 pass, **0 fail**
- **`npx tsc --noEmit`**: exit 0
- **Pin lockstep**: `SWIFT_TRAY_SHA256` == `shasum -a 256 companion/dist/cmspark-tray` == `e0687549…0a3e` ✔ (R4)

### REJECT gates R1–R6 — all hold
- **R1 (hard delete)**: router default stays hard for tray (`message-router.ts:1605-1610`, "keep single-delete default HARD"); summoner surface rejects omitted/hard via `applySummonerPayloadPolicy` (`summoner-acl.ts:71-78`); web DELETE hardcodes `mode:"trash"` (`summoner-web.ts:436`); Swift sends only `summoner.thread.trash` → handler passes `mode:"trash"` (`menu-bar-agent.ts:1202`). No overlay hard-delete path exists.
- **R2 (trust-key writes)**: policy rebuilds `msg.updates = { alias }` and rejects keys-only/empty (`summoner-acl.ts:83-100`); web PATCH reads only `body.alias` (`summoner-web.ts:425`); test proves `tool_whitelist:null` is dropped. `config_override` is also stripped by the same total rebuild.
- **R3 (confirm dialect)**: zero occurrences of `确认/允许/拒绝/Allow/Deny` in `SummonerOverlay.swift` **and** `summoner-web.ts` (grep-verified); trash/rename use native `NSAlert` (Swift `:423,:441`) / `window.confirm`/`window.prompt` (HTML `:655,:667`).
- **R4 (pin)**: verified above.
- **R5 (Side Panel binding)**: Mac HUD has ⋯/right-click menu → rename/trash (`SummonerOverlay.swift:406-474`); HTML has 重命名/移到回收站 row buttons (`summoner-web.ts:654-671`). Both surfaces self-contained.
- **R6 (ACL overshoot)**: `SUMMONER_ALLOW` adds only `thread.delete`/`thread.update`; tests assert `thread.restore`/`thread.batch_delete` denied; `SUMMONER_WEB_DISPATCH_ALLOW` likewise lacks them; no `knowledge.*`/`mcp.add`.

### DoD observables
1–5 ✔ (rename/trash on both surfaces, trash-only, alias-only, native dialogs, HTTP PATCH/DELETE overlay-safe, both gated by the same policy).
6 ✔ both paths: Mac `hitsFromTitleSearch` now `sortRecentFirst` (`client.ts:76-81`) → next-or-new (`menu-bar-agent.ts:1224-1228`); HTML `refresh()` sorts `updated_at` desc (`summoner-web.ts:797-803`) → `threads[0]` or `#newThread.click()` — the adversary's HTML recency nit **was folded**.
7 ✔ pin. 8 ✔ no knowledge/mcp/confirm growth.

### ADR-020 capability checklist
Declaration present and accurate (L0 Surface, L2 none, Compose alias+trash Companion-owned, Autonomy n/a, Trust policy-gated growth + native confirms, Channel community). Axes fit; no middle-agent language; no new Pack/Side Panel chrome; no new confirm family; **trust monotonic** (overlay strictly weaker, tray unchanged); no new `securityConfirmations.request` (P1-2 n/a); P1-1/3/4 untouched. No blocking items.

### Nits (non-blocking)
1. `swift-tray-bridge.ts:57-58` — comment still says "Updated 2026-08-24 after nits fold" above the 2026-08-25 B0.5 pin (cosmetic; hash verified correct).
2. Commit hygiene: slice-ab leftovers remain staged in the index (`ChatView`/`PacksPanel`/`markdown-breaks` + slice-ab docs) mixed with unstaged B0.5 files — MM commit hazard; re-stage B0.5 scope together at merge.
3. `summoner-acl.ts` — `thread.create` on summoner surface still passes `config_override` through (pre-existing S21 residual, out of B0.5 scope; security adversary recorded it too).
4. `summoner-web.ts` DELETE handler doesn't drain a request body (current clients send none; test with a body still passes).
5. `SummonerOverlay.swift` thread list caps at 12 rows and is index-ordered (`threadRows.prefix(12)`), so ⋯-menu management is unreachable for older threads except via # search — product-level, not a gate.
6. `summoner-thread-manage.test.ts:115-118` — "policy after ACL" is a grep assertion; production ordering verified by inspection (`lifecycle.ts:1045-1050`, before `handleMessage`), so behavior is correct but the test is weak.

VERDICT: APPROVE_WITH_NITS
