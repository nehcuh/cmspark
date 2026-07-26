# Computer Use 计划 Grill 题库（用户不在场，由对抗 + Claude + Pi 共议落盘）

> 范围：已同意的 redesign synthesis + 自动同意 UX。  
> 规则：每题给选项 + 推荐；三方讨论后锁死 **LOCKED** 答案。  
> 禁止用「以后再定」回避依赖后续分支的题。

## 背景已锁定（勿推翻，除非有安全硬伤）

- L0: 2 周黄金路径 = Mail 读 + Notes 写（verify）；微信发送非 v1 KPI  
- L1: 写路径 `posted` + `verified`；无 verified 不得说「已发送」  
- L2: 控制面/数据面分离；禁止要求用户「侧栏授权同时保微信前台」  
- L3: 审批默认「只同意这一次」；可选「本会话自动同意同类」默认不勾  
- L4: 安全红线（支付/密码/corpus/critical L2）不松  

## 待决议题（按依赖序）

### Q1 — 「本会话」的键是什么？

代码现状：`ComputerSessionTrust` 用 **WS 连接 sessionId**（`server.ts` 每连接 `randomUUID()`），日志里却常标 `thread_id: sessionId`。用户说「本会话」多半指 **聊天 thread（如 3ffkgl）**。

| 选项 | 含义 |
|------|------|
| A | 保持 WS sessionId（断线/重连丢 trust） |
| B | 改用 **chat thread_id**（同对话跨重连保留 trust，进程内） |
| C | 复合键 `(thread_id, app)`，无 thread 时回退 WS sessionId |

### Q2 — 未勾选「自动同意」时，approve 后授予什么？

| 选项 | 含义 |
|------|------|
| A | 与今日相同：一律 `grant` + corpus（静默后续 skip） |
| B | **仅本 task**：可 mid-task reL2 静默；**不** skip 下一 initial-L2 |
| C | 完全不 grant；每次 task 与每个 reL2 都问 |

推荐倾向 B（与用户 UX 对齐）。

### Q3 — 勾选「自动同意」后，skip 下一 initial-L2 的充分条件？

现状：trusted ∧ corpus⊆ ∧ budget≤max ∧ ¬credentialLatch ∧ ¬idle。

| 选项 | 增减 |
|------|------|
| A | 维持现状集合 |
| B | 另加：actions 条数 ≤ 已批 maxActions；且无 `experimental` 标志 |
| C | 放宽：无 type 的纯 screenshot/describe task 永远 skip |

### Q4 — type 文本 corpus 匹配规则？

| 选项 | 含义 |
|------|------|
| A | 精确字符串（现状 Set） |
| B | NFKC + trim + 折叠空白后精确 |
| C | 子串包含（危险：批过 "hi" 能否发 "hi 请转账"） |

### Q5 — `TYPE_NO_EFFECT` 后同 task 内策略？

| 选项 | 含义 |
|------|------|
| A | 立刻 fail task，禁止再 type 同文本 |
| B | 允许 1 次「重新 focus 输入框再 type」后仍 fail |
| C | 计入 budget 内任意重试直到 budget 尽 |

### Q6 — Notes/Mail 的 `verified` 定义（2 周黄金路径）？

| 选项 | Notes 写 | Mail 读 |
|------|----------|---------|
| A | AppleScript 写后 **list/read 回显含目标正文** | 结构化字段非空即 verified |
| B | 写 API 无错即 verified（弱） | 同上 |
| C | 写后 + 用户 ✓ | 读后用户 ✓ |

### Q7 — tool 表面在 2 周内做到哪一步？

| 选项 | 含义 |
|------|------|
| A | 仅改返回：`posted`/`verified`；仍一个 `host_computer` |
| B | A + 语义写走已有 `host_write` 扩 Notes；坐标仍 host_computer |
| C | 完整拆 host_read/app/write/computer 四工具 |

### Q8 — `host_computer` 是否仍 critical「每 task 必 L2」？

| 选项 | 含义 |
|------|------|
| A | 是；仅 corpus/budget trust skip 例外（现状+显式勾选） |
| B | screenshot/describe-only task 降为 trusted 可静默 |
| C | 全局开关可关 L2（否决倾向） |

### Q9 — `computer.foreground_yielded` 是否仍 PROMPT_ALWAYS？

| 选项 | 含义 |
|------|------|
| A | 仍 ALWAYS（自 UI 在 executor 层吞掉，不到 reL2） |
| B | 移出 ALWAYS；仅 foreign 时 prompt |
| C | 删除整个 foreground yield 产品 |

### Q10 — W1 后台键盘实验的 pass 标准？

| 选项 | 含义 |
|------|------|
| A | WeChat 非 key window 下 type 可见 → 才保留 P2 希望 |
| B | 任一测试 App（TextEdit）后台可达即认为 P2 可行 |
| C | 实验只记录，不改变 P1+P4 默认产品 |

### Q11 — 自动同意勾选文案语言？

给出最终中英各一句（≤40 字中文）。

### Q12 — 2 周结束「发布」定义？

| 选项 | 含义 |
|------|------|
| A | main 合并 + demo 录像 + 指标文档 |
| B | A + DMG 给内部试用 |
| C | 仅 feature 分支，不进 main |

### Q13 — 与 TinyClick / SkyLight 在 2 周内的关系？

| 选项 | 含义 |
|------|------|
| A | 冻结：不改、不依赖黄金路径 |
| B | 可修 bug 但不进成功标准 |
| C | 继续增强作为主路径 |

### Q14 — LLM 拆多个 host_computer task 时，用户体验？

| 选项 | 含义 |
|------|------|
| A | 产品接受；靠自动同意减摩擦 |
| B | system prompt 强制「单 task 聚合 actions」+ budget |
| C | server 合并同 app 连续 task（危险） |

---

## 输出格式（每位评审）

对 Q1–Q14 每题：

```
Q#: 选择 X
理由: ...
异议: ...
```

最后：

```
## Consensus risks
...
VERDICT: LOCK_ALL | LOCK_WITH_DISSENT | BLOCK
```
