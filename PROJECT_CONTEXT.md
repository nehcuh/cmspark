# Project Context

## Session Handoff

<!-- handoff:start -->

### 2026-10-10 S122 · 0.6.12/0.6.13 双切点 · worker-cap 收尾 · win32 内嵌终端 · handback 兜底

- **合并**：#580（worker-cap 评审修复 F1-F4：回收站占位可见性 / 墙钟回拨钳制 / 双闸文案 SSOT / G7-G11 测试绑定）/ #582（collect_handback prose 兜底：fence 降级 + 逐 fence 尝试 + 全可恢复失败兜底 + parse_note 穿透投影；schema_version 字符串 "1" 刻意不容忍）/ #585（#584 win32 内嵌终端端到端：五处 darwin 闸 + 面板按钮 isEmbeddedTerminalSupported + capability 提示词 + pid 如实缺省）/ #587（#586 面板常驻「打开内嵌终端页 →」入口）。全部经 10-11 agent 多路对抗复审。
- **切点**：0.6.12（#581/#583）、0.6.13（#588）。锚点 ×9、CLAUDE.md 活切点、GOAL/architecture/code-review-workflow 过时「仅 macOS」表述更正。
- **换装**：×6 全部 hash 级验证，最终 **v0.6.13**，daemon `:23401`。装后扩展 bundle 含面板常驻入口。
- **坑**（已入 memory）：评审 verify agent 变异残留工作树（并行互相误判）——workflow 后必 `git status` 核对；gh 大 body POST 间歇 EOF（probe+PATCH）；MSYS hash 前导反斜杠假差；打包产物中文 \u 转义——grep 汉字验证构建是假阴性，用 ASCII 锚点；`package.sh` 构建步骤 cwd 必须仓库根（漂移会静默装旧包）。
- **Next**：用户 Reload 扩展验收面板「打开内嵌终端页 →」；未立票线索：ibg908 父线程 run 段记录缺口（09-30 spawn 记录缺失）、UI 设置 worker 数（Issue-first）、Linux 内嵌终端另票。
- **Do not**：拿汉字 grep 构建产物定性新旧；`git checkout --` 未过目的「他人」改动（先 diff 定性再走用户确认）；对 verify agent 只下口头恢复指令就当万事大吉。

<!-- handoff:end -->
