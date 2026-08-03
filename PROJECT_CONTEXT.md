# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-03 ~11:12 (S36 — pull + 四路对抗 #105–#107)
- **main tip**：`dd3b1dd` (#107) + 本地 handoff commits；与 origin 对齐生产代码
- **动作**：rebase 拉最新；四路对抗（Security/Correctness/Architecture/Compat）评审 #105+#106+#107
- **Verdict**：**REQUEST_CHANGES** — 报告 `docs/audit/reviews/multi-adversarial-review-20260803-main-105-107.md`
- **P0**：unattended dual-write 文案/持久化诚实性；`ensure_python_env` 先写 isolated；Windows windowsHide / PS 安装命令 / macOS 急停文案
- **下次**：
  1. 按 P0 批修（Trust honesty → pythonMode 事务 → 平台补丁）
  2. 真机微信清单（#106 residual）
  3. 可选清理未跟踪 patch/images

### 2026-08-02 ~16:43 (S35 — Trust IA + 无人值守 #106 合 main)
- **main tip**：`ed92a81` — #106 运行自主度 + ADR-021；后 #107 Windows uv
- **残余**：真机清单；S36 发现 packaging honesty 未关
<!-- handoff:end -->
