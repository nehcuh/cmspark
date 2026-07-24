# 坐标化 Computer-Use WP2 实现代码 — 对抗裁决（代码级）

> **日期**: 2026-07-19 · **对抗 Agent**: Adversary（只读评审 + 本机只读探针）
> **被审范围**: 分支 `computer-use-w8-windows`，commit `d594706..HEAD`（WP2 九个 feat/fix commit + 评审修复 `0eed772`，26 文件 +2811/-124）
> **被审代码**: `companion/src/computer/`（estop/rate-limit/preview/executor/win-adapters/types/danger/evidence/policy）+ `companion/src/host-use/win/scripts/computer-{estop,input,preview,probe}.ps1` + server.ts 接线（R1 单任务门、estop 预检、abort 通道、broadcast）+ bridge/tool-schemas
> **基准文档**: `coordinate-computer-use-wp2-review.md`（评审裁决 CHANGES REQUIRED，单条 MUST-FIX R1）、`coordinate-computer-use-wp1-adversary.md`（本 Agent 的 WP1 代码级裁决，X1–X6）
> **方法**: 全文逐行读码 + 本机复验（`tsc -p tsconfig.test.json` exit 0；computer 域 190 单测 + 3 集成 = **193/193 pass**，2026-07-19 16:5x +0800；全量 1372 中 45 fail 全部为 POSIX 权限位/符号链接/信号类既有平台失败，涉及文件零落在本 diff 内，非 WP2 回归）；未对任何第三方应用发注入；未修改实现代码

## 裁决: `SOUND WITH MANDATORY FIXES`

骨架是真的：评审单条 MUST-FIX R1（全局单任务门）的修复经对抗性复核为**真修复且带对抗性测试**；WP1 裁决的 X1–X6 全部落地为真实代码并被性质测试锁死（§1）；WP2 新增的急停三通道、前后台让位分类、逐动作安全环境重探、L2 反伪造纯函数预览，逐行复核后均成立。但代码级攻击发现 **3 个评审漏掉的 MUST-FIX**：X1（急停 helper 任务中死亡无监控——§E.6「无急停不注入」只在起飞瞬间执行，飞行中热键可静默失效）是本批最致命一条；X2（`key` 动作分支无任何落点/前台校验，WP1 X2 修掉的截收类洞在键盘动作上原样重生）；X3（`broadcastToClients` 不过滤未认证连接，WP2 的逐步预览 JPEG 广播把 5 秒握手窗口变成了可重连虹吸的屏幕外泄面）。三者均为局部小修，修后可快速复审。

---

## 1. 评审修复与 WP1 X 项真实性核验（逐条验证「真的而非表面」）

| # | 结论 | 证据与残余 |
|---|---|---|
| R1（全局单任务门，`0eed772`） | **真修复** | server.ts:1867-1876 handler 级 check-and-set 在 `computerTaskAbort.size` 检查与 `set` 之间**无 await**（同步段，Node 单线程下原子性论证成立）；注册先于 estop 预检/`clearEstopFlag`（:1882-1897），并发第二任务永不能清掉运行中任务的新鲜急停按压；finally（:1986-1991）覆盖成功/typed 拒绝/abort/throw 全出口。集成测试 `computer-task-mutex.test.ts` 用真实 `createToolExecutor` + WS 线束构造**双任务同处 L2 对话框内**的竞态，断言的是性质（registry.size、estopCalls 次数、error_code、A 完全不受 B 影响、异常退出释放槽位后 C 被接纳）而非形状——对抗性合格。 |
| Y1（批准后 fresh 帧重扫危险词） | **真修复** | executor.ts:696-779 批准→重截→重扫→升级即拒（DANGER_HARD_DENY 零注入）、目标移动按新坐标注入、消失则 STALE_SCREENSHOT 诚实失败；测试 :595-684 三性质锁定。 |
| Y2（NFKC 规范化） | **真修复** | danger.ts 扫描前 NFKC；全角/兼容字符折叠进词表匹配。残余：零宽字符注入未剥离（CJK 场景危害低）→ 记录。 |
| Y4（type 逐字符真节流） | **真修复** | computer-input.ps1:387-406 每字符独立 SendInput + 字符间抖动 sleep，WP1 的「攒批后整批 burst」反模式消除；2000 字符（:377）与 120s（:379）双硬帽齐备。 |
| Y5（证据 reparse guard） | **真修复** | evidence.ts 封存后重解析校验；测试 computer-evidence.test.ts 锁性质。 |
| Y7（30/60s 会话速率门） | **真修复（进程内）** | rate-limit.ts 滑窗修剪 + 总会话计数；server.ts:529-534 门在 L2 前、onActionInjected（:1957-1963）只记成功注入；测试 8 例含边界（恰 60s 出窗）。残余：纯内存单例，companion 重启即重置——LLM 自身无重启 companion 的能力，危害有界 → §3 记录。 |
| WP1 X1（对话框四通道） | **真修复** | executor.ts:832-837 整窗/分区（DIALOG_ZONE_THRESHOLD=0.5）/连通块（DIALOG_BLOB_THRESHOLD=0.05）/新顶层窗口四通道；测试 :482-532 含「500×350 同 hwnd 弹层分区通道接住」的原 WP1 盲区用例与「全阈值以下不误报」反向用例。 |
| WP1 X2（落点归属） | **真修复（仅鼠标系）** | computer-input.ps1:258-270 Assert-Landing 双检查（前台==hwnd + WindowFromPoint 根归属），click :293 / scroll :333 / drag :346-347 均接线——**但 `key` 分支漏接 → 本裁决 X2**。 |
| WP1 X3（PIXEL_STALE_MS 接线） | **真修复** | 常量不再死代码，批准刷新路径实际消费。 |
| WP1 X4/X5/X6 | **真修复** | X4 三层 2000 字符帽（schema/executor/ps1）+ 语料总帽；X5 after 帧独立凭证扫描（executor.ts:854-886，OCR 失败则丢帧不落盘，测试 :558-593）；X6 sweepComputerTempCaptures 按 pid 归属清扫（server.ts:1913，best-effort 不阻塞）。 |

评审开放项状态：F1（WS abort 行为测试）**仍开放**——executor 对 abortCheck 的响应已有三时态测试（:1124-1170），但 server.ts:2986-3003 的 `computer.task.abort` 消息→置flag 接线本身无测试；F2（真机验收）按定义开放。均不构成新发现。

---

## 2. 强制修复（X1–X3）

### X1 — 急停 helper 飞行中失监：热键在任务中段可静默失效，注入裸奔最长数分钟

- **攻击/故障场景**：任务起飞时 estop 预检通过（helper 心跳 <3s）。任务执行**期间** helper 进程死亡——崩溃、被同用户进程 `Stop-Process`、被杀毒软件清除、RDP 会话切换——此后用户按下 Ctrl+Alt+End **没有任何东西在听**：flag 文件永不出现，`abortCheck`（server.ts:1943-1944）只查 panel flag ∨ flag 文件存在性，对 helper 死活零感知。注入循环继续跑，最长可达数分钟（单个 type 动作上限 120s，预算上限 30 动作）。§E.6 的硬承诺「无急停不注入」（A9 的 WP2 落地）只在**起飞瞬间**被强制执行；helper 的心跳每 50ms 在写 ready.json，检测死亡所需的数据**已经存在且廉价**——只是没有任何人在飞行中读它。急停是人对失控自动化的最后肌肉记忆通道；它在起飞后静默失效，等于告诉用户「你有刹车」然后在第一个弯道后拆掉刹车线。panel abort 仍在，但它要求用户找到并操作面板——恰恰不是急停的设计场景。
- **代码证据**：server.ts:1882-1891（预检仅任务起始一次）；server.ts:1943-1944（飞行中 abortCheck 无心跳分量）；`companion/src/computer/` 全域 grep 确认 executor 无任何 heartbeat/ready.json 消费；estop.ts:86-89 的 stale 判定只被 `checkEstopReady`（预检路径）调用。
- **修复要求**：飞行中把「心跳停滞」升格为中止条件——abortCheck 增加第三分量（heartbeat 年龄 > ESTOP_HEARTBEAT_MAX_AGE_MS → 返回 `"estop-lost"`，fail-closed 终止任务，错误码建议新 typed code 如 `EMERGENCY_STOP_LOST`），频率与现有 abortCheck 三埋点同（每动作前/wait 中/注入前）；补性质测试「helper 心跳停滞 → 任务以 estop-lost 中止、后续动作零注入」。文档化残余：心跳文件写盘本身可能因磁盘故障失败——方向是 fail-closed，可接受。

### X2 — `key` 动作分支无落点/前台校验：弹窗可在 120ms 窗口内截收 confirm 类组合键

- **攻击场景**：WP1 X2 以 MUST-FIX 规格为鼠标系动作补上了 Assert-Landing（ForceForeground 后、SendInput 前复核前台归属 + 落点窗口归属），并在 ps1 注释里写明「检查组与 SendInput 之间仍有毫秒级 race，由事后 A2.1 兜底」。WP2 新增的 `key` 分支（computer-input.ps1:310-328）把这套校验**整个省略**：初始 ForceForeground（:280-288）之后睡 120ms（:288），然后直接 SendBatch。这 120ms 内任何弹出的对话框（目标应用自弹的模态、他进程的 topmost、系统通知）都会成为组合键的接收者。白名单键集不含可打印字符（win+l/win+d 不可能、ctrl+alt+del 被 OS SAS 挡），但 **`enter`/`space`/`ctrl+enter` 恰是「确认默认按钮」「提交表单」的通用键**，`alt,f4` 亦合法（关闭前台窗口）——一次以白名单 L2 枚举为背书的注入，可被时序投送到白名单边界之外的任意弹窗默认按钮上。type 分支至少有逐 4 字符的前台复查（:393-397）；key 分支**连这个都没有**。与 WP1 X2 同类、同量级、同修法的洞，在新动作原语上原样重生。
- **代码证据**：computer-input.ps1:310-328（key 分支无任何 GetForegroundWindow/Assert-Landing 调用）；对照 :293（click）、:333（scroll）、:346-347（drag 双端点）、:393-397（type 逐批复查）。测试侧全域 grep 确认 ps1 行为零测试覆盖（FOCUSLOST 仅出现于 win-adapters 错误码映射测试）。
- **修复要求**：key 分支在 SendBatch 前复核 `GetForegroundWindow() == hwnd`（WindowFromPoint 半项不适用——键事件投递给焦点窗口而非坐标点），不满足 → FOCUSLOST fail-closed；与 Assert-Landing 共用前台半项即可，约 3 行。在 ps1 头注与 plan §E 节补记「key 的事后兜底同为 A2.1 对话框通道」。

### X3 — `broadcastToClients` 不过滤认证态：未认证 peer 可在 5s 握手窗口内虹吸桌面预览 JPEG，可无限重连

- **攻击场景**：本机恶意进程伪造 `Origin: chrome-extension://...` 头连上 WS（ws-auth.ts 头注明确这是 P0-2B 要挡的同一攻击者）。入方向闸门是严的（server.ts:2908-2912：未认证只准发 `auth.handshake`，其他消息即 terminate；5s 超时 terminate）。但**出方向** `broadcastToClients`（server.ts:2372-2384）遍历 `wss.clients` 只查 `readyState === OPEN`，从不查 `wsAuth.get(client)?.authenticated`——连接建立到被 terminate 的 ≤5000ms 内，所有广播**照常发给未认证 socket**。WP2 之前广播只是 MCP 状态（低敏）；WP2 起 onEvent（server.ts:1947-1953）经 `execOpts.broadcast`（:1031 = broadcastToClients）把 `computer.task.event` 逐步广播，其中 step 事件携带**逐动作打码预览 JPEG**（executor 测试 :1272 锁此契约）。打码是 best-effort OCR 的凭证遮蔽——聊天文本、文档内容等一切非「凭证词」的隐私内容全量可读。攻击者不必完成握手：连上、白听 5 秒、被踢、立即重连、再听 5 秒——无重连节流，一次 computer 任务期间的屏幕录像带持续外流。P0-2B 费了一整个模块把入方向关死，WP2 在出方向开了条旁路。
- **代码证据**：server.ts:2372-2384（无 wsAuth 过滤）；server.ts:2868（wsAuth.set 初始 authenticated:false）与 :2937-2939（认证成功才置真）证明过滤所需状态就位、一行可达；测试全域 grep 确认「未认证客户端收不到广播」零覆盖（ws-auth 集成测试复制的是入方向闸门，非真实 startServer 广播路径）。
- **修复要求**：`broadcastToClients` 跳过 `!wsAuth.get(client)?.authenticated` 的连接（一行）；补集成测试「未认证连接在窗口期内收不到任何广播（含 computer.task.event）」。顺带核查 :2150/:2169 两处既有广播同被覆盖。

---

## 3. 观察项（不阻塞本裁决，须入文档/后续 WP）

- **Y-a（estop 孤儿生命周期）**：spawnEstopHelper detached+unref（estop.ts:117），companion 退出/卸载后 helper 永存，50ms 轮询空转。ready.json 幂等保证不会堆积多个实例，但生命周期无人收尾。建议：companion 退出钩子按 ready.json.pid 尝试结束 helper，或文档化为已知驻留。
- **Y-b（flag/ready 路径可预测）**：`%TEMP%/cmspark-computer/` 下同用户任意进程可 touch estop.flag（→ 任务中止，fail-safe 方向）或删 ready.json（→ 任务拒飞，fail-closed 方向）。双向都是安全方向，仅可用性影响；文档化即可。
- **Y-c（RDP/安全桌面盲区）**：Ctrl+Alt+End 在 RDP 场景是客户端 OS 的安全注意序列等价物，可能到不了远端会话内的 GetAsyncKeyState；与 §T5-8 的 DESKTOP_DENIED 是不同层。文档化 + 并入 F2 真机验收清单。
- **Y-d（速率门重启重置）**：见 §1 Y7 行。LLM 无自举重启 companion 路径，残余有界；文档化。
- **重申**：F1（`computer.task.abort` WS 接线无行为测试）、F2（真机验收）维持评审开放状态，进 WP3 门禁。
- **N 级**：OCRFAILED 在 PS_ERROR_CODES 仍缺映射（WP1 旧 nit 未清）；estop 心跳每 50ms 写盘（评审 N1 已记，SSHD 磨损级）。

## 4. 探针复核记录

| 探针 | 结果 |
|---|---|
| `tsc -p tsconfig.test.json` | exit 0 |
| computer 域单测（9 套件） | 190/190 pass |
| computer 集成（mutex） | 3/3 pass（win32 门禁下真实执行，非 skip） |
| 全量套件 | 1372 tests / 45 fail —— 失败全部集中于 0o600 权限位、symlink、SIGTERM、POSIX 路径等 Windows 平台既有问题；`git diff --name-only d594706..HEAD` 与失败测试文件零交集，判定非 WP2 回归 |

---
*Adversary verdict · CMspark coordinate computer-use WP2 · 2026-07-19*
