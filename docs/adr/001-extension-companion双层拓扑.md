# ADR-001: 双层拓扑 Extension-Companion

**日期**: 2026-05-24 | **状态**: 已确认

## 背景

CMspark 需要在 Chrome 浏览器内操控标签页、读取页面内容、管理 Cookie，同时需要调用 LLM API（DeepSeek/GPT）并管理对话状态、技能系统、操作历史。

## 决策

采用双层拓扑：**Chrome Extension (Plasmo + React) ↔ WebSocket ↔ Companion (Node.js + TypeScript)**。

Extension 只负责浏览器操作（CDP/tabs/cookies/scripting），Companion 只负责 LLM 推理和状态管理。两者通过 WebSocket 通信。

## 权衡

### 优势

- **职责分离清晰**：浏览器权限代码与 LLM 业务逻辑完全解耦
- **Extension 轻量化**：不受 MV3 Service Worker 内存和生命周期限制
- **LLM 灵活性**：Companion 可以独立升级 LLM 适配器，不依赖 Extension 更新周期
- **调试便利**：两个进程可以独立调试，日志分离

### 劣势

- **部署复杂度**：用户需要同时运行两个进程
- **连接依赖**：WebSocket 断开时功能不可用
- **状态同步**：配置（`chrome.storage.local` vs `config.json`）存在双写不一致风险

## 替代方案

**单体 Extension 方案**：LLM 调用直接在 Service Worker 中完成。被否决，因为 MV3 Service Worker 有 30 秒超时和内存限制，不适合长时间 streaming 和 tool calling 循环。

**HTTP REST 方案**：用 HTTP 代替 WebSocket。被否决，因为 tool calling 需要双向实时通信（streaming token + tool.execute + tool.result），HTTP 不支持服务端主动推送。

## 后果

- WebSocket 协议需要维护自定义消息格式
- 固定端口 23401 可能在多实例场景冲突
- 未来如果要支持远程 Companion（非 localhost），需要引入认证机制
