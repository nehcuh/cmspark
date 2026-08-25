# Adversary review R2 (External / spec-honesty) — Overlay HUD Expand B1–B4

**Batch**: `overlay-hud-expand-b1b4` (incremental after r1 REJECT)  
**Role**: independent spec-honesty skeptic (did **not** implement; no production edits)  
**Spec**: `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md`  
**Prompt**: `docs/audit/reviews/overlay-hud-expand-b1b4-dual-review-prompt-20260825.md`  
**Prior REJECT**: `docs/audit/reviews/overlay-hud-expand-b1b4-adversary-external-20260825.md`  
**HEAD**: `2dee37a` (`docs(memory): S80 session-end — knowledge honesty Wave 0–2 local ship`) — B1–B4 still lives in the **working tree**, not HEAD  
**Claimed folds**: (1) `knowledge.import` uses top-level `content` UTF-8, not `file.content` base64; (2) C-thin HTML has compose tabs + API fetches  
**Evidence**: `[executed]` 127 tsx tests + pin shasum + UTF-8 vs base64 probe + index/worktree pin/HTML grep + binary needles; `[inspected]` ACL / router / Swift / HTML / launcher

This re-attack is **only** whether r1’s two named functional BLOCKs closed, and whether anything else from r1 still falsifies “B1–B4 landed”. Do not re-litigate R1–R6 except where a fold would reopen them.

Looked specifically for: **folded encoding still wrong**, **HTML rails still a curl-only lie**, **leftover B0 empty-pane + 去侧栏 lock**, **commit-scope MM / R4 on the index**.

---

## Review scope (do not merge the rest)

Same mixed overlay as r1. Do **not** require this review to bless Chrome Slice A, dogfood Slice B, or knowledge-honesty Wave 0–2.

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

`git commit` of the **index as it sits** is still not this batch. See §4. That was r1 BLOCK 3. It was **not** in the fold list. It is still open.

---

## MACHINE

Commands (cwd `companion/` unless noted) `[executed]`:

```text
./node_modules/.bin/tsc --noEmit                    # exit 0
./node_modules/.bin/tsx --test \
  tests/summoner-workbench-compose.test.ts \
  tests/summoner-acl.test.ts \
  tests/summoner-protocol.test.ts \
  tests/summoner-web.test.ts \
  tests/summoner-thread-manage.test.ts \
  tests/summoner-overlay.test.ts \
  tests/overlay-eligible.test.ts \
  tests/swift-tray-integrity.test.ts \
  tests/ws-router-validator-lockstep.test.ts
                                                    # 127 pass / 0 fail
shasum -a 256 dist/cmspark-tray
  == SWIFT_TRAY_SHA256 (worktree swift-tray-bridge.ts:59)
  == ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda
git show :companion/src/tray/swift-tray-bridge.ts
  == 367b3e29b0f7355c5ee26f6eb64bbc8c1aa368eb003f0acb5b19eb3473b9e862  (Slice B comment)
```

Throwaway encoding probe (not in the suite): Node `Buffer.from("# 标题\n\n这是一篇中文知识笔记 hello", "base64")` → **5 bytes** `ffe85e965a` — same garbage r1 named. NEW payload `{ content: utf8 }` is the original string. Binary Swift `?? base64` under NEW path stores the base64 **text**, not parsed bytes.

| Check | Result |
|---|---|
| Fold 1 — tray `knowledge.import` is `{ content, title }`, not `file: { content }` | **CLOSED on worktree** `[executed]` |
| Fold 2 — HTML `data-sec` tabs + `loadCompose` fetches `/api/packs|mcp|skills|knowledge` | **CLOSED on worktree** `[executed]` |
| Fold 1/2 on **index** | **OPEN** — HEAD/index has no `handleSummonerKnowledgeImport`; index HTML has **0** `data-sec="packs"` / `loadCompose` |
| R1 overlay WS `mcp.add` / `knowledge.import` / `config.set` | still **denied** `[executed]` |
| R4 pin ≠ binary | **dark on worktree**; **fires on index** `[executed]` |
| Slice tests | **127 pass / 0 fail** `[executed]` |

The 127 is the same grep/HTTP/lockstep set as r1’s 119 plus thread-manage. It still does **not** import a markdown file through `knowledge.import`, and still does **not** GET `/api/mcp|skills|knowledge` over HTTP.

---

## 0. Fold verification (the two named BLOCKs)

### Fold 1 — `knowledge.import` uses `content` UTF-8, not `file.content` base64

**Closed on the worktree.** `[executed]` `[inspected]`

r1 BLOCK: launcher wrapped overlay UTF-8 as `file.content`; router prefers `file` and `Buffer.from(String(content), "base64")` (`message-router.ts:366-372`). Markdown confirmed in NSAlert stored as 5 garbage bytes.

Worktree launcher (`menu-bar-agent.ts:996-1004`):

```996:1004:companion/src/menu-bar-agent.ts
async function handleSummonerKnowledgeImport(name: string, mime: string, content: string): Promise<void> {
  if (!companionClient || !name || !content) return
  try {
    // Overlay sends UTF-8 text (not base64). Router `file.content` is base64 —
    // pass `content` so markdown is imported as written.
    const resp = await companionClient.sendAppRequest("knowledge.import", {
      content,
      title: name.replace(/\.[^.]+$/, "") || name,
    })
```

Router still prefers `file` then `url` then raw `rest.content` as **text** (`message-router.ts:366-415`). With no `file` key, UTF-8 `.md`/`.txt` takes the text branch. Overlay WS `knowledge.import` still ACL-denied `[executed]`. Workbench test now greps `content,` and `doesNotMatch /file:\s*\{/` (`summoner-workbench-compose.test.ts:124-126`).

Swift is unchanged (`SummonerOverlay.swift:719`): `String(data:encoding:.utf8) ?? data.base64EncodedString()`. That is now the **correct** encoding for the text branch. 📎 `:1025` remains always-base64 for **file upload**, not knowledge import — different router field; not a remaining DoD 4 miss.

**Fold-introduced residual (not the r1 BLOCK):** if UTF-8 decode fails, Swift still sends base64 **as `content`**. Router then stores that base64 string as knowledge **text** (no `parseFile`). PDF/binary that r1 said “may work” via `file`+`parseFile` now will not. Primary case (`.md`/`.txt`) is the one r1 rejected on. Do not re-open DoD 4 for that. Do not claim “any NSOpenPanel file imports as the file.”

HEAD/index: `handleSummonerKnowledgeImport` **does not exist**. Naive commit **drops this fold**.

### Fold 2 — C-thin HTML compose tabs + API fetches

**Closed on the worktree as DoD 8’s “can list/toggle”.** `[executed]` `[inspected]`

r1 BLOCK: HTTP routes existed; the **page** never fetched them; rail was 对话-only; tests locked 「去侧栏」 while DoD 8 claimed a workbench.

Worktree HTML (`summoner-web.ts:657-664`, `:868-943`):

- Tabs: 对话 / 场景 / 知识 / 技能 / MCP (`data-sec`)
- `showSec` → `loadCompose`
- `GET /api/packs` + `POST /api/packs/apply`
- `GET /api/mcp` + `POST /api/mcp/toggle`
- `GET /api/skills` + `POST /api/skills/toggle`
- `GET /api/knowledge` + `POST /api/knowledge/active`

Allowlist still has overlay-safe writes and **not** `mcp.add` / `knowledge.import` / `config.set` (`summoner-web.ts:19-42`). No `/api/mcp/add` or `/api/knowledge/import` route `[inspected]`. `POST /api/config` still 404 `[executed]`. DoD 8 cannot-dispatch half still holds.

Workbench test now greps `data-sec="packs"` and `/api/packs|/api/mcp|/api/skills|/api/knowledge` (`summoner-workbench-compose.test.ts:161-165`). **No HTTP test** GETs those compose routes (r1 already named `POST /api/packs/apply` as the only compose HTTP test). Grep-true, live-click-unproven. Enough to retire “page never fetches / rail is 对话 only.”

Index HTML: **0** `data-sec="packs"`, **0** `loadCompose`, 800 lines vs worktree 1016. Index **does** have `GET /api/packs` and `GET /api/mcp` (reads) but not mcp toggle / skills / knowledge active. A human opening the **committed** C-thin page still cannot list/toggle B2–B4.

---

## 1. Outcome — DoD vs worktree after the folds

R1–R6 checked on the **worktree** (not the index), same as r1.

### DoD 1 — Rail 场景 → `summoner.pack.apply`; overlay-eligible + allowTrust=false

**Holds on Mac HUD `[inspected]`.** Unchanged from r1. Router still forces `allowTrust: !overlayApply` and `isOverlayEligiblePack` (`message-router.ts:3004-3038`). **R5 not triggered.**

### DoD 2 — MCP list/toggle; ＋ 添加 stdin → tray `mcp.add`; overlay WS denied

**ACL holds `[executed]`.** Unchanged. Overlay NSAlert 「添加」「取消」 — no 确认. Stdio add still tray L2. **R1 not triggered** for `mcp.add`.

### DoD 3 — Rail 技能 click activate/deactivate

**Holds on Mac `[inspected]`.** C-thin sibling is weaker: page always POSTs `on:true` (`summoner-web.ts:923`) so HTML “toggle” is **activate-only**. API can deactivate (`on !== false` → activate; `:476`). DoD 3 is Mac. DoD 8 “toggle skills” is a half-truth on HTML. Nit, not a re-opened BLOCK.

### DoD 4 — Rail 知识 USE; ＋ 导入 NSOpenPanel + NSAlert then tray `knowledge.import`

**Holds on worktree for the r1 encoding hole.** Gesture + ACL unchanged. UTF-8 markdown now rides `content` as text. Overlay WS still denied `[executed]`.

Still **not** spec §2.5 CONFIGURE (see §2). Dual prompt accepted overlay NSAlert; r1 already said this is not R1. Do not stamp CONFIGURE.

### DoD 5 / R6 — `knowledge.set_active` strips extra keys; ids must exist

**Extra trust keys: holds `[executed]`.** Unknown ids: still filtered, RPC 200, can clear (`message-router.ts:2644-2657`). HTML `POST /api/knowledge/active` can send anything, including `ids:[id]` which **replaces** the whole selection (Mac HUD toggles). **R6 not fully triggered** (ids not persisted; extra keys stripped). Same residual as r1.

### DoD 6 — no HUD Allow/Deny / `summoner.confirm.*`

**Holds `[executed]`.** Overlay source zero `允许|拒绝|Allow|Deny|确认`. Protocol still rejects `summoner.confirm.*`. Binary has `summoner.pack.apply` / `.mcp.toggle` / `.mcp.add` / `.skill.toggle` / `.knowledge.attach` / `.knowledge.import` ×1 each; `summoner.confirm` ×0. **R3 not triggered.**

### DoD 7 — pin lockstep

**Worktree holds `[executed]`.**  
`SWIFT_TRAY_SHA256` = `shasum -a 256 companion/dist/cmspark-tray` =  
`ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda`.  
Binary mtime 18:29, overlay source 18:28 (same lockstep as r1; encoding fold is TS launcher, no Swift rebuild required).

**Index does not hold.** Staged pin is still `367b3e29…` + “Slice B 2026-08-25: Darwin menu/hotkey → C-thin HTML (not NSPanel).” Naive `git commit` **fails R4** and ships the Slice-B comment this program superseded.

**R4 not triggered on the worktree; triggered on the index.** Unchanged from r1.

Pin comment in worktree still “B0.5 — overlay rename/trash” (`swift-tray-bridge.ts:57`) — stale vs B1–B4. Cosmetic if the hash is restaged.

### DoD 8 — C-thin HTML can list/toggle; cannot mcp.add / knowledge.import

**Cannot-dispatch half holds `[executed]`.**

**Can-list/toggle half now holds as a user-visible page on the worktree** (tabs + fetches). That was the r1 lie. It is folded.

Honesty remaining (not the empty-pane BLOCK):

1. **去侧栏 copy is still locked.** Hint 「听写/知识配置/批准去侧栏处理」 (`summoner-web.ts:673,761-762`); badge 「批准在侧栏」 (`:654`); SSE fallback 「MCP 工具需在 Chrome 侧栏批准」 (`:991-992`); `summoner-web.test.ts:121-124` still `assert.match` `/听写\/知识配置\/批准去侧栏处理/` and `/去侧栏处理/`. Mac overlay tests still **forbid** `去侧栏`. After B1–B4 compose exists, 「知识配置去侧栏」 is overstated (USE is in the page; import is correctly **not** in HTML). 听写 / MCP **tool** 批准 still leave this surface. Two SoTs remain. r1 bundled this **with** the empty pane. Empty pane is gone → demote to leftover copy, not DoD 8 fail.
2. Skills HTML is activate-only (`on:true`).
3. Knowledge HTML `ids:[id]` replaces the selection; Mac toggles.
4. Tests never GET the new compose routes.

Spec §3 “Win/Linux HTML 本文件不改成 HUD；先 Mac.” still true visually (titled dark 220px + 发送). Dual DoD 8 did not require 看山 HUD on C-thin. Do not re-REJECT DoD 8 on the visual world.

---

## 2. Trajectory — what r1 said must not ride merge text

### 1. DoD 4 encoding — **folded on worktree**

r1: “导入 HITL landed” while UTF-8 is 5 bytes of junk. That sentence is **no longer true** of the worktree launcher + router `content` branch. `[executed]`

Still do not stamp CONFIGURE. Spec §2.5 托盘原生确认 (CONFIGURE) is still overlay NSAlert then silent tray `knowledge.import` (`message-router.ts:2665-2683`, zero `requestConfirmation`). Stdin `summoner.knowledge.import` does not prove an NSAlert ran. Dual prompt accepted NSAlert → not R1. Same T3 residual as r1.

### 2. DoD 8 empty pane — **folded on worktree**

r1: page never fetches; rail 对话 only. Worktree page has five tabs and fetches. The B0 empty-pane **lie** is gone. Leftover 去侧栏 copy is a different, weaker honesty miss (see DoD 8).

### 3. Spec “B0–B4 已落地” + CONFIGURE — **still over-claim**

Unchanged. Dual prompt DoD does not require CONFIGURE. Merge text must not say CONFIGURE landed.

### 4. Commit-scope — **not folded**

r1 required: restage **only** overlay compose files with pin `ed4dbfa0`. That did not happen. HUD rails, encoding fold, HTML tabs, ACL, workbench tests are **unstaged or untracked**. Index pin is Slice-B `367b3e29`. Chrome Slice A is staged.

r1: “Approving the tree without a restage is approving the wrong artifact.” Still true. This is why R2 cannot flip while R1–R6 stay dark on the worktree.

---

## 3. Component — file:line residual risks

| Sev | Where | Risk |
|---|---|---|
| **CLOSED** | `menu-bar-agent.ts:996-1004` vs `message-router.ts:412-414` | r1 UTF-8 `file.content` garbage. Worktree passes `content` as text. |
| **CLOSED** | `summoner-web.ts:657-664,868-943` | r1 empty pane. Worktree has tabs + fetches. |
| **BLOCK** | git **index** `swift-tray-bridge.ts` pin `367b3e29` + Slice B comment; `SummonerOverlay.swift` **unstaged**; `menu-bar-agent.ts` encoding **unstaged**; HTML tabs **unstaged** | Naive commit fails R4, ships Chrome Slice A, **omits** HUD rails + both folds. Same r1 BLOCK 3. |
| T3 residual | `message-router.ts:2665-2683` `knowledge.import` | No CONFIGURE. Overlay NSAlert is the only HITL; stdin bypasses it. Dual prompt accepted NSAlert. Not R1. |
| residual (fold 1) | `SummonerOverlay.swift:719` + new `content` path | Non-UTF-8 files store base64 **as text**. PDF no longer gets `parseFile`. |
| NIT | `summoner-web.ts:673,761-762,654,991-992` + `summoner-web.test.ts:121-124` | 去侧栏 copy still locked after compose exists. 「知识配置去侧栏」 overstates USE. Two SoTs vs overlay tests. Demoted from r1 BLOCK. |
| NIT | `summoner-web.ts:923` | HTML skills always `on:true` — activate, not toggle. |
| NIT | `summoner-web.ts:938` + `message-router.ts:2644-2657` | HTML USE replaces `ids` with one id; unknown ids filtered, RPC 200, can clear. Extra keys stripped. R6 dark. |
| NIT | `SummonerOverlay.swift:330-332` + `menu-bar-agent.ts:743-752` | B0 `applyMcp(names)` no-op still wired. Test regex `applyMcp\(` still a green lie. |
| NIT | `swift-tray-bridge.ts:57` (worktree) | Pin comment still “B0.5 rename/trash”. Hash matches `[executed]`. |
| NIT | `menu-bar-agent.ts:899-902` | MCP toggle uses tray client, not summoner WS. Safer (L2 on enable). Overlay ACL for toggle unused by HUD. |
| NIT | `summoner-workbench-compose.test.ts` | Grep-only. Encoding fold is a source grep, not a markdown import. HTML rails are a source grep, not GET `/api/knowledge`. |
| residual | CDP / Side Panel | Webpage CU still needs the extension. MCP **tool** confirm copy still 侧栏 (`summoner-web.ts:991-992`, `client.ts:331-332` 「去侧栏」). |

No component finding that overlay **WS** can `mcp.add` / `knowledge.import` / `config.set`, write `tool_whitelist` via `thread.update`, or grow Allow/Deny chrome.

---

## 4. Commit-scope MM (do not ship this index)

```
MM chrome-extension/.../ChatView.tsx          ← Slice A, not this batch
M  chrome-extension/.../PacksPanel.tsx        ← staged Slice A
A  chrome-extension/tests/markdown-breaks.test.ts
MM companion/src/summoner-web.ts              ← index 800 lines, no tabs; WT 1016 + loadCompose
MM companion/src/tray/Tray.swift
MM companion/src/tray/swift-tray-bridge.ts    ← index pin 367b3e29 Slice B HTML; WT pin ed4dbfa0
 M companion/src/tray/SummonerOverlay.swift   ← B1–B4 rails UNSTAGED
 M companion/src/menu-bar-agent.ts            ← encoding fold UNSTAGED (absent on HEAD)
 M companion/src/ws/summoner-acl.ts
?? companion/tests/summoner-workbench-compose.test.ts
AM docs/superpowers/specs/2026-08-25-overlay-dogfood-slice-ab-design.md  ← still LOCKED
```

B0.5 external called the MM index a commit hazard, not a functional blocker. r1 upgraded it because HUD compose was unstaged and the staged pin was Slice-B. **That upgrade still applies.** The two functional folds live only in the worktree. Approving “the tree” without a restage is still approving the wrong artifact.

---

## Verdict rationale

R1–R6 stay **dark on the worktree**. The two named r1 functional BLOCKs are **closed on the worktree**:

1. **DoD 4 encoding** — tray `knowledge.import` `{ content, title }`; UTF-8 markdown is no longer base64-garbage. `[executed]`
2. **DoD 8 empty pane** — C-thin has compose tabs and fetches list/toggle APIs; cannot dispatch add/import. `[executed]`

That is **not** enough to approve **this claim**, because r1’s third BLOCK was not folded:

- **Commit-scope** — index pin `367b3e29` ≠ binary; overlay rails, encoding fold, and HTML tabs are unstaged; Chrome Slice A is staged. Naive commit fails R4 and ships a product that has **neither fold**.

What must still not ride merge text:

- Spec §2.5 **CONFIGURE** (overlay NSAlert + silent tray write). Dual prompt accepted NSAlert; still do not stamp CONFIGURE.
- “C-thin is no longer 去侧栏” — copy + tests still lock it; 听写 / MCP tool 批准 still leave. DoD 8 list/toggle is the folded part.
- “Any file NSOpenPanel imports as the file” — non-UTF-8 now stores base64 text.

Restage **only** overlay compose files (`summoner-acl`, `lifecycle`, `protocol`, `menu-bar-agent`, `summoner-web`, `SummonerOverlay.swift`, `Tray.swift`, `swift-tray-bridge` pin `ed4dbfa0`, `message-router` knowledge/pack overlay, validate, compose tests). Leave Chrome Slice A and dogfood Slice B out. Then this lane can flip without re-opening DoD 4/8.

Until the index matches the worktree that actually has B1–B4, this is still not a shippable B1–B4 commit. It is Mac rails + a **fixed** UTF-8 import + HTML compose tabs **in the worktree**, plus the same poisoned index r1 refused to bless.

VERDICT: REJECT
