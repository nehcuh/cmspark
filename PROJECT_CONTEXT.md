# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-31 (S26 — 用户场景 + 侧栏 UX + 技能扫描 + DMG)
- **main tip（已合）**：`df468d6` = #95；含 #93 场景 UX、#94 用户场景、#95 侧栏 polish
- **本会话交付**：
  - #93/#94/#95 全合 main；用户场景可配 system prompt / skills / MCP + AI suggest + 另存为/保存并应用
  - 知识批量删除、技能 auto|all|manual 勾选语义、StatusRail 顶栏呼吸感
  - **PR #96** OPEN CI 绿：`feat/skill-disk-refresh` — disk fingerprint + Skills 刷新
  - 清 `/Applications/CMspark.app` + 重打 `dist-package/CMspark-v0.3.0-macOS.dmg`
  - 确认 #91 log.event 回声环仍断（耗电 FAQ）
- **下次**：
  1. **Merge #96** → 再打 DMG 或热更 companion
  2. 验收：新建场景、批量删知识、外部拷 skill 后 list/匹配
  3. 可选：fs.watch；ORT 体积预算若要 TinyClick
- **分支**：`feat/skill-disk-refresh` tip `c54dd3a`

### 2026-07-31 (S25 — UIUX breath 合 main + 场景 UX PR #93)
- #92 UIUX breath 合 main；#93 场景 rename/unapply 产品 SoT + 实现（S26 已合）
- 教训：场景 whitelist ≠ god-mode；装技能走 Skills 导入
<!-- handoff:end -->
