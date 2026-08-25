# Independent adversary (Implementer-skeptic) — Overlay HUD Expand B0.5

**Batch**: `overlay-hud-expand-b05`  
**Role**: independent Implementer-skeptic (did **not** implement). READ-ONLY except this report.  
**Spec**: `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md` §2 item 1 / 实现波次 B0.5  
**Prompt**: `docs/audit/reviews/overlay-hud-expand-b05-dual-review-prompt-20260825.md`  
**HEAD**: `2dee37ac` + dirty worktree (B0.5 lives in uncommitted companion sources + `companion/dist/cmspark-tray`)

```text
Surface:      L0 overlay HUD workbench thread management (Mac NSPanel + C-thin HTML)
L2-classes:   (none)
Compose:      thread rename + trash; Companion-owned; no Chrome Side Panel required
Autonomy:     n/a
Trust:        SUMMONER_ALLOW grows thread.delete + thread.update;
              applySummonerPayloadPolicy forces mode=trash and alias-only;
              omitted/hard delete on summoner → SUMMONER_ACL (no silent coerce);
              confirm stays native NSAlert / HTML confirm(), no overlay Allow/Deny dialect
Channel:      community
```

This lane attacks incomplete wiring, grep-theater tests, SHA pin lies, missing handlers, and TypeScript exhaustiveness holes. Not a rubber stamp of the machine card.

---

## Machine re-run `[executed]`

| Claim | Result |
|---|---|
| `shasum -a 256 companion/dist/cmspark-tray` | `e068754969612ff74341cbd12719d7358e1301960396caf610252869e1bd0a3e` |
| `SWIFT_TRAY_SHA256` `companion/src/tray/swift-tray-bridge.ts:59` | **equal** (R4 does not fire) |
| Binary Mach-O arm64; mtime 17:25 > `SummonerOverlay.swift` 17:24 | lockstep rebuild, not a stale pin |
| `npx --offline tsc --noEmit` (companion) | exit 0 |
| thread-manage + protocol + overlay + talk + web | **122 pass / 0 fail** |
| + `summoner-acl.test.ts` (9) | **131** — matches machine card |
| thread-cleanup + swift-tray-integrity + ws-router lockstep | 30 with acl; **21 without** |
| `tests/single/files.test.ts` | 70 pass |
| cleanup+integrity+lockstep+files | **91** — matches machine card |
| `thread.delete default hard; explicit trash soft` | pass (`thread-cleanup-context.test.ts`) |
| python3 needles in binary | `summoner.thread.rename` ×1, `summoner.thread.trash` ×1; **no** `thread.delete` / `mode:"hard"` / `summoner.confirm` |

Naive UTF-8 `strings` miss HUD copy `重命名` / `移到回收站` (Swift SSO packs ≤15-byte UTF-8 into registers). Contiguous longer literals **are** in the binary (`给这条对话一个名字`, interpolation suffix `」会离开当前列表。`) plus mangled `promptRename` / `promptTrash` / `threadMoreClicked` / `NSAlert`. This is **not** a pin lie.

Binary `Allow`/`Deny`/`确认`/`允许`/`拒绝` resolve to **HudController** confirm chrome (`confirmAllowButton` / `confirmDenyButton`) and tray copy — pre-existing, not Summoner overlay.

---

## Layer 1 — Outcome (DoD / REJECT gates)

| # | Observable | Verdict | Evidence |
|---|---|---|---|
| 1 | Overlay rename writes `Thread.alias`, no Side Panel | **pass** | Swift `jsonLine` `summoner.thread.rename` `SummonerOverlay.swift:435` → decode `protocol.ts:510-513` → `handleSummonerThreadRename` `menu-bar-agent.ts:1172-1179` sends `thread.update` `{ updates: { alias: trimmed } }` on `summonerClient` (`surface: "summoner"` `:1634`) |
| 2 | Overlay trash-only; omitted/hard → `SUMMONER_ACL` | **pass** | Policy `summoner-acl.ts:71-78` (`msg.mode !== "trash"` deny). Lifecycle applies it **after** method ACL, **before** `handleMessage` (`lifecycle.ts:1038-1051`). Router default remains hard (`message-router.ts:1606-1608`) for tray. Overlay never sends `thread.delete` on stdin — type is `summoner.thread.trash`. |
| 3 | `thread.update` alias-only | **pass** | Policy replaces `msg.updates` with `{ alias }` (`summoner-acl.ts:98`). Extra `tool_whitelist` / `active_knowledge_ids` / `config_override` stripped when alias is valid; keys-only / empty alias denied. HTML constructs `{ updates: { alias } }` (`summoner-web.ts:424-426`) and HTTP test asserts strip (`summoner-web.test.ts:194-202`). |
| 4 | Mac HUD ⋯ / 右键 + `NSAlert`; no 确认/允许/拒绝/Allow/Deny in overlay source | **pass** | `popThreadMenu` `:406-418`; `promptRename`/`promptTrash` `:420-448`; `sendAction(on: [.leftMouseUp, .rightMouseDown])` `:379`. `rg` on `SummonerOverlay.swift`: **NONE**. Buttons are `重命名` / `移到回收站` / `取消`. |
| 5 | C-thin `PATCH`/`DELETE /api/thread` + page buttons | **pass** | Routes `:418-437`; page `重命名`/`移到回收站` `:650-676`; `dispatchAllowed` re-applies policy `:161-172`. |
| 6 | Trash current → latest remaining else new | **pass (Mac)** / **nit (HTML)** | Mac: `handleSummonerThreadTrash` `:1222-1228` `hitsFromTitleSearch` (`sortRecentFirst`) then `handleSummonerNewThread`. HTML: `threads[0]` after `thread.list` (`summoner-web.ts:670-675`) — index is create-`unshift` order, not `updated_at`. Still leaves the trashed row and creates if empty. |
| 7 | Pin lockstep | **pass** | R4 does not fire. |
| 8 | No `knowledge.*` / `mcp.add` / overlay confirm dialect | **pass** | `SUMMONER_ALLOW` `summoner-acl.ts:14-39` has `thread.delete`/`thread.update` only as the B0.5 write growth. `mcp.add` stays a comment-deny; not in the set. `SUMMONER_WEB_DISPATCH_ALLOW` likewise. `decodeSummonerInbound` drops `summoner.confirm.*` (`protocol.ts:331-336, 464`). |

### REJECT gates

| ID | Fire? | Why |
|---|---|---|
| **R1** overlay hard-delete, or omitted `thread.delete` still hits router default hard | **no** | Policy deny is in-process on the summoner socket. HTML DELETE never reads body/query `mode` — always `{ mode: "trash" }` (`summoner-web.ts:436`). Menu-bar always `mode: "trash"` (`:1202-1204`). Router default hard still proven for tray (`thread-cleanup-context.test.ts:260-270`). |
| **R2** overlay `thread.update` writes trust keys | **no** | In-place strip + HTML constructor + menu-bar `{ alias }` only. Router still *accepts* `tool_whitelist` (`message-router.ts:2190-2206`) — that is tray/legacy; overlay cannot deliver those keys after policy. |
| **R3** HUD Allow/Deny / `summoner.confirm.*` | **no** | Overlay source clean. Binary Allow/Deny is HudController. |
| **R4** pin ≠ binary | **no** | Byte-identical `e0687549…bd0a3e`. |
| **R5** thread manage still Side Panel-bound (Swift/HTML missing rename/trash) | **no** | Both surfaces wired. |
| **R6** ACL also opens `knowledge.*` / `mcp.add` / `thread.restore` / `thread.batch_delete` | **no** | `assertSummonerAllowed("summoner", "thread.restore")` / `batch_delete` false (`summoner-thread-manage.test.ts:32-33`). `mcp.add` / `knowledge.*` still denied (`summoner-acl.test.ts:24-36`, `summoner-web.test.ts:393-399`). |

---

## Layer 2 — Trajectory (did they actually connect the pipes?)

### Protocol ↔ handler `[inspected]`

`decodeSummonerInbound` cases and `handleSummonerInbound` cases are the **same 19 types** (python set-diff empty). Swift `jsonLine` types are a subset; none are unknown to the decoder. `swift-tray-bridge.ts:550` decodes before `handleSummonerInbound` (`menu-bar-agent.ts:1562-1564`) — raw `thread.delete` on the stdin pipe is dropped (`decode` default `null`; explicit test `summoner.thread.delete` → null at `summoner-thread-manage.test.ts:112`).

Handler cases `[inspected]` `menu-bar-agent.ts:1312-1317`:

```1312:1317:companion/src/menu-bar-agent.ts
    case "summoner.thread.rename":
      void handleSummonerThreadRename(evt.thread_id, evt.alias)
      return
    case "summoner.thread.trash":
      void handleSummonerThreadTrash(evt.thread_id)
      return
```

No missing B0.5 case. Switch has **no** `default: const _e: never = evt` fuse (`:1327-1329` ends at `composing`). Current union is covered so `tsc` is green; a future inbound variant would compile without a handler. Nit, not a hole in this batch.

### Payload policy is not dead code `[inspected]`

`applySummonerPayloadPolicy` is imported and invoked in **both** overlay WS paths:

1. `lifecycle.ts:62` import, `:1045` after `assertSummonerAllowed`, before `stampCmsparkSurface` / `handleMessage`.
2. `summoner-web.ts:15` import, `:166` inside `dispatchAllowed` with hardcoded `surface: "summoner"` — so even if `activeDispatch` were a tray socket, HTML cannot smuggle `mode:"hard"` or extra update keys.

The unit test named “lifecycle applies overlay payload policy **after** method ACL” (`summoner-thread-manage.test.ts:115-118`) only `assert.match(/applySummonerPayloadPolicy/)`. It does **not** assert ordering. Ordering is true in source (`acl` offset 2169 < policy 2192 < stamp 2289) but that test is grep-theater.

### HTML sanitizes at the route, not by trusting the page `[inspected]` `[executed]`

- PATCH: ignores `body.updates`; only `body.alias` (`:424-426`). HTTP test sends `{ alias: "周报", tool_whitelist: null }` and asserts dispatched `updates === { alias: "周报" }` (`summoner-web.test.ts:184-202`) — **real mutation**, not grep.
- DELETE: does not `readBody`; ignores `?mode=hard`. Test titled “always trashes **and ignores hard**” (`:205-222`) never sends `hard`. Production still ignores it. Test overclaim.

### Menu-bar sends overlay-safe payloads only `[inspected]`

`handleSummonerThreadRename` `:1177-1179` — `updates: { alias: trimmed }`, no `tool_whitelist`.  
`handleSummonerThreadTrash` `:1202-1204` — `mode: "trash"` only.  
Coverage of these functions in `summoner-thread-manage.test.ts:120-138` is a **source slice grep** (`+1800` / `+2200` char windows), not an invocation.

---

## Layer 3 — Component (tests, types, SHA, size)

### Tests: policy mutation vs grep-theater

| Test | Kind | Notes |
|---|---|---|
| ACL allows delete/update, denies restore/batch | **executes** `assertSummonerAllowed` | real |
| overlay delete trash vs hard vs omitted; tray omitted ok | **executes** `applySummonerPayloadPolicy` | real; this is the R1 pin |
| overlay update strips alias; empty / wl-only deny | **executes** policy + mutates `msg` | real; this is the R2 pin |
| encode/decode rename/trash; empty alias invalid | **executes** protocol | real |
| lifecycle applies policy after ACL | **grep** `lifecycle.ts` | does not pin order |
| menu-bar maps rename/trash + rail refresh | **grep** `menu-bar-agent.ts` slices | does not call handlers |
| HUD ⋯ / NSAlert / no Allow/Deny | **grep** Swift | binary independently has symbols |
| C-thin HTML rename/trash | **grep** `summoner-web.ts` | redundant with HTTP tests |
| PATCH alias-only | **HTTP** | real |
| DELETE mode trash | **HTTP** | real dispatch; “ignores hard” unproven |
| `thread.delete default hard` | **router** | real; tray invariant held |

So: the security invariants are **not** grep-only. The *wiring* of menu-bar / lifecycle / Swift is grep + source inspection. That is the same overlay-test culture as B0 (`summoner-overlay.test.ts:366-381` 2800-char inbound window — coincidentally includes rename/trash at offsets 1600/1712). I will not REJECT for that while policy + HTTP actually fire.

Gaps I would still want before calling the test suite honest:

- HTTP DELETE with body/query `mode=hard` (name already claims it).
- HTTP PATCH `{ alias: "  " }` → 403, `dispatched.length === 0`.
- `handleSummonerThreadTrash` of the current id actually selects `hitsFromTitleSearch()[0]` / new — today grep `pushSummonerRail` only.

### SHA / binary `[executed]`

Pin == binary == claimed digest. Protocol type strings present. Short CJK HUD titles absent as contiguous UTF-8 **because of Swift SSO**, not because the UI was compiled out. Comment above the pin still says “Updated 2026-08-24 after nits fold” (`swift-tray-bridge.ts:57`) while this hash is the 2026-08-25 B0.5 rebuild — cosmetic.

### Exhaustiveness

- `decodeSummonerInbound` has `default: return null` (`protocol.ts:543-544`) — unknown stdin types die.
- `handleSummonerInbound` is a statement-switch with no `never` default. All current `SummonerInboundEvt` members are present (set-diff empty). `tsc --noEmit` exit 0 does **not** prove a future union member would fail CI.
- `applySummonerPayloadPolicy` is a closed `if type === delete / update` — `thread.batch_delete` is **method-ACL** denied, not payload-denied. Safe today; if R6-adjacent allowlist growth forgets the payload function, router `batch_delete` default is **trash** (`message-router.ts:1656`) not hard. Still a composition write overlay should not have. Not in `SUMMONER_ALLOW`.

### Spaghetti / file size (code-review bar, not B0.5 REJECT)

`SummonerOverlay.swift` is **1645** lines (already >1k before this knife). B0.5 added ~100 lines of menu/alert in the same god-controller. Canonical place for the stdin map is `menu-bar-agent.ts` (1854 lines). Not a Trust regression.

### Copy leftover (not R5)

C-thin still says `批准在侧栏` / `听写/知识配置/批准去侧栏处理` (`summoner-web.ts:599,610,698-699`). Approve is specified to stay **tray** NSAlert, not Side Panel, and not this knife. Does not bind rename/trash to Chrome.

---

## Attacks that did not land

1. **Silent coerce omitted delete → trash** — policy returns `SUMMONER_ACL` instead of rewriting `mode`. Matches spec “禁止默默改成 trash”.
2. **HTML body `tool_whitelist`** — dropped at the route constructor; HTTP test proves dispatch never sees it.
3. **stdin `type: thread.delete`** — decoder null; never reaches menu-bar.
4. **SHA theater** — `shasum` equals the constant; binary contains the new protocol types and `promptTrash` symbols.
5. **Allow/Deny in overlay binary** — false positive from HudController / AppKit `setAllows*`.

---

## Nits (non-blocking)

1. **Grep-theater remainder** — `summoner-thread-manage.test.ts:115-162` four tests are `readFileSync` + regex. Lifecycle test does not pin “after ACL / before handleMessage”. Menu-bar test does not invoke `handleSummonerThreadTrash`.
2. **DELETE HTTP test overclaim** — `:205` title “ignores hard” never sends hard (`summoner-web.test.ts:205-222`).
3. **`summoner-acl.test.ts:44-68` S21 allow-loop never lists `thread.delete`/`thread.update`** — covered in the new file; old file would not fail if those two were *removed* from `SUMMONER_ALLOW` unless thread-manage also runs.
4. **No `never` default** on `handleSummonerInbound` (`menu-bar-agent.ts:1264-1329`).
5. **HTML post-trash `threads[0]`** is create-unshift order, not `sortRecentFirst` (`summoner-web.ts:673` vs `client.ts:50-51` / `menu-bar-agent.ts:1226`).
6. **Pin comment stale** (`swift-tray-bridge.ts:57`).
7. **Whitespace-only alias on stdin**: decode accepts `"   "` (`!o.alias` is false); handler trims and **returns silently** (`menu-bar-agent.ts:1174-1175`). WS/HTML policy rejects. Inconsistent but not a trust write.

---

## ADR-020

Declaration in the dual prompt matches the blast: L0 overlay, L2 none, compose = alias + trash, confirm dialect unchanged, channel community. Trust monotonic: overlay cannot hard-delete and cannot write composition keys the router still honors for tray. Pack-first: no new Side Panel chrome. `originWs`: no new `securityConfirmations.request`.

---

VERDICT: APPROVE_WITH_NITS
