# TESTING

> 与产品 **0.5.0** 对齐（2026-08-09 体检后刷新）。框架均为 Node 内置 `node:test` + `node:assert/strict`（无 Jest/Vitest）。

## 测试架构

| 端 | 测试框架 | 测试目录 | 规模（约） | 运行命令 |
|----|---------|---------|-----------|---------|
| Companion | `node:test` | `companion/tests/`（含 `security/`、`integration/` 子目录） | **~186** `*.test.ts` | `npm --prefix companion test` |
| Extension | `node:test` | `chrome-extension/tests/` | **~66** 纯逻辑测试 | `npm --prefix chrome-extension test` |

- Companion 编译：`companion/tsconfig.test.json`（`outDir: .test-dist`）
- Extension 编译：`chrome-extension/tsconfig.test.json`
- Companion 的 `test` 脚本会排除 `_*.test.js` 辅助文件，并将 `settings-web.test.js` 单独串行跑（避免端口争用）

## 运行测试

```bash
# 全部（Makefile）
make test

# Companion（全部）
npm --prefix companion test

# Companion（单文件：先 tsc 再 node --test）
cd companion && npx tsc -p tsconfig.test.json \
  && node --test .test-dist/tests/security-thread.test.js

# 子目录示例（编译产物路径镜像源码树）
cd companion && npx tsc -p tsconfig.test.json \
  && node --test .test-dist/tests/security/*.test.js
cd companion && npx tsc -p tsconfig.test.json \
  && node --test .test-dist/tests/integration/*.test.js

# Extension
npm --prefix chrome-extension test
```

要求 **Node.js ≥ 20**（与 CONTRIBUTING / CI 一致）。

## Companion 测试地图

路径均相对 `companion/tests/`。文件名随实现演进；下列按**领域**分组，便于找回归入口。

### 安全与确认 / 策略

| 区域 | 代表文件 |
|------|----------|
| 线程 + 安全策略回归 | `security-thread.test.ts` |
| L2 确认队列 / origin / 广播 | `security-confirmation-origin.test.ts`, `security-confirmation-broadcast.test.ts` |
| 策略 HMAC / token（`security/`） | `security/security-policy.test.ts`（该目录目前仅此文件；`security/*.test.js` 示例只覆盖 policy） |
| 门禁与 evaluate token（`integration/`） | `integration/security-gates.test.ts`, `integration/evaluate-token.test.ts` |
| 配置路由安全 | `message-router-config-security.test.ts` |
| 越狱扫描 / 不可信标记 | `llm-stream-jailbreak-scan.test.ts`, `m2-untrusted-marker.test.ts` |
| 内容清洗 | `content-sanitizer.test.ts`, `text-sanitize.test.ts` |
| 会话信任 / 企业信任 | `session-trust-v4.test.ts`, `enterprise-session-trust.test.ts` |
| App 启动门（`integration/`） | `integration/app-launch-gate.test.ts` |

### 集成 / WS / 守护

| 区域 | 代表文件 |
|------|----------|
| WS 鉴权握手 / origin | `integration/ws-auth-handshake.test.ts`, `integration/ws-origin-handshake.test.ts`, `ws-auth-paired-marker.test.ts`, `ws-origin.test.ts` |
| 往返与锁 | `integration/ws-roundtrip.test.ts`, `integration/server-lock.test.ts` |
| Daemon CLI | `integration/daemon-cli.test.ts`, `daemon.test.ts` |
| 健康检查 | `healthz.test.ts` |
| 崩溃 / abort 孤儿 | `crash-handlers.test.ts`, `m10-abort-orphans.test.ts` |
| 托盘配对 / Swift 完整性 | `tray-pairing.test.ts`, `swift-tray-integrity.test.ts` |

### Computer Use

大量 `computer-*.test.ts`：policy、executor、session-trust、estop、evidence、preview、coords、danger、rate-limit、self-ui、locate-chain、UIA、Windows adapters、Darwin 注入/前台/降级 capture，以及 TinyClick（tokenizer / preprocess / locator / runtime / session / golden-eval）与 model 管线（manifest / download / admission / license / handlers / states）。

### Host Use / Apps

| 区域 | 代表文件 |
|------|----------|
| Host 黑名单 / adapter / nonce / Hello | `host-use-blacklist.test.ts`, `host-use-darwin-*.test.ts`, `host-use-win-*.test.ts`, `host-use-linux-nonce.test.ts` |
| Apps | `apps-*.test.ts`（handlers / launch / guards / biometric-gate / config / …） |

### Mission Pack / Capability / Netsec

| 区域 | 代表文件 |
|------|----------|
| Pack 引擎 / 校验 / 审计 | `packs-engine.test.ts`, `packs-validator.test.ts`, `packs-audit-log.test.ts`, `thread-pack-patch.test.ts` |
| Workspace / shell·netsec 能力 | `capability-workspace.test.ts`, `capability-shell-netsec.test.ts` |
| Netsec scope | `netsec-scope.test.ts` |

### Mission Board / Orchestrator

| 区域 | 代表文件 |
|------|----------|
| Board schema / service / handback / complete / intent | `board-schema.test.ts`, `board-service.test.ts`, `board-collect-handback.test.ts`, `board-complete.test.ts`, `board-intent-claim.test.ts` |
| 多 Agent | `orchestrator-tab-lease.test.ts`, `orchestrator-l2-flight.test.ts` |

### MCP

| 区域 | 代表文件 |
|------|----------|
| 管理器 / 确认缓存 / 错误提示 | `mcp.test.ts`, `mcp-manager.test.ts`, `mcp-confirm-cache.test.ts`, `mcp-error-hints.test.ts` |
| 能力门（`integration/`） | `integration/mcp-capability-gate.test.ts`, `integration/mcp-meta-tool-gate.test.ts` |

### Obsidian / 导出 / 线程 / LLM / Skills

| 区域 | 代表文件 |
|------|----------|
| Vault 档案 / 索引 / 模板 | `vault-profiler.test.ts`, `vault-index.test.ts`, `vault-templates.test.ts` |
| 导出合成 / 摘要 | `obsidian-export-compose.test.ts`, `obsidian-summary-compose.test.ts`, `markdown-export.test.ts`, `summary-export.test.ts`, `message-router-summary.test.ts` |
| 线程 / 历史 | `thread-manager-lock.test.ts`, `threads-history.test.ts`, `history.test.ts` |
| LLM adapter | `adapter.test.ts`, `adapter-recovery.test.ts`, `adapter-usage.test.ts` |
| Skills | `skill-engine.test.ts`, `skills.test.ts`, `site-matcher.test.ts` |
| Bridge / schemas | `bridge.test.ts`, `tool-schemas.test.ts` |
| 配置 / 日志 | `config.test.ts`, `config-broadcast-redact.test.ts`, `logger-redact.test.ts`, `log-rotation.test.ts` |
| 文件解析 | `file-parser.test.ts` |
| HUD（实验） | `hud-protocol.test.ts`, `hud-shell-router.test.ts`, `hud-spike.test.ts` |
| 设置 Web | `settings-web.test.ts`（串行） |

> **已删除/不存在**：历史上文档曾引用的 `server.test.ts` — **无此文件**；服务端行为覆盖分散在 `security/`（policy）、`integration/`（WS/门禁/MCP gate）、`message-router-*`、`bridge` 等领域测试中。

## Extension 测试地图

路径相对 `chrome-extension/tests/`。**只测纯逻辑**（reducer、工具函数、选择器解析），不挂载 React 组件树。

| 区域 | 代表文件 |
|------|----------|
| Side Panel 状态 | `sidepanel-state.test.ts`, `sidepanel-state-security.test.ts`, `stream-thread-gate.test.ts` |
| 模式 / UI 契约 | `mode-controller.test.ts`, `ui-mode-acceptance.test.ts`, `tokens-helpers.test.ts` |
| 安全确认转发 / sanitizer | `security-confirmation-forward.test.ts`, `page-sanitizer.test.ts`, `dangerous-apis.test.ts` |
| Tab / 活动 hostname | `tab-queue.test.ts`, `active-tab-hostname.test.ts` |
| Context / 模型切换 | `context-strip-logic.test.ts`, `model-switch-logic.test.ts` |
| Computer 镜像状态 | `computer-task-state.test.ts`, `computer-model-state.test.ts` |
| Cockpit / Apps 面板逻辑 | `cockpit-window-logic.test.ts`, `apps-panel-logic.test.ts` |
| NotebookLM | `notebooklm-extractor.test.ts`, `notebooklm-markdown-builder.test.ts`, `notebooklm-selectors.test.ts`, `notebooklm-v12-modules.test.ts` |
| 其它 | `background-notifications.test.ts`, `image-extract-utils.test.ts`, `selector-js-literal.test.ts`, `use-modal-dialog.test.ts` |

## 新增测试

### Companion

1. 在 `companion/tests/`（或 `security/`、`integration/`）创建 `your-module.test.ts`
2. 使用 `node:test` 的 `test()` / `describe()` 与 `node:assert/strict`
3. 需要临时目录时参考既有 `fs.mkdtempSync` + `process.env.HOME` 模式（见 adapter / security 套件）
4. 动态 `import("../src/…")` 加载源码（编译后路径由 tsc 映射）
5. 共享 setup 可用 `_*-setup.ts`（不会被 `node --test` 主 glob 直接当用例跑）

### Extension

1. 在 `chrome-extension/tests/` 创建测试文件
2. 只测纯函数与可注入依赖的逻辑；不测完整 React 渲染
3. Store 相关导入 `agentStore` 的 reducer / initialState

## 测试原则

- **纯函数优先**：可独立调用的函数（分类错误、序列化、schema 校验、坐标换算）
- **边界覆盖**：happy-path + 空/非法输入 + 超时/拒绝路径
- **安全路径必测**：L2 token、白名单、trust 盖章、能力门、WS auth
- **不测 UI 外观**：React 组件视觉靠手工 / QA
- **不测真实外部 LLM API**：adapter 测 context 组装与恢复逻辑；外部调用 mock 或跳过
- **不测未声明的 E2E 浏览器**：CDP 真浏览器 E2E 不在默认 `npm test` 内

---

*文档重梳 Phase 1（2026-07-28）：按 0.3.0 代码树重写测试地图；移除过时 `server.test.ts` 引用。*
