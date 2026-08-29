# Post-Review Adversarial Fixes — Execution Plan (Autopilot ralplan handoff)

> 日期：2026-08-29 · 需求来源：`docs/superpowers/specs/2026-08-29-post-review-adversarial-fixes.md`
> 评审证据：四路对抗评审 + 三路 grok CONFIRMED/PARTIAL 判定（本会话生命周期证据）

## 架构决策

- **D1（F1）**：恢复"裸 shell 家族条目拒绝执行旗标"语义，但保留对 `grep -c`/`wc -c` 的非解释器放宽。实现倾向于把 `sh/bash/zsh/pwsh/powershell/deno/bun` 纳入解释器识别（或等价的分支），先看 `isKnownInterpreter`/`INTERPRETER_BASENAMES`/`argvHasDeniedInterpreterFlags` 的全部调用点再动手，避免影响其他调用方。
- **D2（F2）**：做真结果回传，不做纯文案降级。扩展 SW 捕获 `sidePanel.open()` 失败后经 WS 回传结果帧；companion `/api/operate` 等待该结果（带短超时）再应答 overlay；overlay 按真实结果显示。复用现有请求/响应模式，不新造协议族。若实现中发现回传链路代价过大，降级为诚实文案（「已请求…如未打开请手动点开」）+ SW 失败日志，并在交付说明中标注。
- **D3（F3c）**：收紧为按认证 grant 自身 `allow_page_export` 判定。`denyOutboundExfilIfNeeded` 增加 grant 维度（调用方已持有 `auth.grant_id`），同步更新 grant-cli 文案与 `outbound-grant-cli.test.ts` 契约测试。
- **D4（F3a）**：Swift 侧在确认生命周期结束（resolved/连接恢复/hydrate）处复位 `confirmPending = false`；以源码阅读确定最小复位点。Windows 无法构建 Swift，配 source-grep 测试（项目既有惯例）。
- **D5（F4）**：新增行为级集成测试，复用 `companion/tests/` 现有 ws 测试工具（先读 batch-e/summoner-web 测试找 harness 模式）。

## 并行执行批次（文件不重叠）

| 批次 | 内容 | 主要文件 |
|---|---|---|
| W1 | F1 shell allowlist 修复 + 行为测试 | `companion/src/capability/shell.ts`、`companion/tests/`（新增/更新） |
| W2 | F3c exfil grant 判定收紧 + 文案 + 契约测试 | `outbound-grants.ts`、`facade.ts`、`companion-http.ts`、`grant-cli.ts`、`outbound-grant-cli.test.ts` |
| W3 | F2 打开侧栏真结果回传 + F3b fileEl 清空 | `ui-open-sidepanel.ts`、`summoner-web.ts`、`chrome-extension/src/background/index.ts`、相关测试 |
| W4 | F3a Swift confirmPending 复位 + grep 测试 | `SummonerOverlay.swift`、`summoner-overlay.test.ts` |
| W5 | F4a/F4b 握手 terminate + WS fanout 行为测试 | `companion/tests/`（新增） |

## Critic 修订（2026-08-29 · APPROVE_WITH_CHANGES 已折入）

- **D1 修订**：不复用解释器 `-e` 规则（`bash -e` 是合法 errexit，聚簇规则会误杀 `bash -eu`）。改用 **shell 专用旗标集**：sh/bash/zsh 拒 `-c`；pwsh/powershell 拒 `-c`/`--command`/`-ec`/`--encodedcommand`；deno/bun 拒 `eval`/`-e`。`grep -c`/`wc -c` 放宽保持。
- **D2 修订**：改动清单补全——新增结果帧需 `ws/validate.ts` validator + `message-router.ts` 路由入口；**重写**两个既有契约测试（`companion/tests/ui-open-sidepanel.test.ts:44-45` 钉死无 id broadcast、`chrome-extension/tests/ui-open-sidepanel.test.ts:8-23` 钉住空 catch 现状）；配 lockstep 测试（惯例：`chat-shell-copy-lockstep.test.ts`）。`protocol.ts` 无需动（`ui.open_sidepanel` 不在其中）。注意 broadcast 回声会到 tray 自身（`menu-bar-agent.ts:1876` 已忽略，加 id 后仍安全）。测试缝：companion 层用注入结果帧/超时测 pending 关联，扩展侧 source-grep。
- **D3 修订（双轨）**：`denyOutboundExfilIfNeeded` 有三调用点，stdio 路径（`bridge.ts:107`、`facade.ts:134`）只有 caller_id、无 grant 凭证——**HTTP 路径按认证 grant 判定，stdio 路径显式保留 caller 级并注释文档化**；HITL 会话仍 caller 键，加一行注释说明语义错位。受影响测试全清单：`outbound-mcp-facade.test.ts`、`outbound-mcp-companion-http.test.ts`、`outbound-mcp-http-e2e.test.ts`、`integration/outbound-mcp-executor.test.ts`、`outbound-mcp-dual-entry.test.ts`、`outbound-mcp-grants.test.ts`、`outbound-grant-cli.test.ts`。
- **D4 修订**：companion 从不向 Swift 推确认解决事件，复位点只能是 hydrate/attach 成功路径（`applyHydrate` browser==attached 等）；不加 bridge cmd。
- **批次归属修订**：F4a 进 `integration/ws-origin-handshake.test.ts` 扩展；F4b 新建独立测试文件，**不得**碰 `summoner-web.test.ts`（归 W3）。W1 测试落 `batch-c-host-p1.test.ts`/`capability-shell-netsec.test.ts`。

## 验证闸

1. 每批完成后跑对应测试文件；全部批次完成后跑 companion 全量测试 + `tsc -p tsconfig.test.json`
2. chrome-extension 改动跑其自身测试（W3 涉及）
3. 交付前用 grok 对最终 diff 做一轮独立复核（CONFIRMED/REFUTED）
4. 不 commit、不 push

## 风险

- W3 跨三仓库层（companion/扩展/overlay 页面），协议帧需双端 lockstep——若引入新消息类型，检查 `protocol.ts` 与 summoner ACL 允许表
- W2 收紧判定可能破坏依赖 caller 级语义的现有部署 → 测试先行，文案同步
- F4b fanout 测试需要多客户端 ws harness，若现有工具不足，先建最小 harness 再写断言

## 完成回执（2026-08-29 · ultragoal terminal evidence）

- W1 shell allowlist：经 W1→W1d 四轮修复 + grok 四轮独立复核，终判 **CLOSED**（pwsh 前缀/斜杠/粘连、.exe 归一、cmd /c、node/perl/php/deno/bun 执行旗标全闭环；位置参数/GTFOBins 类已注释声明为类边界，真正门是 L2）
- W2 exfil grant 双轨：grok **CONFIRMED**（HTTP per-key、stdio caller 级、HITL 重算无越权）
- W3 打开侧栏真回传 + fileEl 清空：grok **CONFIRMED**（残留 Low：结果帧无 origin 绑定、超时/失败码竞态）
- W4 Swift confirmPending 四复位点：grok **CONFIRMED**（残留 Low：error/换线程两条次要复位缝）
- W5 行为测试：握手 terminate 3 用例 + fanout 3 用例落地（harness 复刻生产逻辑，漂移风险已在测试头注明）
- 测试证据：companion 全量 3898 测 / 3809 过 / 78 失败（干净树基线 83，全部为既有 Windows 环境性失败，stash 对照确认零引入）；tsc 通过；chrome-extension 835/835
- 未 commit、未 push

## 第二批回执（2026-08-29 · 残留项清理）

- R1 外发 HITL 断连：批准后工具不再对断连调用方执行，CALLER_DISCONNECTED 审计区分 — grok CONFIRMED
- R2 run_progress 三态：null clear 持久、仅 undefined 播种、get() 同改 — grok CONFIRMED
- R3 thread.updated 双发去除 + llmLoopOwnerPanel 三路出口对称清理 — grok CONFIRMED
- R4 侧栏结果帧 origin 绑定 + settle 单漏斗竞态修复 — grok CONFIRMED
- R5 Swift confirmPending 换线程/终态错误两缝 — grok CONFIRMED
- R6 SSE 8s 重连宽限 + hide 不同步释放租约（1s/8s 双宽限）+ win32 PID kill — grok CONFIRMED
- 测试证据：全量 3910 测 / 3818 过 / 81 失败（失败清单逐条比对，全部与既有环境清单重合，零引入）；tsc 通过
- 遗留 Low（下轮）：stopSummonerWebServer 丢 PID 不杀进程、overlay SSE 收不到 slash-pin 的 thread.updated、hydrate-detached 换线程不清 CTA、win32 不扫进程树、chat.aborted 不在 summoner 映射（R5 发现）、thread.digest_updated 同款双发（R3 发现，message-router.ts:678-679）
- 未 commit、未 push
