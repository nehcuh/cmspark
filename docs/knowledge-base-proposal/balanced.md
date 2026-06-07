# CMspark 站点知识库 — 折中方案

## 1. 架构图

```
Extension Layer                    Companion Layer
┌─────────────────┐               ┌──────────────────────────────────────┐
│ Side Panel UI   │◄──WS────────►│ Core Engine                          │
│                 │               │  ThreadManager │ SkillEngine         │
│                 │               │  ToolDispatcher│ HistoryStore        │
└─────────────────┘               └────────┬─────────────────────────────┘
                                           │
                              ┌────────────▼───────────────────────────┐
                              │ Knowledge Base Layer (New)              │
                              │  ┌──────────┐  ┌──────────┐            │
                              │  │Knowledge │  │Knowledge │            │
                              │  │ Index    │  │ Loader   │            │
                              │  │(TF-IDF + │  │(按需加载  │            │
                              │  │Inverted  │  │+ 缓存)   │            │
                              │  │ Index)   │  └────┬─────┘            │
                              │  └────┬─────┘       │                  │
                              │       │      ┌──────▼──────┐           │
                              │       │      │Knowledge    │           │
                              │       │      │ Matcher     │           │
                              │       │      │(site/domain │           │
                              │       │      │/query 路由) │           │
                              │       │      └──────┬──────┘           │
                              │       │             │                  │
                              │  ┌────▼─────┐  ┌────▼──────┐           │
                              │  │knowledge-│  │Knowledge  │           │
                              │  │index.json│  │Cache      │           │
                              │  │(自动重建) │  │(LRU + TTL)│           │
                              │  └──────────┘  └───────────┘           │
                              └────────────────────────────────────────┘
                                           │
                              ┌────────────▼───────────────────────────┐
                              │ Storage: ~/.cmspark-agent/             │
                              │  ├── skills/                           │
                              │  ├── builtin-skills/                   │
                              │  ├── knowledge/          ← New         │
                              │  │   ├── global/                        │
                              │  │   └── sites/                         │
                              │  └── knowledge-index.json  ← New       │
                              └────────────────────────────────────────┘
```

## 2. 核心思路

**扩展现有 Skill 系统来承载知识文档，引入适度的抽象层，平衡短期交付与长期演进。**

### 2.1 索引策略（轻量级，无外部依赖）

- **倒排索引**：词项 → 文档列表（内存 + 持久化 JSON）
- **TF-IDF 向量**：复用现有 `semantic-match.ts` 的 tokenizer
- **Chunk 分割**：按 Markdown H2/H3 标题切分，每 chunk 不超过 800 tokens
- **索引重建**：文件 mtime 变化时增量更新，首次加载或手动触发全量重建

### 2.2 按需加载策略

```
加载层级：
1. 线程启动时：只加载 site 匹配的知识库 metadata（name, tags, 摘要）
2. LLM 调用 query_knowledge(query) 时：
   a. 查询倒排索引获取候选 chunks（Top 10）
   b. TF-IDF 重排序取 Top 3
   c. 从磁盘读取完整 chunk 内容
   d. 加入 LRU 缓存（默认 50 个 chunk）
3. buildSystemPrompt 时：
   a. 注入已加载 chunk 的摘要
   b. 提示 LLM 可调用 query_knowledge 获取更多细节
```

### 2.3 缓存策略

| 缓存层级 | 内容 | 容量 | TTL |
|----------|------|------|-----|
| L1 索引缓存 | 倒排索引 + TF-IDF 向量 | 全部（内存） | 文件变更时重建 |
| L2 Chunk 缓存 | 知识文档 chunk 内容 | 50 chunks | 10 分钟 |
| L3 查询缓存 | query → chunk IDs 映射 | 100 queries | 5 分钟 |

### 2.4 Skill 与 Knowledge 的关系

```
┌─────────────────────────────────────────────┐
│              SkillEngine                      │
│  ┌─────────────┐  ┌───────────────────────┐ │
│  │  Skills     │  │  KnowledgeBase        │ │
│  │  (prompt/   │  │  (文档/知识)           │ │
│  │   tool/     │  │                       │ │
│  │   sub-agent)│  │  - 全局知识库          │ │
│  │             │  │  - 站点知识库          │ │
│  │  use_skill()│  │  - query_knowledge()  │ │
│  └─────────────┘  └───────────────────────┘ │
│           ↕ 通过 KnowledgeIntegration 桥接   │
│  buildSystemPrompt() 统一注入 LLM context    │
└─────────────────────────────────────────────┘
```

### 2.5 知识文档格式（兼容现有 Skill 格式）

```yaml
---
name: "github-pr-workflow"
type: "knowledge_doc"           # 新类型
site: "github.com"              # 站点绑定（可选，空=全局）
tags: ["workflow", "ci", "pr"]  # 用于语义匹配
priority: "high"                # 加载优先级
created_at: "2026-06-01"
updated_at: "2026-06-07"
---

# GitHub PR 工作流
## 创建 PR
1. 点击 "New pull request"
...
```

## 3. 涉及的模块和改动点

### 3.1 新增文件（7 个）

| 文件 | 说明 |
|------|------|
| `companion/src/knowledge/index.ts` | KnowledgeBase 主类，统一入口 |
| `companion/src/knowledge/loader.ts` | 知识文档加载器（markdown 解析、chunk 分割） |
| `companion/src/knowledge/matcher.ts` | 查询匹配器（site/domain/semantic 路由） |
| `companion/src/knowledge/indexer.ts` | 本地索引构建（倒排索引 + TF-IDF） |
| `companion/src/knowledge/cache.ts` | LRU 缓存（知识文档内容 + 索引向量） |
| `companion/src/knowledge/types.ts` | 知识库类型定义 |
| `companion/src/skills/knowledge-integration.ts` | SkillEngine 与 KnowledgeBase 的集成层 |

### 3.2 修改文件（8 个）

| 文件 | 改动内容 |
|------|----------|
| `companion/src/skills/skill-engine.ts` | 1. 新增 `knowledgeBase` 依赖注入<br>2. `buildSystemPrompt()` 扩展：注入匹配到的知识片段<br>3. `matchSkills()` 扩展：同时匹配 knowledge chunks<br>4. 新增 `queryKnowledge(threadId, query)` 方法 |
| `companion/src/llm/adapter.ts` | 1. 新增 `query_knowledge` tool 定义<br>2. chatCreate 中注入 knowledge context<br>3. tool calling loop 中处理 `query_knowledge` |
| `companion/src/bridge/tool-definitions.ts` | 新增 `query_knowledge` tool schema |
| `companion/src/server.ts` | 1. `executeCompanionTool` 新增 `query_knowledge` 分支<br>2. `initServices()` 初始化 KnowledgeBase |
| `companion/src/message-router.ts` | 新增 `knowledge.list` / `knowledge.import` / `knowledge.delete` WS 路由 |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | 新增 knowledge 相关 state 和 actions |
| `chrome-extension/src/sidepanel/components/BottomBar.tsx` | SkillsPanel 扩展：增加 Knowledge 标签页 |
| `chrome-extension/src/sidepanel/components/SkillCraftPanel.tsx` | 扩展：支持从对话提取知识条目 |

### 3.3 数据目录结构

```
~/.cmspark-agent/
├── knowledge/                    # 知识文档存储（New）
│   ├── global/                   # 全局知识库
│   │   ├── react-patterns.md
│   │   └── css-tricks.md
│   ├── sites/                    # 站点专属知识库
│   │   ├── github.com/
│   │   │   ├── pr-workflow.md
│   │   │   └── actions-debug.md
│   │   └── jira.company.com/
│   │       └── ticket-flow.md
│   └── index.json                # 本地索引（自动重建）
├── skills/                       # 现有 skill 文件
├── builtin-skills/
└── ...
```

## 4. 预估开发人天

| 模块 | 人天 | 说明 |
|------|------|------|
| KnowledgeBase Core（indexer + loader + cache） | 3 | 倒排索引、TF-IDF、chunk 分割、LRU 缓存 |
| Knowledge Matcher（site/domain/query 路由） | 2 | 多维度匹配逻辑、优先级排序 |
| SkillEngine 集成 | 2 | buildSystemPrompt 扩展、matchSkills 扩展 |
| LLM Adapter 集成 | 2 | query_knowledge tool、context 注入 |
| Tool Definitions + Server 路由 | 1 | 新增 tool schema、executeCompanionTool |
| Extension UI（Knowledge Panel） | 2 | 知识库浏览、导入、搜索界面 |
| Extension Store 更新 | 1 | state、actions、WS 消息处理 |
| 数据迁移/格式兼容 | 1 | 现有 site_knowledge skill 迁移到 knowledge/ |
| 测试 + 调优 | 2 | 索引精度调优、缓存命中率、边界 case |
| **总计** | **16 人天 ≈ 3.2 周** | 按 1 名全职开发者，含联调 |

## 5. 潜在风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 索引文件过大 | 知识文档增多后 `knowledge-index.json` 可能达数十 MB | 1. 索引分片（按 site/global 拆分）<br>2. 懒加载索引段<br>3. 未来可迁移到 SQLite（已有 better-sqlite3 依赖） |
| Context 窗口膨胀 | 注入过多知识片段导致 LLM context 超限 | 1. 严格限制注入 chunk 数量（最多 3 个）<br>2. chunk 大小限制（800 tokens）<br>3. 优先注入高优先级 + 高匹配度内容 |
| 站点匹配歧义 | 子域名匹配错误（如 `blog.github.com` vs `github.com`） | 1. 支持通配符 `*.github.com`<br>2. 最长匹配优先<br>3. 允许用户手动覆盖 |
| 知识文档与 Skill 概念混淆 | 用户分不清何时用 skill、何时用 knowledge | 1. UI 明确分区（Skills / Knowledge 两个标签页）<br>2. 文档说明：Skill = 可执行流程，Knowledge = 参考文档 |
| 并发写入索引损坏 | 多线程同时导入知识文档导致 index.json 损坏 | 1. 文件锁（单进程 Companion 天然避免）<br>2. 写前复制（先写临时文件再 rename） |
| 未来向量数据库迁移成本 | 本方案基于 TF-IDF，未来若需语义搜索需重构 | 1. 抽象 `KnowledgeIndex` 接口<br>2. 当前实现 `TfidfKnowledgeIndex implements KnowledgeIndex`<br>3. 未来可无缝替换为 `EmbeddingKnowledgeIndex` |

## 6. 演进路线

```
Phase 1 (当前方案, 3周):
  TF-IDF 本地索引 + 按需加载 + LRU 缓存
  ↓
Phase 2 (未来 2-4周):
  可选 SQLite FTS5 全文搜索替代倒排索引
  知识文档版本管理（git-like diff）
  ↓
Phase 3 (未来 4-8周):
  可选 Embedding 语义搜索（本地 onnxruntime 或外部 API）
  知识自动提取（从对话历史自动归档到 knowledge/）
  知识共享（团队知识库同步）
```
