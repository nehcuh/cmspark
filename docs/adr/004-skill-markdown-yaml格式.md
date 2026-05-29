# ADR-004: Skill Markdown + YAML Frontmatter 格式

**日期**: 2026-05-24 | **状态**: 已确认

## 背景

CMspark 需要一种 Skill 定义格式，支持：人可读可编辑、元数据描述（名称/类型/描述）、与 VibeSOP 生态兼容、支持文件夹形式的资源包。

## 决策

采用 **Markdown + YAML frontmatter** 格式，与 VibeSOP 的 Skill 格式兼容。

```markdown
---
name: my-skill
description: 描述这个 skill 的用途
type: prompt_template  # prompt_template | tool_chain | sub_agent
---
这里写 skill 的指令内容（Markdown 正文）。
```

支持两种存储形式：
- **Flat .md 文件**：单个文件，适合简单 Prompt Skill
- **文件夹**：包含 `SKILL.md` + 资源文件（config、icons 等）

解析使用 `gray-matter` 库。

## 权衡

### 优势

- **人可读**：Markdown 是通用的文档格式，任何编辑器可打开
- **兼容 VibeSOP**：可以直接导入 VibeSOP 生态的 Skill
- **版本控制友好**：纯文本，Git diff 可见
- **扩展性**：frontmatter 可随时添加新字段

### 劣势

- **解析依赖**：`gray-matter` 对非法 YAML 的容错行为不一致
- **无 Schema 校验**：frontmatter 字段没有类型检查，拼写错误静默忽略
- **安全隐患**：Skill 内容注入 system prompt，如果包含恶意指令可能误导 LLM

## 替代方案

**JSON Schema**：结构化但不符合人可读目标，且无法兼容 VibeSOP。

**TOML frontmatter**：YAML 的替代，但生态系统较小，且 `gray-matter` 默认只支持 YAML 和 JSON。

## 后果

- 未来支持 Type B (tool_chain) 和 Type C (sub_agent) 时，需要在 frontmatter 中定义 `steps` 和 `sub_agent_config` 字段
- Skill 名称中的特殊字符会被替换为连字符（`replace(/[^a-zA-Z0-9-]/g, "-")`），可能导致中文名丢失
