# macOS TCC 产品身份 — 对抗验证合成（2026-08-01）

## 输入

- 用户否决：「去勾选 node」；用户只见 CMspark.app  
- 取证：`MacOS/CMspark`=bash；SCK 在 `Resources/cmspark-host`（`com.cmspark.host`，ad-hoc）  
- 错误串曾引导 `CMspark (and/or node / cmspark-host)`

## 方法

四角色否决：产品 / TCC / 安全 / 发布；20 条攻击清单写入 SoT §5.2。

## 方案裁决

| 方案 | 结果 |
|------|------|
| A 教用户勾 node | **REJECT** |
| B 只改文案 | **REJECT** |
| C 仅改 helper 显示名 | **INSUFFICIENT** |
| **D 主可执行= host 逻辑 + agent 身份** | **APPROVE_WITH_CHANGES** |
| E XPC 常驻 | **DEFER P1** |
| F Developer ID | **DEFER P1**（风险登记保留） |

## Blockers 必须进 P0

A1 默认 tray · A2 host-scripts 路径 · A3/A18 resolve 与单一 blob · A4 plist 身份 · A6 禁止双签名副本 · A11 override 安全 · A20 外 App 真机证据

## Verdict

**APPROVE_WITH_CHANGES** — 实现计划 Tasks 0–8；DoD = Spec §6。  
**Ship 前二次对抗**：独立 agent 只勾 DoD，捕获进程必须 = `MacOS/CMspark`。

## 产出

- `docs/superpowers/specs/2026-08-01-macos-tcc-product-identity-design.md`
- `docs/superpowers/plans/2026-08-01-macos-tcc-product-identity-impl.md`
