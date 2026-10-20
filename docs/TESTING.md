# TESTING

### #723 固定构建前置正控

Windows 原 Node 标量九项之后、Registry 和完整 census 之前，运行独立的固定桥接构建验证。它调用原 PS5.1 build-only 脚本，使用与注册路径相同的最小 child environment 和编译参数，要求真实 child close/exit0、普通自有产物和匹配的 SHA256 文件。编译器的公开源码输出直接进入 CI 两个流，不被嵌套调用的 `Out-Null` 消耗；不输出环境或凭据。

此路径不执行生成的 EXE、不写注册、不启动浏览器。只有构建成功、产物验证通过、child 已知关闭且临时根身份未变化时才清理自有目录；构建拒绝、关闭或归属未知时保留并拒绝，不能把失败 shell 的 close 当成所有编译后代已退出。后续原注册／framing／真实身份和全部原断言、时限继续存在。两个构建使用不同自有目录／子进程，不复用产物或 PowerShell 状态；共享 OS 缓存可能被预热，不宣称冷启动。受控 Node/VM 正负控不是 PS5.1／C# 实际构建通过，必须由新 head 的真实 Windows 决定。旧 `registration-framing` 内层异常仍 UNKNOWN；前置拆分不假称修复其历史原因。

### #723 首个 Windows 窗口身份门：失败证据

`COCKPIT_BRIDGE_FIRST_IDENTITY_INCOMPLETE` 保留原阶段名；同次 `COCKPIT_BRIDGE_FIRST_FAILURE` 仅给出固定步骤、真实 close/退出、输出字节数、有限 PS 源角色／行列／检查序号及 C# 错误代码／framing 检查数。原始输出仍只在 owned 临时文件中，公开回执不包含正文、路径、命令、环境或 Registry 值；格式未知、超限或身份变化时证据为 unavailable，不改变原失败。

`registration-framing` 也覆盖 PS 成功后的 receipt 数量断言，不能单凭阶段名判定 PS／C#／Registry 或 pipe 根因。子进程 exit0 后的控制器拒绝与子进程失败分别记录。此证据修复不是原生注册修复；完整 canonical、原有 Windows 回归和真实 Chrome pipe／PID／HWND 身份门仍须实际通过。不得据新回执延时、重试、跳过断言或启用遮罩。

> 与产品 **0.5.0** 对齐（2026-08-09 体检后刷新）。框架均为 Node 内置 `node:test` + `node:assert/strict`（无 Jest/Vitest）。

Windows／跨平台变更先读 [Windows 开发与失败定位](windows-development.md)：包含系统化调试、路径／换行／真实消费者预检和原生证据边界；只选本次必要回归，不新增全仓或模型门。

## 测试架构

### #723 D2 固定 native bridge 首门

[首个身份纵向说明](browser-native-bridge.md) 区分源码/惰性 CPU、C# framing/owned 注册与真实 document→parent pipe/HWND→当前 owner/认证 WS 的验收。Windows smoke 仅在原全部步骤末尾追加 `run-cockpit-bridge-first.ps1` gating step，复用 `.test-dist/src`、构建当前候选扩展；固定 CFT pin 未具备完整归档/EXE 证明时先失败为 NOT_READY。新供应器只用一次 600000 ms 网络准备，无 redirect/retry，不改变原 45 秒 native 或 5000 ms bind。所有新增子进程使用显式环境、owned npm 配置/cache；C# framing、注册负控、document receipt CPU 在真实 controller 之前，Job CPU 在 controller 内只执行一次。惰性 ZIP/生命周期控不称浏览器/原生通过，mask/opaque scope 仍未实现，整张 #723 不因此关闭。

### Windows 选夹的短名与长名

`companion/tests/picker-native-path-domain-726.test.ts` 执行当前 Node 的真实 JS `realpathSync` 实现与原生选夹测试的实际预期路径声明／严格比较。仅原生绑定用明确的惰性短名→长名 seam；不会执行 Win32、窗口或选夹。它同时覆盖 LF/CRLF、原 JS-only 声明的失败、已展开路径正控、异目录拒绝及原生身份不可得的失败传播。`workspace-picker-windows-native-726.test.ts` 的预期根使用 `fs.realpathSync.native`，实际选夹及全部绑定／取消／ACP cwd／清理断言不变。该 CPU 检查不能证明真实 Windows API 或替代远端新 head 的原生用例。

### #726 MCP 本机目录来源

`companion/tests/mcp-workspace-observation-726.test.ts` 使用实际 client.connect/callTool、manager.callTool、dispatch 成功投影、server chat 分支、adapter tool.result 与完整 WorkspaceHints；SDK／transport／根归一化是明确惰性 seam，不启动 MCP 服务、浏览器、PTY 或读取真实配置。正常 backend/frontend 测试项目仍按原选项机检，不能只凭此 AST 运行声称真实服务器／平台验收。

只对真实官方 stdio startup 的 effective root 快照生成私有结果关联；当前 client／config／授权／route／selection、同一原 chat auth socket 在结果与发送时仍有效才发布 outer `workspace_observation`。远端或结果自报 local/path 不构成来源，普通 ToolResult JSON 与模型输入不变。已知目录操作用实际准备路径，有限文件操作只用唯一明确非 home 的共同根；相对／设备／控制字符／跨根／部分成功 multi-file／未知或超16根、4096字符路径均省略观察。默认 home 下单个文件不推导项目 dirname。

边界控制覆盖完整来源链成功、原结果不变、HTTP／自称 filesystem／injected、过期 client/config ABA／授权／route／选择／取消、发送前 auth 失效、伪返回 metadata、三条 live hint 预算／ID 歧义／折叠／foreign／断线与 shell 原正控。它只展示“访问目录候选”，原生选择器仍唯一绑定；受控 mounted Panel 消费链与独立 Windows 原生证据见下文，精确发布 head/main CI 保留原门禁。

### #726 既有 Git 状态请求关联

`chrome-extension/tests/workspace-git-hints-726.test.ts` 由原前端 canonical `tests/**/*.ts` 编译与 `*.test.js` 入口发现。测试运行实际 Panel status effect → 原 Git 状态返回函数／handler → 原 WS `id` 包络 JSON → 当前 observer／实际完整 live hook → 原候选按钮 callback；Git 子进程、realpath、Chrome 发送与 React 生命周期为显式惰性 seam。没有真实 Git、文件系统探测、浏览器、picker、PTY 或 provider 执行。

只有现有 Panel 状态查询会登记；其它未登记 `coding.git_status`／`acp.workspace_status` 回复拒作候选。请求绑定当前线程、选择 revision、真实连接对象与规范 expected path，下一请求退休前一请求。回复和 Chrome 发送确认两者均须成功，先回复后发送失败也不保存；断线、发送异常、effect cleanup、同线程 ABA、旧 callback、重放、未知 owner/id、错误／非仓库／缺路径／异路径及不完整值均不产生提示。原活动 tool ID 歧义仍停用该选择／连接的收集。现有 handler 的成功形状是 `is_repo:true` 且无 error，不伪造不存在的 `success` 字段。

已成功观察的目录在 `thread.updated`／真实 reducer 解绑后保留于当前 live hint，reload／切换／断线仍清空。它是 Git 实际 cwd，不能称仓库顶根或自动确认；最多3条预算与 native-pick 唯一绑定不变，按钮只发原 `workspace.pick`。当前状态查询本来仅在已绑定时发出，本片不为未绑定者新探测目录；MCP 本机来源见上一节；实际 CodingAgentPanel 的受控挂载证据与独立 Windows 原生链见下文，不把两者冒称同一次物理浏览器／原生 e2e。正常测试项目包含现有 node-shims，不能以遗漏该文件的 selected program 冒充 canonical 类型检查。

### Windows sentinel 对象身份夹具

case36 的数值句柄可被当前子进程的无关对象复用，不能单用 GetHandleInformation 推断 sentinel 继承。夹具使用128位随机 Local Event 名称与原子拒绝重名创建；在打开只读同步引用之前捕获候选，再用既有 CompareObjectHandles 比较。V2 sidecar 只在 owned 文件传递已知三句柄和固定格式名称，旧 V1 case35 保留。未知 API、引用、比较或关闭结果仍拒绝；原 launcher、inherit=false、pipe/parent 检查、ACK、20s和真实 native gate 不变。CPU 词法投影不等 Windows SDK／原生通过，也不确定旧 launch 失败的唯一原因。

### #572 Windows sibling 就绪事件

既有 `scripts/tests/uia-no-autofocus-572.test.mjs`（原 CI 入口显式执行）追加实际 fixture ContentRendered/Activated/发布函数的有限 PS→JS 语法投影。LF/CRLF 均覆盖请求返回未激活、从未激活、错前台、Activated 先于渲染、重复事件、既存 ready 与写失败；target 四模式原始基线不变。投影使用真实 owned 文件写入/rename，窗口与事件为惰性 seam，不执行 PowerShell、WPF 或 user32。

夹具只给自有 sibling 请求一次原 Activate，再用当前 IsActive 和精确自有 HWND 判断是否可发布；没有新增计时器、轮询、retry、SetForegroundWindow 或输入注入。真实 Windows 的原 45 秒生命周期和全部背景四 oracle 保留；无真实激活就无 ready 并失败。受控 CPU 不证明本轮 Windows 原因或通过，仍须精确新 head 的真实平台验收。

### #722 UI 确认续体与容量反馈

`companion/tests/acp-busy-feedback-722.test.ts` 的原有19个源码控制保留，追加实际完整 WS handler → 真实 manager 方法的确认续体回归，由原 canonical 入口发现。两个 owner 先各有 offered，A 批准后占槽、长会话尚未终结时即回复；B 随后批准必须得到绑定所属对话/会话的 `ACP_CONCURRENCY_LIMIT`，无第二次启动、无 foreign holder 泄漏。另覆盖确认前 typed busy、拒绝确认、worker/缺失 owner、确认期间配置失效、同步取消，以及实际前端错误路由的可见性和其它 owner/缺失 owner 拒绝。

追加创建子进程后的第二次 timeline 同步取消回归：回复须在真实 close 前给出取消，运行槽在 close 前仍占用、close 后才释放，不得在 closed 状态等待长 Promise 或回 accepted。请求内准入 receipt 只由 handler 构造，manager 在真实占槽后记录；不进入协议、会话、历史或模型，测试 interception 必须真实转发该参数。

配置、用户批准决定和子进程/计时器为显式惰性 seam；不是有效 L2 token、真人确认、实际连接断线或 Windows/Agent 原生证明。实际 hook 的 accepted 文案仅为“启动请求已受理，正在准备…”，不证明 Agent 已启动。多 offered、回收生命周期等原 #722 余项仍独立保留；无新队列、重试、权限、容量或时限。

### #731 shell 输出编码

`companion/tests/shell-output-encoding-731.test.ts` 由原 canonical 测试入口发现，运行实际 `shell.ts` 模块与受控 child pipe 字节。覆盖中文／emoji 的所有单个拆分位置、stderr、结束残片、固定 CP936 字节、含 NUL 的混合输出、进度／输出上限、退出码、停止／超时及原模块／allowlist 拒绝。测试使用内存 spawn、虚拟时钟和 owned UTF-8 文件，不启动 cmd、PowerShell 或真实子 shell。

有效 UTF-8 优先；没有真实编码声明时不推断 ACP／GBK。非法 UTF-8、含 NUL 或 Windows 非 ASCII 命令经 shell 转换后的非空输出，既有 `note` 和相应进度尾部包含 `OUTPUT_ENCODING_UNDETERMINED`；正文可能有替换字符，不能据此判断文件损坏。这不是自动 GBK 转码。真实 Windows 上 `echo 中文`、`type` UTF-8 文件及 GBK-only 程序的输出仍需原生验收；CPU seam 不冒充平台通过。确认／沙箱、命令／环境、退出码、取消、超时及原输出预算均不改变。

`shell-encoding-windows-native-731.test.ts` 仅非 Windows skip；Windows 必须先通过 GHA 和 canonical preload owned 目录身份／边界核验，否则在导入应用或 spawn 前失败。原 runner 自动发现，无新增 CI 参数。测试通过实际 `shellExec` 跑固定 `echo`、owned UTF-8 文件的 `type` 和当前 Node.exe 的固定 CP936 字节 emitter；`type` 与符合单一 literal cmd 分支的 `echo 中文` 都必须精确中文／CRLF 且无警告，进度保真；CP936 两流必须明确标注。只保存／恢复 test-owned 配置并检查并发变更，等待自有命令结束后清理；不改 HOME、系统代码页或原 60 秒默认时限。Mac/Linux skip 与源码编译不代表此 Windows 验收已通过。

Windows 单一、无引号／变量展开／控制符／链／管道／重定向／分组／开关的非 ASCII literal cmd `echo`，使用原选定 cmd、原 `/d /s /c` 引号与原命令，仅新增 `/u` 输出模式；stdout 据该启动合同按 UTF-16LE 流式解码／严格校验，不靠字节猜码。非法／奇数结束／孤立 surrogate／NUL 输出仍标不可判定，非空 stderr 不宣称已知格式。`type` 和所有不满足该严格语法、自定义非 cmd shell、外部 exe/com、非 Windows 均保留旧路径；禁止全局 `/u` 或 `chcp`。新增实际模块惰性 spawn 控覆盖原 argv/命令/options、全部拆分、stderr/空流、上限／退出和不适用语法；没有执行 cmd 或 native。UTF-16LE 仍需同新 head 真实 Windows 断言确认，CPU 格式假设不能冒平台通过或整个 #731 关闭。

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
3. 应用导入前沿用 [`test-data-dir.cjs`](../companion/scripts/test-data-dir.cjs) preload：绝对、test-owned `CMSPARK_TEST_RUN_DIR` 下创建独立 `CMSPARK_DATA_DIR`；不改 HOME，不触碰真实安装配置
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

### Windows 原生管道夹具的 JSON 就绪回执（#605）

`cross-os-process-605.test.ts` 的 protocol fixture 用自有 `.pending` 文件的独占写入、关闭及 rename 发布完整 ready JSON。确定性 CPU 控制在实际写入开始时检查最终文件仍不可见，写入失败时不能宣布协议就绪；不通过增加等待、重试 JSON.parse 或捕获语法错误绕过断言。Windows CI 仍需真实验证双向管道、继承 cwd、ignored stdio 及进程清理。


### #722 待启动提案有限生命周期

`acp-offered-lifecycle-722` 执行真实 manager 方法与 config sanitizer 的受控 CPU 回归：4/64/15min 提案元数据界限、未知时间保守拒绝、保护 confirmed/running/准备与 owned child、固定1配置、原 WS selected-session 校验。`acp-busy-feedback-722` 继续执行真实 manager/dispatcher/handler、原真实 slot-close callback 和 R2准入 receipt，另补既有offer原快照确认／重复／取消／过期／配置失效／foreign owner／批准前容量拒绝。模型 propose 不再把 offered 当执行槽，因此旧提案断言改由四提案边界测 busy，而执行槽始终由实际 start/close 控制。

`coding-offered-lifecycle-722` 使用真实 reducer、生产 JSX／onClick、原 send helper 与 React SSR，验证同线程选择、ABA旧选择拒绝、非选中回执隔离、过期不自动换下一项和显式启动请求形状。它是受控组件／事件投影，不是 mounted browser、真实 Agent 或 Windows native。

## #480 Windows closing 取消入口回归

`desktop-native-windows-480.test.ts` 的原20秒 native callback 以同一 owned abort promise 覆盖 metadata race 与发送 `desktop.close` 后的 exit 等待；already-aborted 在 launch 前拒绝，finally 先卸载自己 listener，再执行原 retain／captured child terminate／真实 exit／WS与server close／settled。取消仍是失败，不能因 cleanup 完成变成 PASS。原退出0／HMAC通路／四元数据／native window／lease 断言不弱化，不加 timer/retry/等待额度。

`desktop-native-close-lifetime-480.test.ts` 提取该真实整段 callback，使用明确惰性 network/auth/child/surface seam 覆盖 normal、metadata/closing abort、held exit、preaborted、launch/send throw 和 window 拒绝。它不是 Windows/WebView2/native 运行。main1dde deadline/closing 后 exit0 的实际原因仍 UNKNOWN；`childExited` 是 JS onExit 已送达，不独立证明此前 OS 进程仍活。精确新 head 仍须在原20秒下真实 Windows 自然完成；不要无变化重跑、延长时限或以纯CPU通过替代原生门禁。

### #480 hostile cancelled-navigation completion fixture

The unshipped Windows acceptance variant observes the exact blocked top-level navigation ID and ready document generation. It emits the existing `REMOTE_DENIED` marker and issues the existing popup script only after matching `NavigationCompleted` reports unsuccessful `OPERATION_CANCELED`, all getters succeed, and the current top-level Source/generation remain owned. Starting alone, unrelated/duplicate completion, failed getters, changed document, or foreign sender cannot advance. Shipped native source and the Mac fixture remain unchanged.

`desktop-hostile-completion-480.test.ts` lowers the actual limited C++ fixture bodies and drives a controlled event schedule, including LF/CRLF generator inverses and exact UINT64 identities. These are CPU/source controls, not C++ compilation or WebView2 execution. Exact-head Windows native acceptance must still finish naturally within the original 20 seconds with all original markers/assertions and cleanup; the historical timeout cause remains unknown.


### #739 bounded-N bridge / 多会话视图

- `companion/tests/acp-bounded-n-739.test.ts` 直接执行真实 manager、saveConfig、WS handler 与实际工具 L2／dispatch 分支，进程、确认、文件和时钟均为显式惰性 seam；覆盖 N1/2/4、同 Agent、降额／禁用、prepare／exit-before-close／failed-spawn／fallback 与替换对象。该 CPU 证据不是原生或真实 CLI 正控。
- `chrome-extension/tests/coding-bounded-n-739.test.ts` 执行真实 reducer／private send producer 与完整 WS listener，覆盖有序 membership、同线程／跨线程 ABA、唯一回执、Stop先于Start回执、manual-entry、compact marker与legacy未知关联。原522／607／722／727消费者按已批准新容量／显式选择合同同步，保留其 owner、真正close、工作区和拒绝断言。
- `companion/tests/integration/acp-bounded-n-739.test.ts` 仅 Windows CI 执行：N1/2/4各创建精确 owned Node bridge，以原子 JSON marker 确认真实独立 PID 重叠，同 Agent 拒绝、取消一方后另一方仍活、真实close后仅释放其槽。每case45秒、marker20秒、原bridge10秒，不扩时限／权限。它不启动配置的 Agent/provider，不是本机已跑证据；非Windows注册后显式skip，必须在真实Windows计数通过。
- 原607六个受管close／probe→fallback场景完整保留，当前case不以UI closed、cancelACK或exitCode提前释放。源审批、一次必要共享locked ARM与精确head/main完整CI另行验收；不能凭多个offered、VM、SSR或ARM单独关闭整票。


### #726 当前对话目录提示（开发候选，分层验收证据）

`companion/tests/workspace-hints-726.test.ts` 执行真实 workspace.pick 分支和整份原生 helper 的惰性导入；`acp-workspace-priority-726.test.ts` 执行真实 manager/handler/提案工具生产结果，并喂给提示观察器；扩展 `tests/workspace-hints-726.test.ts` 执行完整 live hook、reducer、实际 Panel JSX/点击及晚回复 callback。CPU seams 不启动 shell/Agent/浏览器/原生选择器，不冒称真实 L2 或 OS 导航通过。

提示最多三个、仅内存；仅当前实时 start/result 配对且 shell exit0/no-timeout/no-abort、ACP 实际 offered 可纳入。`cwd` 标为进程启动目录，严格字面 `cd` 只标参数声明；不解释泛 `--cwd`、环境展开、文件父目录或 MCP 远端本地性。初始首片未收 Git 提示；本版仅按上文既有 Git 状态请求关联契约纳入。真实连接广播须在提前返回前退休旧视图与两种未完成的回复／发送确认，重连只接纳新连接的请求。未知／折叠／失败及历史回放均不补候选。

显式点击只给既有 `workspace.pick` 传可选 initial_path/request_id，不代替原 native OK；取消（即使 SelectedPath 保留提示）零绑定，选中其它目录绑定实际返回值。原 picker120秒、ACP/L2/45秒、plan_readonly 和 setWorkspaceRoot 的单次原生收据条件不改。服务器在两个 await 后复核原 thread 对象与真实当前 panel socket；UI A→B→A／断线的旧反馈不能改新选择，真实用户仍可确认原A（只绑定A，绝不B或自动启动）。

独立 owned 夹具的6项受控 mounted 验收使用真实 ReactDOM/createRoot、完整 CodingAgentPanel、context／canonical reducer／whole useWebSocket、实际 App 的 Panel JSX/props，以及真实 shell 消息 producer；实际候选 DOM 点击经完整 workspace.pick case 的 native-return seam，由该实际 case 生成的回执驱动重渲染后，只有明确 Start 才发出带实际所选 workspace_root 的 acp.ui_start。Chrome runtime／ACK／广播、原生返回／FS／receipt／持久化是显式惰性 seam，ACP Start 帧只捕获不执行。

另一个远端 Windows 原生用例已验证真实 picker OK/Cancel、原线程绑定与合成 ACP 进程实际 cwd；它不从物理 Panel 发起。这两类证据不是同一次物理浏览器／原生 e2e，也不证明真实 MCP 服务、真人确认或真实 Agent/provider。候选仍不绑定，原生门禁独立，整体验收以精确发布 head/main CI 通过为准；0.6.14 仍为开发版，不据此 tag/release。


#726 R2：真实 server 的 tool.start 参数摘要不包含 command，故首轮手工 command seam 不代表可达能力。新增 `shell-workspace-declaration-726.test.ts` 执行整份 shellExec（惰性 child）、真实 server start 摘要与 adapter result 序列化后再喂真实观察器；仅原 exit0／无超时／未取消输出可选 declared_cwd，cwd 仍为 spawn cwd。严格已知 cmd 或 /bin/sh 的完整字面 cd 语法，不执行／展开／猜目录，不发送命令或后缀。重复活动 tool ID 后保已验证提示，但本选择／连接后续收集停用，直到真实选择／连接变化；没有隐藏墓碑或自动重试。ALM／C1 等 Unicode 控制、格式、surrogate 与行分隔符路径拒绝；cmd 单引号不当 POSIX 引号。R1 全源码／27回执和4个真实反例保留；独立 Windows 原生证据见上，精确发布 head/main CI 保留原门禁。

### #726 remote picker thread-scoped discovery

`picker-native-discovery-726.test.ts` lexically projects the actual unshipped C# decision bodies with inert API facts; it does not execute PowerShell, C#, Win32 or UIA. It preserves the original coordinator/transport controls and covers a live hidden-owner modal with MainWindowHandle zero, exact child-thread PID/TID checks, unique visible #32770, 64-thread/256-callback refusal limits, empty versus partial native enumeration, and original captured HWND/root/UIA/OK/Cancel rechecks. No desktop enumeration, title targeting, input, foreground change, polling, retry or timeout expansion is added. A separate hosted Windows acceptance has established the original OK/Cancel binding and synthetic ACP process cwd; retain the exact published head/main platform gates. This is separate from the controlled mounted Panel evidence; the prior120781.7155ms failure's cause remains UNKNOWN.

### #725 terminal-tail consent and readonly boundary

`terminal-tail-725.test.ts` executes the whole production session/handler/formatter/private-reader functions under inert process/env/audit/timer seams, plus actual private server-property/source parsing. It tests output-only collection, legacy/current-object consent, two disclosed L2 branches, cancellation/failure, socket/thread/worker/plan refusal, zero read-side input/process effects, close privacy, UTF-16 split normalization, control expansion and exact8192byte/8000char output framing. Synthetic output is not a native PTY run, user approval, provider call or proof of model injection resistance. Real exact-head Windows/macOS PTY echo/>8KiB/closed-tab and original owner/L2/cleanup acceptance remain future hard gates; no timeout/skip/retry relaxation.


### #725 pinned Windows PTY worker source correction

`node-pty-worker-retire-725.test.ts` 用锁定 beta.15 的真实 Windows JS 与实际 PTY session 函数、惰性 native/socket/worker 边界核对自然退出后的 worker 退休；这不是本机 PTY/Windows 验收。上游 JS 保留 MIT 版权和来源，x64/arm64 原包分别按 companion lock integrity 校准。补丁只在 `_cleanUpProcess` 的原输出 destroy 后调用既有 retained output-worker dispose，沿用原始 flush/terminate；不在退出后调用数值 PID kill，不证明所有 HPCON 已释放，pre-ready deferred kill 仍单独待核。

正常 companion postinstall 与两个 Windows 打包入口使用同一精确源码补丁。非 Windows 不查询 native 包；正常安装无 optional PTY 包/不支持架构时报告 NOT_INSTALLED/NOT_SUPPORTED 并保留原终端不可用降级。Windows 打包必须有匹配包且修正成功，完整真实 companion lock 的独立读取上限为256KiB；package/source 文件仍各128KiB，均完整读取且不截断。未知版本/完整性/源码、别名/身份替换或不完整写入均拒绝。受控 CPU 不能替代新 head 的原两条真实 PTY 测试、20s/6s/45s 原预算和完整 canonical；当前长时间 pending 的具体原因仍 UNKNOWN，不以本修正假定历史根因。


### #723 D3 同连接只读同意候选

`companion/tests/computer-readonly-session-723.test.ts` 沿实际普通chat evidence binder→whole server executor→真实ThreadManager/L2/confirmation manager/token，验证首次deny、真实origin批准后复用/fresh token、privileged同形不授信、重连/subject ABA/取消/失权/失败清理及单连接pending接续；另实际executor→原dispatch广播→focus producer验证presentation-only started标记、混入注入/paused/首次heavy/nonce原行为。捕获/OCR/证据等OS边界仅inert DI，既有45秒/权限/注入G1不改；限率用独立账户和原常量，失败捕获也计。受控CPU不是人工批准、真实浏览器或Windows native。

首次确认可见范围明确为当前认证扩展端点/对话/App，仅全describe/screenshot/wait；无新TTL/具名Chrome profile证明，不借G1跨重连。D2 HWND正身份/双帧mask仍未完成；D1真实Windows及发布head/main的实际门禁继续独立，不能由本测试关闭whole723。

### #723 Windows observation quality

The focused inert families are `computer-capture-self-723` (existing ownership/fallback controls plus actual adapter/executor taint), `computer-observation-723` (closed parser, bounded actual C# source lowering, real owned evidence serialization and model framing), `computer-l2-preview-image`, and extension `computer-task-state`. Related executor, OCR, preview and Windows error mapping tests retain their existing assertions. Source lowering and runner seams do not compile or execute PowerShell/C#/Windows APIs; fake sealer bytes do not claim real encryption.

Required later Windows checks: usable PrintWindow, overlapped BitBlt, stable sampled-empty BitBlt, API/identity/DPI/limit refusal, passive minimized/nonforeground refusal, credential blackout, quality on model/UI/preview/evidence, unchanged injection/dialog/stop/cleanup gates. No local screenshot, browser, foreground rescue, native test or provider is needed for the CPU controls. Native-mask requirements remain incomplete; scoped read-only admission is described in the D3 section above. No new hosted Chrome runner is assumed.


### #723 D1 Windows capture producer (independent remote acceptance)

`computer-capture-native-controls-723.test.ts` runs inert helpers and whole-callback VM controls. `computer-capture-windows-native-723.test.ts` registers five Windows-only hard cases automatically discovered once by the existing canonical Windows CI runner (no duplicate #572 step entry): default real PrintWindow, passive minimized/nonforeground refusal, forced-after-real-PrintWindow BitBlt partial and owned NOACTIVATE overlay occluded. Each retains fresh owned WPF/real helper children through close under45s/15s remaining budgets. No screenshots/raw metadata are printed. The one test-only variant changes observed printed=false after the actual PrintWindow call and is inverse-checked; it is not natural PrintWindow failure or a production option. Only the exact changed-head five-mode Windows result can complete this gate; the #572 UIA job alone does not prove this capture path.
