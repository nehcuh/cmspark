# #451 共享站点上下文交付与复审

用户 2026-09-07 明确同意改为 **Grok 4.6 + DeepSeek V4 Pro** 独立复审。此前称作 Claude 的报告来自 Claude Code CLI，但实际 modelUsage=deepseek-v4-pro；本记录修正模型身份，不抹除历史。CLI 版本不是模型身份。Grok R3 APPROVE，DeepSeek R3 APPROVE_WITH_NITS，快照文件哈希见 reviews/451-manifest.json。

## 用户可见行为

三个 Chat 入口接入共享上下文。每次模型请求刷新实际站点与当前知识选择，保留用户手动选择；导航成功后切换站点，失败/被拦截的工具不切换。目标不可用时不扩大为所有站点经验。知识预算沿用原引擎。历史经验与实时失败分离，七天 TTL、删除/过期/未知版本撤回，精确 origin 禁令不合并协议/端口/www。

内部元数据请求只读取指定标签页，参数由服务端调用选项准入，模型 JSON 无法启用。URL 去 userinfo/query/fragment 后输出；路由指纹使用浏览器内不可导出随机密钥 HMAC-SHA-256，避免普通哈希泄露低熵查询值。key 不持久化，worker 重启导致保守刷新。文档匹配仍用 canonical hostname；来源 URL 保留 pathname，不声称网页正文或路径绝无秘密。

## 修复与处置

- Grok 初审 BLOCK：目标不可用时 all-origin prompt。已修复；真实 Chat 测试断言初始/后续目标失效不注入经验。
- 两路初审 MAJOR：模型可伪造 __site_context_tab_id。已修复；真实 createToolExecutor + WS 测试证明调用参数被剥离，仅第五调用选项可以注入。
- Grok MAJOR：失败/未授权工具先切目标。已移到成功且 abort 检查之后；失败 tab=999 不改变上下文。
- DeepSeek MAJOR：普通导航 SHA256 可离线验证秘密猜测。改 HMAC；两端断言不等于普通 SHA256，路由变化仍可检测。
- DeepSeek MAJOR：旧 hostname 客户端兼容。明确保留知识 hint，但不能猜协议/端口恢复机器禁令；成功页面工具取得真实 tab 后恢复。真实 modern/legacy 双案例均验证恢复生产创建的经验文档。
- 缓存初始站点 NIT：getBySite 只产 site_knowledge；cached matcher 排除知识，真实 router 同款 resolveSkillIdsForThread 结果已用于测试。
- 旧经验文件/端口 NIT：W1 的 identity 真实历史回归已有覆盖，保持只读迁移，不能放宽外站点匹配。
- bridge catch NIT：executeInner 原有外层 catch 已存在；解析失败仍 fail closed。
- prompt 信任 NIT：经验文本显式数据围栏，机器执行器独立执法，页面 locator 不能注入可信指令。
- 预算 NIT：仅恢复实际注入的已选择经验文档，未注入不声称恢复；与用户选择/预算一致。
- 1.5 秒解析延迟/abort NIT：保留有界超时、无 stale cache；无 await 的入口检查与 listener 注册之间不扩大执行授权，最迟预算回收。选中 tab 是当前对话目标，不跟随全局焦点变化。
- 通配提示 NIT：已改成 all page tools。测试变量命名/源锁标记为非阻断，保留对应真实行为测试。

## 机器证据

Node 22.23.2。完整 Companion 4949 项，4926 通过、23 跳过、0 失败，另 settings 20/20；最终 HMAC/modern+legacy/实际执行器定向 27/27；扩展相关 25/25，两端构建通过。完整测试计数包含并行开发中的独立证据基础测试，不冒充企业验收。提交只包含本票冻结快照；后续 #452 页面提取、#453 证据和双 Pack/MCP 仍是独立票。

两个真实企业场景、跨模型/操作系统试点、0.7.0 发版换装未完成，不由这些单测替代。
