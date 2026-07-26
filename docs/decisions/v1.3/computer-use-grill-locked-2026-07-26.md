# Computer Use Grill 落盘（对抗 + Claude + Pi，用户不在场）

> 日期：2026-07-26  
> 题库：`computer-use-grill-questions-2026-07-26.md`  
> 输入：  
> - 对抗 plan agent `019f9c15-54ad-7cc3-af9a-e013bca4ae4d` → `LOCK_WITH_DISSENT`  
> - Claude → `docs/audit/reviews/computer-use-grill-claude-20260726-094112.md` → `LOCK_WITH_DISSENT`  
> - Pi → `docs/audit/reviews/computer-use-grill-pi-20260726-094112.md` → `LOCK_ALL`  
> 裁决规则：**2/3 多数**；安全冲突时 **fail-closed 优先**；与 L0–L4 已锁前提冲突的选项否决。

---

## LOCKED 表（开工唯一真相源）

| Q | 题干 | Adv | Claude | Pi | **LOCKED** | 说明 |
|---|------|-----|--------|-----|------------|------|
| Q1 | 「本会话」键 | C | B | A | **C** | `(thread_id, app)` 为主；无 thread 回退 WS sessionId 且 **禁止 skip**。修日志误标 `thread_id: sessionId`。 |
| Q2 | 未勾选自动同意时 grant | B | B | B | **B** | 仅本 task（含可恢复 mid-reL2 静默）；**不** skip 下一 initial-L2。**修正今日 approve 即全量 grant。** |
| Q3 | 勾选后 skip 条件 | B | B | B | **B** | 现 G1 集合 + `actions.length ≤ maxActionsSeen` + 无 experimental 标志。 |
| Q4 | corpus 匹配 | A | B | B | **A*** | *Skip 判定用 **精确字符串**（fail-closed）。NFKC 仅可用于 **UI 展示**，不得用于 skip。否决子串。 |
| Q5 | TYPE_NO_EFFECT | B | B | B | **B** | 同 task 允许 **1 次** re-focus+同文 type；再失败 hard-fail，禁风暴。 |
| Q6 | Notes/Mail verified | A | A | A | **A** | Notes：写后 list/read 回显含正文；Mail：结构化字段非空。 |
| Q7 | 2 周 tool 表面 | B | B | B | **B** | `posted`/`verified` + Notes 语义走 `host_write`；坐标仍 `host_computer` last resort。 |
| Q8 | host_computer L2 | A | A | A | **A** | 每 task 必 L2；仅显式 opt-in + Q3 门可 skip。 |
| Q9 | foreground_yielded ALWAYS | A | A | A | **A** | 保留 PROMPT_ALWAYS；自 UI 在 executor 吞掉。 |
| Q10 | W1 键盘实验 pass | A | A | C | **A**† | †Pass 标准 = **微信**非 key-window type 可见。默认产品仍 P1+P4（C 的产品侧意图保留）。TextEdit 外推否决。 |
| Q11 | 勾选文案 | — | — | — | **见下** | 三方对齐语义。 |
| Q12 | 2 周发布定义 | A | A | A | **A** | main + demo 录像 + 指标文档。DMG 非门槛。 |
| Q13 | TinyClick/SkyLight | A | A | A | **A** | 2 周冻结；不进成功标准。崩溃级 hotfix 可独立闸，不进黄金路径叙事。 |
| Q14 | 多 task 拆分 | B | B | A | **B** | system prompt + 工具描述强制同 app 单 task 聚合；否决 server 合并。硬边界仍是每 task L2/corpus。 |

### Q11 锁定文案

- **中文（勾选标签）**：`本会话对「{app}」同类操作自动同意（不新增字、不扩次数）`  
- **英文**：`Auto-approve same-class {app} ops this session (no new text / higher budget)`  
- Tooltip 补：30 分钟无交互失效；companion 重启清空；危险/实验仍会询问。  
- **默认不勾选。**

---

## 必须改的 as-built 缺口（否则 LOCK 是纸面）

1. **今日一 approve 就 `grant`+corpus**（`server.ts`）→ 改为仅 `explicit_opt_in===true` 才打开 G1 initial-skip；未勾选最多 task-local reL2 静默。审计字段 `explicit_opt_in`。  
2. **Trust 键** 从纯 WS sessionId → **Q1=C**（thread 优先）。  
3. **日志** 不得再把 WS id 标成 `thread_id`。  
4. **maxActionsSeen** 与 budget 一并在交互批准时记录（Q3）。  

---

## 2 周 backlog（可直接拆 issue）

| ID | 项 | 验收 |
|----|----|------|
| G1 | `posted`/`verified` 返回契约 + `TYPE_NO_EFFECT`（Q5=B） | 单测 + 假成功回归 |
| G2 | L2 勾选 + explicit_opt_in grant（Q2/Q3/Q11） | 未勾选不 skip 下一 task；勾选后 corpus 子集 skip |
| G3 | Trust 键 thread_id（Q1=C） | 重连同 thread 保留；无 thread 不 skip |
| G4 | host_write 扩 Notes + 读回 verify（Q6/Q7） | Notes 正文读回匹配 |
| G5 | Mail 读结构化摘要 | 字段非空 |
| G6 | Prompt：单 task 聚合（Q14=B） | 文档 + 工具描述 |
| G7 | W1 微信后台键盘实验记录（Q10=A） | decision md；不改 v1 KPI |
| G8 | 冻结 TinyClick/SkyLight 主路径（Q13） | 范围声明 |

**非目标**：微信发送 hello world 作为通过标准。

---

## 安全不变量（重申）

- 支付/密码 hard-deny  
- 新字面量必 L2  
- 更大 budget / 更多 actions 必 L2  
- experimental 必 L2  
- foreign FG 必 L2（自 UI 除外）  
- 无 `verified` 不得宣称完成  

---

## 异议记录（不挡锁）

| 项 | 少数意见 | 处理 |
|----|----------|------|
| Q1 | Pi 偏 A（WS only） | 重连摩擦用「一次 L2 恢复」补；产品语义用 C |
| Q4 | Claude/Pi 偏 B normalize | skip 用 A；展示可 normalize |
| Q10 | Pi 偏 C 只记录 | 默认产品不变；pass 标准仍测微信 |
| Q14 | Pi 偏 A 接受拆 task | 用 prompt 减拆，不靠放宽自动同意 |

---

## VERDICT

**LOCK_ALL（综合裁决）** — 14 题均有锁定答案；可进入实现，无需用户再答 grill。

*Sources: adversary plan agent; Claude grill review; Pi grill review; synthesis 2026-07-25/26.*
