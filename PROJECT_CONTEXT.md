# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-02 ~14:22 (S33 — #105 merge + vision 405 + Qwen test guide)
- **main tip**：`6f3a210` — PR **#105** squash：CLI Phase-2 `host_cli` + Qwen3-VL P0/env UX
- **本会话**：
  - DMG 装入 `/Applications/CMspark.app`（worktree 包，codesign adhoc OK）
  - 用户 vision 405：`glm-4.6v` + 错误 base_url `open.bigmodel.cn/paas/v4` → 改为 **`…/api/paas/v4`**；下一错 429 余额 1113
  - 澄清：本地 Qwen ≠ `analyze_image`；测 Qwen 用白名单 App 的 `host_computer` + experimental 确认台
  - 本机：`qwen3-vl-2b` 在盘、`modelEnabled=true`、isolated torch/transformers/PIL ok
- **经验**：`memory/project-knowledge.md` — Vision 405 ≠ Qwen；智谱 `/api` 路径
- **下次**：
  1. 真机 CU 白名单 App 测实验定位（看 experimental_suggestion + 日志）
  2. 若要网页看图：充值智谱或换 vision 端点（Ollama 等）
  3. 可选：UI 校验错误 bigmodel base_url；Developer ID / LS hotkey DEGRADED

### 2026-08-02 (S31 — soft-fail estop + OCR describe + DMG)
- soft-fail estop + spatial describe 已随 **#104** 等进 main；旧「分支未合」handoff 过时
- 残余：ad-hoc LS 热键 DEGRADED、Developer ID、真机 CU 确认台抽检
<!-- handoff:end -->
