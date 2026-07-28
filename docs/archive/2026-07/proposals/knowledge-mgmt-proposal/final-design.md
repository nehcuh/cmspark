# CMspark 知识管理优化 — 最终架构设计文档

> 版本: 1.0.0 | 日期: 2026-06-07 | 状态: 已评审，待实施

---

## 1. 执行摘要

### 1.1 背景

优化 CMspark 知识管理能力，**效仿技能管理的设计**：
1. 知识选择支持三种模式：**自动（默认）、全选、按需**
2. 插件中按**站点分组展示**知识文档
3. 解决当前知识管理不够直观的问题

### 1.2 Dynamic Workflow 过程

1. **3 个 Architecture Agent** 独立设计：保守/折中/激进
2. **2 个 Review Agent** 独立审查：Security + Performance
3. **锦标赛两两比较**，综合评分

### 1.3 锦标赛结果

| 对决 | 胜者 | 关键差异 |
|------|------|----------|
| 保守 vs 折中 | **保守** | 安全 8 > 6.5，性能 8 > 6.5，成本 2.5 < 9 人天 |
| 保守 vs 激进 | **保守** | 安全 8 > 4，性能 8 > 4，成本 2.5 < 26 人天 |
| 折中 vs 激进 | **折中** | 安全 6.5 > 4，性能 6.5 > 4，成本 9 < 26 人天 |

**最终排名：**
1. **保守方案** — 2 胜 0 负（冠军）
2. **折中方案** — 1 胜 1 负
3. **激进方案** — 0 胜 2 负

### 1.4 推荐结论

**采用保守方案作为第一阶段实现**。与 CMspark "安全稳定化 MVP" 阶段完全匹配：零新依赖、最小攻击面、2.5 人天即可交付。知识库已在上次迭代中建立了基础设施（knowledge/ 目录、site-matcher、content-sanitizer），保守方案仅在此基础上添加模式管理和站点分组展示。

---

## 2. 方案对比矩阵

| 维度 | 保守方案 | 折中方案 | 激进方案 |
|------|:----:|:----:|:----:|
| 安全评分 | **8/10** | 6.5/10 | 4/10 |
| 性能评分 | **8/10** | 6.5/10 | 4/10 |
| 预估人天 | **2.5** | 9 | 26 |
| 新增文件 | ~0 | ~6 | ~10 |
| 新增依赖 | 0 | 0 | 3+ (embedding, WASM) |
| 冷启动影响 | 无 | 无 | 模型加载 2-10s |
| 首条消息延迟 | 无增加 | <5ms | +50-500ms |
| Context 效率 | 良好 | 风险（auto 知识数膨胀） | TokenBudget 复杂 |
| 智能推荐 | getBySite 复用 | TF-IDF + 倒排索引 | 多信号融合 + embedding |
| 知识预设 | 不支持 | 轻量 JSON | 完整预设 + 触发条件 |
| 关联图谱 | 不支持 | 不支持 | 知识关联 + 可视化 |
| 站点分组 | 支持 | 支持 | 支持 + 可视化图谱 |

---

## 3. 审查结果汇总

### 3.1 Security Review 关键发现

| 方案 | 最大风险 | 缓解建议 |
|------|---------|----------|
| **保守** | `all` 模式下 LLM 可看到全部知识 metadata（信息泄露） | `all` 模式只注入 compact index；site_knowledge 摘要按需过滤 |
| **折中** | `knowledge-index.json` 可能被篡改导致推荐偏差；index 文件无完整性校验 | 写前复制；未来引入 checksum |
| **激进** | Embedding 供应链攻击；`knowledge-learning.db` 泄露操作历史；vector store membership inference | 模型签名验证；learning.db 加密或线程隔离 |

### 3.2 Performance Review 关键发现

| 方案 | 最大瓶颈 | 缓解建议 |
|------|---------|----------|
| **保守** | `all` 模式下 context compaction 精度不足 | 监控实际 token 消耗；未来引入精确 token 计数 |
| **折中** | `knowledge-index.json` 膨胀后 JSON 解析延迟；倒排索引全内存 | 索引分片、懒加载、未来迁移 SQLite |
| **激进** | Embedding 模型冷启动 2-10s；多信号融合延迟叠加；SQLite 聚合查询 100ms+ | 懒加载 embedding；缓存历史聚合结果 |

---

## 4. 推荐方案详细设计（保守方案增强版）

### 4.1 架构图

```
Extension (Side Panel)
┌─────────────────────────────────────────────┐
│  KnowledgeSubPanel                          │
│  ┌─────────────┐  ┌───────────────────────┐ │
│  │ ModeSwitch  │  │ GroupedKnowledgeList  │ │
│  │ [自动|全选|按需]│  │ 全局                 │ │
│  └─────────────┘  │ ├── doc-a             │ │
│                   │ ├── doc-b             │ │
│                   │ *.github.com [站点标识] │ │
│                   │ ├── github-guide      │ │
│                   │ *.company.com         │ │
│                   │ └── sso-guide         │ │
│                   └───────────────────────┘ │
└─────────────────────────────────────────────┘
         │ activeKnowledgeIds + knowledgeSelectionMode
         ▼ WebSocket
Companion (Node.js)
┌─────────────────────────────────────────────┐
│  chat.create → resolveKnowledgeIds(mode)    │
│    auto:  active ∪ getBySite(hostname)      │
│    all:   所有知识 compact index            │
│    manual: active（纯用户选择）              │
│         ↓                                   │
│  buildSystemPrompt(knowledgeIds, hostname)  │
└─────────────────────────────────────────────┘
```

### 4.2 核心设计决策

#### D1. 三种模式映射到 `active_knowledge_ids` 语义变化

| 模式 | `active_knowledge_ids` 含义 | 实际注入知识 |
|------|----------------------|------------|
| `auto`（默认） | 用户"固定选择"的基础知识 | `active` ∪ `getBySite(hostname)` |
| `all` | 被忽略 | 所有知识的 compact index |
| `manual` | 用户"唯一选择"的知识 | `active_knowledge_ids` 本身 |

#### D2. 模式存储位置：线程级

`knowledge_selection_mode` 存储在 Thread 模型中，每个线程独立设置。切换线程时自动恢复该线程的模式。与 `skill_selection_mode` 完全对称。

#### D3. `all` 模式注入内容：compact index only

只注入 `- `name`: description` 一行，不是完整 content。LLM 通过 `use_skill(name)` 按需加载。避免 prompt 爆炸。

#### D4. 站点分组展示

```typescript
function groupKnowledgeBySite(knowledge: SkillMeta[]): Map<string, SkillMeta[]> {
  const groups = new Map<string, SkillMeta[]>()
  groups.set("全局", knowledge.filter(k => !k.site))
  for (const k of knowledge.filter(k => k.site)) {
    const key = k.site!
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(k)
  }
  return sortGroupsByCurrentSite(groups, currentHostname)
}
```

#### D5. 向后兼容

旧线程无 `knowledge_selection_mode` 时默认 `"auto"`，与现有行为完全一致。

### 4.3 模块与改动点

#### Companion 侧

| 文件 | 改动 | 预估代码量 |
|------|------|----------|
| `companion/src/threads/thread-manager.ts` | Thread 接口新增 `knowledge_selection_mode`; create() 初始化 | ~10 行 |
| `companion/src/skills/skill-engine.ts` | 新增 `resolveKnowledgeIdsForThread()`; 修改 `buildSystemPrompt()` 接收 knowledgeIds | ~40 行 |
| `companion/src/message-router.ts` | `chat.create` 读取 knowledge mode 并调用 resolve; `thread.update` 允许更新 mode | ~20 行 |
| `companion/src/llm/adapter.ts` | 传入已解析的 knowledgeIds | ~5 行 |

#### Extension 侧

| 文件 | 改动 | 预估代码量 |
|------|------|----------|
| `chrome-extension/src/sidepanel/types.ts` | Thread 接口新增 `knowledge_selection_mode` | ~3 行 |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | 新增 `knowledgeSelectionMode` state 和 `SET_KNOWLEDGE_SELECTION_MODE` action | ~20 行 |
| `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx` | 模式切换控件 + 站点分组 + site badge | ~60 行 |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | 同步 `knowledge_selection_mode` | ~5 行 |

**总代码增量：~163 行，2.5 人天。**

### 4.4 关键接口设计

```typescript
// SkillEngine 扩展
interface SkillEngine {
  // 新增：根据模式解析最终要注入的知识列表
  resolveKnowledgeIdsForThread(
    threadId: string,
    mode?: "auto" | "all" | "manual",
    hostname?: string
  ): string[]

  // 修改：接收已解析的 knowledgeIds，不再内部读取 active
  buildSystemPrompt(
    threadId: string,
    skillIds: string[],
    knowledgeIds: string[],
    hostname?: string
  ): string
}

// Thread 模型扩展
interface Thread {
  // ... existing fields ...
  skill_selection_mode?: "auto" | "all" | "manual"
  knowledge_selection_mode?: "auto" | "all" | "manual"  // 默认 "auto"
}
```

### 4.5 数据流

**Auto 模式（默认）:**
```
用户输入 "帮我订机票"
→ Extension 发送 chat.create
→ Companion 读取 thread.knowledge_selection_mode = "auto"
→ resolveKnowledgeIdsForThread("auto"):
    active = []  // 用户固定选择（若无则为空）
    site = getBySite("booking.com") → ["flight-booking-guide"]
    result = ["flight-booking-guide"]
→ buildSystemPrompt 注入该知识摘要
→ LLM 按知识指导执行
```

**All 模式:**
```
用户切换为 "全选"
→ Extension 发送 thread.update(knowledge_selection_mode: "all")
→ 下次 chat.create
→ resolveKnowledgeIdsForThread("all") → 所有知识 name[]
→ buildSystemPrompt 注入所有知识的 compact index
→ LLM 自行判断 use_skill
```

**Manual 模式:**
```
用户切换为 "按需勾选"，手动勾选 "github-helper"
→ Extension 发送 thread.update(knowledge_selection_mode: "manual")
→ 下次 chat.create
→ resolveKnowledgeIdsForThread("manual") → ["github-helper"]
→ 只注入 github-helper，不做自动站点匹配
```

---

## 5. 实施计划

### Phase 1: Companion 后端（1 人天）

| 任务 | 文件 | 说明 |
|------|------|------|
| T1 | `thread-manager.ts` | Thread 模型添加 `knowledge_selection_mode` |
| T2 | `skill-engine.ts` | 新增 `resolveKnowledgeIdsForThread()`；修改 `buildSystemPrompt()` |
| T3 | `message-router.ts` | `chat.create` 读取 knowledge mode；`thread.update` 允许更新 mode |
| T4 | `adapter.ts` | 传入已解析的 knowledgeIds |

### Phase 2: Extension 前端（1 人天）

| 任务 | 文件 | 说明 |
|------|------|------|
| T5 | `types.ts` | 新增 `knowledge_selection_mode` 类型 |
| T6 | `agentStore.tsx` | 新增 state 和 action |
| T7 | `KnowledgeSubPanel.tsx` | 模式切换 + 站点分组 + site badge |
| T8 | `useWebSocket.ts` | 同步 mode |

### Phase 3: 测试联调（0.5 人天）

| 任务 | 说明 |
|------|------|
| T9 | 三种模式切换功能测试 |
| T10 | 站点分组展示验证 |
| T11 | 与技能管理模式并存验证（skill_mode 和 knowledge_mode 互不干扰） |
| T12 | 旧线程兼容性测试 |

### 里程碑

```
Day 1: Phase 1 完成（后端）
Day 2: Phase 2 完成（前端）
Day 2.5: Phase 3 完成（测试）→ 可演示
```

---

## 6. 风险缓解

| 风险 | 严重度 | 缓解措施 |
|------|--------|----------|
| `all` 模式下 LLM 看到全部知识 metadata | 中 | 只注入 compact index；site_knowledge 仍按需过滤 |
| `all` 模式下 prompt 过长 | 中 | compact index 非常短（50 个知识 ~500-750 tokens） |
| 旧线程无 `knowledge_selection_mode` | 低 | 读取时默认 `"auto"` |
| 与 skills 管理模式冲突 | 低 | 独立字段命名：`skill_selection_mode` vs `knowledge_selection_mode` |
| Extension-Companion mode 不同步 | 低 | 以 Companion 线程数据为准 |
| 站点分组与 `getBySite` 逻辑不一致 | 低 | 统一使用 `site` 字段存在性判断 |

---

## 7. 演进路径

```
Phase 1 (当前，2.5 人天):
  保守方案：三种模式 + 站点分组展示
  │
  ▼ 若需要增强知识匹配质量
Phase 2 (未来，~6 人天):
  迁移到折中方案：引入 KnowledgeBase 子系统、倒排索引、chunk 分割、LRU 缓存
  │
  ▼ 若需要语义搜索和知识关联
Phase 3 (未来，~17 人天):
  迁移到激进方案：embedding 语义搜索、知识关联图谱、历史成功率学习
```

**关键原则**：每个阶段都是前一阶段的超集，数据格式保持向后兼容（Markdown + YAML frontmatter）。

---

## 8. 附录

### 8.1 原始方案文档

- [保守方案](./conservative.md)
- [折中方案](./balanced.md)
- [激进方案](./aggressive.md)

### 8.2 审查报告

- Security Review：保守 8/10，折中 6.5/10，激进 4/10
- Performance Review：保守 8/10，折中 6.5/10，激进 4/10

### 8.3 参考文件

- 现有 SkillEngine：`/Users/huchen/Projects/cmspark/companion/src/skills/skill-engine.ts`
- 现有 ThreadManager：`/Users/huchen/Projects/cmspark/companion/src/threads/thread-manager.ts`
- 现有 KnowledgeSubPanel：`/Users/huchen/Projects/cmspark/chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx`
- 技能管理最终设计：`/Users/huchen/Projects/cmspark/docs/skill-management-proposal/final-design.md`
