# Implementer-skeptic: overlay-post222-residual-fix

**Lane:** impl / trajectory (no production edits; did not read `overlay-post222-residual-fix-adversary-*.md`)
**HEAD:** `a58b78fd444bcd5eb49698b1d802d4fc959d963a` (`origin/main`); branch `fix/overlay-post222-residual` **uncommitted**
**Base:** `a58b78f` Merge `fix/windows-tray-nodepath` into main
**Diff:** `docs/audit/reviews/overlay-post222-residual-fix-diff-20260826.patch` (10 files)
**Prior REJECT:** I1/I2 OPEN (R5) — merge took `dfab3eb` dark HTML, kept `03de168` lock tests

```text
Surface:      Darwin HUD = Swift NSPanel C-thin; Win/Linux = loopback HTML --app
L2-classes:   tray showConfirmDialog on security.confirmation.request; overlay has no Allow/Deny
Compose:      overlay-safe SUMMONER_ALLOW + applySummonerPayloadPolicy
Autonomy:     n/a
Trust:        monotonic; knowledge.import / mcp.add off overlay WS (stdin + tray companionClient)
Channel:      community; CDP still needs Chrome
```

Machine this session: lock tests, HTML, Swift, router, ACL, pin **`[inspected]`**. Claimed `npx --offline tsx --test …` **not re-executed** (no shell in this lane). SHA of `companion/dist/cmspark-tray` **not hashed** here. Dual must `[executed]` the suite + `shasum`.

---

## Outcome

This fold does **not** paper over the prior REJECT by keeping dark HTML and weakening tests. It restores the `03de168` paper HUD (`--paper`, `.rail-btn`, `.list-scroll`, `placeWindow(false)`, `on:!on`, `ids:next`) **and** layers the `dfab3eb` flex recipe onto that HUD. `shell-open.ts` is moved **back** to `--window-size=720,120` to match the **unchanged** lock test. I3/I5/I6, previously never-folded OPEN, are actually folded.

GET HTML / C-thin lock tests were **strengthened**, not retargeted:

| Lock | Still asserts | Live tree |
|------|---------------|-----------|
| `summoner-web.test.ts:118-126` | `--paper:#fff`, `--indigo:#4f46e5`, `class="rail-btn"`, **not** `#12141c`, `placeWindow(false)` | present `[inspected]` |
| `summoner-web.test.ts:121-123` **added** | `html,body{height:100%;width:100%;overflow:hidden}`, `class="list-scroll"`, `.composer{…flex-shrink:0` | present `[inspected]` |
| `summoner-web.test.ts:542-547` | `skill_name:s.name,on:!on`, `ids:next`; forbids `on:true` / `ids:[id]` | `summoner-web.ts:1057,1074-1075` `[inspected]` |
| `summoner-shell-open.test.ts:71` **untouched** | `--window-size=720,120` | `shell-open.ts:55` `[inspected]` |

Live HTML has **zero** `#12141c` / `on:true` / `ids:[id]` (`rg` on `summoner-web.ts`).

---

## Trajectory

Prior graph (from REJECT batch): `03de168` paper HUD + I1/I2 **not** ancestor of `dfab3eb`; merge `a58b78f` took the dark blob and lied in the commit message.

This uncommitted fold is the requested re-merge direction: **HUD HTML on top of flex**, not flex-on-dark.

**Scope = 10 files** (patch `diff --git` count). No drive-by into `summoner-acl.ts`, `skill-engine.ts`, `threads/distill.ts`, `content-sanitizer.ts`, F-I-5 / PEM / F-S-1.

| File | Why it is in scope |
|------|--------------------|
| `companion/src/summoner-web.ts` | restore paper HUD + I1/I2 + I7 flex |
| `companion/src/summoner/shell-open.ts` | restore `720,120` (do **not** retarget test) |
| `companion/src/tray/SummonerOverlay.swift` | I3 fail-close + I5 NSScrollView/`prefix(64)` |
| `companion/src/tray/swift-tray-bridge.ts` | pin after Swift rebuild |
| `companion/src/menu-bar-agent.ts` | I5 `SUMMONER_RAIL_LIST_CAP` on title search |
| `companion/src/summoner/protocol.ts` | export `SUMMONER_RAIL_LIST_CAP = 64` |
| `companion/src/message-router.ts` | I6 `dropped` |
| `companion/tests/summoner-web.test.ts` | **add** flex/list-scroll asserts; keep HUD + I1/I2 |
| `companion/tests/summoner-workbench-compose.test.ts` | I3/I5 source locks |
| `companion/tests/knowledge-active-ids.test.ts` | I6 `handleMessage` unit test |

`summoner-shell-open.test.ts` is **not** in the patch. Source was moved to the test. That is the opposite of lock-test retarget.

`companion/dist/` is gitignored. Stale `dist/tray/swift-tray-bridge.js` still pins `9716da43…` (2026-08-24 comment) — compile artifact, not a source drive-by. Tests/dev path is `tsx` against `src/`.

---

## I1–I8

| ID | Status | file:line | Evidence |
|----|--------|-----------|----------|
| I1 | **CLOSED** | `summoner-web.ts:1047-1057` | HTML loads `active_skill_ids`, POSTs `on:!on`, reloads list. Server `summoner-web.ts:476` `body.on !== false` → `skill.deactivate` when false. Lock `summoner-web.test.ts:544-546` still forbids `on:true`. `[inspected]` |
| I2 | **CLOSED** | `summoner-web.ts:1063-1075` | Union/difference into `next`; POST `ids:next`. Not `ids:[id]`. Lock `:545-547`. Router still writes the array as the full selection (`message-router.ts:2624-2629`) — C-thin now sends the full next set. `[inspected]` |
| I3 | **CLOSED** | `SummonerOverlay.swift:734-745` | `guard let text = String(data: data, encoding: .utf8), !text.isEmpty else { applyError(…"只支持文本知识（md/txt）") }`; `content: text`. No `base64EncodedString()` in `knowledgeImportClicked`. File-attach path `:1048` still base64 (correct; out of I3 function). Test `summoner-workbench-compose.test.ts:167-177` greps that function body. `[inspected]` |
| I4 | **CLOSED** | `menu-bar-agent.ts:1629-1631` | HTML `/api/mcp/toggle` → `mcp.toggle_server` (`summoner-web.ts:456-464,1040-1041`). Dispatch still rides `companionClient`. Lock `summoner-web.test.ts:550-553` untouched. Nit: systray2 never-promise L2 (pre-existing; Darwin tray ride not re-broken). `[inspected]` |
| I5 | **CLOSED** | Swift `:371,:574,:591,:611,:633` `prefix(64)`; `:1771-1782` `listScroll.documentView = tStack`; `menu-bar-agent.ts:792` `slice(0, SUMMONER_RAIL_LIST_CAP)`; `protocol.ts:19` `= 64` | `rg prefix\(12\)` on `companion/src` = 0. `hitsFromTitleSearch(…).slice(0, 8)` gone. Tests `:155-165`. Not pixel-run. `[inspected]` |
| I6 | **CLOSED** | `message-router.ts:2616-2630`; test `knowledge-active-ids.test.ts:260-275` | Unknown ids filtered; response includes `dropped`. Test **does** `await import("../src/message-router")` and calls `handleMessage(...)` with injected `threadManager`/`skillEngine` (`handleMessage` destructures `services` at `:397`). Empty `""` is stripped by `id.trim()` **before** `dropped`, so expected `dropped: ["ghost-id"]` is consistent. Would fail if the handler ignored the injected engine (ghost+known would both drop). `[inspected]` — not `[executed]` |
| I7 | **CLOSED** | `summoner-web.ts:620-676` | Paper HUD **and** flex: `html,body{height:100%;width:100%;overflow:hidden}` `:628`; `.rail{…flex-shrink:0}` `:636-638`; `.body{flex:1;min-height:0}` `:634` (`.shell` analog); `.main{…min-height:0}` `:669`; `.log{flex:1;min-height:0;overflow-y:auto}` `:670`; `.composer{…flex-shrink:0}` `:676`. Independent list scroll is `.list-scroll` `:650`, not dark-shell `.rail{overflow:auto}`. **Not** `#12141c`. CSS `[inspected]`; no pixel-run of `--app`. |
| I8 | **CLOSED** | `skill-engine.ts:1403-1410` F-I-5; `threads/distill.ts:6-31` PEM-through-END; `content-sanitizer.ts:119-128` `wrapKnowledgeBlock` | None of these files are in the patch. `[inspected]`. Nit: still no `wrapKnowledgeBlock` unit test (pre-existing). |

---

## R1–R6

| ID | Gate | Result |
|----|------|--------|
| R1 | overlay WS `mcp.add` / `knowledge.import` / `config.set` | **HOLD** — not in `SUMMONER_ALLOW` (`summoner-acl.ts:14-45`) nor `SUMMONER_WEB_DISPATCH_ALLOW` (`summoner-web.ts:19-42`). Router still extra-denies `knowledge.import` on summoner (`message-router.ts:2638-2640`). Import stays tray `companionClient.sendAppRequest` (`menu-bar-agent.ts:996-1004`). Locks in `summoner-acl.test.ts` / `summoner-workbench-compose.test.ts:178-185` / `summoner-web.test.ts:516` untouched. `[inspected]` |
| R2 | overlay `thread.update` writes `tool_whitelist` | **HOLD** — policy rewrites to `{alias}` (`summoner-acl.ts:88-105`). Lock `summoner-thread-manage.test.ts:69-77` untouched. HTML PATCH is alias-only (`summoner-web.ts:430-432`). `[inspected]` |
| R3 | HUD Allow/Deny / `summoner.confirm.*` | **HOLD** — `rg Allow\|Deny\|确认` on `SummonerOverlay.swift` = 0. `isSummonerConfirmDialect` unchanged (`protocol.ts:394-399`). No new confirm dialect in the 10-file patch. `[inspected]` |
| R4 | `SWIFT_TRAY_SHA256` ≠ `companion/dist/cmspark-tray` | **HOLD (pin updated; hash not re-executed this lane)** — source pin `swift-tray-bridge.ts:59` = `57e1fba2c5d7dd5bde0f462a85e92d8839ff7c9c8b7c8e9f5bd897d6285a6052` (was `ed4dbfa0…`). Binary **exists** at `companion/dist/cmspark-tray` (`list_dir`; `read_file` → Mach-O). Integrity tests (`swift-tray-integrity.test.ts`) still only dummy-bin `ok:false` paths — they do **not** pin the production Mach-O. Dual **must** `shasum -a 256 companion/dist/cmspark-tray`. Stale `dist/tray/swift-tray-bridge.js:55` still `9716da43…` is gitignored tsc drift, not the R4 source pin. `[inspected]` / `[assumed]` match |
| R5 | claimed-CLOSED I1–I8 actually OPEN, or lock tests weakened to reverted HTML | **HOLD** — I1/I2 live HTML matches the **original** lock strings. Tests were not retargeted to `#12141c` / `on:true` / `800,720`. I3/I5/I6 newly folded with tests. I7 is flex **on paper**, not flex-on-dark. `[inspected]` |
| R6 | new fold breaks overlay-safe ACL | **HOLD** — `summoner-acl.ts` not in patch. `dropped` is an additive response field on `knowledge.set_active`, not a new allowlisted method. Policy still caps/filters ids (`summoner-acl.ts:107-123`). `[inspected]` |

---

## Component

Hotspots that were OPEN on `a58b78f` and are folded here:

- I1 `on:!on` — `companion/src/summoner-web.ts:1057`
- I2 `ids:next` — `companion/src/summoner-web.ts:1074-1075`
- I7 paper + flex — `companion/src/summoner-web.ts:620-676`
- Window `720,120` — `companion/src/summoner/shell-open.ts:55` vs lock `:71`
- I3 UTF-8 fail-close — `companion/src/tray/SummonerOverlay.swift:734-745`
- I5 scroll + cap — `SummonerOverlay.swift:1771-1782`, `menu-bar-agent.ts:792`
- I6 `dropped` + real `handleMessage` test — `message-router.ts:2625-2630`, `knowledge-active-ids.test.ts:260-275`
- Pin — `swift-tray-bridge.ts:59`

Remaining (non-blocking):

- Swift `prefix(64)` ×5 is a comment-coupled magic number, not a shared Swift const with `SUMMONER_RAIL_LIST_CAP`.
- `placeWindow(false)` uses `500×140` (`summoner-web.ts:783-784`) after Chrome `--window-size=720,120`. Same two-phase `03de168` story; launch lock is `720,120`.
- `.rail{flex-shrink:0}` is vestigial on grid `.body`; the real squeeze-guard is `.hud` column + `.body{flex:1;min-height:0}` + `.composer{flex-shrink:0}` + `.log{min-height:0}`.
- I4 Win/Linux systray2 never-promise L2 (adjudicated nit).
- Production `npm start` from stale `companion/dist/*.js` would still see the 2026-08-24 pin until `tsc`.

---

## Nits (non-blocking)

1. This lane did not `[executed]` `shasum` / the 114+4 suite. Dual should. Integrity tests never hash the live Mach-O.
2. `companion/dist/tray/swift-tray-bridge.js` pin `9716da43…` is stale vs `src` `57e1fba2…` (gitignored).
3. Pin comment `:57` still “Updated 2026-08-25 B1–B4” after a 2026-08-26 hash change.
4. Swift list cap is `prefix(64)` magic ×5; TS constant is not compiled into Swift.
5. I7 not pixel-run of Chrome `--app`.
6. I3/I5 new tests are source-grep, not NSOpenPanel / NSScrollView runtime.
7. I8 still has no `wrapKnowledgeBlock` breakout unit test (pre-existing).
8. I4 systray2 never-promise (pre-existing; Darwin tray ride intact).

## Blockers

None. I1/I2 are folded on the restored paper HUD. Lock tests still demand `on:!on` / `ids:next` / `--paper` / `720,120`. I6 test actually calls `handleMessage`. Scope is the 10-file patch. Not a dark-HTML + weakened-test reverse.

---

VERDICT: APPROVE_WITH_NITS
