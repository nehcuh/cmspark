# 独立对抗评审报告 — 0.6.9 拉取批次（`59931595..b5a7396a`）

## 结论摘要

本批次 12 个提交的**核心并发安全声明全部成立**：我未能找到任何「共享 AbortController 双跑」「stop/abort 复活排队 kick」「collect_handback 误收活 run 叙述」的可达路径。9 个关键测试文件共 128 个用例我逐一单独执行全部通过 [executed]。但发现若干非阻塞问题：F1 修复在「稳态相撞」场景下走的是**静默丢弃**分支（无日志、返回 `started:true`），新确认文案与 8h TTL 实现不符，`run-tests.mjs` 的 `r.status ?? 1` 确如操作者所述吞掉 `r.error`（但属 pre-existing 且 fail-closed），以及 v0.6.9 tag 与 main HEAD 脱节。**无 BLOCKING。**

---

## 已知问题独立复核

### Windows 测试失效（四问逐答）

机制**完全证实** [executed]：
1. **是否 blocking？** 不是。「无门禁/fail-open」不成立——`runNodeTest` 返回 `r.status ?? 1` = **1**，`npm test` 以 exit 1 响亮失败（fail-closed），且 CI 在 `ubuntu-latest` 跑同一命令（`.github/workflows/ci.yml:11,56`），Linux ARG_MAX ~2MB 不受 36.8k argv 影响。真正的问题是 Windows 开发机上**可观测性归零**（exit 1 + 0 字节输出），以及本批次新测试在 Windows 上无法经标准门禁自证（我已手动代跑，全绿）。
2. **`r.status ?? 1` 吞 `r.error` 是缺陷吗？** 是，独立成立的可修缺陷：`companion/scripts/run-tests.mjs:61` 应显式打印 `r.error`（含 `code`）再返回非零。我在本机用纯 argv 超长探针复现了 `status:null / error.code:'ENAMETOOLONG' / stdout 0B / stderr 0B` [executed]。
3. **本批次是压垮的稻草吗？** 不是。我量得 HEAD 编译产物 argv 文件路径合计 **36803 字符**（418 文件）；本批次仅新增 2 个文件（`adapter-transient-transport.test.js` 95 + `same-tool-guard.test.js` 83 字符 ≈ 178 字符），base `59931595` 约 36625 字符——**早已越过 32767**，阈值在 0.6.8 时代就被突破。
4. **418 是否含不该发现的文件？** 否。walk 只收 `*.test.js` 且排除 `_` 前缀；实际分布 400 + integration 16 + security 1 + single 1，全部是真实测试，无 fixture 污染 [executed]。

### 功能发现 A（内嵌终端 Windows 必然失败入口）

**成立，四层门禁行号逐字核实** [inspected]：`CodingAgentPanel.tsx:792-797`（`showEmbedEntry` 含 `isDarwin()`）、`companion/src/acp/manager.ts:253`、`open-local-terminal.ts:1222`、`pty/session.ts:304`。设置页 `CodingHandoffSettingsSection.tsx:113-127` 确认**无任何平台门禁**，checkbox 可勾、勾后渲染按钮、按钮发 `terminal.open_tab`。
- **第五处门禁？** 无，且我找到了操作者没写的**加重情节**：`background/index.ts:1738` → `openOrFocusEmbeddedTerminal`（`background/terminal.ts:44-75`）**无平台预检、不经 companion**，直接 `chrome.tabs.create`。即 Windows 上 tab **真的会打开**，用户落在 `TerminalApp.tsx:154` 的「当前平台暂不支持内嵌终端」错误页——四层门禁只挡 PTY，不挡 tab。
- **有意还是遗漏？** 遗漏偏向：`CodingAgentPanel.tsx:788-791` 的注释明说加 `isDarwin()` 是「never promise an embed the companion refuses with `unsupported`」——同一理由没有施用到设置页，两处门禁不一致。
- **归属**：#432（`01601109`，2026-09-06），**本批次未触及，pre-existing**。标签已写「仅 macOS」（`copy.ts:112`）构成部分告知。**不 blocking**；建议 Windows 上 disable 该开关。

### 功能发现 B（终端 tab 无回侧栏入口）

**成立** [inspected]：`TerminalApp.tsx` 全文 0 处 `sidePanel`，唯一头部按钮 `:251` `window.close()`；`ThreadGraphApp.tsx:335` 确有现成 `chrome.sidePanel.open({ windowId })` 模式未复用。无 background 消息/`window.opener` 等替代回程（`background/terminal.ts` 只有 Port⇄WS 中继与 origin 校验）。缓解事实：关闭 tab 后侧栏一键可回，且 Windows 上该 tab 只在发现 A 的链条里可达——两者复合成一个「用户可达的死端错误页」。**pre-existing，不 blocking**。

### 操作者自纠

**成立** [executed]：`git tag` 无 `v0.6.8`（仅 v0.3.0/v0.4.0/v0.6.9/computer-use-w8-snapshot）；`embeddedTerminal` 在 `59931595` 与 `b5a7396a` 均为 **10** 处（chrome-extension/src），`CodingHandoffSettingsSection.tsx` 两边均 4 处；引入提交 `01601109` 是 base 的祖先。更正无误。

### 证据边界（fixture 桩是否推翻 A/B）

**不能推翻。** 两条发现的关键证据都是**静态代码事实**：checkbox 的 enabled/checked 是纯 React 行为（`CodingHandoffSettingsSection.tsx:113-119`），开 tab 链路和四层门禁是真实代码路径，均不依赖 `chrome.*` 桩的行为差异。桩只影响 `config.set` 回显等外围观察。结论维持。

---

## BLOCKING（必须修才能发）

无。

## NITS（非阻塞）

1. **[声明准确性] `companion/src/orchestrator/llm-loop-gate.ts:87-94` — 稳态相撞走静默丢弃，`started:true` 且无日志**。用户手动 chat.create 对 worker 线程会同时持有 abort controller（`message-router.ts:1244`）和 gate 槽位（`:1250`）；此时 kick 到达命中 `holders.has(id)` 早退，`run` 永不入队、`expert_team.kick_skipped_active` 日志（`server.ts:784`）永不触发，返回值却声称 `started:true`。CHANGELOG「占线则排队让位，不再丢弃 kick」只在**瞬态窗口**（`:1249` 的 `await import` 使 controller 已装、槽位未持——probe 路径 `:100-111` 恰好真实可达于此）成立；稳态下 kick 仍被丢弃。无双重跑，安全性质成立，但披露与文案过宽。
2. **[测试建模] `companion/tests/kick-abort-map.test.ts`（「F1 queued kick waits…」用例）用 `__testSetLlmActiveForTests` 只造 abort map、不造 gate 槽位**——真实 chat.create 不会产生该稳态，测试锁的是 probe 分支而非用户故事的主路径。drain 的 probe 守卫（`llm-loop-gate.ts:185-190`）与瞬态窗口场景则真实可达、被正确覆盖。
3. **[竞态残留·推断] `companion/src/message-router.ts:4486-4515` — stop_all 预取消与 `paused:true` 之间有 await 窗口**（`:4492`/`:4500`）。父编排器并发生执行的 `spawn_expert_team` 若在此窗口为已 abort 的 worker 入队 kick，且另一 run 恰在 `:4515` 落 pause 前释放槽位触发 drain，kick 可启动一轮（新工具调用随即被 `tool-pregate.ts:170` 的 `worker_paused` 拒绝，损害有限；pause 之后的 drain 会丢弃 paused 项）。窗口毫秒级、自愈，非本批次声称修复的缺陷范围。
4. **[披露缺口] `companion/src/message-router.ts:2102` — `chat.abort`/`stop_thread` 不披露被取消的排队 kick**；仅有排队 kick 的线程按 stop 返回 `stopped:false`（kick 实际已被 `:275` 取消）。仅 `fleet.stop_all_result` 有 `cancelled_kick`（`:4524`）。
5. **[文案与实现不符] `companion/src/outbound-mcp/companion-http.ts:176-181` vs `disclosure-session.ts:18`** — 本批次新写的确认正文称「允许后……**本次 Companion 进程内**不再逐次询问；**重启后要再批**」，实现是 `acceptOutboundDisclosure(caller_id)` 默认 **8 小时 TTL**：进程不重启也会在 8h 后重新弹确认。方向 fail-safe（多问一次更安全），但用户可见承诺失真。
6. **[既有缺陷·建议修] `companion/scripts/run-tests.mjs:56,61`** — 见上文四问；最小修复：打印 `r.error` + 改用目录/glob 参数或分批 spawn。
7. **[发布卫生] `v0.6.9` tag 指向 `488252bf`，main HEAD 多出 3 个提交**：`ad7f0980`（tab-lease 读不持锁、create hold 120s→60s）与 `b5a7396a`（same-tool-guard 换策略）不在已发布产物内，CHANGELOG `## [0.6.9]` 仅 4 条、完全未记这两项行为变更；同一版本号对应两份不同二进制。若从 tag 补发或从 main 重打 0.6.9 包，用户行为不一致。
8. **[ADR-020] 实现者声明缺 `Surface/Compose/Autonomy/Trust/Channel` 六行声明块**，且 diff 非纯 docs/test/refactor（改了既有 tab-lease 门语义与确认焦点策略）。因未新增工具/门/UI 入口（均为收窄既有门），按模板定级为 nit。Trust monotonicity 本身无回退：免问会话按 caller_id 键、grant profile 独立把门、`originWs` 绑定未回退（`companion-http.ts:168-176`）。
9. **[既有] `companion/src/outbound-mcp/outbound-grants.ts:291-292` — caller_id 比对先 trim、空值直接跳过校验**。「必须逐字相同」实为「trim 后逐字、缺失则不校验」（bearer token 仍强制，非鉴权绕过）。pre-existing，非本批次引入。
10. **[功能 A/B，pre-existing]** `CodingHandoffSettingsSection.tsx:113-127` 建议按平台 disable；`TerminalApp.tsx` 建议复用 `ThreadGraphApp.tsx:335` 模式。归属 #432 后续票，不应记在本批次头上。

## 未能验证

- **发现 A4**：`openWindowsWithPref`（`open-local-terminal.ts:1192` 有真实映射与实现）在 Windows 上端到端可用——未实际拉起终端验证。
- **瞬态窗口的实机复现**：probe 路径可达性（chat.create `:1249` 的 await 窗口）是静态推断 + 测试 helper 建模，未做双 socket 实机竞态复现。
- 488252bf 的 linux zip 检查只在 GitHub runner 上真实执行过——我只核了正则语义（`napi-v?[0-9]+` 仍强制 binding 存在，fail-closed 保持），未跑 workflow。

## 已核实为正确的声明

- **声明 1（#524 outbound）**：✅ 核心成立。`cockpit-focus-policy.ts:79` `outboundChannel → open_focus`，`:101` 按 `[Outbound]` 前缀识别；普通 navigate 轻确认仍 `stay_background`（extension 测试 51/51 通过 [executed]）；确认正文含调用方/工具（`companion-http.ts:176-181`，`fullPreview` 已设）；tray 与侧栏共用 `confirmToolName`（`l2-admission.ts`，`l2-summoner-confirm-origin.test.ts` 绿）；侧栏 snippet 改展开路径 + CLI stderr 提示（`grant-cli.ts:31-35,208-210`——**是提示不是阻断**，与「stderr 提示」措辞相符，非 over-claiming；且 win32 + LOCALAPPDATA 有值时直接印真实路径，提示仅兜底）。保留 nit 5/9 的两处措辞偏差。
- **声明 2/3（F1 + no-revive）**：✅ 安全性质全部成立。`installKickAbortController` 占线拒装返回 null（`message-router.ts:250-256`）；`releaseKickAbortController` CAS + null no-op（`:259-265`）；`abortThreadChat` 先 `cancelDeferredLlmKick` 再 release（`:267-293`，顺序正确，chat.create finally 亦先删 controller 后 release gate，`：1418→1425`）；`stop_all` 预取消全部目标（`:4482-4485`）+ 逐 worker `cancelled_kick` 披露（`:4524`）；`scheduleWhenLlmSlotAvailable` probe（`llm-loop-gate.ts:100-111`）+ drain 单遍守卫（`:178-191`，rotation 有 guard 不死锁）。kick 路径改同步 require 消灭 `await import` 缺口（`server.ts:778`）。测试 7+7 全绿，含跨线程复活场景 [executed]。
- **声明 4（F2）**：✅ `buildIsThreadLlmActive` 命名导出、三源并集、**三源 key 一致均为 threadId**（abort map / gate holders / deferred queue）；活 run 检查先于 board-off 早退（`board/service.ts`）；`WORKER_STILL_RUNNING` 含 board 关闭路径；空源不会误判（probe 于 `message-router.ts:194` 模块初始化注册）。测试 16/16 绿 [executed]。
- **声明 5（same-tool-guard）**：✅ 注入的 `LOCATOR_PIVOT_INSTRUCTION` 是**静态常量**（`same-tool-guard.ts:9-11`），不掺页面内容，无注入放大；匹配仅认固定错误前缀（`:14-22`）；pivot 每工具一次、成功即重置，停止上限约 2×threshold，无死循环（`adapter.ts:2152-2175`）；3 个 circuit_breaker 断点与测试断言一致。测试 5/5 绿 [executed]。
- **声明 6（tab-lease）**：✅ 读操作留在 identity set 不 acquire（`constants.ts` 双集合 + `tool-pregate.ts:255-282` 仅 `TAB_MUTATION_LEASE_TOOLS` 加锁）；mutation hold 在 executor finally 释放（`server.ts` try/finally）；worker/orchestrator create_tab 持 60s 或直到持有者导航（`tool-forward.ts:389-399` / `:356-365`）；超时墓碑（`timedOutInFlight`）由 settle/hard_max 兜底，泄漏上界 10 分钟；outbound episode lease 行为不变；租约 holder 取服务端 `__thread_id` 桩（`adapter.ts:1725-1730` 覆盖模型参数，**不可伪造**）。测试 32/32 绿 [executed]。读写竞态（读不持锁被中途导航）是声明明示的设计取舍，配套 `classifyError` recoverable（`security.ts`）。
- **版本锚**：✅ 全齐 0.6.9 [executed]：`companion/package.json`、`chrome-extension/package.json`、两个 lockfile、`installer.nsi`、`cli-version.ts` fallback、`jsonrpc-stdio.ts` clientInfo、`stdio-server.ts` serverInfo；src 内无残留 0.6.8。
- **`488252bf`**：✅ 仅放宽 `napi-` 到 `napi-v?`，binding 文件仍强制存在，**fail-closed 保持**，不掩盖缺二进制。
- **测试健康度**：✅ [executed] 逐一运行 `same-tool-guard`(5)、`kick-abort-map`(7)、`board-collect-handback`(16)、`orchestrator-tab-lease`(32)、`user-stop-clears-nextrun`(7)、`adapter-transient-transport`(2)、`ws-tool-forward`(10)、extension `cockpit-focus-policy`+`focus-band-priority`(51) —— 130 用例 0 失败。新测试锁的是真实行为（如 stop_all 跨线程复活、墓碑不二次 resolve），非纯实现细节（nit 2 的一处建模偏差除外）。

---

判定：本批次六项声明无一是虚构；发现的全部问题要么 pre-existing、要么是披露/文案层面的失真，无一破坏本批次声称修复的并发安全性质。无 BLOCKING，NITS 如上。

VERDICT: APPROVE_WITH_NITS
CLAUDE_EXIT=0
