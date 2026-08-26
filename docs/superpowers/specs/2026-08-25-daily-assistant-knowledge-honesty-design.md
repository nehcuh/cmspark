# Daily Assistant · Knowledge Honesty — 产品设计（多路对抗合成）

> **日期**: 2026-08-25  
> **状态**: **LOCKED · Wave 0/0b/1/2 landed** — 设计 dual both AWN；Wave 0 impl both AWN `105843`；Wave 0b+1 r3 both AWN `knowledge-honesty-wave0b1-r3-verdict-20260825-114735`；Wave 2 dual both AWN `knowledge-honesty-wave2-verdict-20260825-132009`。  
> **方法**: 四路独立对抗（Product · Impl · Security · External）→ 吸收全部 BLOCK → 外审  
> **触发**: 用户 10 点产品评论 + 认可「浏览器+本机知识日常助手为主叙事；编程接力 opt-in」  
> **坐标**: [ADR-020](../../adr/020-capability-model-three-axes.md)  
> **对抗原文**: [adversary-synthesis](../../audit/reviews/daily-assistant-knowledge-honesty-adversary-synthesis-20260825.md)  
> **双审**: [claude](../../audit/reviews/daily-assistant-knowledge-honesty-claude-20260825-102532.md) · [pi](../../audit/reviews/daily-assistant-knowledge-honesty-pi-20260825-102532.md)

```text
Surface:      L0 chat UX (disclosure chips + confirm-import) ; overlay unchanged C-thin
L2-classes:   (none)
Compose:      knowledge (markdown + SkillEngine) ; pack 场景 already owns knowledge_ids
Autonomy:     n/a
Trust:        no elevation ; knowledge remains untrusted retrieved data ; overlay ACL does not grow
Channel:      community | enterprise unchanged
```

**Blast tier**: Wave 0 / 0b / 1 / 2 = **T2**（L0 Compose；无新 L2 / 无 overlay confirm / overlay ACL 不涨）。

---

## 0. 一句话裁决

| 问题 | 裁决 |
|------|------|
| 6 个月主叙事：日常浏览器 + 本机知识助手，不是 Codex | **GO** — 必须能在空态/召唤器上被看见 |
| 原 strawman 整包（分类体系 + 双链图 + Project + Perplexity 脚注 + 远程库 + Raycast 对标） | **REJECT THE BUNDLE** |
| 中文标题能入库 | **GO**（identity 三分，不是改一行 regex） |
| 办公文档进知识库 | **GO**（确认导入：抽出正文预览 + `user_gesture`） |
| 「带来源」 | **GO 为「本轮附带」ledger**；**NO-GO** 模型自写脚注 |
| Overlay 变 Raycast / 展开=打开侧栏当主路径 | **NO-GO** |
| 新实体 Project / 分类表 / 持久化知识图谱 | **NO-GO** |
| 远程知识库 / 默认同步 | **NO-GO this bet** |
| 每轮对话自动写入全局知识 | **NO-GO**（已有锁，重申） |

**产品句：**

> 问这页（和你刚确认入库的那份资料），看见本轮附带了什么，需要时再存一篇。  
> 召唤器是快捷提问窗，不是启动器，不是第二块 Side Panel。

---

## 1. 用户 10 点 → 吸收后的去向

| # | 用户点 | 去向 |
|---|--------|------|
| 1 | vs Codex | **定位锁** F-ID-1：空态/召唤器不以仓库为家；ACP/工作区保持 opt-in |
| 2 | Overlay 像 Raycast/uTools | **禁对标**。名词=召唤器/快捷提问。以后可做它们的**插件分发**，不重做启动器 |
| 3 | 悬浮窗展开到历史/MCP/Skill/设置 | Overlay **不长管理台**。继续/历史标题检索已在召唤器；MCP **只读状态**；技能/设置诚实文案「在侧栏打开」（Companion **不能** `sidePanel.open`） |
| 4 | 知识自动归类 / 分类说明 | **本季不做 ontology**。导入确认时可写 tags + description（用户可改）。禁止 ThreadDigest 式事后批量抽标签当空壳 |
| 5 | 回答带来源 | **本轮附带芯片** = Companion 实际注入/检索到的 `{id,title,chunk?}`。禁止模型发明文件名 |
| 6 | 双链 + L0 后 1 跳 | **P2 且 query-time**，抄 `threads/related.ts`，最多 3 条「相关」，不叫图谱、不落边库。有成员后再做 |
| 7 | docx/pdf 导入 | **确认导入**一条动词：解析已有，缺的是预览+手势+标题 |
| 8 | 中文名 | **Wave 0**：`title` 可 CJK；`id`/`filename` 安全 slug；冲突后缀；禁止抛 “Use alphanumeric” |
| 9 | Project | **禁名词**。Pack=场景；分组以后才考虑「话题夹」。提炼为知识=显式动作 |
| 10 | 远程知识库 | **本 bet 不做**。要 Notion/Obsidian 走已有导出 |

---

## 2. 冲突仲裁（四路不一致处）

| 冲突 | Product | Impl / Security / External | **锁** |
|------|---------|----------------------------|--------|
| Overlay 展开 | 必须在浮窗内完成 verb，侧栏不能当唯一 UI | Companion **无法**从 overlay 打开 Side Panel；ACL 不得涨 | **Peek 已有能力**（`thread.list` / 新对话 / 标题搜 / `mcp.list` 只读）。技能/设置 = 诚实「去侧栏」。**本切片不改 overlay 协议** |
| 分类 | 导入时要有 category 对象 | 禁止新表；tags+description 已有 | **无 Category 实体**。导入确认写 `tags[]` + `description` |
| 引用 | 来源必须诚实 | 禁止模型脚注 | **retrieved_sources 挂在 turn 上**，UI 渲染芯片 |
| Project | 容器 ≠ 配方 | 禁止第四张表 | **不造船**。场景+提炼足够 |
| Overlay 确认导入 | 希望 chat/overlay 附件一键入库 | Overlay 禁止 `knowledge.*` | **`file.upload` 仍只进线程**。「收入知识库」只在 **Side Panel** 聊天卡片/知识面板；召唤器最多提示去侧栏 |
| RAG 未消毒 | — | Security BLOCK | **Wave 0 必带**：chunk 路径与 truncate 路径同样 sanitize |

---

## 3. 锁定（实现前不可破）

### 3.1 身份 F-ID / F-UX

- **F-ID-1** 默认空态仍是「这页 / 这轮会话」，不是仓库路径或 diff。ACP `acp.enabled` 默认 false；工作区在场景后。
- **F-UX-NOUN-1** UI 禁：Project/项目（容器义）、图谱/双链、Raycast/uTools/启动器、第二大脑/wiki、`[1]` 脚注（直到有可见 retrieve tool）。
- **F-UX-NOUN-2** 保留：场景、知识、本轮附带、召唤器、快捷提问、相关（≤3）。
- **F-UX-OVERLAY-1** Overlay 是 Capture + 这轮 USE，不是 Confirm、不是 CONFIGURE。USE：`knowledge.list` / `set_active`、overlay-eligible `pack.apply`、`skill.list`、`mcp.list`。CONFIGURE 不在 overlay WS：`knowledge.get/import/update`、`mcp.add`、`config.set`、grant。Overlay **永不** Allow/Deny。批准文案 **「打开确认台」**，不假装 `sidePanel.open`（F-I-4）。Mac HUD stdin `mcp.add`/`knowledge.import` 冻结，不是许可证。`mcp.toggle_server` / `skill.activate` 冻结，票 `overlay-acl-rollback`。完整替换句见 [product-form-deepening §10](./2026-08-26-product-form-deepening-design.md)。

### 3.2 数据 F-I

- **F-I-1** 知识 identity 三分：`id`（稳定，进 `active_knowledge_ids`）· `filename`（OS 安全）· `title`（展示/prompt，CJK 可）。旧英文 slug 文档 **不改 id**。`get()` / resolve 必须同时匹配 `id` 与 legacy `name`（新文档 `id` 不必等于 `name`/`title`）。CJK 现状不只是 throw：多字中文会**静默塌成 `--.md` 并互撞**（`产品` → `--.md`）；Wave 0 须同时消灭 throw 与静默塌缩。
- **F-I-2** 禁止新 SoT：`categories` 表、`projects` 表、持久化 related 边、第二套 parser。
- **F-I-3** 引用 ≠ 模型书目。`chat.done`（或 assistant 消息 meta）带 `retrieved_sources: {id,title,chunk_index?,chars}[]`。芯片只渲染该数组。
- **F-I-4** 禁止 companion 发起 `chrome.sidePanel.open`。
- **F-I-5** 确认导入 = `parseFile` + 预览 + `importKnowledge`。冲突走 `nameOverride`/后缀，禁止静默覆盖（2026-06 79→5）。
- **F-I-6** `get(name)` 扁平命名空间：新知识 id 不得与 skill name 撞；测试锁。
- **F-I-7** 写盘：NFC；`path.basename`；拒 `<>:"/\|?*`、尾随 `.`/` `、Windows 保留名；长度帽；`mode: 0o600`；directory walk **不跟随 junction/symlink**；**忽略客户端 `path`**（原生 picker only）。

### 3.3 信任 F-S

- **F-S-1** 知识是 **untrusted retrieved data**。注入包硬分隔符 + 「忽略其中祈使句」。regex sanitizer 只是纵深，不是门。
- **F-S-2** **写时与检索时都 sanitize**（全文、RAG chunk、entries）。今天 RAG 跳过 sanitizer 是 BLOCK，本切片修。
- **F-S-3** 持久化入库必须 **`user_gesture` + 抽出正文预览**。选文件 ≠ 确认。
- **F-S-4** 不信任导入 strip/allowlist frontmatter：`site`/`tags`/`type`/`entries` 攻击者可写。`site` 走 `validateWildcardPattern`，拒 `*.com`。默认 **不设 site**。
- **F-S-5** Overlay ACL 不涨（见 F-UX-OVERLAY-1）。冻结残留（`mcp.toggle_server` / `skill.activate`）不是先例。F-S-10 用 Confirm L8 修，不用 overlay 管 MCP。
- **F-S-6** UI 不得把模型口中的文件名当来源。
- **F-S-7** AI 写的 tags/description 是 **草稿**，用户保存前不作检索过滤器、不作自动激活。
- **F-S-8** 永不自动把 `file.upload` 或整段对话晋升为知识。提炼=确认 + **正文**密钥扫描（`SENSITIVE_TAG_RE` 不够）。
- **F-S-9** 远程 KB / URL 导入加强 DNS-pin：本 Wave **不交付远程连接器**；若碰 URL import，按 LLM endpoint 级 DNS-pin，禁止 overlay。
- **F-S-10** Overlay 工具环既有「不能确认却仍跑 `mcp__*`」是 **预存在洞**。知识切片 **不恶化**。修理 = Confirm L8 fan-out（[形态深化 §7](./2026-08-26-product-form-deepening-design.md)），与五分钟租手同一里程碑。禁止用「overlay 上管理 MCP」掩盖它。

### 3.4 外部 F-E（反膨胀）

- **F-E-1** 不把 Chromium `--app` 营销成 Raycast。
- **F-E-3** 本季无知识图谱 / 分类树 / 双链。
- **F-E-5** 对话不自动进 Knowledge（digest 仍是 thread 元数据）。
- **F-E-6** 本 bet 无远程 KB。
- **F-E-8** NotebookLM / Obsidian 保持 **outbound**。本机知识是 **opt-in inbound**。
- **F-E-10** 无默认 embedding、无 graph DB、无新 runtime。

---

## 4. 数据模型（最小）

仍是 `~/.cmspark-agent/knowledge/{global,sites}/*.md`。只加 frontmatter 字段，不新建库。

```text
KnowledgeDoc
  id:          string     // 旧文档 = 现 frontmatter name；新文档稳定 slug/uuid
  title:       string     // 展示 + prompt 标题；CJK
  filename:    string     // OS 安全；可与 id.md 相同
  type:        site_knowledge | domain_knowledge | path-inferred
  site?:       string     // 仅用户确认；须过 wildcard 校验
  tags:        string[]   // normalizeTag()；max 8
  description: string     // 已有推断；导入确认可改
  source_file: path
```

Thread 仍无 Project 表。保留 `active_knowledge_ids` / `knowledge_selection_mode` / `mission_pack_id` / `workspace_root`。Wave 2 可有 `topic_folder?: string | null`（话题夹标签，非实体）。

Turn meta（新 · Wave 1 钉死，Wave 0 可先不写协议）：

```text
retrieved_sources: Array<{ id: string; title: string; chunk_index?: number; chars: number }>
```

- **挂在 assistant 消息**上（与该轮回复 1:1），不是 thread 级。  
- `chars` = 本轮实际注入该源的字符数（sanitize 之后）。  
- Overlay 若画芯片：走已有 `chat.done` SSE（已在 `SUMMONER_WEB_EVENT_ALLOW`），**零 ACL 增长**。

「场景」继续当配方。不发明 Project。

---

## 5. 波浪（实现顺序 · 必须一起的标出）

### Wave 0 — Identity + 注入诚实（P0，必须同 PR 家族）

1. `{id, filename, title}` 三分；CJK title 导入不再 throw，也不再塌成 `--.md`。  
2. **全部写盘点**走同一 helper（禁止只改 `importKnowledge`）。枚举（实现时以当时行号为准，漏一即 FAIL）：
   - `skill-engine.ts` `writeFileSync`：`saveSkillFile` / `importSkill` / zip extract / `importSkillFiles` / `importKnowledge` / `createExperienceSkill`
   - `skills/skill-install.ts` namer
   - `packs/pack-engine.ts` knowledge copy namer
   - UI `SkillCraftPanel` 若仍本地 sanitize，必须对齐 helper 语义  
3. 冲突后缀；旧 `active_knowledge_ids` 不改写。  
4. Sanitize **三条检索返回路径**（漏一即 FAIL）：`getKnowledgeSummary` RAG 与 truncate、`getEntriesSummary`、`searchKnowledge`（若仍无调用者：sanitize 或删除，禁止留 raw 后门）。  
5. 写盘 0o600 + Windows 保留名 + 不跟随 junction。  
6. UI 列表/搜索/芯片用 `title`。  
7. `get(id)` 解析新 `id` 字段；legacy `name` 仍命中。

**验收（可机核）**

- `importKnowledge` 纯中文标题成功；磁盘 filename 安全；`listKnowledge` 的展示名为中文。  
- `产品甲` / `产品乙`（两纯 CJK）不互相覆盖；不得都写成 `--.md`。  
- `CON` / `../x` / 空 slug 拒绝。  
- RAG / entries / `searchKnowledge` 三条路径测到 sanitizer。  
- 旧英文 id 的线程 `active_knowledge_ids` 仍能 resolve；新文档用独立 `id` 也能 `get(id)`。

### Wave 0b — 确认导入（可紧随 0，不可当成「parser 新功能」）

1. Side Panel：附件卡片 / 知识面板 **预览抽出 Markdown** → 用户改 title/tags/description → `user_gesture` → `importKnowledge`。  
2. 可选「钉到本线程」`active_knowledge_ids`。  
3. Overlay / 召唤器 **不**写知识。  
4. 导入 frontmatter allowlist（F-S-4）。  
5. 目录导入：继续原生 picker；忽略 WS `path`。

**验收**

- 无预览、无 gesture 的 `knowledge.import` 从 UI 主路径消失。协议层：Side Panel 主路径必须带 `user_gesture`；无手势的 WS 调用 **本 Wave 不强制 400**（本地已鉴权 WS；Claude nit 4 已记录，可作为 0b+ 收紧）。  
- PDF/DOCX 与现 `parseFile` 同管道；无第二 parser。  
- Overlay `file.upload` 后知识目录文件数不变。

### Wave 1 — 「本轮附带」（不是 citations 产品）

1. `getKnowledgeSummary` / resolve 时收集 `retrieved_sources`。  
2. `chat.done` + 落盘 assistant meta。  
3. Side Panel（及 overlay 若已有消息泡）渲染芯片；点击打开知识面板该条。  
4. Prompt 标题改为 `## Knowledge: {title} [{id}]`，便于模型**重复** id，而不是发明。  
5. 可选：`tags`+`description` 进入 `searchChunks` 词袋（仍非 ontology）。

**验收**

- 未注入任何知识时无芯片。  
- 芯片集合 ⊆ 本轮实际注入 id。单测：模型文本里出现的伪造文件名 **不会**变成芯片。  
- 不新增 `query_knowledge` tool（本 Wave）。

### Wave 2 — 相关 / 提炼 / 话题夹 / 召唤器瘦身（本切片开工）

1. query-time 知识「相关」≤3（抄 `threads/related.ts` co-tag + TF；不落边、不叫图谱）。  
2. 线程「提炼为知识」：`thread.distill_preview` 出 markdown + **正文**密钥扫描；落盘仍走现有确认导入 modal（`user_gesture`）。禁止自动写盘。  
3. 话题夹：`Thread.topic_folder` 字符串标签，不是 Project / Pack。  
4. 召唤器文案去工作台化：技能/MCP/设置「去侧栏处理」；不涨 overlay `knowledge.*` ACL。  
5. Raycast/uTools 仅 **插件分发说明**（`docs/summoner-launcher-plugins.md`），不重做启动器。

**验收**

- `findRelatedKnowledge` / `knowledge.related` 最多 3 条；无 seed → 空。  
- `thread.distill_preview` 脱敏 `ghp_` / PEM 等；知识目录文件数不变；确认导入才 `knowledge.import`。  
- `thread.update` 白名单含 `topic_folder`；路径字符被剥；UI 禁 Project。  
- overlay HTML 仍含「召唤器（实验）」「去侧栏处理」；不含 Allow/Deny；`knowledge.related` / `thread.distill_preview` 不在 summoner allowlist。  
- 文档写清：热键分发，不保存 `ws_secret`。

### 明确不在任何 Wave

Embedding 默认、graph DB、知识图谱 UI、Project 实体、远程 KB、overlay 知识管理、companion 打开 Side Panel、把 Pack 改名为 Project、对话自动入库、Perplexity `[n]` 脚注。

---

## 6. 实现落点（Wave 0 开工时）

| 区域 | 文件 |
|------|------|
| Identity / 写盘 | `companion/src/skills/skill-engine.ts`（六路径）· `skill-install.ts` · `packs/pack-engine.ts` namer |
| Sanitize | `getKnowledgeSummary`（RAG+truncate）· `getEntriesSummary` · `searchKnowledge` · `content-sanitizer.ts` |
| Import 手势 | `message-router.ts` `knowledge.import*` · `chrome-extension/.../KnowledgeSubPanel.tsx` · 聊天附件卡片 |
| Title UI | `KnowledgeSubPanel.tsx` · list payload |
| Sources | `skill-engine.ts` resolve · `adapter.ts` / router `chat.done` · ChatView 芯片 |
| 测试 | `companion/tests` knowledge import / sanitizer / retrieved_sources；扩展组件测芯片 ⊆ ledger |

---

## 7. 开放问题（外审可降 nit；不可重开已锁）

已锁、外审不得用「再讨论」推翻：F-I-1/2/3、F-S-2/3/5、F-UX-NOUN-1、F-E-6。

仅记录：

1. 新文档 `id` 用 slug-from-title 还是 uuid（须稳定、须不撞 skill）。  
2. Wave 1 芯片是否出现在 overlay HTML（C-thin 消息泡已有 markdown；**不要**为此涨 ACL）。  
3. Overlay 预存在 MCP-without-confirm（F-S-10）另票优先级 — **不阻塞** Wave 0。

---

## 8. 修订历史

| 日期 | 内容 |
|------|------|
| 2026-08-25 | 四路对抗合成初稿。Product/Impl **MAJOR_REVISE**；Security/External **REJECT bundle**。本页吸收全部 BLOCK 后待 Claude+Pi dual-review。 |
| 2026-08-25 | Dual **both APPROVE_WITH_NITS** `20260825-102532`。折入：静默 `--.md` 碰撞、sanitize 三路径、写盘点枚举、`get(id)`、`产品甲/乙` 验收、`retrieved_sources` 挂消息、overlay 芯片零 ACL。 |
| 2026-08-25 | Wave 2 开工：query-time 相关≤3、distill 确认导入、话题夹、召唤器瘦身、启动器插件分发文档。 |
