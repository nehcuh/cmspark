# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-09-06 (S105+ END · 0.6.1 · 五票全清 + 事故闭环)
- **Workspace**：本地 main = origin/main `32c2df1a`（0.6.1）+ 3 个未推送 docs wrap commit（**勿 push**，用户未授权）。/Applications 装的是 0.6.0（含 #405），**不含** #406–#411/#416——要用上新功能需 `make package-macos` 三次打包。
- **Ship（本日全部合并，CI 全绿，逐票独立对抗复审）**：#405（#404 测试污染 live 化）· #407（Grok stdio 短名）· **#412**（#406 pid/grants/ws-auth/obsidian live 化 + tray WS 端口读 getConfig().port + 漂移重连）· **#413**（#408 HTTP/stdio 双轨同名）· **#414**（#409 uokwyw 四断点：未武装不广告 CU / 失败不换路 / trigger_reason 过 schema / 熔断附解锁；linux 分支 declare_blocked）· **#415**（#410 interact 命名 profile + 豁免旗不溅射收紧 + /profile 认证端点）· **#416**（#411 全历史专家抽取方案 A：两级聚类、K≤5 草稿、红线全保）· **#420**（0.6.1 lockstep + CHANGELOG 归档）。
- **Open（全部有处置依据）**：#417（#409 残余：formatSiteOpMemoryPrompt 广告 + tier-bind 平台收敛）· #418（#411 polish：真实 LLM prompt 调优/perf/NIT-1）· #419（#410 残余：stdio profile 重试 + UI 选档 + 形状预检 allowlist 感知）· #230 冻 · #363 blocked（真模型跑分）· #328 shadow 观测 · #351 讨论 · #364/#372/#373 deferred · #71/#70 路标。
- **Next**：三次打包换装 0.6.1 狗食（interact grant、全历史专家、升级链）；#417–#419 小票排期。
- **Do not**：#230 整票；扩 outbound 默认 profile；marker 验证前不停 daemon；Bash cwd 不持久；`git add -A` 在含 node_modules symlink 的 worktree（#420 曾误提，已 amend）。

### 2026-09-06 (S105 END · 0.6.0 换装 + #404 测试污染事故闭环)
- **Workspace**：本地 main = origin/main `f5320db0` + 1 个未推送的本地 wrap commit（e027a275，用户未授权推送前**勿 push**）。/Applications 已装 0.6.0 DMG（含 #405 修复的二次打包）。
- **Ship**：0.6.0 打包换装 ×2 · **#404**（settings-web-tokens.test.ts 静态 import 冻结 DATA_DIR → 夹具值 sk-test/https://x/m + port 23491 覆写真实 config.json）→ **PR #405 合并**（claude 两轮评审 MAJOR→CLOSED：9 处 config.json + initDataDir 3 处 + getLogDir 全 live 化）· 用户配置已从 corrupt 备份恢复（llm=deepseek-v4-flash、port=23401、npm-prefix/lib 补建）。
- **Open**：#406（getPidFilePath 等残余冻结点 + tray 硬编码 WS_PORT 改读 getConfig().port）· #408（HTTP/stdio 双轨名称统一，#407 m-1 跟进）· #230 冻 · #363 blocked（需真模型跑分）。
- **Ship+**：**PR #407 已合并** `f1cd33c5`（outbound-mcp stdio 短名修 Grok tool_count 0；claude CLOSED + grok PASS 双路收敛；补 exfil 回归 6/6 + hermeticity import）。grok 4 个 NIT 未动（边界单测/canonical screenshot 钉/HTTP 负向钉/facade 注释）。
- **Next**：#406 / #408 排期；Grok MCP 真机狗食（tools/list 应见 10 个短名工具）；要发版需三次打包才含 #407。
- **Do not**：#230 整票；扩 outbound profile；跑 companion 测试前不停 daemon 就做 marker 验证（宿主写入噪音）；Bash cwd 不持久（复验必须确认测试真跑了）。
<!-- handoff:end -->
