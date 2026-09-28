## 结论摘要

批次整体质量不差：F1/F2/stop-abort 三条并发修复我逐条读过实现并跑过测试（35/35 通过），版本锚齐 0.6.9，`488252bf` 的 napi 正则修正经核实是**修对了**（不是 fail-open）。但我找到 **2 条 blocking**：

1. **本批次新引入的 `releaseIdleWorkerLeases`（`buildFleetSnapshot` 内）绕过了同一批次刚建立的 pending/mutation-hold 保护**，把「调用仍在飞」的租约和 60 秒 `create_tab` 持有一起抹掉，并且顺手删掉 tombstone。触发者是**侧栏 4 秒轮询 / 任何确认到达**（我已用 HEAD 编译产物复现）。这违反 ADR-015 P0 不变量，也违反本批次 CHANGELOG 自己的措辞。
2. **`npm test` 在本机上是静默空转**（exit 1，stdout/stderr 各 0 字节）——我已用 `node scripts/run-tests.mjs` 实测复现；但**操作者的因果链有一处需要更正**：这不是本批次越线造成的，也不是「Windows CI 无门禁」的全貌（见下）。

功能发现 A/B 我独立复核：**A 成立但严重性被我下调**，**B 基本被推翻**，操作者的自纠**成立**。

---

## BLOCKING（必须修才能发）

- **[P1] `companion/src/orchestrator/fleet.ts:75` + `companion/src/orchestrator/tab-lease.ts:698-710` / `:716-727`** — `buildFleetSnapshot` 里新增的 `releaseIdleWorkerLeases(all, llmSet)` 会对**每个未暂停且不在 abort map 里的 worker** 调用 `releaseAllLeasesForThread`，而后者**不做任何 pending / mutationHolds / createdHoldUntil 判断**，还会先 `dropTimedOutPending(tabId, holder)`（`tool-forward.ts:119-131`）把 in-flight tombstone **删掉**。
  - 触发条件（已复现，HEAD 新鲜编译产物）：
    ```
    acquire(tab, w1) + noteMutationHold + releaseMutationHold  →  HARD_HELD（正确：pending 挡住了释放）
    releaseIdleWorkerLeases([{id:'w1',agent_role:'worker',paused:false}], new Set())  →  null（租约被抹掉）
    ```
    同一状态在 `releaseMutationHold`（`tab-lease.ts:632`）和 `sweepPerCallLease`（`tab-lease.ts:291-293`）下都被保留；只有这条新路径例外。
  - 触发者不是用户动作，而是**读路径**：`FleetStrip.tsx:67-79` 每 4s 发 `fleet.status`；`useWebSocket.ts:921`（每收到一条 `security.confirmation.request`）也发一次。两次都会走到 `buildFleetSnapshot`。
  - 三个具体后果（前两个我读链路确认，第三个已复现）：
    1. `forwardToolToExtension` 分发超时且带 mutationHold 时会设 `timedOutInFlight = true`（`tool-forward.ts:246`）并**故意保留**租约，等晚到的 `tool.result` 走 `settleTimedOut` 或 hard_max——`discardTimedOutForTab` 一删，这个设计当场作废，晚到结果在 `handleToolResult` 里被静默丢弃（`tool-forward.ts:190-194`）。
    2. `chat.abort` 会**立刻**从 abort map 删除 controller（`message-router.ts:278-286`），但被 await 的 extension 工具没有 signal 监听（`ws/tool-forward.ts` 全程不接 `signal`），run 仍在等这个调用；此时 `llmSet` 已经不含该 worker、`paused` 又是 false → 租约被扫掉，"只在改页面的那一下持锁"的承诺失效。
    3. `create_tab` 的 60 秒持有被作废（复现：`armCreatedTabHold(555,'w-new',60000)` 后一次 fleet 快照即 `lease now: null`）——直接与 CHANGELOG `[Unreleased]`「刚创建的标签由创建它的 worker 或编排线程独占 60 秒」和 ADR-015 `create_tab_auto_hold_ms` 那一行冲突。
  - 附带的 fail-open 放大：`fleet.ts:58-67` 的 `require("../message-router")` 一旦抛异常，`catch { llmActive = [] }` 会让**所有**非暂停 worker 的租约被批量释放。这个 catch 在本批次之前只是「显示不准」，现在变成「锁被删」。同一批次把展示字段升级成释放依据，是这条路径的根本设计问题。
  - 建议最小修法：`releaseIdleWorkerLeases` 复用 `releaseMutationHold` 的三条件（`resolveHasPending` / `mutationHolds>0` / `createdHoldUntil>now`）或在有 pending 时改走 `releaseLeasesForThreadPendingAware`；并且不要把「abort map 里没有」当作「run 已结束」的唯一证据。

- **[P1] `companion/scripts/run-tests.mjs:54-62`（`return r.status ?? 1` 在 `:61`）** — 单条 `spawnSync` 拼 418 个绝对路径，超过 Windows `CreateProcess` 32767 上限，`r.error.code === "ENAMETOOLONG"`、`r.status === null`，而 `r.error` 被丢弃。实测：
  ```
  $ node scripts/run-tests.mjs ; echo exit=$?
  exit=1   stdout bytes: 0   stderr bytes: 0
  $ probe → status: null  errcode: ENAMETOOLONG  argvchars: 36883  count: 418
  ```
  该文件的 docblock（`:2-5`）自称「Replaces Unix find in package.json so Windows CI/dev works」——它的既定目的被证伪，且失败**零输出**，读者会误判为「测试全挂」而非「测试没跑」。`stdio: "inherit"` 救不了（子进程未创建）。
  与操作者的两点差异，我必须在报告里更正：
  - **不是本批次压垮的**：本机路径 `C:\Users\HuChen\Projects\cmspark\companion`（40 字符）下，越线点是 `a78236e2`（2026-09-07，373 个测试文件，估算 32784 字符）；`59931595` 已是 416 文件 / 36703 字符（超 3936），本批次只加 2 个文件（416→418，+180 字符）。
  - **不是「Windows CI 无门禁」**：`ci.yml:54-56` 在 **ubuntu** 上跑全量（argv 无此限制，是有效的）；`ci.yml` 的 windows smoke 只跑 4 个 TS 文件（`:152-163`）。另外在 GH Actions 的 `D:\a\cmspark\cmspark\companion`（30 字符）下总量约 31867 字符，**还装得下**（约 900 字符余量 ≈ 10 个测试文件）。所以这是「本机 Windows 开发/验证被静默关闭 + 离阈值只剩 10 个文件」，不是「CI 无门禁」。修法建议：分批 spawn（或 `--test` 传目录/glob），并把 `r.error` 打出来。

---

## NITS（非阻塞）

- `companion/src/orchestrator/llm-loop-gate.ts:87-93` — `scheduleWhenLlmSlotAvailable` 先判 `holders.has(id)` 就 `return {started:true}`，**永远走不到**本批次新增的 probe 分支；kick 被静默丢弃且返回「已启动」。当前调用点只会 kick 全新 worker id（`companion-dispatch.ts:374`、`expert-team.ts:561`）所以不可达，但一旦有「对已运行 worker 再 kick」的路径就会漏。对应地 `companion-dispatch.ts:394` 的 `kicked: true` 是硬编码，安装被拒时唯一披露是 `server.ts:784` 的一行 warn——CHANGELOG 说「丢弃本次 kick」属实，但调用方看不到。
- `companion/src/orchestrator/tab-lease.ts:291-293` + `companion/tests/orchestrator-tab-lease.test.ts:415-440` — per-call 租约的 idle TTL 不再 drain 在飞任务，只有 `hard_max`（600s）会。旧断言（`pending → drain+free`）被改成 `HARD_HELD`，属**有意的活性换安全**，但最坏占用从 `idle_ttl_ms`(120s) 拉长到 600s；测试名/注释已如实，建议 ADR §3.5 表格补一句。
- `chrome-extension/src/sidepanel/components/CodingHandoffSettingsSection.tsx:110-133` — `embeddedTerminal` 开关无平台门禁，勾选后 `:126` 就发 `terminal.open_tab`；而 `CodingAgentPanel.tsx:792-794` 有 `isDarwin()`。**第 5 道 darwin 门在第 6 项**：`companion/src/pty/handler.ts:77`（操作者列的四道之外）。影响被两件事压低：开关文案自带「仅 macOS」（`copy.ts:112`），失败信息明确（`pty/handler.ts:77-88` → `TerminalApp.tsx:141-143` 显示「内嵌终端仅支持 macOS」）。建议按平台 disable/隐藏。
- **发现 B 我认为基本不成立**（证据：`chrome-extension/.plasmo/chrome-mv3.plasmo.manifest.json:27-29` 是 `side_panel.default_path`，侧栏是**窗口级**表面，切到全页 tab 时侧栏仍在同一窗口可见；`terminal.ts:34-61` 用 `chrome.tabs.create` 开在当前窗口）。另外「ThreadGraphApp 有 2 处 sidePanel.open」不准确：该文件只有 1 个调用点（`ThreadGraphApp.tsx:334-335`），且它属于「提取要点后请刷新侧栏」流程，不是导航按钮。真正会缺侧栏的场景只有「已存在的终端 tab 在另一个窗口被 focus」（`terminal.ts:53-58`）——按该场景保留为 UX nit 即可。
- `companion/src/outbound-mcp/disclosure-session.ts:35-46` + `companion-http.ts:260` — 免问以 `caller_id` 为唯一键（`acceptOutboundDisclosure(caller_id)`，8h TTL，仅进程内）。所以同一 caller 的**任意 exfil 工具 / 任意 profile / 任意第二把钥匙**都能搭这一趟免问（"更宽权限搭车"答案是：能）。正文写的是「该调用方…后续同类外泄」属于如实但含糊的告知；且每把钥匙仍需各自 `allow_page_export`。**绕过路径不存在**：`/outbound-mcp/v1/disclosure` 恒返回 403 `ACK_NOT_OPERATOR`（`companion-http.ts:887-896`），唯一 arm 点是操作者确认。
- `companion/src/outbound-mcp/grant-cli.ts:29-35` — `%LOCALAPPDATA%` 只给 stderr **提示**不是阻断；可达路径只有「Windows 上 `LOCALAPPDATA` 为空」或「非 Windows 调用 `outboundMcpLaunchSpec("win32")`」（`:139-140`）。同时侧栏片段（`OutboundMcpSettingsSection.tsx:43-45`）改成 `C:\Users\<你的用户名>\...` 占位符，**仍不可直接粘贴**，只是失败方式从「未展开」变成「字面占位符」。
- `companion/src/llm/same-tool-guard.ts:32-46` + `adapter.ts:2152-2175` — 守卫是**按工具名**计数，不比较参数。操作者声明 #5 的「同一工具+同一参数」在代码和 CHANGELOG 里都不存在（Unreleased 只写「还在重复同一个工具」）。阈值不可绕成死循环：pivot 后计数清零 + `locatorPivotIssued` 只在该工具成功时清除，最坏「3 次失败→pivot→再 3 次→stop」。
- `scripts/...`/release：`docker` 无；`release.yml:157` 现在要求 `napi-v?` 但**仍要求文件存在**（fail-closed），我核对本机 `companion/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node` 确实存在，旧正则 `napi-[0-9]+` 永远匹配不到 → 修得对。残余：ORT 存在性只对 linux-x64 断言，macOS/windows zip 没有对应断言（历史不对称）。
- ADR-020 清单：`#524` 有完整 Surface/L2-classes/Compose/Autonomy/Trust/Channel 声明（`docs/audit/reviews/524-outbound-confirm-prompt.md`）；**`#526`（`ad7f0980`，改的是既有闸门：只读不再 acquire、不被 HARD_HELD 拒）在本批次没有任何 dual-review 产物**，`git log -S` 在 `docs/audit/reviews/` 里找不到 #526 记录，且该 commit 自述「includes the already-reviewed … fixes that were installed locally but not committed」（把三类未评审改动混在一个提交里）。按清单「加工具/闸门/UI 入口时缺声明算 blocking」，我判定它是**改既有闸门而非新增**，列 nit；但混提交 + 缺评审记录本身应记为流程问题。

---

## 未能验证

- **tombstone / abort 在飞的租约释放**（BLOCKING 1 的后果 1、2）我只做到「读链路 + 用编译产物复现 `releaseIdleWorkerLeases` 抹掉租约」；没有活跃 extension peer，无法端到端跑出「分发超时 + run 结束 + fleet 快照」的完整时序。
- **extension 侧 TabQueue 是否覆盖所有同 tab 路径**：`chrome-extension/src/background/browser-bridge.ts:62` 有一个 `TabQueue`，同 tab 的 CDP 调用会串行——这会把 BLOCKING 1 的「两个 writer 真正交错」降级为「顺序被打乱 + 语义被破坏」。我没逐个桥接工具核对，故严重性我定 P1 而非 P0，但**不排除有绕过 TabQueue 的同 tab 写路径**。
- **全量测试健康度**：官方命令（单次 spawn）在本机跑不起来，我用 4 段替代跑法得到 5314 tests / 62 fail。其中 `summoner-overlay` 的 `summoner.closed` 源窗口断言单独跑也失败，而 `companion/src/tray`、`companion/src/summoner` 本批次**零改动**→ 判为既有失败；另一大批是 `0o600`/symlink/`~/...` 的 Windows 环境失败；`image-fetch-admission` 在单文件运行时全绿，说明它也非本批次逻辑错。但我**不能**声称与官方 418 文件单次运行的失败集完全一致。
- 发现 A4（Windows 模式 C 外部终端是否端到端可用）未核。
- `.test-dist` 在评审中途消失（我先确认过它存在，之后不见）；`npm test` 第一句就是 `rmSync('.test-dist')`，我怀疑是并发进程（本机似乎有其它评审 agent 在跑）。我未把它当代码缺陷，已重新编译（gitignore 产物，工作树无 tracked 文件改动：`git status --short` 只剩既有的 ` M .gitignore`）。

---

## 已核实为正确的声明

- **声明 2（F1 kick 竞争）**：`installKickAbortController` 拒重复安装（`message-router.ts:250-256`）、`scheduleWhenLlmSlotAvailable` 有空槽也先 probe 且排队让位（`llm-loop-gate.ts:96-110`）、drain 单趟轮转不丢不饿死（`:181-186`）、kick 收尾 CAS 删除且 `null` 时 no-op（`:259-265`）、同步 `require` 消除 await 窗口（`server.ts:776-786`）。`kick-abort-map.test.ts` 6 条用例我实跑通过。
- **声明 3（stop/abort 不复活排队 kick）**：`message-router.ts:275` 先 cancel 后 release；`fleet.stop_all` 在逐 worker abort 前统一预取消（`:4482-4486`）；`stop_all_result` 披露 `cancelled_kick`（`:4524`）。`user-stop-clears-nextrun.test.ts` 7 条通过（含跨线程复活用例）。
- **声明 4（F2 collect_handback）**：三源并集谓词 `buildIsThreadLlmActive`（`companion-dispatch.ts:138-147`，闭包实时读，key 全是 threadId，无 `with open` 误判）；`board/service.ts:881-905` 把在飞判定提到 board-off 早返回之前，`WORKER_STILL_RUNNING` 统一返回；逐源单测在 `kick-abort-map.test.ts:167-190`。我实跑通过。
- **声明 5（same-tool-guard 行为）**：`adapter.ts:2152-2175` pivot/stop 分支 + 成功时清除（`:1974`），`same-tool-guard.test.ts` 5 条通过，最坏 6 次失败后 stop（有界）。
- **声明 6（per-call tab-lease）**：`TAB_MUTATION_LEASE_TOOLS`（`constants.ts:105-122`）与身份门（读仍在 `TAB_LEASE_TOOLS`）、pregate 只为 mutation 取锁 + `noteMutationHold`（`tool-pregate.ts:254-281`）、锁在 executor `finally` 释放（`server.ts:884-892`）、`create_tab` 60s 持有（`tool-forward.ts:389-402` + `constants.ts:13`）、成功导航后 `clearCreatedHold`（`tool-forward.ts:362-363`）、读不再被 HARD_HELD 拒（`orchestrator-tab-lease.test.ts:652+` 通过）。
- **声明 1（#524）**：只有 `[Outbound]` 前缀的确认抢焦点（`cockpit-focus-policy.ts:79`、`:101-107`；背景在 `background/index.ts:581-584` → `openOrFocusCockpit` 真会 `windows.update{focused:true}`，`cockpit-window.ts:150-157`），普通轻确认仍 `stay_background`（`chrome-extension/tests/cockpit-focus-policy.test.ts` 新增用例）；`l2-admission.ts:1262` 让托盘与侧栏共用同一 `[Outbound]` 标签（`:1274`、`:1492` 使用）；caller 比对是 `trim` 后**大小写敏感**的精确比对（`companion-http.ts:872-877`、`outbound-grants.ts:290`），签发侧 `trim` 存（`:162-166`），所以「逐字」成立（仅首尾空白被容忍）；`%LOCALAPPDATA%` 提示为提示而非阻断。
- **版本锚**：`companion/package.json:3`、`package-lock.json:3,9`、`chrome-extension/package.json:4`、`scripts/installer.nsi:14`、`cli-version.ts:5`、`stdio-server.ts:252`、`jsonrpc-stdio.ts:164`、`cli-version.test.ts` 均 0.6.9。**但** `v0.6.9` tag 指向 `488252bf`（09-23 16:02），晚于它的 `ad7f0980`/`b5a7396a` 只写在 `[Unreleased]`——即被安装验证的那份 0.6.9 与 tag 内容不同。
- **操作者自纠成立**：`git tag -l v0.6.8` 为空；`CodingHandoffSettingsSection.tsx` 中 `embeddedTerminal` 出现次数 `59931595`=4、`b5a7396a`=4；`01601109` 是 `59931595` 的祖先。**更正本身没有错**。
- 发现 A 的四处行号全部核对无误（`CodingAgentPanel.tsx:792`、`acp/manager.ts:253`、`acp/open-local-terminal.ts:1222`、`pty/session.ts:304`），另发现第 5 处 `pty/handler.ts:77`；该设置项非本批次引入（历史遗留 + 文案已写「仅 macOS」），我定为 **nit 而非 blocking**。发现 B 在源层面确实没有任何 `sidePanel` 入口（`TerminalApp.tsx` 全文 0 处，唯一按钮 `window.close()` 在 `:251`），但我用上面的窗口级侧栏证据**下调为 nit**；CDP fixture 的 `chrome.*` 桩不会改变这两条的源级结论，反而 B 的结论被 fixture 放大（真实扩展里侧栏与全页 tab 同窗共存）。

VERDICT: REJECT
PI_EXIT=0
