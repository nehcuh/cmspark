# macOS TCC 产品身份 — Pi + Claude 双审合成（2026-08-01）

## Verdict

| Reviewer | Verdict | Confidence |
|----------|---------|------------|
| Claude | **APPROVE_WITH_NITS** | 82% |
| Pi | **APPROVE_WITH_NITS** | 90% |
| Combined | **`both_ok=true`** — 可进入 Subagent-Driven 执行 | |

Artifacts:
- `macos-tcc-product-identity-claude-20260801-152315.md`
- `macos-tcc-product-identity-pi-20260801-152315.md`
- `macos-tcc-product-identity-verdict-20260801-152315.json`

## Agreement

1. Root cause 与方案 D **正确且非 cargo-cult**（SCK 调用方 CDHash / bundle 身份合一）。
2. D1–D10 内部一致；R1–R7 **均未触发**；A1–A20 映射 Task **无静默空洞**。
3. D10 override 安全保持；ADR-020 声明合格。
4. A20 真机 DoD 必须保留；A5 列表名须真机验证；失败走 Task 7.6。
5. ad-hoc 丢权诚实（D9）— 未假装 P0 需要 Developer ID 才能 ship。

## Nits → plan amendments（已写入 impl plan）

| # | Nit | Action |
|---|-----|--------|
| DR-N1 | `codesign --info-plist` 在 macOS 26 失败 | otool/strings 主 gate |
| DR-N2 | A6 需可测 | post-sign CDHash 相等断言 |
| DR-N3 | rg 漏 estop / split wording | 扩展 pattern |
| DR-N4 | arch -arm64 | 强制 `/usr/bin/arch` 包装 |
| DR-N5 | DisplayName 分裂 | 统一 `CMspark` |
| DR-N6 | daemon 路径 | P0=DMG only |
| DR-N7 | strings 误报 host id | Task1 只检 plist；Task2 清注释 |

## Blocking

**None.**

## Execution gate

Dual review confirmed → **Subagent-Driven (option 1)** 从 Task 1 开始；Task 7 人工验收硬卡。
