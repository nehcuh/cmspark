# Knowledge CRUD Honesty — 产品设计（多路对抗合成）

> **日期**: 2026-08-26  
> **状态**: **LOCKED · design dual both AWN** `knowledge-crud-honesty-verdict-20260826-111617`（nits 已折入）  
> **方法**: 四路独立对抗（Product · Impl · Security · External）→ 吸收全部 BLOCK → 外审  
> **触发**: 用户 知识库「感觉怪 / 看不到关联 / 没有导出和编辑入口」；前序确认 **本季不重开知识图谱**  
> **前序 SoT（不得削弱）**: [Knowledge Honesty](./2026-08-25-daily-assistant-knowledge-honesty-design.md)  
> **对抗原文**: [adversary-synthesis](../../audit/reviews/knowledge-crud-honesty-adversary-synthesis-20260826.md)  
> **双审**: [claude](../../audit/reviews/knowledge-crud-honesty-claude-20260826-111617.md) · [pi](../../audit/reviews/knowledge-crud-honesty-pi-20260826-111617.md) · [verdict](../../audit/reviews/knowledge-crud-honesty-verdict-20260826-111617.json)  
> **坐标**: [ADR-020](../../adr/020-capability-model-three-axes.md)

```text
Surface:      L0 Side Panel knowledge sheet (reader + card/body save + Blob download)
L2-classes:   (none)
Compose:      existing knowledge markdown + SkillEngine; no new SoT
Autonomy:     n/a
Trust:        no elevation; knowledge remains untrusted retrieved data;
              overlay ACL does not grow (including knowledge.get)
Channel:      community | enterprise unchanged
```

**Blast tier**: Wave 3 = **T2**（L0 Compose；无新 L2；overlay ACL 不涨）。

---

## 0. 一句话裁决

| 问题 | 裁决 |
|------|------|
| 用户要能看见/改/拿走已入库的知识 | **GO** — 这是 Honesty  inbound 的对称缺口 |
| 用关联图谱 / 双链 / 力导向回答「看不到关联」 | **NO-GO** — F-E-3 / F-UX-NOUN-1 不改；会话关系图是另一对象 |
| 默认展示 related≤3 当「关联产品」 | **NO-GO as substitute**；**GO as Wave 3 发现性**（算法已在 Honesty Wave 2；本波只把已有命中画成可点芯片） |
| 320px 知识 IDE（分栏预览 / mermaid / 双链输入） | **NO-GO** |
| 同一张 sheet 改标题/标签/说明/**一块 textarea 正文** | **GO** |
| 下载当「导出到 Obsidian」/ 写 vault | **NO-GO**；Blob `.md` only |
| Overlay 增加 `knowledge.get/update/export` | **NO-GO**（get 也拒，不只拒写） |
| 对话自动入库 / Project / embedding / 持久边 | **NO-GO**（Honesty NEVER） |

**产品句：**

> 点开一篇就能看见会被注入的正文，能改标题/标签/说明和正文并确认保存，能下载 Markdown；相关≤3 是列表上可点开的重叠提示——不是图谱，也不是第二大脑。

---

## 1. 用户抱怨 → 吸收后的去向

| # | 用户点 | 去向 |
|---|--------|------|
| 怪 | 注入库长得像资料库，却打不开 | **P0 阅读器**：行点击 / 「本轮附带」芯片 → **正文**，不是高亮一行 |
| 看不到关联 | 已有 `knowledge.related` 藏在按钮后，标题不可点，算法不看正文 | **P0 发现性**：list 一次带 ≤3 `{id,title}`；有则芯片、无则隐藏或「暂无相关」；点开阅读器。算法不改、不叫图谱 |
| 没有编辑入口 | `···` 只有删除 | **P0 sheet**：标题/标签/说明 + textarea 正文；`user_gesture`；内置只读 |
| 没有导出入口 | 只有 inbound 导入 | **P0** 阅读器「下载 .md」；Companion 不写宿主；不套 ADR-008 wikilinks |
| 图谱？ | 前序已解释本季锁 | **不重开**。本切片文案零「图谱/双链/会话关系图」 |

---

## 2. 锁定（实现前不可破）

### 2.1 身份 / 协议 F-I

- **F-I-1** 保持 `{id, filename, title}`。**update 不得**走 `importKnowledge` / `allocateDocIdentity`（会换 id，钉死的 `active_knowledge_ids` 悬空）。原地写**同一** `filenameStem` / `source_file`。Title 是展示，不是 stem。
- **F-I-2** 禁止新 SoT：分类表、Project、持久 related 边、`relations:` frontmatter。
- **F-I-5** 禁止静默覆盖另一篇；碰撞只可能在**真的改路径**时（v1 不改路径）。
- **F-I-6** `knowledge.get/update/export/delete` 必须 `isKnowledgeDoc`；`exportSkill` 拒知识 id（对偶）。
- **F-I-7** 忽略客户端 `path`；`writeRestrictedFile`（0o600，拒 symlink）；NFC；Windows 保留名。
- **F-I-8** v1 **不可**改 `site` / `type`（避免 sites↔global 搬家 / TOCTOU）。
- **F-I-9** 解析键：所有知识动词 `id`（必填），`get()` 仍匹配 legacy `name`。UI 勾选 / 删除 / 导出一律发 **id**。
- **F-I-10** `listKnowledge` 瘦身为 `{id,name,title,description,type,site,tags,builtin,related?}`。禁止 `source_file` / `entries` / `dir` / `resources` / `body`。

### 2.2 UX F-UX

- **F-UX-NOUN-1** 本切片 UI/PR/注释用户可见 copy **禁**：图谱、关联图谱、知识图谱、双链、相关网络、wiki、第二大脑、会话关系图、类 Obsidian、导出到 Obsidian、孤立点、节点/边。
- **F-UX-NOUN-2** 保留：知识、相关、暂无相关、查看、正文、编辑、保存、下载、标题、说明、标签、本轮附带。
- **F-UX-SHEET-1** 阅读器 = 复用现有 modal/sheet 铬（`KnowledgeImportModal` / `Modal`），**不**新底栏 tab、**不**新一级入口。
- **F-UX-SHEET-2** 正文控件 = `<pre>`（只读）或 `<textarea>`（编辑）。**无**分栏 live preview、**无** mermaid、**无** `dangerouslySetInnerHTML`。
- **F-UX-REL-1** 相关：有命中才画最多 3 个可点芯片；空不假装网络。芯片打开**同一阅读器**（换 id）。去掉额外「相关」按钮（避免双入口）。
- **F-UX-REL-2** 行上展示 tags（最多几个 pill）。Related 没有可见标签就是隐藏排序。
- **F-UX-CHIP-1** `cmspark:open-knowledge` → 打开阅读器 + `knowledge.get`，不再只 `scrollIntoView`。
- **F-UX-OVERLAY-1** Overlay **不**新增任何 `knowledge.*`（含 get）。召唤器最多「去侧栏查看」。
- **F-UX-EXPORT-1** 按钮文案 **「下载 .md」**（或「下载」）。不是 📥 / 不是 Obsidian。

### 2.3 信任 F-S

- **F-S-1/2** 注入路径仍 sanitize + untrusted wrap。**get 返回磁盘原文**给编辑器；get **不得**当模型上下文。
- **F-S-3/13** `knowledge.update` / `knowledge.export` / `knowledge.delete` 在 **validate + router** 要求 `user_gesture: true`（400）。不复制 import 的 Wave 0b 豁免。
- **F-S-4/12** update 必须 `allowlistKnowledgeFrontmatter`。v1 UI **不发送** `site`/`type`；若 WS 直打带了 `site`：**不应用**（既不搬家也不改 frontmatter site）。非法/额外字段丢掉，不 500。丢掉 `entries`。Builtin → 错误，不写盘。
- **F-S-5/11** overlay / `SUMMONER_WEB_DISPATCH_ALLOW` / inbound MCP / `getToolDefinitions` **都没有** get/update/export。Router 对 summoner extra-deny（同 import）。
- **F-S-7** 用户保存前，tags/description 仍是草稿；本 sheet 保存 = 用户确认，之后可以进 related 词袋（已有算法）。
- **F-S-8/14** 导出 = 磁盘 markdown **减去** `redactSecrets` 命中（frontmatter `id`/`title` 保留，不是 `exportSkill` 的 skill YAML）。「原样」指不跑 vault-profiler/wikilinks，**不是**不扫密钥。响应带 `redacted_hits`。Update **不**静默剥正文（用户自己的笔记；注入路径仍 sanitize；确认文案报次数）——这不是导出豁免。
- **F-S-15** 知识正文不是 HTML sink。
- **F-S-16** 单篇 get/export 体上限：磁盘文件 >6MiB 拒；WS 正文 **512KiB**，超出 `{truncated:true, char_count}` 且不传其余。v1 **拒绝导出**超 512KiB 的篇（阅读器禁用「下载」并提示「正文超过 512KiB，无法下载」）。512KiB–6MiB 可读不可下，是 exfil 边界，不是 bug。

### 2.4 外部 F-E

- **F-E-3** 本季仍无知识图谱 / 分类树 / 双链。
- **F-E-8** Obsidian 保持 thread outbound。知识下载是 **redact 后的磁盘 markdown Blob**，不跑 vault 档案/模板/wikilinks。
- **F-E-10** 无默认 embedding、无 graph DB、无新 runtime、无 `knowledge.graph*`。
- **F-E-11** 不复用 `tabs/thread-graph.html`。

---

## 3. 协议

```text
knowledge.get      { id }
                   → { type: "knowledge.doc", doc: { id, name, title, tags, description,
                       type, site?, body, char_count, truncated, related?: [{id,title}] } }
                   Envelope `type` is the WS verb; document `type` stays inside `doc`.

knowledge.update   { id, user_gesture: true, title?, tags?, description?, body? }
                   → { type: "knowledge.updated", id, title }
                   客户端再发 knowledge.list（瘦）。服务端不顺带推全量 list。
                   原地；builtin 错误；直打 site/type **忽略不应用**

knowledge.export   { id, user_gesture: true }     // 禁止 id[]
                   → { format: "markdown", filename, content, redacted_hits }
                   Side Panel Blob；Companion 不写路径

knowledge.delete   { id, user_gesture: true }     // 修：不再用 name
knowledge.list     瘦 meta。
                   Side Panel（surface ≠ summoner）：可带 related?: [{id,title}] ≤3（服务端一次算）。
                   Overlay / summoner-web：同一 list **剥掉 related**（不涨 verb，也不把派生边给 C-thin）。
knowledge.related  保留到下一波再标 deprecated；阅读器/列表不必再点。禁止每行 N 次调用。
```

Overlay 仍仅：`knowledge.list` + `knowledge.set_active`。新动词 **不**进 `SUMMONER_ALLOW` / HTML。

`knowledge.set_active`：known set = 每篇的 `id` **与** `name`。

`knowledge.import_directory`：**validate 不再要求 `path`**（F-I-7；UI 只发 `user_gesture`）。

---

## 4. UI（Side Panel 知识面板）

1. 行点击 → sheet：标题、tags pills、说明、正文（内置只读 `<pre>`；用户文档 `<textarea>`）。
2. 保存：确认（已有 confirm 风格即可）+ `user_gesture`。
3. 「下载 .md」：`knowledge.export` → Blob。
4. `···`：下载、删除（内置无删除）。去掉单独「相关」按钮。
5. 列表行：标题、说明、tags、相关芯片（可点）。
6. 「本轮附带」芯片：打开该 id 阅读器。
7. 管理模式保持批量**删除**；v1 不做批量下载。

允许文案见对抗合成 External 表。空相关：**不显示行**或「暂无相关」，不用「孤立点」。

---

## 5. 波浪（必须同一 PR 家族，否则禁止宣称「知识库不怪」）

### Wave 3 — 阅读器 + 发现性 + 确认保存 + 下载 + 协议修复

同 PR 家族（可多 commit，不可只交一半）：

1. 修 `knowledge.delete`：validate/router/UI 统一 `id` + `user_gesture`。
2. 修 `knowledge.import_directory` validate 不要求 `path`。
3. 修 `set_active` / 勾选键为 id（兼容 name）。
4. 瘦 `listKnowledge`；list 一次填 `related`≤3。
5. `knowledge.get` + 阅读器 + chip/行打开正文。
6. `knowledge.update` 原地 + 写盘管线 + 手势。
7. `knowledge.export` 单篇 Blob + redact。
8. `exportSkill` 拒绝知识 id。
9. Overlay 单测：get/update/export `has(...) === false`。
10. Copy 扫描：本 diff 无 F-UX-NOUN-1 禁词。

**验收（可机核）**

- get 用 legacy name 与新 id 都能命中；返回无 `source_file`。
- update 改 CJK title：**id 与 filename 不变**；`active_knowledge_ids` 仍 resolve。
- update 不把当前 stem 当成「已占用」而写成 `notes-2`。
- builtin update/delete 失败；磁盘不变。
- export 不是 `exportSkill` 的 skill YAML（保留 `id`/`title`）。
- `exportSkill(knowledgeId)` throw；`exportKnowledge(skillName)` throw。
- summoner：get/update/export 被拒；summoner `knowledge.list` 无 `related`。
- Side Panel list 无 body/path/entries；related 长度 ≤3。
- `set_active` 在 `id !== name` 时仍能钉住（发 id）。
- delete 发 `id` 的 payload validate 通过；只发 `name` 的旧 payload 失败（有意）。
- import_directory 无 `path` 仍可进 router（手势仍要）。

### 明确不在本 Wave / 本季

知识图谱 UI、力导向、持久边、embedding、Project、远程 KB、overlay 知识管理、companion 打开 Side Panel、对话自动入库、分栏预览、vault 写入、多篇 zip、改 site/type、`query_knowledge` tool、Perplexity 脚注。

---

## 6. 实现落点

| 区域 | 文件 |
|------|------|
| Engine | `companion/src/skills/skill-engine.ts`（getKnowledgeDoc / updateKnowledge / exportKnowledge；瘦 list；exportSkill 拒绝） |
| Related | `companion/src/skills/knowledge-related.ts`（list 一次调用，不改算法） |
| Write | `companion/src/skills/doc-identity.ts` `writeRestrictedFile` |
| Redact | `companion/src/threads/distill.ts` `redactSecrets` |
| Router / validate / ACL | `message-router.ts` · `ws/validate.ts` · `ws/summoner-acl.ts` · `companion/src/summoner-web.ts`（**不**加 get/update/export 路由；list 剥 related） |
| Relay | `chrome-extension/src/background/index.ts` · `useWebSocket.ts` |
| UI | `KnowledgeSubPanel.tsx` · `ChatView.tsx` 芯片 · `ContextPanelHost.tsx` · `types.ts` |
| 测试 | `skill-engine.test.ts` · `knowledge-related.test.ts` · `summoner-web.test.ts` · `summoner-acl.test.ts` · router/validate 单测 · 扩展：delete 发 id |

---

## 7. 开放问题（外审可降 nit；不可重开已锁）

已锁：F-E-3、F-UX-NOUN-1、F-S-5 含 get、F-I-1 原地 update、v1 单篇导出、无 overlay 新动词、无 wiki 分栏、512KiB 导出拒绝、overlay list 剥 related、update 响应不附带全量 list、export = redact 后磁盘 md。

仅记录：

1. `knowledge.related` 独立动词何时标 deprecated（本 Wave 保留兼容）。
2. update last-write-wins（无 if-match）是否要在 UI 提示。

---

## 8. 修订历史

- 2026-08-26：四路对抗合成初稿。
- 2026-08-26：Claude+Pi dual both AWN `knowledge-crud-honesty-verdict-20260826-111617`；折 nits（Wave 命名、site 忽略、list 响应、overlay 剥 related、export 文案、验收补 set_active/exportSkill、512KiB UI 提示）。
