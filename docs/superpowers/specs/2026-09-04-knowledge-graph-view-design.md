# 知识分布图谱视图（Knowledge Graph View）设计

> GitHub: #296
> 日期: 2026-09-04 | 状态: Locked（开放设计点已裁决，见 §3）
> 相关: [ADR-027](../adr/027-knowledge-distribution-view-f-e-3-exemption.md)（F-E-3 窄豁免，本票需配套扩展）· [ADR-026](../adr/026-knowledge-retrieval-tfidf-no-embedding.md) · [#273 检索打分 spec](./2026-09-02-knowledge-retrieval-scoring-design.md) · [对话历史图谱](./2026-08-11-thread-graph-obsidian-view-design.md)（交互模式来源）

---

## 1. 一句话

在知识面板提供「分布图谱」入口：全页 tab 力导向图，节点 = 知识条目（按派生簇着色），边 = 既有纯 TF 相关度。**纯派生、只读、可丢可重建**——SoT 仍是磁盘 .md（F-I-2 不变）。

## 2. 与 ADR-027 的关系（必须先讲清）

ADR-027 的 F-E-3 窄豁免明文：「图谱 UI / 分类本体 / 双链 / 持久边仍全禁」。本票把豁免**再扩一格**，且只扩这一格：

| 项 | ADR-027 | 本票 |
|----|---------|------|
| 图谱 UI | 禁 | **允许**：只读可视化，入口显式、默认不打开 |
| 持久边 | 禁 | **仍禁**：边不落盘、不进索引文件；每次打开视图时从派生索引向量现算 |
| LLM 起名 | 禁进检索回路（可选美化未做） | 允许**展示层**美化（默认关、可丢缓存），仍禁进检索/路由 |
| 分类本体/双链/用户可编辑图谱 | 禁 | **仍禁** |

预先反驳「这就是被禁的图谱」：F-E-3 的立法意图是防止「系统替用户维护一套图谱本体」。本视图（a）没有可维护的图谱实体——节点/边都从 `knowledge-index.json` 现算，索引本身可丢；（b）用户不能编辑节点位置/边/分组；（c）不进检索回路，Wave A 扁平打分仍是检索本体。配套动作：合入时新增 **ADR-028**（或 ADR-027 增补节）记录本次豁免扩展，措辞与本表一致。

## 3. 开放设计点裁决（issue #296 §开放设计点）

1. **规模控制**：节点 = 派生索引全部文档（沿用 `KNOWLEDGE_CLUSTER_DOC_CAP=200` 上限）。边：每节点取 `scoreRelatedKnowledge` top-5（复用 `knowledge-related.ts` 权重，不新造算法），且 `score >= KNOWLEDGE_GRAPH_EDGE_MIN`（新常数 0.5）；平局按 id 字典序。200 节点 × 5 边 ≤ 1000 边，力导向可承受，不做交互式展开。
2. **LLM 簇命名/摘要**：opt-in 开关 `knowledge_graph_llm_labels`（默认 false）。开启后：索引防抖重建完成后异步命名（写回索引文件的 `display` 派生字段——**可丢、可重建、不进检索、不进路由、不进 Obsidian 导出**），图谱视图另有「重新生成」手动按钮。LLM 调用走 #272 既有 llm-extract 通道；无配置/失败时回退高频词标签（ADR-027 既有逻辑），不报错不阻塞。
3. **与 Obsidian wikilinks 的关系**：`knowledge-related.ts` 是唯一相关度计算点。图谱边与 Obsidian 导出 wikilinks 共用 `scoreRelatedKnowledge`；只放宽各自的取边参数（图谱 top-5 / 导出沿用 `KNOWLEDGE_RELATED_LIMIT=3`），不合并 UI、不引入第二算法。

## 4. 用户能看见的完成（AC）

- AC-1 知识面板新增「分布图谱」入口（chips 行右侧图标按钮），点击打开全页 tab（复用 `tabs/thread-graph.html` 模式：Plasmo tab page + force-layout）。
- AC-2 节点按簇着色（簇键 = 分布视图同一 key），「未分组」统一灰色；hover 显示 title + 簇名；点击节点 = 在知识面板打开该文档（聚焦面板并选中）。
- AC-3 n < 20：不渲染图谱，诚实文案「知识不足 20 篇，暂无图谱」（复用 `KNOWLEDGE_CLUSTER_MIN_DOCS` 语义）；n > 200：诚实文案「超过 200 篇，只画前 200 篇（按标题字典序截取）」——复用 ADR-027 over_cap 文案模式。
- AC-4 LLM 命名开关默认关；开启时簇名来自 LLM（带「AI 命名」标识 tooltip），关闭时高频词标签。开关状态持久化在面板设置（不进 config.json 的 L2/trust 面）。
- AC-5 索引缺失/损坏/重建中：显示「图谱索引重建中…」并在索引就绪后自动刷新（派生索引既有防抖重建）。

## 5. 通道与数据流

- 新增 `knowledge.graph` 消息（panel-only，同 distribution 的 surface 门：summoner/overlay 必剥）→ 返回 `{ status: "ok" | "too_few" | "over_cap" | "rebuilding", nodes: [{id, title, cluster_key, folder}], edges: [{a, b, score}], labels: {cluster_key: label} }`。
- 边在服务端现算：读派生索引 → 对每节点跑 `scoreRelatedKnowledge` → top-5 过滤 → 去重对称边（a<b 字典序只留一条）。
- LLM 命名写回索引文件 `display` 字段时走 `writeKnowledgeIndexFile`（0o600 atomic 既有）；`readKnowledgeIndexFile` 对缺失 `display` 容忍（version 仍 1，字段可选）。

## 6. 常数表（可测可调，不要藏）

| 常数 | 值 | 含义 |
|------|----|------|
| `KNOWLEDGE_GRAPH_EDGE_TOPK` | 5 | 每节点出边上 |
| `KNOWLEDGE_GRAPH_EDGE_MIN` | 0.5 | 边最小相关度（scoreRelatedKnowledge 合成分） |
| `KNOWLEDGE_GRAPH_DOC_CAP` | 200 | 复用 `KNOWLEDGE_CLUSTER_DOC_CAP`，不另设 |
| `KNOWLEDGE_GRAPH_MIN_DOCS` | 20 | 复用 `KNOWLEDGE_CLUSTER_MIN_DOCS`，不另设 |

漂移扳机：图谱只读消费派生索引，不改路由输入面——**不触发** ADR-027 的评测重证；但若改了 `scoreRelatedKnowledge` 权重/语料，则同时触发（wikilinks 与图谱边同源）。

## 7. 未完成时禁止假装

- <20 篇不渲染空图谱假装有结构；>200 篇不声称「全量图谱」。
- LLM 命名不写进磁盘 SoT、不进检索/路由/导出；开关默认关。
- 不把图谱节点位置/边持久化（力导向每次现算，布局不存档）。
- 不做 embedding 语义搜索（激进方案迁移项，另票）；不改 Wave A 打分。

## 8. 测试

- 服务端：`knowledge.graph` 形状/状态机（too_few / over_cap / ok）；边 top-5 + 阈值 + 对称去重 + 确定性（同输入两次同输出）；display 字段 round-trip 与缺失容忍；surface 门（summoner 剥）。
- 扩展：面板入口渲染；三态诚实文案；开关默认关；LLM 标识显示逻辑。
- 回归：`knowledge-route-eval.mjs` 双栏仍 pass（本票不动路由输入面，跑一次确认无漂移）。

## 9. Blast（eval gate，沿用 issue 票面 T2）

新增只读 surface（图谱 tab）+ opt-in LLM 命名（默认关、可丢派生）；不新增 L2 工具类；不碰检索路由与安全面。

## 10. 不在本票

- embedding 语义搜索 / 历史成功率学习（激进方案其余迁移项）
- 图谱编辑、拖拽改分组、持久布局
- 冲突检测 / DAG 校验（issue 列为可选，本季不做——纯 TF 相关度无向边不构成 DAG 语义，做了是假功能）
