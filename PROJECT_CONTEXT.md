# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-30 (S23 — Trust P1 + browser_download 全合 main)
- **origin/main tip**：含 Merge #88 / #87 / #86 / #89 / #85 / #90（Trust §B P1a 四条 + browser_download P1.0 + CI hang 修）
- **已交付（本会话）**：
  - P1-1 god-mode companion phrase（#85）
  - P1-2 MCP/navigate `originWs`（#86）
  - P1-3 evaluate 批准后原码执行（#87）
  - P1-4 shell allowlist metachar P1a（#88）
  - browser_download：`chrome.downloads` + text + Downloads 沙箱（#89）
  - CI：`ensureFilesystemAllowlist` 勿 cwd-only 注入（#90）+ non-darwin osascript 测分叉
- **权威文档**：`docs/optimization-plan-post-adr-020.md`（排序）；`docs/audit/p1-security-open-items-2026-07-29.md`（随 PR 已 FIXED 四条）
- **下次**：
  1. 可选：main 上再扫一遍优化计划 §0/§B 与盘点一致
  2. P1-4 **P1b** argv；MCP 默认 allow 收窄（勿整 home）
  3. Windows **G3 真机**：可见「下载」→ Downloads 路径
  4. HUD P3a-full / CU / Pack — 按痛点，勿抢 Trust 残余
- **勿做**：UI phrase 当唯一 god-mode 门；dual-review 跑 companion 全量 `npm test`；无 Pack 替代加一级 Side Panel 入口

### 2026-07-29 (S22 — ADR-020 backlog + P1 inventory + P1-1 PR #85)
- 计划/盘点/PR template 已合；P1-1 实现当会话仅 PR，**S23 已合 main**
<!-- handoff:end -->
