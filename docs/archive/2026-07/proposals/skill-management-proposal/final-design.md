# CMspark 技能管理优化 — 最终架构设计文档

> 版本: 1.0.0 | 日期: 2026-06-07 | 状态: 已评审，待实施

---

## 1. 执行摘要

### 1.1 背景

优化 CMspark 技能管理能力：
1. 技能选择支持三种模式：**自动（默认）、全选、按需勾选**
2. 插件中展示技能应有**站点标识**，按站点分组
3. 解决当前复选框容易让人迷惑的问题

### 1.2 Dynamic Workflow 过程

1. **3 个 Architecture Agent** 独立设计：保守/折中/激进
2. **2 个 Review Agent** 独立审查：Security + Performance
3. **锦标赛两两比较**，综合评分

### 1.3 锦标赛结果

| 对决 | 胜者 | 关键差异 |
|------|------|----------|
| 保守 vs 折中 | **保守** | 安全 8 > 7，性能 8 > 6.5，成本 2.5 < 8 人天 |
| 保守 vs 激进 | **保守** | 安全 8 > 4，性能 8 > 4，成本 2.5 < 26 人天 |
| 折中 vs 激进 | **折中** | 安全 7 > 4，性能 6.5 > 4，成本 8 < 26 人天 |

**最终排名：**
1. **保守方案** — 2 胜 0 负（冠军）
2. **折中方案** — 1 胜 1 负
3. **激进方案** — 0 胜 2 负

### 1.4 推荐结论

**采用保守方案作为第一阶段实现**。与 CMspark "安全稳定化 MVP" 阶段完全匹配：零新依赖、最小攻击面、2.5 人天即可交付，且保留平滑演进路径。

---

## 2. 方案对比矩阵

| 维度 | 保守方案 | 折中方案 | 激进方案 |
|------|:----:|:----:|:----:|
| 安全评分 | **8/10** | 7/10 | 4/10 |
| 性能评分 | **8/10** | 6.5/10 | 4/10 |
| 预估人天 | **2.5** | 8 | 26 |
| 新增文件 | ~0 | ~3 | ~10 |
| 新增依赖 | 0 | 0 | 3+ (embedding, WASM) |
| 冷启动影响 | 无 | 无 | 模型加载 2-10s |
| 首条消息延迟 | 无增加 | <5ms | +50-500ms |
| Context 效率 | 良好 | 风险（auto 技能数膨胀） | TokenBudget 复杂 |
| 智能推荐 | TF-IDF + LLM fallback | TF-IDF + site/tag boost | 多信号融合 + embedding |
| 技能预设 | 不支持 | 轻量 JSON | 完整预设 + 触发条件 |
| 依赖图谱 | 不支持 | 不支持 | DAG + 冲突检测 |
| 站点分组 | 支持 | 支持 | 支持 + 可视化图谱 |

---

## 3. 审查结果汇总

### 3.1 Security Review 关键发现

| 方案 | 最大风险 | 缓解建议 |
|------|---------|----------|
| **保守** | `all` 模式下 LLM 可看到全部技能 metadata（信息泄露） | `all` 模式仍只注入 compact index；site_knowledge 摘要按需过滤 |
| **折中** | Auto 模式技能数量膨胀导致敏感信息交叉泄露；Preset 全局共享跨线程影响 | Auto 模式限制返回数；Preset 增加权限字段；应用 preset 二次确认 |
| **激进** | Embedding 供应链攻击；`dependencies` 字段级联注入；SkillPerformanceTracker 历史数据泄露 | 模型签名验证；`requires` 授权链校验；learning.db 加密或线程隔离 |

### 3.2 Performance Review 关键发现

| 方案 | 最大瓶颈 | 缓解建议 |
|------|---------|----------|
| **保守** | `all` 模式下 context compaction 精度不足 | 监控实际 token 消耗；未来引入精确 token 计数 |
| **折中** | Auto 模式 `active + match + site` 合并后可能超 5 个；tag boost 500 次字符串搜索 | 硬上限 5 个；tag boost 改用预处理索引 |
| **激进** | Embedding 模型冷启动 2-10s；多信号融合延迟叠加；SQLite 聚合查询 100ms+ | 懒加载 embedding；缓存历史聚合结果；信号并行计算 |

---

## 4. 推荐方案详细设计（保守方案增强版）

### 4.1 架构图

```
Extension (Side Panel)
┌─────────────────────────────────────────────┐
│  SkillsPanel                                │
│  ┌─────────────┐  ┌───────────────────────┐ │
│  │ ModeSwitch  │  │ GroupedSkillList      │ │
│  │ [自动|全选|按需]│  │ 全局                 │ │
│  └─────────────┘  │ ├── skill-a           │ │
│                   │ ├── skill-b           │ │
│                   │ *.github.com [站点标识] │ │
│                   │ ├── github-helper     │ │
│                   │ *.company.com         │ │
│                   │ └── sso-guide         │ │
│                   └───────────────────────┘ │
└─────────────────────────────────────────────┘
         │ activeSkillIds + skillSelectionMode
         ▼ WebSocket
Companion (Node.js)
┌─────────────────────────────────────────────┐
│  chat.create → resolveSkillIds(mode)        │
│    auto:  active ∪ matchSkills(msg) ∪ site  │
│         (matchSkills 为 async，双轨策略)     │
│    all:   所有技能 compact index            │
│    manual: active（纯用户选择）              │
│         ↓                                   │
│  buildSystemPrompt(skillIds, hostname)      │
└─────────────────────────────────────────────┘
```

### 4.2 核心设计决策

#### D1. 三种模式映射到 `active_skill_ids` 语义变化

| 模式 | `active_skill_ids` 含义 | 实际注入技能 |
|------|----------------------|------------|
| `auto`（默认） | 用户"固定选择"的基础技能 | `active` ∪ `await matchSkills(msg)` ∪ `getBySite(hostname)` |
| `all` | 被忽略 | 所有技能的 compact index（name + description） |
| `manual` | 用户"唯一选择"的技能 | `active_skill_ids` 本身 |

#### D2. 模式存储位置：线程级

`skill_selection_mode` 存储在 Thread 模型中，每个线程独立设置。切换线程时自动恢复该线程的模式。

#### D3. `all` 模式注入内容：compact index  only

只注入 `- `name`: description` 一行，不是完整 content。LLM 通过 `use_skill(name)` 按需加载。避免 prompt 爆炸。

#### D4. 站点分组展示

```typescript
function groupSkillsBySite(skills: SkillMeta[]): Map<string, SkillMeta[]> {
  const groups = new Map<string, SkillMeta[]>()
  groups.set("全局", skills.filter(s => !s.site))
  for (const skill of skills.filter(s => s.site)) {
    const key = skill.site!
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(skill)
  }
  return sortGroupsByCurrentSite(groups, currentHostname)
}
```

#### D5. 向后兼容

旧线程无 `skill_selection_mode` 时默认 `"auto"`，与现有行为完全一致。

### 4.3 模块与改动点

#### Companion 侧

| 文件 | 改动 | 预估代码量 |
|------|------|----------|
| `companion/src/threads/thread-manager.ts` | Thread 接口新增 `skill_selection_mode`; create() 初始化 | ~10 行 |
| `companion/src/skills/skill-engine.ts` | 新增 `resolveSkillIdsForThread()`; 修改 `buildSystemPrompt()` 接收 skillIds | ~40 行 |
| `companion/src/message-router.ts` | `chat.create` 读取 mode 并调用 resolve; `thread.update` 允许更新 mode | ~20 行 |
| `companion/src/llm/adapter.ts` | 无需改动（skillIds 已解析好） | 0 |

#### Extension 侧

| 文件 | 改动 | 预估代码量 |
|------|------|----------|
| `chrome-extension/src/sidepanel/types.ts` | Thread 接口新增 `skill_selection_mode` | ~3 行 |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | 新增 `skillSelectionMode` state 和 `SET_SKILL_SELECTION_MODE` action | ~20 行 |
| `chrome-extension/src/sidepanel/components/BottomBar.tsx` | SkillsPanel 新增模式切换控件 + 站点分组 + site badge | ~60 行 |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | 同步 `skill_selection_mode` | ~5 行 |

**总代码增量：~158 行，2.5 人天。**

### 4.4 关键接口设计

```typescript
// SkillEngine 扩展
interface SkillEngine {
  // 新增：根据模式解析最终要注入的技能列表
  resolveSkillIdsForThread(
    threadId: string,
    mode?: "auto" | "all" | "manual",
    message?: string,
    hostname?: string
  ): string[]

  // 修改：接收已解析的 skillIds，不再内部读取 active
  buildSystemPrompt(
    threadId: string,
    skillIds: string[],
    hostname?: string
  ): string
}

// Thread 模型扩展
interface Thread {
  // ... existing fields ...
  active_skill_ids: string[]
  skill_selection_mode?: "auto" | "all" | "manual"  // 默认 "auto"
}
```

### 4.5 数据流

**Auto 模式（默认）:**
```
用户输入 "帮我订机票"
→ Extension 发送 chat.create
→ Companion 读取 thread.skill_selection_mode = "auto"
→ resolveSkillIdsForThread("auto"):
    active = ["browse"]  // 用户固定选择
    matched = await matchSkills("帮我订机票") → ["travel-booking"]  // 双轨：TF-IDF 或 LLM
    site = getBySite("booking.com") → ["flight-search"]
    result = ["browse", "travel-booking", "flight-search"]
→ buildSystemPrompt(result) 注入这3个技能
→ LLM 按技能指导执行
```

**All 模式:**
```
用户切换为 "全选"
→ Extension 发送 thread.update(skill_selection_mode: "all")
→ 下次 chat.create
→ resolveSkillIdsForThread("all") → 所有技能 name[]
→ buildSystemPrompt 注入所有技能的 compact index
→ LLM 自行判断 use_skill
```

**Manual 模式:**
```
用户切换为 "按需勾选"，手动勾选 "github-helper"
→ Extension 发送 thread.update(skill_selection_mode: "manual")
→ 下次 chat.create
→ resolveSkillIdsForThread("manual") → ["github-helper"]
→ 只注入 github-helper，不做自动匹配
```

---

## 5. 实施计划

### Phase 1: Companion 后端（1 人天）

| 任务 | 文件 | 说明 |
|------|------|------|
| T1 | `thread-manager.ts` | Thread 模型添加 `skill_selection_mode` |
| T2 | `skill-engine.ts` | 新增 `resolveSkillIdsForThread()`；修改 `buildSystemPrompt()` |
| T3 | `message-router.ts` | `chat.create` 读取 mode；`thread.update` 允许更新 mode |

### Phase 2: Extension 前端（1 人天）

| 任务 | 文件 | 说明 |
|------|------|------|
| T4 | `types.ts` | 新增 `skill_selection_mode` 类型 |
| T5 | `agentStore.tsx` | 新增 state 和 action |
| T6 | `BottomBar.tsx` | 模式切换 + 站点分组 + site badge |
| T7 | `useWebSocket.ts` | 同步 mode |

### Phase 3: 测试联调（0.5 人天）

| 任务 | 说明 |
|------|------|
| T8 | 三种模式切换功能测试 |
| T9 | 站点分组展示验证 |
| T10 | 旧线程兼容性测试 |
| T11 | 端到端：切换模式 → 发送消息 → 验证注入内容 |

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
| `all` 模式下 LLM 看到全部技能 metadata | 中 | 只注入 compact index；site_knowledge 仍按需过滤 |
| `all` 模式下 prompt 过长 | 中 | compact index 非常短（50 个 skill ~500-750 tokens） |
| 旧线程无 `skill_selection_mode` | 低 | 读取时默认 `"auto"` |
| Extension 发送伪造 mode 值 | 低 | `thread.update` 增加 allowedUpdates 校验 |
| Extension-Companion mode 不同步 | 低 | 以 Companion 线程数据为准 |
| 站点分组与 `getBySite` 逻辑不一致 | 低 | 统一使用 `site` 字段存在性判断 |

---

## 7. 演进路径

```
Phase 1 (当前，2.5 人天):
  保守方案：三种模式 + 站点分组展示
  │
  ▼ 若需要技能预设功能
Phase 2 (未来，~5 人天):
  迁移到折中方案：新增 SkillPreset（轻量 JSON）、matchSkills 增强（site/tag boost，LLM fallback 已具备）
  │
  ▼ 若需要智能推荐和技能依赖管理
Phase 3 (未来，~18 人天):
  迁移到激进方案：embedding 语义搜索、依赖图谱、历史成功率学习
```

**关键原则**：每个阶段都是前一阶段的超集，数据格式保持向后兼容。

---

## 8. 附录

### 8.1 原始方案文档

- [保守方案](./conservative.md)
- [折中方案](./balanced.md)
- [激进方案](./aggressive.md)

### 8.2 审查报告

- Security Review：保守 8/10，折中 7/10，激进 4/10
- Performance Review：保守 8/10，折中 6.5/10，激进 4/10

### 8.3 参考文件

- 现有 SkillEngine：`/Users/huchen/Projects/cmspark/companion/src/skills/skill-engine.ts`
- 现有 ThreadManager：`/Users/huchen/Projects/cmspark/companion/src/threads/thread-manager.ts`
- 现有 MessageRouter：`/Users/huchen/Projects/cmspark/companion/src/message-router.ts`
- Extension Store：`/Users/huchen/Projects/cmspark/chrome-extension/src/sidepanel/store/agentStore.tsx`
- Extension BottomBar：`/Users/huchen/Projects/cmspark/chrome-extension/src/sidepanel/components/BottomBar.tsx`
