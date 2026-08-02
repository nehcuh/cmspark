# ADR-021: 无人值守 · 桌面会话 grant（`host_computer` initial L2 skip）

**日期**: 2026-08-02 | **状态**: Accepted（设计双审 Pi+Claude APPROVE_WITH_NITS 20260802-153129；实现按 M1–M3 门控）  
**相关**: [ADR-017](017-computer-use.md) · [ADR-020](020-capability-model-three-axes.md) · [ADR-010](010-tiered-privilege-godmode.md) · Trust IA SoT · [设计 SoT](../superpowers/specs/2026-08-02-unattended-desktop-design.md)

---

## 背景

产品硬需求：**长程无人值守**，含白名单 App 上的 `host_computer`（如微信键入）在武装后不再每次弹任务级 initial L2。

既有机制不足：

- 运行自主度 / `auto_approve_*` / `allow_all_schemes`：**故意不**跳过 CU 任务 L2（Trust 单调）。  
- CU G1 session-trust：须**先**交互批准 + corpus ⊆，无法「武装后第一枪零确认」自由键入。

威胁：prompt 注入驱动桌面键鼠。故须 **独立会话 grant + 补偿地板**，禁止把桌面权塞进协议解锁。

---

## 决策

### 1. 新增进程内 grant（非 config SoT）

- API：`security.unattended.{arm,disarm,status}`  
- 存储：Companion **进程内存**；重启清空  
- 墙钟 hard TTL：**8h**（到点 auto-disarm）  
- **不**用 30m idle 清除值守 grant（与 G1 idle 分列）  
- 武装须：短语 `我了解风险` + 双 checkbox + 后果矩阵（含「键入不再逐字预览」）

### 2. Skip 代数

```text
hostComputerTrustSkip =
  g1InitialSkipEligible(...)           // 既有，交互后 corpus⊆
  || unattendedInitialSkipEligible(...) // 新：armed && coordinateAllowed && caps && floors

mustInteract 保持 sibling 形式：
  (!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip
```

`unattendedInitialSkipEligible`：

- armed 且未过期  
- 该次任务 App **实时** `coordinateAllowed`  
- 非 experimental action；`computer.modelEnabled !== true`  
- 非 credential latch  
- budget/actions ≤ caps（默认 30）  
- **不含** corpus ⊆（**open_within_app** — 与 G1 分列；blast radius 高于 G1，必须在 UI 红句披露）

### 3. 全局 bool 永不单独跳 CU

`allow_all_schemes` / `auto_approve_dangerous` / `auto_approve_enterprise_tools` **alone** 不得使 `hostComputerTrustSkip` 为真。  
武装无人值守时可 **dual-write** 巡航 bool（包装体验），但 CU skip **仅**看 unattended grant（或 G1）。

### 4. mid-task re-L2

`PROMPT_ALWAYS_TAGS`（danger_detected / experimental_suggestion / foreground_yielded）**不可**因值守静默。  
预算耗尽等仍按既有 reL2 规则。

### 5. 产品包装

- 运行自主度顶档：**无人值守**  
- 徽章：`值守中 · 桌面`  
- 急停 ≠ 解除（须 toast）  
- Pack / craft / import 禁止武装  

### 6. 修订既有 ADR 措辞

| 文档 | 变更 |
|------|------|
| ADR-017 D3 | 全局 auto_approve/god **仍**不跳 CU；**本 ADR grant** 可跳 **initial** L2 |
| ADR-017 D4 | G1 保留；值守为 **并行** 预武装路径 |
| ADR-020 Axis A rule 2 | 同上 carve；值守 = Trust packaging，非 L0 宽松继承 |
| ADR-010 | 协议解锁 ≠ 桌面值守 |
| Trust IA D4 | 脚注：仅 unattended grant 可跳 initial L2 |

### 7. Accepted residual

OCR 不可见的支付/图标 UI 可能漏检 — **产品接受**，文档诚实；不宣称值守=安全无人。

---

## 后果

**正面**：交付微信级长程无人值守 JTBD；与协议/企业门正交。  
**负面**：open_within_app 放大注入后键入面；依赖用户自负 + 急停 + 白名单纪律。  
**不做**：config 持久默认开；spawn 静默；Scheme C；弱化 estop。

---

## 实现门控

见 [impl plan](../superpowers/plans/2026-08-02-unattended-desktop-impl.md)：M1 companion → Pi；M2 UI → Pi；M3 集成 → Pi+Claude。

## 关联

- Design SoT · adversary synthesis · dual-review verdict `unattended-desktop-verdict-20260802-153129.json`
