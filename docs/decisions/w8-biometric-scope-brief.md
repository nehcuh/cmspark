# Phase 1 W8 Biometric Scope — 3-Way Advisor Brief

> **Date**: 2026-07-16
> **Question**: W8 biometric tier 应覆盖哪些 write 操作？
> **Trigger**: Round 2 §4.2 "Touch ID 用于 write" 字面 vs Round 1 §4.5 reversibility 字面冲突。

## Context

Phase 1 W6 已 ship 的 write 操作：
- `host_write {kind:"create"}` Notes → 当前走 **ask-once**（45s dialog）
- `host_write {kind:"move"}` Finder → 当前走 **ask-once**

W6 设计依据：Round 1 §4.5 把 Notes create + Finder move 归类为**可逆**（备份 7 天 / trash）。

W7 Kimi+Pi 三方共识的 Q1 ship blocker：「writes always biometric per call, never thread-trusted」——但这只针对 thread-scoped bypass，未明确 per-call 是否一定 biometric。

W8 现在要实装 biometric tier（Round 2 §4.2 Phase 1 2 档确认梯度之一），scope 决策：

## 3 candidate scopes

### Option A: 字面读 Round 2 §4.2 — ALL writes biometric

- Notes create / Finder move / 任何未来 write → Touch ID per call
- 优点：与 Round 2 synthesis 字面一致；defense in depth；未来加 destructive verb 不需改 tier
- 缺点：与 Round 1 §4.5 reversibility 矛盾；用户创建每个 Note 都要 Touch ID，体验差；W6 行为变化

### Option B: 按 Round 1 §4.5 reversibility — 只 destructive biometric

- Notes create / Finder move → 保持 ask-once（可逆，已有 undo 路径）
- biometric tier 只用于**未来** destructive verbs（Mail send / delete mail / rm）
- 优点：UX 合理；与 Round 1 §4.5 一致；不破坏 W6 行为
- 缺点：Phase 1 没有任何 op 实际进 biometric tier（基础设施空转）；Round 2 字面被违反

### Option C: 折中 — Notes create biometric, Finder move ask-once

- Notes create（含用户数据写入） → biometric
- Finder move（位置变更，可 undo） → ask-once
- 优点：Notes 数据敏感度高于文件位置
- 缺点：界限主观；Finder move 也可能很危险（移走 SSH key 文件）

## 影响范围（任何 Option 都要做的基础设施）

无论选哪个，W8 需实装：
1. Swift binary `biometric-verify` subcommand（`LAContext.evaluatePolicy`）
2. WS message protocol: `risk_level: "biometric"` + `nonce` 字段扩展 `security.confirmation.request`
3. 扩展 UI: biometric prompt + Linux 6-char nonce 输入
4. Companion: BiometricConfirmationManager 或扩展现有 SecurityConfirmationManager
5. Tests: biometric success / fail / cancel / Linux nonce 验证

Option A 还要改 W6 host_write case：把 create-note + move-file 都强制 biometric。
Option B 不改 W6，biometric tier 实装但暂时不被任何 op 使用（为 Phase 2 destructive verbs 预备）。

## Advisor ask

对每个 Option：
- 推荐或不推荐
- 接受的 trade-off
- 是否 would-block-Phase-1-ship

最后选一个 + 给一句「如果选错会怎样」。

参考：
- `docs/decisions/computer-use-round2-synthesis.md` §4.2（Phase 1 2 档梯度）
- `docs/decisions/computer-use-round1-synthesis.md` §4.5（reversibility 表）
- `docs/decisions/w7-trusted-apps-final.md`（Q1 ship blocker）
- `companion/src/server.ts:1115-1200`（当前 host_write case 走 ask-once L2 gate）
