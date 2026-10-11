# 仓库整理与多智能体协作独立综合诊断

日期：2026-10-11。诊断基准：`origin/main` 的 `9429ec61597a651a99ccb53cb59921197901e730`（0.6.13）。本报告综合十个子系统及 architecture、correctness、security、tests、ops、integration 六个交叉视角，去重后给出处置和实施次序。后续整理及修复正在进行；以下“保留／提取／归档／删除”是处置决定，不代表已经执行或通过验收。

证据输入：`/tmp/cmspark-cleanup-review.md`、`/tmp/cmspark-runtime-diagnosis.md`、`/tmp/cmspark-runtime-crosscut.md`、`/tmp/cmspark-integration-diagnosis.md`、`/tmp/cmspark-security-crosscut.md`，以及本仓库 [文章对照评估](2026-10-11-multi-agent-article-comparison.md)。输入中各轮重复发现只计一次；主线程后续实施代码不在本诊断结论的已验证范围内。

## 总体评级

**架构适配性：良好；生产可靠性：有明确待修缺陷；业务验收及跨重启接续：部分实现。** 当前 Supervisor + 受控 Blackboard 适合单机 Companion 的小型队伍。父子归属、权限交集、并发和创建预算、运行结束监督、结果投影、依赖认领及原子 Board 变更均已有实际代码，不能继续当作空白能力。

优先级应是隔离共享进程故障、补齐会话归属、保全有效成果和受控恢复，再测量协作收益。当前没有实测证据要求引入 P2P、gossip、跨组织 WoT 或任意自主移交。新持久任务层应接在已有派发和收集路径上，不另建绕过确认、停止状态或权限检查的执行器。

| 子系统 | 已有基础 | 本轮处理重点 |
|---|---|---|
| Browser / tab lease | 读写租约分离已在主分支 | 提取 debugger attach 并发及生命周期修复 |
| Host / platform / PTY | 0.6.13 Windows 支持、Kimi 前置授权保护 | 修正能力声明；原生恢复方案单独验收 |
| UI / knowledge | 多个历史分支内容已随 squash 合入 | 提取未交付的目录选择错误反馈；避免回退新 UI |
| Spawn / scheduling | 确认、HARD_DENY、占用与创建预算 | 逻辑任务绑定、能力过滤、可解释就绪队列 |
| Cooperation result / state | 有界结果快照、来源版本、所有者及运行检查 | 独立业务验收、持久 attempt、保留已验收成果 |
| Board / intents / facts | 原子变更、依赖门禁、来源信任 | 分清来源可追踪与语义支持，防旧 attempt 合并 |
| Thread / LLM supervision | 等待释放槽位、收集兜底、终局记录 | 启动前检查点、重启中断识别、明确恢复选项 |
| ACP | 独立会话及统一结果投影 | 畸形消息隔离、会话归属、子进程生命周期 |
| Tests / eval | 较多确定性运行时测试、建议器模型评估 | 真正的执行故障测试和协作收益测量 |
| Build / CI / ops | 跨平台编译及部分烟测 | Linux arm64 验证与原生平台验收分开记账 |

## 去重后的实证发现

### P1：畸形 ACP 消息能够使异常逃逸到共享进程

`companion/src/acp/jsonrpc-stdio.ts:52–63` 对解析后的任意 JSON 直接读取 `msg.id`。独立诊断在隔离 Node 22 进程中，向生产类的模拟子进程 stdout 写入 `null\n`，数据监听器抛出 TypeError，探针进程退出码为 1。单个 ACP 对端异常因此可能扩大为 Companion 故障，而不只是该会话失败。

提取 `origin/codex/windows-artifact-review` 中相应消息形状校验、流错误处理、边界限制及回归测试，按当前源码集成。验收需证明坏对端被终止、健康对端和宿主仍可工作；不能只断言解析器返回错误。

### P1：ACP 工具入口缺少会话所有者检查

`companion/src/tool/companion-dispatch.ts:560–619` 的状态、收集、取消路径可用传入的 `session_id` 访问全局会话。收集路径遇到所有者不符只是跳过协作快照持久化，仍返回报告；取消路径直接调用管理器。独立临时数据根复现：一个普通线程可以读取另一个线程的哨兵报告并取消该会话。

独立安全复核排除了 worker HARD_DENY、plan_readonly、UI handler 所有者校验及结果持久化校验作为本入口的保护：这些要么只覆盖特定角色，要么属于不同调用路径。真实前置条件是普通执行线程知道其他会话 ID。这是同一可信本地应用内的跨会话干扰，**不是远程未认证访问或跨账户突破的证明**。

在返回信息或调用 start/cancel/apply 前统一检查服务端当前线程与会话固定所有者，拒绝时不披露外部会话元数据；worker 继续不能使用 ACP。

### P2：Windows 嵌入终端能力被错误报告为关闭

`companion/src/tool/companion-dispatch.ts:460` 的 `embedded_terminal_enabled` 仅允许 darwin，而当前能力上下文、执行管理器和 UI 已支持 win32。该字段会误导模型能力判断，应与实际平台门禁保持一致。

此前独立复审已反驳“该字段直接阻止终端启动”的扩展断言；模型是否因此拒绝及真实 Windows 端到端表现尚未复现。修复不能据此宣称解决了全部 Windows 启动问题。

### P2：ACP 确认令牌调用未使用已有线程绑定能力

`l2-admission.ts:1893` 发令牌及 dispatcher 验证时未传入 `SecurityPolicy` 支持的 `threadId`。隔离策略实例中，改变 `__thread_id` 而保留相同 session 参数后验证仍为 true。

**这不是已证实的 L2 绕过。** 生产 server 会剥离调用方提供的 token，普通执行重新获得真实确认，ACP 强制确认也不会被 cruise 豁免。该项是绑定加固；不要把它与上一项已确认的无确认读／取消入口归属缺陷混为一谈。新协作派发必须绑定 owner、run、计划版本、逻辑任务及 attempt，避免新增同类歧义。

### 需随提取补实测的正确性问题

以下有源码证据，但本轮未全部独立动态复现，不与上述实证项混计：

- ACP manager 将累计 timeline 反复追加到 `agent_text`；正常 prompt 结束移除子进程句柄却未清理常驻服务；initialize 阶段存在尚未登记句柄的取消窗口。提取消息增量、onSpawn、取消栅栏及正常退出清理为一组，用真实合成 ACP 子进程验证。
- Browser `ensureAttached` 存在检查后 attach 的并发窗口及 SW 重启后的孤儿 debugger 恢复缺口。未合并修复由开放 Issue #567 承接；在当前实现重做去重、detach 栅栏及有界 settle，保留现有 `WAIT_PROBE_FAILED`。
- 目录选择取消／超时／自动化权限错误的反馈及返回聊天 UX 在旧 PR #537 上，相关 issue 的关闭不代表已交付。允许提取，但原生前台对话框行为仍需 macOS 实测。

## 能力缺口：与缺陷分开处理

新协作可靠性工作已由 Issue #590 承接。以下是现有边界与有限实现方向，不是声称现有代码违反了未定义的完整 DAG 契约。

1. **运行完成不等于业务验收。** `cooperation-result.ts:48–51` 将正常终局且有报告视为 completed；`board/service.ts:357–416` 的 tool_verified 证明工具调用来源可解析，不能证明结论真实性。独立验收应记录每项成功条件、来源版本、支持引用、缺失与分歧，标明编排者判断或实际验证器来源。
2. **结果快照不是可恢复执行。** `cooperation_tasks` 以 worker/session ID 为键，没有逻辑任务到当前 attempt 的持久绑定。LLM deferred queue 和完整工具结果镜像仅在内存。增加有界任务检查点，保存输入和成果引用、依赖、attempt 及故障；重启识别中断而不自动重放。
3. **故障替换必须仅补缺失工作。** 保留已验收兄弟任务，新的 attempt 沿现有确认派发；执行版本和来源版本同时校验。仍活跃的超时任务不能当成已死，默认 worker 工具含 click/type/evaluate，不能凭目标文字自称只读就允许自动重试。
4. **依赖和负载应影响就绪选择。** 当前依赖只检查 Intent done，专家选择偏文本匹配，FIFO 只负责容量。新计划就绪视图先检查依赖验收，再检查真实工具能力与当前负载；最终执行仍受现有槽位和创建预算约束。32 项计划上限不能被解释为突破每轮累计 20 个 worker 的预算。
5. **协作收益尚未测得。** 16 案例 Fleet eval 测“是否建议并行”，不执行任务。需用相同材料、模型和预算对比 solo／2 worker／4 worker，记录正确率、覆盖、矛盾、总 token、延迟、重复读取和故障恢复。确定性夹具可以验证指标管道，不能冒充真实模型收益实验。

候选方案的关键正确性门槛：确认中绑定不可变计划版本；并发派发先原子预留 attempt；回滚只撤销自己仍有效的预留；旧 attempt 在 Board 合并前拦截；验收拒绝更新中或过期来源；重复收集保留已有有效验收；暂停、取消、安全阻断跨重启不自动解锁。持久数据不构成权限或用户授权。

## 分支、worktree 与 stash 处置

原则是先保全外部 bundle／补丁／工作树独有内容，再删除 ref 或 worktree。不能仅凭 PR merged 标记认定内容已合入，也不能使用目录清理顺带删除未知未跟踪资料。

- **可删除的历史 ref**：祖先关系、`git cherry` 补丁等价或分支变更路径与已合入 squash 的逐文件内容比对已确认。其中 desktop-workbench 47 路径、knowledge 本地 60／远程 76 路径、meeting 101 路径、sidebar 26 路径、thread-management 162 路径、workspace-voice 65 路径与对应已合入 squash 一致。其他已确认补丁等价分支按清理清单删除本地及远程 ref。
- **旧 cooperation 实验**：产品实现已在主分支；核心 state/dependencies/supervision/thread-manager/adapter 与当前主分支相同，部分旧 Board/parser/占用逻辑落后。提取四份独有历史 cooperation 审计文档，并保留已有六份研究记录；不整体 cherry-pick 或覆盖现有文件。
- **`fix/528-529-site-op-osascript`**：先提取真正未交付的 attach 恢复、目录选择 UX、全局快捷键平台说明，再删除。528/529 已抽取部分不重复引入；旧 waitFor 不得覆盖主分支后续修复。
- **`origin/codex/windows-artifact-review`**：优先提取 ACP／WS 对端隔离与生命周期修复。终端租约恢复改变断连语义，Windows 启动与 MV3 验收另列；八个 local-review 模块是独立产品能力，不混入本轮合作可靠性修复。归档保留其完整独有历史。
- **`codex/desktop-identity`**：未接入 transport 的独立原型，历史评审 NOT_PASSED。外部归档其独有提交后删分支，不将未接线安全原语宣称为已交付能力。
- **`feat/tab-read-write-lease` 本地领先提交**：只有历史 memory／PROJECT_CONTEXT，产品已合入；归档，不覆盖当前交接记录。
- **stash0**：51 路径中 42 与既有主分支版本完全相同，其余 9 为更早合作及 prefill 迭代，没有确认独有产品修复；保全后可删，直接应用会回退现状。
- **stash1**：ignore 已在主分支，另一项是旧本机 host binary pin；保全后可删，不恢复过时构建哈希。
- **worktree**：失效注册可 prune；存在的 `.experiment/worktree` 先检查 tracked、untracked、ignored 及主分支占用，再撤销。未知媒体、工具设置和研究目录保留或明确归档，不当作代码垃圾删除。

## 分批实施与验收顺序

| 批次 | 范围 | 退出条件 |
|---|---|---|
| A：整理保全 | fetch、ref 内容核对、bundle／清单、历史资料提取、worktree／分支／stash 清理 | 有可恢复备份，所有独有工作有明确处置，主分支同步 |
| B：既有行为修复 | ACP 对端隔离、归属、子进程生命周期、平台能力，选定 Browser／目录选择修复 | 与生产路径关联的回归、宿主和 Linux arm64 测试、独立审查通过 |
| C：任务验收与恢复 | #590 的持久计划、attempt、确认绑定、收集／验收、就绪和恢复视图 | dispatch→collect→review→reload 的真实协议测试；旧路径兼容；安全对抗通过 |
| D：故障与收益证据 | 崩溃、父中断、迟到报告、部分成果保留、停止边界，solo／2／4 测量入口 | 故障结果和限制可复核；模型收益未运行则明确未测，不以 mock 结论替代 |
| E：交付 | Kimi 完整差异审查、必要独立对抗、CI、PR 合并及剩余分支清理 | 必需门禁全部通过，未通过项如实阻断相应交付，不修改门禁掩盖失败 |

实施报告需记录实际批次、提交及测试结果；本表不代表已有 PR 或合并完成。

## 已有验证与限制

此前针对拉取内容的 TypeScript 测试编译和 14 套件 160 项测试通过；不同镜头重复执行的测试不累加。它们不覆盖完整协作收益或全部原生故障。

目录选择与文案提取已有后续限定验证：Node 22 下 companion 测试编译通过，folder-picker 7 项通过、1 项 Windows 专属跳过；extension TypeScript、sidepanel hygiene 及 diff whitespace 检查通过。尚未实测原生 macOS 前台选择器。这组结果只覆盖四个提取文件，不可外推为整轮完成。

ACP null 对端与跨会话读取／取消、令牌默认绑定是隔离复现，未操作生产会话或配置。CI 的跨平台编译和 Linux arm64 容器也不能替代 Windows ConPTY、MV3 重连、macOS 图形交互验收。新实现应继续保留这些证据边界。
