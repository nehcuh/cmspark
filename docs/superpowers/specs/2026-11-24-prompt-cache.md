# 浏览器 Agent 的提示词缓存

GitHub: [#898](https://github.com/nehcuh/cmspark/issues/898)

同一会话在同一页继续调用工具时，前一个请求的系统指令、工具定义和消息历史应尽量保持相同。缓存按开头的连续内容匹配。Claude Code 团队曾因时间戳和工具顺序的变化丢失整段前缀。xAI 也指出，编辑旧消息会截断其后的复用范围。[Claude Code 工程实践](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/) · [xAI 多轮缓存](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/multi-turn)

## 请求如何变化

- 每轮仍向浏览器确认当前页面。采集时间保存在站点快照中。模型侧收到标签、地址、路径和导航标识，同页重读时这些字段稳定，真实导航会刷新页面及相关知识。
- 桌面选定标签的提示放在通用浏览器规则之后。MCP 工具按分配好的工具名排序，服务器断开后立即从可用集合移除。
- 在已识别的官方 xAI Chat 和本机 Magpie Grok Chat 上，同一线程使用稳定的不透明会话键。官方 Claude Messages 对话请求使用自动 5 分钟断点。供应商可以因长度、缓存过期或负载调度而仅命中部分内容。[xAI 缓存指南](https://docs.x.ai/developers/model-capabilities/text/best-practices) · [Anthropic 缓存指南](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Magpie v0.1.4685 的 Messages→Grok 路径依靠相同前缀。该版本的 Chat 请求可把正文中的缓存键传入 Grok 插件。CMspark 按原配置选择协议。[Magpie Chat 转换](https://github.com/yetone/magpie/blob/v0.1.4685/internal/gateway/chat.go#L132) · [Grok 插件](https://github.com/magpie-community/plugins/blob/9696b6f37a0d4afe1128d7fbe78f2613bacd8669/packages/grok/index.mjs#L1256)

## 按路由验收

在仓库根目录运行以下命令。传入指定日期的日志文件可以限定对照窗口；目录模式会读取其中的 Companion 日志及轮转文件。

```sh
node scripts/prompt-cache-report.mjs ~/.cmspark-agent/logs
```

用相同主机、协议、模型和请求类型比较发布前后的流量。有多个账户或上游时，用网关账本进一步核对。将每组的 `cached_input_tokens` 总数除以 `measured_input_tokens` 总数，得到按输入 token 加权的命中率。已知的零命中计入分母；缺少任一计数的请求进入 `unknown_requests`。全组未知或分母为零时，百分比为 `null`。同时检查覆盖数与样本量。

`chat.round_1` 表示一次聊天运行的第一次模型调用，包括同一旧会话中的新用户轮。`chat.round_2_plus` 是同次运行的工具续轮。标题和任务评估分别统计。缓存读写均已包含在规范化的总输入中，写入不算命中。旧版 Companion 日志只能配合网关读数恢复历史基线。

验证从三处取证：同页重读的系统提示字节一致且导航后变化；同一组数据、工具和固定历史的受控流式请求返回供应商读数；上线后观察同一路由正常流量的连续窗口，分别列出首轮和续轮。上线效果以最后一项为准。
