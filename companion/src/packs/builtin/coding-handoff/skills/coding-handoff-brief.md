---
name: coding-handoff-brief
description: 编程接力与网页终端 — 任务包、ACP 审查/起草及插件内交互终端的启动入口
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
3. 用户只需任务包时，引导 `/code` 或「派给终端助手」复制；用户要求通过编程接力/网页终端处理代码时，调用 `acp_list_agents` → `acp_propose_session` → `acp_start_session`（确认台批准）。修复/起草用 `propose_diff`，审查用 `review_readonly`。
4. macOS 开启插件内终端及「同时打开本机终端」时，ACP 启动会记录终端意图。`local_terminal=embed_intent` 表示等待用户点击会话面板「在本插件打开终端」并批准；`embed_running` 才表示交互终端已运行。用户可在终端用键盘、方向键、回车处理 Claude 信任/权限提示。不要寻找 localhost 网站或声称编程接力没有网页终端。
5. ACP 后台会话与交互终端是独立进程；终端输出不会自动回传为 ACP handback。模型可提交代码任务、查询/收集 ACP 结果、确认后应用待审 diff；模型不能任意发送终端按键或代选权限。模式是任务意图，不是写盘担保。
6. 收到 ACP handback 或用户贴回摘要后，在浏览器侧复验。

## 任务包字段

Goal · Workspace · Browser evidence · Conversation context · Constraints · Acceptance · Handback
