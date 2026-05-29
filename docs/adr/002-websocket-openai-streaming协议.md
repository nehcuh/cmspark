# ADR-002: WebSocket + OpenAI-compatible Streaming 协议

**日期**: 2026-05-24 | **状态**: 已确认

## 背景

Extension 和 Companion 之间需要一种双向实时通信协议来支持：LLM streaming token 的实时渲染、tool call 的异步执行和结果回传、线程/技能/配置的管理命令。

## 决策

采用 **WebSocket + JSON 消息** 协议，兼容 OpenAI streaming 的流式事件模型。

消息分为三类：
- **Chat 流**：`chat.create` → streaming `chat.token` + `tool.start` → `tool.execute` → `tool.result` → LLM 继续 → `chat.done`
- **管理**：`config.get/set`、`skill.list/import/export`、`thread.create/delete/list`
- **系统**：`system.ping/pong` 心跳

LLM streaming 使用 OpenAI SDK 原生 `stream: true`，Companion 逐 chunk 转发 token 到 Extension。

## 权衡

### 优势

- **双向实时**：支持服务端主动推送（tool.execute、chat.token）
- **异步工具回路**：Promise bridge 模式，Extension 执行工具后通过 `tool.result` 消息 resolve
- **协议可扩展**：新增消息类型无需改协议框架

### 劣势

- **重连时状态丢失**：正在执行的 tool call 的 Promise 会在断连时 resolve 为 error
- **没有消息 ID 去重**：网络抖动可能导致消息重复投递

## 替代方案

**Server-Sent Events (SSE)**：只支持服务端→客户端单向。无法用于 tool.execute 的下行指令。

**gRPC**：双向流支持好，但浏览器 Extension 中 gRPC-web 支持有限，增加构建复杂度。

## 后果

- 需要自定义消息格式的文档（当前隐式在 `message-router.ts` 中）
- 心跳间隔固定 20 秒，不可配置
- 没有二进制消息支持（如大截图），全部 base64 编码
