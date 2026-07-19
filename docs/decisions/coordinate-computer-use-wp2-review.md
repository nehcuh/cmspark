# 坐标化 Computer-Use WP2 执行层完备与白名单绑定 — 评审结论

> **日期**: 2026-07-19（本机时间锚点 2026-07-19T15:48:30+0800） · **评审 Agent**: Reviewer（只读评审 + 本机复验）
> **被审范围**: 分支 `computer-use-w8-windows`，commit `d594706..HEAD`（9 个 commit，`9609965` 原语 → `d30f382` Y 加固包，+2466/-125 行，25 个文件，工作区干净）
> **基准文档**: `coordinate-computer-use-plan.md` §H WP2 节（plan:254-256）+ 顶部 Amendments A9（plan:24）、WP1 终审 §T5 输入清单、WP1 对抗 Y 类（Y1/Y2/Y4/Y5/Y7 声称已在 WP2 落地，本次逐条验证真伪）
> **复验方式**: 全文逐行读码 + 本机实际执行构建/测试（非转述），证据见 §6

## 裁决: `CHANGES REQUIRED`（单条 MUST-FIX，修后快速复审）

WP2 的成色整体很高：**Y1/Y2/Y4/Y5/Y7 五项加固声称逐条验证均为真修复而非表面修复**（§4）；A9 起飞前检查、急停三通道、速率限制、前台让位分类、IL/桌面逐动作重探、hwnd 绑定加固、L2 预览防伪造全部落地且有测试锁定；本机复跑 tsc exit 0、355/355 全绿（与基线一致）。

**但有 1 个 MUST-FIX**：R1——plan §E.6.2 明文安全不变量「全局同时执行中任务 = 1」完全未落地，全仓无任何互斥实现；跨线程并发双任务客观可达（无需竞态），且直接放大出「速率窗口被绕过」与「急停 flag 被并发任务误清」两个外围机制失效面。修复量小（server 层一个执行中标志 + 一条测试），修复后即可转 APPROVED。真实机验收三项按 WP1 缺口 6 的惯例保持开放（§2-F2），不构成本次代码裁决的阻塞项。

---

## 1. MUST-FIX（R1）

### R1 — §E.6.2「全局同时执行中任务 = 1」未落地：跨线程并发 computer task 无互斥

- **问题**：plan §E.6.2（`coordinate-computer-use-plan.md:221`）明文三个速率/并发不变量：全局动作 ≤30/min、单动作间隔 ≥300ms、**全局同时执行中任务 = 1**。前两项已落地（30/60s 滑窗 `rate-limit.ts:13-14`；注入后 capture+OCR+diff+seal 天然节流远超 300ms），**第三项无任何实现**——对 `companion/src/computer/` 与 `server.ts` 全仓检索 mutex/lock/inFlight/running 无命中。具体事实链：
  1. `server.ts:1870-1921` 每次 `executeCompanionTool` 独立 `await runComputerTask(...)`，入口无任何「已有任务在执行中」检查；
  2. `adapter.ts:534` 确认同一 LLM turn 内 tool call 为 `for...of` 顺序 await（同 turn 不并发），但**每个 threadId 有独立 LLM 循环**——两个线程各自发起 `host_computer`、各自通过 L2 人工批准后，两个 `runComputerTask` 持续并发执行，客观可达、无需任何竞态巧合；
  3. `rate-limit.ts:49-51` `saturated()` 只在 L2 门前做**新任务准入**（`server.ts:497-504`），对已批准在跑的任务无逐动作约束。
- **为什么算 MUST-FIX**：三层后果——
  1. **速率窗口语义被绕过**：单任务因每动作 capture+OCR 秒级延迟，物理上达不到 30/min，Y7 的实际攻击面本就在并发；A、B 两任务各自启动时窗口 <30 即过门，之后合计注入可稳定超 30/60s——§E.6.2 的「≤30/min」在唯一可达的攻击路径上失效。
  2. **急停 flag 被并发任务误清**：`server.ts:1843` 每个新任务启动时 `clearEstopFlag()`，其语义是清「陈旧 flag」，但实现无法区分「陈旧」与「为另一在跑任务刚按下」。A 运行中用户按 Ctrl+Alt+End，若 B 在 A 的下一次 abortCheck 轮询（≤50ms，executor.ts:423/437）之前完成启动流程，flag 被 B 清掉，**A 永远看不到这次急停**。急停是 A9/§E.6 的核心补偿机制，其信号完整性不允许依赖时序运气。
  3. **双任务交替 `ForceForeground` 抢前台**（computer-input.ps1:288-296），互相造成 FOCUSLOST/OCCLUDED（fail-closed 方向，尚可接受）或注入序列交织，任务行为不可预期。注入落到非白名单窗口的底线仍由 ps1 `Assert-Landing` 守住（computer-input.ps1:258-276），所以本项定级为「plan 明文安全不变量缺失 + 外围机制被绕过」，而非失控注入——但不变量就是不变量，且修复成本极低。
- **修复要求**：server 层加全局单任务门——`host_computer` 进入 L2 门**之前**检查「执行中 computer task」标志（可与 `computerTaskAbort` 同生命周期：有存活 entry 即拒绝），命中则返回 typed 错误（如 `COMPUTER_TASK_BUSY`，信息如实说明「已有一个坐标任务在执行中」）；标志在 `runComputerTask` 的 `finally` 中释放（`server.ts:1919-1921` 同一点位）。补「首任务执行中第二任务被拒、首任务结束后第二任务放行」的性质测试。互斥落地后，第 2 层 clearEstopFlag 干扰面天然消除（单任务下残余窗口见 N3）。

---

## 2. REQUIRED FOLLOW-UPS（不阻塞裁决，WP3 开工前完成）

- **F1 — WS abort/event 通道无行为测试**：`computer.task.abort` 的消息校验（`server.ts:2433-2434`）、`"*"` 广播与 ack matched 计数（`server.ts:2937-2951`）、`onEvent` 面板广播（`server.ts:1900-1906`）仅有 tsc 类型保障，无单测/集成测试。逻辑薄（Map set/get + 计数 + send），且 executor 侧 abort 三通道行为已有测试（computer-executor.test.ts 的 abort 三用例），故不定 MUST-FIX。建议补一个 WS 消息级测试：fake ws 注入 `computer.task.abort`（task_id / "*" / 未知 id 三态），断言 Map 状态与 ack 计数。
- **F2 — 真实机验收三项保持开放**：§H WP2 验收要求「§G.5 真实机清单前 3 项过；急停 <500ms 生效；非白名单窗口注入拒绝测试过」（plan:256）。本评审为只读代码评审 + 本机构建/测试复验，**无法代执行需 Owner 在场的真实 GUI 验收**（点 L2 对话框、真实网易云、掐表急停）。按 WP1 缺口 6 的惯例处理：这三项是 WP2 验收的正式遗留门禁，未执行留痕前不得对外宣告 WP2 完全通过；单测全绿不构成替代。其中 §G.5 第 2 项「Chrome 内 UIA 层命中验证」依赖 WP3 的 UIA 层，且 Chrome 属 vault 映射被坐标路径结构性排除（`policy.ts:22-28`），建议正式重归属 WP3 验收，WP2 真实机清单以「①网易云《青花瓷》OCR 锚点路径 + ③遮挡/最小化/多屏/DPI 150% 矩阵」为实项。

---

## 3. NIT（单列，均不阻塞）

- **N1 — estop 心跳写盘过频**：`computer-estop.ps1:64-73` 主循环每 50ms 调 `Write-Heartbeat`（:47-53，tmp+Move 原子写 = 每次 2 个文件操作），常驻 ≈40 IOPS。预检门禁只要求心跳 <3000ms（`estop.ts:52`），1s 一次即可满足且仍远快于门禁一个数量级。建议循环内计数、每 20 拍写一次。
- **N2 — `hotkeyOk` 在轮询模式硬编码 true**：`computer-estop.ps1:50` 的 ready.json 恒写 `hotkeyOk = $true`（GetAsyncKeyState 轮询无注册调用，天然无失败可报），`estop.ts` 预检中该项检查（estop.ts:checkEstopReady）形同虚设——真正的活性门禁是心跳新鲜度。建议在 ps1/estop.ts 注释中如实说明该字段在轮询模式下的语义（「保留给 RegisterHotKey 模式」），避免未来评审者误判预检强度。
- **N3 — `clearEstopFlag` 时机折衷未注释**：`server.ts:1843` 在 estop 预检后、`runComputerTask` 前清 flag，会清掉「L2 批准瞬间用户恰好按下的急停」。单任务下窗口为毫秒级且用户可再按，可接受；但该折衷无任何注释，且与 R1 第 2 层后果同源。建议在 :1842-1843 注释折衷理由；R1 修复后该面进一步收窄。
- **N4 — sha256 drift 每任务一次的折衷已知但可再显化**：`policy.ts:127-133` 注释已如实说明「每任务一次（性能），每动作由路径+结构复查兜底」。任务运行中同路径替换 exe 不会被 drift 检测抓到（替换为 vault/LOLBIN 仍被每动作 `assertHwndOwnedByEntry` 的 resolved-exe 结构复查拒，`policy.ts:114-123`；替换为非 vault 恶意二进制则不在 drift 视野内）。威胁模型内可接受，记录备查。

---

## 4. 做对的地方（含 Y 类真修复逐条验证）

**WP1 对抗 Y 类声称 — 逐条验证为真修复：**

- **Y1（注入前帧始终 OCR 做 danger 判定）✅ 真修复**：`executor.ts:631-649` 每个注入动作对**当前帧**独立跑 `scanOcr`——locate OCR 只管坐标、新鲜 OCR 只管危险判定，两帧职责分离，注释（:631-637）如实说明动机「200×200 区域外的凭据字段/支付按钮在 locate 与 inject 之间出现，只有整帧重读才可见」。测试侧 `ocrCalls === 1 → <= 2` 为**语义等价适配而非放松**：逐条核对 5 处改动（X5 after 帧冒密码、X3 批准后目标移动/消失/升级 region-hard、X5 after OCR 失败丢帧），每处注释同步更新、对抗语义完整保留——「前段干净帧 / 后段对抗帧」的分界只是从第 1/2 次调用平移到第 2/3 次。
- **Y2（危险词 NFKC + 零宽剥离）✅ 真修复**：`danger.ts:67-75` normalize 加 `.normalize("NFKC")` + 剥 U+200B..U+200D/FEFF；三测试锁定（全角 Ｐａｙ→pay 命中 hard、零宽 支\u200B付→支付 命中、全角 password 仍打码，`computer-danger.test.ts:128-145`）。
- **Y4（type 逐字符真实 SendInput 节流）✅ 真修复**：`computer-input.ps1:383-408` 重写 type 循环——**每字符独立 SendInput（2 事件）+ 字符间抖动 sleep**，WP1「累积 16 字符后整批 32 事件瞬时爆发」的模式彻底移除（diff 确认旧批处理代码全删）；`Test-StopFlag` 逐字轮询（:388）；前台漂移检查降为每 16 字符一次（:392-396，成本与安全的合理折衷）。另含 ForceForeground 3×150ms 重试（:288-296），24H2 前台锁瞬时拒绝被诚实吸收，持续失败仍 FOCUSLOST 拒注。
- **Y5（证据目录 reparse-point 拒绝）✅ 真修复**：`evidence.ts:67-90` `assertNotReparsePath` 对 baseDir 与 taskDir 双点 lstat 检查（ENOENT 放行 = 目录尚未创建），init 前调用（:102-104）；测试含**真实 fs junction** 用例（symlinked base 拒、预植 symlinked task dir 拒、同 id 真实目录放行，`computer-evidence.test.ts:280-320`）。
- **Y7（会话级注入速率限制）✅ 真修复**：`rate-limit.ts` 30/60s 滑窗（窗口数学、边界「恰好 60s 出窗」、总量不裁剪均有测试）；server 接线三点全对——L2 门**前** `saturated()` 拒新任务（`server.ts:497-504`，注释正确指出「防失控 agent 烧人类点击」）、L2 预览 `extraLines` 带双计数状态行（:511）、**仅成功注入**经 `onActionInjected` 入账（:1910-1916 + executor.ts:810-815，「失败动作不消耗窗口」有专测）。

**A9 / §E.6 急停全链：**

- 起飞前检查（A9 核心）✅：`ensureEstopHelper`（`estop.ts:142-160`）预检 ready.json 解析 + hotkeyOk + 心跳 <3000ms，不活则 spawn 并重试 8×350ms，失败 → `EMERGENCY_STOP_UNAVAILABLE` 拒启（`server.ts:1832-1841`）——「无 kill switch 的注入循环绝不运行」落实。预检 8 状态单测齐（missing/corrupt/hotkeyOk=false/stale/fresh/custom maxAge/spawn 路径/有限重试，`computer-estop.test.ts`）。
- 热键 helper ✅：GetAsyncKeyState 50ms 全局轮询 Ctrl+Alt+End 三键全按、边沿触发再武装（`computer-estop.ps1:62-71`）——无焦点依赖（目标应用前台时物理生效），轮询不可被抢占，符合 A9「常驻 PS 辅助」方案选项。
- abort 三埋点 ✅：executor.ts:423（每动作前）/ :437（wait 内 50ms chunk）/ :791（SendInput 前最后一道）；ps1 侧 `-StopFile` 逐字检查（computer-input.ps1:185-191 + :388）；STOPPED→TASK_ABORTED 前缀映射（win-adapters.ts:39）。executor 三通道测试齐（首动作前/wait 中/动作间）。
- 面板 abort 权限设计正确 ✅：任何已认证面板可中止任何任务（`server.ts:2937-2951`）——停止注入永远是安全方向，无需属主校验；ack 带 matched 计数。

**§E.2 白名单绑定加固：**

- resolved-exe vault/LOLBIN 复查 ✅：`policy.ts:114-123` 在 hwnd 归属路径比对通过后再对**解析出的实际 exe** 跑结构复查——「同路径替换为浏览器/LOLBIN」的欺骗面在 execution time 被封，与 win/adapter.ts 的 vacuous recheck 哲学一致；测试含 tampered entry 双向用例。
- sha256 drift fail-closed ✅：`policy.ts:134-154` hash 失败也拒（fail-closed 方向正确）；executor.ts:336 每任务一次；测试覆盖 match/drift/unreadable/no-record 四态。
- IL + 输入桌面逐动作重探 ✅：`executor.ts:502` 每注入动作前 `securityEnv.assertInjectable`；`PsSecurityEnvironment`（win-adapters.ts:502-536）IL 不可得 fail-closed、targetIl > ownIl 拒（跨 UIPI 永不尝试）、desktop ≠ "Default" 拒；`computer-probe.ps1` 只读契约（无 SendInput/SetForegroundWindow，永不触发 UAC 或焦点变化）；「probe 每注入动作一次、wait/screenshot 跳过、mid-task 拒绝即停」均有专测。

**§E.2.4 前台让位分类：**

- `executor.ts:931-970` 对话框通道与让位通道分离：fg 异进程（或探测失败 = fail-closed 按异进程）→ `computer.foreground_yielded`，re-L2 文案点名异己进程名并如实说明「继续注入可能落在非白名单窗口上」；同进程新窗/大面积变化 → `task_induced_dialog` 通道。三态测试齐（异进程/探测失败/同进程）。

**§E.4 面板预览：**

- L2 预览纯函数防版式伪造 ✅：`preview.ts:67` task 文本 JSON.stringify 转义（换行无法伪造预算/语料行）、每个注入动作逐条枚举（锚文本 :78 / 坐标 / key 组合 :83 / scroll delta / drag 端点）、type 语料逐字（:99）、extraLines 原样追加（:104）；87 行测试含敌对锚文本（引号+换行）用例。
- 逐动作预览图 ✅：打码**先于**缩放（坐标 image-space，computer-preview.ps1:39-62，顺序正确）、>280KB 降质 50 重试再 too_large 丢弃（:75-86）、builder 失败降级无图（executor.ts:873-882 try/catch + 测试）、crosshair 圈注实际作用点。
- LLM 可控文案面复核 ✅：task（已转义）、动作参数（已枚举）、appDisplayName（来自 config 非 LLM）、extraLines（服务端生成）——无可注入版式的面。

**原语层：**

- key 白名单三层冗余 ✅：zod enum（tool-schemas.ts:119-132）→ validateDraft（executor.ts:183-194）→ ps1 `$VkMap`（computer-input.ps1:242-250），任意 VK/可打印字符/超 4 键三层皆拒；key 在 credential context 与 type 同标准 hard deny（executor.ts:651-660——enter/tab 提交表单的绕过面被封，有专测）。
- scroll/drag ✅：delta 非零 ±1200 三层校验；drag 双端点 bounds（executor.ts:622-627）+ 双端点 Assert-Landing（computer-input.ps1:344-371）+ 16 步插值移动 8ms 间隔（OSR 丢事件教训的同源应用）。
- 工具描述诚实性 ✅：tool-definitions.ts:549 如实声明 Windows-only、critical-class 每任务必弹、无路径禁区、key 白名单语义、SMTC 分工，未夸大。

---

## 5. WP2 验收（§H）逐条核对

> 依据 `coordinate-computer-use-plan.md:256`：「§G.5 真实机清单前 3 项过；急停 <500ms 生效；非白名单窗口注入拒绝测试过」。

| 验收项 | 结论 | 证据与说明 |
|---|---|---|
| §G.5 真实机清单前 3 项 | **开放（未执行）** | ①网易云「搜索《青花瓷》并播放」OCR 锚点路径、③遮挡/最小化/多屏/DPI 150% 矩阵：需 Owner 在场真实机执行，本评审不代跑，留痕前验收不闭合（→ F2）。②Chrome 内 UIA 层命中验证：依赖 WP3 UIA 层且 Chrome 被结构排除，建议重归属 WP3。 |
| 急停 <500ms 生效 | **机制成立 / 实测开放** | 延迟上界：estop 轮询 ≤50ms 置 flag → executor wait chunk ≤50ms 轮询（:434-437）/ type 逐字 `Test-StopFlag`（30-80ms 节流间隔内插）/ 动作前与 SendInput 前两道门（:423/:791）→ 理论 <150ms，满足 <500ms。行为有单测锁定（abort 三用例 + estop 八状态）；真实机掐表实测未执行（→ F2）。 |
| 非白名单窗口注入拒绝测试 | **单测面全绿 / 真实机开放** | HWND_NOT_OWNED（executor 每动作 `assertHwndOwnedByEntry`，executor.ts:495-496）、APP_COORDINATE_STRUCTURAL（policy.ts:114-123 双用例）、OCCLUDED/FOCUSLOST（ps1 Assert-Landing，computer-input.ps1:258-276；前缀映射测试）、IL/桌面拒绝（PsSecurityEnvironment 三态专测）全部有测试。真实机「非白名单窗口前置时注入被拒」端到端实测未执行（→ F2）。 |

---

## 6. 本机复跑记录（非转述）

- 时间锚点：`date '+%Y-%m-%dT%H:%M:%S%z'` → **2026-07-19T15:48:30+0800**。
- 编译：`cd companion && node node_modules/typescript/bin/tsc -p tsconfig.test.json` → **exit 0**。
- 测试：`node --test`（8 个 computer-*.test.js + 8 个 apps-*.test.js 全量）→ **tests 355 / pass 355 / fail 0**，duration ≈ 741ms。与基线声称的 355 全绿一致。
- 范围核对：`git diff --stat d594706..HEAD` = 25 文件 +2466/-125；`git log` 9 commit；`git status` 工作区干净。

---

## 结论

R1 修复（全局单任务门 + 一条性质测试，预估 ≤40 行）完成后，本评审可转为 **APPROVED**；F1/F2 不阻塞该转换，但 F2 的三项真实机验收留痕是**对外宣告 WP2 通过**的正式门禁，与 WP1 缺口 6 同标准。建议 R1 修复与 F1 测试同 commit 落地，随后进入 WP3（UIA 层）——WP2 的 `SecurityEnvironment`/`PreviewBuilder` 接口已为上层的 mock 与扩展留好形状。

---

# 终审（2026-07-19 17:57 +0800）

> **范围**: `d594706..386dae8`（WP2 九 commit + R1 修复 `0eed772` + 对抗 X1–X3 修复 `8365999`/`fbc7a2c`/`386dae8`）
> **新增基准**: `coordinate-computer-use-wp2-adversary.md`（对抗裁决 SOUND WITH MANDATORY FIXES，X1–X3）
> **方法**: 修复 commit 逐条抽查真实性 + 本机亲自复跑（非转述）

## T1. R1 / X1–X3 修复真实性抽查（逐条结论：真修复）

| # | 结论 | 抽查证据 |
|---|---|---|
| R1 全局单任务门（`0eed772`） | **真修复** | check-and-set 为同步段：`server.ts:1867-1876` `if (computerTaskAbort.size > 0) return` 与 `set` 之间无 await（Node 单线程原子性成立）；注册先于 estop 预检与 `clearEstopFlag`（:1876 → :1882-1897）——并发败者永不能清掉运行中任务的新鲜急停，R1 第 2 层「急停被吞」面封闭；`finally`（:1986-1991）在外层 try 上覆盖成功/typed 拒绝/abort/throw 全出口，delete 幂等；L2 前早拒门（:516-521）省无效对话框；N3 折衷注释落字（:1893-1896）。集成测试 `computer-task-mutex.test.ts` 用真实 `createToolExecutor`+WS 线束构造「双任务同处 L2 对话框内」竞态，断言 registry.size / error_code=COMPUTER_TASK_BUSY / estop 零调用 / A 不受 B 影响 / 异常释放后 C 被接纳——性质断言合格，本机复跑真实执行非 skip。 |
| X1 飞行中急停看门狗（`8365999`） | **真修复** | 三检查点链路完整：`estopHeartbeatLost()`（`estop.ts:175-177`）复用预检同一 readiness（missing/corrupt/hotkey-lost/stale 全算 lost，fail-closed）；server abortCheck 三分量 panel → hotkey → estop-lost（`server.ts:1946-1953`）；executor 三埋点（:435 动作前 / :449 wait 内 / :803 SendInput 前）全部改经 `abortChannelError()`（:240-248）统一映射——estop-lost → 新 typed code `EMERGENCY_STOP_LOST`（types.ts:182），与用户主动中止 TASK_ABORTED 在审计+证据链可区分；pre-inject 为 throw 经既有 ComputerError catch 走 fail() 零残留路径。helper 正常退出删 ready.json → missing → lost，方向正确。测试 +5：watchdog 单元矩阵（含恰好 3000ms 边界）+ executor 三时态性质。 |
| X2 key 前台复核（`fbc7a2c`） | **真修复** | key 分支 SendBatch 前 `GetForegroundWindow() -ne $hwndPtr` → FOCUSLOST fail-closed（computer-input.ps1:328-335），头注第 8 条与 Assert-Landing 残余注释同步、plan §E.3 补记。新增 `computer-input-ps1.test.ts`：①4 个 computer-*.ps1 的 efbbbf BOM 静态守卫（PS 5.1 无 BOM 会把 UTF-8 误读为 ANSI，WP1 留痕曾实抓 5 个缺 BOM）；②key 分支文本顺序断言（复核必须先于 SendBatch）。ps1 无行为测试的现实下，文本级守卫锁安全关键行是可接受的诚实形态。 |
| X3 广播认证过滤（`386dae8`） | **真修复** | `broadcastToClients` 加 `wsAuth.get(client)?.authenticated === true`（server.ts:2399）。**单一扇出论证亲自复核**：全仓 `wss.clients` 遍历仅 :2394 一处；高敏负载 `computer.task.event`（含逐动作 JPEG）的唯一扇出为 onEvent → `execOpts.broadcast` → :1031 `broadcast: broadcastToClients`，无旁路；集成测试 `computer-broadcast-auth.test.ts` 含重连虹吸模式（窗口期 5 次广播未认证端保持零收）。 |

## T2. 终审新发现（REQUIRED FOLLOW-UP，不阻塞）

- **Y-e — handleMessage 链路存在第二个未过滤广播实现**：`server.ts:3135-3144` 传给 `handleMessage` 的 `broadcast` 遍历 `clients` Set（:113，连接即 add、**不区分认证态**）直接 send，无 `wsAuth` 过滤。经 `message-router.ts:951/959` 转发，消费者为 `computer/handlers.ts:55,79`（`computer.state`，仅布尔开关，低敏）与 `apps/handlers.ts:132-134`（`apps.updated`：本机白名单条目全集——display_name/exe 路径/coordinateAllowed 位，中敏软件画像+攻击面信息）。该面在 X3 攻击模型下同构（未认证 peer 5s 窗口+无限重连可收），但仅状态变更瞬间触发、非持续流，且 computer.task.event 高敏流已确认不走此路（T1-X3）。该实现先于 WP2 存在，X3 将其照亮。定级 REQUIRED FOLLOW-UP：一行修复（:3135 改用 `broadcastToClients`），WP3 开工时与 F1 同批落地。
- **C10 编号考据**：任务所述「C10 残项」在基准文档中无定义（docs 全仓检索无命中）。按上下文理解为 §T5-10（Y10 DPAPI 落字）或 §T5-11 的 X3「同级不再问词集变化」语义残余（WP2 维持「批准后同级异词不再 re-L2、仅升级可行动」，executor.ts:756-778——明示保守残余）——两者均已列入 §T4 清单；若另有所指请 owner 澄清。

## T3. 本机复跑记录（非转述）

- 时间锚点：`date '+%Y-%m-%dT%H:%M:%S%z'` → **2026-07-19T17:57:39+0800**。
- 编译：`node node_modules/typescript/bin/tsc -p tsconfig.test.json` → **exit 0**。
- 门禁套件：`node --test`（9 个 computer-*.test.js + 8 个 apps-*.test.js + 2 个集成 test.js 全量）→ **tests 369 / pass 369 / fail 0**，duration ≈ 1.3s。与基线声称 369 全绿一致（355 + R1×3 + X1×5 + X2×3 + X3×3 = 369，算术吻合）。

## T4. §H WP2 验收核对与真机门禁评估

| §H 验收项 | 覆盖状态 | owner 在场必要性 |
|---|---|---|
| ① 网易云「搜索《青花瓷》并播放」OCR 锚点路径 | 单测只锁假适配器行为；真实第三方应用+真实 L2 批准+真实屏幕不可自动化 | **必须 owner 在场**（真机清单 A 项） |
| ② Chrome 内 UIA 层命中验证 | UIA 层是 WP3 范围；Chrome 坐标注入被 vault 结构排除（policy.ts:22-28） | **重归属 WP3 验收**（本文 F2 建议正式落字） |
| ③ 遮挡/最小化/多屏/DPI 150% 矩阵 | 遮挡项**已被 WP1 E2E 第 6 项真机实测覆盖**（真实置顶对话框 → OCCLUDED 拒绝，`wp1-e2e-record.md`）；最小化/多屏/DPI 150% 未实测 | **遮挡可关闭**；最小化/多屏/DPI 需真机（清单 B 项，本机即 DPI 150% 环境，多屏需硬件） |
| 急停 <500ms 生效 | 机制上界 ≈100-150ms（50ms 轮询置 flag + executor ≤50ms chunk/逐字/三埋点）；X1 watchdog 使 helper 死亡最迟 3s 内转为 EMERGENCY_STOP_LOST；行为全有单测 | **物理按键掐表必须 owner 在场**（清单 C 项：热键中止 + type 长文本中途中止 + 杀 helper 进程验证 estop-lost 三子项） |
| 非白名单窗口注入拒绝 | 单测面全（HWND_NOT_OWNED/APP_COORDINATE_STRUCTURAL/OCCLUDED/FOCUSLOST/IL/桌面映射）；OCCLUDED 真机已实证（WP1 E2E-6） | **前台让位（foreground_yielded）真机实测需 owner**（清单 D 项：任务中切非白名单窗口到前台 → 观察让位暂停 re-L2） |

**真机最小清单（F2 落实版，owner 在场一次可全部完成）**：A 网易云全链路；B 最小化/多屏/DPI 矩阵；C 急停三子项（含 X1 杀 helper）；D 前台让位实测；E（可选，有 RDP 环境时）RDP 会话热键行为（Y-c）。

## T5. 终审裁决

## 裁决: `APPROVED WITH REQUIRED FOLLOW-UPS`

R1 与 X1–X3 四个修复 commit 逐条抽查均为**真修复且带对抗性测试**（T1）；本机复跑 tsc exit 0、369/369 全绿与基线一致（T3）；终审新发现 Y-e 为中低敏、非持续流、一行可修的残留面，不定 MUST-FIX（T2）。WP2 承诺范围内（全动作原语/前台焦点管理/hwnd↔AppEntry 绑定含 vault-LOLBIN 复查/前台让位/急停三通道+X1 看门狗/速率限制+§E.6.2 单任务不变量/逐动作预览推送）**全部落地且有测试锁定**。

**WP2 可否宣告通过**：**代码层面通过，WP3 可以开工**；按 WP1 缺口 6 的同标准，「WP2 完全通过」的对外宣告以 T4 真机清单（A/B/C/D 四项）留痕为正式门禁——留痕完成前维持「有条件通过」表述，不得以 369 全绿替代。

## T6. WP3 输入清单

1. **F1（仍开放）**：`computer.task.abort` WS 消息→置 flag 接线（server.ts:2986-3003）无行为测试；X3 只覆盖了广播过滤。与 Y-e 同批修复。
2. **Y-e（终审新增）**：:3135 handleMessage 链路 broadcast 换用 `broadcastToClients`（一行），消除 apps.updated/computer.state 对未认证 peer 的残留暴露。
3. **F2 真机四项**：T4 清单 A/B/C/D（网易云、矩阵、急停三子项、前台让位），owner 在场执行留痕；② Chrome UIA 项正式重归属 WP3 验收。
4. **Y6 残项**：OCRFAILED 前缀入 PS_ERROR_CODES（win-adapters.ts，仍未修）；runPs maxBuffer 1MB 评估；ensureLanguage 死接口；预算续期回读 config.computer?.budget。
5. **Y8 残项**：computer-evidence-seal.ps1:15 / computer-imgdiff.ps1:20 注释坐标系修正（图像空间，非 client px，仍未修）。
6. **Y10 残项**：DPAPI CurrentUser「同用户进程可 Unprotect」威胁模型落字 evidence.ts 头注与 plan §E.5（仍未修）。
7. **Y-a~Y-d 观察项**（对抗 §3）：estop 孤儿生命周期收尾（companion 退出按 ready.json.pid 结束 helper 或文档化驻留）；flag/ready 路径可预测（双向均安全方向，文档化）；RDP/安全桌面热键盲区（入 F2-E）；速率门重启重置（LLM 无重启路径，残余有界，文档化）。
8. **N 级**：estop 心跳 50ms 写盘降频（评审 N1 重申）；hotkeyOk 轮询模式语义注释（评审 N2 重申）。
9. **<5% 小弹层盲区**：归 WP3 UIA WindowOpened 通道 + WP7 红队语料（§T5-11 明示债务，正式交接）。
10. **X3 词集变化语义**：「批准后同级异词不再 re-L2」维持保守残余（executor.ts:693-695/756-778 注释已明示），WP3/WP7 评估是否按词集变化重问。

---
*Final review · CMspark coordinate computer-use WP2 · 2026-07-19*
