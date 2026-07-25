# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-25 (session-end S15 — deep diagnosis fanout + P0-A/B/C landed; P0-D mid-flight)
- **诊断**：`.grok/workflows/deep-diagnosis-fanout.rhai` 33 agents → 总分 **5.8/C+**（07-09 为 4.4/C）；Critical 0；High ~16。报告 `docs/audit/diagnosis-fanout-2026-07-25.md`。
- **开发流程锁定**：Implement → 内部对抗 → **分别** Claude Code + Pi 双审（`scripts/dual-external-review.sh` / `p0-batch-fix.rhai`）。Claude 勿用 plan mode（吞 VERDICT）；Pi 可挂空输出，用户授权可 waive 后靠 Claude+对抗+host 测继续。
- **已提交（本地未推）** 栈在 `fix/diagnosis-P0-D`：
  - `360de94` P0-A security（selector / config fanout / confirmation fields）
  - `29db352` P0-B lifecycle（Stop→computer abort / stream thread_id / orphan tools）
  - `c2784ed` P0-C computer（session-trust 不吞 danger+G4 / Darwin client→screen）
- **评审产物**：`docs/audit/reviews/P0-{A,B,C}-*`；完整 resume 文档 **`docs/audit/handoff-p0-diagnosis-2026-07-25.md`**
- **未完成 / 下次从这里开始**：
  1. **P0-D** 发布 hard-gate（cmspark-host / TinyClick / release 文案）— 分支 `fix/diagnosis-P0-D` @ `c2784ed`；workflow `p0-batch-fix-4` 当时在 Design
  2. 可 stop 僵尸 `p0-batch-fix-3`（P0-C 已 commit，ExternalReview 残留）
  3. P0-D 双审通过后 commit → 再考虑 push/PR 栈；P1 项仍开放（originWs、god-mode step-up、ADR-014 computer…）
- **勿混入**：`docs/decisions/v1.3/`、capability-token、host-skylight build/entitlements、`.omx/`

### 2026-07-23 (session-end S14 — macOS computer-use: forceForeground 融合 + bundle 级 TCC codesign 根因)
- forceForeground 融合 + DMG Step 3.5 ad-hoc codesign 硬门（`198bfe9`）；TCC 按 bundle 级评估，未签名反复弹窗。
- **未完成**：真机网易云 e2e；Phase 2 daemon/Developer ID。
<!-- handoff:end -->
