# CMspark 站点知识库 — 最终架构设计文档

> 版本: 1.0.0 | 日期: 2026-06-07 | 状态: 已评审，待实施

---

## 1. 执行摘要

### 1.1 背景

为 CMspark 添加**站点知识库**功能：按站点按需读取知识文档（Markdown）和技能 metadata，支持全局知识库和技能按需加载。

### 1.2 Dynamic Workflow 过程

本次设计采用**锦标赛模式**进行方案选型：

1. **3 个 Architecture Agent** 独立设计：保守方案（最小改动）、折中方案（平衡演进）、激进方案（长期最优）
2. **2 个 Review Agent** 独立审查：Security Reviewer（安全维度）、Performance Reviewer（性能维度）
3. **锦标赛两两比较**，综合评分选出最优方案

### 1.3 锦标赛结果

| 对决 | 胜者 | 关键差异 |
|------|------|----------|
| 保守 vs 折中 | **保守** | 安全 7.0 > 6.5，性能 8.3 > 7.7，成本 4 < 16 人天 |
| 保守 vs 激进 | **保守** | 安全 7.0 > 4.0，性能 8.3 > 5.3，成本 4 < 25 人天 |
| 折中 vs 激进 | **折中** | 安全 6.5 > 4.0，性能 7.7 > 5.3，成本 16 < 25 人天 |

**最终排名：**
1. **保守方案** — 2 胜 0 负（冠军）
2. **折中方案** — 1 胜 1 负
3. **激进方案** — 0 胜 2 负

### 1.4 推荐结论

**采用保守方案作为第一阶段实现**，原因：
- 与 CMspark "安全稳定化 MVP" 阶段目标完全匹配
- 零新依赖、零新子系统，最小化攻击面
- 首条消息无延迟惩罚，用户体验最优
- 4 人天即可交付，快速验证需求
- 保留平滑演进路径（未来可无缝升级到折中/激进方案）

---

## 2. 方案对比矩阵

| 维度 | 保守方案 | 折中方案 | 激进方案 |
|------|---------|---------|---------|
| **安全评分** | 7.0/10 | 6.5/10 | 4.0/10 |
| **性能评分** | 8.3/10 | 7.7/10 | 5.3/10 |
| **预估人天** | 4 | 16 | 25 |
| **新增文件** | ~3 | ~7 | ~20 |
| **新增依赖** | 0 | 0 | 5+ (sqlite-vec, onnxruntime, etc.) |
| **冷启动影响** | 无 | JSON 解析 100-500ms | 模型加载 3-10s |
| **内存增量** | ~0 | 50-100MB | 100-300MB |
| **Context 效率** | 摘要 500 tokens | Chunk Top-3, 2400 tokens | Token budget 自适应 |
| **检索扩展性** | O(N) 线性扫描 | O(1) 倒排索引 | O(log N) 向量搜索 |
| **知识文档量** | < 200 适用 | < 5000 适用 | 10万+ 适用 |
| **自动发现** | 不支持 | 不支持 | 支持（爬虫+LLM提取） |
| **版本管理** | 不支持 | 不支持 | Git 版本控制 |
| **语义搜索** | TF-IDF + LLM fallback | TF-IDF + 倒排索引 | Embedding + BM25 |

---

## 3. 审查结果汇总

### 3.1 Security Review 关键发现

| 方案 | 最大风险 | 缓解建议 |
|------|---------|----------|
| **保守** | Prompt injection（知识文档内容无净化注入 system prompt） | 注入前增加内容过滤层，限制摘要长度 |
| **折中** | `query_knowledge` tool 返回内容无净化，LLM 可跨站点查询 | 限制查询范围为当前站点 + global，增加内容净化 |
| **激进** | Native 依赖（sqlite-vec/onnxruntime）+ 数据外泄通道（远程 embedding/Git sync/爬虫） | 所有远程功能默认关闭，Crawler 隔离 Cookie，分阶段实施 |

### 3.2 Performance Review 关键发现

| 方案 | 最大瓶颈 | 缓解建议 |
|------|---------|----------|
| **保守** | TF-IDF 已升级为双轨策略（高置信度走 TF-IDF，低置信度走 LLM），文档量 > 500 时 TF-IDF 部分可能成瓶颈 | 当前阶段非问题；LLM fallback 解决精度问题，未来可平滑替换为索引 |
| **折中** | `knowledge-index.json` 膨胀导致冷启动延迟 | 索引分片、懒加载、未来迁移到 SQLite |
| **激进** | Embedding 模型 80MB 冷启动 + sqlite-vec 兼容性 | 本地模型延迟不可接受，远程 API 引入隐私风险 |

### 3.3 通用建议（适用于所有方案）

1. **Prompt Injection 防护**：知识文档内容注入 LLM context 前，过滤已知 injection 模式
2. **权限模型预留**：即使单用户场景，接口中预留 `scope` / `site` 参数
3. **内容签名**：知识文档支持可选 `checksum` 字段
4. **审计日志**：知识文档操作记录到 `history.db`

---

## 4. 推荐方案详细设计（保守方案增强版）

### 4.1 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Extension                          │
│  ┌─────────────┐    ┌─────────────────────────────────────┐  │
│  │ Side Panel  │◄──►│  SkillPanel（新增 Knowledge 标签页）  │  │
│  │             │    │  - 浏览站点/全局知识文档              │  │
│  │             │    │  - 导入/删除操作（复用现有组件）       │  │
│  └─────────────┘    └─────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────────────────┘
                      │ WebSocket
┌─────────────────────▼───────────────────────────────────────┐
│                      Companion                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  SkillEngine（扩展，无新子系统）                           │ │
│  │                                                         │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │ │
│  │  │ loadFromDir │  │ getBySite   │  │ matchSkills            │ │ │
│  │  │ (已存在)     │  │ (已存在)    │  │ (已存在 TF-IDF+LLM)    │ │ │
│  │  └─────────────┘  └──────┬──────┘  └─────────────────┘ │ │
│  │                          │                             │ │
│  │  ┌─────────────┐  ┌──────▼──────┐  ┌─────────────────┐ │ │
│  │  │ getByGlob   │  │ buildSystem │  │ lazyLoadContent │ │ │
│  │  │ (新增通配符) │  │ Prompt      │  │ (新增按需读取)   │ │ │
│  │  │  *.github   │  │ (扩展注入)   │  │                 │ │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
│                              │                                │
│  ┌───────────────────────────▼────────────────────────────┐  │
│  │  Data: ~/.cmspark-agent/                                │  │
│  │  ├── skills/        (prompt_template, tool_chain...)    │  │
│  │  ├── builtin-skills/                                    │  │
│  │  └── knowledge/  ← 新增，但结构与 skills/ 完全一致        │  │
│  │      ├── global/                                        │  │
│  │      │   └── onboarding-guide.md                        │  │
│  │      └── sites/                                         │  │
│  │          └── github.com/                                │  │
│  │              ├── workflow-guide/ (SKILL.md + resources) │  │
│  │              └── pr-best-practices.md                   │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### 4.2 核心设计决策

#### D1. 最大化复用现有 SkillEngine

知识文档在存储格式、加载机制、匹配逻辑上与 Skill 完全一致，仅在用途上区分：
- **Skill** = 可执行指令（prompt_template / tool_chain / sub_agent）
- **Knowledge** = 参考文档（site_knowledge / domain_knowledge 的扩展）

#### D2. 目录结构约定

```
~/.cmspark-agent/knowledge/
├── global/                   # 全局知识库（所有站点可用）
│   ├── coding-conventions.md
│   └── company-onboarding.md
└── sites/                    # 站点专属知识库
    ├── github.com/
    │   ├── pr-workflow.md
    │   └── actions-troubleshooting/
    │       ├── SKILL.md
    │       └── screenshots/
    ├── jira.company.com/
    │   └── ticket-lifecycle.md
    └── *.company.com/        # 通配符匹配子域名
        └── sso-guide.md
```

#### D3. 知识文档格式（完全兼容现有 Skill 格式）

```markdown
---
name: github-pr-workflow
type: site_knowledge
site: "*.github.com"
description: GitHub PR 工作流指南
priority: high
---

# GitHub PR 工作流

## 创建 PR
1. 点击 "New pull request"
2. 选择 base 分支和 compare 分支
3. 填写标题（遵循 conventional commits）
...
```

注意：`type: site_knowledge` 已是现有支持的类型，`site` 字段也已存在。唯一新增是通配符支持。

#### D4. 按需加载策略

```
加载层级：
1. Companion 启动时：
   - 扫描 knowledge/ 目录，加载所有 metadata（frontmatter 仅几行）
   - 内容不加载，仅建立内存索引（name → file_path）

2. buildSystemPrompt(threadId) 时：
   a. 获取当前线程固定的 tab URL
   b. 匹配 global/ 下所有知识文档
   c. 匹配 sites/{hostname}/ 下知识文档（支持通配符）
   d. 按需读取内容，截取前 500 tokens 作为摘要
   e. 注入 system prompt

3. LLM 需要完整内容时：
   a. LLM 调用 use_skill(name)（复用现有机制）
   b. SkillEngine 读取完整文件内容返回
```

#### D5. 通配符站点匹配

```typescript
// companion/src/skills/site-matcher.ts
export function matchSite(pattern: string, hostname: string): boolean {
  // 精确匹配
  if (pattern === hostname) return true
  // 通配符匹配: *.github.com 匹配 api.github.com
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2)
    return hostname.endsWith(suffix)
  }
  return false
}

// 使用示例
const skills = allSkills.filter(s =>
  s.type === "site_knowledge" && matchSite(s.site, currentHostname)
)
```

#### D6. 内容安全过滤（吸收 Security Review 建议）

```typescript
// companion/src/skills/content-sanitizer.ts
const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous\s+)?instructions?/i,
  /忽略\s+(?:以上|前面|之前)\s*(?:所有\s*)?指令/i,
  /system\s*prompt\s*override/i,
  /new\s+role\s*:\s*you\s+are\s+now/i,
]

export function sanitizeKnowledgeContent(content: string): string {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      // 标记为可疑，记录日志，返回过滤后的内容
      console.warn("[Security] Potential prompt injection detected in knowledge doc")
      return content.replace(pattern, "[FILTERED]")
    }
  }
  return content
}
```

### 4.3 模块与改动点

#### 新增文件（3 个）

| 文件 | 说明 | 预估代码量 |
|------|------|----------|
| `companion/src/skills/site-matcher.ts` | 通配符站点匹配逻辑 | ~30 行 |
| `companion/src/skills/content-sanitizer.ts` | 内容安全过滤（prompt injection 防护） | ~40 行 |
| `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx` | SkillPanel 内的 Knowledge 标签页 | ~80 行 |

#### 修改文件（5 个）

| 文件 | 改动 | 预估代码量 |
|------|------|----------|
| `companion/src/skills/skill-engine.ts` | 1. `loadFromDir()` 新增扫描 `knowledge/` 目录<br>2. `getBySite()` 新增通配符匹配<br>3. `buildSystemPrompt()` 扩展：注入 global + 匹配 site 的知识摘要<br>4. 调用 `sanitizeKnowledgeContent()` 过滤内容 | ~60 行 |
| `companion/src/config.ts` | `getConfigDir()` 确保 `knowledge/` 子目录存在 | ~5 行 |
| `companion/src/server.ts` | 启动时创建 `knowledge/global/` 和 `knowledge/sites/` | ~10 行 |
| `chrome-extension/src/sidepanel/components/SkillPanel.tsx` | 新增 Knowledge 标签页切换 | ~20 行 |
| `chrome-extension/src/sidepanel/store/agentStore.ts` | 新增 `knowledgeDocs` state | ~30 行 |

**总代码增量：~275 行，4 人天。**

### 4.4 关键接口设计

```typescript
// SkillEngine 扩展接口
interface SkillEngine {
  // 已存在方法保持不变...

  // 新增：扫描知识目录
  refreshKnowledge(): void

  // 扩展：支持通配符的站点匹配
  getBySite(hostname: string): Skill[]  // 从 find 改为 filter，返回数组

  // 扩展：构建 system prompt 时注入知识摘要
  buildSystemPrompt(threadId: string): string  // 内部新增 knowledge 注入逻辑
}

// 知识文档元数据（与 SkillMeta 同构）
interface KnowledgeMeta {
  name: string
  description: string
  type: "site_knowledge" | "domain_knowledge"
  site?: string           // "*.github.com" 或 "jira.company.com"
  priority?: "high" | "normal" | "low"
  source_file: string
  dir?: string
  resources: string[]
}
```

### 4.5 数据流

```
用户打开 Side Panel
  │
  ▼
Companion 启动 → 扫描 ~/.cmspark-agent/knowledge/ → 加载 metadata 到内存
  │
用户发送消息
  │
  ▼
ThreadManager 构建 context
  │
  ▼
SkillEngine.buildSystemPrompt(threadId)
  ├── 获取 active skills（现有逻辑）
  ├── 获取 global knowledge 摘要（新增）
  ├── 获取当前 tab hostname
  ├── 匹配 site knowledge（通配符支持，新增）
  ├── 按需读取内容 → sanitizeKnowledgeContent() 过滤（新增）
  ├── 截取 500 tokens 摘要
  └── 注入 system prompt
  │
  ▼
LLM Adapter 发送请求（含知识上下文）
  │
  ▼
LLM 回复 → 可能调用 use_skill(name) 获取完整知识内容
```

---

## 5. 实施计划

### Phase 1: 核心功能（2 人天）

| 任务 | 文件 | 说明 |
|------|------|------|
| T1 | `site-matcher.ts` | 实现通配符匹配逻辑 + 单元测试 |
| T2 | `skill-engine.ts` | 扩展 `loadFromDir` 扫描 knowledge/，扩展 `getBySite` 通配符，扩展 `buildSystemPrompt` 注入知识 |
| T3 | `config.ts`, `server.ts` | 确保 knowledge/ 目录存在 |
| T4 | `content-sanitizer.ts` | 实现 prompt injection 过滤 |

### Phase 2: UI 集成（1 人天）

| 任务 | 文件 | 说明 |
|------|------|------|
| T5 | `KnowledgeSubPanel.tsx` | 知识库浏览列表 |
| T6 | `SkillPanel.tsx`, `agentStore.ts` | 标签页切换 + state 管理 |

### Phase 3: 集成测试（1 人天）

| 任务 | 说明 |
|------|------|
| T7 | 通配符匹配边界 case（子域名、无效模式） |
| T8 | 知识文档注入 context 功能测试 |
| T9 | Prompt injection 过滤验证 |
| T10 | 端到端：创建知识文档 → 访问对应站点 → 验证 context 注入 |

### 里程碑

```
Day 1-2: Phase 1 完成（核心功能）
Day 3:   Phase 2 完成（UI 集成）
Day 4:   Phase 3 完成（测试）→ 可演示
```

---

## 6. 风险缓解

| 风险 | 严重度 | 缓解措施 |
|------|--------|----------|
| 知识文档过大导致 context 超限 | 中 | 1. 摘要限制 500 tokens<br>2. 完整内容通过 `use_skill` 按需加载<br>3. 监控 context 总长度 |
| Prompt injection | 中 | `sanitizeKnowledgeContent()` 过滤已知 injection 模式，记录可疑日志 |
| 与 skills 概念混淆 | 低 | UI 分区（Skills / Knowledge 标签页），文档说明 |
| TF-IDF 匹配精度不足 | 低 | **已解决**：matchSkills 实现双轨策略，低置信度自动触发 LLM 语义精排 |
| 通配符匹配性能 | 低 | 站点数量有限（通常 < 100），线性扫描无性能问题 |
| 权限模型缺失 | 低 | 接口预留 `scope` / `site` 参数，为未来多租户做准备 |

---

## 7. 演进路径

```
Phase 1 (当前，4 人天):
  保守方案：复用 SkillEngine + 按需加载 + 通配符匹配
  │
  ▼ 若知识文档增长至 200+，或纯 TF-IDF 部分成为性能热点
Phase 2 (未来，~12 人天):
  迁移到折中方案：引入 KnowledgeBase 子系统、倒排索引、chunk 分割、LRU 缓存
  │
  ▼ 若需要语义搜索、自动知识发现、团队协作
Phase 3 (未来，~20 人天):
  迁移到激进方案：向量数据库、embedding 搜索、爬虫、Git 版本控制
```

**关键原则**：每个阶段都是前一阶段的超集，数据格式保持不变（Markdown + YAML frontmatter），迁移只需重建索引。

---

## 8. 附录

### 8.1 原始方案文档

- [保守方案](./conservative.md)
- [折中方案](./balanced.md)
- [激进方案](./aggressive.md)

### 8.2 审查报告

- Security Review：保守 7/10，折中 6.5/10，激进 4/10
- Performance Review：保守 8.3/10，折中 7.7/10，激进 5.3/10

### 8.3 参考文件

- 现有 SkillEngine：`/Users/huchen/Projects/cmspark/companion/src/skills/skill-engine.ts`
- 现有语义匹配：`/Users/huchen/Projects/cmspark/companion/src/skills/semantic-match.ts`
- 现有 LLM 适配器：`/Users/huchen/Projects/cmspark/companion/src/llm/adapter.ts`
