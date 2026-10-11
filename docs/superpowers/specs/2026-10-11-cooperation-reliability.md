# 可验收协作与受控恢复

GitHub: #590 · 基线 9429ec61 · 2026-10-11

沿用单 Companion 的 Supervisor + Blackboard，不实现分布式调度。新增父线程的有界不可变任务计划（最多 32 项）、依赖和成功条件；计划标识进入既有 spawn_worker 确认绑定。每个逻辑任务最多三次执行，实际派发仍受每轮 20 次创建和 5 个占用上限约束。任务计划本身不授予执行权。

首次启动和替换均经原 L2。同步提交 attempt 与 worker 绑定后才能 kick；最终绑定再次核验依赖、活性、权限与预算，阻止两个确认并发重复派发。失败回滚不能撤销另一 attempt。计划不允许同一 run 内改写目标或重置预算。任务必需能力须在实际 worker whitelist 内，任务文本不能自证只读。

检查点保存输入引用、目标、条件、attempt、有限结果和验收，不保存完整工具正文。每次进程启动有独立标记；重启后未终结 attempt 明确显示 interrupted，保留已验收成果。读任务也不自动重放；写操作、未知操作始终要求新确认。暂停、用户取消、安全阻断不得作为可自动替换故障。迟到的旧 attempt 在 Board merge 前拒绝。

验收与 runtime completed 分开。父线程按条件提交判断、理由和存在的 source/evidence/artifact 引用，并列出矛盾。验证器只证明引用存在和条件覆盖，不证明语义真值；结果标为 orchestrator_reviewed。缺项、失败项或未解决矛盾不放行下游；已有通过条件保留，替换时提供缺失部分。验收需匹配当前 attempt/source.version 且 worker 已终结。

cooperation_status 展示任务、blocked 原因、ready 顺序、恢复动作、剩余 attempt 与容量；board_read/wait_workers 同步呈现。ready 只表示可请求派发，不自动启动。browser 计划执行接入 spawn_worker；ACP 继续走自身会话确认，并在同一状态视图展示结果、取消、失效和原文可用性，禁止跨父线程读写。

能力声明（T3）：Surface 为父线程三个 cooperation 工具和既有派发/收集；L2 类不变；Compose 为依赖→确认→attempt→收集→验收；Autonomy 无自动派发/副作用重放；Trust 保持 HARD_DENY、plan_readonly、owner/run/token；Channel 为现有 browser/ACP。

验收：真实 dispatch 测试、重启重载、双派发、旧结果隔离、错误/缺证据/矛盾、依赖循环、跨 owner 拒绝、有限补做与终局停机；单/2/4 的确定性故障实验只报告调度与恢复指标，真实模型质量评估独立输入可核验记录。机器检查→独立对抗→Pi，另 Kimi 和 arm64 容器；CI 绿后合并。
