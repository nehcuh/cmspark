# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-09-06 (S106 END · 剩余 issue 全清 · 0.6.1)
- **Workspace**：origin/main 含 #420（0.6.1）+ #421/#422/#424；本地 main 另有 4 个未推送 docs wrap commit（勿 push）。装机仍为 0.6.0——**0.6.1 未打包**。
- **Ship（本波合并）**：#421（#419 stdio profile 懒重拉 + UI 选档 + 形状预检 allowlist 感知）· #422（#417 escalateGuidance 单一来源 + linux cuArmed 收敛）· #424（#418 distill polish + 真实 LLM 三轮调优）。
- **非代码处置**：#351 终裁关闭（维持 overlay auto_diarize 关闭；spec §4/§6 注记已落）· #328 shadow 已在 config 开启（观测期真正推进）· #363 评测门本机首跑 **FAIL 0/10**（worker 坐标系不匹配 → #423 新票）· #71/#70 路标已落状态注释。
- **Open（9 张全有据）**：#423（worker 坐标系，可执行）· #363 blocked · #328 观测中 · #230 冻 · #364/#372/#373 deferred · #71/#70 路标。
- **Next**：打包 0.6.1 换装狗食；#423 修复后重跑评测门再议 #363。
- **Do not**：#230 整票；合并与清理必须分开两步（#422 又撞 TLS 超时事故，refs/pull/N/head 救回）；测评门 FAIL 先查坐标系约定再信「模型不行」。

<!-- handoff:end -->
