# ADR-028: F-E-3 豁免扩展 — 知识分布图谱视图（只读可视化 + 按需拉取动词）

**日期**: 2026-09-04 | **状态**: Accepted（#296）
**相关**: [Spec: Knowledge Graph View](../superpowers/specs/2026-09-04-knowledge-graph-view-design.md) · [GitHub #296](https://github.com/nehcuh/cmspark/issues/296) · [ADR-027](./027-knowledge-distribution-view-f-e-3-exemption.md)（本 ADR 扩展其窄豁免） · [ADR-026](./026-knowledge-retrieval-tfidf-no-embedding.md)

---

## 决策

### 1. 一句话

> 把 [ADR-027](./027-knowledge-distribution-view-f-e-3-exemption.md) 的 F-E-3 窄豁免**扩三格**，允许一个**纯派生、只读、可丢可重建**的知识「分布图谱」视图（全页 tab 力导向图）：节点 = 知识条目（按派生分组或文件夹着色），边 = 既有纯 TF 相关度现算。其余禁令（持久边、分类本体、双链、图谱编辑）**仍然有效**。

### 2. 豁免扩展（逐格钉死，措辞与 spec §2 表一致）

| 项 | ADR-027 | 本 ADR（#296） |
|----|---------|------|
| 图谱 UI | 禁 | **允许**：只读可视化，入口显式、默认不打开 |
| 持久边 | 禁 | **仍禁**：边不落盘、不进索引文件；每次打开视图时从派生索引向量现算 |
| LLM 起名 | 禁进检索回路（可选美化未做） | 允许**展示层**命名 + 摘要（默认关、可丢缓存），仍禁进检索/路由/导出 |
| 无新 WS 动词（ADR-027 §5 锁定） | 分布走 `knowledge.list` 顶层派生字段 | **解除本格**：新增 `knowledge.graph`，按需拉取（仅打开视图时调用）。图数据（≤200 节点 + ≤1000 边）挂 `knowledge.list` 会让每次列表刷新都现算边，违背诚实资源原则 |
| 用户可见名词（ADR-027 F-UX-NOUN-1） | 只许「分布/分组」，禁「图谱/簇/聚类/知识地图」 | **解禁「图谱」一词，仅限本视图自身**（入口与视图名「分布图谱」）；视图内一律用「分组」，不用「簇」；chips、路由、分布视图既有文案不动 |
| 分类本体/双链/用户可编辑图谱 | 禁 | **仍禁** |

### 3. 为什么这不是被禁的图谱（预先反驳）

F-E-3 的立法意图是防止「系统替用户维护一套图谱本体」。本视图：

1. **没有可维护的图谱实体**——节点/边都从 `cache/knowledge-index.json` 现算，索引本身可丢、可重建；SoT 仍是磁盘 `.md`（F-I-2 不变）。
2. **用户不能编辑**节点位置/边/分组；力导向布局每次现算、不存档。
3. **不进检索回路**——Wave A 扁平打分仍是检索本体；边只用于可视化（与 Obsidian wikilinks 共用 `scoreRelatedKnowledge` 唯一计算点，只放宽各自取边参数）。
4. **LLM 命名/摘要是展示层缓存**——写进索引文件可选 `display` 派生字段（可丢、可重建、不进检索/路由/导出），开关默认关、AI 生成内容必须带标识。

### 4. 诚实边界（不做假装）

- n < 20：`too_few` 诚实态，不渲染空图谱假装有结构（复用 `KNOWLEDGE_CLUSTER_MIN_DOCS` 语义）。
- n > 200：截取**标题字典序前 200 篇**，对截取集重跑聚类（同一算法同一常数），`truncated: true` 且视图顶部披露截取事实；分布视图自身语义不变（chips 仍不渲染）。
- 索引缺失/损坏/重建中：`rebuilding` 诚实态，索引就绪后自动刷新。
- LLM 标注失败/超时：回退高频词标签且无摘要，不报错不阻塞。
- `knowledge.graph` panel-only（同 distribution 门：谓词看 handshake `session.surface === "panel"`，summoner/overlay/tray 必剥）。

### 5. 后果

- 新增 `knowledge.graph` 按需拉取动词（spec §5 wire 契约：`{ status, truncated, nodes, edges, labels }`）；不进 summoner ACL allowlist（默认拒）。
- 图谱边密度实测（≥20 篇 fixture、孤立点比例）随实现 PR 描述记录；若孤立点 >30% 再议合成分地板（spec §3.1）。
- 漂移扳机不变：图谱只读消费派生索引，不触发 ADR-027 评测重证；改 `scoreRelatedKnowledge` 权重/语料则同时触发（wikilinks 与图谱边同源）。
