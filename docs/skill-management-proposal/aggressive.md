# CMspark 技能管理优化 — 激进方案

## 1. 架构图

```
Extension (Plasmo + React)
├─ SkillPanel 重构版
├─ SkillGraphPanel (站点关联图谱)
├─ SkillModeSelector (自动/全选/按需)
└─ SkillPresetPanel (组合预设管理)
        ↓
Companion (Node.js + TS)
├─ SkillEngine (增强版)
│   ├─ SkillRecommender ← 多信号融合引擎
│   │   ├─ VectorStore (embedding 缓存)
│   │   ├─ LLM Adapter (轻量意图分类)
│   │   └─ SiteMatcher
│   ├─ SkillPresetManager
│   ├─ SkillDependencyGraph ← DAG 验证 + 冲突检测
│   ├─ SkillPerformanceTracker ← 历史成功率学习
│   └─ ContextBuilder + TokenBudgetManager
└─ Message Router (新增 skill.recommend 等路由)
        ↓
Data Layer
├─ skills/ / builtin-skills/ / knowledge/
├─ skill-presets.json
├─ skill-embeddings.json
└─ skill-learning.db
```

## 2. 核心设计

### 2.1 智能推荐引擎 — 多信号融合

```
最终得分 = w1*语义相似度 + w2*站点匹配度 + w3*历史成功率 + w4*上下文连贯性 + w5*依赖增益
```

- **语义相似度**: embedding-based（本地缓存），fallback 到 TF-IDF
- **站点匹配度**: hostname 匹配 + 历史同站点成功记录
- **历史成功率**: 从 HistoryStore 聚合 success_rate / avg_duration
- **上下文连贯性**: 当前 thread 已激活 skill 的协同关系
- **依赖增益**: A 依赖 B 时 B 获得 boost

### 2.2 技能依赖图谱

```yaml
---
name: export-report
dependencies:
  - skill: sso-login
    type: requires
  - skill: data-validation
    type: enhances
    weight: 0.3
  - skill: silent-mode
    type: conflicts_with
---
```

运行时行为：requires 自动级联、enhances 协同 boost、conflicts_with 互斥检测。

### 2.3 技能组合预设

```typescript
interface SkillPreset {
  id: string
  name: string
  skillIds: string[]
  mode: "auto" | "all" | "manual"
  configOverride?: { temperature?: number }
  triggers?: { sites?: string[]; keywords?: string[] }
}
```

### 2.4 Token 预算管理

Auto 模式下限制 system prompt 技能 token 占用：总预算 = context_window 的 20%，自动决定完整内容注入 vs metadata index。

## 3. 模块改动点

### Companion 侧（~12 个文件）

| 文件 | 类型 | 说明 |
|------|------|------|
| `skill-engine.ts` | 大幅重构 | 模式支持、调用 Recommender |
| `skill-recommender.ts` | 新建 | 多信号融合引擎 |
| `vector-store.ts` | 新建 | Embedding 缓存管理 |
| `skill-dependency-graph.ts` | 新建 | 依赖图谱 + DAG 验证 |
| `skill-preset-manager.ts` | 新建 | 预设 CRUD |
| `skill-performance-tracker.ts` | 新建 | 历史成功率聚合 |
| `skill-types.ts` | 新建/提取 | 统一类型定义 |
| `message-router.ts` | 修改 | 新增 skill.recommend 等路由 |
| `history/store.ts` | 扩展 | skill 使用记录索引 |
| `thread-manager.ts` | 扩展 | 新增 skill_selection_mode / skill_preset_id |

### Extension 侧（~7 个文件）

| 文件 | 类型 | 说明 |
|------|------|------|
| `agentStore.tsx` | 扩展 | 新增 mode / presets / presetId |
| `SkillPanel.tsx` | 重构 | 升级为独立完整面板 |
| `SkillModeSelector.tsx` | 新建 | 三态切换器 |
| `SkillPresetPanel.tsx` | 新建 | 预设卡片管理 |
| `SkillGraphPanel.tsx` | 新建 | 站点关联图谱可视化 |
| `BottomBar.tsx` | 修改 | 入口调整 |
| `types.ts` | 扩展 | 新增类型 |

## 4. 预估开发人天

| 阶段 | 任务 | 人天 |
|------|------|------|
| Phase 1: 基础设施 | 类型定义、VectorStore、PerformanceTracker | 4.5 |
| Phase 2: 核心引擎 | Recommender、DependencyGraph、PresetManager、SkillEngine 重构 | 8.5 |
| Phase 3: 通信层 | Message Router、Adapter | 1.5 |
| Phase 4: 前端 | ModeSelector、PresetPanel、GraphPanel、SkillPanel 重构 | 7.5 |
| Phase 5: 测试调优 | 单元测试、集成测试、性能调优 | 4.5 |
| **总计** | | **~26 人天** |

## 5. 潜在风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Embedding 模型依赖（native 代码） | 高 | 优先纯 JS WASM 方案；提供 TF-IDF fallback |
| 推荐质量不可控 | 高 | Auto 模式初期 = "推荐 + 用户确认" |
| Token 预算超支 | 高 | TokenBudgetManager 硬限制 + 自动降级 |
| 依赖图谱循环依赖 | 中 | DependencyValidator 加载时检测 DAG |
| 历史数据稀疏（冷启动） | 中 | 先验概率 + 时间衰减 + 相似 skill 泛化 |
| Schema 迁移 | 低 | 缺失字段默认值 |
