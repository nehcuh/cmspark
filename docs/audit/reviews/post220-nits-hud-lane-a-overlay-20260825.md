# Lane A — Overlay / C-thin HUD restyle / ACL (independent adversary)

**Role**: INDEPENDENT ADVERSARY. Did **not** implement. Did **not** edit production source. Default **REFUTED** until `file:line` + `[executed]` / `[inspected]`.
**HEAD**: `8f5c94c6325a9bd1081a6cc400062532e81d71ff`
**Base**: `d4cbbfaefe38ce32dd6e0bc771bcab2c32f07c13`
**Branch**: `fix/post220-head-p1-fold`
**Frozen patch**: `docs/audit/reviews/post220-nits-hud-diff-20260825.patch`
**SHA256**: `AB1D1A1285F558BE52A86D5A1F5A6B8EDB5BC671F565348337B7240F6EFE6825` `[executed]` `Get-FileHash -Algorithm SHA256`
**Prior**: `docs/audit/reviews/head-6ce291db-post220-p1-r2-lane-a-overlay-20260825.md` (AWN). Do not re-open folded P1s unless this increment **regressed** them.
**Machine**: Windows PowerShell. `companion/dist/cmspark-tray` **missing**.
**Mutation copies**: `.tmp-adv-nits-hud-a/` only; **deleted after run**.

Range: nits fold `7ec76d78` + Windows C-thin HTML → paper HUD `8f5c94c6`. Exclusive files only for findings.

## Exclusive range (findings only here)

- `companion/src/summoner-web.ts`
- `companion/src/ws/summoner-acl.ts`
- `companion/src/menu-bar-agent.ts`
- `companion/src/tray/swift-tray-bridge.ts`
- `companion/tests/summoner-web.test.ts`
- `companion/tests/summoner-acl.test.ts`

Out-of-range reads for mapping only: `message-router.ts` (`thread.select` ids; overlay `pack.apply` force-false), `ws/lifecycle.ts` (ACL then payload then stamp). No BLOCK claimed on those paths.

Intentionally out of slice: D-N3 drain peek/take TOCTOU; Mac `dist/cmspark-tray` binary; native WKWebView/WebView2 (C-thin Chromium `--app` title bar remains).

`git diff d4cbbfae..HEAD -- <exclusive>` → 6 files, +262/−82 `[executed]`.

---

## Capability (live SoT, ADR-020)

Implementer claim:

```text
Surface:      L0 overlay HUD workbench (Mac NSPanel + Win C-thin HTML restyle)
L2-classes:   none on HUD; mcp.toggle HTML now rides tray client
Compose:      threads / pack.apply overlay-safe / knowledge USE / skill toggle
Autonomy:     n/a
Trust:        overlay ACL: pack.apply extras stripped; knowledge.import still denied on summoner WS
              HTML restyle is visual only — no new confirm dialect, no Allow/Deny
Channel:      community
```

**Axes fit** `[inspected]`: this hang is Surface L0 (C-thin restyle to paper workbench) + Composition (overlay-safe pack/skill/knowledge/mcp.toggle). Not a second agent runtime. Pack-first: apply stays `pack.apply`, not new primary Side Panel chrome.

**Trust monotonicity** `[executed]` + `[inspected]`: ACL still lists overlay-safe compose writes. T3 mutates stay off overlay WS (`mcp.add` / `knowledge.import` / `config.set` / `security.confirmation.response` → `SUMMONER_ACL`). HTML restyle does not add confirm chrome. `mcp.toggle_server` now rides `companionClient` (existing tray L2), matching Swift — not a new overlay dialect and not a silent confirm skip.

**Confirm dialects**: no `summoner.confirm.*` in exclusive HTML. Trash uses `window.confirm` (spec-allowed). No 允许/拒绝/Allow/Deny/确认 in page body.

**originWs**: exclusive files do not add `securityConfirmations.request`. HTML MCP toggle origin is the tray socket when `companionClient` exists.

**No new runtime / experimental**: C-thin still titled「召唤器（实验）」. Blast stays **T2**. Would escalate to T3 only if overlay WS grew `mcp.add` / `knowledge.import` / `config.set`, or overlay grew Allow/Deny — **not observed**.

---

## MACHINE table `[executed]`

Cwd `companion/` unless noted.

| Command | Result |
|---------|--------|
| `git rev-parse HEAD` | `8f5c94c6325a9bd1081a6cc400062532e81d71ff` |
| `git rev-parse d4cbbfae` | `d4cbbfaefe38ce32dd6e0bc771bcab2c32f07c13` |
| Frozen patch SHA256 | `AB1D1A1285F558BE52A86D5A1F5A6B8EDB5BC671F565348337B7240F6EFE6825` **match** |
| `.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` | **pass** (exit 0) |
| `npx tsx --test tests/summoner-acl.test.ts tests/summoner-web.test.ts tests/summoner-workbench-compose.test.ts` | **pass** 45/45, fail 0, ~0.66s |
| Private probe `.tmp-adv-nits-hud-a/probe.ts` (live ACL/HTML loopback + two MUT kills) | **pass** 7/7 HOLD; dir **deleted** |
| `companion/dist/cmspark-tray` | **MISSING** on Windows (R7 inspected pin vs source) |

In-tree tests were **not** treated as sole proof. Probe re-imported `assertSummonerAllowed` / `applySummonerPayloadPolicy` / `SUMMONER_WEB_DISPATCH_ALLOW`, hit a live loopback HTML server (paper tokens, no `#12141c`, T3 404, pack.apply strip), then mutated **copies** of `summoner-acl.ts` (drop `delete msg.allowTrust`) and HTML strings (`on:true` / `ids:[id]` / `--paper:#12141c`).

---

## Must-falsify scorecard

Default REFUTED. Each HOLD is this run.

| ID | Result | Evidence |
|----|--------|----------|
| **1** HTML is paper HUD (`rail-btn` SVG, `--paper #fff`) not dark `#12141c` admin. Tests lock tokens. | **HOLD** | Live GET `/?token=` 200 `[executed]`. Body matches `--paper:#fff`, `--indigo:#4f46e5`, `class="rail-btn"`, `<svg `; does not match `#12141c` `[executed]`. Tokens at `summoner-web.ts:620-626`; rail 52px + list 216px `:623`; rail-btn SVG `:640-645`, `:713-728`. In-tree lock `summoner-web.test.ts:118-121` `[executed]`. Collapse hides `.body` not composer `:635` (底栏仍在). MUT: `--paper:#12141c` copy would fail the doesNotMatch pin `[executed]`. |
| **2** No overlay Allow/Deny / 确认 chrome in HTML (`doesNotMatch` 允许\|拒绝\|Allow\|Deny\|确认). `window.confirm` for trash is spec-allowed. | **HOLD** | Loopback body does not match `允许\|拒绝\|Allow\|Deny\|确认` `[executed]`. Sole confirm is `window.confirm("把「…」移到回收站？")` `summoner-web.ts:817` `[executed]`. Rename is `window.prompt("重命名")`. SSE still drops `security.confirmation.request` (`SUMMONER_WEB_EVENT_ALLOW` + `/confirm/i` `summoner-web.ts:217`) `[inspected]`. In-tree `summoner-web.test.ts:142` `[executed]`. No `getUserMedia` / `sidePanel` in HTML `[executed]`. |
| **3** `pack.apply` overlay policy strips `allowTrust` / `workspace_path` / `force_takeover` / `confirmation_phrase`; `user_gesture` true. | **HOLD** | `applySummonerPayloadPolicy` `summoner-acl.ts:125-142` deletes the four keys, requires trimmed `pack_id`+`thread_id`, sets `user_gesture = true` `[executed]`. HTML constructor still only forwards `{pack_id, thread_id, user_gesture:true}` `summoner-web.ts:542-554`; POST extras not copied `[executed]` loopback. Lifecycle still runs payload policy after method ACL `lifecycle.ts:1038-1051` `[inspected]`. Tray surface not rewritten `[executed]`. Missing ids → `SUMMONER_ACL` `[executed]`. MUT: copy with `delete msg.allowTrust` removed → `allowTrust:true` **survives**; live still strips `[executed]`. |
| **4** HTML `mcp.toggle_server` rides `companionClient` (tray) not overlay L2 stall. | **HOLD** | `dispatchSummonerWeb` `menu-bar-agent.ts:1628-1630` early-return `companionClient.sendAppRequest(type, params, 60_000)` `[executed]`. Swift already used tray `handleSummonerMcpToggle` `:893-896`. HTML `/api/mcp/toggle` still constructs `{name, enabled}` `summoner-web.ts:456-463` then dispatch `[inspected]`. In-tree source pin `summoner-web.test.ts:543-546` `[executed]`. Overlay ACL still denies `security.confirmation.response` (claim 6). |
| **5** Skills `on:!on`; knowledge `ids:next` toggle not replace-all. | **HOLD** | HTML `summoner-web.ts:1018-1028` reads `active_skill_ids` then posts `{skill_name:s.name,on:!on}`; `:1035-1046` `next=on?cur.filter…:cur.concat([id])` then `{ids:next}` `[executed]`. API maps `on !== false` → `skill.activate` else `skill.deactivate` `:472-483`; knowledge POST forwards `ids` `:493-501`. GET `/api/thread` is `thread.select` `:414-421` `[inspected]`. In-tree `summoner-web.test.ts:535-541` `[executed]`. MUT: restore `on:true` / `ids:[id]` would fail those pins `[executed]`. |
| **6** R1 still: `SUMMONER_ALLOW` and WEB dispatch deny `mcp.add` / `knowledge.import` / `config.set`. | **HOLD** | `SUMMONER_ALLOW` `summoner-acl.ts:14-45` has none of the three `[executed]`. `assertSummonerAllowed("summoner", t)` → `SUMMONER_ACL` including `security.confirmation.response` `[executed]`. `SUMMONER_WEB_DISPATCH_ALLOW` `summoner-web.ts:19-42` same denials; WEB ⊆ ACL `[executed]`. Loopback POST `/api/config`, `/api/mcp/add`, `/api/knowledge/import` → **404**, dispatched=[] `[executed]`. `dispatchAllowed` 403s unknown types `:167-169`. |
| **7** Swift pin comment-only; hash unchanged. | **HOLD** | Diff `swift-tray-bridge.ts` is one comment line `:57` B0.5 → `B1–B4 — overlay workbench rails` `[executed]`. `SWIFT_TRAY_SHA256` still `ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda` `:59` on **both** sides of `d4cbbfae..HEAD` `[executed]`. `dist/cmspark-tray` missing on this host. |

`thread.select` returning `active_skill_ids` / `active_knowledge_ids` is `message-router.ts:2066-2067` (Lane D pointer). Exclusive HTML consumes those top-level keys. Not a Lane A BLOCK.

---

## New defects

None P0 / P1. Folded C-thin nits (activate-only, replace-all, MCP overlay stall, named `pack.apply` Trust extras, stale Swift comment) **re-HOLD as folded**. Residual nits below do not skip Trust.

### nit — `pack.apply` policy is named-delete, not a full rewrite

`knowledge.set_active` drops every key except `type` / `thread_id` / `ids` (`summoner-acl.ts:118-122`). `pack.apply` only `delete`s four names then sets `pack_id` / `thread_id` / `user_gesture` `[executed]`. Probe: `leftover:"still-here"` and snake `allow_trust:true` **remain** after a successful overlay policy. Router still forces `allowTrust: !overlayApply` (Lane D pointer) so camel `allowTrust` is no longer a live overlay hole. Unnamed extras are defense-in-depth, not T3.

### nit — HTML MCP toggle falls through to overlay if `companionClient` is null

`menu-bar-agent.ts:1628` is `type === "mcp.toggle_server" && companionClient`. Else `:1632-1633` `client.sendAppRequest` on the summoner-stamped client — the old L2 stall. Swift toggle `:894` no-ops when tray client is missing. Production tray constructs both clients together; edge case only. Overlay still cannot answer confirms.

### nit — skills/knowledge/mcp pins are source-regex (load-bearing strings, not HTTP toggle)

`summoner-web.test.ts:535-546` greps `on:!on` / `ids:next` / `companionClient`. MUT shows the strings are load-bearing `[executed]`. There is no loopback test that GET `/api/thread` round-trips `active_skill_ids` and that a second click deactivates. Mapping depends on `thread.select` shape (D).

### nit — visual leftovers vs HUD spec (not Trust)

- Ghost 发送/纠偏/排队/停止 `.ghost{…min-height:32px}` `summoner-web.ts:696-698` vs spec 底栏 ≥44px. Send is no longer a primary `.btn` (fold matches 「不要把发送做成主按钮」).
- Chevron path does not flip on collapse (`summoner-web.ts:755-757,934-938`); `aria-pressed` does.
- Duplicate CSS `.item.active,.row[aria-current="true"],.item.active` `:656`.

### nit — HTML SSE allowlist still includes `mcp.confirm.pending` (not folded)

`SUMMONER_WEB_EVENT_ALLOW` `summoner-web.ts:60` + UI `summoner-web.ts:1099-1101` ("MCP 工具需在 Chrome 侧栏批准"). Probe: allowlist still has it; still **drops** `security.confirmation.request` `[executed]`. Not Allow/Deny chrome; no response path. Honest C-thin status. Same residual as r1/r2.

---

## Confirmed-safe

- Handshake `surface: "summoner"` then per-message ACL + payload policy + `stampCmsparkSurface` overwrite. Loopback HTML is **not** an allowed WS Origin (in-tree `isAllowedWsOrigin("http://127.0.0.1:23403") === false`). Browser never upgrades companion WS (`summoner-web.ts:1-6`).
- Paper HUD restyle is CSS + rail SVG + bottom composer. CSP still `connect-src 'self'` `summoner-web.ts:372-373`. Mic button stays `disabled` (no HTML GUM).
- Overlay chat/lease/pack/skill/knowledge USE stay on summoner dispatch; T3 mutates stay 404. `pack.apply` user_gesture is forced on overlay policy **and** HTML constructor (needed for `validate.ts` `user_gesture:true`; overlay apply is the declared composition write).
- MUT kills: removing the four `delete`s lets `allowTrust` through on a copy; restoring `on:true` / `ids:[id]` / `#12141c` would fail the new HTML pins. Live copies still HOLD.

---

## Cross-cut pointers (not Lane A BLOCKs)

- Overlay `pack.apply` server force `allowTrust:false` + overlay-eligible + forbidden-field reject: `companion/src/message-router.ts` (Lane D). Named extras are now stripped **before** that gate.
- `thread.select` `active_skill_ids` / `active_knowledge_ids`: `message-router.ts:2066-2067` (Lane D). HTML toggle reads those keys.
- Unknown knowledge ids dropped before persist: message-router `knowledge.set_active` (Lane D).
- Mac `dist/cmspark-tray` Mach-O vs `ed4dbfa0…`: cannot hash here.

---

C-thin nits fold + paper HUD restyle hold on exclusive files. R1 T3 denials did not regress. Residual nits are unnamed `pack.apply` extras, `companionClient` null fallback, regex-only compose tests, and the pre-existing SSE `mcp.confirm.pending` status — not overlay Allow/Deny, not Trust skip.

VERDICT: APPROVE_WITH_NITS
