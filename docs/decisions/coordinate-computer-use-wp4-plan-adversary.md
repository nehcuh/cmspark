# 坐标化 Computer-Use WP4 实施详案 — 计划级对抗裁决

> **日期**: 2026-07-20 · **对抗 Agent**: Adversary（只读评审；本轮审的是计划不是代码——实现尚未写）
> **被审对象**: `docs/decisions/coordinate-computer-use-plan.md`「WP4 实施详案」子节（274–370 行，6 个工作项 WI-1..WI-6）
> **复核基线（实读代码验证计划的事实断言）**: `companion/src/server.ts`（确认闸门 :500-718）、`security-confirmation.ts`（负载序列化 :168-185、超时 45s、CODE_PREVIEW_LIMIT）、`computer/preview.ts`、`chrome-extension/src/background/index.ts`（:694-730 上行白名单）
> **方法**: 计划逐行审 + 关键事实断言逐条回代码验证；未改任何业务代码

## 裁决: `PLAN SOUND WITH AMENDMENTS`

骨架是对的：协议字段全部可选向后兼容、确认门语义/originWs 绑定/45s 超时/nonce 流一概不动、helper 严格 best-effort 降级、徽标中性措辞、开关禁乐观更新——计划的纪律意识合格。规划者自列的 5 个攻击面**全部成立**，其中 4 个的防御设计方向正确，1 个（caption 转义）防御不足。但对抗复核发现 **2 个 HIGH 级计划缺陷**（P1 是计划没看见的**现网已存在**的 L2 截断洞——WP4 不修它，对话框含图也白含；P2 是预览图的非绑定性未声明，L2 语义会从「参考」被误读成「背书」）和 4 个中低级修正项。P1/P2 为强制修订，P3/P4 为必须，P5/P6 为建议。修订后即可进入开发。

---

## 1. 规划者自列攻击面评估（5 条：成立性 + 防御充分性）

| # | 成立? | 评估 |
|---|---|---|
| 1. L2 闸门副作用 | **成立，防御方向正确，两处需补** | try/catch + 5s 超时 + 降级无图的纪律正确；45s 确认超时从 dialog **发出时**起算（security-confirmation.ts:144-148），helper 的 5s 在 request() 之前，不侵蚀人类决策窗口——已验证无忧。需补：helper 在闸门内的位置应显式写在廉价前门（coordinateAllowed :547 / busy :555 / rate :562）**之后**（现状结构天然满足，但计划未写，防后续重构挪前）；超时杀与 raw 删除的顺序未规约 → P5。raw 清理有 WP2 sweepComputerTempCaptures（pid 归属）兜底，残余有界。 |
| 2. evidence.open 路径穿越 | **成立，防御完整** | 计划的四件套（`^[a-zA-Z0-9_-]+$` + 基目录解析 + reparse 复查 + 存在性检查）+「taskId 绝不拼命令行模板、必须独立 argv」正确：严格字符集下 explorer.exe 无参数注入面（无逗号/空格/斜杠）。补充一条可用性边角 → P6。 |
| 3. caption/文本伪造 | **成立，且计划的防御不足** | 「模板化 + JSON.stringify，Y3 同纪律」**挡不住全部换行伪造**：JSON.stringify 转义 `\n \r \t` 及 U+0000–001F，但**不转义 U+2028/U+2029**（JSON 字符串内的合法字符）——它们是否断行取决于渲染路径（white-space 模式），在 pre-wrap 语境会强制断行；零宽/格式字符（U+200B、U+FEFF）也原样通过。任务文本/锚文本是 LLM 生成的不可信内容，caption 构造必须做**字符类清洗**（剥离 `\p{Zl}\p{Zp}` 与零宽格式字符），不能只靠 JSON.stringify → P3。 |
| 4. 事件流状态机 | **成立，防御方向对，缺一条迁移规约** | reduceComputerTaskEvent 的 taskId 关联 + finished 后丢弃方向正确。但计划只规约了「丢弃」，没规约 **step-without-started**（面板重开/迟连，错过 started，首个见到的是 step）——按「不同 taskId 迟到事件丢弃」的字面实现，正在运行的任务在重开的面板上**没有任务条 = 急停按钮静默缺席**（热键通道仍在，但用户预期中的第三通道没了）→ P4。 |
| 5. 徽标信任放大 | **成立，防御到位** | 三态中性措辞 + 手设「人工设定」标注 + 禁乐观更新（等 apps.updated），与 WP3 §K.5「非权限位」语义一致。无新增发现。 |

---

## 2. 计划级缺陷（P1–P6）

### P1 — HIGH · 必须修订：`code_preview` 的 1200 字符截断让 L2 逐条枚举对大预算任务静默失效（现网已存在，WP4 不修则对话框含图无意义）

- **事实**：`security-confirmation.ts:7 CODE_PREVIEW_LIMIT = 1200`，`:125-129 codePreview()` 超限即截断加「…」。host_computer 的 `code` 就是 buildComputerL2Preview 的全文：30 动作 × 每行 ≈20–40 字符 ≈ 600–1200，叠加任务行/预算行/速率行后已在边缘；**只要含 type 动作，语料枚举（JSON.stringify，单任务上限 2000 字符）必然把全文推出 1200**——对话框末尾静默「…」，排在清单尾部（第 25–30 位）的动作与待输入文本**对人不可见**。恶意 LLM 把危险动作排在长清单尾部即可绕过「人类逐条核对」这一层（执行侧的危险词扫描/语料帽等机器检查仍在——损失的是人的知情同意，不是机器兜底，但 Y3 反伪造的全部意义就在于人能看到完整清单）。
- **计划为什么没接住**：WP4 的 WI-3 只加图片渲染，没审对话框文本通道的完整性；验收标准「确认对话框含标注截图」测不到文本截断。
- **计划应怎么改**：WI-2 增一条——computer 类确认的完整预览文本走**独立字段**（如 `full_preview`，绕过 codePreview 截断；或在 request 序列化时对 host_computer 豁免截断/提限至 8KB），WI-3 渲染为可滚动区；补性质测试「30 动作 + 2000 字符语料的预览文本到达面板时逐字完整」。这是 WP4 的强制工作项，不是可选增强。

### P2 — HIGH · 必须修订：预览图的「非绑定性」未声明——截图是闸门时刻的，执行时重新定位，十字线可能不是实际点击点；且只标注 30 个动作里的第 1 个

- **事实**：helper 在闸门前解析 hwnd + 截图 + 画十字线（WI-2）；executor 在批准后**重新解析 hwnd、重新截图、经四层链重新定位**（WP1 A1 / WP3 X3 纪律）。用户最长 45s 后批准，期间窗口可移动、内容可变化、首动作目标可消失——**对话框里的十字线与实际注入点之间没有任何绑定关系**。若 caption 只说「将在 <应用> 窗口中执行：<首动作>」，用户会把十字线读成「我批准的就是这一下」——L2 语义从「参考快照」反转成「精确背书」，这正是任务书里「顺序错了整个 L2 意义反转」的实质风险面（注：像素本身的方向是对的——capture 只读、只拍目标窗口、凭证已黑化、raw 即删、预览只去 originWs 面板、**不进工具结果/LLM 上下文**；先截图后确认不构成安全顺序反转，构成的是**语义声明缺失**）。
- **计划应怎么改**：caption 模板强制三段式——「① 将在 <应用> 窗口中执行 N 个动作（下方逐条列出）；② 十字线仅标注第 1 个动作的当前位置；③ 批准后将按实时屏幕重新定位，实际点击位置以执行为准」。同时把「预览图绝不进入工具结果/LLM 上下文」写成不变量并补断言测试（tool result 对象无 preview_image 字段）。

### P3 — MEDIUM · 必须：caption 构造的字符类清洗（JSON.stringify 不充分）

- 见 §1 攻击面 3 行。计划应怎么改：caption/captionCaption 构造链在模板化 + JSON.stringify 之外加一步**剥离 `\p{Zl}\p{Zp}`（行/段分隔符）与零宽格式字符（U+200B–U+200F、U+FEFF、U+2060 等）**；补「U+2028 载荷不产生第二行」的性质测试。同一条清洗函数应被 step 事件的 caption（同样源自 LLM 动作文本）复用。

### P4 — MEDIUM · 必须：事件状态机的 step-without-started 迁移未规约

- 计划应怎么改：WI-1 的 reducer 规约显式补一条——**见到未知 taskId 的 step/paused（非 finished 后迟到）时懒创建任务状态**（任务条出现，标记「进行中（恢复同步）」），而不是按「不同 taskId 迟到丢弃」字面丢弃；补测试「面板迟连 → 首个 step 事件 → 任务条与急停按钮可用」。急停按钮的存在性比事件流的整洁性优先——第三通道静默缺席比误显示一个任务条更危险。

### P5 — LOW-MED · 建议：helper 超时杀与 raw 删除的顺序规约

- 5s 超时在 TS 侧触发时，capture/OCR ps1 子进程可能仍在运行并在**删除之后**完成写盘 → raw 帧在 %TEMP% 复活（WP2 sweepComputerTempCaptures 按 pid 归属兜底，方向安全但有时间窗）。计划应怎么改：helper 的超时路径显式「先杀进程、等 exit、再删 raw」（或在计划里明文声明依赖 WP2 sweep 兜底及其时间窗）；WI-2 测试补「超时路径无 raw 残留」断言。

### P6 — LOW · 建议：evidence.open 无频率约束

- 任何已认证面板可循环调用 evidence.open 在用户桌面刷 explorer 窗口（路径已锁死，社会工程价值低，但可用性骚扰成立）。计划应怎么改：companion 侧加每面板每分钟上限（如 5 次）或在计划明示接受；一行即可。

---

## 3. L2 截图时机裁决（计划留下的权衡：闸门前 vs 按需刷新）

**裁：闸门前 best-effort + 超时降级（计划的原案）为正确选择**，附带四条护栏。

理由：① 对话框的**首次展示是注意力的最高点**，按需刷新按钮的实际点击率趋近于零——选「按需」等于对绝大多数确认退回纯文本，图片的教育/校验价值落空；② 预览像素**本就不绑定执行**（批准后 executor 必然重新截图重新定位，P2），按需刷新买来的新鲜度不改变任何执行结果，只改变用户看到什么；③ 闸门前的代价（每次确认 ≤5s CPU）已被超时与降级纪律封顶，且 helper 只读、不注入、不改前台，对目标应用零副作用；④ 按需方案把取图链路推进面板进程，复杂度与故障面反而上升。

护栏（并入计划）：a) helper 在闸门内的位置显式固定在廉价前门之后（§1.1）；b) 非绑定 caption（P2）；c) 超时路径 raw 必删（P5）；d) 预览不进 LLM 上下文的不变量测试（P2）。

---

## 4. 复核记录（计划事实断言逐条回代码验证）

| 计划断言 | 复核结果 |
|---|---|
| `computer.task.event` 四种事件、step 携 caption/previewImage、缺 layer/confidence/durationMs/locateAttempts、finished 缺 evidenceDir | 属实（executor emit 现状） |
| L2 复用 security.confirmation.request，code_preview 承载枚举文本，无 preview_image 字段 | 属实（security-confirmation.ts:168-185 序列化为显式清单——新增字段须同时改 interface 与序列化，计划已覆盖）；**附带发现 CODE_PREVIEW_LIMIT=1200 → P1** |
| 确认超时 45s、originWs 绑定（host_computer 无条件）、nonce 流 | 属实（:144-148、server.ts:717） |
| 急停按钮只缺 UI 发送方；abort 处理器已导出有测试 | 属实（server.ts:225-247 + F1 集成测试） |
| background 上行白名单需显式加 computer.task.abort / get_state / evidence.open | 属实（index.ts:694-730 列表内无此三项） |
| apps.list 经 `...e` 全量展开，uiaCapable 已在网线上 | 属实 |
| MAX_WS_MESSAGE_SIZE | 10MB 入向（server.ts:53）——预览图（≤200KB 二进制 ≈267KB base64）在出向，无门；扩展 chrome.runtime 消息上限 64MB，**无体积陷阱** |
| security-confirmation 无 IM/远程转发面 | 属实（grep 无 telegram/remote/relay——预览图只去 originWs 本地面板，不出本机） |

---
*Adversary verdict · CMspark coordinate computer-use WP4 plan · 2026-07-20*
