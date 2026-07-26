# Computer Use 产品设计综合（Claude + Pi 双路评审后）

> 日期：2026-07-25  
> 输入：`computer-use-product-redesign-brief-2026-07-25.md`  
> 评审：  
> - Claude → `docs/audit/reviews/computer-use-product-redesign-claude-20260725-235744.md` — **APPROVE_WITH_CHANGES**  
> - Pi → `docs/audit/reviews/computer-use-product-redesign-pi-20260725-235744.md` — **APPROVE_WITH_CHANGES**  
> 状态：**用户已同意主方向**；细节经 grill（对抗+Claude+Pi）落盘 →  
> `computer-use-grill-locked-2026-07-26.md`（可开工）

---

## 0. 双路共识（双方都同意）

1. **原罪是产品承诺，不是又一个 SPI bug**  
   把「坐标注入 post 成功」当成「微信消息已发送」是**范畴错误**。继续堆 SkyLight / autoscale / self-UI **解决不了**这个错误。

2. **必须有成功契约（Success Contract）**  
   Write = pre（焦点/会话已建立）→ act → **post-verify** → 才算 completed。  
   `posted ≠ completed`。假成功必须消灭。

3. **控制面 ≠ 数据面**  
   侧栏授权（Chrome 前台）是正常的。  
   **禁止**要求用户「授权时保持微信前台」。  
   前台管理是 **agent 的职责**（P1），或该 App 直接 **不支持写**（P4）。

4. **能力分级必须对外诚实**  
   - S-semantic / S-ax：可靠读写  
   - S-vision（微信类）：**默认不承诺发消息**；只读或实验性写  

5. **Kill 假成功循环**  
   type 无 verify → 禁止再 type 同一内容刷 20 次；typed error `TYPE_NO_EFFECT` / `SEND_NO_EFFECT`。

6. **安全红线一条不松**  
   L2 critical、corpus 绑定、支付/密码硬拒绝、vault 黑名单——不为「能点微信」放松。

---

## 1. 双方分歧与收敛

| 议题 | Claude | Pi | **综合收敛** |
|------|--------|-----|--------------|
| 微信是否进 2 周黄金路径 | 可做 Story B，但必须 **用户 ✓ 验证**，0 假成功 | **不要**进 2 周；先 Mail/Notes | **采纳 Pi**：2 周黄金路径 = Mail 读 + Notes 写（带 verify）。微信 Phase 2。 |
| S-vision 写如何验证 | **用户**是唯一诚实 verifier（侧栏 ✓ + 裁剪截图） | OCR verify 仅在前台接管 opt-in 时 | **采纳 Claude 对 S-vision**：用户确认「是否发出」；OCR 不作唯一真理 |
| 前台策略 | 先跑实验 P1 vs P2；认真评估 **P3 原生确认窗** | **P1 默认 + P4 边界**（组合不是二选一） | **P1+P4 为默认产品**；Week1 做微信后台键盘实验；P3 进 Phase 2 评估 |
| tool 表面 | 拆 host_read / host_app / host_write / host_computer；`ok→posted` | 同样强调 posted+verified 双布尔 | **双布尔强制**；tool 拆分按阶段做 |
| SkyLight | 降级为实验，不作黄金路径依赖 | 坐标路径永远 last resort | **坐标永远 last resort**；语义 API 优先 |

---

## 2. 拍板后的产品逻辑（推荐 v1）

### 2.1 用户怎么理解「电脑操作」

| 我想… | 系统走… | 成功长什么样 |
|--------|---------|--------------|
| 读邮件/笔记/文件 | 语义 API / 稳定 AX | 侧栏里出现**结构化结果** |
| 写笔记/发邮件 | 语义 API + 读回校验 | 侧栏说「已创建/已发送」，且 App 里**真有** |
| 截屏看看微信 | 截图 + OCR 描述 | 描述文字；**不承诺操作** |
| 用坐标点微信发消息 | **默认不提供**；可选「实验·前台接管」 | 用户自己点 ✓「我看到发出了」才算成功 |

### 2.2 前台悖论的解法（最终）

```
用户：一直在侧栏说话、点允许          ← 控制面，Chrome 前台 OK
Agent：需要时自己把目标 App 拉前台一下 ← 数据面，系统职责
系统：Chrome 自 UI 让位 → 静默恢复，不再弹十次确认
微信类写：默认「不支持」；实验模式才尝试，且用户验结果
```

**永远不要再对用户说：「请保持微信在前台，同时在插件里授权。」**

### 2.3 API 诚实性（工程最小必做）

每个写相关动作返回：

```json
{ "posted": true, "verified": false, "error_code": "TYPE_NO_EFFECT" }
```

- `posted`：事件是否注入  
- `verified`：效果是否确认（API 读回 / AX / **用户 ✓**）  
- 仅当 `verified:true` 时 LLM 可以说「已发送」

### 2.4 两周黄金路径（可验收）

| 天 | 里程碑 |
|----|--------|
| W1 D1–2 | 微信/典型 App：**后台键盘是否可达**实验，写入 decision 文档；决定 P1-only 还是保留 P2 希望 |
| W1 D3–5 | 写路径：`posted`/`verified` 分离；`TYPE_NO_EFFECT`；禁同任务同文本刷 type |
| W1 D6–7 | Mail 读：侧栏结构化摘要（S-semantic 读） |
| W2 D1–4 | Notes 写 + 读回 verify（S-semantic 写完整契约） |
| W2 D5–7 | 对外文案：微信 = 只读/实验；demo 录像；指标基线 |

**刻意不做**：微信发 hello world 作为 v1 成功标准。

### 2.5 微信（Phase 2，可选）

若 W1 实验证明必须前台：

- 入口：设置里 **per-app「实验·前台接管」**  
- 文案诚实：「可能把微信闪到前面；结果需你确认」  
- 流程：agent raise → 操作 → 侧栏展示裁剪截图 → 用户 ✓/✗  
- ✗ 或超时 → `verified:false`，LLM 不得说已发送  

---

## 3. Kill list（立即停止的方向）

1. 以 SkyLight/坐标为「发消息」黄金路径  
2. `ok:true` ≡ 任务成功  
3. 无 verify 的 type 重试风暴  
4. 要求用户「保持微信前台」的文案/指引  
5. TinyClick 作为写路径成功依赖  
6. 把微信发送当成 v1 必达 KPI  

---

## 4. 成功度量（产品健康）

| 指标 | 目标 |
|------|------|
| S-semantic 写：outcome 成功率 | ≥ 95%（Notes/Mail） |
| 假成功率（posted 真、用户无效果却报成功） | **≈ 0**（契约强制） |
| 每任务 re-L2 次数（自 UI） | → 1.0（仅初始确认） |
| 意图被路由到语义路径的比例 | 上升（说明没滥用坐标） |

---

## 5. 给用户的一句话

**电脑操作要做成「能证明结果的宿主能力」，不是「能乱点的鼠标键盘」。**  
微信发消息属于最难的一类，不应再绑架整条产品线；先把邮件/笔记做成可信，再以实验模式处理微信。

---

## 6. 待用户拍板

- [x] 是否同意 **2 周黄金路径不含微信发送**？ → **用户同意**  
- [x] 是否同意写路径强制 **posted/verified**？ → **用户同意**  
- [ ] Phase 2 是否要做 **tray 原生确认（P3）** 评估？  
- [x] 审批体验：明确动作可「自动同意」→ **用户提出并采纳（见 §7）**  

---

## 7. 审批体验：明确动作的「自动同意」（2026-07-26 增补）

### 7.1 用户诉求

> 比较明确的动作，审批时加一个自动同意，不然每个动作都要审批，太麻烦了。

### 7.2 现状（as-built）

| 机制 | 行为 | 缺口 |
|------|------|------|
| **Task L2** | 一次确认整段 `actions[]` + 字面量 + budget | 正确：不是「每个 click 一次」 |
| **session-trust grant** | 用户点允许后**静默** `grant(session, app)` | **对话框无显式开关**，用户不知道「已记住」 |
| **后续 task skip** | 同会话同 app 且 type 语料 ⊆ 已批 + budget ≤ 已批 → 可跳过 L2 | 新字面量 / 更大 budget / 危险标签 → 仍问 |
| **re-L2** | 信任下部分原因静默；danger / experimental / foreign FG 仍问 | 与「自 UI」修复配合 |
| **host_read/write** | 有勾选「信任此 app 本线程内不再询问」 | computer 路径**没有对等 UX 文案** |

摩擦来源往往是：① 用户以为每次点都要批；② LLM 拆很多 task、每次新字面量；③ 静默 grant 无感知；④ 误报 foreign FG 连环问（已修匹配）。

### 7.3 产品规则（拍板）

**对话框默认两档（必做）：**

1. **只同意这一次**（默认选中）  
   - 仅本 task 的 actions + 已列字面量 + 当前 budget。  
   - **不**写入「后续自动同意」（或只 grant 本 task 的 mid-reL2，不 skip 下一 task——实现二选一见下）。

2. **本会话自动同意同类操作**（勾选后与「允许」一并提交）  
   - 范围：`(本会话 sessionId, 本 app)`。  
   - **同类**定义（全部满足才静默）：  
     - type 语料是已批准语料的**子集**（无新字）；  
     - budget ≤ 用户交互批准过的 maxBudget；  
     - 无 PROMPT_ALWAYS 标签（danger / experimental / 真·foreign FG）；  
     - 无 credential latch。  
   - 进程内有效，companion 重启清空；空闲 **30min** 过期（沿用现 IDLE）。  
   - **文案示例**：  
     `☑ 本会话内对「微信」同类操作自动同意（不新增输入内容、不扩大次数时不再询问）`

**绝不能自动同意：**

- 支付 / 转账 / 验证码终确认类（hard-deny 仍硬拒绝）  
- 密码/凭证表面  
- 新的 type 字面量（「hello」批过 ≠ 可自动发「转账 100」）  
- 更大 budget  
- 用户未勾选「自动同意」时的**下一 task**（见实现选择）

### 7.4 与「明确动作」的对齐

| 明确 | 处理 |
|------|------|
| 用户说清 app + 要发的字 + 对象 | 一次 L2 枚举全部字面量；勾选自动同意后，同字重复发送可静默 |
| 模糊 / 多步探索 | 仍每次 task 问；或仅 mid-task reL2 在 trust 下静默 |
| S-vision 实验写 + 用户 ✓ | **结果确认**（发出了吗）≠ 执行前审批；自动同意不跳过「发出了吗」✓ |

### 7.5 实现要点（开工时，非现在写码）

1. **UI**：computer L2 增加显式 checkbox（对齐 host_read 的 thread trust 交互模式）。  
2. **语义**：`add_to_session_trust: true` 才 `grant` + extendCorpus；未勾选则**不** skip 后续 initial-L2（修正今日「一点允许就静默 grant」过宽——或保留 silent reL2-only grant，但 **initial skip 必须显式勾选**）。  
   - **推荐**：未勾选 = 仅本 task + 本 task 内可恢复的 reL2 静默；勾选 = 今日 corpus/budget skip 全开。  
3. **审计**：`computer.session_trust.granted` 必须带 `explicit_opt_in: true|false`。  
4. **文案**：去掉任何「请保持微信前台」；自动同意说明写清边界。

### 7.6 一句话

**审批默认一次一任务；用户主动勾选后，本会话对「同 app、同字、不扩权」的明确动作才自动同意——安全边界不缩小，只减重复劳动。**

---

*Sources: Claude & Pi dual review 2026-07-25, both VERDICT APPROVE_WITH_CHANGES; user product UX note 2026-07-26.*
