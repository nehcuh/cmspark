# Adversary review (External / spec-honesty) — Overlay HUD Expand B1–B4

**Batch**: `overlay-hud-expand-b1b4`  
**Role**: independent spec-honesty skeptic (did **not** implement; not security/product/impl lane)  
**Spec**: `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md`  
**Prompt**: `docs/audit/reviews/overlay-hud-expand-b1b4-dual-review-prompt-20260825.md`  
**HEAD**: `2dee37a` (`docs(memory): S80 session-end — knowledge honesty Wave 0–2 local ship`) — B1–B4 lives in the **working tree**, not HEAD  
**Evidence**: `[executed]` 119 tsx tests + pin shasum + UTF-8→base64 mis-decode; `[inspected]` ACL / lifecycle / Swift / HTML / router / git index

Looked specifically for: **over-claiming**, **T3 overlay knowledge import without HITL**, **leftover B0 empty-pane lies**, **commit-scope MM files**.

---

## Review scope (do not merge the rest)

Working tree is still a **mixed overlay of several days**, not a B1–B4 commit. Do **not** require this review to bless Chrome Slice A, dogfood Slice B, or knowledge-honesty Wave 0–2.

| In scope (B1–B4 + HUD it sits on) | Out of scope — **and still staged / MM** |
|---|---|
| `companion/src/ws/summoner-acl.ts` | `chrome-extension/src/sidepanel/components/ChatView.tsx` (**MM**) |
| `companion/src/ws/lifecycle.ts` | `chrome-extension/src/sidepanel/components/PacksPanel.tsx` (**staged**) |
| `companion/src/summoner/protocol.ts` | `chrome-extension/tests/markdown-breaks.test.ts` (**staged**) |
| `companion/src/menu-bar-agent.ts` | Staged `overlay-dogfood-slice-ab-*` reviews + spec still **LOCKED** |
| `companion/src/summoner-web.ts` (**MM**) | Knowledge-honesty Wave 0–2 on HEAD |
| `companion/src/tray/SummonerOverlay.swift` (**unstaged only**) | |
| `companion/src/tray/Tray.swift` (**MM**) | |
| `companion/src/tray/swift-tray-bridge.ts` (**MM**) | |
| `companion/src/message-router.ts` (`knowledge.set_active` / pack overlay gate) | |
| `companion/tests/summoner-workbench-compose.test.ts` (untracked) | |

`git commit` of the **index as it sits** is not this batch. See §4.

---

## 1. Outcome — did B1–B4 actually ship what it claims?

DoD vs **worktree**. REJECT gates R1–R6 checked on the worktree (not the index).

### DoD 1 — Rail 场景 → `summoner.pack.apply`; router overlay-eligible + allowTrust=false

**Holds on Mac HUD `[inspected]`.** Overlay lists packs, dims `overlay_eligible !== true`, emits `summoner.pack.apply` (`SummonerOverlay.swift:555-648`). Menu-bar uses **summoner** client `applyPack` with `user_gesture: true` (`menu-bar-agent.ts:879-888`, `companion-client.ts:314-320`). Router still forces `allowTrust: !overlayApply` and `isOverlayEligiblePack` (`message-router.ts:3004-3038`).

**R5 not triggered.**

### DoD 2 — MCP list/toggle; ＋ 添加 stdin → tray `mcp.add`; overlay WS `mcp.add` denied

**ACL holds `[executed]`.** `assertSummonerAllowed("summoner", "mcp.add")` is false. HTML dispatch allowlist same. Menu-bar `handleSummonerMcpAdd` uses `companionClient.sendAppRequest("mcp.add", …)` not `summonerClient`. Stdio add still hits tray L2 `requireMcpStdioSpawnConfirm` (`handlers/mcp.ts:264-266`). Overlay NSAlert buttons are 「添加」「取消」 — no 确认.

**R1 not triggered** for `mcp.add`.

Nit: HUD toggle also goes **tray** `companionClient` (`menu-bar-agent.ts:899-902`), not summoner WS, even though `mcp.toggle_server` is overlay-allowed. Enabling a disabled stdio server still L2s on tray. Safer than a summoner socket with no confirm chrome. Not a DoD miss.

### DoD 3 — Rail 技能 click activate/deactivate

**Holds on Mac `[inspected]`.** `summoner.skill.toggle` → summoner `skill.activate` / `skill.deactivate` on current thread (`menu-bar-agent.ts:940-964`).

### DoD 4 — Rail 知识 USE; ＋ 导入 NSOpenPanel + NSAlert then tray `knowledge.import`

**Chrome exists. The import payload is wrong for the common file. DoD 4 is not honestly delivered.**

HUD click path `[inspected]`:

1. `NSOpenPanel` then NSAlert 「导入」「取消」 (`SummonerOverlay.swift:697-720`) — HITL on the HUD, not a tray CONFIGURE panel.
2. stdin `summoner.knowledge.import` → `handleSummonerKnowledgeImport` → **tray** `companionClient` `knowledge.import` (`menu-bar-agent.ts:996-1003`). Overlay WS `knowledge.import` ACL-denied `[executed]`.

**Encoding hole `[executed]`:** 📎 already sends **always-base64** (`SummonerOverlay.swift:1025`). Knowledge import sends:

```swift
"content": String(data: data, encoding: .utf8) ?? data.base64EncodedString()
```

Launcher then wraps that string as `file.content`. Router **prefers `file`** and does `Buffer.from(String(content), "base64")` (`message-router.ts:366-372`). Top-level `content` (the raw UTF-8) is ignored.

Node: `"# 标题\n\n这是一篇中文知识笔记 hello"` as base64 → **5 garbage bytes** (`ffe85e965a`). So the primary knowledge case (`.md` / `.txt`) does **not** import the file the user confirmed. PDF/binary luckily take the `?? base64` branch and may work.

No test feeds a UTF-8 `file.content` through `knowledge.import`. Workbench tests only grep that the tray call exists.

**R1 not triggered** (WS still cannot `knowledge.import`). The claim “B4 导入 HITL 已落地” is still a lie about **what gets stored**.

### DoD 5 / R6 — `knowledge.set_active` strips extra keys; ids must exist

**Extra trust keys: holds.** Overlay policy deletes every key except `type` / `thread_id` / `ids` (`summoner-acl.ts:107-123`). Test sends `tool_whitelist: null` and it is gone `[executed]`.

**Unknown ids: not rejected; silently dropped, request still succeeds.** Router:

```
known = Set(listKnowledge().map(d => d.name || d.id))
next = ids.filter(id => known.has(id))
threadManager.update(..., { active_knowledge_ids: next, knowledge_selection_mode: "manual" })
```

Unknown ids are not **written**. The RPC is **accepted** and can **clear** the thread’s knowledge selection (unknown-only payload → `[]` + `manual`). Overlay click path only sends listed ids, so HUD USE is safe. HTML `POST /api/knowledge/active` can send anything.

**R6 not fully triggered** (ids are not persisted; extra keys stripped). Residual: “must exist” is a filter, not a 403. No router test for unknown ids in this batch.

### DoD 6 — no HUD Allow/Deny / `summoner.confirm.*`

**Holds `[executed]`.** Overlay source has zero `允许|拒绝|Allow|Deny|确认`. NSAlert uses 导入 / 添加 / 取消. Protocol still rejects `summoner.confirm.*`.

**R3 not triggered.**

### DoD 7 — pin lockstep

**Worktree holds `[executed]`.**  
`SWIFT_TRAY_SHA256` (`swift-tray-bridge.ts:59`) = `shasum -a 256 companion/dist/cmspark-tray` =  
`ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda`.  
Binary mtime 18:29, overlay source 18:28.

**Index does not hold.** Staged `swift-tray-bridge.ts` is still:

```
/** Slice B 2026-08-25: Darwin menu/hotkey → C-thin HTML (not NSPanel). */
const SWIFT_TRAY_SHA256 = "367b3e29b0f7355c5ee26f6eb64bbc8c1aa368eb003f0acb5b19eb3473b9e862"
```

That is the B0 leftover pin both AWN reviews already named. A naive `git commit` **fails R4** and ships the Slice-B comment this program superseded.

**R4 not triggered on the worktree; triggered on the index.**

Pin comment in worktree still says “B0.5 — overlay rename/trash” (`swift-tray-bridge.ts:57`) — stale vs B1–B4 rails. Cosmetic if the hash is restaged.

### DoD 8 — C-thin HTML can list/toggle; cannot mcp.add / knowledge.import

**Cannot-dispatch half holds `[executed]`.** Allowlist has `pack.apply` / `mcp.toggle_server` / `skill.*` / `knowledge.list` / `knowledge.set_active`. No `mcp.add` / `knowledge.import` / `config.set`. No `/api/knowledge/import` or `/api/mcp/add` route.

**Can-list/toggle half is an over-claim of a user-visible workbench.** HTTP routes exist (`summoner-web.ts:446-503`). The **HTML page** never fetches them. Rail in the page is still **对话 only**. There is no 场景 / 知识 / 技能 / MCP list, no click-toggle, no ＋ 导入. Tests never hit `GET /api/mcp|skills|knowledge` or the new POSTs. The only compose HTTP test is pre-existing `POST /api/packs/apply`.

So: a curl client on loopback **can** toggle. A human opening the C-thin summoner **cannot**. Dual prompt DoD 1–4 describe rails. DoD 8’s “can” is being sold as the HTML sibling of those rails. It is not.

**R1 not triggered** via HTML (no import/add endpoints).

### Tests `[executed]`

Prompted file set: **119 pass / 0 fail** — matches the machine card. That number is **source greps + HTTP contract + overlay-eligible + lockstep**, not a live NSPanel click, not a `knowledge.import` of a markdown file, not an HTML rail. The 119 is true and **does not prove DoD 4 or DoD 8**.

Workbench test `func applyMcpServers|applyMcp\(` matches the **B0 no-op** `applyMcp(_ names:)` (`SummonerOverlay.swift:330-332`). It does not prove MCP rows hydrate.

---

## 2. Trajectory — over-claim, T3 HITL, leftover B0 empty pane

### Spec status line vs tree

Spec header: “状态: B0–B4 已落地（… 知识 USE+导入 HITL）”. Spec §2.5: 导入 = `NSOpenPanel` + **托盘原生确认（CONFIGURE）**.

Dual prompt Trust block **lowered** that to overlay NSAlert 导入/添加/取消 (no 确认) and tray client. Against **this prompt**, overlay NSAlert is the intended HITL. Against **the spec this batch claims to land**, CONFIGURE never appears: `knowledge.import` in the router has **zero** `requestConfirmation`. After Swift emits stdin, the companion writes `~/.cmspark-agent/knowledge/` with no origin-bound confirm.

**T3 hole (the one this lane was told to look for):** overlay **WS** cannot import (R1 dark). Overlay **can** complete a knowledge import **without any companion-side HITL**. The only gate is in-process NSAlert, then tray `knowledge.import` is a raw write. Stdin `summoner.knowledge.import` is sufficient; nothing checks that an NSAlert ran. `mcp.add` is not like this — stdio still L2s on tray. Knowledge is the asymmetric T3 path.

This is **not** “overlay WS smuggles `knowledge.import`”. It is “T3 mutate is stdin→tray with no CONFIGURE, and the file bytes are wrong for UTF-8.” Do not stamp “导入 HITL landed” or “CONFIGURE” in merge text.

### Leftover B0 empty-pane lies

Mac HUD **did** drop 「这一类下一刀开放」 `[executed]` (workbench-compose grep). Empty states are honest (“还没有场景包” / …).

**C-thin HTML is still the B0 empty pane**, now lying relative to this batch’s claim:

- Hint still 「听写/知识配置/批准去侧栏处理」 (`summoner-web.ts:665,753-754`)
- Badge still 「批准在侧栏」 (`:654`)
- `summoner-web.test.ts:121-124` **locks** `/听写\/知识配置\/批准去侧栏处理/` and `/去侧栏处理/`
- Page script never calls `/api/packs|/api/mcp|/api/skills|/api/knowledge`
- SSE still tells the user 「MCP 工具需在 Chrome 侧栏批准」 (`:901-902`)

B0.5 external allowed that copy as honest deferral of B2–B4. **B1–B4 is the slice that was supposed to retire it** (at least for knowledge USE / pack / skill / MCP toggle). Instead the tests **require** the old lie, while DoD 8 claims HTML can list/toggle. That is leftover B0 empty-pane **plus** over-claim, not a leftover that is still true.

Mac overlay tests **forbid** `去侧栏` (`summoner-overlay.test.ts:109-113,192`). HTML tests **require** it. After B1–B4 that split is not “Mac vs Win/Linux scope”; it is two SoTs.

### Other B0 leftovers that should have been folded because they sit on this claim

- `applyMcp(_ names:)` still `{ _ = names }` (`SummonerOverlay.swift:330-332`). `handleSummonerReady` still `pushSummonerMcp()` names-only (`menu-bar-agent.ts:759,743-752`) **and** `pushSummonerRail()` servers. Dead B0 path; workbench test regex treats it as proof of life.
- HTML `POST /api/packs/apply` still live (B0.5 already named). Now it is in-scope as DoD 8, still no pack list UI.
- `hitsFromTitleSearch` Mac vs HTML recency — B0.5 nit; HTML `refresh()` now sorts `updated_at` (`summoner-web.ts:851-856`). Folded. Fine.

### Over-claim in the machine card

- “119 pass” is true for the grep/HTTP set. It is not evidence that import stores the file, or that HTML rails exist.
- “C-thin HTML can list/toggle packs/mcp/skills/knowledge.set_active” is **API-true, UI-false**. Tests do not GET those routes.
- Spec “B0–B4 已落地” + “CONFIGURE” is false.
- Pin `ed4dbfa0…` is worktree-true, **index-false**.

---

## 3. Component — file:line residual risks

| Sev | Where | Risk |
|---|---|---|
| **BLOCK** | `SummonerOverlay.swift:719` vs `message-router.ts:366-372` vs `menu-bar-agent.ts:999-1003` | UTF-8 knowledge files confirmed in NSAlert are stored as base64-garbage. 📎 `:1025` already does the correct always-base64. DoD 4 not met. |
| **BLOCK** | `summoner-web.ts` HTML (`:654-665`, `:753-754`) + `summoner-web.test.ts:121-124` | B0 empty pane + 去侧栏 copy locked while DoD 8 claims compose. User-visible HTML is not B1–B4. |
| **BLOCK** | git **index** `swift-tray-bridge.ts` pin `367b3e29` + Slice B comment; `SummonerOverlay.swift` **not staged** | Naive commit fails R4, ships Chrome Slice A, **omits** the HUD rails. Commit-scope MM. |
| T3 residual | `message-router.ts:2665-2683` `knowledge.import` | No CONFIGURE / `requestConfirmation`. Overlay NSAlert is the only HITL; stdin bypasses it. Spec §2.5 unmet; dual prompt accepted NSAlert. Not R1. |
| NIT | `summoner-acl.ts:107-123` + `message-router.ts:2644-2657` | Unknown `knowledge.set_active` ids filtered, RPC 200, can clear selection. Extra keys stripped. R6 dark. |
| NIT | `SummonerOverlay.swift:330-332` + `menu-bar-agent.ts:743-752` | B0 `applyMcp(names)` no-op still wired. `applyMcpServers` is the real path. Test regex `applyMcp\(` is a green lie. |
| NIT | `swift-tray-bridge.ts:57` (worktree) | Pin comment still “B0.5 rename/trash”. Hash itself matches `[executed]`. |
| NIT | `menu-bar-agent.ts:899-902` | MCP toggle uses tray client, not summoner WS. Behavior OK (L2 on enable). Honesty: overlay ACL for toggle is unused by the HUD. |
| NIT | `summoner-workbench-compose.test.ts` | Grep-only. No live click, no markdown import, no HTML rail render. |
| residual | CDP / Side Panel | Webpage CU still needs the extension. Spec said so. Confirm for MCP **tools** still copy-points at 侧栏 (`summoner-web.ts:901-902`, `client.ts` pack errors 「去侧栏」). |

No component finding that overlay **WS** can `mcp.add` / `knowledge.import` / `config.set`, write `tool_whitelist` via `thread.update`, or grow Allow/Deny chrome.

---

## 4. Commit-scope MM (do not ship this index)

```
MM chrome-extension/.../ChatView.tsx          ← Slice A, not this batch
M  chrome-extension/.../PacksPanel.tsx        ← staged Slice A
A  chrome-extension/tests/markdown-breaks.test.ts
MM companion/src/summoner-web.ts              ← index = tiny C-thin leftover; WT = +134 B1–B4 routes, still no UI
MM companion/src/tray/Tray.swift
MM companion/src/tray/swift-tray-bridge.ts    ← index pin 367b3e29 Slice B HTML; WT pin ed4dbfa0
 M companion/src/tray/SummonerOverlay.swift   ← B1–B4 rails UNSTAGED
?? companion/tests/summoner-workbench-compose.test.ts
AM docs/superpowers/specs/2026-08-25-overlay-dogfood-slice-ab-design.md  ← still LOCKED
```

B0.5 external already called the MM index a commit hazard, not a functional blocker. **This batch made it a functional blocker:** the HUD compose file is unstaged; the staged pin is the rejected Slice-B hash. Approving “the tree” without a restage is approving the wrong artifact.

---

## Verdict rationale

R1–R6 stay **dark on the worktree**: overlay WS cannot add MCP / import knowledge / `config.set`; `thread.update` still alias-only; no Allow/Deny chrome; worktree pin matches binary; `pack.apply` still overlay-eligible + `allowTrust=false`; extra `knowledge.set_active` keys stripped.

That is not enough to approve **this claim**.

What is **not** true, and must not ride merge text:

1. **DoD 4** — “导入 HITL landed” while UTF-8 `.md`/`.txt` is stored as 5 bytes of base64 junk. 📎 already knew to always-base64; import did not copy it. `[executed]`
2. **DoD 8** — “C-thin HTML can list/toggle” as a workbench. The page is still the B0 empty pane; tests **lock** 「知识配置/批准去侧栏处理」. APIs without UI are not the Mac rails’ sibling.
3. **Spec §2.5 CONFIGURE** — overlay NSAlert then silent tray `knowledge.import`. T3 hole = companion-side import **without HITL** once stdin is in. Dual prompt accepted NSAlert, so this is spec-honesty, not R1. Still do not stamp CONFIGURE.
4. **Commit-scope** — index pin `367b3e29` ≠ binary; overlay rails not staged; Chrome Slice A is staged. Naive commit fails R4 and ships the wrong product.

Fix the UTF-8/`file.content` encoding (mirror 📎), restage **only** overlay compose files with pin `ed4dbfa0`, and either ship HTML rails **or** stop claiming DoD 8 / retire the locked 去侧栏 tests if HTML is Mac-deferred. Then re-review.

Until then this is not B1–B4 landed. It is Mac rails + a broken import + a B0 HTML lie + a poisoned index.

VERDICT: REJECT
