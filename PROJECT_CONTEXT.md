# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-09-07 (S108 END · #423 闭环 · 0.6.6 换装 · host-integrity 存量坑)
- **Workspace**：main = origin/main `9054ad19`，CI 绿；装机 0.6.6 已换装（Info.plist 0.6.6 ✓ daemon :23401 ✓ tray running ✓ codesign verify ✓）。
- **Ship**：#423 CLOSED（Qwen3-VL 恒 [0,1000] 相对坐标，L-QW-3 修订 always-map，数组形态取 (x[0],x[1])，三端 lockstep；评测门 0/10→6/10）· create-dmg cp -R 修复（0.6.5 起 DMG 封签静默破，DMG 卷内复验 fail-closed + gates 3 断言）· installer.nsi 版本锚补钉。
- **#363 仍 blocked**：6/10 低于 0.85 门，余 4 MISS 为 2B 感知误差；候选路径已留言（4B/8B 变体重跑 → few-shot point_2d → bbox 中心）。
- **Open**：#363 blocked · #328 观测中 · #432 P1/P2（Mode C agent TUI / agent_write 门）· #364/#372/#373 deferred · #230 冻 · #71/#70 路标。
- **Next**：用户开「应用页坐标操作 + 设置模型开关」狗食 #423 定位效果；#363 候选择一另开工单；本机存量 16 测试 fail（macOS 环境特异，CI 绿）排查另议。
- **Do not**：#230 整票；版本锚枚举以 scripts/tests/test-package-gates.sh 为准（别凭记忆）；DMG 打包 cp -R 不可回退成 -r；评测门 FAIL 先查 harness/坐标约定。
- **协作模式**：tmux 0.1 grok / 0.2 claude（DeepSeek）/ 0.3 pi；任务书落 .tmp/lane-status/*.md 再 send-keys；claude TUI 常需补发 Enter 才提交。

### 2026-09-06 (S106 END · 剩余 issue 全清 · 0.6.1)
- **Workspace**：origin/main 含 #420（0.6.1）+ #421/#422/#424；本地 main 另有 4 个未推送 docs wrap commit（勿 push）。装机 0.6.1 已换装（DMG 验证：23401 LISTEN + tray running + WS 认证）。
- **Ship（本波合并）**：#421（#419 stdio profile 懒重拉 + UI 选档 + 形状预检 allowlist 感知）· #422（#417 escalateGuidance 单一来源 + linux cuArmed 收敛）· #424（#418 distill polish + 真实 LLM 三轮调优）。
- **非代码处置**：#351 终裁关闭（维持 overlay auto_diarize 关闭；spec §4/§6 注记已落）· #328 shadow 已在 config 开启（观测期真正推进）· #363 评测门本机首跑 **FAIL 0/10**（worker 坐标系不匹配 → #423 新票）· #71/#70 路标已落状态注释。
- **Open（9 张全有据）**：#423（worker 坐标系，可执行）· #363 blocked · #328 观测中 · #230 冻 · #364/#372/#373 deferred · #71/#70 路标。
- **Next**：狗食 0.6.1 三重点（CDP 连败解锁面 / 全历史专家 / Grok 短名工具）；#423 修复后重跑评测门再议 #363。
- **Do not**：#230 整票；合并与清理必须分开两步（#422 又撞 TLS 超时事故，refs/pull/N/head 救回）；测评门 FAIL 先查坐标系约定再信「模型不行」。

<!-- handoff:end -->
