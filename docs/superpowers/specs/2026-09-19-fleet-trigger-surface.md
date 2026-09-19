# 多智能体触发面：分派判据 + 舰队建议卡

GitHub: #513
Parent: #502（操作面；D 车道 Goal Driver 正交）
Date: 2026-09-19（v2 — 吸收 kimi companion 侧 + grok extension 侧双路对抗复审）
Status: Reviewed（两路 REQUEST_CHANGES 的发现已逐条落进设计）

## 1. 问题

ADR-015/016 机制完备：`spawn_worker` 常驻线程工具清单、专家团队、舰队观察面（#502 E）。但触发主体只有「模型自发调用」+「用户会说黑话」。实测（#513 背景证据，线程 8d9bgh）：提示词零分派判据、UI 无入口，适合并行的任务也全程单兵。舰队对用户永久隐形。

## 2. 产品句

任务适合多路一起做时，让我知道并给我一个选择——而不是要求我记得说对黑话。

## 3. 设计（v2）

三层，全部复用既有管线，不新增自主权。

### 3.1 提示词分派判据（companion）

`composeSystemPrompt` 插入固定段 `FLEET DISPATCH CRITERIA`，位置在 `runProgressHint` 之后、`safetyGuardContent`/`securityFooter` 之前。

- **surface 门（kimi MAJOR-2）**：与 `runProgressHint` 同款——`params.surface === "summoner"` 时置空。summoner 面的 `filterToolsForSurface` 已剥掉 fleet_suggest_propose，提示词不留死指令。
- **建议判据（全部满足）**：≥2 个相互独立的信息源/子任务（多站检索对比、可拆分清单、跨来源汇总）；单干预计 ≥3 次串行页面往返；子任务无顺序依赖。
- **否定判据（任一命中不建议）**：强顺序依赖；单标签页/单来源；快任务（<3 次往返）；所需工具在 worker 白名单外（shell/host 默认不可）。
- **动作指令**：命中则在开始顺序执行前调用一次 `fleet_suggest_propose`（纯建议）；用户同意后你会收到带子任务清单的明确指示，届时逐个调 `spawn_worker`（每次照常 L2）；不命中就单干；同任务只 propose 一次。

### 3.2 建议工具 `fleet_suggest_propose`（companion，advisory-only）

- 接线面（kimi MAJOR-1/NIT-3 完整清单）：静态目录 `tool-definitions-catalog.json` + `COMPANION_TOOLS` + `companion-dispatch.ts` executor case + `server.ts:694` surface 剥离名单（硬编码两工具名 → 加第三个）+ `tool-schemas.ts` zod schema（subtasks 2–5 项字符串）。
- **SUMMONER_ACL 带（kimi MAJOR-2）**：与 `run_progress_propose` 同款 fail-closed（precedent `companion-dispatch.ts:2097-2099`）。
- **plan_readonly 白名单（kimi NIT-4）**：advisory 与 `run_progress_propose` 同级——加入 `PLAN_READONLY_ALLOWED_TOOLS`（plan 模式本就是「先提案」场景）。
- **worker 显式拒绝（kimi NIT-5）**：worker 线程调用返回 `WORKER_DENIED`（precedent：`run_progress_propose` at `companion-dispatch.ts:2108-2110`）。
- **thread 归属（kimi NIT-7）**：取服务器盖章的 `params.__thread_id`（LLM 参数里的 thread_id 不可信），缺失 fail-closed `THREAD_REQUIRED`。
- 执行器行为：零变更、零 L2。静默期（内存 `Map<threadId, dismissedAt>`，TTL 10 分钟）内返回 `{success:true, surfaced:false, reason:"suppressed"}`；否则 `execOpts.broadcast` 发 `fleet.suggest { thread_id, reason, subtasks }`（广播——卡片在 sidepanel，调用方连接可能是 summoner/tray）+ 60s 节流防重复调用刷屏。同 run 二次调用直接 `surfaced:false, reason:"throttled"`。
- **loop 资格知情（kimi NIT-6，已核无害）**：propose 计入 `runStats.toolCalls`，但 unarmed `task_loop.suggest` 还要求 `untickedEvidence(...).length > 0`（`loop-kernel.ts:374-379`），propose-only run 无 run_progress → 不产续跑卡。spec 记录该依赖，测试钉住。

### 3.3 舰队建议卡（extension）

- **store（grok MAJOR-5）**：`fleetSuggestByThreadId: Record<threadId, { reason, subtasks, at }>`（非单槽——切换线程不丢、B 的 SET 不覆盖 A）；渲染取 `fleetSuggestByThreadId[activeThreadId]`；线程删除时随 `SET_THREADS` 同步清理对应键。
- **useWebSocket**：`fleet.suggest` 帧 → `SET_FLEET_SUGGEST`（按帧内 thread_id 入 map，不设活跃门——回切可见）；`fleet.suggest.dismiss` 上行走 `chrome.runtime.sendMessage`（**SW 转发 case 必须**，grok BLOCKER-2：`background/index.ts` default 拒未知类型）。
- **渲染（grok MAJOR-7）**：与 LoopSuggestCard **两个独立条件块**（loop 卡在上、舰队卡在下，可并存），禁止 if/else 互斥；同一固定建议区（非滚动转写内）；**不 scrollIntoView**（grok NIT-9）。
- **接受动作（grok BLOCKER-1 + MAJOR-4，v2 核心变更）**：**不再 task_loop.arm**——arm 会注入续跑自主权（kickoff/PROPOSE_REQUEST_STEER/状态行），与「并行分派」产品句错位，且 kickoff 与队列 steer 竞争（`message-router.ts:3204-3208`）。fleet 分派与续跑正交（#513 与 #502 D 的切割）。接受 = 立即本地 CLEAR + 上行 dismiss（companion 记静默）+ 发送一条**携带完整指令的用户消息**（grok MAJOR-6）：
  「同意多路并行。请将以下子任务分派给 worker 执行（用 spawn_worker，每次仍需我在确认中心批准）：\n1) {subtask}\n…\n全部完成后把各 worker 的结果汇总给我。」
  消息构建抽纯函数 `buildFleetAcceptMessages(threadId, subtasks)` / `buildFleetDismissMessage(threadId)`（LoopStatusRow.tsx，与 `loopArmMessage` 同居），供测试。
- **接受即清卡（grok BLOCKER-3）**：不依赖 hasFleetActivity/task_loop.armed 被动清——点击处理器同步 CLEAR 本地 + dismiss 上行。
- 卡形态：不预选、不倒计时、不阻断、无 modal（沿用 Loop 卡样式）；标题「此任务适合多路并行」+ reason + 子任务列表 + 「派 worker 并行做」/「不用，单线程继续」。

### 3.4 dismiss 入站帧三件套（kimi MAJOR-1 + grok BLOCKER-2）

`fleet.suggest.dismiss { thread_id }`：
1. `ws/validate.ts` validators 注册（生产 fail-closed 拒未知类型，`validate.ts:1742-1759`）；
2. `message-router.ts` case arm（记静默时间戳，返回 ack）；
3. `ws-router-validator-lockstep.test.ts` 加条目（FREEZE 注释要求两侧同步）。

### 3.5 目录文案改写

`spawn_worker` 描述改为决策面向：判据摘要 + 硬约束（L2、≤5、worker 白名单降级、tab 租约、「用户在建议卡同意后」语境）。

## 4. 红线（NEVER，复审重点）

- **no auto-spawn 不动摇**：propose 纯建议；接受 = 用户消息；spawn 仍模型发起 + L2 逐次。**且不 arm**——不借道续跑自主权。
- 不新增 L2 类；不动 ≤5 workers / WORKER_HARD_DENY / tab 租约。
- 判据默认倾向单干（否定条件优先）。
- 提示词判据只进 system 段、surface 门控，不进 untrusted 链，网页内容不可改写。
- 建议卡不演化成 vis/swarm 大屏。

## 5. 验收（eval gate）

- [ ] companion 单测：executor 零变更（不建线程/不改角色/不 spawn/不 arm）；__thread_id 缺失 fail-closed；SUMMONER_ACL 拒；worker 拒；静默期抑制；60s 节流；dismiss 帧记账（复用 `run-progress-propose-dispatch.test.ts` harness 方式驱动 `executeCompanionTool`）。
- [ ] lockstep：validate + router 的 dismiss 帧各有一致行为测试。
- [ ] 提示词源码锁：判据段存在、含否定条件、位于 securityFooter 之前、summoner 置空。
- [ ] extension 单测：`buildFleetAcceptMessages`（消息含每个 subtask 与 spawn_worker 指令）/`buildFleetDismissMessage` 纯函数断言；SET_FLEET_SUGGEST per-thread map 行为；接受即清；SW 转发 case 源码锁。
- [ ] 判据评测（脚本 + 固定 mock 任务集）：并行任务集 ≥8 → propose 率 ≥6/8；顺序任务集 ≥8 → ≤2/8。
- [ ] 既有 fleet/task_loop/ws 测试全绿。

## 6. 与 #513 票面的差异声明

票面「点击即走 arm + propose + spawn」在双路复审后修订为**不 arm**（理由见 3.3；arm 是续跑自主权，与分派正交且存在 kickoff 竞争）。其余一致。完成后在 #513 回帖说明。

## 7. 不在本版（v1 之后另议）

静默持久化（落盘）；专家团队路径建议卡；判据运行时自适应；fleet.suggest 帧的跨端重放（panel 重连补发）。
