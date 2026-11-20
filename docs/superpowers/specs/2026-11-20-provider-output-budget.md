# 外部模型输出预算和截断提示

GitHub: #872

主聊天允许设置单次输出上限，留空使用自动值。旧配置里的有效数值仍是用户的上限。自动模式对有确切能力的官方模型按实际思考强度选择预算。其他模型和兼容网关沿用至多 32,768 token 的策略。模型上下文、用户配置和输出限制同时生效。

OpenAI 官方 GPT-5.2 用 `max_completion_tokens`，DeepSeek 和 Anthropic 用 `max_tokens`。继续使用现有区分协议与模型的思考强度映射。官方 Claude Opus 4.7 请求省略不支持的采样温度。按厂商文档维护能力常量，不把名称相似的第三方网关视为官方。主聊天的上下文压缩为已知模型预留当前请求的输出预算，视觉等专用调用保留自己的限制。

界面区分输出预算耗尽、已到上下文上限和无法细分的长度限制。继续保存已返回的正文与思考。发生在本轮的截断工具批次没有执行资格。自动模式只在当前尚未执行的批次且下一请求确有变化时恢复一次，不重放已执行的工具。已完成的普通工具回合不显示截断提示。

- [OpenAI GPT-5.2 能力](https://developers.openai.com/api/docs/models/gpt-5.2) · [Chat Completions 停止原因](https://developers.openai.com/api/reference/resources/chat)
- [DeepSeek 模型能力](https://api-docs.deepseek.com/quick_start/pricing/) · [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Claude 模型能力](https://platform.claude.com/docs/en/models/overview) · [停止原因](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
