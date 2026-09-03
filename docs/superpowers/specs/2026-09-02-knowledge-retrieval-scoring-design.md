# Knowledge Retrieval Scoring — 知识检索对齐技能 TF-IDF（query 打分 + top-k + 跨文档预算）

> **日期**: 2026-09-02  
> **状态**: **LOCKED · design dual both AWN**（gate5 r7 双路 PASS_WITH_NITS，nits 已全折入，设计产物 [.omx/artifacts/design/](../../.omx/artifacts/design/)；实现另开 PR）  
> **方法**: 双路独立对抗设计（grok · claude）→ 收敛  
> **Wave B 解冻**: 用户 2026-09-02 拍板（原话：「图谱/聚类意义很大，可以给用户体感上很直观的感受，我要求这个必须有」），**推翻双路评审的 Wave B 冻结建议**；Wave B 升级为本季交付范围（§6），F-E-3 窄豁免随之启用（§7），F-E-10 / 锁 C1 仍不重开  
> **触发**: #273 原案（聚类视图 + 簇路由 + 重开 F-E-3/F-E-10/C1）被双路评审改写为「Wave A 先行、Wave B 冻结」；用户随后拍板解冻 Wave B  
> **前序 SoT（不得削弱）**: [Knowledge Honesty](./2026-08-25-daily-assistant-knowledge-honesty-design.md) · [Knowledge CRUD Honesty](./2026-08-26-knowledge-crud-honesty-design.md)  
> **GitHub:** [#273](https://github.com/nehcuh/cmspark/issues/273)（Wave A + Wave B 均在票内；Wave B 节已由冻结改为交付范围）

```text
Surface:      系统提示注入路径（skill-engine buildSystemPromptWithSources，
              由 adapter 调用：companion/src/llm/adapter.ts:554）
              + 知识面板「分布」视图（KnowledgeSubPanel，Wave B）
L2-classes:   (none)
Compose:      检索编排变化（打分 + 预算 → Wave B 可选两段式簇路由）；
              复用技能侧已有 TF-IDF 机器；派生索引可重建，无新 SoT
Autonomy:     中（自动选文注入 + 自动分组影响展示；用户开关可关，预算是安全网）
Trust:        纯本地计算，无新网络外发；知识注入仍 sanitize + untrusted wrap（F-S-1/2）；
              Wave B 内容面增量：分组概览（分组名+标题）使全库衍生词进入注入通道——
              有界（≤2000 字符、计入 8000 总预算）、同走 sanitize + wrap（§6.5）
Channel:      既有 WS；community | enterprise unchanged
```

**Blast tier**: **T2** — 注入内容选择变化影响全对话；纯本地、可关、异常逐字节回退现行为。Wave B 新增分布视图，仍 T2：派生索引可重建、簇路由可关。

---

## 0. 一句话裁决

| 问题 | 裁决 |
|------|------|
| auto 对知识不看当轮 message，all 无总字符预算 | **GO** 修 — 这是本票的真病（见 §1 证据） |
| 把技能侧 TF-IDF 打分搬到知识检索 + top-k + 跨文档硬预算 | **GO** — 零新依赖、零新 SoT、零锁重开 |
| 聚类分布视图 / 簇路由（#273 原案主体） | **GO（带护栏）** — 用户 2026-09-02 拍板必须有，推翻双路评审的冻结建议；护栏见 §6（派生可丢、禁 LLM 起名、文件夹压过分组、诚实门） |
| 重开 F-E-3 | **窄豁免 GO** — 仅限「派生、可重建、非用户维护的分布视图」；ADR 与 Wave B 同 PR（§7） |
| 重开 F-E-10 / 锁 C1 | **NO-GO** — 无 embedding、无 graph DB（含 opt-in 也不开） |
| 对知识做 LLM rerank / embedding / graph DB / 持久簇 | **NO-GO** — 检索回路零 LLM 调用（唯一例外：§6.3 展示美化，默认关、不进检索、不落盘） |
| all 模式 UI 文案「注入全部知识索引」 | **GO** 改诚实 — 现状文案与实现不符 |

**产品句（Wave A）：**

> 知识多起来以后，AI 按这轮问题挑选相关知识注入，已钉的优先、当前站点加权；注入总量有硬上限，超了如实可见。

**产品句（Wave B，两句）：**

> 打开知识库就能直观看到知识自动分成了几堆、每堆是什么主题、有多少篇——这是拍板要的体感。
> 对话时的「按堆选文」只作用于 auto（manual 不打折勾选、all 硬排除），是可关的可选路由、默认关；过不了精度门就永远不开，视图照样交付。

---

## 1. 现状证据（双路评审 inspected，行号以本 spec 核对为准）

1. **auto 不看 message**：`companion/src/skills/skill-engine.ts:685-711` — `resolveKnowledgeIdsForThread(threadId, mode, hostname)` 的签名里**根本没有 message 参数**；auto 分支（707-710 行）只算 `activeKnowledge ∪ getBySite(hostname)`。对照技能侧 `resolveSkillIdsForThread`（同文件 625-654 行）有 `message` 且在 auto 中调用 `matchSkills(message)`。
2. **`searchKnowledge` 生产零调用**：`skill-engine.ts:1723` 定义了跨文档 `searchKnowledge(knowledgeNames, query, topK)`，已接 `sanitizeKnowledgeContent`；但 `companion/src` 内**无任何调用点**，唯一调用在测试（`companion/tests/skill-engine.test.ts:705`）。这是死路径，不是「已有 RAG」。
3. **all 无总预算**：all 分支（701-705 行）返回全库 id；注入侧 `getKnowledgeSummary`（`skill-engine.ts:822-847`）对每篇各自截断到 2000 字符（842 行 `MAX_CHARS = 2000`），**没有跨文档总量上限** — 30 篇 all 可灌入 ~60000 字符。唯一用到 query 的地方是**已入选文档内部**的块级 top-3（826-832 行，经 `file-chunker.ts:100-114` 的 `searchChunks`）。
4. **UI 文案不实**：`chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx:379` —「全选：注入全部知识索引，无需（也无法）单独勾选。」实现灌的是摘要/截断正文，不是「索引」；且「全部」在无总预算下等于无上限。
5. **2026-06 锦标赛债到期**：`docs/archive/2026-07/proposals/knowledge-mgmt-proposal/final-design.md:48-56` — 方案对比矩阵把「TF-IDF + 倒排索引」放进折中方案并输掉（保守方案胜出），矩阵明确写下折中/保守各自的「Context 效率：风险（auto 知识数膨胀）」。今天的病灶就是当时明知风险仍延期的部分。

**结论**：真实病是「选择器不像技能那样打分 + 无跨文档预算」。就**匹配精度**而言聚类是贵解：N≤200 时对元数据全量打分是毫秒级，聚类对 (a) 相关性排序、(b) 总预算既不充分也不必要 — 这一诊断不变，Wave A 仍是匹配侧的解法。但分布视图另有独立产品价值（用户对「库长什么样」的直观体感），用户 2026-09-02 拍板必须有，Wave B 因此解冻为交付范围（§6）。

---

## 2. Wave A 检索链路（替换现状选择器）

### 2.1 候选池：三模式语义

```text
manual → active_knowledge_ids（用户勾选，永远全进，尊重用户钉）
auto   → 全库为打分候选池；hostname 命中加权（+0.15，是加权不是并集硬灌）
all    → 全库为打分候选池，无 site 加权
         语义改为「全库可检索」，不是「全库灌进上下文」
```

`resolveKnowledgeIdsForThread` 增加 `query: string` 参数（即当轮 user message，由 `buildSystemPromptWithSources` 透传）；auto/all 返回**有序 top-k**，不是全量 id 列表。**resolve 仍返回 ≤k，但 ≤k 只约束非 pinned；pinned 全量返回**，路由 ON 的扩张不靠并集「救回」被截的 pinned（§6.5）。扩张表不在 resolve 里截 k，而在 `buildSystemPromptWithSources` 预算记账前展开（另名，如 `expandRoutedKnowledgeCandidates`）。

### 2.2 打分

```text
bag(doc) = title + description + tags[≤8]（+ 文件夹路径/说明字段，#274 落地后并入）
score    = cosine(tfidf(query), tfidf(bag))
auto     → score + SITE_BOOST（0.15，加权，不是硬过滤也不是硬灌）
```

复用技能侧现成的 `tokenize / tfidfVec / idfFromDocs / cosineSimilarity`（`skill-engine.ts:578-654` 的 `matchSkills` 同套机器）。**禁止**照搬 `matchSkills` 低分走 LLM rerank 的双轨设计 — 知识匹配必须纯本地、可关、每轮零 LLM 调用。IDF 随 `refresh()` 重建（可选进程内缓存；≤200 篇全量 TF 与 `matchSkills` 同阶，毫秒级）。**路由轮同基复用此全库 IDF 缓存，禁止语料级重算 IDF**（与 §6.2 反 IDF 漂移同因；§6.5 的 s(F) 谓词同基，跨轮稳定）。

### 2.3 选择与注入

```text
选择:
  1. 全部 pinned 先入选（manual/auto 勾选永远优先于打分）
  2. 其余按 score 降序，直到 top-k（auto=5 / all=8）或预算
  3. score < KNOWLEDGE_SCORE_MIN（0.10）且非 pinned → 不注入
     （auto 终于可以「匹配不上就空」，而不是灌站点全套）

注入:
  每篇仍走现状 getKnowledgeSummary：小文档 ≤2000 字符，
  大文档有 query 时走 file-chunker searchChunks top-3 块（块级再裁）
  Σ 注入字符 ≤ KNOWLEDGE_INJECT_BUDGET_CHARS（8000，跨文档硬预算）
  填充顺序：先 pinned，再按分填满；超出即停，retrieved_sources 如实
```

`buildSystemPromptWithSources` 增加跨文档字符预算记账；截断发生在哪一篇，`retrieved_sources` 就标到哪一篇，「本轮附带」芯片如实可见。阈值判定（`KNOWLEDGE_SCORE_MIN`、§6.5 的 s(F) 与第 2 组判据）一律看**未加 `SITE_BOOST` 的裸 cosine**；`SITE_BOOST` 只改排序、不改阈值。文档级分数并列取 `id` 字典序最小（并入 AC-8）。

### 2.4 常数表（可测、可调，不要藏）

| 名 | 值 | 作用 |
|---|---|---|
| `KNOWLEDGE_DOC_TOPK_AUTO` | 5 | auto 模式文档级 top-k |
| `KNOWLEDGE_DOC_TOPK_ALL` | 8 | all 模式文档级 top-k |
| `KNOWLEDGE_INJECT_BUDGET_CHARS` | 8000 | 跨文档注入总字符硬预算 |
| `KNOWLEDGE_SCORE_MIN` | 0.10 | 注入阈值（精确值，与技能侧 `matchSkills` 的 0.1 对齐；簇路由命中谓词复用此值，§6.5） |
| `KNOWLEDGE_SITE_BOOST` | 0.15 | auto 模式当前站点加权（非硬过滤） |

常数集中定义、可配可调，禁止散进调用点魔术数。

### 2.5 降级路径

- **打分模块任何异常** → 整段 no-op，**逐字节回退现行为**（仅日志），不得半新半旧。
- **无 query（空消息）** → 不打分；auto 退化为 `pinned ∪ site`，但每篇**只注入 `description`（≤500）**，不灌 2000 字正文。
- **打分全 0** → 只注入 pinned。
- **「智能匹配」开关关闭（默认开）** → 回到今天的 `hostname ∪ 勾选` 选择，但**仍执行 8000 字预算** — 预算是安全网，不是智能，开关不得绕过预算。
- **（Wave B）聚类/路由层任何运行时异常** → 降级 Wave A 扁平打分（§6.1）。「逐字节回退现行为」在 Wave B 合入后指的是 Wave A 行为，不是 Wave A 之前的行为。

---

## 3. UI 文案改诚实（三句）

`KnowledgeSubPanel.tsx:375-380` 的 `modeHint` 改为：

- 自动：「按这轮问题选相关知识；已钉的优先。当前站点加权。」
- 全选：「在全库里检索，仍受条数/长度上限。」
- 按需：「只注入勾选的；超预算时从末尾截断并在芯片上可见。」

空命中：不注入知识块、不装相关；**不得用站点兜底把预算打满** — 那是今天的病。「本轮附带」芯片在方案 A 下钉死口径：**N=|S_post|（实际注入篇数）、M=|S_pre|（预预算候选数）**；概览占用预算导致少灌正文时标注「含分组概览」（或等价），**不得**把预算挤占写成「按相关性」截断——`groupmap_omitted` 覆盖「没灌概览」，「灌了概览所以少灌正文」也要可识别（§8 AC-18）。本切片文案遵守 F-UX-NOUN-1：不出现「图谱/双链/簇/第二大脑」。按钮 tooltip 同步改：`KnowledgeSubPanel.tsx:396` 的 `title=`「注入所有知识索引」是同一谎话的另一处副本，与 modeHint 一起修、一起进 copy 扫描（§8 AC-6 / AC-16，含 tooltip/title/aria）。

---

## 4. 数据模型与实现落点

**数据模型**：不改文档 SoT，不改 frontmatter schema。**Wave A 无新持久化；Wave B 仅派生 cache**（`knowledge-index.json`，可丢可重建，§6.1）。可选进程内 IDF 缓存随 `refresh()` 重建。

| 区域 | 文件 |
|------|------|
| 检索编排 | `companion/src/skills/skill-engine.ts`（`resolveKnowledgeIdsForThread` 加 `query` 与排序、仍返回 ≤k；`getKnowledgeSummary` 保持块级 top-3；预算记账在 `buildSystemPromptWithSources`，路由 ON 的扩张表在其预算记账前展开、另名） |
| 打分机器 | 复用同文件 `tokenize / tfidfVec / idfFromDocs / cosineSimilarity`（578-654） |
| 块级再裁 | `companion/src/file-chunker.ts` `searchChunks`（不改） |
| 调用点 | `companion/src/llm/adapter.ts:554`（`buildSystemPromptWithSources` 已透传 message，签名对齐即可） |
| 派生索引 / 聚类（Wave B） | 新模块（如 `companion/src/skills/knowledge-clusters.ts`）：稀疏 TF 向量、average-link 凝聚、single-flight 防抖重建、`atomicWriteJSON` 落 `DATA_DIR/cache/`（§6.1/§6.2） |
| 分布通道（Wave B） | `companion/src/message-router/handlers/knowledge.ts:14-22`：`knowledge.list` 顶层挂派生 `distribution?`，summoner/overlay 剥掉，同 `attachRelatedTitles` 先例（§6.4） |
| UI | `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx`（modeHint 三句 + 按钮 `title=` + 注入 N/M 提示 + Wave B 分布过滤 chips 与诚实句） |
| 测试 | `companion/tests/skill-engine.test.ts` + 新增打分/预算/降级用例 |

`searchKnowledge`（`skill-engine.ts:1723`）可作跨文档块排序的实现起点，但**不能**替代文档级 top-k；是否顺手接线由实现 PR 决定，不是本 spec 的验收项。

---

## 5. 锁定 / NEVER（全票适用）

- **不重开** F-E-10 / 锁 C1；本地 TF 打分不是 embedding。F-E-3 仅启用 §6.8 的**窄豁免**（派生、可重建、非用户维护的分布视图），其余文本不碰。
- 不写分类表、无持久 related 边、无 `cluster_id` frontmatter / `.clusters.json`（F-I-2）。
- 注入路径仍 `sanitizeKnowledgeContent` + untrusted wrap（F-S-1/2），排序变化不动信任边界。
- 知识检索回路**零 LLM**：禁 `llmRerank` / `llmExtract` 进检索回路（每轮聊天多一次调用的成本和延迟都脏）。Wave B 簇标签的唯一例外：可选 `llmExtract` 美化仅作展示、默认关、不进检索回路（§6.3）。
- 无 embedding、无 graph DB、无持久簇、无 `knowledge.graph*`、无新 runtime、无 `query_knowledge` tool（Honesty 已明确不在本季）。
- overlay Allow/Deny 不涨；无新 WS 动词（分布走 `knowledge.list` 顶层派生字段 `distribution?`，summoner/overlay 剥掉，非新动词、非文档 SoT，§6.4）；无第二只扩展。
- 不改 `knowledge.get` 语义：磁盘原文给编辑器，不当模型上下文（前序 F-S-1/2 保持）。

---

## 6. Wave B — 聚类分布视图与簇路由（用户拍板，本季交付）

> 用户决策（2026-09-02，原话）：「图谱/聚类意义很大，可以给用户体感上很直观的感受，我要求这个必须有」。本节由冻结条款改为交付设计；双路评审的工程约束全部保留为护栏。内部术语可写「簇/聚类」；用户可见文案禁令见 §6.4。

### 6.1 派生索引

- 路径：`path.join(DATA_DIR, "cache", "knowledge-index.json")`（`DATA_DIR` = `~/.cmspark-agent/`，`companion/src/config.ts:19`），权限 0o600，写入必须 `atomicWriteJSON`（`companion/src/io.ts:16`）。**半截 / 损坏 JSON 按缺失处理**：解析失败不 throw、不阻塞注入，等同索引不存在。
- 内容：每 doc 的稀疏 TF 向量（title + description + tags + **首块**，「首块」= `file-chunker` 切出的第一块）。**纯派生、可重建、可丢**；SoT 仍是磁盘 `.md`（F-I-2 安全）。
- 重建触发 = WS 写路径（导入 / 保存 / 删除 / 移动）∪ `refreshIfStale()` 指纹变化 ∪ 文件缺失 ∪ JSON 损坏。手改 `.md` 经 `computeDiskFingerprint` 热加载已被 Wave A 打分吃到（`skill-engine.ts:199-250`），索引必须同触发——否则视图/路由一组、打分另一组，派生层漂移。
- 防抖窗口常数化（`KNOWLEDGE_INDEX_DEBOUNCE_MS`）；重建 **single-flight**：进行中再次触发合并为一次，不并发写（原子写兜底）。
- 聚类 / 路由层任何运行时异常 → 降级 Wave A 扁平打分（仅日志），同 §2.5 哲学。

### 6.2 聚类算法与常数表

算法参数全部钉死（可测、可调、不要藏，同 §2.4 原则）：

- **向量空间**：聚类用**纯 TF**（cosine），不用 TF-IDF。IDF 随库增删变化会让无关文档的分组一起漂移，直接违反确定性承诺；Wave A 打分侧仍用 TF-IDF 不变，两套向量各归各。
- **linkage**：average-link。
- **合并阈值**：`KNOWLEDGE_CLUSTER_MERGE_MIN`（cosine，见表）。
- **tie-break**：文档先按 `id` 字典序进距离矩阵；文档级合并平局取 `min(id_a, id_b)` 先并；**簇–簇合并**平局时簇键 = 成员 `id` 的 min，按簇键字典序先并。同一文档集 → 同一分组，跨索引重建与输入乱序均不变。
- 离群文档入「未分组」。
- 复杂度：朴素凝聚 O(N³) 时间（优先队列 O(N² log N)）、O(N²) 空间；N≤200 毫秒级，超 cap 诚实降级（见表）。

| 名 | 值 | 作用 |
|---|---|---|
| `KNOWLEDGE_CLUSTER_DOC_CAP` | 200 | 参与聚类的文档上限。超限：视图不渲染分组 chips，显示诚实文案「库超过 200 篇，未自动分组」；路由 no-op 回 Wave A |
| `KNOWLEDGE_CLUSTER_MIN_DOCS` | 20 | n<20：分布视图不渲染**且**簇路由 no-op 回 Wave A；全离群只剩「未分组」一枚芯片时同样不渲染（不假装结构） |
| `KNOWLEDGE_CLUSTER_MIN_SIZE` | 3 | 成组最小文档数；不足 3 篇的簇解散为「未分组」 |
| `KNOWLEDGE_CLUSTER_MERGE_MIN` | 0.25 | average-link 合并阈值（cosine over 纯 TF） |
| `KNOWLEDGE_INDEX_DEBOUNCE_MS` | 2000 | 索引重建防抖窗口（single-flight 合并） |
| `KNOWLEDGE_GROUPMAP_CHARS` | 2000 | 分组概览注入字符上限（**含 wrap 标记**，content+fence 都计入，与 AC-2 包装开销同口径），**计入** `KNOWLEDGE_INJECT_BUDGET_CHARS`（8000）总预算 |
| `KNOWLEDGE_ROUTE_FOLDER_BRANCH` | ~~false~~ → **true**（2026-09-03 开闸） | 夹分支出厂默认曾为 false；评测门 folder 栏 pass 后开闸（§6.6 / AC-14）。漂移扳机仍在：路由输入面任何改动 ⇒ 回 false 重证 |
| `KNOWLEDGE_ROUTE_GROUP_BRANCH` | ~~false~~ → **true**（2026-09-03 开闸） | 组分支同上：评测门 group 栏 pass 后开闸（§6.6 / AC-14），漂移扳机同左 |

### 6.3 簇标签

- 标签只从 **title + tags** 取（列表里已有的字段）：簇内共享高频 tags，否则共享标题词，再否则标题截断；**频次并列取字典序最小**（标签稳定性并入 AC-8）。**不取向量首块正文** — 面板 chrome 不得露出列表里从未出现的正文关键词。
- 标签过现成闸：`normalizeTag` / `SENSITIVE_TAG_RE`（`companion/src/threads/digest.ts:46-62`）+ `redactSecrets`（`companion/src/threads/distill.ts:24`；返回 `{text, hits}`，过闸须取 `.text`，不得把对象拼进字符串）。
- **禁止 LLM 起名**（list 路径零外发）。可选 `llmExtract` 美化仅作展示、默认关、可关；豁免写死——开着也**不进检索回路、不落盘、不改变豁免叙事**（分组仍是派生 TF 分组，美化只是换显示词）。

### 6.4 UI「分布」视图与通道

- 形态：列表上方的**过滤 chips**（分组名 + 计数，点击 = 过滤文档列表），**不是**与 #274「站点 | 文件夹」抢默认的第三个 mode；不新底栏 tab、不新一级入口（F-UX-SHEET-1）。这是**计算型分组列表**，不是用户维护的分类树。
- 面板强制一句诚实说明：「自动分组，不准就移到文件夹。」——没有这句，用户会把 chips 当分类树，正是豁免要划开的线。
- 通道：`knowledge.list` 响应**顶层**挂派生 `distribution?: { groups: [{ label, count, ids }] }`。**禁** per-doc `cluster_id`（不进文档 SoT，F-I-10 不膨胀）；**summoner 必剥，overlay 亦剥**（严于 `attachRelatedTitles` 先例——related 只剥 summoner，`companion/src/message-router/handlers/knowledge.ts:16`；分布两面都剥）。这不是新 WS 动词。
  - （Gate9 补充，2026-09-03）通道形状另含稳定 `key`（分组身份 = 成员 id min，带 `c:` 前缀；「未分组」保留键 `u:ungrouped`）与放行谓词 `session.surface === "panel"` 细节——**以 ADR-027 §3 为准**。
- 「未分组」chip：有 ≥1 个 ≥`KNOWLEDGE_CLUSTER_MIN_SIZE` 的真分组时，「未分组」可作为过滤 chip（否则那批文档从分布视图消失）；全离群只剩它一枚时不渲染（§6.2）。
- **#274 未落地前视图纯只读**（纠正通道尚不存在，「非用户维护」不等于「假装可纠正」）。
- 不渲染态：n<20 / 超 cap / 全离群，按 §6.2 表执行，路由同步 no-op。
- 禁词：用户可见文案并入 F-UX-NOUN-1 全表（图谱、知识图谱、双链、相关网络、第二大脑、节点/边…）+「分类树 / 自动分类 / 簇 / 聚类 / 知识地图」；只用「分布 / 分组」。内部术语「知识地图」一律改称「**分组概览**」，且任何禁词不得上 UI（含 tooltip/title/aria）。

### 6.5 簇路由（渐进匹配的自动版）

候选池代数（规范公式，实现照此，不要再写形容词）：

```text
Wave A 入选集 = §2.3 的输出（pinned ∪ 打分 top-k），不是 §2.1 的全库语料。
禁止把 §2.1「全库为打分候选池」代入本公式。

簇路由只作用于 auto/all（all 硬排除，见 §6.6）；manual 时路由强制 no-op（勾选就是候选集）。
空 query ⇒ 路由 no-op，走 §2.5。

打分语料（「按堆选文」开关 ON 时按边计算）=
  Wave A 入选集
  ∪ 全部 pinned
  ∪ （FOLDER_BRANCH ∧ 命中夹）? 命中夹的全部成员 : ∅     // 有夹：夹当粗索引
  ∪ （GROUP_BRANCH ∧ 无命中夹）? top-1-2 派生组成员 : ∅  // 无夹：组当粗索引；「未分组」不是派生组
  夹边 no-op 不把本轮改写成「无命中夹」（不回落到组臂）。
  该边认证 pass ⇔ 对应分支常数 === true（KNOWLEDGE_ROUTE_FOLDER_BRANCH / KNOWLEDGE_ROUTE_GROUP_BRANCH，§6.2 表）。
  语料 ⊇ 入选集；输出可以比 k 长，由预算截。

命中谓词（钉一条）：
  对每个文件夹 F，s(F) = cosine(tfidf(query), tfidf(F.title + 已保存 description))
  命中 ⇔ s(F) ≥ KNOWLEDGE_SCORE_MIN（看未加 boost 的裸 cosine；全库 IDF 基）
  「无命中夹」⇔ 没有任何 F 命中（库里有夹但本轮未命中 → 走派生组）
  成员(F) = folder == F.path ∨ folder 以 F.path + "/" 为前缀
           （该夹子树内全部知识文档；不含 _folder.md；桶根 folder="" 不是夹，不参与 s(F)）

打分：该语料上用 §2.2 bag（含 #274 两字段）+ SITE_BOOST。
      IDF 基 = §2.2 的全库 IDF 缓存（同一函数同一基，s(F) 同基），禁止语料级重算。
      阈值判定（SCORE_MIN / s(F) / 第 2 组判据）一律看未加 SITE_BOOST 的裸 cosine；
      SITE_BOOST 只改排序。

第二趟不再截 top-k（输出扩张）：
  候选 = 打分语料中 pinned ∪ { score ≥ KNOWLEDGE_SCORE_MIN }
  按注入序填 8000（pinned → 入选按分 + recall 槽 → 概览吃剩余 → 其余按分含尾部）
  夹/组提供的是 recall：全局排名第 6+ 但过阈值的成员可以进预算。
  k 只约束 Wave A 入选集，不在第二趟重截。
禁止：同函数重打分再截同一个 k 还声称换血。
块打分只做入选后摘录，不用于选篇。
```

并集把夹/组成员加进语料提供 **recall**：全局排名 > k 但过阈值的成员可进预算（公式写「可以」；是否真进上下文由预算裁决，门的交付谓词 §6.6 专门验证这一点）——路由真实影响语料与候选，不是装饰。这就是 #274 §5 的「有夹则文件夹当粗索引，无夹才用派生组」；「无夹」的判定两 spec 统一为本节的命中谓词（#274 §5 已同步此句）。

- 组粗选：组分 = 成员元数据分 max，「成员元数据分」= §2.2 的 Wave A bag（含 #274 两字段）打分，与扁平打分同尺度——这支撑 §6.6 的 p@k 对照。top-1 组恒取；**第 2 组仅当组分 ≥ `KNOWLEDGE_SCORE_MIN`（0.10，裸 cosine）时取**；**组分并列取簇键（成员 id 的 min）字典序最小**；「未分组」不参与 top-1-2 粗选。
- 夹信号只走 #274 的 bag 字段（路径段 + 祖先已保存说明），分数变化来自 cosine；**没有 `FOLDER_BOOST`**，加性常数只留已入表的 `SITE_BOOST`（§2.4）。不存在「双重收窄」：组/夹只决定谁进语料，不在语料内做第二套过滤。
- **注入序（任一分支边 ON，预算内钉死，四步）**：① 全部 pinned（不得被挤）→ ② Wave A 入选文档按分填预算，**但最后一个文档槽：若存在过阈值扩张尾部，让位给最佳尾部一篇**（**recall 槽**，至多一篇；尾部裸 cosine ≥ `KNOWLEDGE_SCORE_MIN` 即可，不需要赢过末位——这是 recall 的明确定价：**至多 displacement Wave A 末位一篇**，税由 §6.6 门负责量）。**让位 ⇔（末位完整占用 + 剩余）≥ 该尾部 `getKnowledgeSummary` 全长；否则不让位、不截断占 recall 槽，尾部下放 ④（④ 可截断，但不算 ⑤）；剩余 ≥ 尾部全长 ⇒ 零 displacement 直接把尾部放进该文档槽（仍算 ②、在概览前），不挤 Wave A** → ③ 分组概览吃剩余（含 wrap，上限 `KNOWLEDGE_GROUPMAP_CHARS` 2000；剩余不足完整最小行则省略 + `groupmap_omitted`）→ ④ 仍有剩余则继续按分填（含其余尾部）。**「放不下任何文档槽」= 剩余 < 任何待填文档全长，不限于 pinned 满载**；此时 recall 槽与概览都省略，如实可见。**优先级钉死：概览省略唯一判据 = ③ 的完整最小行；「放不下任何文档槽」句只作用于 recall 槽与概览的省略判定；④ 照常截断填满剩余。**块打分仍只做摘录。
- **分组概览构成（钉死）**：列的是本轮路由实际使用的粗索引——命中夹 +（无夹时的）top-1-2 派生组；**行集 = 该粗索引（夹或组）的全部成员标题**（含未过阈成员；与「整夹零成员过阈则整体省略」不矛盾——那条是整夹无过阈的情形）；**组间序：夹按 s(F) 降序、并列按 path 字典序；组分支按组分降序、并列按簇键（成员 id min）字典序**；每组内标题按文档分降序；截断从尾部丢整行标题，不丢半截行；**粗索引（夹或组）零成员过阈值时省略概览并打 `groupmap_omitted`**（夹名命中但文档不会出现在上下文、或 top-1-2 组无一过阈，列它们的标题是空 appease——诚实优先于体感）；粗索引有内容时仍灌概览（体感），省略不犯规。概览整串过 `sanitizeKnowledgeContent` + `wrapKnowledgeBlock` 同款 sanitize + untrusted wrap（语义对齐 `companion/src/skills/content-sanitizer.ts:119-128`），**不得**写成可信路由指令（skills 索引那种受信任块形态禁止）。
- 开关：用户侧仍是**一只**「按堆选文」开关；配置面钉两只分支出厂默认 `KNOWLEDGE_ROUTE_FOLDER_BRANCH=false` / `KNOWLEDGE_ROUTE_GROUP_BRANCH=false`（§6.2 表）。**开关 ON ∧ 该边对应分支常数 === true（= 该边认证 pass）才走该边；否则该边运行时 no-op 回 Wave A**（不扩张、不灌该边概览，打 `groupmap_omitted`）——用户手动打开总开关不得把未认证分支带上线。#274 落地前组分支是唯一分支，**组栏必须跑**，不能用夹栏缺席当跳过。开关打开也仅作用于 auto——all 硬排除；manual 强制 no-op（见公式）；「智能匹配」关 ⇒ 簇路由同样 no-op（关了智能却仍按堆选文，禁止）。
- 检索默认仍是 Wave A 扁平打分；n<20、超 cap、全离群、空 query 时路由 no-op（§6.2 表 / §2.5）。**注意：`S_pre` 相等 ≠ 路由 no-op**——路由 ON 且不在 no-op 表 ⇒ 概览仍按构成处理（有内容则注入，零过阈则省略打 `groupmap_omitted`）；不得把「S_pre 相等」优化成「当 no-op、跳过概览」。

### 6.6 诚实门（带扳机）

- 评测集（20 query × N 文档，fixture 路径与评测命令在实现 PR 钉死）是 **Wave B 正式验收依赖**（§8 AC-14），不再是「非独立验收项」。
- k = 5（对齐 `KNOWLEDGE_DOC_TOPK_AUTO`）。**门只覆盖 auto / k=5；all 模式硬排除**（开关打开也不路由，不是「默认值」；如需开启另测 k=8，本票不开）。p@5 只作**哨兵**：方案 A 下结构性恒等，不参与 ②∧⑤∧⑥；若哪天不再恒等，说明公式被动过，须复审。
- **计量对象拆分（不要把两个指标钉在一个名词上）**：

```text
S_pre(flat)  = Wave A 入选集（pinned ∪ 打分 top-k，预算前）id 有序
S_pre(route) = 第二趟扩张后、概览与 8000 前的完整候选 id 有序（可变长）
S_post(*)    = 8000 截断后实际注入的文档 id（概览不是文档）

routed≠flat ⇔ S_pre(route) ≠ S_pre(flat)   // 集合比较，不用长度-5 前缀
p@5 = |rel ∩ 各自排名前 5| / 5 —— 方案 A 下两边前缀恒等，此值只作回归，
      不作开闸证据（本 spec 明文承认这个等式是结构性的）

开闸（允许该分支常数改 true）的交付谓词，与有效性前置**同一条 query**，
且**夹分支与组分支各自认证**（粒度到分支）：
  夹分支：对同一条命中夹 query，
    ∃ d ∈ (S_pre(route) \ S_pre(flat)) ∩ S_post(route)，其注入字符 ≥ 1500
    （共享残片不翻转谓词）
  组分支：对同一条无夹 query（走 top-1-2 派生组），同上谓词成立
  认证 query 必须是算例体制：S_pre(flat) 每篇全长 = 2000、尾部全长 = 2000
  （不得用 ≥1500 下限另造认证尺寸；非认证 query 的常规断言保留 ≥1500 下限）
  评测输出分栏：folder: pass|fail|absent、group: pass|fail|absent；
  absent 与 fail 同等 ⇒ 该边默认保持关，另一分支可开。
禁止第三种：用变长 S 除以 |S| 还叫 p@5。
```

「路由真实生效」的证明交给 AC-13 语料断言 + S_pre 集合不等 + 上面的交付谓词，不再让 p@5 承担。
- **有效性前置 + 分栏**（断言见 §8 AC-14）：fixture ≥ `KNOWLEDGE_CLUSTER_MIN_DOCS`（20）篇；评测输出**分栏**：`folder: pass|fail|absent`、`group: pass|fail|absent`——**absent 与 fail 同等 ⇒ 该边默认保持关**（「无法构造」不需要预言家，`absent|fail → off` 即保守闭包）。① **按栏计，不是全局合取**（夹栏缺席不拖死组栏，反之亦然）。`routed≠flat` = S_pre 集合不等，该栏计数 > 0；两栏各自的认证 query 与交付谓词同一条（量词绑定）。#274 落地前组分支是唯一分支，**组栏必须跑**，不能用夹栏缺席当跳过。
- 簇路由配置面 = 两只分支常数（§6.2 表），**未认证分支出厂 false**；评测未跑 = 关。开闸 = 对应栏 `pass`：该栏 ②（S_pre 集合不等、计数 > 0）∧ ⑤（同一条算例体制认证 query 的交付谓词）∧ ⑥（recall 税）齐备，才允许把该分支常数改 true。**p@5 移出开闸条件**：方案 A 下逐 query 结构性恒等，只留哨兵——若哪天不再恒等，说明公式被动过，须复审。**认证漂移扳机：路由输入面任何改动（#272 bag、`KNOWLEDGE_CLUSTER_MERGE_MIN`、#274 bag 两字段、注入序、常数表数值等）⇒ 对应分支常数回 false 重证**，栏位结果不继承。**（2026-09-03 状态更新：评测双栏 folder/group 均 pass、--strict 同过，两只分支常数已开闸为 true；用户侧「按堆选文」开关默认仍关——开闸不替用户开。漂移扳机不因此失效。）**
- 门只挡路由、不挡视图：路由被门关着时分布视图照交，度量照做。路由未过门时不得宣称「精准匹配」（copy 扫描覆盖，§8 AC-16）。

### 6.7 纠正与 SoT

纠正分组 = **移文档到文件夹**（#274 `knowledge.move`）。**禁止** `cluster_id` 进 frontmatter、禁止 `.clusters.json` 或任何形式的分组持久 SoT；分组关系只存在于可重建的派生索引里。

### 6.8 治理

- **F-E-3 窄豁免**：「派生的、可重建、非用户维护的分布视图」≠ 分类树 / 图谱本体。仍禁图谱 UI 名词、仍禁持久边。豁免 ADR 与 Wave B **同 PR**，先 ADR 后实现（§7，含对「事实上分类树」质疑的预先反驳）。
- **F-E-10 / 锁 C1 不重开**：无 embedding（含 opt-in 也不开）、无 graph DB、无新 runtime。
- F-I-2 安全：索引派生可丢，磁盘 `.md` 仍是唯一 SoT。

### 6.9 顺序与依赖

1. **Wave A 仍先交付**（治匹配与预算的病，零锁）。
2. **Wave B 分布视图**不依赖文件夹，可在 #274 之后或与其并行；#274 未落地前纯只读（§6.4）。
3. **Wave B 簇路由**：**组分支不依赖文件夹**，可在 #274 前交付（#274 前组栏必须跑、组边可单独开）；夹分支依赖 #274 的文件夹机制（bag 两字段 + 命中谓词 s(F)），在 #274 落地后交付（或同 PR 家族对齐）。
4. #272（元数据质量）为向量喂信号，先做更顺但非阻塞。

---

## 7. ADR（两条）

本票产生两条 ADR：

1. 「**知识检索对齐技能 TF-IDF，仍无 embedding**」 — 记录性质，不是重开禁令。
2. 「**F-E-3 窄豁免：派生、可重建、非用户维护的知识分布视图**」 — 随 Wave B 解冻新增；豁免范围仅限 §6 的分布视图与两段式簇路由（打分语料 = Wave A 入选集 ∪ pinned ∪ 命中夹成员，**无命中夹时**才并 top-1-2 派生组；第二趟输出扩张、不重截 k；manual no-op、all 硬排除），仍禁图谱 UI / 分类本体 / 双链 / 持久边。**与 Wave B 同一 PR 交付**，先 ADR 后实现。

ADR 第 2 条必须预先反驳最锋利的一击——「派生分组 + 纠正 = 事实上的用户可调分类树」：

1. 分组非层级、不可编辑、随重建蒸发；用户不能改组成员，只能改文档归属。
2. 纠正（移文件夹）作用于**文档归属**，不作用于分组本体；分组本体从不被保存。
3. 路由是可选粗索引、默认关（§6.6），不是检索本体；用户分类的唯一 SoT 是 #274 文件夹。
4. #274 未落地前视图纯只读展示（§6.4）——「非用户维护」不被读成「假装用户可纠正」。

F-E-10 / 锁 C1 的文本全程不碰。

---

## 8. 验收标准（Wave A 7 条 + Wave B 12 条）

### Wave A

1. 库内 12 篇、其中 2 篇标题/说明含「退款政策」，query=「退款怎么处理」：auto 注入这 2 篇（或含它们的 top-5），**不**注入明显无关的站点文档。
2. all + 30 篇 × 2000 字：知识 payload 字符 ≤ 8000；`retrieved_sources.length` ≤ 8。「包装开销」记账边界钉死：= 每篇 wrap 标记与标题行的固定标记字符，实现 PR 钉成常数并作为断言上界，不进 8000 知识预算也不任其无界。
3. manual 勾选 10 篇：优先 10 篇，但总字符仍 ≤ 预算；截断可在 `retrieved_sources` 上看到。
4. 关闭 LLM：知识检索回路不得调用 `llmRerank` / `llmExtract`（断言零调用；§6.3 的展示美化开关默认关，验收时保持关）。
5. 200 篇 × 短元数据打分：单次 resolve < 50ms（本地基准，与 `matchSkills` 同量级）。
6. UI 不再出现「注入全部知识索引」（copy 扫描，含 `KnowledgeSubPanel.tsx:396` 按钮 `title=` 的「注入所有知识索引」tooltip 副本）。
7. 无 graph DB、无 embedding 依赖、无 `knowledge.graph*`、无新 runtime。

### Wave B

8. 确定性防假绿：**跨一次索引重建 + 打乱输入序**，分组分配与簇标签均不变（id 字典序进矩阵、簇–簇合并 tie-break 取簇键=成员 id 的 min、标签频次并列取字典序最小）；路由侧同防：组分并列取簇键字典序最小、文档级分数并列取 id 字典序最小；概览序列化同防：行集 = 粗索引全部成员（含未过阈）、组间序（夹 s(F) 降序并列 path 字典序；组分支组分降序并列簇键字典序）、组内按文档分降序。
9. 100+ 文档分布视图渲染 < 1s，**冷启动含一次聚类计算**。
10. 分组概览 ≤ 2000 字符（**含 wrap 标记**，与 AC-2 包装开销同口径）、**计入** 8000 总预算；断言其经 sanitize + untrusted wrap、不是可信指令块形态；构成断言：只列本轮实际使用的粗索引（命中夹 + 无夹时 top-1-2 派生组）、**行集 = 该粗索引全部成员标题（含未过阈）**、组间序按 §6.5 钉死的键（夹 s(F) 降序并列 path；组分支组分降序并列簇键）、组内标题按文档分降序、截断丢整行不丢半截；剩余额度 < 最小完整长度（一个分组名 + 一行标题）时整体省略、不注半截，且 `retrieved_sources` 带 `groupmap_omitted` 标记（断言）；**正向断言：剩余放得下完整最小行 ⇒ 概览注入**（锚定「概览省略唯一判据 = ③ 最小行」读法）；**粗索引（夹或组）零成员过阈 ⇒ 省略概览 + `groupmap_omitted`**（不再列夹/组）。
11. 删除 `cache/knowledge-index.json` 后自动重建，期间降级 Wave A 无报错；**损坏注入用例**：半截 / 非法 JSON 按缺失处理，同样降级、无报错、不阻塞注入。
12. n=20 显示、n=19 隐藏；全离群只剩「未分组」一枚芯片时同样不渲染；任一不渲染态下簇路由均 no-op 回 Wave A。
13. 期望集合断言（auto，**仅当 `KNOWLEDGE_ROUTE_FOLDER_BRANCH` 为 true**）：query 命中夹时，**命中夹全部成员（子树，§6.5 成员谓词）∪ 全部 pinned 必须出现在打分语料里**，即使它们不在 Wave A 入选集或 top-2 派生组；第二趟**不重截 top-k**（输出扩张）——全局排名 > k 但过 `KNOWLEDGE_SCORE_MIN` 的夹/组成员可进预算（recall），同函数重打分再截同一 k 的「换血」实现判不合规；夹命中文档的分数变化来自 bag（路径段 + 祖先已保存说明）的 cosine，**不存在第二套 boost 常数**。
14. 诚实门扳机（分栏 + 量词绑定 + 槽边界 + 税断言）：配置面 = 两只分支常数 `KNOWLEDGE_ROUTE_FOLDER_BRANCH` / `KNOWLEDGE_ROUTE_GROUP_BRANCH`，~~断言两只出厂值均 false~~ → **断言出厂 true 且评测命令可跑、分栏机核在**（2026-09-03 开闸：诚实门语义从「关着等认证」转为「已认证开闸、漂移扳机仍在」）；评测未跑 = 关。① 评测输出**分栏** `folder: pass|fail|absent`、`group: pass|fail|absent`，**absent 与 fail 同等 ⇒ 该边默认保持关**；fixture ≥ `KNOWLEDGE_CLUSTER_MIN_DOCS`（20）篇，每栏各含认证 query（夹栏：命中夹；组栏：无夹走 top-1-2 派生组）且各须含「过 `SCORE_MIN` 但 Wave A 全局排名 > k」的粗索引成员；**按栏计，不是全局合取**；#274 落地前组栏必须跑，不能用夹栏缺席当跳过。② `routed≠flat` ⇔ `S_pre(route) ≠ S_pre(flat)`（**集合比较，不用长度-5 前缀**），该栏计数 > 0。③ **门只覆盖 auto / k=5，all 硬排除**（钉死）。④ p@5 哨兵：方案 A 下结构性恒等，**不参与 ②∧⑤∧⑥**；若不再恒等须复审（禁止用变长 S 除以 |S| 冒充 p@5）。⑤ **交付谓词，与 ① 同一条认证 query**：∃ d ∈ `(S_pre(route) \ S_pre(flat)) ∩ S_post(route)`，其注入字符 ≥ 1500（共享残片不翻转谓词）；**认证 query 必须是算例体制：S_pre(flat) 每篇全长 = 2000、尾部全长 = 2000**（不得用 ≥1500 下限另造认证尺寸；非认证 query 的常规断言保留 ≥1500 下限）。⑥ **recall 税**：与 ①⑤ 同一条认证 query 必过，且评测集逐 query 哨兵 `|rel ∩ S_post(route)| ≥ |rel ∩ S_post(flat)| − 1`（squeeze ≤ 1；**哨兵只计完整注入篇，截断残片不进 |rel ∩ S_post| 计数**；对合规实现**结构性成立**——route 相对 flat 只减不增的来源只有 recall 槽，本质是回归断言；未定义的 `p@injected` 删除，以此式为准）。**算例（评测作者照造）**：满篇 5×2000、pinned 空、尾部 t 全长 2000：routed = d01–d03（6000）+ t（2000）= 8000，概览省略；flat 对照 = d01–d04——⑤ 可满足，⑥ squeeze = 1。某栏 `pass` 才允许把对应分支常数改 true。断言两只分支常数出厂值 + 评测命令存在可跑 + 分栏与计量可机核。
15. 超 cap（201 篇）：视图不渲染分组 chips，显示「库超过 200 篇，未自动分组」；路由 no-op 回 Wave A。
16. Wave B 全部新文案 copy 扫描（含 tooltip/title/aria）：禁词 = F-UX-NOUN-1 全表 +「分类树 / 自动分类 / 簇 / 聚类 / 知识地图」；面板含诚实句「自动分组，不准就移到文件夹」；路由未过门时无「精准匹配」类宣称。
17. `knowledge.list` 顶层带 `distribution?: { groups: [{ label, count, ids }] }`；**无** per-doc `cluster_id`；summoner 必剥、overlay 亦剥（严于 related 先例，§6.4 同一句）。
18. `retrieved_sources` 带可选 `group_label?`：路由 ON 时「本轮附带」芯片可显示来源分组（用户可见词「分组」）；字段可选、派生、不进文档 SoT。芯片口径（§3）：N=|S_post|、M=|S_pre|；概览占预算导致少灌正文时标「含分组概览」（或等价），不得写成「按相关性」截断；`groupmap_omitted`（没灌概览）与「灌了概览所以少灌正文」两种态都可识别。
19. manual + 任一分支常数 true：注入集合仍等于勾选（预算内），路由强制 no-op——不打穿 §3「只注入勾选的」。

**评测集（正式验收依赖，不再是「非独立验收项」）**：20 query × N 文档离线集，fixture 路径与评测命令随实现 PR 钉死入库。它同时支撑：AC-1/AC-5 的精度对照（现 auto 基线实测入票）、AC-14 的诚实门扳机（§6.6）、打分模块抛错时与现版逐字节一致（§2.5 降级）。

---

## 9. 明确不在本票 / 本季

embedding、graph DB、持久簇 SoT（`cluster_id` frontmatter / `.clusters.json` 当真相源）、`knowledge.graph*`、`query_knowledge` tool、图谱/双链/力导向 UI、UI 文案出现「图谱/簇/聚类」字样、LLM 起名进检索回路、重开 F-E-10/锁 C1、overlay 知识新动词、目录结构改造（那是 #274）、元数据补全（那是 #272）。

---

## 10. 修订历史

- 2026-09-02：双路独立对抗设计（grok · claude）收敛成稿；#273 已由原案改写为 Wave A only，Wave B 冻结。
- 2026-09-02（同日第二版）：用户拍板 Wave B 解冻（「必须有」），推翻冻结建议；§6 由冻结条款改为交付设计（分布视图 + 簇路由 + 诚实门），§0 裁决表、Blast Surface、§5 NEVER、§7 ADR（增 F-E-3 窄豁免一条）、§8 验收（+6 条）、§9 同步更新。F-E-10 / 锁 C1 仍不重开。
- 2026-09-02（同日第三版）：Round-1 双路对抗评审（[claude](../../.omx/artifacts/gate5/gate5-claude.md) · [grok](../../.omx/artifacts/gate5/gate5-grok.md)）均 BLOCK，本版吸收全部收敛 finding：§6.5 候选池规范公式（pinned/文件夹永不被组过滤，对齐 #274 §5）；§6.2 Wave B 常数表（average-link、合并阈值、tie-break、纯 TF 向量、CAP=200、MIN_DOCS=20、防抖、atomicWriteJSON、DATA_DIR 锚定）；§6.1 重建触发补指纹/损坏 + single-flight；§6.3 标签只取 title+tags 过现成闸；§6.4 分布=过滤 chips + list 顶层 `distribution?` 通道 + 诚实句 + 禁词全表；§6.6 诚实门装扳机（默认 false、评测未跑=关、k=5、ε=0）并升为 AC-14；§8 Wave B 验收扩至 11 条（含跨重建确定性、损坏注入、超限降级、copy 扫描、通道、group_label?）；§7 ADR 补「事实上分类树」反驳；§2.5/§3/§4/§5 NIT 随修。
- 2026-09-02（同日第四版）：Round-2 双路复审（[claude](../../.omx/artifacts/gate5/gate5-r2-claude.md) · [grok](../../.omx/artifacts/gate5/gate5-r2-grok.md)）仍 BLOCK，残留同一层：§6.5 公式非终结符未绑定。本版修复：「Wave A 池」钉死为 §2.3 入选集（禁代入 §2.1 全库语料）；manual 路由强制 no-op；命中谓词 s(F) 钉死；删 `FOLDER_BOOST`（夹信号只走 #274 bag 字段）；注入序 pinned → 概览吃剩余 → 按分填满；AC-14 补有效性前置三句（fixture≥20、routed≠flat>0、门只覆盖 auto/k=5，all 默认排除）；第 2 组判据 = 组分 ≥ `KNOWLEDGE_SCORE_MIN`（0.10 精确化，§2.3/§2.4 统一）；确定性补强（簇键=成员 id min、标签并列取字典序）；`redactSecrets` 引用改 `distill.ts`；「未分组」chip 规则；distribution「summoner 必剥，overlay 亦剥」；#274 §5 同步「无夹 = 本轮无命中夹」。新增 AC-19（manual 不打穿勾选）。
- 2026-09-02（同日第五版）：Round-3 双路复审（[claude](../../.omx/artifacts/gate5/gate5-r3-claude.md) · [grok](../../.omx/artifacts/gate5/gate5-r3-grok.md)）仍 BLOCK，同一洞再下一层：并集后用同一全序再截同一 top-k = 恒等空操作。收敛裁决：**采用 grok 方案（A）输出扩张 + 保留全库单一 IDF 基**，否 claude 的 R2 语料级 IDF 重算（会引入第三套向量语义，与 §6.2「两套向量各归各」冲突；方案 A 在单一 IDF 下非空——flat 被 top-k 截断，routed 对过阈值语料不重截 k、由预算截）。本版修复：§6.5 第二趟不重截 k、候选 = pinned ∪ 过阈值（recall 语义），禁「重打分再截同一 k 还声称换血」；§2.2/§6.5 钉全库 IDF 基（s(F) 同基）；AC-14 计量钉死（注入前 top-5 id 有序集合，概览/预算不进计量，≥1 条命中夹 query 自身 routed≠flat，fixture 含「过阈值但全局排名 > k」夹内文档）；夹成员 = 子树前缀谓词（桶根非夹）；#274 §5 删「且规模超标」、规模边界引 #273 §6.2 表；平局三钉（组分并列取簇键、文档分并列取 id，并入 AC-8）；SCORE_MIN 看裸 cosine（SITE_BOOST 只改排序）；开关硬作用域（开也仅 auto）；概览截断下限 + `groupmap_omitted` 标记（AC-10）；空 query no-op；AC-17 双剥对齐。
- 2026-09-02（同日第六版）：Round-4 双路复审（[claude](../../.omx/artifacts/gate5/gate5-r4-claude.md) · [grok](../../.omx/artifacts/gate5/gate5-r4-grok.md)）仍 BLOCK：方案 A 选择层已闭合，但门把 p@5 与 routed≠flat 钉在同一个「top-5 选择集合」名词上——方案 A 的选择集合是变长表，top-5 前缀读法恒等（门永死），扩张全表读法 p@5 恒打平（假绿），且预预算可分不蕴涵注入可分（概览抢预算）。本版修复：§6.6 计量对象拆分为 `S_pre(flat)` / `S_pre(route)` / `S_post(*)` 三个对象，`routed≠flat` = S_pre 集合不等（不用长度-5 前缀），p@5 明文承认为结构性恒等、只作回归不作开闸证据，开闸另需交付谓词 `(S_pre(route) \ S_pre(flat)) ∩ S_post(route) ≠ ∅`（扩张尾部至少 1 篇真进上下文）；芯片口径钉死 N=|S_post|、M=|S_pre| + 「含分组概览」标注（§3 / AC-18）；分组概览构成钉死（实际使用的粗索引、组内按分降序、丢整行不丢半截、夹命中零过阈仍列夹）；§2.1/§4 补「resolve 仍 ≤k，扩张表在预算记账前展开（另名）」；AC-14 fixture 加入选篇 ≥1500 字符要求；概览 2000 上限含 wrap 标记（§6.2 表 + AC-10 同口径）。
- 2026-09-02（同日第七版）：Round-5 复审（[grok](../../.omx/artifacts/gate5/gate5-r5-grok.md)；claude r5 未归）仍 BLOCK：①（有效性前置）与 ⑤（交付谓词）的量词可拆到两条不同 query；满篇体制（篇长 2000）下 ⑤ 结构不可满足，短文/截断残片可开后门把全局默认打开。收敛裁决：**采用 grok 补丁 (B) 改注入序留 recall 槽**，否 (A) 默认永关——用户拍板「按堆选文」必须是真功能，(A) 对拍板意图不诚实；recall 税明说：至多 displacement Wave A 末位一篇，门负责量它。本版修复：§6.5 注入序改四步（pinned → 入选按分 + recall 槽（至多一篇、裸 cosine 过阈即可、不需要赢过末位）→ 概览吃剩余 → 其余按分含尾部），pinned 满载时 recall 槽与概览都省略且如实可见；① 与 ⑤ 绑到**同一条命中夹 query**（该 query 上 S_pre(flat) 每篇 ≥1500 字符、尾部注入字符 ≥1500，禁截断残片、禁短 query 代开）；p@5 移出开闸三件套只留哨兵；AC-14 补 recall 税回归断言（挤出条数 ≤ 1）与满篇算例注释（d01–d03 6000 + 尾部 2000 = 8000，概览省略，flat 对照 d01–d04）；§6.5 写明「S_pre 相等 ≠ 路由 no-op」，「夹命中零过阈仍灌概览」改为省略 + `groupmap_omitted`；概览多组排序 = s(F) 降序、并列 path 字典序；§2.1 补「≤k 只约束非 pinned，pinned 全量返回，扩张不靠并集救回 pinned」。
- 2026-09-02（同日第八版）：claude r5 迟达，对 r5 文本给 PASS_WITH_NITS，两条 MAJOR 收口（其 MAJOR-1 recall 税断言 ⑥ 与 NIT-2 零过阈夹改省略已在第七版闭合）：① **门只认证夹分支** → §6.6/AC-14 改分支粒度：有效性前置与交付谓词要求 ≥1 条命中夹 query 与 ≥1 条无夹 query（top-1-2 派生组分支）**各自**成立，缺哪边哪边默认保持关（fixture 无法构造无夹认证 ⇒ 组分支默认关、夹分支可开）；② **概览行集** → §6.5 钉死行集 = 该粗索引（夹或组）全部成员标题（含未过阈；与整夹零过阈省略不矛盾），组分支组间序 = 组分降序、并列簇键字典序；AC-8/AC-10 同步。
- 2026-09-02（同日第九版）：Round-6 复审（[claude](../../.omx/artifacts/gate5/gate5-r6-claude.md) BLOCK · [grok](../../.omx/artifacts/gate5/gate5-r6-grok.md) PASS_WITH_NITS，finding 几乎完全重叠）。本版修复：① **分支执行器**——配置面钉两只出厂默认 `KNOWLEDGE_ROUTE_FOLDER_BRANCH=false` / `KNOWLEDGE_ROUTE_GROUP_BRANCH=false`（§6.2 表），用户开关仍一只，ON ∧ 该边认证 pass 才走该边、否则该边运行时 no-op 回 Wave A（不扩张、不灌该边概览，可打 `groupmap_omitted`）；评测输出分栏 `folder|group: pass|fail|absent`，absent 与 fail 同等 ⇒ 该边默认保持关，AC-14 ① 按栏计而非全局合取；写明 #274 落地前组栏必须跑。② **recall 槽边界**（绑死读法 1）——让位 ⇔（末位完整占用 + 剩余）≥ 该尾部 `getKnowledgeSummary` 全长，否则不让位、不截断占槽、尾部下放 ④（④ 可截断但不算 ⑤）；「放不下任何文档槽」= 剩余 < 任何待填文档全长，不限于 pinned 满载；认证 query 必须是算例体制（S_pre(flat) 每篇全长 = 2000、尾部全长 = 2000），非认证 query 的常规断言保留 ≥1500 下限。③ **⑥ 量词与公式**——与 ①⑤ 同一条认证 query 必过，评测集逐 query 哨兵 `|rel ∩ S_post(route)| ≥ |rel ∩ S_post(flat)| − 1`（删未定义的 p@injected；写明对合规实现结构性成立，本质是回归断言）；⑤ 尾部注入字符钉 ∃ 量词（共享残片不翻转谓词）。④ AC-10 组侧对称（组粗索引零成员过阈同样省略 + `groupmap_omitted`）。⑤ p@5 残留「打平即通过」改哨兵措辞（不参与 ②∧⑤∧⑥）。
- 2026-09-02（同日第十版，定稿）：Round-7 双路复审（[grok](../../.omx/artifacts/gate5/gate5-r7-grok.md) · [claude](../../.omx/artifacts/gate5/gate5-r7-claude.md)）均 PASS_WITH_NITS，NIT 全收：① 打分语料公式按边门控（`(FOLDER_BRANCH ∧ 命中夹)` / `(GROUP_BRANCH ∧ 无命中夹)`，夹边 no-op 不回落组臂，「认证 pass ⇔ 分支常数 === true」入公式），AC-13 加 `FOLDER_BRANCH` 限定，开关段绑定常数名；② 注入序优先级钉死（概览省略唯一判据 = ③ 完整最小行；「放不下任何文档槽」只作用于 recall 槽与概览省略判定；④ 照常截断填满），AC-10 补正向断言（剩余放得下行 ⇒ 概览注入）；③ ② 补零 displacement 情形（剩余 ≥ 尾部全长 ⇒ 尾部直接进槽，不挤 Wave A）；④ ⑥ 哨兵只计完整注入篇（截断残片不进计数）；⑤ AC-19 改「任一分支常数 true」，§6.9.3 改组分支不依赖夹、可在 #274 前交付；⑥ §6.6 补认证漂移扳机（路由输入面任何改动 ⇒ 对应分支常数回 false 重证）；⑦ 边关闭态「可打」改「打」`groupmap_omitted`。状态升 **LOCKED · design dual both AWN**。
- 2026-09-03（实现轮）：Wave B 实现 + ADR-027 同分支落地；Gate9 双路复审收敛：§6.4 通道形状补稳定 `key`（带 `c:`/`u:` 命名空间前缀，防保留键碰撞）与放行谓词 `session.surface === "panel"`（生产 stamp 词汇表只有 summoner|tray）——实现细节以 ADR-027 §3 为准；本条不改任何行为规范文字。
- 2026-09-03（开闸轮）：诚实门评测双栏 pass（`node scripts/knowledge-route-eval.mjs` → folder: pass / group: pass，`--strict` 同过），按 §6.6 把两只分支常数 `KNOWLEDGE_ROUTE_FOLDER_BRANCH` / `KNOWLEDGE_ROUTE_GROUP_BRANCH` 开闸为 **true**；§6.2 表值与 AC-14 断言语义同步翻面（出厂 false → 出厂 true 且评测可跑、分栏机核在）；用户侧「按堆选文」开关默认仍关。漂移扳机不变：路由输入面任何改动 ⇒ 回 false 重证。
- 2026-09-03（开闸轮 Gate10 nits）：双路 AWN 后折文档同步——§6.6 基句改「未认证分支出厂 false」；AC-14 用删除线翻面；ADR-027 §3 表同步标注开闸。不改行为。
