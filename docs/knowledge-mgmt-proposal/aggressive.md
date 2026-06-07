# CMspark 知识管理优化 — 激进方案

## 1. 架构图

```
Extension (Plasmo + React)
├─ KnowledgePanel 重构版
├─ KnowledgeGraphPanel (知识关联图谱)
├─ KnowledgeModeSelector (自动/全选/按需)
└─ KnowledgePresetPanel (知识组合预设)
        ↓
Companion (Node.js + TS)
├─ KnowledgeBase (独立子系统)
│   ├─ KnowledgeRecommender ← 多信号融合引擎
│   │   ├─ VectorStore (embedding 缓存)
│   │   ├─ LLM Adapter (轻量意图分类)
│   │   └─ SiteMatcher
│   ├─ KnowledgePresetManager
│   ├─ KnowledgeRelationGraph ← 知识关联图谱
│   ├─ KnowledgePerformanceTracker ← 历史成功率学习
│   └─ ContextBuilder + TokenBudgetManager
└─ Message Router (新增 knowledge.recommend 等路由)
        ↓
Data Layer
├─ knowledge/ / builtin-skills/
├─ knowledge-presets.json
├─ knowledge-embeddings.json
└─ knowledge-learning.db
```

## 2. 核心设计

### 2.1 智能推荐引擎 — 多信号融合

```
最终得分 = w1*语义相似度 + w2*站点匹配度 + w3*历史成功率 + w4*上下文连贯性
```

- **语义相似度**: embedding-based（本地缓存），fallback 到 TF-IDF
- **站点匹配度**: hostname 匹配 + 历史同站点成功记录
- **历史成功率**: 从 HistoryStore 聚合 success_rate / avg_duration
- **上下文连贯性**: 当前 thread 已激活知识的协同关系

### 2.2 知识关联图谱

```yaml
---
name: github-pr-workflow
relations:
  - knowledge: github-actions-guide
    type: related
    weight: 0.8
  - knowledge: git-basics
    type: prerequisite
    weight: 0.5
---
```

运行时行为：related 协同推荐、prerequisite 自动级联、conflicts 互斥检测。

### 2.3 Token 预算管理

Auto 模式下限制 system prompt 知识 token 占用：总预算 = context_window 的 20%，自动决定完整内容注入 vs metadata index。

## 3. 模块改动点

### Companion 侧（~12 个文件）

| 文件 | 类型 | 说明 |
|------|------|------|
| `knowledge/recommender.ts` | 新建 | 多信号融合引擎 |
| `knowledge/vector-store.ts` | 新建 | Embedding 缓存管理 |
| `knowledge/relation-graph.ts` | 新建 | 关联图谱 + 冲突检测 |
| `knowledge/preset-manager.ts` | 新建 | 预设 CRUD |
| `knowledge/performance-tracker.ts` | 新建 | 历史成功率聚合 |
| `knowledge/types.ts` | 新建 | 统一类型定义 |
| `skill-engine.ts` | 大幅重构 | 模式支持、调用 Recommender |
| `message-router.ts` | 修改 | 新增 knowledge.recommend 等路由 |
| `history/store.ts` | 扩展 | 知识使用记录索引 |
| `thread-manager.ts` | 扩展 | 新增 knowledge_selection_mode |

### Extension 侧（~7 个文件）

| 文件 | 类型 | 说明 |
|------|------|------|
| `agentStore.tsx` | 扩展 | 新增 mode / presets / presetId |
| `KnowledgePanel.tsx` | 重构 | 升级为独立完整面板 |
| `KnowledgeModeSelector.tsx` | 新建 | 三态切换器 |
| `KnowledgePresetPanel.tsx` | 新建 | 预设卡片管理 |
| `KnowledgeGraphPanel.tsx` | 新建 | 知识关联图谱可视化 |
| `KnowledgeSubPanel.tsx` | 修改 | 入口调整 |
| `types.ts` | 扩展 | 新增类型 |

## 4. 预估开发人天

| 阶段 | 任务 | 人天 |
|------|------|------|
| Phase 1: 基础设施 | 类型定义、VectorStore、PerformanceTracker | 4.5 |
| Phase 2: 核心引擎 | Recommender、RelationGraph、PresetManager、KnowledgeBase 重构 | 8.5 |
| Phase 3: 通信层 | Message Router、Adapter | 1.5 |
| Phase 4: 前端 | ModeSelector、PresetPanel、GraphPanel、KnowledgePanel 重构 | 7.5 |
| Phase 5: 测试调优 | 单元测试、集成测试、性能调优 | 4.5 |
| **总计** | | **~26 人天** |

## 5. 潜在风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Embedding 模型依赖（native 代码） | 高 | 优先纯 JS WASM 方案；提供 TF-IDF fallback |
| 推荐质量不可控 | 高 | Auto 模式初期 = "推荐 + 用户确认" |
| Token 预算超支 | 高 | TokenBudgetManager 硬限制 + 自动降级 |
| 关联图谱循环引用 | 中 | 加载时检测 DAG |
| 历史数据稀疏（冷启动） | 中 | 先验概率 + 时间衰减 + 相似知识泛化 |
| Schema 迁移 | 低 | 缺失字段默认值 |
