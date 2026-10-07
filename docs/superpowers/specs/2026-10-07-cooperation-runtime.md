# 协作结果与状态内核

GitHub: #577 — https://github.com/nehcuh/cmspark/issues/577

基于 #576 的已批准任务监督。采用 coordinator + deterministic state + shared board，保留浏览器和 ACP 的执行与权限边界。

三轮实现与冻结验收：

1. 真实 collect_handback / acp_collect_result 添加统一 task_result：真实状态、≤1200 字符的可标识截断摘录、原始消息/会话引用、来源与信任、缺口、恢复建议。工具 success 不推导任务 completed；外部正文不能改变权限或证据信任。ACP 捕获真实 terminal kind，Mode C 监视结束不表示外部终端完成。
2. 父线程持久化有界任务状态（最多 64 项）；同版本幂等、所有者检查、失效 ACP 标为 stale。恢复预算按不同失败版本计数，上限 2，建议不执行自动重启。MissionBoard intent 可声明依赖，依赖缺失/未完成/循环时不得认领；原有无依赖 intent 行为保持。
3. 父线程模型上下文投影只保留一次有限结果和原文引用；UI/原始消息仍可查看原文；既有 collect 工具支持 report_offset / report_limit 的显式片段读取（默认 2000，最多 4000），返回 next_offset/has_more。普通 finish 监督先展示异常，再重新取得并发槽；失败时用户仍能看到已收集任务状态。浏览器与 ACP 在 collection/状态读取阶段共用协议，不自动接管会话或改变取消/启动语义。

实验评估在项目根 .experiment/evaluate.cjs（元数据不进入 worktree commit）。固定 30 项行为检查，三个维度各 10 分，权重 0.4/0.35/0.25；基线为现有授权工作树快照。分数只代表该验收集覆盖，不推断泛化效果。每轮先预测→修改→commit→测试/评估→归因→keep/discard，共 3 轮。

原文片段读取当前最新报告，不支持用历史 source.message_id 固定旧报告。分页时必须比较每次返回的 source/version；来源变化后从新报告重新分页，避免拼接两个版本。浏览器历史原文仍保存在消息记录中，ACP 原文只保证当前会话生命周期内可用。

不实现任意 DAG 自动调度、跨重启继续进程、自动批准、任意工具副作用重试或角色/模型无限嵌套。暂停/取消/安全终止均需原确认流程恢复。无 live config 修改。T2：仅结果、状态、依赖认领及模型数据投影；原 L2 / HARD_DENY / ACL / 证据验证不变。
