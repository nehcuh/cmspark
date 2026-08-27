---
name: 需求设计
about: 新产品行为 / 形态切片 / 能力边界必须先开这张票，再写 spec。禁止只在 docs/superpowers 里设计。
title: ""
labels: enhancement
---

## 为什么要有这张票

<!-- 一句：没有这张票，下场会话会忘掉什么。 -->

## 产品句

<!-- 用户语言，不是实现语言。 -->

## 用户能看见的完成

- 

## 未完成时禁止假装

- 

## 规格锚点

- 将要写 / 已有的 spec 或 plan 路径（`docs/superpowers/specs|plans/…`）
- 相关 ADR

## Blast（eval gate）

T0 | T1 | T2 | T3 | T4 — 及为何

```text
Surface:
L2-classes:
Compose:
Autonomy:
Trust:
Channel:
```

## NEVER / 不在本票

- overlay Allow/Deny
- 第二只 Chrome 扩展
- `ws_secret` 当 MCP grant
- 

## 实现前

1. Issue **先于** spec。spec 文件头写 `GitHub: #本票`。
2. 实现另开 PR，`Closes #本票` 或 `Refs #本票`。
3. 不在 main 上直接实现；不经用户确认不改 live `config.json`。
