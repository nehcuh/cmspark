# overlay-post222-residual — Security / Trust adversary

**Lane:** independent Security/Trust (no production edits; did not read other `overlay-post222-residual-adversary-*` reports)  
**HEAD:** `a58b78fd444bcd5eb49698b1d802d4fc959d963a` (`a58b78f` Merge fix/windows-tray-nodepath into main) = `origin/main`  
**Range:** `ac0a3be..HEAD` (`6ce291d` #222 → `03de168` P1 fold ∥ `c8d0984`+`dfab3eb` Windows tray/C-thin scroll → merge)  
**Blast claimed:** T2 residual UX + T3 stdin import/add. Overlay ACL overlay-safe; `mcp.add` / `knowledge.import` off summoner WS.  
**Evidence tags:** `[executed]` ran tests/shasum; `[inspected]` read live path; `[assumed]` not used for I/R verdicts.

刻意边界遵守：不把「MCP 工具执行走 Side Panel」判 BLOCK；HUD 不做 Allow/Deny；不要求 `knowledge.import` 上 overlay WS。

---

## Outcome

**不触发 R1–R4 / R6。** Overlay WS 不能 `mcp.add` / `knowledge.import` / `config.set`；`thread.update` overlay 只能写 `alias`；HUD 无 Allow/Deny / `summoner.confirm.*`；`SWIFT_TRAY_SHA256` 与 `companion/dist/cmspark-tray` 一致。`03de168` 的 F-I-5 / PEM through END / F-S-1 wrap **在知识路径上仍闭合**。

**I1 / I2 在 live HEAD 未折。** `03de168` 曾把 C-thin 改成 `on:!on` / `ids:next` 并加锁测，但 `a58b78f` 与 `dfab3eb`（基于 #222 暗色 HTML、不含该 fold）合并后 **生产 HTML 回到 `on:true` / `ids:[id]`，锁测留在 03de168 侧**。`[executed]` `summoner-web.test.ts` **2 fail / 172 pass**。本评审将 I1/I2 标 **OPEN**，不把失败锁测当成 CLOSED 盖章（R5 防伪标）。

其余 OPEN 均为 T2 UX 或 stdin 导入完整性（I3/I5/I6），不抬升 overlay ACL。

| ID | 合入时声称 | HEAD | 本评审 |
|----|------------|------|--------|
| I1 | C-thin 技能 `on:true` 只开不关 | `summoner-web.ts:924` 仍 `on:true` | **OPEN** |
| I2 | C-thin 知识 `ids:[id]` 整表替换 | `summoner-web.ts:939` 仍 `ids:[id]` | **OPEN** |
| I3 | Swift 非 UTF-8 → `base64EncodedString()` 当正文 | `SummonerOverlay.swift:719` | **OPEN** |
| I4 | C-thin 开已禁用 stdio MCP → overlay L2 约 45s | `menu-bar-agent.ts:1628-1630` 改骑 tray client | **CLOSED** |
| I5 | Mac `prefix(12)` / `slice(0,8)` 无独立滚动 | 列表仍 cap；listCol 无 `NSScrollView` | **OPEN** |
| I6 | `knowledge.set_active` 未知 id 静默丢掉、无单测 | `message-router.ts:2623-2629`；无 unknown-id 测 | **OPEN** |
| I7 | `dfab3eb` C-thin flexbox 可滚、header/composer 不挤 | 暗色 HTML 现为标准 flex 滚动骨架 | **CLOSED** `[inspected]` |
| I8 | `03de168` F-I-5 / PEM END / F-S-1 | 锁测全绿 | **CLOSED** `[executed]` |

| Gate | Result |
|------|--------|
| R1 overlay WS `mcp.add` / `knowledge.import` / `config.set` | **HOLD** |
| R2 overlay `thread.update` → `tool_whitelist` | **HOLD** |
| R3 HUD Allow/Deny / `summoner.confirm.*` | **HOLD** |
| R4 `SWIFT_TRAY_SHA256` ≠ binary | **HOLD** (`ed4dbfa0…5fda` 双方一致) |
| R5 声称已折却标 CLOSED | **HOLD**（本评审 I1/I2 标 OPEN；见 merge 伪闭合 nit） |
| R6 新 fold 破坏 overlay-safe ACL | **HOLD** |

---

## Trajectory

```
*   a58b78f Merge fix/windows-tray-nodepath into main   ← live HEAD
|\
| * dfab3eb  C-thin flexbox scroll (dark HTML, on:true / ids:[id])
| * c8d0984  Windows NODE_PATH
* | 03de168  P1 F-I-5/PEM/F-S-1 + C-thin paper HUD + on:!on / ids:next + 锁测
|/
* 6ce291d  #222 workbench compose
```

`git show 03de168:companion/src/summoner-web.ts` **有** `on:!on`（~1057）与 `ids:next`（~1075）以及 `--paper:#fff` / `.rail-btn`。  
`git show dfab3eb:companion/src/summoner-web.ts` **没有**（与 #222 暗色壳相同）。  
`git log -- companion/src/summoner-web.ts` 在 merge 后只留 `dfab3eb` 与 `6ce291d`——**03de168 对 HTML 的 fold 未进入 blob**。  
同 commit 加进 `summoner-web.test.ts` 的断言仍在 HEAD。这是测试/生产分裂，不是「未声称」。

知识 P1 文件（`skill-engine.ts` / `distill.ts` / `content-sanitizer.ts`）只在 `03de168` 侧改，merge 保留 → I8 仍闭合。

---

## Component

### I1 OPEN — C-thin 技能只激活

`companion/src/summoner-web.ts:924` `[inspected]`:

```text
JSON.stringify({thread_id:threadId,skill_name:s.name,on:true})
```

服务端 `body.on !== false` → 永远 `skill.activate`（`:476-483`）。Mac HUD 已是 `on: !on`（`SummonerOverlay.swift:688`）——缺陷仅 C-thin。

`[executed]` 锁测 `C-thin HTML skills toggle…` **fail**：`expected /skill_name:s\.name,on:!on/`。**不得标 CLOSED。**

Trust：不能把技能从当前 thread 卸下。非 ACL 突破。T2.

### I2 OPEN — C-thin 知识整表替换、不能卸

`summoner-web.ts:939` `[inspected]`: `ids:[id]`。Router `knowledge.set_active` 把 `ids` 写成线程的完整 `active_knowledge_ids`（`:2625-2628`）。一点即丢弃其余挂载。Mac HUD `handleSummonerKnowledgeAttach` 做 toggle（`menu-bar-agent.ts:440,979`）。

同一失败测还断言 `/ids:next/` 且 `doesNotMatch /ids:\[id\]/`。**OPEN。** T2.

### I3 OPEN — 非 UTF-8 知识导入把 base64 当 markdown

`SummonerOverlay.swift:715-720` `[inspected]`:

```swift
"content": String(data: data, encoding: .utf8) ?? data.base64EncodedString()
```

`handleSummonerKnowledgeImport`（`menu-bar-agent.ts:462-465`）把该字符串作为 `knowledge.import` 的 **`content` 文本** 送 **tray** `companionClient`，不走 `file.content` base64 → `parseFile`。PDF/二进制 → 知识库一篇 base64 正文，再被 F-S-1 wrap 进模型。`mime` 解码后丢弃。

T3 stdin 路径完整性，不是 overlay WS 绕过（R1 HOLD）。建议：非 UTF-8 拒绝，或按 `file: {name, content: base64}` 走 parser。

### I4 CLOSED — C-thin stdio toggle 不再在 overlay WS 上等 L2

`[inspected]` `dispatchSummonerWeb` `menu-bar-agent.ts:1628-1630`：`mcp.toggle_server` 且 `companionClient` 存在则 `companionClient.sendAppRequest(..., 60_000)`。同文件 `:1831-1848` tray `onAppMessage` → `showConfirmDialog` → `security.confirmation.response`。Swift HUD toggle 同样走 `companionClient`（`:893-896`）。

`[executed]` `HTML mcp.toggle rides tray companionClient` **pass**。C-thin SSE 对 `mcp.confirm.pending` 只写「需在 Chrome 侧栏批准」（`:992-994`），无 Allow/Deny。

残差（不升 I4）：`companionClient` 空时回落 overlay `sendAppRequest` 8s；overlay ACL **允许** `mcp.toggle_server`，手工打 summoner WS 仍可能把 L2 发到不能点的 socket。C-thin 点击路径已折。

### I5 OPEN — Mac 列表硬 cap、无独立滚动

`[inspected]`:

- 推送：`menu-bar-agent.ts:791` `hitsFromTitleSearch(threads).slice(0, 8)`（对话最多 8）。
- 渲染：`SummonerOverlay.swift:369,562,577,595,615` 各表 `prefix(12)`。
- 工作台 `listCol` 是裸 `NSStackView`（`:1727-1746`）。唯一 `hasVerticalScroller = true` 的是 transcript `logScroll`（`:1669`）；composer scroll 关竖条（`:1534`）。12 行 44pt 按钮在 428pt 工作台里会裁切且无法滚到 cap 之外。

C-thin `.rail{overflow:auto}` 比 Mac 好。T2.

### I6 OPEN — 未知 id 静默过滤

`message-router.ts:2620-2629`：未知 id `filter` 掉，返回 `knowledge.active` + `ids: next`，无 error。overlay policy 测只锁 `thread_id` + 非 string 剥离（`summoner-workbench-compose.test.ts`），**没有** unknown-id 单测。`grep` tests 无匹配。

Trust：C-thin `ids:[id]` 打错 id 时 UI 仍「已挂到当前对话」，线程知识集合被写成 `[]` 或去掉未知项。建议 400 + 测。T2.

### I7 CLOSED `[inspected]` — 暗色 C-thin flex 滚动骨架

Live CSS `summoner-web.ts:621-641`：`html,body` `height:100%; overflow:hidden`；`header`/`composer` `flex-shrink:0`；`.shell`/`.main` `flex:1; min-height:0; overflow:hidden`；`.log` `flex:1; overflow:auto; min-height:0`；`.rail` `overflow:auto`。窗口 `--window-size=800,720`（`shell-open.ts:55`，`dfab3eb`）。

未做像素级浏览器拖拽。`03de168` 的 paper HUD / `placeWindow(false)` / `#settings` **未进 HEAD**（见下失败测）——那是 Win 视觉 fold 丢失，不是 dfab3eb 声称的 flex 公式失败。

### I8 CLOSED `[executed]` — F-I-5 / PEM / F-S-1

- F-I-5：`skill-engine.ts:1401-1410` 注释禁止 `taken.delete`；`rg taken.delete` **0 hits** under `companion/src`。测 `importKnowledge: ASCII same heading does not silently overwrite (F-I-5)` **pass**（`notes.md` + `notes-2.md`）。
- PEM：`distill.ts:6-8,30-31` `[\s\S]*?` 到 END 或 `$`，先于 token。测 4200-char RSA + DSA **pass**，marker 不泄漏。
- F-S-1：`content-sanitizer.ts:119-128` 标题在 wrap 外；body 剥 `</?untrusted`；suffix = sha256(`knowledge:${id}`)[:12]。测 `buildSystemPromptWithSources wraps knowledge as untrusted data (F-S-1)` **pass**（唯一 closer）。

### R1 HOLD — overlay WS 不能 import/add/config.set

`[inspected]` `SUMMONER_ALLOW`（`summoner-acl.ts:14-45`）无 `mcp.add` / `knowledge.import` / `config.set`。C-thin `SUMMONER_WEB_DISPATCH_ALLOW` 同样无。Router `knowledge.import` / `import_directory` 二次拒绝 `stampedSurface === "summoner"`（`message-router.ts:2638-2639,2661-2662`）。lifecycle 先 `assertSummonerAllowed` 再 `applySummonerPayloadPolicy`（`lifecycle.ts:1038-1051`）。

`[executed]` `summoner denies trust elevation`、`T3 mutates stay off WS`、`C-thin HTML compose endpoints stay off mcp.add/knowledge.import` **pass**。

Stdin `summoner.mcp.add` / `summoner.knowledge.import` → **tray** `companionClient`（`menu-bar-agent.ts:915-916,462`），L2 走 tray 窗。符合「不要要求 knowledge.import 上 overlay WS」。

### R2 HOLD — overlay `thread.update` 不能写 `tool_whitelist`

`applySummonerPayloadPolicy` 把 overlay updates 收成 `{ alias }`（`summoner-acl.ts:87-105`）。C-thin PATCH 只派 `{ alias }`（`summoner-web.ts:1073`）。`[executed]` `overlay thread.update keeps only alias and rejects empty / dangerous keys-only` **pass**。

### R3 HOLD — HUD 无 Allow/Deny 方言

`[executed]` `SummonerController has zero Allow/Deny/确认 chrome`、`any summoner.confirm.* payload is invalid`、`encoded messages never carry Allow/Deny` **pass**。Tray `showConfirmDialog` 是 L2，不在 overlay。C-thin badge「批准在侧栏」。

### R4 HOLD — tray 哈希

`[executed]`

```
const SWIFT_TRAY_SHA256 = "ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda"
shasum -a 256 companion/dist/cmspark-tray
ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda
```

二进制存在且匹配。`swift-tray-integrity` 套件 **pass**。

### R5 HOLD（评审未伪标）— 仓库有伪闭合测

本评审 I1/I2 **OPEN**，故不触发「标 CLOSED」。但 HEAD 锁测仍声称已折：

| 测 | `[executed]` |
|----|----------------|
| `GET / with token → 200 HTML workbench` | **FAIL** `expected /--paper:#fff/`（03de168 Win HUD） |
| `C-thin HTML skills toggle and knowledge attach are not activate-only / replace-all` | **FAIL** `expected /skill_name:s\.name,on:!on/` |

其余本批 172 pass。**不得用这两条绿来证明 I1/I2/Win HUD。** 修 HTML 或删断言，二选一；保持红测上船是过程缺陷，不是 ACL 洞。

### R6 HOLD — overlay-safe ACL 未被 fold/merge 放宽

`03de168` 的 `knowledge.set_active` payload 收敛（只留 `thread_id`+string `ids`，剥 `tool_whitelist`）在 HEAD。`pack.apply` 仍剥 `allowTrust` / `workspace_path` / `force_takeover` / `confirmation_phrase`。`thread.delete` overlay 必须 `mode=trash`。`[executed]` ACL / thread-manage / workbench-compose **pass**。dfab3eb 未改 `summoner-acl.ts`。

---

## Tests / shasum `[executed]`

```
cd companion && tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/summoner-web.test.js \
  .test-dist/tests/summoner-acl.test.js \
  .test-dist/tests/summoner-workbench-compose.test.js \
  .test-dist/tests/summoner-thread-manage.test.js \
  .test-dist/tests/summoner-protocol.test.js \
  .test-dist/tests/skill-engine.test.js \
  .test-dist/tests/distill.test.js \
  .test-dist/tests/swift-tray-integrity.test.js \
  .test-dist/tests/summoner-overlay.test.js
```

**pass 172 / fail 2**（上表）。F-I-5、PEM 4200、F-S-1、ACL deny add/import/config.set、overlay alias-only、confirm dialect、tray integrity：全绿。

---

## Nits（不挡 ACL）

1. **P1 process：** 复原 `03de168` C-thin `on:!on` + `ids:next`（或改测匹配暗色 HTML）。HEAD 红测与生产分裂。
2. **I3：** 非 UTF-8 拒绝或走 `parseFile`；不要把 `base64EncodedString()` 当知识正文。
3. **I5：** listCol 包 `NSScrollView`；rail 推全量或明确「最近 N 条」。
4. **I6：** 未知 id 返回 error + 单测；C-thin 卸挂用 `ids:next` toggle。
5. Overlay WS 仍允许 `mcp.toggle_server`：保持 C-thin/HUD 骑 tray；不要在 summoner socket 上答 L2。

---

VERDICT: APPROVE_WITH_NITS
