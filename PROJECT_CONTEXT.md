# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-09-06 (S105 END · 0.6.0 换装 + #404 测试污染事故闭环)
- **Workspace**：本地 main = origin/main `f5320db0` + 1 个未推送的本地 wrap commit（e027a275，用户未授权推送前**勿 push**）。/Applications 已装 0.6.0 DMG（含 #405 修复的二次打包）。
- **Ship**：0.6.0 打包换装 ×2 · **#404**（settings-web-tokens.test.ts 静态 import 冻结 DATA_DIR → 夹具值 sk-test/https://x/m + port 23491 覆写真实 config.json）→ **PR #405 合并**（claude 两轮评审 MAJOR→CLOSED：9 处 config.json + initDataDir 3 处 + getLogDir 全 live 化）· 用户配置已从 corrupt 备份恢复（llm=deepseek-v4-flash、port=23401、npm-prefix/lib 补建）。
- **Open**：#406（getPidFilePath 等残余冻结点 + tray 硬编码 WS_PORT 改读 getConfig().port）· #408（HTTP/stdio 双轨名称统一，#407 m-1 跟进）· #230 冻 · #363 blocked（需真模型跑分）。
- **Ship+**：**PR #407 已合并** `f1cd33c5`（outbound-mcp stdio 短名修 Grok tool_count 0；claude CLOSED + grok PASS 双路收敛；补 exfil 回归 6/6 + hermeticity import）。grok 4 个 NIT 未动（边界单测/canonical screenshot 钉/HTTP 负向钉/facade 注释）。
- **Next**：#406 / #408 排期；Grok MCP 真机狗食（tools/list 应见 10 个短名工具）；要发版需三次打包才含 #407。
- **Do not**：#230 整票；扩 outbound profile；跑 companion 测试前不停 daemon 就做 marker 验证（宿主写入噪音）；Bash cwd 不持久（复验必须确认测试真跑了）。

### 2026-09-03 (S104 END · 接手 kimi 知识主线)
- **Workspace**：`origin/main` **`7ab36063`**（#283 查重）。无开放 PR。本地 session-end **勿擅自 push**。
- **Ship**：#280 开闸 · #282 PDF readAsDataURL · #281/#283 body sha256 查重。本机 0.5.8 DMG 是开闸枝（无 #282/#283）。daemon `:23401`。无 bak。
- **Next**：重载 `chrome-extension/build/chrome-mv3-prod/` 狗食 PDF 导入+按堆选文；再 `make package-macos` 才有查重。
- **Do not**：`xattr -cr`；`pgrep -f /Applications/CMspark.app`；#230 整票；扩 outbound；嵌套 grok `--output-format text`；`kimi -p --yolo`。
<!-- handoff:end -->
