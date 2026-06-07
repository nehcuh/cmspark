# CMspark 知识管理优化 — 保守方案

## 1. 架构图

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

## 2. 核心思路

- **不引入新概念**，复用现有 `knowledge/` 目录和 `skill-engine.ts` 的知识库逻辑
- **三种模式映射到 `active_knowledge_ids` 语义变化**：
  - `auto`（默认）: `active_knowledge_ids` 表示"用户固定选择"，叠加 `getBySite(hostname)` 自动匹配
  - `all`: `active_knowledge_ids` 被忽略，所有知识文档的 compact index 注入
  - `manual`: 只在 `active_knowledge_ids` 中选择的文档上进行注入

## 3. 模块改动点

### Companion 侧

| 文件 | 改动 |
|------|------|
| `companion/src/threads/thread-manager.ts` | Thread 接口新增 `knowledge_selection_mode`（默认 "auto"） |
| `companion/src/skills/skill-engine.ts` | 新增 `resolveKnowledgeIdsForThread()` 统一入口；按模式过滤知识 |
| `companion/src/message-router.ts` | `chat.create` 读取 knowledge mode，调用 resolve |
| `companion/src/llm/adapter.ts` | 传入已解析的 knowledgeIds 到 buildSystemPrompt |

### Extension 侧

| 文件 | 改动 |
|------|------|
| `chrome-extension/src/sidepanel/types.ts` | Thread 接口新增 `knowledge_selection_mode` |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | 新增 `knowledgeSelectionMode` state 和 action |
| `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx` | 模式切换 + 站点分组 + site badge |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | 同步 `knowledge_selection_mode` |

## 4. 预估开发人天

| 模块 | 人天 |
|------|------|
| Thread 模型 | 0.2 |
| SkillEngine 模式解析 | 0.5 |
| Message Router | 0.3 |
| Extension Types + Store | 0.3 |
| KnowledgeSubPanel UI | 0.8 |
| WebSocket Hook | 0.1 |
| 测试 + 联调 | 0.5 |
| **总计** | **~2.5 人天** |

## 5. 潜在风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| `all` 模式下 prompt 过长 | 中 | compact index 本身很短 |
| 旧线程无 `knowledge_selection_mode` | 低 | 默认 "auto" |
| 与 skills 概念混淆 | 低 | UI 分区 + 模式命名区分 |
