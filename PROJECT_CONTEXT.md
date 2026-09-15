# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-09-15 S109 END · VibeSOP 8.5.0 配置刷新

**Workspace**：CMspark main 工作树原有未提交内容保持不变；本次仅新增/刷新本地 agent 配置。

**完成**：`.vibe/dist/` 五个平台产物已重建；项目 `.claude/` 与 `.grok/`、全局 Claude/Grok/Kimi/Pi/OpenCode 配置已同步至 VibeSOP 8.5.0。额外 skill、`.grok/workflows`、Claude 本地设置和模型配置保留。

**验证**：Claude、Grok、Kimi、OpenCode、Pi 独立 `vibe verify` 全部通过；Cursor 未配置，未改动。

**Next**：重启相关 Agent；审阅是否将 `.grok/rules/` 与 `vibesop-*` hooks 纳入仓库版本控制。

### 2026-09-07 (S108 END · #423 闭环 · 0.6.6 换装 · host-integrity 存量坑)
- **Workspace**：main = origin/main `9054ad19`，CI 绿；装机 0.6.6 已换装（Info.plist 0.6.6 ✓ daemon :23401 ✓ tray running ✓ codesign verify ✓）。
- **Ship**：#423 CLOSED（Qwen3-VL 恒 [0,1000] 相对坐标，L-QW-3 修订 always-map，数组形态取 (x[0],x[1])，三端 lockstep；评测门 0/10→6/10）· create-dmg cp -R 修复（0.6.5 起 DMG 封签静默破，DMG 卷内复验 fail-closed + gates 3 断言）· installer.nsi 版本锚补钉。
- **#363 仍 blocked**：6/10 低于 0.85 门，余 4 MISS 为 2B 感知误差；候选路径已留言（4B/8B 变体重跑 → few-shot point_2d → bbox 中心）。
- **Open**：#363 blocked · #328 观测中 · #432 P1/P2（Mode C agent TUI / agent_write 门）· #364/#372/#373 deferred · #230 冻 · #71/#70 路标。
- **Next**：用户开「应用页坐标操作 + 设置模型开关」狗食 #423 定位效果；#363 候选择一另开工单；本机存量 16 测试 fail（macOS 环境特异，CI 绿）排查另议。
- **Do not**：#230 整票；版本锚枚举以 scripts/tests/test-package-gates.sh 为准（别凭记忆）；DMG 打包 cp -R 不可回退成 -r；评测门 FAIL 先查 harness/坐标约定。
- **协作模式**：tmux 0.1 grok / 0.2 claude（DeepSeek）/ 0.3 pi；任务书落 .tmp/lane-status/*.md 再 send-keys；claude TUI 常需补发 Enter 才提交。
<!-- handoff:end -->
