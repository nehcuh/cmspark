---
name: coding-handoff-brief
description: 编程接力 — 如何把浏览器证据打成终端编程助手任务包，以及何时用 ACP 审查/起草会话
type: prompt_template
---

# 编程接力 brief

## 何时用

- 已登录 staging / 预览页上复现了 bug，需要本机仓库侧修复或审查
- PR 页打开时需要本地深读
- AppSec 发现后需要源码侧 trace

## 何时不用

- 纯文本冷启动写完整 monorepo → 用户直接开 Claude Code
- 需要 multi-file IDE apply → 编辑器
- 需要编程 Agent 操控浏览器 → Outbound MCP

## 标准动作

1. 收集 URL、复现步骤、可选页面摘录（注意隐私）
2. 确认 `workspace_root` 已绑定
3. 引导用户 `/code` 或「派给终端助手」复制任务包
4. 用户从外部助手贴回摘要后，在浏览器侧复验

## 任务包字段

Goal · Workspace · Browser evidence · Conversation context · Constraints · Acceptance · Handback
