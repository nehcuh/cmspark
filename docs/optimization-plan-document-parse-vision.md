# Backlog: 聊天附件文档解析 / 图文理解

> **Status:** Backlog（不插队 B 轨）  
> **Parent:** [optimization-plan-post-adr-020.md](optimization-plan-post-adr-020.md)  
> **Updated:** 2026-08-09（DOC-05 stub — 修复 hub 断链）

## Scope

增强现有 `file-parser` + vision 管道：

| Phase | Goal |
|-------|------|
| **P0** | 有字 PDF 抽图/可配置/golden fixtures |
| **P1** | OCR · 结构抽取 |
| **P2** | DocAI / 更高阶理解 |

## Non-goals

- 不替代 CU OCR 分轨
- 不绕过 `analyze_image` 安全门（M4）

## Related

- `companion/src` file-parser / vision adapter
- ADR-020 capability axes（Surface L0 附件 vs L1 页面）
