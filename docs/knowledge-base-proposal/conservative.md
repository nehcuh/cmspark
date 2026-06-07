# CMspark 站点知识库 — 保守方案

## 1. 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Extension                          │
│  ┌─────────────┐    ┌─────────────────────────────────────┐  │
│  │ Side Panel  │◄──►│  SkillPanel (新增 Knowledge 标签页)  │  │
│  │             │    │  - 浏览站点/全局知识文档              │  │
│  │             │    │  - 简单的导入/删除操作                │  │
│  └─────────────┘    └─────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────────────────┘
                      │ WebSocket
┌─────────────────────▼───────────────────────────────────────┐
│                      Companion                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  SkillEngine (扩展，无新子系统)                           │ │
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

## 2. 核心思路

**零新依赖、零新子系统、最大化复用现有 SkillEngine。**

### 2.1 复用现有机制

| 需求 | 复用机制 | 说明 |
|------|---------|------|
| 知识文档存储 | 现有 skill 文件夹格式 | Markdown + YAML frontmatter，与 skills/ 完全一致 |
| 站点匹配 | `getBySite()` + 扩展通配符 | 已有 `site_knowledge` 类型，新增通配符匹配 `*.company.com` |
| 语义匹配 | `matchSkills()` TF-IDF + LLM fallback | 高置信度走 TF-IDF（快），低置信度走 LLM 精排（准） |
| 按需加载 | `buildSystemPrompt()` 扩展 | 延迟读取知识文档内容，只在注入时加载 |
| 导入导出 | 现有 `importSkill`/`exportSkill` | 知识文档就是特殊类型的 skill |
| 激活管理 | 现有 `activate`/`deactivate` | 用户可手动激活/停用知识库 |

### 2.2 新增内容（最小化）

1. **知识目录**：`~/.cmspark-agent/knowledge/`（结构同 `skills/`）
2. **通配符站点匹配**：`getBySite()` 支持 `*.github.com` 匹配 `api.github.com`
3. **按需加载**：`buildSystemPrompt()` 延迟读取知识文档内容（而非启动时全量加载）
4. **全局 vs 站点**：`knowledge/global/` 无条件注入摘要；`knowledge/sites/{host}/` 按当前 tab URL 匹配
5. **UI 标签页**：SkillPanel 新增 Knowledge 子标签，复用现有列表/导入/删除组件

### 2.3 知识文档格式（兼容现有 Skill 格式）

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
...
```

注意：`type: site_knowledge` 已是现有支持的类型，`site` 字段也已存在。唯一新增是通配符支持。

## 3. 涉及的模块和改动点

### 3.1 新增文件（仅 3 个）

| 文件 | 说明 |
|------|------|
| `companion/src/skills/site-matcher.ts` | 通配符站点匹配逻辑（~30 行） |
| `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx` | SkillPanel 内的 Knowledge 标签页 |
| `companion/src/skills/knowledge-utils.ts` | 知识目录扫描、按需加载辅助函数 |

### 3.2 修改文件（6 个）

| 文件 | 改动 |
|------|------|
| `companion/src/skills/skill-engine.ts` | 1. `loadFromDir()` 新增扫描 `knowledge/` 目录<br>2. `getBySite()` 新增通配符匹配<br>3. `buildSystemPrompt()` 扩展：注入 global + 匹配 site 的知识摘要 |
| `companion/src/skills/skill-loader.ts` | 新增 `loadKnowledgeDir()` 方法（或复用 `loadFromDir`） |
| `companion/src/config.ts` | `getConfigDir()` 返回路径中确保 `knowledge/` 子目录存在 |
| `chrome-extension/src/sidepanel/components/SkillPanel.tsx` | 新增 Knowledge 标签页切换 |
| `chrome-extension/src/sidepanel/store/agentStore.ts` | 新增 `knowledgeDocs` state |
| `companion/src/server.ts` | WS 初始化时创建 `knowledge/` 目录 |

## 4. 预估开发人天

| 模块 | 人天 |
|------|------|
| 通配符站点匹配 + knowledge 目录扫描 | 1 |
| buildSystemPrompt 扩展（按需加载逻辑） | 1 |
| Extension UI（Knowledge 标签页） | 1 |
| 集成测试 + 边界 case | 1 |
| **总计** | **4 人天** |

## 5. 潜在风险

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| 知识文档过大导致 context 超限 | 中 | 限制注入摘要长度（500 tokens），完整内容通过 `use_skill` 按需加载 |
| 与 skills 概念混淆 | 低 | UI 分区 + 文档说明：Knowledge = 参考文档，Skill = 可执行指令 |
| TF-IDF 语义匹配精度不足 | 低 | **已解决**：双轨策略自动触发 LLM 语义精排 |
| 通配符匹配性能 | 低 | 站点数量有限（通常 <100），线性扫描无性能问题 |
