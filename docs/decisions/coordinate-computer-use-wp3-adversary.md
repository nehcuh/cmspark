# 坐标化 Computer-Use WP3 实现代码 — 对抗裁决（代码级）

> **日期**: 2026-07-19 · **对抗 Agent**: Adversary（只读评审 + 本机只读探针）
> **被审范围**: 分支 `computer-use-w8-windows`，commit `9983681..HEAD`（WP3 六个 commit：`4bf6a87` UIA 准入探针 + uiaCapable 写回、`6a776b5` L0 定位器 + 四层链、`d11b186`/`15d5fa7` WindowOpened 订阅、`ad2a987`/`f9afc63` F1 abort 抽取，18 文件 +2539/-114）
> **被审代码**: `companion/src/computer/{locate-chain,uia}.ts`（新）+ `executor/types/win-adapters/evidence` 增量 + `computer-uia-{locate,probe,watch}.ps1`（新）+ server.ts 接线 + `apps/types.ts` 写回规则
> **基准文档**: `coordinate-computer-use-wp2-adversary.md`（本 Agent 的 WP2 裁决，X1–X3）、WP3 评审发现（R1 DPI、N1/N2 —— 不重复报告）
> **方法**: 全文逐行读码 + 本机复验（`tsc -p tsconfig.test.json` exit 0；computer 域 **242/242 pass**，含 WP3 新增 52 例，2026-07-19 21:3x +0800）；未对任何第三方应用发注入；未修改实现代码

## 裁决: `SOUND WITH MANDATORY FIXES`

骨架是真的：四层链降级单向、理由结构化、L2/L3 stub 诚实（`wp5/wp6-not-implemented` 永远以 skipped 入账，无法伪造降级路径）；F1 abort 抽取语义逐字等价、套接字接缝四例测试锁死、未引入新调用面；uiaCapable 写回的手设 override/重校验/单字段规则闭环；ps1 入参走 execFile argv 数组无 shell 注入面；WP2 裁决的 X1–X3 经复核**全部真修复**（§1）。但代码级攻击发现 **2 个 MUST-FIX**：X1（witness 互证在定量上近乎失能——bbox 无尺寸上限 + 单字符即算互证，伪造 UIA 坐标可以拿着 `"uia+ocr"` 满血互证标记落地，且不消耗 uncross 子预算）是本批最致命一条；X2（WindowOpened watcher 的 ready 从未验证、进程死亡无监控、600s 自毁——小弹窗通道可静默熄灭而证据声称其在线）与 WP2 X1 急停失监同构。两者均为局部小修，修后可快速复审。

---

## 1. 核验表（评审发现、抽取真实性、WP2 遗留修复——逐条验证「真的而非表面」）

| # | 结论 | 证据 |
|---|---|---|
| 评审 R1（三个新 ps1 缺 DPI awareness，MUST-FIX，修复中） | **确认属实** | `computer-capture.ps1:24-25`、`computer-input.ps1:55-56`、`computer-windows.ps1:20-21` 均调 `SetProcessDpiAwarenessContext(-4)`；三个新脚本（uia-locate/uia-probe/uia-watch）全域无此调用。UIA BoundingRectangle 在 DPI-unaware 进程下被虚拟化——混合 DPI 下 L0 屏幕坐标系与捕获帧坐标系错位。不重复报告，并入修复跟踪。 |
| 评审 N1/N2（单字符锚 witness 无判别力；substring 0.8 无阈值门） | **确认属实，且是 X1 的子集** | ps1:113-119 substring 命中即 0.8 无阈值；witness 单字符语义见 X1 根因 (a)。X1 的修复（重构 witness 强度模型）应一并吞掉这两条。 |
| F1 abort 抽取（`ad2a987`/`f9afc63`） | **真抽取，零新调用面** | `handleComputerTaskAbort`（server.ts:225-247）与被替换的内联代码逐字等价；生产调用点仍只有 WS dispatch 一处（:3080）；导出仅供测试。集成测试 4 例断言性质：定向翻转不扰他任务、"*" 全量、miss 仍 ack、**CLOSED 套接字上 abort 仍生效**（安全方向无条件）。 |
| WP2 对抗 X1（急停飞行中失监） | **真修复** | server.ts:1982-1991：abortCheck 第三分量——helper 心跳停滞即返回 `"estop-lost"`，fail-closed 中止。与本裁决 X2 同构的修复范式（活性监控进 abort 路径），可直接对照。 |
| WP2 对抗 X2（key 分支无前台复核） | **真修复** | computer-input.ps1:328-333+：SendBatch 前复核 `GetForegroundWindow()==hwnd`，漂移即 FOCUSLOST fail-closed，注释承认 WindowFromPoint 不适用于键。 |
| WP2 对抗 X3（broadcast 不过滤认证态） | **真修复** | server.ts:2448：`wsAuth.get(client)?.authenticated === true` 才发——WP2 的预览 JPEG 虹吸面关闭。 |
| §K.5 写回防篡改 | **闭环** | `applyUiaProbedVerdict`（apps/types.ts:222-240）：手设（有值无 uiaProbedAt）永不覆盖、写前重校验、只触两字段；`writeBackUiaVerdict`（uia.ts:90-104）读-改-写在同一同步段内（无 await），无竞态窗。残余见 §3-Y2（refresh 分支死代码）。 |
| ps1 入参注入面（攻击面 #6） | **检查通过，无洞** | `runPs`/`spawn` 均 argv 数组（powershell.ts:102-113、win-adapters.ts watcher spawn），无 shell；锚文本以单 argv 传 `-Name`，含引号/横杠的恶意锚最坏触发参数绑定错误（BADARGS，fail-closed 方向）；脚本参数全集 `[long]/[string]/[int]`，无可注入 scriptblock/路径。 |
| L2/L3 stub 诚实性（攻击面 #4） | **检查通过** | locate-chain.ts:330-333：两条 skipped 记录恒定产生，无任何输入可令其变为 hit；「强迫永远走 L1」的代价是每动作一次 UIA 往返（~300ms），被预算与速率门兜底，不构成 DoS。 |
| 探针 | — | `tsc -p tsconfig.test.json` exit 0；computer 域 242/242（WP2 基线 190 + WP3 新增 52），win32 门禁下真实执行。 |

---

## 2. 强制修复（X1–X2）

### X1 — witness 互证定量失能：bbox 无尺寸上限 + 单字符即算互证，伪造 UIA 坐标拿 `"uia+ocr"` 满血标记落地

- **攻击链（确定性，非理论）**：白名单应用（或其内部可被第三方影响的内容——CEF/Electron 应用的 webview aria-label、恶意广告、用户生成内容）暴露一个伪造 UIA 节点：Name 恰好等于锚文本（如 `"播放"`），BoundingRectangle 为一个矩形 R——**R 的中心**是攻击者选定的按钮（如「开通 VIP」「送礼」「关注」），**R 足够大**以把窗口里真实的「播放」字样也包进去。随后：① L0 exact 命中，confidence 1.0（若真实节点也命中则 candidates=2 → 0.9，攻击者把伪造节点排在树序第一即可，ps1:102-104 取 `[0]`）；② witness OCR 在 R+8px 容差内找锚字符——真实的「播」「放」**按构造**就在 R 内 → `matched>0` → "agree"；③ 像素区域 diff：攻击者让目标区域静止 300ms（按钮本来不动）；④ 链返回 `crossverified:true, crossverifyChannel:"uia+ocr", uncrossverified:false`（locate-chain.ts:214-223）——**不消耗 ≤3 的 uncross 子预算**，预算内可无限次伪造点击而不触发 re-L2，且证据链盖的是最强的双层互证章；⑤ 注入 ps1 的 Assert-Landing 通过（点在目标窗口内）；区域危险词扫描只挡支付/破坏/凭证词——攻击者选无危险词的按钮即绕过。整个 WP3 用来把 UIA 坐标绑到像素现实的唯一机制，被一个「把 bbox 调大」的动作按构造击穿；而退化成紧 bbox 时也只需 R 内出现**任意一个**锚字符（CJK 单字重叠，locate-chain.ts:103 `[...w.text].some((ch) => anchorChars.has(ch))`）。
- **代码证据**：`ocrWitnessAgrees`（locate-chain.ts:83-106）——`matched > 0` 即互证，无锚覆盖率/连续性要求；bbox 全程无尺寸校验（ps1:76 只查 `>0`，win-adapters.ts `PsUiaLocator.locate` 原样透传）；歧义首选无降级（ps1:102-104，candidates>1 仅 log :167-168，照样 crossverified）。测试侧只锁了两个极端——tight bbox 内全词 agree（computer-locate-chain.test.ts:121）与远距 bbox disagree（:144）；**bbox 撑大、单字重叠、歧义首选三个对抗形状零覆盖**。诚实记录残余兜底：区域危险词扫描（支付/删除/凭证类目标会被 A2/A4 接住）、Assert-Landing（仅挡外窗）、A2.1 事后通道（仅事后）。本洞不是「一切伪造都通过」，是「知道锚文本的伪造者（锚就是它自己设的）几乎必然通过，且拿到最强证据标记」——与 WP1 X1「阈值定量失能」同型。
- **修复要求**：① witness bbox 尺寸帽（绝对像素与窗口面积比双上限，超限即不得判 agree）；② 互证强度升级——锚文本须在 bbox 内**连续重构**（复用 L1 的行级归组逻辑）或锚字符全覆盖，单字命中不再算数；③ `candidates>1` 一律 `uncrossverified:true`（吃子预算），树序首选不再是满血互证；④ evidence 记录 witness 强度（matchedChars/anchorChars、bbox 面积比）；⑤ 补三个对抗形状的性质测试。

### X2 — WindowOpened watcher 生命周期：ready 从未验证、死亡无监控、600s 自毁——小弹窗通道静默熄灭而证据声称在线

- **攻击/故障场景**：三条独立但同向的缝。(a) `startUiaWindowWatcher`（win-adapters.ts）spawn 后立即返回 watcher：`{"ready":true}` 行被 data handler 静默跳过（只推 `window-opened` 事件），订阅失败（ps1 WATCHFAILED exit 5）与「安静无弹窗」在 drain 接口上不可区分；`child.on("error")` 吞掉、**无 exit 监控**——watcher 中途被杀/崩溃后 drain 恒为空。executor 在 factory 返回后无条件记 `computer.uia.watch_started`。(b) `-MaxSeconds` 默认 600（server.ts factory 不传参），而任务寿命无硬上限（预算 30 × type 120s + 每个 re-L2 45s 思考时间，长任务轻松超过 10 分钟）——watcher 在第 600 秒自毁退出，**长任务后半段小弹窗通道静默消失**。(c) `events` 数组无界（窗口创建成本形成天然限速，实际有界，列为次要）。与 WP2 X1 急停失监同构：起飞时通道在、飞行中静默死、证据说它在。方向诚实记录：watcher 是纯加法通道（dialogSuspected 的 OR 项），失效后回退到 WP2 基线（像素/前台/顶层窗口通道不受影响），不产生 WP2 基线以下的新暴露——严重度因此低于 WP2 X1，但「证据虚假在线」本身违反 A7 诚实性。
- **代码证据**：win-adapters.ts `startUiaWindowWatcher`（ready 行忽略、无 exit/close handler、events.push 无帽、`-MaxSeconds 600`）；executor watch_started 无条件日志 + `uiaWatcher?.drain() ?? []`（死 watcher 与空 drain 同构）。
- **修复要求**：① factory 等待 ready 握手（超时即返回「不可用」并记 watch_failed，而非 watch_started）；② child `exit` 事件置死标志并记 `computer.uia.watch_died`（含 exit code），evidence 收尾时写入通道存活状态；③ MaxSeconds 与任务寿命对齐（executor 按预算×单动作上限计算传入，或干脆取消自毁、dispose 为唯一终点——server 侧 kill 本就存在）；④ events 缓冲设上限（溢出即当作「有弹窗」处理，fail-safe 方向）；⑤ 补「watcher 中途死亡 → 证据标记通道离线」性质测试。

---

## 3. 观察项（不阻塞本裁决，须入文档/后续 WP）

- **Y1（SHOULD）screen→image 映射竞态**：链用**捕获时刻**的窗口矩形映射**实时刻**的 UIA 屏幕坐标（locate-chain.ts:173、:235），注入 ps1 再用**注入时刻**的矩形转回屏幕——三个时刻的矩形被假设不变。窗口在 capture→locate 之间移动 d 像素即注入 d 像素错位；像素区域 diff 只在区域内容非均匀时接住（均匀背景 + 持续窗口抖动可带过）。WP1 无此面（OCR 坐标本就在图像空间），WP3 的 L0 新引入。修法干净：computer-uia-locate.ps1 在读树时取**活动客户端矩形**做减法，直接返回 client 空间坐标——从源上消掉整个竞态类。评 SHOULD：概率性、幅度受限于单步间位移、多数情形被像素通道自愈。
- **Y2（SHOULD）准入 verdict 永久化 / refresh 分支死代码**：executor 只在 `uiaCapable === undefined` 时探针（executor.ts task-start 段）；一旦写回，盲应用永盲（L0 永远 skipped）、capable verdict 永不再验。`applyUiaProbedVerdict` 的「auto-probed 可刷新」分支从 executor 不可达。exe drift 检查挡住了应用换 exe 的情形，但内容级变化不触发重探。修法：verdict TTL（如 7 天）或 exe 哈希变化时重探；或删掉死分支并在 §K.5 写明「一次探测终身有效」是显式决策。
- **Y3（SHOULD）watcher pid 过滤逃逸面**：watcher 只收 `ProcessId == TargetPid`（ps1:61，TargetPid = 主 hwnd 所属 pid）；同 app **异 pid**（多进程架构的 broker/helper 进程）弹出的小型 owned/child 弹窗同时落在三个通道之外（watcher pid 过滤、newTopLevel 只认顶层、像素 <5%）。Assert-Landing（覆盖点击点即 OCCLUDED）与前台通道兜底了危害主体，残余是「同应用异进程小弹窗出现而代理无感知」。修法：按会话/可执行文件路径取 pid 并集，或在 plan 写明此残余。
- **Y4（NIT）锚匹配大小写不一致**：ps1:70 exact 用 `$norm -eq $anchor`（大小写敏感），:71 substring 用双小写 Contains——拉丁锚 "OK" vs "ok" 降级为 0.8 substring。fail-safe 方向，统一即可。
- **Y5（NIT）uiaCapable 未纳入 LOLBIN/vault force-clear**：`normalizeAppEntry` 只清 coordinateAllowed（apps/types.ts:264-271）。今日无后果（coordinateAllowed 才是闸门，LOLBIN 恒不可注入），纵深防御角度顺手清掉。
- **重申**：评审 R1（DPI）修复中，跟踪到底；F2 真机验收维持开放，进 WP7 门禁；混合 DPI 真机矩阵应与 R1 修复同批验收。

## 4. 探针复核记录

| 探针 | 结果 |
|---|---|
| `tsc -p tsconfig.test.json` | exit 0 |
| computer 域全量（含 WP3 新增 52 例：locate-chain 16、uia 14、uia-watch 5、writeback 5、abort 集成 4 等） | 242/242 pass，win32 真实执行非 skip |
| WP2 对抗 X1–X3 修复复验 | 三条全部真修复（§1 表） |
| ps1 argv 注入面（含恶意锚形状推演） | 无洞（execFile 数组传参，fail-closed） |

---
*Adversary verdict · CMspark coordinate computer-use WP3 · 2026-07-19*
