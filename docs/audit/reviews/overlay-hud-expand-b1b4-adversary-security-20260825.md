# Independent adversary — Overlay HUD Expand B1–B4 (Security / Trust)

> **Lane**: Security / Trust (ADR-020)  
> **Role**: independent adversary — did **not** implement this. Do not rubber-stamp.  
> **Date**: 2026-08-25  
> **Repo**: `/Users/huchen/Projects/cmspark`  
> **HEAD**: `feat/knowledge-honesty-wave0` (`2dee37a`) + dirty compose tree (`summoner-acl`, `menu-bar-agent`, `SummonerOverlay.swift`, `summoner-web`, `swift-tray-bridge`, `summoner-workbench-compose.test.ts`)  
> **Spec**: `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md` §2 items 2–5 / 实现波次 B1–B4  
> **Prompt**: `docs/audit/reviews/overlay-hud-expand-b1b4-dual-review-prompt-20260825.md`  
> **Blast**: **T2** UI compose + **T3** `mcp.add` / `knowledge.import` (stdin → **tray** `companionClient`, **not** summoner WS).

```text
Surface:      L0 overlay HUD workbench (Mac NSPanel) + C-thin HTML reads/toggles
L2-classes:   none on HUD; mcp.add stdio spawn uses existing tray L2
Compose:      threads + packs.apply (overlay-eligible) + mcp.toggle + skill toggle
              + knowledge USE (set_active) + knowledge import HITL
Autonomy:     n/a
Trust:        summoner ACL: reads + overlay-safe writes (pack.apply, mcp.toggle_server,
              skill.activate/deactivate, knowledge.list/set_active).
              mcp.add + knowledge.import DENIED on summoner WS; launcher uses tray client.
              thread.update overlay still alias-only.
              no overlay Allow/Deny dialect; NSAlert 导入/添加/取消 (no 确认)
Channel:      community
```

Capability declaration: **present** in the dual-review prompt (matches spec §0 axes). Axes fit: this is **Surface L0** workbench chrome attaching **Composition** (Pack / MCP toggle / Skill / Knowledge USE). T3 mutates (`mcp.add` stdio spawn, `knowledge.import`) are **not** opened on the overlay socket. They leave the summoner ACL and ride the existing tray WS + tray L2. **No new runtime. No new confirm family.**

Trust monotonicity: overlay is **stricter** than tray on the same methods (`pack.apply` forces `allowTrust:false` + overlay-eligible; `thread.update` still alias-only; `mcp.add` / `knowledge.import` / `config.set` method-denied). L0 does not inherit tray Trust-B / stdio-spawn semantics.

---

## MACHINE

Commands (cwd `companion/` unless noted):

```text
./node_modules/.bin/tsc --noEmit                    # exit 0
./node_modules/.bin/tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/summoner-workbench-compose.test.js \
  .test-dist/tests/summoner-acl.test.js \
  .test-dist/tests/summoner-protocol.test.js \
  .test-dist/tests/summoner-web.test.js \
  .test-dist/tests/summoner-thread-manage.test.js \
  .test-dist/tests/summoner-overlay.test.js \
  .test-dist/tests/overlay-eligible.test.js \
  .test-dist/tests/swift-tray-integrity.test.js \
  .test-dist/tests/ws-router-validator-lockstep.test.js
                                                    # 127 pass / 0 fail
shasum -a 256 dist/cmspark-tray
  == SWIFT_TRAY_SHA256 (swift-tray-bridge.ts:59)
  == ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda
```

Adversarial probes (not in the suite) against `assertSummonerAllowed` / `applySummonerPayloadPolicy` / live `handleMessage` with `__cmspark_surface: "summoner"` (temp `CMSPARK_DATA_DIR`). Cited below as `[executed]`.

| Check | Result |
|-------|--------|
| `tsc --noEmit` | PASS `[executed]` |
| slice tests (acl/protocol/web/thread-manage/overlay/workbench-compose/eligible/pin/lockstep) | **127 pass / 0 fail** `[executed]` |
| pin lockstep (constant == `dist/cmspark-tray`) | PASS `[executed]` |
| R1 overlay WS `mcp.add` / `knowledge.import` / `config.set` | **denied** `[executed]` |
| R2 overlay `thread.update` writes whitelist / knowledge ids | **cannot** `[executed]` |
| R3 overlay Allow/Deny / `summoner.confirm.*` | **absent** on overlay path `[inspected]` + protocol tests `[executed]` |
| R4 pin ≠ binary | PASS `[executed]` |
| R5 overlay `pack.apply` skips overlay-eligible / `allowTrust=false` | **no** — L1/evaluate denied; L0 apply does not write Trust `[executed]` |
| R6 `knowledge.set_active` unknown ids / extra trust keys | extra keys **stripped**; unknown ids **not persisted** `[executed]` |

---

## 三层

### Outcome (what a summoner-surface peer can actually do)

| Attack | Outcome |
|--------|---------|
| summoner WS `mcp.add` / `knowledge.import` / `config.set` | `SUMMONER_ACL`, never reaches router |
| HTML `/api/mcp/add` / `/api/knowledge/import` / `/api/config` | no route / not in `SUMMONER_WEB_DISPATCH_ALLOW` |
| Mac HUD ＋添加 / ＋导入 | stdin `summoner.mcp.add` / `summoner.knowledge.import` → **tray** `companionClient` (L2 still on stdio add) |
| summoner WS `thread.update` extra keys + valid alias | extra keys **stripped** to `{ alias }` |
| overlay `pack.apply` + `allowTrust:true` + `confirmation_phrase` / `workspace_path` / `force_takeover` | `pack_overlay_forbidden_fields` |
| overlay `pack.apply` of L1/`evaluate` / missing pack | `pack_not_overlay_eligible`; thread unchanged |
| overlay `pack.apply` of L0 eligible pack + client `allowTrust:true` | composition applies; **no** Trust snap; globals unchanged |
| overlay `knowledge.set_active` + trust keys + mixed ids | keys stripped to `type/thread_id/ids`; only **known** ids persist |
| Overlay confirm dialect | stdin decoder returns null; Swift overlay uses `NSAlert` 添加/导入/取消 |

### Trajectory (order of gates)

1. WS: `validateWsMessage` → handshake `authState.surface` (server-stamped) → `assertSummonerAllowed` → `applySummonerPayloadPolicy` → `stampCmsparkSurface` overwrite → `handleMessage`. Fail closed with `error_code: SUMMONER_ACL` **before** the router.  
2. `pack.apply`: `user_gesture === true` → `overlayApply = stampedSurface === "summoner"` → forbidden-field reject → `isOverlayEligiblePack` on **installed** manifest → trust-cookie reject → `applyPack(..., { allowTrust: !overlayApply })`. Client `allowTrust` is **never read**.  
3. HTML: endpoint constructs a **narrow** payload → `dispatchAllowed` re-applies payload policy with `surface="summoner"` → `dispatchSummonerWeb` on the **summoner** `CompanionClient` → lifecycle gates again. No `/api/dispatch`. No tray fallback for compose.  
4. Mac HUD T3: Swift stdin `summoner.mcp.add` / `summoner.knowledge.import` → `decodeSummonerInbound` (rejects `summoner.confirm.*`) → `handleSummonerMcpAdd` / `handleSummonerKnowledgeImport` hard-wires **`companionClient`** (tray). Overlay socket never sees `mcp.add` / `knowledge.import`.

### Component (where the trust lives)

Load-bearing:

- Method ACL `SUMMONER_ALLOW` in `companion/src/ws/summoner-acl.ts` (T3 methods absent).  
- Payload policy in the same file, invoked from `companion/src/ws/lifecycle.ts` **and** `companion/src/summoner-web.ts` `dispatchAllowed`.  
- Router `pack.apply` overlay branch (`stampedSurface === "summoner"`) — method ACL opening `pack.apply` is **unsafe by itself**; this is the Trust gate.  
- Router `knowledge.set_active` existence filter (`listKnowledge` name/id set).  
- Launcher split: T3 mutates on `companionClient`, overlay-safe compose on `summonerClient`.

Not load-bearing for overlay safety: native `NSAlert` / `window.confirm` (UX HITL). A token-bearing HTTP client can `knowledge.set_active` / `pack.apply` without clicking an overlay button; it still cannot `mcp.add` / `knowledge.import` / raise Trust.

---

## Attack results

### 1. Can overlay WS `mcp.add` / `knowledge.import` / `config.set`? (R1)

**No.** `[executed]` on the ACL function, HTML allowlist, and menu-bar source lock.

```14:45:companion/src/ws/summoner-acl.ts
const SUMMONER_ALLOW = new Set([
  ...
  "mcp.list",
  "mcp.toggle_server",
  "pack.list",
  "pack.apply",
  ...
  "knowledge.list",
  "knowledge.set_active",
  ...
])
```

`mcp.add`, `knowledge.import`, `knowledge.import_directory`, `mcp.update`, `pack.install`, `config.set`, `security.confirmation.response` are **not** in the set. `assertSummonerAllowed("summoner", t)` → `{ ok:false, error_code:"SUMMONER_ACL" }` for each `[executed]`.

Lifecycle applies this **before** `handleMessage`:

```1038:1053:companion/src/ws/lifecycle.ts
        const gate = assertSummonerAllowed(authState.surface, msg.type)
        if (!gate.ok) {
          ...
          return
        }
        const payloadGate = applySummonerPayloadPolicy(authState.surface, msg)
        ...
        stampCmsparkSurface(msg, authState.surface)
```

Surface is handshake state, not a client-supplied `msg.surface`. Spoof `{ surface: "tray", type: "mcp.add" }` on a summoner socket still denies. `stampCmsparkSurface` runs **after** the ACL and overwrites `__cmspark_surface`.

HTML second gate:

```19:42:companion/src/summoner-web.ts
export const SUMMONER_WEB_DISPATCH_ALLOW = new Set([
  ...
  "mcp.toggle_server",
  "pack.list",
  "pack.apply",
  ...
  "knowledge.set_active",
  ...
])
```

`has("mcp.add") === false`, `has("knowledge.import") === false`, `has("config.set") === false` `[executed]`. `POST /api/config` → 404, dispatched length 0 (suite). There is **no** `/api/mcp/add` or `/api/knowledge/import`.

Mac HUD T3 is stdin → tray, not overlay WS:

```918:924:companion/src/menu-bar-agent.ts
async function handleSummonerMcpAdd(name: string, command: string): Promise<void> {
  if (!companionClient || !name || !command) return
  try {
    const resp = await companionClient.sendAppRequest("mcp.add", {
      name,
      server: { transport: "stdio", command, enabled: true, trust_level: "manual" },
    })
```

Same pattern at `menu-bar-agent.ts:996-1002` for `knowledge.import`. Source lock: `companionClient.sendAppRequest("mcp.add"` / `"knowledge.import"` present; `summonerClient.sendAppRequest("mcp.add"` / `"knowledge.import"` **absent** (suite + `[inspected]`). If tray client is down, add/import is a no-op — fail closed, not overlay-ACL bypass.

Stdio add still hits existing tray L2 (`requireMcpStdioSpawnConfirm`, `autoConfirmEligible: false`, `companion/src/message-router/handlers/mcp.ts:32-69`). Overlay NSAlert 添加 is **not** a substitute for that L2; it is a form, then tray confirm window.

**R1 does not fire.**

### 2. Can overlay `thread.update` write `tool_whitelist` / knowledge ids? (R2)

**No.** B0.5 payload clause is still on the hot path. `[executed]`

Router **will** persist those keys if they reach it (`message-router.ts` `thread.update` allowlist includes `tool_whitelist` / `active_knowledge_ids` / `config_override`). Overlay policy replaces the whole `updates` object:

```87:105:companion/src/ws/summoner-acl.ts
  if (type === "thread.update") {
    ...
    msg.updates = { alias }
    return { ok: true }
  }
```

Probe: `{ alias: "ok", tool_whitelist: null, active_knowledge_ids: ["k"], config_override: { x: 1 } }` → `updates` becomes `{ alias: "ok" }` `[executed]`.

HTML PATCH still constructs `{ updates: { alias } }` only (`summoner-web.ts:424-433`).

**R2 does not fire.**

### 3. Overlay Allow/Deny chrome / `summoner.confirm.*`? (R3)

**No overlay confirm dialect.** `[inspected]` + protocol tests `[executed]`.

| Surface | Confirm UX | Allow/Deny / `summoner.confirm.*` |
|---------|------------|-----------------------------------|
| Mac overlay (`SummonerOverlay.swift`) | native `NSAlert` (“添加 MCP” / “导入知识” / “添加” / “导入” / “取消”) | **none** in this file (`rg` 允许\|拒绝\|Allow\|Deny\|确认 → no matches). Suite `doesNotMatch(overlay, /允许\|拒绝\|Allow\|Deny\|确认/)`. |
| C-thin HTML | `window.prompt` / `window.confirm` (trash, B0.5 spec-allowed) | no Allow/Deny buttons; badge still “批准在侧栏”; SSE drops `security.confirmation.request` |
| stdin protocol | `isSummonerConfirmDialect` → decode returns null | `{ cmd: "summoner.confirm.allow" }` / `{ type: "summoner.confirm.deny" }` invalid `[executed]` |

Pinned binary `[executed]`: contains `summoner.mcp.add` / `summoner.knowledge.import` / `summoner.pack.apply` / `导入知识` / `名字和启动命令`. Does **not** contain `summoner.confirm`.

`允许` / `拒绝` / `确认` / `Allow` / `Deny` **do** appear in `companion/dist/cmspark-tray` because **Tray.swift 确认台 (spike)** still has Allow/Deny — a **different window**, pre-existing L2/HUD confirm, not overlay workbench. R3 is overlay HUD / `summoner.confirm.*`. Do not conflate.

`security.confirmation.response` is **denied** on summoner ACL. Overlay cannot answer a tray/panel confirm `[executed]`.

**R3 does not fire.**

### 4. Pin ≠ binary? (R4)

**No.** `[executed]`

```
SWIFT_TRAY_SHA256 = ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda
shasum -a 256 companion/dist/cmspark-tray
  = ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda
```

`swift-tray-bridge.ts:59` matches the on-disk binary. Feature strings for B1–B4 protocol names are in that binary.

**R4 does not fire.**

### 5. Does overlay `pack.apply` skip overlay-eligible / `allowTrust=false`? (R5)

**No.** UI gray is **not** the gate. Server SoT is `isOverlayEligiblePack` + forced `allowTrust: !overlayApply`. `[executed]` on live `handleMessage`.

```3004:3037:companion/src/message-router.ts
      const overlayApply = stampedSurface === "summoner"
      if (overlayApply) {
        if (rest.workspace_path || rest.force_takeover || rest.confirmation_phrase) {
          return { type: "error", error: "pack_overlay_forbidden_fields", code: "pack_overlay_forbidden_fields" }
        }
        ...
        if (!inst.result.ok || !isOverlayEligiblePack(inst.result.manifest)) {
          return { type: "error", error: "pack_not_overlay_eligible", code: "pack_not_overlay_eligible" }
        }
        ...
      }
      const r = applyPack(..., {
        allowTrust: !overlayApply,
        forceTakeoverTrust: forceTakeover,
        confirmation_phrase: overlayApply ? undefined : rest.confirmation_phrase,
      })
```

`stampedSurface` comes from `stripCmsparkSurface` after lifecycle overwrite (`composer-lease.ts:115-118`). Client cannot set `__cmspark_surface: "tray"` on a summoner socket.

Probe `[executed]` (temp data dir, real `installPackFromDirectory`):

| Call | Result |
|------|--------|
| summoner + `confirmation_phrase` + `workspace_path` + `force_takeover` + `allowTrust:true` | `pack_overlay_forbidden_fields` |
| summoner + missing/L1 pack `appsec-lite` (`evaluate` in allow) + `allowTrust:true` | `pack_not_overlay_eligible`; mission_pack_id unchanged |
| summoner + L0 `meeting-notes` + client `allowTrust:true` | `pack.applied`; `mission_pack_trust_snapshot=null`; `tool_whitelist=null`; `security.auto_approve_dangerous` stays **false**; prompt append applied |
| tray + same L1 `appsec-lite` | `pack.applied`; `tool_whitelist=["evaluate","list_tabs"]` (tray privilege, not overlay) |

`isOverlayEligiblePack` (`packs/overlay-eligible.ts:8-18`) denies `trust` block, non-L0 `min_capability`, `mcp_servers`, `board_mode`, deny-id (`appsec`/`netsec`/`shell`/`coding-handoff`), dangerous tool allow-list. List SoT uses the same function (`pack-engine.ts:864`). Swift UI also refuses ineligible clicks (`SummonerOverlay.swift:643-647`) — defense in depth, not the Trust gate.

HTML `POST /api/packs/apply` constructs `{ pack_id, thread_id, user_gesture: true }` and **drops** `allowTrust` / `workspace_path` / `force_takeover` from the body (suite). Dispatch still goes through summoner client → overlay branch.

Mac HUD `handleSummonerPackApply` uses **`summonerClient`** (`menu-bar-agent.ts:879-888`) + `CompanionClient.applyPack` which only sends `{ pack_id, thread_id, user_gesture: true }` (`companion-client.ts:314-320`). Correct: overlay-eligible must run on the summoner stamp, not the tray socket.

**R5 does not fire.**

### 6. Does `knowledge.set_active` accept unknown ids or extra trust keys? (R6)

**Extra trust keys do not land. Unknown ids do not persist.** `[executed]`

Overlay policy (`summoner-acl.ts:107-123`):

- requires non-empty `thread_id` (else `SUMMONER_ACL`)
- keeps only string ids (drops numbers / blanks), cap 32
- **deletes every other own key** (`allowTrust`, `confirmation_phrase`, `tool_whitelist`, `config_override`, `pin_thread_id`, `trust`, …)

Probe: after policy, `Object.keys(msg) === ["type","thread_id","ids"]`; `ids` is `["real","fake","real"]` (existence is **not** this layer).

Router existence filter (`message-router.ts:2648-2656`):

```2648:2656:companion/src/message-router.ts
      const ids = Array.isArray(rest.ids) ? rest.ids.filter(...).slice(0, 32) : []
      const known = new Set(skillEngine.listKnowledge().map((d) => d.name || d.id).filter(Boolean))
      const next = ids.filter((id: string) => known.has(id))
      threadManager.update(rest.thread_id, {
        active_knowledge_ids: next,
        knowledge_selection_mode: "manual",
      })
```

Probe with a seeded `real.md` knowledge doc `[executed]`:

| Payload | Persisted |
|---------|-----------|
| `ids: ["real","unknown-id","evaluate"]` + `allowTrust` + `confirmation_phrase` + `tool_whitelist` | `["real"]`; mode `manual` |
| `ids: ["nope"]` (unknown only) | `[]` (clears selection; does **not** insert `"nope"`) |

DoD 5 (“ids must exist in knowledge list”) holds for **what is written**. The handler **does not ACL-reject** a mixed/unknown payload — it filter-closes. Unknown-only ≡ explicit `ids:[]` (overlay USE toggle-off). Extra trust keys are ignored even if policy were skipped (handler never reads them).

HTML `POST /api/knowledge/active` forwards `{ thread_id, ids }` only, then the same policy (`summoner-web.ts:493-502`).

**R6 does not fire.**

---

## ADR-020

- **Surface**: L0 overlay workbench (Mac NSPanel + C-thin HTML). No L2 classes **on this surface**.  
- **Composition**: Pack apply (eligible L0 only), MCP list/toggle, skill activate/deactivate, knowledge list + `set_active`. `mcp.add` / `knowledge.import` are Composition **install** paths, not opened on overlay WS — they reuse tray client + existing stdio L2. Not a new runtime.  
- **Autonomy**: n/a.  
- **Trust**: summoner ACL + payload policy + router overlay `pack.apply` branch. Confirm dialect **reuses** native `NSAlert` (导入/添加/取消) and tray L2 for stdio spawn. **No third confirm family** (ADR-020 §6 反模式 2). Pack cannot relax globals from overlay (`allowTrust` forced false; eligible packs cannot carry `trust`). Trust is **monotonic** vs tray (stricter).  
- **Channel**: community.  
- **originWs**: overlay cannot `security.confirmation.response`. Stdio add origin-binds to the **tray** socket.  
- **god-mode / CU L2**: untouched.

---

## DoD / REJECT matrix

| ID | Claim | Verdict |
|----|--------|---------|
| DoD 1 | Rail 场景 → overlay-eligible `pack.apply` (router `allowTrust=false` + eligible) | PASS `[executed]` |
| DoD 2 | Rail MCP toggle; ＋添加 stdin then **tray** `mcp.add`; overlay WS still ACL-denied | PASS `[executed]` |
| DoD 3 | Rail 技能 activate/deactivate on current thread | PASS `[inspected]` `handleSummonerSkillToggle` uses `summonerClient` |
| DoD 4 | Rail 知识 `set_active`; ＋导入 NSOpenPanel + NSAlert then tray `knowledge.import`; overlay WS denied | PASS `[inspected]` + ACL `[executed]` |
| DoD 5 | `set_active` strips extra keys; ids must exist | PASS (filter-closed) `[executed]` |
| DoD 6 | No HUD Allow/Deny / `summoner.confirm.*` | PASS |
| DoD 7 | Pin lockstep | PASS `[executed]` |
| DoD 8 | C-thin can list/toggle overlay-safe methods; cannot dispatch `mcp.add`/`knowledge.import` | PASS on **HTTP allowlist**; HTML **page** still has no compose rails (nit) |
| R1 | overlay WS `mcp.add` / `knowledge.import` / `config.set` | **no** |
| R2 | overlay `thread.update` writes composition keys | **no** |
| R3 | HUD Allow/Deny / `summoner.confirm.*` | **no** |
| R4 | pin ≠ binary | **no** |
| R5 | overlay `pack.apply` skips eligible / `allowTrust=false` | **no** |
| R6 | `set_active` accepts unknown ids or extra trust keys | **no** (keys stripped; unknown not persisted) |

---

## Nits (non-blocking)

1. **No suite test of overlay `pack.apply` at `handleMessage`.** Workbench tests source-lock menu-bar / ACL / HTML field stripping. The load-bearing branch (`message-router.ts:3004-3037`) is untested in-tree. Adversarial probe above proves it works; a regression that comments out `allowTrust: !overlayApply` would still go green. Add: summoner-stamped L1 pack → `pack_not_overlay_eligible`; L0 pack + client `allowTrust:true` → no Trust snap.

2. **Unknown ids are filter-closed, not `SUMMONER_ACL`.** Mixed payload keeps known ids; unknown-only **clears** `active_knowledge_ids` (same as `ids:[]`). Correct for USE toggle-off; do not document it as “reject unknown”. Policy existence-check would be theater without `skillEngine` on the ACL path — router filter is the right layer.

3. **C-thin HTML page does not render 场景/MCP/技能/知识 rails** (`SUMMONER_HTML` still 对话-only; hint “知识配置/批准去侧栏”). Endpoints exist, so a token-bearing loopback client **can** list/toggle/`pack.apply`/`set_active` — overlay-safe, and **cannot** `mcp.add`/`knowledge.import`. Product gap, not T3 hole. DoD 8 is API-true, UI-false.

4. **HTML `mcp.toggle_server` rides summoner WS, Mac HUD toggle rides tray.** Enabling a disabled stdio server requires origin-bound L2 (`mcp.ts:394-410`). Overlay cannot `security.confirmation.response` → HTML re-enable **fail-closes** (timeout/deny). Mac HUD toggle uses `companionClient` so tray 确认台 can approve. Split is fail-closed, but C-thin users cannot re-enable stdio MCP from the overlay HTTP API. Do not “fix” this by opening confirm response on summoner.

5. **TOCTOU** between `readInstalledManifest` eligibility check and `applyPack` re-read. Needs write access to `packs/installed/` (already host-equivalent). `allowTrust` still false, so Trust B cannot rise; composition/`tool_whitelist` of a swapped-in dangerous pack could. Residual, not R5 as a logic skip.

6. **`skill.activate` does not existence-filter.** Overlay can append a phantom `skill_name` to `active_skill_ids` (`message-router.ts:2450-2458`). Skills are prompt templates, not tool grants. Asymmetric vs knowledge. Nit.

7. **Residual `thread.create` composition write** on summoner WS (`config_override` ungated) — pre-existing S21 / B0.5 nit. HTML create is `{}`. Not R2 (`thread.update`).

8. **Pinned-binary `strings` is a weak HUD UI oracle.** UTF-8 `添加` / `取消` / `＋ 添加 MCP` are not contiguous; protocol names + `导入知识` / `名字和启动命令` are. Tray 确认台 允许/拒绝 **are** in the same binary — do not treat that as overlay Allow/Deny.

9. **Prompt MACHINE claimed 119 tests**; this lane executed **127 pass / 0 fail** with `summoner-overlay` included. Count drift only.

---

## Blockers

None. R1–R6 do not fire. T3 mutates are tray-client-only. Overlay `pack.apply` cannot raise Trust. Policy and eligible gates are on the production lifecycle / router paths, not test-only.

---

VERDICT: APPROVE_WITH_NITS
