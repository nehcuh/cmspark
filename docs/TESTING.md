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

要求 **Node.js ≥ 22**（与 CONTRIBUTING / CI 一致）。

## Companion 测试地图

### 代码审阅与终端回传（#464）

- `companion/tests/code-review.test.ts`：来源范围、diff 行、持久化与容量、身份与引用、两类材料及过期/错 SHA。
- `companion/tests/pty-terminal.test.ts`：原任务/peer 绑定、确认竞态、输入编码、输出上限、报告确认与幂等历史回传。
- `chrome-extension/tests/terminal-relay.test.ts`、`terminal-wire.test.ts`：扩展页面/会话归属、断线和真实生产者帧格式。
- `chrome-extension/scripts/test-terminal-review-ui.py`：可选隔离 Chrome 测试，使用真实 React/xterm 和生产者录制帧；验证复制不输入命令、显式回传、面板布局及断线停止输入。
  先在扩展目录执行 `nvm use 22`，再执行 `uv run --no-project --with playwright python scripts/test-terminal-review-ui.py`。
  它使用本机 Chrome 和合成传输，不操作已安装扩展，也不证明真实企业网站/Agent 已验收。
- 语料记录脚本：`chrome-extension/scripts/record-code-diff-fixture.mjs`、`companion/scripts/record-terminal-review-fixture.cjs`。
  前者使用真实 Git diff 和 BrowserBridge 的合成 DOM，后者使用真实 handler 与合成 PTY；不能把这些语料作为企业试点结果。

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

## 工作区 UI/UX 回归（#469）

使用 Node22（先 `nvm use 22`）、本机 Chrome 与临时 Playwright 环境：

```sh
uv run --no-project --with playwright python chrome-extension/scripts/test-workspace-ui.py
uv run --no-project --with playwright python chrome-extension/scripts/test-terminal-review-ui.py
uv run --no-project --with playwright python companion/scripts/test-web-surfaces-ui.py
```

第一项运行真实 React App 和合成 Chrome/Companion 传输，覆盖宽窄断点、短屏、导航与确认/停止同时显示、历史键盘、设置定位、编程面板顶栏定位、长消息和离线。第二项使用真实 React/xterm 与录制协议帧。第三项提取实际 HTML 常量，只运行表现层（移除脚本、拦截网络），并断言非样式源码与基线一致。均不连接当前安装程序或企业账户。200% 等效 CSS 视口测试不是浏览器真实缩放或 WCAG 认证；Swift/Windows 原生窗口需平台验收。

## #471 设置与召唤器交互

在 `nvm use 22` 后，从仓库根运行 `uv run --no-project --with playwright python chrome-extension/scripts/test-settings-pages-ui.py` 与 `uv run --no-project --with playwright python companion/scripts/test-summoner-workspace-ui.py`。使用本机 Chrome headless、真实 React/HTML 和隔离传输，覆盖四档宽度、分类草稿与深链、语音迟到回调取消、隐藏快捷键录制、许可焦点隔离及召唤器输入操作顺序；不会改写已安装程序或真实配置。

## #473 对话管理

`uv run --no-project --with playwright python chrome-extension/scripts/test-thread-management-ui.py`（先 `nvm use 22`）验证真实 App 在320/390/759/760/1440宽度的创建/管理入口、手动分类保存与拒绝、AI标签保留、AI提取/规则整理/图谱调用，以及320短屏下停止/风险/确认优先级。运行时传输为隔离 fixture，不连接真实 Companion。后端 `thread-digest.test.ts` 验证分类字段通过真实路由写入、AI digest 替换后 reload 仍保留、非法输入拒绝；扩展 `thread-management.test.ts` 验证 ACK/错请求/未回显字段不构成保存成功。

Brand/tray (#474): `node chrome-extension/scripts/generate-icons.mjs` and `node companion/scripts/generate-tray-icons.mjs` generate shared-geometry assets. On macOS, `uv run --no-project --with pillow python companion/scripts/test-brand-rendering.py` renders the production Swift function offscreen and compares 18 size/color combinations to JS PNG output. It does not start the tray. `bash companion/src/tray/build-tray.sh` verifies native compilation. `tray-status-474.test.ts` exercises the actual compatibility menu shape and action map after the title/header removal.
