# 502 A/G1 对抗复审清单（Kimi）

> 日期：2026-09-18 · 评审人：Kimi（READ-ONLY）
> 对象：worktree `/tmp/cmspark-502/a`（切片 A 工具史折叠）与 `/tmp/cmspark-502/g1`（D-G1 round_limit），diff vs `1d8c35d6`
> 依据：spec `docs/superpowers/specs/2026-09-18-agent-operate-surface-design.md`；plans `2026-09-18-502-a-tool-history.md` / `2026-09-18-502-g1-round-limit.md`
> 状态：**计划级风险已钉；feat commit 未出现，代码复审待 diff。**

## 必查红线（brief 点名）

- [ ] **L2 确认是否被折叠**：`pendingConfirmIds` 命中的工具必须是 `current`，永不进芯；confirm 帧缺 `tool_call_id` 的类型（nonce_challenge / expert_team 强制去 Cockpit 的那些）会不会漏配 → 确认中工具被折进芯
- [ ] **100 是否被误删**：`MAX_TOOL_CALL_ROUNDS = 100` 常量仍在、仍生效；只是出口从 `circuit_breaker`/`chat.error` 改成 `round_limit`/`chat.done`
- [ ] **same-tool 是否被改成自动续**：adapter L2063（same-tool）/ L2316（连续 API 失败）仍 `circuit_breaker`，kernel 仍拦 `circuit_breaker`/`error` 不续跑
- [ ] **overlay 是否被碰**：`SUMMONER_ALLOW` / overlay 组件 grep 无 tool-history；overlay-standby 路径零 diff

## 切片 A — 计划级风险

1. **`current` 二义性**：规则 2 说「`current` = 最后一个 running / 确认中」。若 confirm 命中非末尾工具且无 running（abort 后 confirm 悬挂？），「最后一个」的取值顺序必须钉死：confirm 优先于 running，还是按数组序？测试只覆盖了 confirm 命中末尾的情形。
2. **abort 悬挂**：`chat.abort` / 急停后 `tool_calls` 里残留 `status:"running"` 的条目 → 该消息永远 `live`、永不折叠。计划无 abort 路径规则（abort 时 adapter 是否把 running 改写成 error？diff 里要核对消费端假设）。
3. **`status` 枚举以外的值**：`HistoryTool.status?` 可选且只钉了 running/success/error；空 status + 无 result + 非 busy → 落 `done` 还是 `live`？规则 3 只在 `threadBusy` 时兜底，非 busy 的残缺行未定义。
4. **失败可视性**：`done` 芯把 `failed:1` 收成文案「· 1 失败」。若芯片样式不区分失败色，等于「用折叠把失败藏成成功」（spec §2.4 NEVER）。diff 查芯片 className 是否有失败态。
5. **文案诚实性**：`doneChipLabel` 硬编码「N 步浏览器操作」——编程会话（shell_exec/MCP）也走这条文案即撒谎。至少 NIT。
6. **`isLast` 假设**：`threadBusy` 只对最后一条 assistant 为 true。若一轮 tool-loop 产出多条 assistant 消息（interleaved text），中间消息的已完成工具会被判 `done` 立即折叠——可接受（视图态），但确认中的工具若在非末条消息上，折叠会把 L2 证据藏起来。核对「一轮 = 一颗芯」与消息粒度的映射。
7. **展开态丢失**：`auditOpen` 是 MessageRow 本地 state；流式更新导致 remount（key 变化）会收起用户刚展开的芯。视图态可丢，但确认 key 稳定。
8. **测试盲区**：plan 的测试全走 `viewToolHistory` 纯函数 + 源码扫描；没有 DOM 级断言「L2 确认中的 ToolCallCard 仍渲染」。源码扫描只能证明字符串存在，不能证明接线正确——Task 2 Step 1 的扫描测试是弱证据，复审时手工核对 ChatView diff。
9. **死代码/回归**：`message-quiet-pr6.test.ts` 与 `running-tools.test.ts` 必须继续绿；`collectRunningTools` 驱动的 FocusBand「当前工具」行不得因 MessageRow 折叠而消失（折叠只动消息流，不动 FocusBand——diff 核对）。

## D-G1 — 计划级风险

1. **自动续跑的预算兜底**：`round_limit` 走正常 enqueue 路径后，runs_used / tokens / 墙钟记账必须在（plan 已写「仍要记账」——diff 核对 `onLoopRunFinished` 的 round_limit 分支没有跳过 accounting）。否则 100×N 段变成事实上的无限循环。
2. **证据已全勾 + round_limit**：若 100 触顶时 run_progress 全部 tick（工作其实做完了），正常路径是否仍 enqueue 空转一段？测试只钉了「unticked evidence → enqueue」。全勾 + round_limit 的正确行为是**不续**（按完成处理）——plan 未写，diff 核对。
3. **`chat.done` 的副作用链**：出口从 `chat.error` 改 `chat.done` 后，extension 会把这轮当成功完成：清 busy、可能触发标题生成/记忆钩子/完成提示音。第 100 轮出口时没有最终 assistant 正文 → UI 可能渲染空气泡或「完成」假象。diff 核对 adapter 在 round_limit 出口前是否写了收尾 assistant 消息，extension `chat.done` 处理是否需识别 `finish_reason`。
4. **`runStats.terminal` 赋值时序**：plan 示例先 `sendToExtension(chat.done)` 再 `runStats.terminal = "round_limit"`。若 loop kernel 经消息回调同步读 terminal，先发送后赋值 = 读到旧值。核对 terminal 的真实流转路径（runStats 对象引用 vs 帧回调）。
5. **审计事件类型**：新增 `task_loop.round_limit` 还是复用 `run_scheduled` 带 reason——capability-audit 的消费端（Cockpit/审计导出）若校验事件枚举，新 type 会破坏解析。diff 核对选了哪条路与消费端兼容性。
6. **墓碑句残留**：「达到最大工具调用轮次 (100)」字符串可能还存在于 extension 端文案/旧测试快照/文档。plan 只钉 adapter.ts 扫描；复审全仓 grep。
7. **worker 早退不变**：`onLoopRunFinished` 开头的 worker return 不得被动（spec NEVER：worker arm loop）。
8. **建议卡去重**：未武装 + round_limit → `task_loop.suggest`。若 suggest 已存在（上一轮已建议），会不会连发两张卡？测试只钉 `suggestFrames.length === 1` 单次场景。
9. **文案时序**：`task_loop.status` 在 round_limit 后续跑排队的间隙，label 不得写「推进中」（plan Task 3）。`deriveLoopStatus` 加 `lastTerminal` 还是靠 `run_scheduled.reason`——两条路选一个，别两个都半做。

## 复核方法（diff 出现后）

1. `git -C /tmp/cmspark-502/a diff 1d8c35d6 --stat` + 全 diff；G1 同理
2. 全 diff grep 红线串：`SUMMONER_ALLOW`、`overlay`、`MAX_TOOL_CALL_ROUNDS`、`达到最大工具调用轮次`、`circuit_breaker`、`run_progress`
3. 跑两仓相关测试：`npm --prefix chrome-extension test -- tests/tool-history-view.test.ts tests/message-quiet-pr6.test.ts tests/running-tools.test.ts`；`npm --prefix companion test -- tests/loop-kernel.test.ts`
4. findings 分级 BLOCK/MAJOR/NIT，分别落 `docs/audit/reviews/502-a-kimi.md` / `502-g1-kimi.md`
