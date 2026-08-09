# CMspark Deep Diagnosis Fanout — 2026-08-09

## Executive summary

CMspark 处于产品 0.5.0 稳定切点：Side Panel 与 Companion 闭环、线程持久化、确认台、Pack/MCP、Multi-agent、Computer Use（实验）、听写/会议、Obsidian 导出等已交付。本次 10 子系统 + 6 横切 fanout 结论是：**能力已铺开、边界未锁死**。

主路径（本机配对 + 浏览器工具 + 流式对话）大体可用，但多处双 Source-of-Truth 与「门控只挡一半路径」使 ADR/文案中的安全叙事弱于实现。Lead 已 spot-check 确认多项高严重仍为 open（非已修陈旧项）：config.get MCP 密钥泄漏、trusted_domains 跳过 navigate、host_cli 未进 COMPANION_TOOLS、二次 spawn_worker 白名单继承、executeMcpTool 无视 MCP 选择、BoardPanel board.get 断裂、upload/regen 跳过 multi-agent LLM 门。

威胁模型以 loopback + HMAC 配对为主：无明确互联网未认证远程 RCE；在已配对扩展、同机读 ws_secret、自动批准或宽 Cookie 域等现实场景下，绕过与串台成本偏低。

**总评：C** — 可继续迭代，但未完成 P0 前不宜宣称企业安全边界已闭合或多 Agent 隔离完备。

## Overall grade

| 维度 | 评估 |
|------|------|
| 总评 | **C** |
| 功能完备度 | B-（面广；Board、host_cli 等面断裂） |
| 安全不变量 | C-（代数与文案/ADR 冲突） |
| 并发/隔离 | C（supersede、pause、spawn、stream gate） |
| 架构可维护性 | C（server.ts 神文件 + 双协议表） |
| 测试/CI | C-（ghost 测试、无 BrowserBridge、ubuntu-only） |
| 发布工程 | C（Windows 双产物、SEA fail-open） |

子系统自评分多为 B/C。未给 D/F：默认聊天+浏览器主链路、L2 队列、已列工具 HMAC 绑定仍有实质作用。

## Architecture assessment

### 拓扑（健康基线）

Chrome Extension (Plasmo/React/SW+CDP) 经 loopback WebSocket + HMAC 连接 Companion（server + message-router + llm + tools + packs/mcp）。A1 双层分工清晰：扩展执行浏览器操作，Companion 持 LLM/配置/线程 SoT。

### 结构性风险

1. **神文件** — companion/src/server.ts 同时拥有 Origin/WS、createToolExecutor、L2 代数、executeCompanionTool、MCP、校验表、广播红action。路由表漏项类 bug（host_cli；历史上 skill_install）会反复出现。
2. **双协议表** — validateWsMessage 与 handleMessage 分离；未知类型仅 production/STRICT fail-closed；SEA 未必 NODE_ENV=production。
3. **ADR-020 Surface 表面化** — UI CapabilityLevel 驱动徽章；Companion 不按 mode 裁工具；COMPUTER_CLASS_TOOLS 漏 shell/netsec/host_cli。
4. **Composition 缓存旁路** — Pack 写 ThreadManager.active_skill_ids，SkillEngine.threadSkillMap 不失效且 new ThreadManager() 读盘。
5. **扩展双树** — Side Panel 与 Cockpit 各 AgentStoreProvider + useWebSocket，无 SW 单飞。

### 设计叙事 vs 实现

| 叙事 | 现实 |
|------|------|
| Cookie 信任 ≠ 巡航 | isTrustedDomain 跳过 navigate / image-fetch |
| 关键 API 仍 force L2 | 依赖可混淆 regex + skipConfirmation |
| MCP 线程选择 | 只滤 catalog |
| Worker 窄表面 | 第 2 worker 可继承 orchestrator 控制工具 |
| Pause 冻 LLM+工具 | 工具停、chat.create 不停 |
| protocol_version | 仅 auth.ok 广告 |

## Findings by severity

证据路径相对仓库根。关键项 lead 已 read spot-check。

### Critical（5）

| id | title | file | evidence | fix |
|----|-------|------|----------|-----|
| CRIT-01 | Cookie trusted_domains 同时跳过 navigate/create_tab/set_tab_url 与 analyze_image 拉取 | companion/src/server.ts | skipUrlConfirmation 含 isTrustedDomain(~2377)。合并 security-02, x-security-02 | URL_GATE/IMAGE_FETCH 移除 isTrustedDomain；补 trusted-only 仍确认回归 |
| CRIT-02 | evaluate 关键 API forceConfirm 可在白名单/auto_approve 下混淆绕过 | companion/src/security.ts, server.ts | forceConfirm 依赖 detectCriticalApis；skipConfirmation 对 auto_approved 为 true。合并 security-01, x-security-05 | evaluate/osascript 默认始终 forceConfirm（除非三旗全自治） |
| CRIT-03 | config.get/set 泄漏 MCP env/headers | companion/src/message-router.ts | 仅遮 llm/vision；...config 带出 mcp.servers。合并 core-runtime-01/07, x-security-01, x-architecture-08, x-tests-03 | 单一 redactConfigForWire；单测种 TOKEN 断言 *** |
| CRIT-04 | 二次 spawn 继承 orchestrator 控制面；可 worker 嵌套语义 | companion/src/orchestrator/spawn.ts, constants.ts | 提升后 parent 为 ORCHESTRATOR_TOOL_ALLOWLIST；WORKER_HARD_DENY 无 spawn_worker/board_*。合并 orchestrator-packs-01/02/10, x-integration-03/10, x-tests-05 | 固定 worker base；HARD_DENY 控制工具；拒 worker 父；双 spawn 回归 |
| CRIT-05 | Mission Board board.get 协议断裂 | BoardPanel.tsx, background/index.ts, useWebSocket.ts | Panel 读回调 raw_board；SW 仅 ok:true；useWebSocket no-op。合并 x-integration-01 | onMessage 对齐 PacksPanel 或 SW correlator |

### High（28）

| id | title | file | evidence | fix |
|----|-------|------|----------|-----|
| HIGH-01 | host_cli 有 L2 与 executeCompanionTool 但不在 COMPANION_TOOLS | server.ts | 列表~2639 无 host_cli；case~4435。x-architecture-01 | 加入列表；集成测 |
| HIGH-02 | mcp_selection_mode 不在 executeMcpTool 强制 | server.ts | 仅 adapter 滤列表。mcp-01, x-security-04, x-tests-06 | dispatch 校验 active_mcp_server_ids |
| HIGH-03 | file.upload/chat.regenerate 不 acquire multi-agent LLM 门 | message-router.ts | 仅 chat.create。x-correctness-01 | 共享 startLlmLoop/endLlmLoop |
| HIGH-04 | supersede 在 await drain 后无 CAS，可双 LLM | message-router.ts | create/upload/regen 同构。x-correctness-02 | per-thread mutex |
| HIGH-05 | paused 冻工具不冻 chat.create/upload/regen | thread-manager, message-router, server | 文档与实现不符。x-correctness-03 | paused 拒绝再入 |
| HIGH-06 | WS disconnect 不 abort LLM；UI 不清 busy | server close, useWebSocket | x-correctness-04 | 末 peer abort；UI 清 processing |
| HIGH-07 | worker.pause 不 drain pending/L2 | message-router | 弱于 chat.abort。x-correctness-05/06 | 共享 drainThreadCancel |
| HIGH-08 | Cookie catalog/zod/extension 三分 | tool-schemas, catalog, bridge | zod 要 domain；扩展要 url。bridge-tools-01, x-tests-04 | 统一 url+name |
| HIGH-09 | screenshot 回退 captureVisibleTab 可错 tab | browser-bridge.ts | bridge-tools-02 | 校验 active 否则失败 |
| HIGH-10 | 历史重建无 8k tool-result 截断 | llm/adapter.ts | live 截断 rebuild 全量。llm-adapter-02, x-tests-01 | 共用 truncateThenWrapUntrusted |
| HIGH-11 | H1/M2 忽略 chat AbortSignal | context-budget-m2, handoff | llm-adapter-01 | AbortSignal.any |
| HIGH-12 | analyzeImage 未传 chat signal | adapter.ts | llm-adapter-03 | 传入 signal |
| HIGH-13 | skill/knowledge import SSRF 弱；config.test 无门 | message-router | x-security-03 | 共享 DNS+私网阻断 |
| HIGH-14 | bindingPayloadFor 默认空串 | security-policy.ts | security-05, x-security-09 | default throw；L2 全覆盖测 |
| HIGH-15 | CU vault denylist 落后；bundleId-only 可 coordinate | computer/policy, apps/handlers | computer-host-01/02 | 单 SoT；始终 canEverCoordinate |
| HIGH-16 | Panel+Cockpit 可各建 blank thread | useWebSocket.ts | extension-ui-01 | SW 单飞 bootstrap |
| HIGH-17 | 确认先清 mirror 再 send；双表面竞态 | background, confirms | extension-ui-03/08 | 成功后再 gone |
| HIGH-18 | Cockpit stop 非 multi-agent deny-safe | CockpitApp.tsx | extension-ui-02 | resolveStopTargetId |
| HIGH-19 | generic error 与缺 thread_id stream 污染 active | useWebSocket.ts | extension-ui-04/05, x-correctness-07/08 | fail-closed |
| HIGH-20 | Windows Release zip ≠ SEA 文档路径；SEA 可无扩展打包 | release.yml, package.sh, build-windows-exe.ps1 | ops-01/02, x-ops-01/03 | 单一 SoT；缺 extension fail |
| HIGH-21 | Tray 自启 argv macOS 缺 start；Windows SEA 双 exe | menu-bar-agent.ts | x-ops-02 | getSelfSpawnArgs 统一 |
| HIGH-22 | Whisper 仅 pin darwin-arm64 | whisper-binary-pins.ts | voice-meeting-01 | 提交多 arch pin |
| HIGH-23 | Pack apply 不失效 skill 缓存 | skill-engine, pack-engine | orchestrator-packs-03, x-integration-05 | apply 时 sync map |
| HIGH-24 | spawn_worker 在 pack/intent 失败仍 success:true | server.ts | x-integration-04 | all-or-nothing 或 teardown |
| HIGH-25 | system_prompt override 可抹 untrusted 规则 | adapter.ts | llm-adapter-04 | 固定 safety footer |
| HIGH-26 | 出站 navigate / analyze_image_fetch 确认无 originWs | server.ts | security-06, x-security-06/07 | 绑定 origin/caller |
| HIGH-27 | MCP roots 变更不重连 | mcp types/client | mcp-02 | roots 入 restart |
| HIGH-28 | WS 无 maxPayload；未认证无上限 | server.ts | core-runtime-02/06 | maxPayload + 限流 |

### Medium（42，主因摘要）

| id | title | fix 要点 |
|----|-------|----------|
| MED-01 | Origin 仅 scheme 不钉 extension-id | trusted_extension_ids |
| MED-02 | 陈旧锁/status 裸 PID | isDaemonRunning |
| MED-03 | crash.log 忽略 CMSPARK_DATA_DIR | DATA_DIR/getConfigDir |
| MED-04 | chat 不 stripLoneSurrogates | 出口统一 sanitize |
| MED-05 | 空 tool_call id 冲突 | 合成唯一 id |
| MED-06 | 100 轮工具弱成本帽 | 轮次/token 预算 |
| MED-07 | H1 handoff 未 wrapUntrusted | 数据围栏 |
| MED-08 | 多租户 PSL 通配残留 | PSL 或扩大后缀表 |
| MED-09 | page-sanitizer 与 companion 分叉 | 共享模块 |
| MED-10 | 持久化红action 漏 host_cli 等 | 单 registry |
| MED-11 | getPageHTML selector 被短路 | 精确 full-doc 匹配 |
| MED-12 | 交互工具 GENERIC_FALLBACK zod | 补 schema |
| MED-13 | tab-resolver 生产未接线 | 接线或删除 |
| MED-14 | getElementCenter 默认 (300,300) | SELECTOR_REQUIRED |
| MED-15 | fill_form 仅 Ctrl+A | metaKey 或 evaluate |
| MED-16 | upload_file 无 catalog/沙箱 | 删除或加固 |
| MED-17 | MCP schema→zod 空 props 放行 | fail-closed |
| MED-18 | 名碰撞 >99 可覆盖路由 | skip 或 hash |
| MED-19 | 注入标记 MCP 工具静默丢 | 日志+UI |
| MED-20 | HTTP MCP URL 无 scheme 白名单 | http(s) only |
| MED-21 | 出站跳过 tryParse；审计先 ok | 422 + 终态审计 |
| MED-22 | shell/netsec token 不绑 cwd/ports；shell session 全家 | 绑定+指纹 |
| MED-23 | community 手改可开 shell/netsec | isModuleEnabled 查 profile |
| MED-24 | require_task_auth 可软关；shell:true 残留 | sticky；argv spawn |
| MED-25 | estop socket 在 /tmp | DATA_DIR |
| MED-26 | privacy_ack 仅客户端布尔 | 服务端持久 |
| MED-27 | meeting 无 size cap/delete | cap + delete API |
| MED-28 | Whisper 预算双计 .part；Win whisper 可选 | 修正预算；SKU |
| MED-29 | Trust B apply 无互斥 | async mutex |
| MED-30 | use_skill 未 sanitize | sanitize 正文 |
| MED-31 | digest 队列可写陈旧指纹 | 写前重算 |
| MED-32 | tab soft-lease hooks 异步窗口 | 同步注册 |
| MED-33 | ADR-020 不闸工具 | 文档降级或真闸 |
| MED-34 | server↔router↔fleet 动态 import | run-state 抽取 |
| MED-35 | protocol 不协商；WS 未知类型 dev 放行 | hello+默认 strict |
| MED-36 | pack board_mode 不 ensureBoard | apply 后 ensure |
| MED-37 | 安全开关乐观置位；密钥存 storage 明文 | 等 ack；会话密钥 |
| MED-38 | esbuild external 三处漂移；Node 版本文档分裂 | 共享 args + engines |
| MED-39 | CI 仅 ubuntu；SEA/DMG 不在 Actions | windows/mac job |
| MED-40 | launchd KeepAlive + daemonize 抖动 | 监督下前台 |
| MED-41 | 扩展 evaluate 仅查 token 非空 | 能力 nonce |
| MED-42 | ghost 测试与 BrowserBridge 不可测 | 抽纯函数+补回归 |

### Low（代表）

CLI stop/status 未实现；fatal 无监督重启；jailbreak 不 abort provider；filename 未转义；wait_for 死代码；KeepAlive 监听无幂等；SettingsSlideout 单体；root package.json 孤岛；log 仅一代；confirm_session 空别名；forceReleaseTab 伪造 HARD。

## Subsystem health matrix

| Subsystem | Grade | 关键断点 |
|-----------|-------|----------|
| core-runtime | B | 密钥双路径、maxPayload、锁/PID |
| llm-adapter | B | 截断/abort/override safety |
| security | B | 信任域、evaluate 门、绑定默认空 |
| bridge-tools | B | cookie 契约、截图 tab、schema |
| mcp | B | 选择仅 catalog、roots、弱 zod |
| computer-host | C | vault/坐标、token、session |
| voice-meeting | C | pin 矩阵、ack、transcript |
| orchestrator-packs | C | spawn 白名单、skill 缓存、Trust |
| extension-ui | B | 双树、confirm、stream gate |
| ops-ci-packaging | B | 双产物、fail-open、ubuntu CI |
| x-architecture | C | host_cli、神文件、ADR-020 |
| x-correctness | C | LLM 门、supersede、pause |
| x-security | B | 同上 + SSRF |
| x-tests | C | ghost/缺口/平台 |
| x-ops | B | 自启 argv、DATA_DIR、launchd |
| x-integration | C | Board RPC、spawn 语义、协议 |

## Prioritized action plan (P0/P1/P2)

### P0 — 发布阻断 / 安全不变量 / 产品面断裂

1. 红action SoT（config.* 全路径）
2. 信任域代数 Cookie-only
3. evaluate 硬确认
4. host_cli 路由 + 一致性测试
5. MCP 选择强制于 dispatch
6. spawn 白名单 + 禁嵌套 + 双 spawn 单测
7. LLM 门/CAS/paused 三入口统一
8. BoardPanel board.get 契约
9. WS maxPayload + 未认证连接上限
10. Windows 产物 SoT（文档/Release/CI）

### P1 — 高正确性与隔离

SkillEngine 缓存失效；Cookie/截图/selector；tool-result 截断 + abort 链；确认台 SW 单飞；stream fail-closed；SSRF 统一；CU vault/坐标 + shell/netsec 绑定；Whisper 多 arch pin；spawn 部分成功语义；删 ghost 补 CRIT/HIGH 回归。

### P2 — 架构与工程债

拆 server/message-router；MESSAGE_CATALOG；protocol 协商；ADR-020 文档或真闸；PSL；CI 多平台；SEA fail-closed；meeting delete/cap；Trust mutex；tab-resolver 去留；esbuild/Node engines；launchd 模型。

## What looks healthy

- 双层拓扑清晰，Companion 作 LLM/配置/线程 SoT 方向正确。
- L2 确认队列（超时、nonce、多数 origin 绑定）与已列工具 HMAC 仍有实质绑定。
- Cookie vs 巡航概念分层在文案层正确（实现未对齐）。
- MCP 能力门 / destructive 名强制 manual 有设计与部分实现。
- Pack 作为线程补丁而非新 runtime，符合 ADR-014 精神。
- stream-thread-gate 已部分落地（仍有 legacy 缺 tid 放行）。
- broadcast/mcp.list 红action 比 config.get 成熟，可直接提升为 SoT。
- companion 测试体量说明有回归文化；问题在假阳性绿。
- Obsidian/Mermaid/配对 tray 等专项完整度相对较高（非本次主攻）。

## Method (fanout map)

Lead synthesizer
- Subsystem (10): core-runtime, llm-adapter, security, bridge-tools, mcp, computer-host, voice-meeting, orchestrator-packs, extension-ui, ops-ci-packaging
- Cross-cut (6): architecture, correctness, security, tests, ops, integration

Lead: 按 root cause 去重 → 严重度重排 → 对 critical/high 做仓库 read spot-check。证据：spot-check 为 executed:read；其余为 agent inspected。同一 root cause 只保留一条 canonical（表中「合并」字段列出来源 ID）。未将可证伪为已修的陈旧 high 列入 critical/high 主表。

---

Report 2026-08-09 · Grade C · Critical 5 · High 28 · Medium 42 (deduped)
---
# Calibration footer (orchestrator lead, post-fanout)

**Method:** workflow `deep-diagnosis-fanout` — 10 subsystem + 6 cross-cut + 1 synthesizer (`~25m`).  
**Artifacts:** this file + `docs/audit/deep-diagnosis-fanout-2026-08-09-summary.json`  
**Workflow script:** `.grok/workflows/deep-diagnosis-fanout.rhai`  
**Baseline:** main post-#159 Health Fanout.

## Lead spot-check (executed:read)

| Claim | Verdict | Evidence |
|-------|---------|----------|
| CRIT-03 config.get MCP leak | **CONFIRMED** | `message-router.ts:235-253` spreads full config; only llm/vision keys masked. `redactConfigForBroadcast` (server.ts:5407+) already redacts mcp env/headers but is **not** used by config.get — dual SoT. |
| CRIT-01 trusted_domains skips URL gate | **CONFIRMED** | `server.ts:2377-2380` `skipUrlConfirmation = isTrustedDomain(host) \|\| ...` |
| HIGH-01 host_cli not in COMPANION_TOOLS | **CONFIRMED** | `server.ts:2639-2667` list has no `host_cli`; handler exists at `case "host_cli"` ~4435 — routing gap. |
| CRIT-05 board.get SW fire-and-forget | **CONFIRMED** | `background/index.ts:1177-1190` `wsClient.send` then `sendResponse({ ok: true })` — no await of companion board payload; BoardPanel expects `raw_board`. |
| CRIT-04 second spawn inherits orchestrator surface | **PLAUSIBLE** | `spawn.ts:89-109` captures pre-promotion whitelist for first spawn; after promote parent has `ORCHESTRATOR_TOOL_ALLOWLIST`; `WORKER_HARD_DENY` lacks `spawn_worker`/`board_*`. Second spawn parentWhitelist = orchestrator list. |
| evaluate forceConfirm regex | **PARTIAL** | forceConfirm only when `detectCriticalApis` hits and not full autonomy; domain whitelist alone does not waive forceConfirm for critical APIs (server.ts:1590-1592). Severity may be **High** rather than Critical if code has no critical API patterns — still open for obfuscation when patterns match under auto_approve paths. |

**Severity note:** Fanout synthesizer used Critical for security-algebra + product-break items. Relative to 2026-08-09 Health Fanout calibration (Critical = unauth RCE), several CRIT items are better framed as **High / integrity** under loopback+paired threat model — still P0 for product trust, not remote unauthenticated RCE.

**Recommended next:** start Batch P0 (10 items) with dual review; do not re-litigate fixed #159 items without re-verify.
