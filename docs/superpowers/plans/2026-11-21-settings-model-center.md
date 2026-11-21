# 设置与模型中心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

GitHub: #798、#754、#876

**Goal:** 把模型入口按用途收拢，使会议能独立配置，并让一句话设置操作真实设置。
**Architecture:** 扩展复用已有表单和深链接。Companion 保存模型配置及会议绑定，会议转写和摘要各自确认，设置助手使用受控配置目录和现有回执。
**Tech Stack:** TypeScript、React、WebSocket、Node 22.23.4。
**Spec:** `docs/superpowers/specs/2026-11-21-settings-model-center-design.md`

## 约束

- 以发布主线为基线。保留既有权限、下载许可、配置版本保护和历史数据。
- 先写失败测试再改变生产代码。敏感数据、密钥和生产录音不进入夹具。
- 保持已有原生和发布时限。独立评审通过和主线检查通过后发正式 tag。

## 批次

- [x] 导航和模型用途页。编辑 `SettingsPage.tsx`、`SettingsSlideout.tsx`、设置导航工具和样式。测试六个分类、二级路径、旧链接、窄栏、草稿和语音入口。
- [x] 文本模型配置和纪要绑定。扩展 `config.ts`、配置处理器和会议生成。测试旧配置继承、脱敏、版本检查、实际请求所用模型和配置变化后的授权拒绝。
- [x] 会议外部 ASR。扩展会议导入和现有转写 provider。测试授权前拒发、音频分段、配置变化、取消和错误。
- [x] 一句话设置和功能集成。扩展目录、候选 UI 和本地查找。覆盖离线查询、精确指令、歧义、规则导航、已保存和未确认。
- [ ] 验证和发布。运行双端构建与定向测试、浏览器验收、独立评审、全量 CI、主线、Release 和安装器预演，确认 tag 同树、清单全量校验和公开发布回执。
