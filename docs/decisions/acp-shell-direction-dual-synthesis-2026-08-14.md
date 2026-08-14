# 编程 Agent 壳方向 · Pi+Claude 双路复审合成

> **日期**: 2026-08-14  
> **主合成**: [acp-shell-direction-synthesis-2026-08-14.md](acp-shell-direction-synthesis-2026-08-14.md)  
> **双审原文**:  
> - Claude: `docs/audit/reviews/acp-shell-direction-claude-dual-20260814-090803.md`  
> - Pi: `docs/audit/reviews/acp-shell-direction-pi-dual-20260814-090803.md`  
> **五路对抗**: JTBD / Trust / 反膨胀 / UX / 架构（摘要见主合成 §1）

---

## 双审裁决

| 路 | 裁决 |
|----|------|
| **Claude** | **APPROVE_WITH_NITS** |
| **Pi** | **APPROVE_WITH_NITS** |

**合成裁决: APPROVE_WITH_NITS → 方向锁定；下列 nits 并入主合成后即可作实现 SoT**

方向本身 **无需返工**。两路均确认：

- A（Client 渲染、禁嵌 TUI）**正确**  
- D/E/PTY **NO-GO 正确**  
- C 杀「工作台」名 **正确**  
- B 拆「状态一行 vs 全树」**正确**

---

## 矩阵确认（双路一致）

| 票 | 五路合成 | Claude | Pi | 终态 |
|----|----------|--------|-----|------|
| **A** Client 渲染 / 禁 TUI | GO / GO-WITH-GATES | CONFIRM（补 Phase B 门） | CONFIRM（补 Phase B 门 + 输入半壳） | **GO-WITH-GATES** |
| **B-status** git 一行 | GO-WITH-GATES | CONFIRM（定 optional vs S1） | CONFIRM（补 cwd 不变量） | **GO-WITH-GATES** |
| **B-tree** | DEFER | CONFIRM 门要数字化 | CONFIRM | **DEFER + 数字再入门** |
| **C-name** | KILL 工作台 | CONFIRM（H1 要对齐） | CONFIRM | **KILL** |
| **D** git 写 | NO-GO | CONFIRM | CONFIRM | **NO-GO** |
| **E** Monaco | NO-GO | CONFIRM | CONFIRM | **NO-GO** |
| **PTY** | NO-GO | CONFIRM | CONFIRM | **NO-GO** |

---

## 必须并入主合成的 nits（双审共识）

### N1 · A 必须引用 Phase B 解锁门（Pi bug / Claude 相关）

**问题**：矩阵写「Client 渲染 ACP 事件 = GO」易被读成「现在可以开全量协议开发」。  
2026-08-13 SoT Phase B 门：Accepted ACP ADR · §9 关键 Q 书面 · **数字需求门**（≥10 次真实任务包成功 / 14 天 / 跨 ≥3 日）。

**并入条文**：

- **A 渲染既有 shell**（transport 诚实、输出限流、CLI/ACP banner）= **现在可做**  
- **A 加深 ACP 协议 / 新 dialect** = **Phase B 三门通过后**  
- W1–W4：解锁前以 **任务包质量 + 入口文案** 为主；解锁后才加重「协议渲染投资」

### N2 · B-lite 定级 + cwd 不变量（Claude bug1 + Pi bug2）

**问题**：「可选 / W4 若 <0.5d」与 UX S1 must-ship 冲突；git 行真实性依赖 `spawn cwd == workspace_root`。

**并入条文（拍板）**：

- **B-lite git 一行 = S1 承诺**（非可有可无），退出标准：用户启动前能看到 branch · dirty，且不增加 start 点击。  
- **仅当 Companion 能断言 agent spawn cwd == workspace_root 时展示**；否则显示「工作区状态，非 Agent 目录」或省略。  
- 并入 UX：stale-while-live、默认沙箱场景不假称干净 repo。

### N3 · B-tree DEFER 数字再入门（Claude bug2）

**并入条文**：

再入条件（满足其一 + dual-review）：

1. 时间线/手回路径被点击或复制 ≥ **N 次/周**（建议 N=15）且跨 ≥3 线程；或  
2. ≥2 非作者 dogfood 明确「树不够用」  

若开树：**优先 Cockpit 宽窗**，非 Side Panel 永久左栏。

### N4 · 产品 H1 对齐（Claude S3 + Pi 命名）

**并入条文**：面板 H1 用 **「编程接力 · {Agent}」**（或会话副标题「编程助手 · {Agent}」）；产品主名永不改为「工作台」。

### N5 · 其余建议（双路）

| 项 | 动作 |
|----|------|
| stdout cap 量化 | 产品：tail ≤ **200 行** 或 **64KB** 环形缓冲；连续重复行去重 |
| handback 形状 | 须含：路径列表 · 一段摘要 · 建议页上验收一步；否则 UX 当未完成 |
| stream-json | **最多一种** 格式；第二格式需需求门；事件 **只读时间线**，禁止 event→点击动作 |
| composer | 仅 ACP 多轮；CLI 一发禁用 + 原因 |
| 急停/overlay | 编程全屏时头栏保留停止；或提示确认台/关面板 |

---

## 方向锁定（用户两问 · 终稿）

### Q1 · 封装 Agent 内部输出与渲染？

| | |
|--|--|
| **结论** | **不封装 TUI / 内部渲染**；**封装 Client 视图**（协议步骤 + 受控 stdout） |
| **理由** | 协议/进程/信任/JTBD/320px 五路一致；双审无异议 |
| **现在做** | 诚实 transport + 限流输出 + 统一 timeline 模型 |
| **以后做** | Phase B 门后加深 ACP；可选 **一种** stream-json |

### Q2 · 文件浏览 + Git 像 Zed？

| | |
|--|--|
| **结论** | **不做 Side Panel Zed**；做 **工作区上下文** |
| **v1** | 绑定 + basename + **git 一行（S1）** + 路径点选进任务 |
| **DEFER** | 全量 RO 树（数字再入门；优先 Cockpit） |
| **NO-GO** | commit/push/stage、Monaco、嵌 TUI、「编程工作台」品牌 |

---

## 最终产品票（本轮）

| 选项 | 票 |
|------|-----|
| 嵌 TUI / PTY 遥控 | **KILL** |
| Side Panel 伪 IDE / Monaco | **KILL** |
| panel 完整 Git 管理 | **NO-GO v1** |
| Client 壳（渲染 + 诚实） | **通过（GO-WITH-GATES）** |
| git status 一行 | **通过（S1）** |
| RO 全树 | **DEFER + 数字门** |
| 「编程工作台」产品名 | **KILL** |
| 2026-08-13 主票（薄接力 / 条件 ACP） | **维持** |

---

## 给实现的下一 Ticket（双审后）

```text
Title: 编程接力壳硬化 + 工作区上下文一行（非 IDE）

Must:
  - 入口/H1 对齐「编程接力」
  - transport 诚实 + Agent 输出 cap（200 行 / 64KB）
  - git 一行仅当 spawn cwd==workspace_root
  - handback 形状：paths + 摘要 + 建议验收
  - 无树 / 无 git 写 / 无 Monaco / 无 TUI

Must not:
  - 把 A 当成 Phase B 协议绿灯（须数字门 + ADR）
  - stream-json 多代理格式矩阵
  - event→可点动作绕过 L2
```

---

## 索引

| 文档 | 路径 |
|------|------|
| 五路合成 | `docs/decisions/acp-shell-direction-synthesis-2026-08-14.md` |
| 本双审合成 | `docs/decisions/acp-shell-direction-dual-synthesis-2026-08-14.md` |
| Claude 原文 | `docs/audit/reviews/acp-shell-direction-claude-dual-20260814-090803.md` |
| Pi 原文 | `docs/audit/reviews/acp-shell-direction-pi-dual-20260814-090803.md` |
| UX 分轴 | `docs/audit/reviews/acp-shell-direction-ux-20260814.md` |
| Brief | `docs/audit/reviews/acp-shell-direction-brief-20260814-090803.md` |
