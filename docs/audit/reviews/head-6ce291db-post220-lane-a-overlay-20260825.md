# Lane A — Overlay / Summoner HUD / ACL / Swift (independent adversary)

**Role**: INDEPENDENT ADVERSARY (did not implement this range). Default REFUTED until `file:line` + `[executed]` / `[inspected]`.
**HEAD**: `6ce291db1c14b72823e26905df32bfe7d498c7e7` (`feat: knowledge honesty Wave 0–2 + overlay HUD workbench compose (#222)`)
**Base**: `1d16b0ed` (#220). Range: PR #221 + #222.
**Frozen patch**: `docs/audit/reviews/head-6ce291db-post220-diff-20260825.patch`
**SHA256**: `19B2A2F3DFDF41F4B5A5A22DD68763C19C861E5300FCCEF7876B791489246548` `[executed]` `Get-FileHash -Algorithm SHA256`
**Machine**: Windows PowerShell. `dist/cmspark-tray` **missing** (no Mac binary on this host).

## Exclusive range (findings only here)

`companion/src/summoner-web.ts`, `companion/src/summoner/client.ts`, `companion/src/summoner/protocol.ts`, `companion/src/ws/summoner-acl.ts`, `companion/src/ws/validate.ts`, `companion/src/ws/lifecycle.ts`, `companion/src/packs/pack-engine.ts`, `companion/src/menu-bar-agent.ts`, `companion/src/tray/SummonerOverlay.swift`, `companion/src/tray/Tray.swift`, `companion/src/tray/swift-tray-bridge.ts`, exclusive summoner tests listed in the prompt, `docs/summoner-launcher-plugins.md`, overlay HUD specs + `docs/design/overlay-hud-expand-*.html`.

Out-of-range files were **read for context only** (`overlay-session.ts`, `message-router.ts`, `message-router/handlers/mcp.ts`, `packs/overlay-eligible.ts`, `tray/companion-client.ts`). No BLOCK is claimed on those paths.

## Capability declaration check (ADR-020)

Two specs shipped in one squash and **disagree** on overlay ACL. Live code is SoT.

| Spec | Claim | Live |
|------|--------|------|
| knowledge-honesty | `overlay ACL does not grow`; overlay unchanged C-thin | **REFUTED as a description of HEAD** |
| overlay-hud-expand | summoner ACL grows for composition read + overlay-safe write; `mcp.add` / `knowledge.import` DENIED on summoner WS | **HOLDS** |

**Axes fit** `[inspected]`: this is Surface L0 (collapse HUD + workbench expand) + Composition (threads / pack / knowledge / skill / mcp). Not a second agent runtime. Pack-first: overlay apply is `pack.apply`, not a new primary Side Panel chrome.

**Trust monotonicity** `[executed]` + `[inspected]`: ACL grew, but T3 mutates stay off the overlay socket (`mcp.add` / `knowledge.import` / `config.set` / `security.confirmation.response` → `SUMMONER_ACL`). `pack.apply` on overlay is composition-only: HTML constructor strips `allowTrust` / workspace / takeover; engine defaults `allowTrust=false`; Swift/menu-bar mapping does not send Trust fields. Router overlay force-false is Lane D (pointer only).

**Confirm dialects**: no `summoner.confirm.*`. Overlay Swift dialogs are 重命名/取消, 移到回收站/取消, 添加/取消, 导入/取消. Tray.swift still has 允许/拒绝 on the **tray confirm panel**, not the overlay HUD — existing L2, not a new overlay family.

**originWs**: exclusive files do not add a new confirm family. HTML `mcp.toggle_server` rides the summoner socket (C-thin L2 stall nit). Mac HUD `mcp.add` / `knowledge.import` ride `companionClient` (tray).

**Missing declaration**: not missing. The squash declaration is the overlay-expand one. Knowledge-honesty's "ACL does not grow" is superseded by the same squash, honestly.

Blast stays **T2**. Would escalate to T3 only if overlay WS could `mcp.add` / `knowledge.import` / `config.set`, or if overlay grew Allow/Deny — **not observed**.

---

## MACHINE table `[executed]`

Cwd `companion/` unless noted.

| Command | Result |
|---------|--------|
| `git rev-parse HEAD` | `6ce291db1c14b72823e26905df32bfe7d498c7e7` pass |
| `Get-FileHash …head-6ce291db-post220-diff-20260825.patch SHA256` | `19B2A2F3DFDF41F4B5A5A22DD68763C19C861E5300FCCEF7876B791489246548` pass |
| `npx tsc --noEmit -p tsconfig.json` | **pass** (exit 0) |
| `npx tsx --test tests/summoner-acl.test.ts tests/summoner-protocol.test.ts tests/summoner-web.test.ts tests/summoner-thread-manage.test.ts tests/summoner-workbench-compose.test.ts tests/summoner-overlay.test.ts tests/summoner-client.test.ts tests/summoner-talk.test.ts` | **pass** 171/171, fail 0, ~11s |
| Private probe `.tmp-adv-lane-a/probe.mjs` (import live ACL/HTML/protocol/reclaim; HTML loopback POST) | **pass** 37/37 HOLD; dir deleted after |
| `companion/dist/cmspark-tray` | **MISSING** on Windows (R4 inspected pin vs source) |

In-tree tests were **not** treated as proof. Private probes re-imported `assertSummonerAllowed` / `applySummonerPayloadPolicy` / `SUMMONER_WEB_DISPATCH_ALLOW` / `isSummonerConfirmDialect` / `shouldReclaimLiveOverlayThread` and hit a live loopback HTML server.

---

## Must-falsify scorecard

| ID | Result | Evidence |
|----|--------|----------|
| **R1** Overlay WS / HTML DENY `mcp.add`, `knowledge.import`, `config.set` | **HOLD** | `SUMMONER_ALLOW` `companion/src/ws/summoner-acl.ts:14-45` has none of the three. `assertSummonerAllowed("summoner", t)` → `SUMMONER_ACL` `[executed]`. Lifecycle applies it before routing `companion/src/ws/lifecycle.ts:1038-1051`. `SUMMONER_WEB_DISPATCH_ALLOW` `companion/src/summoner-web.ts:19-42` same denials `[executed]`. HTML POST `/api/config`, `/api/mcp/add`, `/api/knowledge/import` → **404**, dispatched=[] `[executed]`. WEB allowlist ⊆ ACL `[executed]`. |
| **R2** `thread.update` alias-only; `thread.delete` trash-only | **HOLD** | `applySummonerPayloadPolicy` `summoner-acl.ts:77-106`: `mode !== "trash"` (hard **or omit**) → `SUMMONER_ACL` `[executed]`. `updates` rewritten to `{ alias }` after control-char strip; `tool_whitelist` / `active_knowledge_ids` gone `[executed]`. Empty alias DENY `[executed]`. HTML DELETE always sends `mode: "trash"` even with `?mode=hard` `summoner-web.ts:436-442` `[executed]`. PATCH only forwards `alias` `summoner-web.ts:424-433`. Menu-bar rename/trash `menu-bar-agent.ts:1363-1395` alias-only / `mode:"trash"`. |
| **R3** No overlay Allow/Deny / 确认 chrome; no `summoner.confirm.*` | **HOLD** | `isSummonerConfirmDialect` `protocol.ts:391-397`; decode inbound/outbound return null `[executed]`. `SummonerOverlay.swift` grep `确认\|允许\|拒绝\|Allow\|Deny\|summoner.confirm` → **0 hits** `[executed]`. NSAlert buttons: 重命名/取消 `SummonerOverlay.swift:442-446`; 移到回收站/取消 `:460-464`; 添加/取消 `:661-665`; 导入/取消 `:705-709`. HTML `window.confirm("把「…」移到回收站？")` `summoner-web.ts:730` (spec-allowed HTML confirm; source has no 确认/允许/拒绝) `[executed]`. SSE drops `security.confirmation.request` `summoner-web.ts:44-61,217` `[executed]`. Tray.swift 允许/拒绝 is the **tray** confirm panel (`Tray.swift:996-999`), not overlay. |
| **R4** `SWIFT_TRAY_SHA256` lockstep with `dist/cmspark-tray` | **HOLD** (Windows: pin vs source only) | Pin `swift-tray-bridge.ts:59` = `ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda`. `companion/dist/cmspark-tray` **missing** `[executed]`. Frozen patch updates the pin in the same squash as `SummonerOverlay.swift` workbench (`77139e17…` → `ed4dbfa0…`) `[inspected]`. Comment on `:57-58` still says "B0.5" while source has B1–B4 rails — stale comment, not a hash mismatch we can prove without the Mach-O. |
| **R5** overlay `pack.apply`: `allowTrust` false, overlay-eligible only, forbidden fields blocked | **HOLD** (policy in exclusive files + mapping; router is D) | Engine default `allowTrust = opts?.allowTrust === true` `pack-engine.ts:1501` → false unless opted. List stamps `overlay_eligible: isOverlayEligiblePack(...)` `pack-engine.ts:864`. HTML `/api/packs/apply` constructs `{pack_id, thread_id, user_gesture:true}` only — POST body `allowTrust` / `workspace_path` / `force_takeover` / `confirmation_phrase` stripped `[executed]` `summoner-web.ts:542-554`. Swift refuses ineligible rows `SummonerOverlay.swift:640-648`. Menu-bar `handleSummonerPackApply` `menu-bar-agent.ts:873-882` uses `summonerClient.applyPack(packId, tid)` (no Trust fields). **ACL does not itself strip `pack.apply` extras** (pass-through `[executed]`) — defense in depth is HTML constructor + Lane D router `message-router.ts:3004-3038` (`allowTrust: !overlayApply`, overlay-eligible, forbidden fields). Pointer, not a Lane A BLOCK. |
| **R6** `knowledge.set_active` extra keys stripped; unknown ids must not persist | **HOLD** (strip in ACL; unknown-id persistence is D) | Policy `summoner-acl.ts:107-124` keeps only `type` / `thread_id` / string `ids` (max 32) `[executed]`. `tool_whitelist` / `pin_thread_id` / `allowTrust` deleted `[executed]`. Missing `thread_id` → `SUMMONER_ACL`. Unknown-id filter is router `message-router.ts:2651-2652` (Lane D pointer). |
| **S-C** reclaim live overlay only if bound session token still live; lagged `summonerThreadId` cannot steal newer overlay | **HOLD** | Bind is `(id, token)` `menu-bar-agent.ts:169-172`; `setSummonerThreadId` gone `[inspected]`. Reclaim `menu-bar-agent.ts:690-710` calls `shouldReclaimLiveOverlayThread` then `claimOverlayIfLive`. Probe: after `beginOverlaySession()`, old token reclaim of lagged `A` is **false** `[executed]`. Submit-ok bind is live-gated `menu-bar-agent.ts:1106-1108`. Hydrate bind inside submit is also live-gated `:1079-1081`. Stream frames dropped unless `summonerCmdMatchesThread(cmd, summonerThreadId)` `:1879`. `hydrateOverlayIfLive` abandoned path does not bind (`menu-bar-agent.ts:716-740`: bind only if `result === "claimed"`). |
| No HTML `getUserMedia` | **HOLD** | HTML page 200, body has no `getUserMedia` `[executed]`. CSP `connect-src 'self'` `summoner-web.ts:372-373`. Swift mic is `AVAudioEngine` (native), not browser getUserMedia. |
| Overlay cannot open Chrome Side Panel | **HOLD** | `handleSummonerAttach` `menu-bar-agent.ts:1027-1032` → `attachChromeOnly` `summoner/client.ts:234-242` (`openChrome` / `openChromeSilent` only). HTML has no `sidePanel` / `openSidePanel` `[executed]`. `openSidePanel()` at `menu-bar-agent.ts:623` is tray quick-action, not overlay. |
| Mac HUD `mcp.add` / `knowledge.import` ride tray client, not overlay WS | **HOLD** | `handleSummonerMcpAdd` `menu-bar-agent.ts:912-920` `companionClient.sendAppRequest("mcp.add", …)`. `handleSummonerKnowledgeImport` `:995-1003` `companionClient.sendAppRequest("knowledge.import", {content, title})`. Source does **not** call `summonerClient.sendAppRequest("mcp.add"|"knowledge.import")` `[inspected]`. Protocol events exist as **stdin** (`protocol.ts:642-657`), then mapped to tray. HTML has no add/import endpoints `[executed]`. |

---

## New defects

None P0 / P1. Nits only (do not skip Trust):

### nit — C-thin HTML vs Swift HUD (documented, re-verified)

1. **Skills activate-only** `[executed]` `summoner-web.ts:923` always posts `on:true`. Swift toggles `on: !on` `SummonerOverlay.swift:688`. HTML API *can* deactivate (`summoner-web.ts:472-484`) but the page never sends `on:false`.
2. **Knowledge replace-not-toggle** `[executed]` `summoner-web.ts:938` `ids:[id]` replaces the active set. Swift attach is toggle via current list `menu-bar-agent.ts:965-979`.
3. **MCP toggle L2 stall** `[inspected]`: HTML `/api/mcp/toggle` → `dispatchAllowed("mcp.toggle_server")` → `summonerClient` (`menu-bar-agent.ts:1644-1645`, `summoner-web.ts:456-463`). Enabling a disabled stdio server wants origin-bound L2 on that overlay socket (`lifecycle.ts:1294-1302` + mcp handler; overlay ACL denies `security.confirmation.response`). Swift toggle uses `companionClient` `menu-bar-agent.ts:893-896` (tray L2 chrome). Overlay does **not** auto-approve; it stalls/times out. Trust preserved.

### nit — ACL `pack.apply` extras are pass-through

`applySummonerPayloadPolicy` rewrites `thread.update` / `knowledge.set_active` but leaves `pack.apply` keys intact `[executed]`. Raw overlay WS could still *carry* `allowTrust:true`. Exclusive mapping (HTML constructor, `applyPack()` args, Swift stdin) does not send it; Lane D router must keep `allowTrust: !overlayApply`. Defense-in-depth gap, not a live overlay HTML hole.

### nit — `SWIFT_TRAY_SHA256` comment stale; binary absent on this host

Comment `swift-tray-bridge.ts:57-58` still says "B0.5 — overlay rename/trash" while `SummonerOverlay.swift` has packs/MCP/skills/knowledge rails. Pin *did* change in this squash `[inspected]`. Cannot hash `dist/cmspark-tray` here. Mac CI / next Darwin dogfood should `shasum` the Mach-O against `ed4dbfa0…`.

### nit — HTML SSE allowlist includes `mcp.confirm.pending`

`SUMMONER_WEB_EVENT_ALLOW` `summoner-web.ts:60` + UI status `summoner-web.ts:991-993` ("MCP 工具需在 Chrome 侧栏批准"). Not Allow/Deny chrome; no response path. Honest C-thin status.

---

## Confirmed-safe

- Handshake `surface: "summoner"` then per-message ACL + payload policy + `stampCmsparkSurface` overwrite (`lifecycle.ts:1036-1053`). Loopback HTML is **not** an allowed WS Origin (`isAllowedWsOrigin("http://127.0.0.1:23403") === false` — in-tree test + same function). Browser never upgrades companion WS (`summoner-web.ts` header comment).
- Overlay chat/lease/pack/skill/knowledge USE stay on summonerClient; T3 mutates and hotkey persist stay off overlay `config.set` (`persistSummonerHotkeyChosen` uses `saveConfig` in the tray process).
- Spec SUPERSEDES HUD A “overlay 不管 pack·MCP”: live ACL grew `pack.apply` / `mcp.toggle_server` / `skill.activate|deactivate` / `knowledge.set_active` as declared, without overlay confirm dialect.
- `docs/summoner-launcher-plugins.md` forbids launcher-side Allow/Deny and MCP/knowledge CRUD — consistent with live HUD.
- Design HTML (`overlay-hud-expand-hifi.html` / wireframes) state HUD must not draw Allow/Deny; live Swift matches.

---

## Cross-cut pointers (not Lane A BLOCKs)

- Overlay `pack.apply` server force `allowTrust:false` + overlay-eligible + forbidden-field reject: `companion/src/message-router.ts:3004-3038` (Lane D).
- Unknown knowledge ids dropped before persist: `companion/src/message-router.ts:2651-2652` (Lane D).
- Overlay-session generation primitive lives in `companion/src/summoner/overlay-session.ts` (read for S-C; mapping is in exclusive `menu-bar-agent.ts`).

---

VERDICT: APPROVE_WITH_NITS
