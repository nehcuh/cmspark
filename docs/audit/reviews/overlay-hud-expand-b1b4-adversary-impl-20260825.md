# Independent adversary (Implementer-skeptic) — Overlay HUD Expand B1–B4

**Batch**: `overlay-hud-expand-b1b4`  
**Role**: independent Implementer-skeptic (did **not** implement). READ-ONLY except this report.  
**Spec**: `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md` §2 items 2–5 / 实现波次 B1–B4  
**Prompt**: `docs/audit/reviews/overlay-hud-expand-b1b4-dual-review-prompt-20260825.md`  
**HEAD**: `2dee37ac` + dirty worktree (B1–B4 lives in uncommitted companion sources + `companion/dist/cmspark-tray`)

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

This lane attacks incomplete wiring, grep-theater tests, SHA pin lies, missing handlers, and TypeScript exhaustiveness holes. Not a rubber stamp of the machine card.

---

## Machine re-run `[executed]`

| Claim | Result |
|---|---|
| `shasum -a 256 companion/dist/cmspark-tray` | `ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda` |
| `SWIFT_TRAY_SHA256` `companion/src/tray/swift-tray-bridge.ts:59` | **equal** (R4 does not fire) |
| Binary Mach-O arm64; mtime 18:29:03 > `SummonerOverlay.swift` 18:28:35 > `Tray.swift` 18:27:08`; pin file 18:29:17 | lockstep rebuild + pin paste, not a stale hash |
| `npx --offline tsc --noEmit` (companion) | exit 0 |
| `npx --offline tsx --test tests/summoner-workbench-compose.test.ts` | **7 pass / 0 fail** |
| overlay + acl + protocol + web + thread-manage + workbench-compose + ws-router lockstep + talk + client | **175 pass / 0 fail** |
| python set-diff decode inbound ↔ `handleSummonerInbound` | **empty** |
| python set-diff decode outbound ↔ `Tray.swift` `handleCommand` summoner cases | **empty** |
| python set-diff Swift `jsonLine` types ↔ decode inbound | Swift ⊂ decode; only missing `summoner.mic.chunk` (pre-B1, not this knife) |
| python needles in binary | `summoner.pack.apply` ×1, `.mcp.toggle` ×1, `.mcp.add` ×1, `.skill.toggle` ×1, `.knowledge.attach` ×1, `.knowledge.import` ×1, `.mcp.servers` ×1; **no** `summoner.confirm` |

Naive UTF-8 `strings` miss short CJK HUD titles (`添加` / `取消` / `添加 MCP`) because Swift SSO packs ≤15-byte UTF-8 into registers. Contiguous longer literals **are** in the binary (`导入知识`, `场景`, `技能`, `知识`) plus mangled `packRowClicked` / `mcpAddClicked` / `knowledgeImportClicked` / `applyPacks` / `overlay_eligible`. This is **not** a pin lie.

Binary `Allow`/`Deny`/`确认`/`允许`/`拒绝` resolve to **HudController** confirm chrome and tray copy — pre-existing, not Summoner overlay. `rg` on `SummonerOverlay.swift`: **NONE**.

Pin comment still says “Updated 2026-08-25 B0.5” (`swift-tray-bridge.ts:57`) while this hash is the B1–B4 rebuild — cosmetic.

Machine card “119 pass” is an undercount of the file set I re-ran; I will not REJECT a count. The 7 compose tests are real as far as they go (see Layer 3).

---

## Layer 1 — Outcome (DoD / REJECT gates)

| # | Observable | Verdict | Evidence |
|---|---|---|---|
| 1 | Rail 场景 lists packs; overlay-eligible click → `summoner.pack.apply`; router `allowTrust=false` + eligible | **pass** | `pushSummonerRail` encodes `overlay_eligible` `menu-bar-agent.ts:798-804`. Swift greys ineligible (`SummonerOverlay.swift:562-566`) and refuses click (`:640-648`). Handler uses `summonerClient.applyPack` (`:879-888`) which sends `user_gesture: true` (`companion-client.ts:317-320`). Router `stampedSurface === "summoner"` forces `allowTrust: !overlayApply` and `isOverlayEligiblePack` (`message-router.ts:3004-3038`). |
| 2 | Rail MCP lists; click toggles; ＋ 添加 stdin `summoner.mcp.add` then **tray** `mcp.add`; overlay WS `mcp.add` ACL-denied | **pass** | Toggle: stdin `summoner.mcp.toggle` → `handleSummonerMcpToggle` uses `companionClient` (`menu-bar-agent.ts:899-915`). Add: Swift NSAlert `添加`/`取消` (`SummonerOverlay.swift:658-681`) → `handleSummonerMcpAdd` `companionClient.sendAppRequest("mcp.add", …)` (`:918-924`). Overlay ACL deny executed (`summoner-workbench-compose.test.ts:51-55`, `summoner-acl.test.ts:29`). Tray L2 for stdio spawn still `requireMcpStdioSpawnConfirm` (`mcp.ts:262-266`). Using tray (not summoner WS) for toggle-on of disabled stdio is the **correct** L2 path — overlay has no Allow/Deny. |
| 3 | Rail 技能 lists; click toggles activate/deactivate on current thread | **pass** | `pushSummonerRail` `skill.list` + `thread.select` for `active_skill_ids` (`:825-845`). Click → `summoner.skill.toggle` → `summonerClient.sendAppRequest(on ? "skill.activate" : "skill.deactivate", { thread_id, skill_name })` (`:940-951`). |
| 4 | Rail 知识 lists; click `knowledge.set_active`; ＋ 导入 NSOpenPanel + NSAlert then tray `knowledge.import`; overlay WS denied | **pass (gesture / ACL)** / **fail (payload)** | Attach: stdin `summoner.knowledge.attach` → overlay `knowledge.set_active` (`:967-980`). Import: NSOpenPanel + NSAlert `导入`/`取消` (`:697-720`) → `companionClient.sendAppRequest("knowledge.import", { content, file: { name, type, content } })` (`:996-1003`). Overlay WS deny executed. **UTF-8 text files are decoded as base64** (see Layer 2). |
| 5 | `knowledge.set_active` overlay policy strips extra keys; ids must exist in knowledge list | **pass** | Policy keeps only `type`/`thread_id`/`ids`, string-filters ids, max 32 (`summoner-acl.ts:107-123`). Executed unit test strips `tool_whitelist` (`summoner-workbench-compose.test.ts:58-68`). Router `known = listKnowledge().map(name \|\| id)` then `ids.filter(known.has)` (`message-router.ts:2651-2652`) — unknown ids do not persist. Policy itself does **not** look up the catalog (pure function); existence is router-side. |
| 6 | No HUD Allow/Deny / `summoner.confirm.*` | **pass** | Overlay source clean. Decode drops `summoner.confirm.*` (`protocol.ts:391-396, 482, 566`). NSAlert titles are `添加`/`导入`/`取消`, not `确认`. |
| 7 | Pin lockstep | **pass** | R4 does not fire. |
| 8 | C-thin HTML can list/toggle packs/mcp/skills/knowledge.set_active; cannot dispatch mcp.add/knowledge.import | **pass (HTTP/ACL)** / **fail (page)** | Routes exist (`summoner-web.ts:446-555`). `SUMMONER_WEB_DISPATCH_ALLOW` has the overlay-safe set and **not** `mcp.add`/`knowledge.import` (`:19-42`). HTTP test proves `POST /api/packs/apply` strips `allowTrust`/`workspace_path`/`force_takeover` (`summoner-web.test.ts:351-375`). **The HTML page script never fetches those APIs** — rail is 对话-only; copy still `听写/知识配置/批准去侧栏处理` (locked by `summoner-web.test.ts:121`). Spec §3 “Win/Linux HTML 本文件不改成 HUD；先 Mac.” |

### REJECT gates

| ID | Fire? | Why |
|---|---|---|
| **R1** overlay WS can `mcp.add` / `knowledge.import` / `config.set` | **no** | `SUMMONER_ALLOW` does not contain them (`summoner-acl.ts:14-45`). Lifecycle ACL runs before `handleMessage` (`lifecycle.ts:1038-1051`). HTML: no routes, allow-set false, `POST /api/config` → 404 with `dispatched.length === 0` (`summoner-web.test.ts:377-390`). Stdin `summoner.mcp.add` / `summoner.knowledge.import` are **decoded and intended** — they hop to `companionClient` (tray), not summoner WS. |
| **R2** overlay `thread.update` writes trust keys | **no** | B0.5 policy still in place (`summoner-acl.ts:87-105`). Not regressed by this knife. |
| **R3** overlay Allow/Deny / `summoner.confirm.*` | **no** | Overlay source clean. Binary hits are HudController. |
| **R4** pin ≠ binary | **no** | Byte-identical `ed4dbfa0…9a5fda`. |
| **R5** pack.apply from overlay skips overlay-eligible / allowTrust=false | **no** | Router overlay branch does **not** skip (`message-router.ts:3004-3038`). Swift pre-filter is UX; stdin of a non-eligible `pack_id` still dies at `isOverlayEligiblePack`. `rest.allowTrust` is ignored — `allowTrust: !overlayApply`. **No executed test of this router branch** (see Layer 3). |
| **R6** knowledge.set_active accepts unknown ids or extra trust keys | **no** | Extra keys deleted in-place by overlay policy (executed). Unknown ids dropped by router `known` set before `threadManager.update`. “Accepts” at the policy layer (unknown strings pass through) is by design for a pure function; they do not land on the thread. |

---

## Layer 2 — Trajectory (did they actually connect the pipes?)

### Protocol ↔ handler ↔ Swift ↔ Tray `[inspected]` `[executed]`

Inbound decode cases and `handleSummonerInbound` cases are the **same 24 types** (python set-diff empty). Swift `jsonLine` types are a subset; none are unknown to the decoder. `swift-tray-bridge.ts:550` decodes before `handleSummonerInbound` (`menu-bar-agent.ts:1455+`) — raw `mcp.add` / `knowledge.import` **WS types** on the stdin pipe are dropped (`decode` default `null`). The stdin types are `summoner.mcp.add` / `summoner.knowledge.import`.

Outbound decode cases and `Tray.swift` `handleCommand` summoner cases are the **same 18 cmds** (set-diff empty). New B1–B4 cmds `summoner.packs` / `summoner.mcp.servers` / `summoner.skills` / `summoner.knowledge` are handled:

```610:620:companion/src/tray/Tray.swift
  case "summoner.packs":
    summonerController.applyPacks(json)

  case "summoner.mcp.servers":
    summonerController.applyMcpServers(json)

  case "summoner.skills":
    summonerController.applySkills(json)

  case "summoner.knowledge":
    summonerController.applyKnowledge(json)
```

Handler cases `[inspected]` `menu-bar-agent.ts:1512-1528`:

```1512:1528:companion/src/menu-bar-agent.ts
    case "summoner.pack.apply":
      void handleSummonerPackApply(evt.pack_id)
      return
    case "summoner.mcp.toggle":
      void handleSummonerMcpToggle(evt.name, evt.enabled)
      return
    case "summoner.mcp.add":
      void handleSummonerMcpAdd(evt.name, evt.command)
      return
    case "summoner.skill.toggle":
      void handleSummonerSkillToggle(evt.name, evt.on)
      return
    case "summoner.knowledge.attach":
      void handleSummonerKnowledgeAttach(evt.id)
      return
    case "summoner.knowledge.import":
      void handleSummonerKnowledgeImport(evt.name, evt.mime, evt.content)
      return
```

No missing B1–B4 case. Switch still has **no** `default: const _e: never = evt` fuse. Current union is covered so `tsc` is green; a future inbound variant would compile without a handler. Same nit as B0.5.

`applyMcp(_ names:)` is now a stub (`SummonerOverlay.swift:330-332`) — the old connected-name chip is unused. Rail uses `applyMcpServers`. Not a hole.

### T3 hops use tray origin `[inspected]`

| stdin | client | WS type | Why |
|---|---|---|---|
| `summoner.pack.apply` | `summonerClient` | `pack.apply` | overlay-eligible + `allowTrust=false` need summoner stamp (`:1834-1840`) |
| `summoner.mcp.toggle` | **`companionClient` (tray)** | `mcp.toggle_server` | enabling disabled stdio hits L2; overlay cannot Allow/Deny |
| `summoner.mcp.add` | **`companionClient`** | `mcp.add` | dual-prompt law; L2 `requireMcpStdioSpawnConfirm` |
| `summoner.skill.toggle` | `summonerClient` | `skill.activate` / `deactivate` | overlay-safe |
| `summoner.knowledge.attach` | `summonerClient` | `knowledge.set_active` | overlay-safe; policy + router known-set |
| `summoner.knowledge.import` | **`companionClient`** | `knowledge.import` | dual-prompt law |

The compose grep test asserts `companionClient.sendAppRequest("mcp.add")` and does **not** match `summonerClient.sendAppRequest("mcp.add")` (`summoner-workbench-compose.test.ts:122-125`). That grep is honest about the T3 hop. It does **not** invoke the handlers.

### Payload policy is not dead code `[inspected]`

`applySummonerPayloadPolicy` is invoked in **both** overlay WS paths:

1. `lifecycle.ts:1045` after `assertSummonerAllowed`, before `stampCmsparkSurface` / `handleMessage`.
2. `summoner-web.ts:172` inside `dispatchAllowed` with hardcoded `surface: "summoner"`.

HTML constructors do not spread the body for compose writes:

- `POST /api/packs/apply` → `{ pack_id, thread_id, user_gesture: true }` only (`:550-553`). HTTP test **executes** this (`summoner-web.test.ts:351-375`).
- `POST /api/knowledge/active` → `{ thread_id, ids }` only (`:493-501`). **No HTTP test.**
- `POST /api/mcp/toggle` / `/api/skills/toggle` similarly construct the safe subset. **No HTTP tests.**

### Knowledge import encoding is connected and wrong `[executed]`

Swift (`SummonerOverlay.swift:715-720`):

```swift
jsonLine([
  "type": "summoner.knowledge.import",
  "name": url.lastPathComponent,
  "mime": mimeTypeForAttach(url: url),
  "content": String(data: data, encoding: .utf8) ?? data.base64EncodedString(),
])
```

Menu-bar (`menu-bar-agent.ts:996-1003`) always wraps as `file`:

```996:1003:companion/src/menu-bar-agent.ts
    const resp = await companionClient.sendAppRequest("knowledge.import", {
      content,
      title: name,
      file: { name, type: mime || "text/plain", content },
    })
```

`loadKnowledgePayload` prefers `rest.file` and does `Buffer.from(String(content), "base64")` (`message-router.ts:363-372`). `[executed]` Node:

```
utf8 = "---\ntitle: 周报\n---\n# hello"
Buffer.from(utf8, "base64") → 12 garbage bytes, not the markdown
```

Typical `.md`/`.txt` (valid UTF-8, `mimeTypeForAttach` → `text/plain`) therefore **imports garbled text**. PDF/binary takes the `?? base64` branch and would round-trip. The advertised B4 HITL path is the markdown one. Tests never touch `loadKnowledgePayload`. This is incomplete wiring, not grep-theater — the type names are connected; the bytes are not.

Fix (not in this review’s scope): Swift always `base64EncodedString()`, or menu-bar omit `file` and pass plaintext `content` for UTF-8.

### C-thin page does not grow a compose rail `[inspected]` `[executed]`

`SUMMONER_HTML` (`summoner-web.ts:613-926`) has 对话 + rename/trash + chat. Zero `fetch("/api/packs")` / `/api/mcp` / `/api/skills` / `/api/knowledge`. GET `/` HTTP test still **requires** `听写/知识配置/批准去侧栏处理` (`summoner-web.test.ts:121`). Dual-prompt DoD 8 is therefore API-true and UI-false. Spec “先 Mac” is the design out; the compose test’s “C-thin HTML compose endpoints” greps **route source**, not the page.

---

## Layer 3 — Component (tests, types, SHA, size)

### Tests: mutation vs grep-theater

| Test | Kind | Notes |
|---|---|---|
| ACL allows compose reads/writes; denies `mcp.add`/`knowledge.import`/`config.set` | **executes** `assertSummonerAllowed` | real; this is the R1 pin |
| `knowledge.set_active` policy strips extra keys + requires `thread_id` | **executes** `applySummonerPayloadPolicy` | real; extra-keys half of R6. Does **not** pin unknown-id rejection (router does) |
| inbound pack/mcp/skill/knowledge encode/decode round-trip | **executes** protocol | real; stdin types exist |
| outbound mcp.servers/skills/knowledge lists round-trip | **executes** protocol | real |
| menu-bar maps compose stdin to overlay-safe / tray-origin paths | **grep** `menu-bar-agent.ts` | does not call handlers; does pin `companionClient` vs `summonerClient` for T3 |
| HUD workbench rails live | **grep** Swift | binary independently has symbols + protocol type strings |
| C-thin compose endpoints off mcp.add/knowledge.import | **set membership + grep** | allow-set is real; `assert.match(web, /mcp\.toggle_server/)` is the **route**, not the page |
| POST `/api/packs/apply` strips allowTrust | **HTTP** | real constructor; does **not** hit overlay-eligible router |
| HTML GET `/` workbench | **HTTP** | still 对话-only; **locks** 侧栏 copy |
| overlay-eligible helper | **executes** `isOverlayEligiblePack` | `overlay-eligible.test.ts`; **not** the router `stampedSurface === "summoner"` branch |
| `remaining inbound events round-trip` (`summoner-protocol.test.ts:220`) | **executes** | does **not** include B1–B4 types (those live only in compose.test) |

So: ACL + policy extra-keys + protocol codecs are **not** grep-only. The *wiring* of menu-bar / Swift rails / HTML page / router overlay-eligible / knowledge import bytes is grep + source inspection + one Node encoding demo. Same overlay-test culture as B0 / B0.5. I will not REJECT for that while R1/R6 extra-keys actually fire.

Gaps I would still want before calling the suite honest:

- Invoke `handleSummonerKnowledgeImport` (or `loadKnowledgePayload`) with UTF-8 markdown — would fail today.
- HTTP `POST /api/knowledge/active` with extra keys + unknown ids (name already implied by DoD 5).
- HTTP `POST /api/mcp/toggle` / `/api/skills/toggle`.
- Router `pack.apply` with `stampedSurface: "summoner"` + ineligible pack / `allowTrust: true` in the raw message.
- Handler tests that `handleSummonerMcpAdd` does not use `summonerClient`.

### SHA / binary `[executed]`

Pin == binary == claimed digest. New protocol type strings present. Short CJK button titles absent as contiguous UTF-8 **because of Swift SSO**, not because the UI was compiled out. `summoner.packs` is 15 ASCII bytes (SSO) → 0 hits; `applyPacks` ×2 still in the Mach-O.

### Exhaustiveness

- `decodeSummonerInbound` has `default: return null` (`protocol.ts:665-666`) — unknown stdin types die.
- `handleSummonerInbound` is a statement-switch with no `never` default. All current `SummonerInboundEvt` members are present (set-diff empty). `tsc --noEmit` exit 0 does **not** prove a future union member would fail CI.
- Overlay `knowledge.set_active` policy is a closed `if type === …`. `knowledge.import` is method-ACL denied, not payload-denied. Safe today.

### Spaghetti / file size (code-review bar, not B1–B4 REJECT)

`SummonerOverlay.swift` is **1858** lines. `menu-bar-agent.ts` is **2060**. Compose added another ~200 lines of rail/alert in the same god-controller. Canonical stdin map is still `handleSummonerInbound`. Not a Trust regression.

---

## Attacks that did not land

1. **Overlay WS `mcp.add` / `knowledge.import` / `config.set`** — ACL + HTML 404 + no allow-set membership. Stdin T3 types are a different channel and hop to tray.
2. **`thread.update` trust keys** — B0.5 policy untouched.
3. **pack.apply overlay skip eligible / allowTrust** — router overlay branch is real; Swift greying is extra. Test gap, not a skip.
4. **Unknown knowledge ids persist** — router `known` filter. Policy lets them through; they do not write.
5. **SHA theater** — `shasum` equals the constant; binary contains the new protocol types and click selectors.
6. **Allow/Deny in overlay binary** — false positive from HudController / AppKit `setAllows*`. Overlay source `rg` empty.
7. **mcp.toggle via tray is a Trust elevation hole** — it is a **required** L2 path for stdio enable. Overlay-safe toggle that would spawn without a confirm surface would be worse.

---

## Nits (non-blocking for REJECT gates; #1 should be fixed before claiming B4 import)

1. **Knowledge import encoding (DoD 4 quality)** — UTF-8 `.md`/`.txt` sent as `file.content` is `Buffer.from(..., "base64")` garbage. `[executed]` Node. PDF/binary may work. No test.
2. **Grep-theater remainder** — `summoner-workbench-compose.test.ts:114-157` three tests are `readFileSync` + regex. They do not invoke handlers, do not HTTP-toggle, do not prove the HTML page lists packs.
3. **C-thin page is still 对话-only** — DoD 8 UI. Spec “先 Mac”. HTML test locks 侧栏 copy. HTTP capability is there if someone curls it.
4. **No `never` default** on `handleSummonerInbound` (`menu-bar-agent.ts:1455-1536`).
5. **No executed overlay `pack.apply` router test** — R5 is `[inspected]` only.
6. **Pin comment stale** (`swift-tray-bridge.ts:57` still says B0.5).
7. **`mcp.add` command is a single string** with no `args` split (`menu-bar-agent.ts:921-924`). `npx -y @pkg /tmp` will spawn a binary named that whole line. Overlay NSAlert then tray L2 is double HITL — matching “NSAlert 添加/取消” + “existing tray L2”, but clumsy.
8. **Pack apply success is `encodeSummonerError`** (`menu-bar-agent.ts:894-896`) — lands in the transcript as `系统: 已套到当前对话…`. Works, lying type.
9. **`summoner-protocol.test.ts` “remaining inbound” does not list B1–B4 types** — coverage lives only in the new compose file. If that file is skipped, codecs regress silently.

---

## ADR-020

Declaration in the dual prompt matches the blast: L0 overlay, L2 none **on HUD**, compose = packs/mcp toggle/skills/knowledge USE, T3 `mcp.add`/`knowledge.import` stay off overlay WS and use tray + existing stdio L2. Confirm dialect unchanged. Channel community. Trust monotonic: overlay cannot `config.set` / `mcp.add` / `knowledge.import` / write `tool_whitelist`; `pack.apply` cannot raise Trust. Pack-first: no new Side Panel chrome. `originWs`: no new overlay `securityConfirmations.request` — stdio spawn still tray L2.

The knowledge-import byte bug is a functional hole on a T3 path, not a Trust elevation.

---

VERDICT: APPROVE_WITH_NITS
