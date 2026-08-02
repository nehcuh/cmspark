# 无人值守 · 桌面值守 — 产品设计 SoT

> **日期**: 2026-08-02  
> **状态**: **LOCKED for M1** — 四路对抗 + Pi/Claude dual-review **APPROVE_WITH_NITS**（`unattended-desktop-verdict-20260802-153129`）；nits 已并入 ADR-021  
> **用户锁定**: 无人值守硬需求 · 武装后 `host_computer` **零 initial L2** · **会话(进程)作用域** · 仅 `coordinateAllowed` App · 不扩 `allow_all_schemes`  
> **对抗**: [unattended-desktop-adversary-synthesis-20260802.md](../../audit/reviews/unattended-desktop-adversary-synthesis-20260802.md)  
> **实现计划**: [../plans/2026-08-02-unattended-desktop-impl.md](../plans/2026-08-02-unattended-desktop-impl.md)  
> **父 SoT**: [Trust IA 2026-08-02](2026-08-02-trust-ia-autopilot-design.md)（运行自主度 P0+P1）  
> **将修订**: ADR-017 Decision 3/4 · ADR-020 Axis A rule 2 · Trust IA D4 · 新 ADR-021  

---

## 0. 一句话

**「无人值守」= 运行自主度顶档：一次短语武装后，在本 Companion 进程内，对已白名单且已开坐标的 App 执行 `host_computer` 时跳过任务级 initial L2（含微信键入预览）；叠加网页/企业巡航能力；急停/危险 re-L2/硬拒仍有效；重启失效。**

---

## 1. 问题与锁定决策

### 1.1 问题

- S34 运行自主度只覆盖网页 ± 企业 shell；**微信 CU 仍每任务确认**。  
- 用户心智：God / 全自动 = **长程无人值守**（硬需求）。  
- 现 ADR 写「god 永不跳 CU」——与终局 JTBD 冲突，须 **显式修订**，不可静默扩 `allow_all_schemes`。

### 1.2 用户锁定（不得在实现中推翻）

| ID | 锁 |
|----|-----|
| U1 | 无人值守是产品硬需求，不是可选实验 |
| U2 | 武装后 **零** host_computer **initial** L2（Option B） |
| U3 | 作用域 = **Companion 进程内存**；默认不写 config 持久 |
| U4 | App = 仅 `coordinateAllowed` ∩ 非结构排除 |
| U5 | 不通过扩 `allow_all_schemes` 实现桌面权 |
| U6 | Pack 不能武装 |
| U7 | 开发：M0 双审 → 节点 Pi 审 → 终局 Pi+Claude 双审 |

### 1.3 安全对抗立场（须在 SoT 中诚实）

Security agent **REJECT_PRODUCT_GOAL**（注入 → 微信/桌面无预览）。  
本 SoT **接受该目标为产品决策**，并强制 **§4 补偿地板**；残余 OCR 规避支付 UI 风险记为 **accepted residual**，不得假装为零。

---

## 2. 目标 / 非目标

### 2.1 目标

1. 武装后第一枪微信 type **无** initial 确认台。  
2. 多小时多任务（同进程）对已坐标 App 持续 skip initial L2。  
3. 顶栏 **值守中 · 桌面** 可见 + 一键解除。  
4. 与 S34 网页/全自动/协议档共存；改档离开值守必须清 grant。  
5. 审计可区分 `unattended_session_grant` vs `god_mode` vs G1 `session_trust_corpus_subset`。

### 2.2 非目标 v1

- config 持久「开机即值守」  
- 跳过 spawn / ask_user / board / MCP critical / host_cli  
- 静默 PROMPT_ALWAYS（danger / experimental / foreground_yielded）  
- 任意窗口（非白名单）  
- Pack 武装  
- Scheme C  
- 无限动作预算  

---

## 3. 产品形态

### 3.1 运行自主度档位（扩展）

| 档位 | 含义 |
|------|------|
| 每次确认 | 默认 |
| 网页巡航 | web L2 skip |
| 全自动巡航 | web + enterprise shell/netsec 有范围 |
| 全自动+协议 | 上者 + allow_all_schemes |
| **无人值守** | 默认叠 **全自动（无协议）** + **桌面值守 grant**；可选子开关「同时协议解锁」 |

### 3.2 双层状态

| 层 | 存储 | 持久 |
|----|------|------|
| A 巡航 flags | 现有 security bools | 是（config） |
| B 桌面值守 grant | Companion 内存 | **否** |

### 3.3 武装仪式（强制）

1. 选 **无人值守**  
2. 后果矩阵（含「键入内容执行前不再逐字确认」红句）  
3. 双勾选：  
   - 允许已白名单坐标 App 本会话免初始确认  
   - 确认重启 Companion 后失效  
4. 短语 **我了解风险**  
5. `security.unattended.arm` + dual-write full cruise bools（企业通道约束同 S34）

### 3.4 徽章

- StatusRail：**值守中 · 桌面**（优先于巡航中）  
- 点击：解除值守（默认只清 B；可选「全部巡航」）  
- 急停 toast：任务已停 · **值守仍开**  

### 3.5 后果矩阵（无人值守列摘要）

| 工具族 | 无人值守 |
|--------|----------|
| 网页 L2 | 跳过 |
| 协议 L1 | 默认仍阻断；勾协议才跳 |
| shell/netsec 有范围 | 跳过* |
| **host_computer initial L2** | **跳过†** |
| danger/experimental/foreground re-L2 | **仍确认** |
| spawn / ask_user | 仍确认 |
| 支付/凭据 | 硬拒绝 |

† 仅 coordinateAllowed；预算耗尽仍断。

---

## 4. 补偿地板（合并 Security C 系列 · 实现硬门）

| ID | 要求 |
|----|------|
| F1 | Phrase + 双 checkbox + 矩阵 |
| F2 | 进程内存；重启清；v1 无 disk |
| F3 | 每任务 `assertCoordinateAllowed` |
| F4 | PROMPT_ALWAYS 不可静默 |
| F5 | 硬拒支付/凭据路径不变 |
| F6 | 单任务 budget/actions 上限（默认 30，可配置下调） |
| F7 | 进程级注入速率不放宽；可选值守时 **更严** hourly cap（实现默认：保持 30/60s，OQ 是否收紧） |
| F8 | Estop 预检不可弱化 |
| F9 | Pack 禁武装 |
| F10 | 审计 `unattended_session_grant` |
| F11 | 徽章 + 解除 |
| F12 | 急停 ≠ 解除 |
| F13 | modelEnabled / action.experimental 挡 silent initial（对齐 G1 D11） |
| F14 | 墙钟 hard TTL **8h**（到点自动 disarm） |
| F15 | 值守 **不**用 30m idle 清 grant（否则 JTBD 失败）；G1 idle 规则不变 |

**Accepted residual**: OCR 看不见的支付 UI / 图标按钮 — 文档诚实；不宣称「值守=安全无人」。

---

## 5. 运行时语义

### 5.1 Skip 代数

```text
hostComputerTrustSkip =
  g1InitialSkipEligible(...)          // 现网：交互后 corpus⊆
  || unattendedInitialSkipEligible(...) // 新：armed && coord && caps && !exp && !model && !credLatch

mustInteract =
  (!skipConfirmation || forceConfirm)
  && !hostComputerTrustSkip
  && !enterpriseSkip
```

### 5.2 unattendedInitialSkipEligible（概念）

- `isUnattendedArmed()`  
- app `coordinateAllowed === true`（实时）  
- 非 experimental action；`modelEnabled !== true`  
- 非 credential latch  
- budget/actions ≤ caps  
- 未过 hard TTL  

**不含** corpus ⊆（open_within_app — 与 G1 分列，ADR 必写 blast radius）。

### 5.3 re-L2

完全沿用 `reL2ShouldPrompt` / PROMPT_ALWAYS — 值守 **不**改 mid-task 危险类。

---

## 6. ADR 修订清单（M0 先合文档）

| 文档 | 变更 |
|------|------|
| **新 ADR-021** | 无人值守会话 grant；wire；floors；非目标 |
| ADR-017 D3/D4 | 全局 bool 仍不跳 CU；会话值守可跳 **initial** L2 |
| ADR-020 Axis A rule 2 | 同上 carve；Trust packaging 语言 |
| Trust IA D4 / 矩阵 | 例外脚注 |
| ADR-010 | 再确认协议解锁 ≠ 桌面 |
| computer-use-user-guide §5 | G1 vs 值守对照表 |
| confirm-center / mission-pack | 锁步 |

---

## 7. 能力声明

```text
Surface:      L2 (host_computer trust packaging only)
L2-classes:   host_computer
Compose:      none
Autonomy:     single (spawn still L2)
Trust:        session unattended grant + existing autopilot flags
Channel:      community+enterprise (shell 仍 enterprise 约束)
```

---

## 8. 工作流门（用户强制）

```text
[M0] ADR-021 + 本 SoT + impl plan
     → scripts/dual-external-review.sh unattended-desktop
     → 双方 APPROVE* 才能写代码

[M1] companion unattended-grant + server wire + unit tests
     → Pi review only
     → APPROVE* 才能 M2

[M2] extension 无人值守档 + arm/status/disarm + 徽章
     → Pi review only

[M3] integration tests + docs + manual WeChat checklist
     → Pi + Claude dual-review
     → APPROVE* 才能 merge / 宣称完成
```

任一 REJECT → 修后重开该门，禁止跳门。

---

## 9. 验收金句（三句全真才算交付）

1. **武装后第一枪微信 type：零 initial L2。**  
2. **前台被抢 / 危险检测 / 实验定位：仍弹。**  
3. **Companion 重启后：必须重新武装。**

---

## 10. VERDICT（内部合成）

| | |
|--|--|
| 产品 | **GO** with floors |
| 安全 | 记录 **REJECT 目标**；以 F1–F15 + residual 声明推进 |
| 治理 | **GO** iff M0 ADR 先合 |
| 实现 | **GO** M0–M3 plan |

**对外状态**: 待 Pi+Claude 对 SoT+plan **APPROVE_WITH_NITS 或更高** 后进入 M1。
