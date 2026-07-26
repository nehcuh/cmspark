I've read the grill file, the synthesis, `session-trust.ts`, and the L2 + grant wiring in `server.ts` (lines 481–490, 568–635, 1004–1027). Key code-level grounding before I answer:

- **Trust key today**: `ComputerSessionTrust.trusted: Map<sessionId, Map<appToken, GrantRecord>>` (session-trust.ts:134). `sessionId` is the WS connection id minted at `server.ts` connection setup (`randomUUID()`), NOT the chat `thread_id` — even though audit logs at server.ts:628 alias it as `thread_id: sessionId`. That aliasing is the Q1 lie.
- **Today's grant behavior**: server.ts:1004–1027 unconditionally calls `trust.grant()`, `clearCredentialLatch()`, `recordBudget()`, `extendCorpus()` on EVERY host_computer approve. There is **no `add_to_session_trust` parameter**, no opt-in checkbox state — Q2 option A is literally the as-built.
- **PROMPT_ALWAYS**: `foreground_yielded` IS in the always-prompt set (session-trust.ts:63–67 + 97–104). Q9 option A is as-built.
- **Skip gate** (server.ts:609–635): `trusted ∧ corpus⊆ ∧ budget≤maxBudgetSeen`. `reL2ShouldPrompt()` filters mid-task tags. No `experimental` flag check, no actions-count dimension — Q3 option B is a real tighten.

---

```
Q1: 选择 B
理由: 「本会话」的用户心智是 chat thread，不是 WS socket。今天 sessionId = randomUUID() 每连接一变，WS 重连（notebook 合盖、网络抖动、companion hot-reload）即清空全部 trust，把「勾过自动同意」变成「每 reconnect 必重勾」——这是 UX 谎言。改用 thread_id 后，同对话跨重连保留 trust 才成立。进程内有效、companion 重启清空，仍满足 blast-radius 上界。
异议: 没选 C 是因为 C 的「无 thread 时回退 WS sessionId」会悄悄放宽 trust 边界——thread_id 缺失本身就是异常态，应当 fail-closed（每 task 问），而不是回退到一个比 thread 更宽的 key。B 隐含「无 thread 即无 trust」是更安全的解释。
关键依赖: thread_id 必须由 companion 路由层服务端权威决定，不能由 client 在 WS frame 里 claim——否则 client 可以任填 thread_id 继承别人的 corpus。这是落地前必须验证的安全前提。
```

```
Q2: 选择 B
理由: 直接对应 synthesis §7.5 拍板的「未勾选 = 仅本 task + 本 task 内可恢复的 reL2 静默；勾选 = 今日 corpus/budget skip 全开」。今天 server.ts:1008 在每次 approve 后无条件 grant + extendCorpus，等于「点过一次允许就永远静默」，把「只这一次」选项架空。B 把 mid-task reL2 静默（同 task 内的 FOREGROUND-YIELD 自 UI 恢复、budget 用尽前的小停顿）保留为低摩擦，但下一 task 的 initial-L2 必须 re-prompt——这是「明确动作」UX 的安全锚。
异议: 不选 C（完全不 grant）是因为 mid-task reL2 每次都问会让用户在同一个 task 里点 5 次「允许继续」，是 friction 灾难且违反 §7 精神。
落地: server.ts:1004 块需要读 `finalParams.add_to_session_trust`（dialog 新增 checkbox state）；未勾时只调 reL2-only grant（一个新方法，不写 corpus / 不 recordBudget），勾时才走今天的全量 grant。
```

```
Q3: 选择 B
理由: 现 skip 集合（trusted ∧ corpus⊆ ∧ budget≤max ∧ ¬credentialLatch ∧ ¬idle ∧ ¬PROMPT_ALWAYS）是必要不充分。B 加两条收紧：(1) `actions.length ≤ 已批 maxActions`——budget 是上限，但 LLM 可能 budget=20 actions=2 蒙混；显式 actions 维度防「小预算多次轻量 task」刷量。(2) `experimental` 标志位存在时强制 re-prompt——TinyClick G4 / 实验层永远不能进入静默 skip，这是 G4 design 的硬约束。
异议: 不选 A 是因为它维持现状，没有把 synthesis §0.5「Kill 假成功循环」落到 skip gate；不选 C 是因为「纯截图/描述」task 仍可外泄屏幕内容（OCR → prompt injection → data leak），把它降级为 silent 是隐私事故。
```

```
Q4: 选择 B
理由: A（精确 Set）过于字面——输入法的全角/半角、Unicode 组合字符、首尾空白会让用户看到「明明勾过自动同意却还问」的诡异行为。C（子串）是安全灾难：批过 "hi" 就能让 LLM 发 "hi 请转账 100"。B 的 NFKC + trim + 折叠空白是 TLS 证书比对、密码哈希的标准 normalize，既关闭 Unicode bypass 又不放宽语义边界。是同时更安全 + 更好用。
异议: 落地时必须双向 normalize——既在 extendCorpus 时 normalize，也在 corpusContains 比对时 normalize，否则 Set 里存的是原始串、查的是 normalize 串会全 false。今天 session-trust.ts:254-278 两端都直接 add/has，需要包一层 normalize 函数。
```

```
Q5: 选择 B
理由: synthesis §0.5 明令「type 无 verify → 禁止再 type 同一内容刷 20 次」。A（立刻 fail）太脆：focus 竞争是真实存在的瞬时故障（NSWindow makeKeyAndOrderFront 失败一次），一次失败就 hard-fail 会让 Notes 写路径 verify 成功率掉到不可用。C（budget 内任意重试）正是 §0.5 禁止的 storm。B 的「1 次 re-focus + re-type」是唯一面向 root cause 的恢复路径——re-focus 是不同动作（不是同文本刷），如果 re-focus 后仍 TYPE_NO_EFFECT，那是真坏，hard-fail 才对。
异议: B 的状态机必须在 executor 里明确：`type_no_effect_count` 只能 0→1，且重试动作必须 `focus → type` 不能只 `type`。否则会退化成 C。
```

```
Q6: 选择 A
理由: Notes 写 + Mail 读是 S-semantic（synthesis §0.4），定义为「可靠读写」。Notes 的 verify 用 list/read 回显比对目标正文，是 API 层可证的诚实契约——「我写进去 → 我读出来 → 内容匹配」三段成立才算 verified。Mail 读同理：结构化字段非空（且非缓存）即证明读到了真实数据。C（用户 ✓）留给 S-vision 类（微信）；如果 Notes/Mail 也要用户 ✓，等于承认它们不可信，整个 2 周黄金路径失去意义。
异议: Mail 读的「结构化字段非空」需要在实现时区分「非空 + 时间戳新于上次读」——否则 LLM 可能返回缓存字段冒充新读。这是 A 落地时的细节，不影响选 A。
```

```
Q7: 选择 B
理由: host_read / host_write / host_app / host_computer 在 server.ts:475 + 1322 已是分离的工具——架构上 C 已经成立。但 LLM 的 system prompt 默认还是把 Notes 写、Mail 读都往 host_computer 塞（坐标路径）。B 的「语义写走 host_write 扩 Notes」是把 LLM 默认路由从坐标改到语义 API，符合 synthesis §3「坐标永远 last resort；语义 API 优先」。A 只改 return shape 不改路由 = 换汤不换药，LLM 还是会滥用坐标。
异议: 不选 C 是因为「完整拆 4 工具」在 2 周内是过度工程——agent 端 prompt + tool description 改动就够，不需要再加新 tool surface。先把 host_write 的 Notes 支持补齐 + 把 host_computer 的 system prompt 降级为「坐标 last resort」。
```

```
Q8: 选择 A
理由: host_computer = 输入注入（坐标 click + 键盘 type），是 critical 表面。server.ts:481 注释明写「critical-class — the task-level L2 dialog is shown EVERY task (god-mode / auto-approve do NOT skip it)」。A 唯一例外是 Q3 的 corpus/budget 显式 opt-in skip——这是用户主动让渡的、可撤回的、有 idle/latch 兜底的信任。B 把 screenshot/describe 降为 silent 是隐私灾难（agent 偷看屏幕用户不知道）；C 全局关 L2 是 synthesis §3 明令 kill 的。
```

```
Q9: 选择 A
理由: synthesis §2.2 拍板「前台管理是 agent 的职责（P1）」。agent 主动把目标 App 拉前台再让 Chrome 让位，是预期内的 yield——应当被 executor 的 self-UI 吞掉，不应当到 reL2。但「foreign process 抢前台」（用户切走、别的 app 弹通知）是真 hijack 信号，必须 prompt。A 把 PROMPT_ALWAYS 留作兜底安全网：self-UI 工作时用户永远看不到；self-UI 失效（真 foreign）时 prompt 必触发。这是分层防御的正解。
异议: 不选 B（移出 ALWAYS 仅 foreign 时 prompt）是因为「foreign vs agent-intentioned」的判别在 executor 里很难做到零误报——一旦判错成 agent-intentioned 就是静默 hijack。A 让 PROMPT_ALWAYS 当兜底，self-UI 当 UX 优化，两层独立。
```

```
Q10: 选择 A
理由: synthesis §2.4 W1 D1–2 明写「微信/典型 App：后台键盘是否可达实验... 决定 P1-only 还是保留 P2 希望」。B 用 TextEdit 验证 P2 可行是科学错误的——TextEdit 是模范 AppKit 文本控件，后台键盘几乎一定可达；微信是 Qt/Web 渲染 + 自绘输入框，行为完全不同。B 通过 ≠ 微信通过，是 false-positive 实验。C 拖延决策，违反 W1 deadline。A 是唯一诚实实验：直接在微信测，结果直接决定 P2 取舍。
```

```
Q11: 选择（最终文案）
中文（≤40 字）:
  ☑ 本会话内，对此 App 同类操作自动同意（无新文字、不扩次数时）
English:
  ☑ Auto-approve similar actions for this app this session (no new text, no larger budget)

理由: 文案必须把 §7.3 的 4 条边界（same app / corpus subset / budget ≤ / no PROMPT_ALWAYS）压缩到用户能读懂的一句话。「同类」必须用括号限定（无新文字、不扩次数），否则会被读成「微信随便发啥都不问了」——这正是 synthesis §7.3 警告的语义滑落。刻意不写「本机」「永久」字样，避免用户误以为跨会话保留。
异议: 「App」在中文里用拉丁字母 OK——比硬翻「应用程序」短，且与产品 UI 已有 App Tab 一致。
```

```
Q12: 选择 A
理由: 2 周黄金路径的 ship 应当是「工程发布」而非「用户分发」。A = main 合并 + demo 录像 + 指标文档，符合 synthesis §2.4 W2 D5–7 的「demo 录像；指标基线」。B 加 DMG 内部分发会引入打包 + 签名 + notarization 负担，且 computer-use 涉及宿主输入注入，DMG 装到更多机器上 = 攻击面变宽，fail-closed 角度应当先 main + demo，让既有 companion 用户（已部署）自然升级，不主动扩安装基。C 只留 feature 分支 = 2 周工作等于零交付，否决。
```

```
Q13: 选择 A
理由: synthesis §3 kill list 明令「以 SkyLight/坐标为发消息黄金路径」「TinyClick 作为写路径成功依赖」立即停止。当前 git status 里 companion/src/host-use/darwin/host-skylight.swift + build-host-skylight.sh 还在变动——A 的「冻结」把这些 PR 暂停，避免它们干扰黄金路径验证。B「可修 bug」是滑坡：bug fix 很容易变成 feature 增强，且会让 2 周指标无法判断「是语义路径成了还是 SkyLight 又救了一次」。C 是 synthesis 明令 kill 的。
异议: 若 SkyLight 出 P0 crash 阻塞了 Mail/Notes 黄金路径（极端情况），可破例修一行；但默认 A。
```

```
Q14: 选择 B
理由: LLM 拆多 task 是 corpus 失效的头号原因——每 task 一个新字面量 → 每次都触发 initial-L2。A 接受现状靠自动同意 = 自动同意永远不触发（corpus 永远不⊆）。C 服务端合并 = 破坏审计 + 任务边界 + trust 语义。B 用 system prompt 强制 LLM「单 task 聚合同 app 的所有 actions + 显式 budget」，一次 L2 列全部字面量——这正是 synthesis §7.4「明确动作」的形态（用户说清 app + 字 + 对象 → 一次枚举全部）。
异议: system prompt 强制不是 100% 可靠，LLM 偶尔会拆。这需要配套监控：连续 N 个 host_computer task 同 app + 累计字面量可合并时，companion 应当 emit `computer.task_split_recommendation` audit 事件，便于 offline 调 prompt。
```

---

## Consensus risks

1. **Q1 thread_id 绑定真实性（阻塞性）**: 我选 B 的前提是 thread_id 由 companion 服务端权威决定。如果今天 WS frame 的 `thread_id` 是 client claim 的（很可能就是）， attacker 可以任填 thread_id 继承别人 corpus——这会直接绕开 Q3 所有收紧。落地前必须 grep `thread_id` 在 server.ts 入口的所有 source，确认它是从 thread-manager 服务端查出来的，而不是 client frame 字段。**这是 LOCK 前的硬门槛。**

2. **Q2 实现 API 缺口**: server.ts:1004 块对 `add_to_session_trust` 参数完全无知。dialog 端要加 checkbox、companion 端要分两路（reL2-only grant / 全量 grant），工作量集中在 security-confirmation.ts + server.ts:1004。如果 dialog 改动落地慢，B 退化为 A（今天的过宽行为）。需要明确 owner + 工期。

3. **Q5 retry 状态机**: B 允许 1 次「re-focus + re-type」，executor 必须维护 `type_no_effect_count` per-task 且强制重试是 `focus→type` 不能只 `type`。如果实现写成「retry same action」就退化成 C 的 storm。需要 computer-executor.test.ts 加专门用例：same-text loop 必须 hard-fail。

4. **Q9 self-UI 可靠性**: A 把 PROMPT_ALWAYS 当兜底，前提是 self-UI 能吞掉 agent-intentioned yield。如果 self-UI（self-ui.ts，git status 中是新增文件）还没稳定，用户会被 prompt 轰炸——这不是安全问题（fail-safe 方向），但会让 Q11 的自动同意文案背锅。建议 self-ui.test.ts 覆盖率作为 Q9 的前置 gate。

5. **Q11 文案 A/B**: 我给的文案没经过用户阅读。落地前用 5 个内部用户测两版（「同类操作」vs「同样的字 + 同样的次数」），看哪版不被误读成「永久允许」。

6. **Q13 SkyLight PR 暂停成本**: 当前 host-skylight.swift 在 PR 流中，A 的冻结会让在飞的 PR 卡住。需要告知相关 owner，避免他们以为被否决。

VERDICT: LOCK_WITH_DISSENT

我锁所有 14 题答案，但 dissent 在 Q1 的实施前提：**thread_id 必须是服务端权威的，不能是 client claim 的**。如果落地阶段发现 thread_id 仍由 WS frame 决定，则 Q1 必须降级为 C（复合键 + WS 兜底），且 WS 兜底分支永远不能 skip initial-L2（即 WS 兜底等价于「无 trust」）。这个降级路径不应当被默认采用——应当先修补 thread_id 的服务端权威性，再 LOCK Q1=B。
