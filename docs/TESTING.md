# TESTING

> 与产品 **0.5.0** 对齐（2026-08-09 体检后刷新）。框架均为 Node 内置 `node:test` + `node:assert/strict`（无 Jest/Vitest）。

## 测试架构

### #731 shell 输出编码

`companion/tests/shell-output-encoding-731.test.ts` 由原 canonical 测试入口发现，运行实际 `shell.ts` 模块与受控 child pipe 字节。覆盖中文／emoji 的所有单个拆分位置、stderr、结束残片、固定 CP936 字节、含 NUL 的混合输出、进度／输出上限、退出码、停止／超时及原模块／allowlist 拒绝。测试使用内存 spawn、虚拟时钟和 owned UTF-8 文件，不启动 cmd、PowerShell 或真实子 shell。

有效 UTF-8 优先；没有真实编码声明时不推断 ACP／GBK。非法 UTF-8、含 NUL 或 Windows 非 ASCII 命令经 shell 转换后的非空输出，既有 `note` 和相应进度尾部包含 `OUTPUT_ENCODING_UNDETERMINED`；正文可能有替换字符，不能据此判断文件损坏。这不是自动 GBK 转码。真实 Windows 上 `echo 中文`、`type` UTF-8 文件及 GBK-only 程序的输出仍需原生验收；CPU seam 不冒充平台通过。确认／沙箱、命令／环境、退出码、取消、超时及原输出预算均不改变。

`shell-encoding-windows-native-731.test.ts` 仅非 Windows skip；Windows 必须先通过 GHA 和 canonical preload owned 目录身份／边界核验，否则在导入应用或 spawn 前失败。原 runner 自动发现，无新增 CI 参数。测试通过实际 `shellExec` 跑固定 `echo`、owned UTF-8 文件的 `type` 和当前 Node.exe 的固定 CP936 字节 emitter；`type` 必须精确且无警告，`echo` 必须有实际不可判定标记（即使 pipe 字节本身为有效 UTF-8，也不能证明命令到控制台的转换无损），CP936 两流必须明确标注。只保存／恢复 test-owned 配置并检查并发变更，等待自有命令结束后清理；不改 HOME、系统代码页或原 60 秒默认时限。Mac/Linux skip 与源码编译不代表此 Windows 验收已通过。

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

要求 **Node.js ≥ 22.19.0**（Office 引擎最低要求；与 CONTRIBUTING 一致，发行 runtime 为 22.23.2）。

## Companion 测试地图

### 代码审阅与终端回传（#464）

- GitHub 完整 SHA 双点比较：`companion/tests/github-comparison-464.test.ts` 与 `chrome-extension/tests/github-comparison-464.test.ts` 执行生产 serialized snapshot→有界观察→真实 capture/store/service 的受控正负链，Windows compiled 布局仍读取源 CJS；离线 HTTP DOM 不冒真实浏览器。PR711 head6b1f52a5 / CI39189613843 的固定公开比较有真实 Chromium 11case，后续093启动/清理红原因 UNKNOWN、原分支保留。该测试专用 harness/worker/workflow 不在本产品叶，现 main 全部4job、650/native/security门原样；新产品head+main全部CI仍必需，whole464仍Partial、0.6.14仍开发版。

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


## #571 hosted AX 原生失败观测

`companion/scripts/build-ax-native-571.mjs` 仅给未发布的原生验收 host 加 `CMSPARK_AX571_DIAGNOSTICS` 编译条件；普通 host 的 locate JSON 形状不变。同次 locate 结果只附固定 `ax571Reason`，区分 CG/AX 绑定拒绝、完整复核变化与遍历未找到，不输出标题、窗口 ID、几何或任意异常。日志里的固定阶段不是唯一系统根因，也不是动作成功回执。

owned 夹具用现有两次 CG 读取，记录首次/第二次 target、sibling 绑定的八种有限理由和原 stable 布尔值到私有 `ready.json.binding`。父测试只接纳同一 0700 目录、当前用户的 0600 单链接普通文件；长度至多512字节，禁止符号链接，读取前后复核身份与稳定性。缺失、模式不符、字段非法或写入/读取异常仅丢弃观测，原 locate 断言、ready 条件、20秒期限、E-Stop 与后台效果/焦点/光标/z-order 和 owned 清理继续原样生效。

现有 MJS 入口用有界惯性 seams 验证这些路径，不运行 Swift/AppKit 或证明真实原生成功。真实 macOS 编译、AppKit 必需动作及全部生命周期仍必须通过 hosted 原生步骤；WK 仅精确已知 Gap 可经 fresh zero-effect/同轮四 oracle 验收，正常已定位动作仍走原路线。组件绿、日志字段或受控测试不能替代它。不要在用户桌面启动此夹具。


### #571 traversal failure observation

The unshipped acceptance host built with `CMSPARK_AX571_DIAGNOSTICS` may attach `ax571Traversal` only to a `found:false`/`TREE_EXHAUSTED` locate result. The parent emits `AX571_TRAVERSAL` with schema 1, nine fixed booleans, depth 0..50 and `EMPTY_FRONTIER`/`DEPTH_LIMIT`, or null for invalid/unknown observation. Flags describe branches encountered anywhere during that one call, not the properties of a particular node or the historical WK cause. They contain no names, roles, titles, IDs, PIDs, paths, frames or error text. Shipping serialization and all existing AX/CG calls, hidden/size/name/children/depth decisions and strict native assertions remain unchanged. The canonical `ax-native-571.test.mjs` entry statically imports the source-derived traversal controls; CPU projection is not a Swift SDK/native result. True hosted Mac validation remains required.


### #571 已知 WK Gap 与原始最低 DoD

原票允许每行 Delivered/Refused/Gap，只要求至少一条真实后台动作。d66 head `d66da90e92f99c439cdd98280733e34c7499e6b1` / CI39166888090 的 AppKit press 已有 target effect 与完整 oracle；同轮 WK 在 locate 前置后因 TREE_EXHAUSTED 失败，缺 after-oracle，原2P1F历史保留。

新分支仅接受 WK 的 own foundfalse、确切 TREE_EXHAUSTED 与完整有效 traversal EMPTY_FRONTIER/depth<50。安全/当前 owned binding/initial sibling/estop 后，必须 fresh after snapshot、同一严格全 z-order/focus/cursor/derived noLeak 比较，双 marker 不存在及原 finally owner-close/lease 清理；不执行动作，不制造 Refused/unsupported 码。其它拒绝/未知/null/畸形/permission/timeout/cancel/DEPTH_LIMIT 仍硬失败；原 AppKit 与正常 WK action/role-negative、至少一条 Delivered 均保留。新 head 全部原生/CI 门尚待真实通过，不把 CPU 或旧 AppKit 证据当新 WK 动作成功。TCC责任归因仍 UNKNOWN、generic executor Mac AX 接线残余不变。


## #476 原生永久归档

永久受控测试位于 `desktop-thread-archive-store-476.test.ts`、`desktop-thread-archive-channel-476.test.ts` 和 `desktop-archive-renderer-476.test.ts`。它们使用真实 canonical ThreadManager、HMAC/channel 和 DOM 代码，验证 peer archive／restore-null 保留、旧无归档字段重复索引兼容、自动清理保护、目标／状态版本／活动／断连拒绝，以及 rename 已提交但回执丢失时的 SAVE_UNCONFIRMED。未知归档索引仍拒绝写入，不为普通旧重复行兼容放开 archive snapshot／commit。

真正的平台验收沿用现有 `desktop-native-thread-metadata-476.test.ts` 的 OS／surface lease／清理链，新增 `#476 actual native permanent archive history restore and lost ACK use the canonical index`。Windows/macOS 必须真实编译并运行该回调：实际 owned 窗口键盘、归档视图、原历史、恢复、忙碌拒绝及真实保存 ACK 丢失。成功需要十次键盘动作、三次真实提交及专属离线终态76；普通退出0不算通过。Linux 的平台 skip 不算原生成功。原20秒预算、原测试列表和权限门不放宽，不在用户桌面启动验收窗口。

当前桌面协议v8的方法表、launcher、两 host、builder 和原 fixture 消费者必须一致；固定三段 read 例外仅 archive.list／archive.state／browser.status／browser.tasks 四条，不开放通用桌面 RPC。原spec及实施计划见 [归档合同](superpowers/specs/2026-10-19-desktop-thread-archive-476.md)／[计划](superpowers/plans/2026-10-19-desktop-thread-archive-476.md)。


## #476 浏览器任务纵向切片

`desktop-browser-task-476.test.ts` 使用 stock renderer、真实 HMAC/channel、canonical run 注册、真实 adapter 和 ThreadManager 保存／reload，配合受控 provider／Chrome API 接口，验证选择不是执行、15秒内绑定后模型延迟不续期／不丢同一运行限制、精确 peer/tab 和零背景激活。实际工厂与原 pending-map／BrowserBridge 的 CDP／scripting 读取闭包另核，不能把受控 API 当浏览器证据。永久负控覆盖同名／错 peer、旧 ACK、A/B/A、失权、导航观察、错误租约、已有确认、64容量与取消后挂起调用。

本批源验证不启动真实浏览器或本机原生 host。后续精确 head 的 Windows/macOS native 与真实已认证扩展证据仍为验收门，旧归档／MCP／资源／对话原生回调也必须保留；没有为本片伪造新 native PASS 或改变原预算、测试列表和平台 skip。背景读取不允许 image phase1／phase2 或 unknown 分支绕过矩阵；非 native 路径保留原语义。方法表实际 v8/read11/renderer25/native27，controller-only retire 与 confirmation 决策均不进 renderer 表。
