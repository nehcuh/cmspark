# Eval gate card — file-scheme-l2-path-cage

**Blast tier**: T3  
**Date**: 2026-08-19  
**Base**: origin/main  
**Branch**: feat/file-scheme-l2-path-cage

## Capability declaration (ADR-020)

```text
Surface:      L1 browser navigation (create_tab / navigate / set_tab_url)
L2-classes:   file: path-cage + HITL; javascript:/data:/chrome:/about:/blob: remain L1
Compose:      no MCP allow-dir writes; lists imported from allow-dir-expand only
Autonomy:     auto_approve_dangerous / auto_approved_domains MUST NOT skip file: L2
Trust:        relevantDomains literal []; god-mode (allow_all_schemes) still bypasses
Channel:      community | enterprise unchanged
```

## Machine (must pass first)

- [x] `npx tsc -p tsconfig.test.json` (companion) exit 0
- [x] `node --test` file-url-admission + url-cookie-admission + security-thread (65 pass)
- [x] `node --test --test-name-pattern='item 12'` security-gates (8 pass)
- [x] Outcome DoD:
  - [x] `file:///etc/passwd` cages, no confirm, error ≠ scheme
  - [x] HOME/Downloads pdf requests L2 even with auto_approve_dangerous + localhost whitelist
  - [x] relevantDomains === []
  - [x] javascript: still scheme L1
  - [x] copy scheme/cage 不含「若你已拒绝弹窗」
- [x] No default-on / no god-mode default

## Trajectory

- [x] Diff scoped to URL admission, copy, catalog, confirm strip, ADR-010
- [x] No drive-by on voice-classic-idle

## Judges（确认序：独立对抗 → Pi 复审）

- [x] 设计轮 A/B REJECT → 合成锁 L1–L12
- [x] 实现轮 A/B/C APPROVE_WITH_NITS；便宜 nits 已折入
- [x] Pi 复审 APPROVE（无 P0/P1 skip）
- [x] Nits owned：file: 白名单注入无专用集成测（空 relevantDomains + 通用 persist 过滤覆盖）

## Blast

- [x] T3 → 不 auto-merge
- Residual: get_page_html on an approved file: tab; Chrome may still fail tabs.create; home-only (no /tmp)

## Verdict

| Gate | Result |
|------|--------|
| MACHINE | PASS (targeted 65 + item 12) |
| ADVERSARY | APPROVE_WITH_NITS（已折入） |
| PI_REREVIEW | APPROVE |
| MERGE | 等人拍板（T3） |
