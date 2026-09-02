# Knowledge Retrieval Scoring — 知识检索对齐技能 TF-IDF（query 打分 + top-k + 跨文档预算）

> **日期**: 2026-09-02  
> **状态**: **PROPOSED · design dual-converged**（grok + claude 独立对抗设计已收敛，设计产物 [.omx/artifacts/design/](../../.omx/artifacts/design/)，待实现评审）  
> **方法**: 双路独立对抗设计（grok · claude）→ 收敛  
> **触发**: #273 原案（聚类视图 + 簇路由 + 重开 F-E-3/F-E-10/C1）被双路评审一致否决为「诊断对了、药方开贵了」；本季只做 **Wave A**，聚类浏览降为 **Wave B 默认冻结**  
> **前序 SoT（不得削弱）**: [Knowledge Honesty](./2026-08-25-daily-assistant-knowledge-honesty-design.md) · [Knowledge CRUD Honesty](./2026-08-26-knowledge-crud-honesty-design.md)  
> **GitHub:** [#273](https://github.com/nehcuh/cmspark/issues/273)（票已被对抗设计改写，本票只覆盖 Wave A）

```text
Surface:      系统提示注入路径（skill-engine buildSystemPromptWithSources，
              由 adapter 调用：companion/src/llm/adapter.ts:554）
L2-classes:   (none)
Compose:      检索编排变化（打分 + 预算）；复用技能侧已有 TF-IDF 机器，无新 SoT
Autonomy:     中（自动选文注入；用户模式开关可关，预算是安全网）
Trust:        纯本地计算，无新外发；知识注入仍 sanitize + untrusted wrap（F-S-1/2）
Channel:      既有 WS；community | enterprise unchanged
```

**Blast tier**: **T2** — 注入内容选择变化影响全对话；纯本地、可关、异常逐字节回退现行为。

---

## 0. 一句话裁决

| 问题 | 裁决 |
|------|------|
| auto 对知识不看当轮 message，all 无总字符预算 | **GO** 修 — 这是本票的真病（见 §1 证据） |
| 把技能侧 TF-IDF 打分搬到知识检索 + top-k + 跨文档硬预算 | **GO** — 零新依赖、零新 SoT、零锁重开 |
| 聚类视图 / 簇路由（#273 原案主体） | **NO-GO 本季** — 降为 Wave B，默认冻结，解冻条件见 §6 |
| 重开 F-E-3 / F-E-10 / 锁 C1 | **NO-GO** — 本票全程不碰；ADR 只写一条记录性质条目（§7） |
| 对知识做 LLM rerank / embedding / graph DB / 持久簇 | **NO-GO** — 知识路径零 LLM 调用 |
| all 模式 UI 文案「注入全部知识索引」 | **GO** 改诚实 — 现状文案与实现不符 |

**产品句（Wave A）：**

> 知识多起来以后，AI 按这轮问题挑选相关知识注入，已钉的优先、当前站点加权；注入总量有硬上限，超了如实可见。

---

## 1. 现状证据（双路评审 inspected，行号以本 spec 核对为准）

1. **auto 不看 message**：`companion/src/skills/skill-engine.ts:685-711` — `resolveKnowledgeIdsForThread(threadId, mode, hostname)` 的签名里**根本没有 message 参数**；auto 分支（707-710 行）只算 `activeKnowledge ∪ getBySite(hostname)`。对照技能侧 `resolveSkillIdsForThread`（同文件 625-654 行）有 `message` 且在 auto 中调用 `matchSkills(message)`。
2. **`searchKnowledge` 生产零调用**：`skill-engine.ts:1723` 定义了跨文档 `searchKnowledge(knowledgeNames, query, topK)`，已接 `sanitizeKnowledgeContent`；但 `companion/src` 内**无任何调用点**，唯一调用在测试（`companion/tests/skill-engine.test.ts:705`）。这是死路径，不是「已有 RAG」。
3. **all 无总预算**：all 分支（701-705 行）返回全库 id；注入侧 `getKnowledgeSummary`（`skill-engine.ts:822-847`）对每篇各自截断到 2000 字符（842 行 `MAX_CHARS = 2000`），**没有跨文档总量上限** — 30 篇 all 可灌入 ~60000 字符。唯一用到 query 的地方是**已入选文档内部**的块级 top-3（826-832 行，经 `file-chunker.ts:100-114` 的 `searchChunks`）。
4. **UI 文案不实**：`chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx:379` —「全选：注入全部知识索引，无需（也无法）单独勾选。」实现灌的是摘要/截断正文，不是「索引」；且「全部」在无总预算下等于无上限。
5. **2026-06 锦标赛债到期**：`docs/archive/2026-07/proposals/knowledge-mgmt-proposal/final-design.md:48-56` — 方案对比矩阵把「TF-IDF + 倒排索引」放进折中方案并输掉（保守方案胜出），矩阵明确写下折中/保守各自的「Context 效率：风险（auto 知识数膨胀）」。今天的病灶就是当时明知风险仍延期的部分。

**结论**：真实病是「选择器不像技能那样打分 + 无跨文档预算」。聚类/图谱是贵解：N≤200 时对元数据全量打分是毫秒级，聚类对 (a) 相关性排序、(b) 总预算既不充分也不必要。

---

## 2. Wave A 检索链路（替换现状选择器）

### 2.1 候选池：三模式语义

```text
manual → active_knowledge_ids（用户勾选，永远全进，尊重用户钉）
auto   → 全库为打分候选池；hostname 命中加权（+0.15，是加权不是并集硬灌）
all    → 全库为打分候选池，无 site 加权
         语义改为「全库可检索」，不是「全库灌进上下文」
```

`resolveKnowledgeIdsForThread` 增加 `query: string` 参数（即当轮 user message，由 `buildSystemPromptWithSources` 透传）；auto/all 返回**有序 top-k**，不是全量 id 列表。

### 2.2 打分

```text
bag(doc) = title + description + tags[≤8]（+ 文件夹路径/说明字段，#274 落地后并入）
score    = cosine(tfidf(query), tfidf(bag))
auto     → score + SITE_BOOST（0.15，加权，不是硬过滤也不是硬灌）
```

复用技能侧现成的 `tokenize / tfidfVec / idfFromDocs / cosineSimilarity`（`skill-engine.ts:578-654` 的 `matchSkills` 同套机器）。**禁止**照搬 `matchSkills` 低分走 LLM rerank 的双轨设计 — 知识匹配必须纯本地、可关、每轮零 LLM 调用。IDF 随 `refresh()` 重建（可选进程内缓存；≤200 篇全量 TF 与 `matchSkills` 同阶，毫秒级）。

### 2.3 选择与注入

```text
选择:
  1. 全部 pinned 先入选（manual/auto 勾选永远优先于打分）
  2. 其余按 score 降序，直到 top-k（auto=5 / all=8）或预算
  3. score = 0 且非 pinned → 不注入
     （auto 终于可以「匹配不上就空」，而不是灌站点全套）

注入:
  每篇仍走现状 getKnowledgeSummary：小文档 ≤2000 字符，
  大文档有 query 时走 file-chunker searchChunks top-3 块（块级再裁）
  Σ 注入字符 ≤ KNOWLEDGE_INJECT_BUDGET_CHARS（8000，跨文档硬预算）
  填充顺序：先 pinned，再按分填满；超出即停，retrieved_sources 如实
```

`buildSystemPromptWithSources` 增加跨文档字符预算记账；截断发生在哪一篇，`retrieved_sources` 就标到哪一篇，「本轮附带」芯片如实可见。

### 2.4 常数表（可测、可调，不要藏）

| 名 | 值 | 作用 |
|---|---|---|
| `KNOWLEDGE_DOC_TOPK_AUTO` | 5 | auto 模式文档级 top-k |
| `KNOWLEDGE_DOC_TOPK_ALL` | 8 | all 模式文档级 top-k |
| `KNOWLEDGE_INJECT_BUDGET_CHARS` | 8000 | 跨文档注入总字符硬预算 |
| `KNOWLEDGE_SCORE_MIN` | ≈0.10 | 注入阈值（与技能侧 `matchSkills` 的 0.1 同量级） |
| `KNOWLEDGE_SITE_BOOST` | 0.15 | auto 模式当前站点加权（非硬过滤） |

常数集中定义、可配可调，禁止散进调用点魔术数。

### 2.5 降级路径

- **打分模块任何异常** → 整段 no-op，**逐字节回退现行为**（仅日志），不得半新半旧。
- **无 query（空消息）** → 不打分；auto 退化为 `pinned ∪ site`，但每篇**只注入 `description`（≤500）**，不灌 2000 字正文。
- **打分全 0** → 只注入 pinned。
- **「智能匹配」开关关闭（默认开）** → 回到今天的 `hostname ∪ 勾选` 选择，但**仍执行 8000 字预算** — 预算是安全网，不是智能，开关不得绕过预算。

---

## 3. UI 文案改诚实（三句）

`KnowledgeSubPanel.tsx:375-380` 的 `modeHint` 改为：

- 自动：「按这轮问题选相关知识；已钉的优先。当前站点加权。」
- 全选：「在全库里检索，仍受条数/长度上限。」
- 按需：「只注入勾选的；超预算时从末尾截断并在芯片上可见。」

空命中：不注入知识块、不装相关；**不得用站点兜底把预算打满** — 那是今天的病。「本轮附带」芯片复用现有 honest shrink 模式提示「按相关性注入 N/M 篇」。本切片文案遵守 F-UX-NOUN-1：不出现「图谱/双链/簇/第二大脑」。

---

## 4. 数据模型与实现落点

**数据模型**：不改文档 SoT，不改 frontmatter schema，无新持久化。可选进程内 IDF 缓存随 `refresh()` 重建。

| 区域 | 文件 |
|------|------|
| 检索编排 | `companion/src/skills/skill-engine.ts`（`resolveKnowledgeIdsForThread` 加 `query` 与排序；`getKnowledgeSummary` 保持块级 top-3；预算记账在 `buildSystemPromptWithSources`） |
| 打分机器 | 复用同文件 `tokenize / tfidfVec / idfFromDocs / cosineSimilarity`（578-654） |
| 块级再裁 | `companion/src/file-chunker.ts` `searchChunks`（不改） |
| 调用点 | `companion/src/llm/adapter.ts:554`（`buildSystemPromptWithSources` 已透传 message，签名对齐即可） |
| UI | `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx`（modeHint 三句 + 注入 N/M 提示） |
| 测试 | `companion/tests/skill-engine.test.ts` + 新增打分/预算/降级用例 |

`searchKnowledge`（`skill-engine.ts:1723`）可作跨文档块排序的实现起点，但**不能**替代文档级 top-k；是否顺手接线由实现 PR 决定，不是本 spec 的验收项。

---

## 5. 锁定 / NEVER（Wave A）

- **不重开** F-E-3 / F-E-10 / 锁 C1。本地 TF 打分不是 embedding；本票用不到任何一把锁的豁免。
- 不写分类表、无持久 related 边、无 `cluster_id` frontmatter / `.clusters.json`（F-I-2）。
- 注入路径仍 `sanitizeKnowledgeContent` + untrusted wrap（F-S-1/2），排序变化不动信任边界。
- 知识路径**零 LLM**：禁 `llmRerank` / `llmExtract` 进检索回路（每轮聊天多一次调用的成本和延迟都脏）。
- 无 embedding、无 graph DB、无持久簇、无 `knowledge.graph*`、无新 runtime、无 `query_knowledge` tool（Honesty 已明确不在本季）。
- overlay Allow/Deny 不涨；无新 WS 动词；无第二只扩展。
- 不改 `knowledge.get` 语义：磁盘原文给编辑器，不当模型上下文（前序 F-S-1/2 保持）。

---

## 6. Wave B 冻结条款（不在本票实现）

派生主题分组浏览（纯本地 TF 凝聚聚类、标签取簇内高频 tag、派生可丢）。**默认冻结**，不是排期。

- **解冻条件**：Wave A + #274（用户文件夹）上线后，>80 文档仍实测出现「找不到库的结构」。未达标则永远不做。
- **做时只需 F-E-3 窄豁免**：「派生的主题分组，非本体、非图谱 UI、非持久边」；先写 ADR 把 F-E-3 收成「无图谱 UI / 无分类本体 / 无双链」。**F-E-10 / C1 永不重开**。
- **n<20 不显示分组**（小库聚类不稳定）。
- **纠正 = 移文件夹**（#274 的 `knowledge.move`）；**禁止**簇纠正持久化、禁止簇当检索 SoT 压过用户文件夹。
- **禁 LLM 起名**：簇标签取簇内最高频 tags，否则标题截断；list 路径无外发。
- 检索默认仍用 Wave A 扁平打分；仅 n>200 且文件夹覆盖率低时才考虑两段路由，且须过诚实门（同评测集上不优于扁平打分则默认关闭）。

---

## 7. ADR（记录性质，一条）

只需一条 ADR：「**知识检索对齐技能 TF-IDF，仍无 embedding**」。这是对既有禁令的**记录**，不是重开禁令；不触碰 F-E-3 / F-E-10 / C1 的文本。

---

## 8. 验收标准（Wave A，7 条）

1. 库内 12 篇、其中 2 篇标题/说明含「退款政策」，query=「退款怎么处理」：auto 注入这 2 篇（或含它们的 top-5），**不**注入明显无关的站点文档。
2. all + 30 篇 × 2000 字：实际注入字符 ≤ 8000 + 包装开销；`retrieved_sources.length` ≤ 8。
3. manual 勾选 10 篇：优先 10 篇，但总字符仍 ≤ 预算；截断可在 `retrieved_sources` 上看到。
4. 关闭 LLM：知识路径不得调用 `llmRerank` / `llmExtract`（断言零调用）。
5. 200 篇 × 短元数据打分：单次 resolve < 50ms（本地基准，与 `matchSkills` 同量级）。
6. UI 不再出现「注入全部知识索引」（copy 扫描）。
7. 无 graph DB、无 embedding 依赖、无 `knowledge.graph*`、无新 runtime。

**补充评测思路（claude 设计稿 273a，支撑第 1/5 条，非独立验收项）**：建 20 query × N 文档离线评测集，注入 precision@k 对比现 auto 基线（基线实测入票，目标如 p@5 ≥ 0.6）；打分模块抛错时输出与现版逐字节一致（对应 §2.5 降级）。

---

## 9. 明确不在本票 / 本季

聚类视图、簇路由、知识地图注入、embedding、graph DB、持久簇、`knowledge.graph*`、`query_knowledge` tool、图谱/双链 UI、重开 F-E-3/F-E-10/C1、overlay 知识新动词、目录结构改造（那是 #274）、元数据补全（那是 #272）。

---

## 10. 修订历史

- 2026-09-02：双路独立对抗设计（grok · claude）收敛成稿；#273 已由原案改写为 Wave A only，Wave B 冻结。
