# CMspark 技能管理优化 — 保守方案

## 1. 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Extension (Side Panel)                        │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐ │
│  │ SkillsPanel │───▶│  ModeSwitch │───▶│  GroupedSkillList   │ │
│  │  (新增模式)  │    │ auto/all/man│    │ global / site分组   │ │
│  └─────────────┘    └─────────────┘    └─────────────────────┘ │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐    activeSkillIds + skillSelectionMode        │
│  │  agentStore │──────────────────────────────────────────────▶│
│  │  (新增mode) │                                               │
│  └─────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                      Companion (Node.js)                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐ │
│  │ chat.create │───▶│ resolveSkill│───▶│ buildSystemPrompt   │ │
│  │  (message-  │    │ Ids(mode)   │    │  (按模式过滤)        │ │
│  │   router)   │    │             │    │                     │ │
│  └─────────────┘    └─────────────┘    └─────────────────────┘ │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐ │
│  │ SkillEngine │───▶│matchSkills()│    │ getActiveForThread()│ │
│  │             │    │ (复用现有)   │    │ (按模式过滤)         │ │
│  └─────────────┘    └─────────────┘    └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 核心思路

- **不引入新概念**，只扩展已有字段的含义
- **三种模式映射到 `active_skill_ids` 的语义变化**：
  - `auto`（默认）: `active_skill_ids` 表示"用户固定选择的技能"，auto-matched 技能动态叠加
  - `all`: `active_skill_ids` 被忽略，所有技能的 metadata 注入 system prompt
  - `manual`: 只在 `active_skill_ids` 中选择的技能上进行匹配/注入

## 3. 模块改动点

### Companion 侧

| 文件 | 改动 |
|------|------|
| `companion/src/threads/thread-manager.ts` | Thread 接口新增 `skill_selection_mode: "auto" \| "all" \| "manual"` |
| `companion/src/skills/skill-engine.ts` | 新增 `resolveSkillIdsForThread()` 统一入口；按模式过滤 |
| `companion/src/message-router.ts` | `chat.create` 读取 mode，调用 resolve |
| `companion/src/llm/adapter.ts` | 无需改动（skillIds 已解析好） |

### Extension 侧

| 文件 | 改动 |
|------|------|
| `chrome-extension/src/sidepanel/types.ts` | Thread 接口新增 `skill_selection_mode` |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | 新增 `skillSelectionMode` state 和 action |
| `chrome-extension/src/sidepanel/components/BottomBar.tsx` | 模式切换 + 站点分组 + site badge |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | 同步 `skill_selection_mode` |

## 4. 预估开发人天

| 模块 | 人天 |
|------|------|
| Thread 模型 | 0.2 |
| SkillEngine 模式解析 | 0.5 |
| Message Router | 0.3 |
| Extension Types + Store | 0.3 |
| SkillsPanel UI | 0.8 |
| WebSocket Hook | 0.1 |
| 测试 + 联调 | 0.5 |
| **总计** | **~2.5 人天** |

## 5. 潜在风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| `all` 模式下 prompt 过长 | 中 | compact index 本身很短，共用现有 context compaction |
| 旧线程无 `skill_selection_mode` | 低 | 读取时默认 `"auto"` |
| Extension 和 Companion mode 不同步 | 低 | 以 Companion 线程数据为准 |
