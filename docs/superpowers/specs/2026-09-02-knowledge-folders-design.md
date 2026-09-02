# Knowledge Folders — 多级文件夹 + 用户语义辅助匹配（双路对抗收敛）

> **日期**: 2026-09-02  
> **状态**: **PROPOSED · design dual-converged**（grok + claude 独立对抗设计已收敛，设计产物 `.omx/artifacts/design/`，待实现评审）  
> **方法**: 双路独立对抗设计（grok · claude）→ 收敛  
> **触发**: 知识库只有 `global|sites` 两个扁桶、目录导入还拍平；用户无法按工作堆放，匹配也吃不到「这堆是干什么的」；GitHub [#274](https://github.com/nehcuh/cmspark/issues/274)  
> **前序 SoT（不得削弱）**: [Knowledge Honesty](./2026-08-25-daily-assistant-knowledge-honesty-design.md) · [Knowledge CRUD Honesty](./2026-08-26-knowledge-crud-honesty-design.md)（锁编号 F-I/F-S/F-E/F-UX 均出自后者）  
> **设计原料**: [design-grok 提案 3](../../.omx/artifacts/design/design-grok.md)（主）· [design-claude 提案 3](../../.omx/artifacts/design/design-claude.md)（补：文档 id 稳定性为第一返工面、原子移动）  
> **GitHub:** [#274](https://github.com/nehcuh/cmspark/issues/274)。相邻票：#272（AI 草稿模式同源）、#273 Wave A（唯一接口 = 打分 bag 加 folder 两个字段）。实现另开 PR，不在 main 直接实现。

```text
Surface:      L0 Side Panel 知识面板 + skill-engine 知识扫描/加载（模块内扩展）
L2-classes:   (none)
Compose:      existing knowledge markdown + SkillEngine; no new SoT（文件夹 = 磁盘目录 + _folder.md）
Autonomy:     低（用户主导组织；AI 仅文件夹说明草稿，手点、不落盘直到保存）
Trust:        no elevation; 无新信任边界；overlay ACL 不涨；所有新动词 user_gesture
Channel:      既有 WS（新增动词均 user_gesture，summoner 拒绝）
```

**Blast tier**: **T1** — 本地文件组织 + 既有匹配 bag 扩展；无新外发、无新 L2、overlay ACL 不涨。

---

## 0. 一句话裁决

| 问题 | 裁决 |
|------|------|
| 用户在桶内建多级文件夹组织知识 | **GO** — `global|sites` 桶内 ≤3 级真目录，磁盘为 SoT |
| 用虚拟分组（只写 `folder:` frontmatter、磁盘仍扁）顶替 | **NO-GO** — 票要求磁盘与面板一致、可被 Obsidian 直接读；虚拟分组会撒谎。第一季就做真目录 |
| 文件夹 = 系统分类法 / 分类树 / 预置分类 | **NO-GO** — 文件夹是用户文件，不是系统本体（F-E-3 / F-I-2 分界） |
| 文档移动 | **GO** — 同桶内 rename 路径，**id 不变**，线程勾选不断 |
| 跨 global↔sites 移动 | **NO-GO** — F-I-8 仍禁改 site/type |
| AI 给文件夹写说明 | **GO as 草稿** — 手点「建议说明」出草稿，用户保存才写 `_folder.md`（F-S-7 草稿制） |
| AI 自动归档新文档 / 导入时批量打说明 | **NO-GO** |
| 文件夹说明参与匹配 | **GO** — 路径段 + 祖先链**已保存**说明进 query bag；未保存草稿不进 |
| overlay / summoner 获得文件夹或 move 能力 | **NO-GO** — 六条新动词全部 summoner 拒绝 |
| 复用线程 `topic_folder` 字段 | **NO-GO** — 话题夹标签，非实体；名字都不共享 |

**产品句：**

> 用户可以在知识库里建多级文件夹（最多 3 级），把文档归进去，并给文件夹写一句「这里放的是什么」；AI 匹配知识时参考用户的组织方式和已保存的说明；磁盘上的目录结构与面板一致，可被 Obsidian 直接读。

---

## 1. 现状证据（已逐条核对，行号为 2026-09-02 快照）

知识库今天是**两个扁桶**：`knowledge/global/` 与 `knowledge/sites/`，所有文档平铺在桶根。

1. **`importKnowledge` 只写扁桶**：`targetDir = knowledgeDir/{global,sites}`，文件落 `<stem>.md`，无子目录概念（`companion/src/skills/skill-engine.ts:1585-1612`）。
2. **`import_directory` 拍平目录树**：用 vault 相对路径当 `nameOverride` 仅为防撞名分配不同 stem，**文件仍全部落在桶根**（`companion/src/message-router.ts:2865-2872`）。总量上限 `MAX_FILES = 200`（`companion/src/message-router.ts:2818`）。
3. **`loadFromDir` 非递归**：子目录只按技能包形态认 `SKILL.md`，知识 `.md` 只读当前一层（`companion/src/skills/skill-engine.ts:335-424`）。#274 若只建子目录不改 loader，面板会「看不见文件」。
4. **`listStemSet` 只看一层且把目录名当 stem**：`readdirSync` 单层遍历，`isDirectory()` 的条目名也进 taken set（`companion/src/skills/doc-identity.ts:109-122`）。一旦出现 `global/竞品/`，目录名「竞品」会污染 id 分配；`collectTakenStems` 正是逐桶根调它（`companion/src/skills/skill-engine.ts:295-304`）。
5. **磁盘指纹已是递归的**：`computeDiskFingerprint` walk 深度 ≤6 层、按 mtime+size 记账（`companion/src/skills/skill-engine.ts:199-215`）——**保持不动**，只需保证 `_folder.md` 纳入记账。
6. **UI 筛选 bag 不含 tags**：`filteredDocs` 只拼 `[title, name, description, site]`（`chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx:356-362`）；分组只按 site（`groupKnowledgeBySite`，同文件 :366、:831 起）。筛选「退款」命中不了 tag，是现状缺口。
7. **线程侧已有 `topic_folder` 字段**（话题夹标签，非实体，`companion/src/threads/thread-manager.ts:126`；语义见 `companion/tests/knowledge-active-ids.test.ts:106`）。**禁止**复用当知识文件夹。

**主要工程风险（两路一致）**：磁盘目录 = SoT 会撞上非递归 loader 与单层 stem set；**文档 id 稳定性是第一返工面**——id 语义是文件名派生的，移动不能弄断线程 `active_knowledge_ids` 的勾选引用，必须第一期做对，否则后续 #273 的索引也会跟着 id 语义返工。

---

## 2. 存储模型：文件夹 = 目录，磁盘为 SoT

### 2.1 布局

```text
~/.cmspark-agent/knowledge/global/<folder...>/<stem>.md
~/.cmspark-agent/knowledge/global/<folder...>/_folder.md
同理 sites/<site>/<folder...>/...
```

- 桶内最多 **3 级**用户目录；深度 cap 3，单层 50 项，总文档仍 200（与 `import_directory` `MAX_FILES` 对齐）。
- 存量扁桶文档 `folder=""`，**不迁移、不回填**（边界）。
- Pack 安装的知识仍进桶根；本票不扩 pack schema。
- 不跟随 symlink / junction；Windows 保留名、NFC、`0o600` 沿用 F-I-7。

### 2.2 `_folder.md`（每文件夹可选一个）

```yaml
---
type: knowledge_folder   # 标记位：不进 listKnowledge 文档列表、不进注入
title: 竞品
description: ""          # ≤500 字；用户保存前只是草稿
---
```

- `_folder.md` **不是**一篇知识：`isKnowledgeDoc` 必须排除 `type: knowledge_folder`；不进 listKnowledge、不进注入、不进 related。
- 文档 frontmatter 的 `folder` **不当独立真相**：loader 从 `source_file` 相对桶根推导 `folder`；若有人手工写了 `folder:`，refresh 时以磁盘路径为准（回写或忽略，防漂移）。搬家走专门动词，**不经** `allowlistKnowledgeFrontmatter`。
- `listKnowledge` 增一个字段：`folder?: string`（相对桶根的 posix 路径；`""` 或缺省 = 桶根；如 `"竞品/2025"`）。仍无 `source_file`（F-I-10）。

### 2.3 文档 id 稳定（第一返工面）

- 文档 `id` 与路径解耦：**移动 = rename 路径，不换 id**（F-I-1）；线程 `active_knowledge_ids` 勾选引用按 id 解析，移动后不断。
- 旧文档无独立 id 的，保存/移动时补写 `id` frontmatter；无 id 时 filename 兜底 + 冲突检测（见 §6）。
- `knowledge.move` **不得**走 `importKnowledge` / `allocateDocIdentity`（那会换 id，钉住的勾选悬空）——同 F-I-1 对 update 的禁令。

---

## 3. loader 改造清单（实现地雷，逐条有测试）

1. **知识专用递归 loader**：知识树走独立递归扫描，**不复用** `loadFromDir` 的 `SKILL.md` 技能包分支——否则 `knowledge/global/foo/SKILL.md` 会被当成技能混进 `skill.list`。
2. **`listStemSet` / `collectTakenStems` 递归到文件 stem**：只收 `.md` 文件名，**目录名不再进 taken set**；`_folder.md` 不占文档 stem。
3. **指纹**：`computeDiskFingerprint` 递归 depth≤6 保持不变；`_folder.md` 的新建/修改/删除必须让 fingerprint 变化（触发 refresh）。
4. **深度 >3 的处理**：扫描允许更深以便识别；`import_directory` 遇到第 4 级**拍扁到第 3 级**，在 result 里计数 `flattenedDepth`，**不静默丢文件**；面板侧对超深结构同样拍扁渲染到第 3 级。
5. 安全形状不变：跳过 dotfile/dot-dir、不跟随 symlink（Dirent type）、单文件 6MiB、总量 200（沿用 import_directory 现有 guard）。

---

## 4. WS 动词（六条，皆 `user_gesture: true`，summoner 拒绝，跨桶拒绝）

```text
knowledge.folder_create  { bucket: "global"|"sites", path, description?, user_gesture: true }
knowledge.folder_rename  { bucket, path, new_path, user_gesture: true }
knowledge.folder_update  { bucket, path, description, user_gesture: true }   // 保存用户说明 → _folder.md
knowledge.folder_suggest { bucket, path, user_gesture: true }                // LLM 草稿，不落盘
knowledge.folder_delete  { bucket, path, mode: "reject_if_docs"|"move_to_parent", user_gesture: true }
knowledge.move           { id, folder, user_gesture: true }                  // 同桶内；id 不变
```

- 解析键：文件夹动词的 `path` 为相对桶根的 posix 路径，服务端拒绝 `..` / 绝对路径 / 跨桶前缀（F-I-7 同款忽略客户端裸路径语义，只允许桶内相对路径）。
- `folder_delete` 默认 `reject_if_docs`：非空文件夹拒绝删除；`move_to_parent` 把成员上提一级再删空目录与 `_folder.md`。
- `folder_suggest` 输入仅成员 title+description（≤30 篇 × 一行），**不灌全文**；返回草稿，不写盘。成员 description 先过 redact（防把子文档里的密钥送进 LLM）。
- 全部六条：validate + router 双层要求 `user_gesture: true`（缺 → 400）；summoner / overlay / `SUMMONER_WEB_DISPATCH_ALLOW` / inbound MCP / `getToolDefinitions` **都没有**这些动词，router 对 summoner extra-deny（同 import/delete 现状形态）。
- 跨桶：`move` 目标 folder 与文档当前桶不同 → 拒绝（F-I-8）；folder 动词 bucket 参数限定 `"global"|"sites"`。

---

## 5. 匹配参与（与 #273 Wave A 的唯一接口）

打分 `bag(doc)` 追加两个字段：

1. **路径段**：`竞品/2025` → `竞品 2025` 进词袋。
2. **祖先链已保存说明**：文档所有祖先文件夹的 `_folder.md` `description`（**仅已保存的**；未保存的 AI 草稿不进——F-S-7 草稿制）。

规则：

- **文件夹永远压过派生聚类**：文件夹是用户写的监督信号，是两段检索的粗索引；派生簇只在**无命中夹**时作降级粗索引；规模边界（<20 / >200 / 全离群 → 不参与）以 #273 §6.2 常数表为准；禁止与文件夹双重收窄候选池。**「无夹」的判定 = 本轮 query 无命中夹**（s(F) 命中谓词见 #273 §6.5）；库里有夹但本轮未命中时，走派生组，不算「有夹」。
- 知识路径**禁止** LLM rerank（成本+延迟，照抄 `matchSkills` 也不行）。
- `_folder.md` 本身不进注入、不进 related；进 bag 的只是它的 description 文本。
- UI 筛选 bag 同步补上 `tags` 与 `folder`（修现状缺口，见 §6 UX）。

---

## 6. UX（320px，无新一级入口）

1. KnowledgeSubPanel 内加视图切换 **`站点 | 文件夹`**，**默认文件夹**（用户要的组织；站点仍是 auto 加权的来源，不是展示维度）。不新底栏 tab（F-UX-SHEET-1）。
2. **3 级手风琴**，不要缩成树控件。文件夹行：文件夹名 + 一句说明（灰字，空则「添加说明」）。
3. 文档行仍可点进现有阅读器（CRUD spec 的 sheet 不变）。
4. **移动：菜单「移到…」是验收必须项**；拖拽可做但非验收必须。
5. 「建议说明」：文件夹菜单手点 → AI 草稿进输入框 → 用户编辑保存才写 `_folder.md`；文件夹内容指纹变化后说明标「可能过期」，重跑仍由用户发起。**无后台批量**。
6. 筛选 bag 补 `tags` + `folder`：筛选「退款」能命中 tag 或文件夹名。
7. 导入确认句改诚实。现状文案（`KnowledgeSubPanel.tsx:349`）只说「每篇不单独预览，最多 200 个文件」，没提拍平；新文案：

   > 将保留文件夹结构（最多 3 级，200 个文件）。每篇不单独解读。

8. Copy 禁令沿用 F-UX-NOUN-1：本切片用户可见文案**禁**「分类树 / 图谱 / 自动分类」；可用词：文件夹、移到、说明、建议说明、可能过期。

---

## 7. 失败降级

| 场景 | 行为 |
|------|------|
| `_folder.md` 损坏 / frontmatter 解析失败 | 跳过该文件夹元数据，按磁盘路径照常渲染树；文件夹显示为无说明，**不阻塞**文档加载 |
| 移动（rename）失败 | 移动走**临时文件 + rename 原子化**；任一步失败整体回滚，磁盘保持移动前状态，UI 报错不假装成功 |
| 旧文档无 `id` | filename 兜底当 id；兜底时做**冲突检测**（跨目录同名不得静默合并），冲突则保存/移动时补写独立 `id` |
| 深度 >3 导入 | 拍扁到第 3 级 + result `flattenedDepth` 计数；不丢文件、不报错中断 |
| 超 cap（单层 50 / 总 200 / 说明 >500 字） | 创建/导入拒绝或截断，UI 提示，不静默 |

---

## 8. 锁对齐（逐条）

- **F-I-1** `move` 不换 id、不走 `importKnowledge`/`allocateDocIdentity`；`active_knowledge_ids` 不悬空。
- **F-I-2** 禁止新 SoT：无分类表、无 `relations:`、无系统预置树；文件夹 = 磁盘目录 + `_folder.md`，落在既有 markdown SoT 内。
- **F-I-7** 路径约束不变：忽略客户端裸路径、只接受桶内相对路径；`writeRestrictedFile`（0o600，拒 symlink）；NFC；Windows 保留名；不跟随 junction。
- **F-I-8** v1 不可改 `site`/`type`：跨 global↔sites 移动拒绝；folder 动词不改文档桶归属。
- **F-I-10** `listKnowledge` 只增 `folder?: string` 一个字段；仍禁止 `source_file` / `entries` / `dir` / `resources` / `body`。
- **F-S-7** 草稿制延伸到文件夹：AI 建议说明保存前是草稿，不进匹配 bag、不进注入、不落盘；保存 = 用户确认。
- **F-E-3** 本季仍无知识图谱 / 分类树 / 双链；文件夹是用户文件组织，不是系统本体；UI/文案零「分类树/图谱」。
- **F-UX-SHEET-1** 不新底栏 tab、不新一级入口；复用 KnowledgeSubPanel 与现有阅读器 sheet。

另：**线程 `topic_folder` 字段不复用**——协议字段分开，名字都不共享。

---

## 9. NEVER / 不在本票

- 分类表 / 系统预置分类法 / 图谱 / 双链 / embedding / 持久边。
- 虚拟分组顶替真目录；`_folder.md` 当一篇知识进列表或注入。
- 跨桶移动；改 site/type；经 `allowlistKnowledgeFrontmatter` 写 `folder` 搬家。
- AI 自动归档新文档；导入时对每个文件夹自动打 LLM 说明；后台批量重跑「建议说明」。
- overlay / summoner / MCP 获得 folder_* 或 move；overlay Allow/Deny 任何扩张。
- 拖拽作为验收必须项；迁移/回填存量文档的 `folder`；扩 pack schema；复用 `topic_folder`。

---

## 10. 验收标准（以 grok 10 条为准；★ = 最关键）

1. ★ **id 稳定性集成测试**：创建 `global/竞品/2025/`，移入一篇，刷新后 list 的 `folder === "竞品/2025"`、磁盘路径一致、`id` 不变，**线程勾选引用不断**（勾选后移动文档，勾选仍在）。本条是全案最关键验收。
2. `_folder.md` 说明保存前：打分 bag 不含该说明；保存后：query 命中说明文字可抬高该夹文档。
3. `import_directory` 选带两级子目录的夹：面板树与磁盘相对路径一致（≤3 级）；不再全部堆在桶根。
4. 嵌套 `SKILL.md`（如 `knowledge/global/foo/SKILL.md`）不出现在 `skill.list`。
5. `_folder.md` 不出现在知识文档列表、不进注入。
6. summoner 打 `knowledge.move` / `folder_*` 全部拒绝。
7. 无 `user_gesture` 的 move / folder 写操作 → 400。
8. 201 个文件的目录导入：仍 `truncated`，不超过 200 篇入库。
9. 4 级目录导入：第 4 级被拍到第 3 级，result 里 `flattenedDepth` 可见，不丢文件。
10. 筛选「退款」能命中 tags 或文件夹名（修现状筛选 bag 缺口）。

---

## 11. 实现落点

| 区域 | 文件 |
|------|------|
| 知识递归 loader / 指纹 / `_folder.md` 解析 | `companion/src/skills/skill-engine.ts`（新递归扫描，不动 `loadFromDir` 技能分支；`computeDiskFingerprint` 保持） |
| stem set 递归化 | `companion/src/skills/doc-identity.ts` `listStemSet` + `skill-engine.ts` `collectTakenStems` |
| 移动 / 文件夹写盘 | `skill-engine.ts`（move = 临时 + rename 原子化；`_folder.md` 经 `writeRestrictedFile`） |
| 六条 WS 动词 + 手势 + summoner 拒绝 | `companion/src/message-router.ts` · `ws/validate.ts` · `ws/summoner-acl.ts` |
| `import_directory` 保树 + `flattenedDepth` | `companion/src/message-router.ts:2798-2910` 一段 |
| 匹配 bag 两字段 | #273 Wave A 打分处（唯一接口） |
| UI 视图切换 / 手风琴 / 移动菜单 / 建议说明 / 筛选 bag / 导入确认句 | `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx` |
| 测试 | `skill-engine.test.ts`（递归 loader / 嵌套 SKILL.md / 指纹）· `doc-identity` 测试（目录名不占 stem）· router/validate 单测（六动词手势 + summoner 拒绝）· **id 稳定性集成测试**（勾选 → move → 勾选不断）· 扩展侧筛选 bag 测试 |

---

## 12. 修订历史

- 2026-09-02：grok + claude 双路独立对抗设计收敛（`.omx/artifacts/design/`），Issue-first（#274）后落本 spec，状态 PROPOSED 待实现评审。
