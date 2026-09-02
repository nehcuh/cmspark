# ADR-026: 知识检索对齐技能 TF-IDF 打分（仍无 embedding）

**日期**: 2026-09-02 | **状态**: Accepted（Wave A）  
**相关**: [Spec: Knowledge Retrieval Scoring](../superpowers/specs/2026-09-02-knowledge-retrieval-scoring-design.md) · [GitHub #273](https://github.com/nehcuh/cmspark/issues/273) · [Knowledge Honesty](../superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md) · [Knowledge CRUD Honesty](../superpowers/specs/2026-08-26-knowledge-crud-honesty-design.md)

---

## 决策

### 1. 一句话

> 知识检索对齐技能侧已有的 TF-IDF 机器：`resolveKnowledgeIdsForThread` 按当轮 message 对全库知识元数据（title + description + tags[≤8]）打分，auto/all 返回有序 top-k（5/8，pinned 全量优先、不被 top-k 截），注入侧加跨文档硬预算 8000 字符；**检索回路零 LLM 调用，无 embedding、无 graph DB**。

### 2. 背景

- auto 模式此前不看当轮 message，只算 `active ∪ getBySite(hostname)`；all 模式返回全库且无跨文档总字符预算（30 篇可灌 ~60000 字符）。
- 技能侧 `matchSkills` 已有 TF-IDF 打分机器（`semantic-match.ts` 的 `tokenize / idfFromDocs / tfidfVec / cosineSimilarity`），N≤200 时全库打分毫秒级。

### 3. 决定（Wave A）

| 项 | 决定 |
|----|------|
| 打分 | cosine(tfidf(query), tfidf(bag))，IDF 当次调用内对全库 knowledge bag 计算；纯本地 |
| 阈值 | `KNOWLEDGE_SCORE_MIN = 0.10` 看**裸 cosine**；`KNOWLEDGE_SITE_BOOST = 0.15` 只改排序、不改阈值 |
| top-k | auto=5 / all=8，只约束非 pinned；pinned 全量返回；并列取 `id`（`k.id \|\| k.name`）字典序最小 |
| 预算 | `KNOWLEDGE_INJECT_BUDGET_CHARS = 8000` 跨文档硬预算，逐篇整灌、放不下截断到剩余额度后停止；`retrieved_sources.chars` 记实际注入字符 |
| 降级 | 打分异常 → 逐字节回退旧选择（仅日志）；空 query → auto 退化 pinned∪site 且每篇只注入 description（≤500）；打分全低于阈值 → 只注入 pinned |
| 开关 | thread 级 `knowledge_smart_match`（undefined = true）；关闭 = 旧选择行为，但**预算仍执行**（预算是安全网，开关不得绕过） |
| 优先级 | 空 query ∧ smartMatch=off 时**开关关优先**：走旧选择 + 全量 summary（预算截断），**不**进 descriptionOnly 退化（descriptionOnly 只在 auto ∧ 智能匹配开 ∧ 空 query 时生效）；all + 空 query 同理保持 legacy 全库 + 预算（spec §2.5 只钉 auto 退化） |
| UI | 「注入全部/所有知识索引」文案改诚实；面板加「智能匹配」开关 |

### 4. 锁定（不重开）

- **不重开 F-E-10 / 锁 C1**：本地 TF-IDF 打分不是 embedding；无 graph DB（含 opt-in 也不开）。
- **检索回路零 LLM**：禁止照搬 `matchSkills` 低分走 `llmRerank` 的双轨设计；知识匹配每轮零 LLM 调用。
- 注入仍走 `sanitizeKnowledgeContent` + `wrapKnowledgeBlock` untrusted wrap（F-S-1/2），排序变化不动信任边界。
- 不改文档 SoT、不改 frontmatter schema、无新持久化、无新 WS 动词、无新依赖。

### 5. 非目标（本 ADR 不含）

- Wave B：聚类分布视图 / 簇路由 / 派生索引 / ADR-2（F-E-3 窄豁免）——见 spec §6/§7，另行交付。
- `searchKnowledge` 死路径接线与否（spec §4：由实现 PR 决定，本 PR 不做）。

### 6. 实现落点

- `companion/src/skills/skill-engine.ts`（常数表 + `resolveKnowledgeIdsForThread` 打分 + `buildSystemPromptWithSources` 预算记账 + descriptionOnly 退化）
- `companion/src/threads/thread-manager.ts` · `companion/src/packs/types.ts` · `companion/src/packs/pack-engine.ts`（`knowledge_smart_match` plumbing）
- `companion/src/message-router.ts`（三调用点透传 query/开关 + fork 拷贝 + update 白名单）· `companion/src/llm/adapter.ts`（`knowledgeDescriptionOnly` 透传）
- `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx`（文案 + 开关）· `agentStore.tsx` / `useWebSocket.ts` / `types.ts`（状态同步）
- 测试：`companion/tests/knowledge-retrieval-scoring.test.ts` · `chrome-extension/tests/knowledge-panel-copy.test.ts`
