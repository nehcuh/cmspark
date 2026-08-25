# Lane A r2 — Overlay / Summoner HUD / ACL / Swift (independent adversary, post-P1 fold)

**Role**: INDEPENDENT ADVERSARY re-verify after P1 fold. Did **not** implement. Did **not** edit production source. Default **REFUTED** until `file:line` + `[executed]` / `[inspected]`.
**HEAD**: `6ce291db1c14b72823e26905df32bfe7d498c7e7`
**Branch**: `fix/post220-head-p1-fold` (uncommitted Lane B P1 folds on top of HEAD)
**Prior Lane A**: `docs/audit/reviews/head-6ce291db-post220-lane-a-overlay-20260825.md` (AWN)
**Prior synthesis**: `docs/audit/reviews/head-6ce291db-post220-adversary-synthesis-20260825.md` (REJECT on Lane B P1×3)
**Machine**: Windows PowerShell. `companion/dist/cmspark-tray` **missing**.
**Mutation copies**: `.tmp-adv-r2-a/` only; **deleted after run**.

Implementer-claimed fold: `skill-engine.ts` (remove `taken.delete`; `wrapKnowledgeBlock`), `content-sanitizer.ts` (`wrapKnowledgeBlock`), `distill.ts` (PEM no cap) + their tests. **Not this lane's files.**

## Exclusive range (findings only here)

`companion/src/ws/summoner-acl.ts`, `companion/src/summoner-web.ts`, `companion/src/summoner/client.ts`, `companion/src/summoner/protocol.ts`, `companion/src/ws/validate.ts`, `companion/src/ws/lifecycle.ts`, `companion/src/packs/pack-engine.ts`, `companion/src/menu-bar-agent.ts`, `companion/src/tray/SummonerOverlay.swift`, `companion/src/tray/Tray.swift`, `companion/src/tray/swift-tray-bridge.ts`, exclusive summoner tests listed in the r2 prompt.

Out-of-range reads for S-C / applyPack args only: `overlay-session.ts`, `tray/companion-client.ts`. No BLOCK claimed on those paths.

## 1. Fold did not dirty exclusive files `[executed]`

`git diff --name-only HEAD` (working tree vs `6ce291db`):

```
companion/src/skills/content-sanitizer.ts
companion/src/skills/skill-engine.ts
companion/src/threads/distill.ts
companion/tests/distill.test.ts
companion/tests/skill-engine.test.ts
memory/session.md
```

`git diff -- <exclusive paths>` → **empty** (no stdout). Exclusive tests also unmodified. Fold is confined to Lane B knowledge/distill; overlay ACL / HUD / Swift / pack-engine / lifecycle / validate are bitwise HEAD.

---

## Capability (live SoT, unchanged by fold)

HUD-expand declaration still holds; knowledge-honesty “overlay ACL does not grow” remains a **superseded squash description**, not a live contract.

**Trust monotonicity** `[executed]` + `[inspected]`: ACL still lists overlay-safe compose writes (`pack.apply`, `mcp.toggle_server`, `skill.activate|deactivate`, `knowledge.set_active`). T3 mutates stay off overlay WS (`mcp.add` / `knowledge.import` / `config.set` / `security.confirmation.response` → `SUMMONER_ACL`). Overlay `pack.apply` mapping still omits Trust fields. No `summoner.confirm.*`. Blast stays **T2**.

---

## MACHINE table `[executed]`

Cwd `companion/` unless noted.

| Command | Result |
|---------|--------|
| `git rev-parse HEAD` | `6ce291db1c14b72823e26905df32bfe7d498c7e7` |
| `git branch --show-current` | `fix/post220-head-p1-fold` |
| `git diff -- <exclusive paths>` | **empty** |
| `npx tsx --test tests/summoner-acl.test.ts tests/summoner-protocol.test.ts tests/summoner-web.test.ts tests/summoner-thread-manage.test.ts tests/summoner-workbench-compose.test.ts tests/summoner-overlay.test.ts tests/summoner-client.test.ts tests/summoner-talk.test.ts` | **pass** 171/171, fail 0, ~1.2s |
| Private probe `.tmp-adv-r2-a/probe.ts` (live ACL/HTML/protocol/reclaim + loopback POST + two MUT kills) | **pass** 81/81 HOLD; dir deleted after |
| `companion/dist/cmspark-tray` | **MISSING** on Windows (R4 inspected pin vs source) |

In-tree tests were **not** treated as proof. Probe re-imported `assertSummonerAllowed` / `applySummonerPayloadPolicy` / `SUMMONER_WEB_DISPATCH_ALLOW` / `isSummonerConfirmDialect` / `decodeSummonerInbound|Outbound` / `shouldReclaimLiveOverlayThread` / `attachChromeOnly` / `isAllowedWsOrigin`, hit a live loopback HTML server, then mutated **copies** of `summoner-acl.ts` (add `mcp.add`; skip trash-only) and showed live still DENY.

---

## Must-falsify scorecard (replay R1–R6 / S-C / GUM / Side Panel / T3)

Default REFUTED. Each HOLD below is this r2 run, not copied from Lane A r1.

| ID | Result | Evidence |
|----|--------|----------|
| **R1** Overlay WS / HTML DENY `mcp.add`, `knowledge.import`, `config.set` | **HOLD** | `SUMMONER_ALLOW` `companion/src/ws/summoner-acl.ts:14-45` has none of the three. `assertSummonerAllowed("summoner", t)` → `SUMMONER_ACL` `[executed]`. Also DENY `security.confirmation.response` `[executed]`. Lifecycle applies ACL then payload then `stampCmsparkSurface` `companion/src/ws/lifecycle.ts:1038-1053` `[inspected]`. `SUMMONER_WEB_DISPATCH_ALLOW` `summoner-web.ts:19-42` same denials; WEB ⊆ ACL (22 types) `[executed]`. Loopback POST `/api/config`, `/api/mcp/add`, `/api/knowledge/import` → **404**, dispatched=[] `[executed]`. `isAllowedWsOrigin("http://127.0.0.1:23403") === false` `lifecycle.ts:196-209` `[executed]`. MUT: copy with `"mcp.add"` inserted → mut ALLOW / live still DENY `[executed]`. |
| **R2** `thread.update` alias-only; `thread.delete` trash-only | **HOLD** | `applySummonerPayloadPolicy` `summoner-acl.ts:77-106`: omit/`hard` → `SUMMONER_ACL`; `updates` rewritten `{ alias }` after control-char strip; empty/ctrl alias DENY `[executed]`. HTML DELETE always `{ mode: "trash" }` even `?mode=hard` `summoner-web.ts:436-442` `[executed]`. PATCH constructor only `updates: { alias }` `summoner-web.ts:424-433`; extra `tool_whitelist` in POST body **not** forwarded `[executed]`. Menu-bar rename/trash `menu-bar-agent.ts:1363-1395` alias-only / `mode:"trash"` `[inspected]`. MUT: skip `mode !== "trash"` → mut ALLOW hard / live still DENY `[executed]`. |
| **R3** No overlay Allow/Deny / 确认 chrome; no `summoner.confirm.*` | **HOLD** | `isSummonerConfirmDialect` `protocol.ts:391-397`; inbound/outbound decode return null `[executed]`. `SummonerOverlay.swift` grep `允许\|拒绝\|summoner.confirm` → **0** `[executed]`. NSAlert: 重命名/取消 `:442-446`; 移到回收站/取消 `:460-464`; 添加/取消 `:661-665`; 导入/取消 `:705-709`. HTML `window.confirm("把「…」移到回收站？")` `summoner-web.ts:730`; source has no 允许/拒绝 `[executed]`. SSE drops `security.confirmation.request` `summoner-web.ts:213-217` `[executed]`. Tray.swift 允许/拒绝 is `ConfirmController` (`Tray.swift:790,996-999`), not overlay. Overlay stdin comment: “Zero Allow/Deny chrome” `Tray.swift:558` `[inspected]`. |
| **R4** `SWIFT_TRAY_SHA256` lockstep with `dist/cmspark-tray` | **HOLD** (Windows: pin vs source only) | Pin `swift-tray-bridge.ts:59` = `ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda` `[executed]`. `companion/dist/cmspark-tray` **missing** `[executed]`. Fold did not touch Swift/bridge. Comment `:57` still “B0.5 — overlay rename/trash” while HUD has workbench rails — stale comment, not a hash mismatch we can prove without the Mach-O. |
| **R5** overlay `pack.apply`: `allowTrust` false, overlay-eligible only, forbidden fields blocked | **HOLD** (policy in exclusive files + mapping; router is D) | Engine default `allowTrust = opts?.allowTrust === true` `pack-engine.ts:1501` → false unless opted `[inspected]`. List stamps `overlay_eligible: isOverlayEligiblePack(...)` `pack-engine.ts:864` `[inspected]`. HTML `/api/packs/apply` constructs `{pack_id, thread_id, user_gesture:true}` only — POST body `allowTrust` / `workspace_path` / `force_takeover` / `confirmation_phrase` stripped `[executed]` `summoner-web.ts:542-554`. Swift refuses ineligible rows `SummonerOverlay.swift:640-648` `[inspected]`. Menu-bar `handleSummonerPackApply` `menu-bar-agent.ts:873-882` `summonerClient.applyPack(packId, tid)` (no Trust fields). **ACL does not strip `pack.apply` extras** (`allowTrust:true` still on msg after policy `[executed]`) — defense in depth is HTML constructor + Lane D router. Pointer, not a Lane A BLOCK. |
| **R6** `knowledge.set_active` extra keys stripped; unknown ids must not persist | **HOLD** (strip in ACL; unknown-id persistence is D) | Policy `summoner-acl.ts:107-124` keeps only `type` / `thread_id` / string `ids` (max 32); `tool_whitelist` / `pin_thread_id` / `allowTrust` deleted; missing `thread_id` → `SUMMONER_ACL` `[executed]`. Unknown-id filter is router (Lane D pointer). |
| **S-C** reclaim live overlay only if bound session token still live; lagged `summonerThreadId` cannot steal newer overlay | **HOLD** | Bind is `(id, token)` `menu-bar-agent.ts:169-172`; `setSummonerThreadId` **gone** `[executed]` source grep. Reclaim `menu-bar-agent.ts:690-710` calls `shouldReclaimLiveOverlayThread` then `claimOverlayIfLive`. Probe: after second `beginOverlaySession()`, old token reclaim of lagged `A` is **false**; live token **true** `[executed]`. Submit-ok bind live-gated `menu-bar-agent.ts:1106-1108`. Hydrate bind inside submit live-gated `:1079-1081`. Stream frames dropped unless `summonerCmdMatchesThread(cmd, summonerThreadId)` `:1879` + `client.ts:275-280`. `hydrateOverlayIfLive` abandoned path does not bind (`:716-740`: bind only if `result === "claimed"`). |
| No HTML `getUserMedia` | **HOLD** | HTML page 200, body has no `getUserMedia` `[executed]`. `summoner-web.ts` source has none `[executed]`. CSP header `connect-src 'self'` `summoner-web.ts:372-373` `[executed]`. Swift mic is `AVAudioEngine` `SummonerOverlay.swift:93`, not browser getUserMedia. |
| Overlay cannot open Chrome Side Panel | **HOLD** | `handleSummonerAttach` `menu-bar-agent.ts:1027-1032` → `attachChromeOnly` `client.ts:234-242` (`openChrome` / `openChromeSilent` only). Probe: silent → `openChromeSilent`; foreground → `openChrome`; never a sidePanel call `[executed]`. HTML has no `sidePanel` / `openSidePanel` `[executed]`. `openSidePanel()` at `menu-bar-agent.ts:623` is tray quick-action / `handleAction "chrome"` `:1670`, not overlay attach. |
| Mac HUD `mcp.add` / `knowledge.import` ride tray client, not overlay WS | **HOLD** | `handleSummonerMcpAdd` `menu-bar-agent.ts:912-920` `companionClient.sendAppRequest("mcp.add", …)`. `handleSummonerKnowledgeImport` `:995-1003` `companionClient.sendAppRequest("knowledge.import", {content, title})`. Source does **not** call `summonerClient.sendAppRequest("mcp.add"|"knowledge.import")` `[executed]` grep. Protocol events exist as **stdin** (`protocol.ts:642-657`), then mapped to tray. HTML has no add/import endpoints `[executed]`. `persistSummonerHotkeyChosen` uses in-process `saveConfig` `:1144-1148`, not overlay `config.set`. |

`ws/validate.ts`: git diff empty. Validators still accept tray T3 types; summoner denial is lifecycle ACL **after** validate (`lifecycle.ts:1038-1044`). No new overlay bypass in validate.

---

## New defects

None P0 / P1. Prior nits **re-verified**, not folded (P1 fold was Lane B). Do not skip Trust:

### nit — C-thin HTML vs Swift HUD (documented, re-verified)

1. **Skills activate-only** `[executed]` `summoner-web.ts:923` always posts `on:true`. Swift toggles `on: !on` `SummonerOverlay.swift:688`. HTML API *can* deactivate (`summoner-web.ts:472-484`) but the page never sends `on:false`.
2. **Knowledge replace-not-toggle** `[executed]` `summoner-web.ts:938` `ids:[id]` replaces the active set. Swift attach is toggle via current list `menu-bar-agent.ts:965-979`.
3. **MCP toggle L2 stall** `[inspected]`: HTML `/api/mcp/toggle` → `dispatchAllowed("mcp.toggle_server")` → `dispatchSummonerWeb(summonerClient, …)` (`menu-bar-agent.ts:1633-1645`, `summoner-web.ts:456-463`). Enabling a disabled stdio server wants origin-bound L2 on that overlay socket; overlay ACL denies `security.confirmation.response`. Swift toggle uses `companionClient` `menu-bar-agent.ts:893-896` (tray L2 chrome). Overlay does **not** auto-approve; it stalls/times out. Trust preserved.

### nit — ACL `pack.apply` extras are pass-through

`applySummonerPayloadPolicy` rewrites `thread.update` / `knowledge.set_active` but leaves `pack.apply` keys intact `[executed]` (probe: `allowTrust:true` still on msg). Raw overlay WS could still *carry* `allowTrust:true`. Exclusive mapping (HTML constructor, `applyPack()` args, Swift stdin `summoner.pack.apply` + `pack_id` only) does not send it; Lane D router must keep `allowTrust: !overlayApply`. Defense-in-depth gap, not a live overlay HTML hole.

### nit — `SWIFT_TRAY_SHA256` comment stale; binary absent on this host

Comment `swift-tray-bridge.ts:57` still says "B0.5 — overlay rename/trash" while `SummonerOverlay.swift` has packs/MCP/skills/knowledge rails. Pin unchanged by this fold (`ed4dbfa0…`) `[executed]`. Cannot hash `dist/cmspark-tray` here. Mac CI / next Darwin dogfood should `shasum` the Mach-O against `ed4dbfa0…`.

### nit — HTML SSE allowlist includes `mcp.confirm.pending`

`SUMMONER_WEB_EVENT_ALLOW` `summoner-web.ts:60` + UI status `summoner-web.ts:991-993` ("MCP 工具需在 Chrome 侧栏批准"). Probe: SSE **does** forward `mcp.confirm.pending`, **drops** `security.confirmation.request` `[executed]`. Not Allow/Deny chrome; no response path. Honest C-thin status.

---

## Confirmed-safe (r2)

- Handshake `surface: "summoner"` then per-message ACL + payload policy + `stampCmsparkSurface` overwrite (`lifecycle.ts:1038-1053`). Loopback HTML is **not** an allowed WS Origin. Browser never upgrades companion WS (`summoner-web.ts` header comment).
- Overlay chat/lease/pack/skill/knowledge USE stay on `summonerClient`; T3 mutates and hotkey persist stay off overlay `config.set`.
- Spec SUPERSEDES HUD A “overlay 不管 pack·MCP”: live ACL still has `pack.apply` / `mcp.toggle_server` / `skill.activate|deactivate` / `knowledge.set_active` as declared, without overlay confirm dialect.
- MUT kills: allowing `mcp.add` on a copy would pass R1; skipping trash-only would pass R2 hard-delete. Live copies still DENY. Load-bearing.

---

## Cross-cut pointers (not Lane A BLOCKs)

- Overlay `pack.apply` server force `allowTrust:false` + overlay-eligible + forbidden-field reject: `companion/src/message-router.ts` (Lane D).
- Unknown knowledge ids dropped before persist: message-router `knowledge.set_active` (Lane D).
- Overlay-session generation primitive: `companion/src/summoner/overlay-session.ts` (read for S-C; bind/reclaim mapping is exclusive `menu-bar-agent.ts`).

---

Lane A exclusive surface is **unchanged** by the P1 fold. R1–R6 / S-C / GUM / Side Panel / T3 all re-HOLD independently. Residual nits are the same T2 C-thin / defense-in-depth items as r1 — not new holes, not fold regressions.

VERDICT: APPROVE_WITH_NITS
