# Project Context

## Session Handoff

<!-- handoff:start -->

### 2026-10-26 · 0.7.0 发布准备

- 用户指定产品版本 0.7.0，包含此前全部已实现的未发布优化与修复；延期需求与企业里程碑不因版本号自动完成。包、锁根、CLI/ACP/MCP/LCU 客户端及安装器同步，完整 Unreleased 归档到 0.7.0。
- 版本同步前基线 main `b4a84a0651a3738e32fe9c9948450a198369ab00` 全 8 CI 通过，Windows 公开逐项回执为 9491 PASS / 65 SKIP / 0 FAIL。#780 历史物理原因 UNKNOWN；本版本提交仍需独立复审和正式 CI。
- 源码、发行包与本机安装分别记账；macOS 换装已授权但须等本批完成。保留有未提交、独有或未知状态的 worktree，不强制清理。

### 2026-10-18 · 0.6.14 源码版本与文档补齐

- 同步 Companion、扩展、锁文件、CLI/ACP/MCP、Windows 安装器默认版本及 AGENTS/CLAUDE 活版本为 **0.6.14（开发版本，尚未正式发布）**；历史 0.6.13 换装记录保留，不代表本次更新了本机应用。
- [CHANGELOG](CHANGELOG.md) 汇总 10 月 10 日之后已合并的 Office、协作、浏览器、会议、项目及应用修复；[交付状态](docs/release-status.md) 区分源码、发行包和未完成验收。修正文档中仍把 #494/#615 当作待开发的说明。
- 本批不创建标签、发布安装包或替换应用。#476 / #571 原生验收、企业真实联调与冻结项仍按各票实际证据跟踪，不因版本号更新声称完成。


### 2026-10-10 S122 · 0.6.12/0.6.13 双切点 · worker-cap 收尾 · win32 内嵌终端 · handback 兜底

- **合并**：#580（worker-cap 评审修复 F1-F4：回收站占位可见性 / 墙钟回拨钳制 / 双闸文案 SSOT / G7-G11 测试绑定）/ #582（collect_handback prose 兜底：fence 降级 + 逐 fence 尝试 + 全可恢复失败兜底 + parse_note 穿透投影；schema_version 字符串 "1" 刻意不容忍）/ #585（#584 win32 内嵌终端端到端：五处 darwin 闸 + 面板按钮 isEmbeddedTerminalSupported + capability 提示词 + pid 如实缺省）/ #587（#586 面板常驻「打开内嵌终端页 →」入口）。全部经 10-11 agent 多路对抗复审。
- **切点**：0.6.12（#581/#583）、0.6.13（#588）。锚点 ×9、CLAUDE.md 活切点、GOAL/architecture/code-review-workflow 过时「仅 macOS」表述更正。
- **换装**：×6 全部 hash 级验证，最终 **v0.6.13**，daemon `:23401`。装后扩展 bundle 含面板常驻入口。
- **坑**（已入 memory）：评审 verify agent 变异残留工作树（并行互相误判）——workflow 后必 `git status` 核对；gh 大 body POST 间歇 EOF（probe+PATCH）；MSYS hash 前导反斜杠假差；打包产物中文 \u 转义——grep 汉字验证构建是假阴性，用 ASCII 锚点；`package.sh` 构建步骤 cwd 必须仓库根（漂移会静默装旧包）。
- **Next**：用户 Reload 扩展验收面板「打开内嵌终端页 →」；未立票线索：ibg908 父线程 run 段记录缺口（09-30 spawn 记录缺失）、UI 设置 worker 数（Issue-first）、Linux 内嵌终端另票。
- **Do not**：拿汉字 grep 构建产物定性新旧；`git checkout --` 未过目的「他人」改动（先 diff 定性再走用户确认）；对 verify agent 只下口头恢复指令就当万事大吉。

<!-- handoff:end -->
