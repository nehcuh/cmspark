# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-02 (S31 — soft-fail estop + OCR describe + DMG)
- **Branch tip**：`fix/macos-tcc-product-identity` @ `e156e78`（未合 main）
- **main 已有**：PR #103 TCC 产品身份（`MacOS/CMspark` / `com.cmspark.agent`）
- **本会话交付**：
  - tray/Aqua 拥有 estop；soft-fail CGEventTap（socket 保活，热键 DEGRADED）
  - spatial `describe` OCR + 禁止 shell Vision 旁路；Pi APPROVE_WITH_NITS
  - `make package-macos` → `dist-package/CMspark-v0.3.0-macOS.dmg`（CDHash `dae88680…`）
  - 已 ditto `/Applications/CMspark.app`；SOCKET_LIVE 验证
  - ship note：`docs/superpowers/plans/2026-08-02-macos-dmg-ship-note.md`
- **关键发现**：CLI tap OK ≠ LS/`open -a` tap OK（ad-hoc TCC 归因）
- **下次**：
  1. Side Panel `host_computer` 确认台真机一轮
  2. PR 合 main（含 soft-fail + describe + 后续 tray 提交）
  3. 分发用**新** DMG；旧 08-01 21:51 包无 soft-fail/spatial describe
- **Workflows**：`.grok/workflows/tray-estop-cu-fix.rhai` · `estop-tap-degraded-cu-fix.rhai` · `ocr-describe-enhance.rhai`

### 2026-08-01 (S30 — host_computer 阻塞 handoff)
- 阻塞：estop code 4 / -3801；CLI 成功 vs daemon 失败
- HANDOFF：`docs/superpowers/plans/2026-08-01-macos-tcc-estop-BLOCKED-HANDOFF.md`
- S31 已 soft-fail 缓解 preflight；热键/ad-hoc TCC 仍开放
<!-- handoff:end -->
