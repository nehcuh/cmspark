# 模型思考强度

GitHub: #789

## 目标

插件的「模型与推理」提供低、中、高、极高四档；初始和旧配置均为中等。设置应在 Companion 持久化、广播和扩展重启后恢复；它影响真实模型请求，不控制思考内容是否显示。设置不改变默认模型、API 密钥或用户 live 配置。

## 能力与真实协议

不同服务的参数及可用档位不同，不能仅凭 OpenAI 兼容协议假设支持。首期仅对明确识别的官方端点和已核对模型发送参数；其他端点/模型保留选择但明确提示无法确认生效，不发送未知参数。服务端同样实施检查，不能依赖界面。用户切换模型后无需丢失偏好。

- DeepSeek 官方 Chat Completions，`deepseek-flash` / `deepseek-v4-pro`，以及官方临时兼容别名 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`：低=`low`，中=`high`，高=`high`，极高=`max`；界面明确中、高映射相同。该服务官方只有 low/high/max，不能虚构四个不同等级。[官方参数](https://api-docs.deepseek.com/api/create-chat-completion/)。
- Anthropic 官方 Messages，对确定支持 effort 的 `claude-sonnet-4-6`、`claude-opus-4-6`、`claude-opus-4-7`：前三档对应 low/medium/high；极高在 4.6 对应 max，在 opus 4.7 对应 xhigh。请求字段 `output_config.effort`；不额外伪造 thinking 开关。[官方文档](https://platform.claude.com/docs/en/build-with-claude/effort)。
- 明确支持四档的 OpenAI 官方 Chat Completions 模型 `gpt-5.2` / `gpt-5.2-2025-12-11` 使用 `reasoning_effort`；四档均为推理模式，须省略不兼容的 `temperature` 并使用 `max_completion_tokens`。型号或档位无法确认时，不发送参数并提示用户。其他兼容服务，包括自定义中继和旧模型，维持原请求，不声称支持。

仅对匹配的官方 HTTPS 域名与协议启用；不因恶意后缀域、用户信息、HTTP 或相似模型名误判为官方服务。模型别名支持须可证，不因前缀碰撞误接入。支持模型与映射集中定义，界面提示和运行时共用或等价验证，不能对用户产生不一致的承诺。

## 配置与运行时契约

- 四值 `low|medium|high|xhigh`，旧值缺失读取为 `medium`；显式非法值在设置入口拒绝，不写盘；磁盘损坏/旧数据不可使请求发任意值。
- 覆盖扩展设置、扁平 config.set、嵌套 config.set、config.updated、扩展重启镜像、聊天和相同 provider 的 complete 请求；真实额外配置路径逐一核查。仅受信任的用户配置生效，不让模型输出覆盖全局设置。
- 保留现有 API Key 脱敏与配置写入门禁；不在测试中读写 live 配置。不能因为探测兼容而重复发送请求或静默重试。
- 连接测试必须清楚区分连接成功与强度是否被支持，不声称通过探测证明所有模型均生效。

## 验收

- UI 四档、默认/切换/保存/重启、provider/model 更改与不支持提示；原有密钥脱敏、配置及自动授权行为不变。
- 实际构造的 stream 和 complete 请求：逐档精确 wire 参数，带非官方域、相似域名、旧模型、错误档位等负例；DeepSeek 中/高等价提示、Anthropic 4.6 max 与 4.7 xhigh 差异。
- 真实配置入口和读取生产链路上使用隔离配置测试，验证旧配置回退、非法输入不写盘、密钥不泄露。
- 在受影响范围完成 TypeScript/build、惰性 CPU 测试、两路非作者复审和正式 CI；本机不做真实服务调用或原生 GUI 测试。

## 不在范围

不新增模型供应商的猜测性协议、不承诺自定义网关自动支持、不改变显示推理内容设置、无降级隐藏失败或重试。#788 的 Windows 间歇性问题和主线发布仍按各自门禁推进。
