# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-09-06 (S105 END · 0.6.0 换装 + #404 测试污染事故闭环)
- **Workspace**：本地 main = origin/main `f5320db0` + 1 个未推送的本地 wrap commit（e027a275，用户未授权推送前**勿 push**）。/Applications 已装 0.6.0 DMG（含 #405 修复的二次打包）。
- **Ship**：0.6.0 打包换装 ×2 · **#404**（settings-web-tokens.test.ts 静态 import 冻结 DATA_DIR → 夹具值 sk-test/https://x/m + port 23491 覆写真实 config.json）→ **PR #405 合并**（claude 两轮评审 MAJOR→CLOSED：9 处 config.json + initDataDir 3 处 + getLogDir 全 live 化）· 用户配置已从 corrupt 备份恢复（llm=deepseek-v4-flash、port=23401、npm-prefix/lib 补建）。
- **Open**：PR #407（outbound-mcp stdio 短名修 Grok tool_count 0；lane 无名改动抢救分支化，本地 84/84 绿，**待 claude 复审 verdict `.omx/artifacts/gate-407/` 后合并**）· #406（getPidFilePath 等残余冻结点 + tray 硬编码 WS_PORT 改读 getConfig().port）· #230 冻 · #363 blocked（需真模型跑分）。
- **Next**：#407 复审闭环合并 → 删 worktree/分支；再决定是否三次打包。
- **Do not**：#230 整票；扩 outbound profile；跑 companion 测试前不停 daemon 就做 marker 验证（宿主写入噪音）；Bash cwd 不持久（复验必须确认测试真跑了）。

### 2026-09-03 (S104 END · 接手 kimi 知识主线)
- **Workspace**：`origin/main` **`7ab36063`**（#283 查重）。无开放 PR。本地 session-end **勿擅自 push**。
- **Ship**：#280 开闸 · #282 PDF readAsDataURL · #281/#283 body sha256 查重。本机 0.5.8 DMG 是开闸枝（无 #282/#283）。daemon `:23401`。无 bak。
- **Next**：重载 `chrome-extension/build/chrome-mv3-prod/` 狗食 PDF 导入+按堆选文；再 `make package-macos` 才有查重。
- **Do not**：`xattr -cr`；`pgrep -f /Applications/CMspark.app`；#230 整票；扩 outbound；嵌套 grok `--output-format text`；`kimi -p --yolo`。
<!-- handoff:end -->
