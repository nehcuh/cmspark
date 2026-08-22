# ADR-021: 无人值守 · 桌面会话 grant（`host_computer` L2 + re-L2 静默）

**日期**: 2026-08-02 | **状态**: Accepted（设计双审 Pi+Claude APPROVE_WITH_NITS 20260802-153129；实现按 M1–M3 门控）  
**修订**: 2026-08-09 — 产品澄清：武装=风险自担；**initial L2 与 mid-task re-L2 均静默**（不再因 modelEnabled/experimental/credential latch 退回弹窗；PROMPT_ALWAYS 在值守下亦静默）。  
**相关**: [ADR-017](017-computer-use.md) · [ADR-020](020-capability-model-three-axes.md) · [ADR-010](010-tiered-privilege-godmode.md) · Trust IA SoT · [设计 SoT](../superpowers/specs/2026-08-02-unattended-desktop-design.md)（历史设计仍写「re-L2 仍确认」— **以本修订为准**）

---

## 背景

产品硬需求：**长程无人值守**。用户经短语+双勾选武装后，已自担桌面键鼠与 prompt 注入风险；若值守期内仍逐步弹 L2 / re-L2，则「无人值守」名不副实。

既有机制不足：

- 运行自主度 / `auto_approve_*` / `allow_all_schemes`：**故意不**跳过 CU 任务 L2（Trust 单调）。  
- CU G1 session-trust：须**先**交互批准 + corpus ⊆，无法「武装后第一枪零确认」自由键入。  
- 早期值守设计只免 initial L2、仍保留 PROMPT_ALWAYS re-L2 — 与值守 JTBD 冲突（2026-08 产品纠正）。

威胁：prompt 注入驱动桌面键鼠。故须 **独立会话 grant + 白名单/坐标/硬拒绝地板**，禁止把桌面权塞进协议解锁。

---

## 决策

### 1. 新增进程内 grant（非 config SoT）

- API：`security.unattended.{arm,disarm,status}`  
- 存储：Companion **进程内存**；重启清空  
- 墙钟 hard TTL：**8h**（到点 auto-disarm）  
- **不**用 30m idle 清除值守 grant（与 G1 idle 分列）  
- 武装须：短语 `我了解风险` + 双 checkbox + 后果矩阵（含「键入不再逐字预览」与 re-L2 静默披露）

### 2. Skip 代数（initial L2）

```text
hostComputerTrustSkip =
  g1InitialSkipEligible(...)           // 既有，交互后 corpus⊆
  || unattendedInitialSkipEligible(...) // armed && coordinateAllowed && caps

mustInteract 保持 sibling 形式：
  (!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip
```

`unattendedInitialSkipEligible`：

- armed 且未过期  
- 该次任务 App **实时** `coordinateAllowed`（**vault-browser one-shot 永不 skip** — 浏览器不能持有该 bit，确认台必须弹出）  
- budget/actions ≤ caps（默认 30）  
- **不含** corpus ⊆（**open_within_app** — 与 G1 分列；blast radius 高于 G1，必须在 UI 红句披露）  
- **不再**因 `modelEnabled` / experimental action / credential latch 拒绝 skip（2026-08 修订）

### 3. 全局 bool 永不单独跳 CU

`allow_all_schemes` / `auto_approve_dangerous` / `auto_approve_enterprise_tools` **alone** 不得使 `hostComputerTrustSkip` 为真。  
武装无人值守时可 **dual-write** 巡航 bool（包装体验），但 CU skip **仅**看 unattended grant（或 G1）。

### 4. mid-task re-L2（2026-08 修订）

值守 `isUnattendedArmed()` 时，`executor.reL2` **全部静默通过**（含原 `PROMPT_ALWAYS_TAGS`：danger_detected / experimental_suggestion / foreground_yielded，以及预算耗尽等）。  
审计：`reason_skip: unattended_session_grant`。

**仍不经对话框、直接失败（throw）** 的硬拒绝（支付终确 / 验证码 / 凭证上下文 type·key 等）**不变** — 不弹窗确认，任务失败。

G1 / 全自动巡航路径**不**继承本条：无值守时 PROMPT_ALWAYS 仍 force interactive。

### 5. 产品包装

- 运行自主度顶档：**无人值守**  
- 徽章：`值守中 · 桌面`  
- 急停 ≠ 解除（须 toast）  
- Pack / craft / import 禁止武装  

### 6. 修订既有 ADR 措辞

| 文档 | 变更 |
|------|------|
| ADR-017 D3 | 全局 auto_approve/god **仍**不跳 CU；**本 ADR grant** 可跳 initial **与** mid-task re-L2 |
| ADR-017 D4 | G1 保留；值守为 **并行** 预武装路径（且 re-L2 比 G1 更宽） |
| ADR-020 Axis A rule 2 | 同上 carve；值守 = Trust packaging，非 L0 宽松继承 |
| ADR-010 | 协议解锁 ≠ 桌面值守 |
| Trust IA D4 | 脚注：仅 unattended grant 可静默桌面 L2/re-L2 |

### 7. Accepted residual

OCR 不可见的支付/图标 UI 可能漏检；值守下 re-L2 也不再二次人审 — **产品接受**（武装即自担）；文档诚实；不宣称值守=安全无人。

**windowLevel=hard（2026-08-10 multi-adv honesty）**：部分 danger 扫描在 `windowLevel === "hard"` 时走 re-L2 路径，在值守武装下会 **静默通过**（与 region payment / credential 类 **hard deny throw** 不同）。硬拒绝仍覆盖支付终确区、凭据上下文 type·key 等；window-level hard 静默是 **产品接受残余**，不得宣传为零风险。

**evaluate under 默认值守**：默认 dual-write 仅 dangerous+enterprise（非三旗），evaluate/osascript **仍 forceConfirm**；仅协议勾选/三旗才 waive。

---

## 后果

**正面**：交付真正的长程无人值守 JTBD（武装后不因桌面确认窗打断）；与协议/企业门正交。  
**负面**：open_within_app + re-L2 静默放大注入后键鼠面；依赖用户自负 + 急停 + 白名单纪律 + 硬拒绝 throw。  
**不做**：config 持久默认开；spawn 静默；Scheme C；弱化 estop / 硬拒绝。

---

## 实现门控

见 [impl plan](../superpowers/plans/2026-08-02-unattended-desktop-impl.md)：M1 companion → Pi；M2 UI → Pi；M3 集成 → Pi+Claude。  
2026-08-09：`unattended-grant` 放宽 initial floors；`executor.reL2` 值守 short-circuit。

## 关联

- Design SoT · adversary synthesis · dual-review verdict `unattended-desktop-verdict-20260802-153129.json`
