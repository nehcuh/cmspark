# CMspark Deep Diagnosis Fanout — 2026-08-28

产品 **0.5.3**。HEAD：`feat/overlay-card-first-paint`（Overlay Capture 卡首屏；main 已有 #239/#242）。只读综合 12 个子系统 + 6 条横切 + 对抗验证；对未过 skeptic 的 High 做了源码抽查。**不把 #228 T1、#229 快/淡、#230 残留清单当新 bug。**

## Executive summary

CMspark 作为本机双层 Agent（Extension WS ↔ Companion）在 **配对、L2 确认、工人硬拒绝、租手 require_grant 默认开** 上没有崩。按本轮校准规则（Critical 仅限未认证 RCE / 大规模破坏 / 配对绕过），**Critical = 0**。08-11 的七条 Critical 属于过打分，不能沿用。

真正的压力在 **Overlay Capture 新平面** 和 **宿主执行面的 fail-closed 缺口**。Capture 卡用 innerHTML 渲染未属性转义的 markdown、CSP `script-src 'unsafe-inline'`、会话 token 在 Chrome `--app` 命令行上；同时 `chatCreate` 仍拿全量 L1 工具目录，MCP 变更走 tray 客户端。侧栏 Operate 路径相对健康（扩展 UI / bridge 评 B），但 Overlay 与 CU/shell/MCP spawn 把整体锁在 **C+**：可继续狗食 0.5.3，不能把 Capture 或 Computer Use 说成已闭合。

计数（去重 + 怀疑主义之后）：**Critical 0 / High 14 / Medium 36**。P0 五条都指向下一刀补丁（XSS、租约、L0 面、知识截断保存、Darwin estop）。

## Overall grade

**C+**（校准后，不是 08-11 的「七 Critical 的 C」）。

| 维度 | 判断 |
|------|------|
| 为何不是 B/B- | 14 条 High 里有本地 XSS、CU 急停可被抢绑、打包 Windows 脚本覆盖、Overlay 非 L0。08-09 Health Fanout 在 **当时没有 Capture 卡** 的前提下给过 6.6/B- / 9 High；本轮 Overlay 新增就值几条 High。 |
| 为何不是 C 或 D | 无配对绕过、无未认证 RCE；evaluate/osascript 仍 L2；工人仍 HARD_DENY shell/host；知识/租手/看山已交付且可狗食。多数 High 需已配对、已 L2、或同用户本地攻击者。 |
| 子系统众数 | 10 个 C、3 个 B；横切全 C。短板是 Overlay + computer-host + orchestrator 耐久性，不是整个 Companion 不可用。 |

证据级别：对抗验证 10 条（9 真 1 假）；其余 High 为本次 `read_file`/`grep` 抽查属实。未抽查且未过 skeptic 的「High」已降出 High 计数。

## Architecture assessment

双层拓扑（Extension = 浏览器执行器，Companion = LLM/状态）仍然是对的。**走样的是第三、第四条协议**：

1. **Capture HTML 是第四平面**（`--app` → loopback HTTP+SSE → tray `dispatchSummonerWeb` → 长寿命 summoner/tray WS）。`docs/architecture.md` §1.1 仍只画 Extension↔Companion。Darwin 热键仍是 Swift 72px workbench，菜单打开才是 HTML 卡——「同一张脸」未完成（与 #229 快/淡相邻，但本枝目标就是首屏卡）。
2. **ADR-020 Surface 未进 chat 回路**。`ChatCreateParams` 无 surface；工具 = `getToolDefinitions()` ∩ `thread.tool_whitelist`（null=全开）。overlay-eligible pack 的 `tools.mode=unchanged` 不会关 CDP。L0 只写在文档和 UI 表里。
3. **所有权图有五套**：ComposerLease、L2 conductor（进程级 CU live）、HudShellRouter、tab-lease、outbound dual-entry。HTML hide 不释放租约是分裂 SoT 的症状，不是单点漏调。
4. **身份只有两值**。Handshake `surface` 缺省 = tray；`chrome-extension://` 同伴也是 tray。ACL/租约/确认扇出无法表达 extension vs tray vs overlay vs outbound。
5. **C10 freeze 未守住**。`message-router.ts` 仍内联 outbound grants、workspace、unattended、obsidian、osascript WS、quick action。`summoner-web.ts` ~2500 行内联 SPA 与 ChatShell 分叉。

结论：Operate（侧栏）架构仍是 B；Capture 被做成「薄 HTML + 荣誉 ACL + 全工具回路」，把 0.5.3 的形态主张（Capture 不 Allow/Deny、不操 CDP）变成文档。

## Findings by severity

### Critical

无。对抗验证与抽查均未找到未认证 RCE、大规模破坏或配对绕过。`computer-host-02`（Darwin 降级热键仍允许 CU）被驳回：那是 2026-08-01 双审合同，socket 证明活着 + flag 文件，不是未修缺陷。

### High（14，去重后）

| id | title | file | evidence | fix | verified? |
|----|-------|------|----------|-----|-----------|
| overlay-xss | Capture-card markdown 可突破 `<a href>` | `companion/src/summoner/overlay-md.ts` | `esc()` 只替换 `&<>`；`href=""+u+""`；`innerHTML=renderMd`；CSP `script-src 'unsafe-inline'`。payload `[x](https://evil/"onclick="…)`。token 在 `location.search`，XSS 可带 token 打 `/api/*`。 | 属性转义 / encodeURI；DOM API 建链；nonce/hash CSP。 | 对抗验证属实 |
| bridge-tools-01 | osascript_eval 在错误 tab 跑已批准 JS | `companion/src/tool/companion-dispatch.ts` | 无 url 时遍历 `tabUrlCache` 保留最后一条 http(s)（Map 插入序，不是最后导航）；AppleScript `URL of t contains pageUrl`。`bindingPayloadFor` 只哈希 expression。 | 无显式 url/tabId 失败；token 绑规范 URL；精确匹配。 | 对抗验证属实 |
| mcp-01 | MCP stdio L2 预览隐藏 env，config.env 可注入 loader | `companion/src/mcp/transport.ts` + `handlers/mcp.ts` | 预览仅 command/args/cwd/enabled；`buildMcpStdioEnv` 把任意 `config.env` 字符串抄进子进程（含 NODE_OPTIONS/LD_PRELOAD/DYLD_*）。 | 预览键名；拒绝 loader 键；复用 user-env denylist。 | 对抗验证属实 |
| computer-host-01 | Darwin estop 活着检测是未认证 /tmp 套接字 | `companion/src/computer/darwin-estop.ts` | `ESTOP_SOCK_PATH=/tmp/cmspark-estop.sock`；CONNECT-first 成功即 ok；host.swift bind 无 chmod；tray 若已 live 则跳过 spawn。 | 放到 DATA_DIR、chmod 0600、getpeereid、nonce。 | 对抗验证属实 |
| computer-host-03 | Shell allowlist `-c/-e` 可被引号绕过 | `companion/src/capability/shell.ts` | 正则打在 raw suffix；`python3 '-c' 'code'` 不匹配；`tryParseSimpleArgv` 去引号后 argv spawn。 | 在解析后的 token 上拒绝。 | 对抗验证属实 |
| computer-host-04 | `CMSPARK_WIN_SCRIPTS` 仍信 `NODE_ENV!==production` | `companion/src/host-use/win/powershell.ts` | Darwin host-bin 已双 opt-in；Windows 未跟。打包 SEA 很少设 NODE_ENV。 | `CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE=1`。 | 对抗验证属实 |
| orchestrator-packs-01 | spawn_worker token 不绑 tool_allow/deny/intent_id | `companion/src/security-policy.ts` | payload=`spawn|role|pack|alias`；execute 仍读 params；orchestrator 父 whitelist=null。HARD_DENY 仍剥 shell/host。 | 规范 JSON 进 HMAC。 | 对抗验证属实 |
| x-architecture-01 | Overlay L0 聊天共用未过滤 L1/L2 工具环 | `companion/src/llm/adapter.ts` | chatCreate 无 surface；`getToolDefinitions()`；whitelist null=全开；L1（screenshot/get_page_text）不在 L2_GATE_TOOLS。 | summoner 面只留 L0；conductor 不够。 | 抽查属实 |
| overlay-summoner-03 | Overlay 经 tray 面变更 MCP；Swift 仍 mcp.add | `companion/src/menu-bar-agent.ts` | `dispatchSummonerWeb` 对 `mcp.toggle_server` 用 `companionClient`；`handleSummonerMcpAdd` 走 `mcp.add`。SUMMONER_ACL 拒 mcp.add 但拦不到 tray。 | 从 overlay HTTP/Swift 删除；只读 mcp.list。 | 抽查属实 |
| orchestrator-packs-02 | Summoner pack.apply/skill.activate 可重组任意 thread_id | `companion/src/message-router.ts` | overlay-eligible + 禁 Trust 字段，但 `applyPack(..., rest.thread_id)` 不绑 overlay 会话；skill.activate 同样。 | thread_id === overlay 租约线程。 | 抽查属实 |
| orchestrator-packs-03 | SkillEngine `new ThreadManager()` + get() 写读可打烂 index.json | `companion/src/skills/skill-engine.ts` | 构造函数从盘加载独立快照；`get()` 在空 run_progress 时 `saveIndex()`。 | 注入进程单例；get 只读。 | 抽查属实 |
| knowledge-loop-01 | 截断 knowledge.get + Save 覆盖磁盘余部 | `KnowledgeSubPanel.tsx` + `skill-engine.ts` | 512KiB `truncated:true`；保存按钮仍发本地 `body`；`updateKnowledge` 当全文写。 | truncated 时禁 body / 服务端拒绝短写入。 | 抽查属实 |
| overlay-summoner-01 | 隐藏 HTML Capture 卡不释放 composer 租约 | `companion/src/summoner-web.ts` | `hideSummonerWebShell` 只 `requestSummonerWebClose`+SIGTERM；SSE close 只 `sseClients.delete`。Swift close 才 `handleSummonerClosed`。 | hide 前 `releaseAllOverlayComposerLeases`。 | 抽查属实 |
| x-correctness-abort | WS close / file.upload 中止不完整 | `message-router.ts` + `lifecycle.ts` | upload 设 AbortController 但不写 `llmLoopOwnerPanel`；close 只 abort；`chat.abort` 才 reject pending + 放 lease + drain nextRun，且不看 composer lease。 | close 复用 abort drain；upload 打 owner；drain 用 lease holder。 | 抽查属实 |

**从 High 降级/删除：** `llm-adapter-01` 围栏截断 → Medium（对抗验证：独特 suffix 难猜）；`computer-host-02` → 假；`overlay-summoner-02` 伪造 privacy_ack → Medium（诚实闸，非 RCE）；`extension-ui-01` 解除武装乐观更新 → Medium（需 Companion 断连）。

### Medium（36，簇后）

| id | title | file | evidence | fix | verified? |
|----|-------|------|----------|-----|-----------|
| overlay-token-csrf | Overlay token 在 argv；POST 接受空/null Origin | `summoner-web.ts` `originOk`；`shell-open.ts` | `?token=` 上 `--app`；`!origin \|\| origin==="null"` 放行。Settings-web 不允许 null。 | 精确 Origin；token 走 cookie/header。 | 抽查属实 |
| handshake-surface | surface 客户端自证，省略即 tray ACL | `ws/lifecycle.ts:1023` | `rawSurface==="summoner" ? summoner : tray`。 | Origin 盖章；缺省 deny。 | 抽查属实 |
| core-runtime-07 | waitForExtensionPeer 取第一个 chrome-extension 同伴 | `ws/extension-peer.ts` | `pickAuthenticatedClientWs()` 忽略 notifying socket。 | 用 notifying ws；钉扩展 id。 | 未对抗；逻辑可信 |
| core-runtime-08 | tab.navigated 无源绑定，tray 可毒化 evaluate 信任缓存 | `ws/lifecycle.ts` | HMAC 后一律 `applyTabNavigated`。 | 只接受 chrome-extension://。 | 未对抗；逻辑可信 |
| core-runtime-09 | settings-ui 把 `{port,token}` 对象当端口 | `index.ts` | URL 变成 `[object Object]`，无 token，403。 | 解构 port+token。 | 未对抗；类型即证据 |
| llm-adapter-01 | mid-loop shrink 丢掉 `</untrusted-*>` | `llm/context-budget.ts` | wrap 后再 `slice(0,next)+…`。空 id 后缀 `x`（llm-adapter-02）。 | 只缩内层并强制关闭标签。 | 对抗验证 → Medium |
| llm-adapter-03 | OpenAI 路径忽略 extra_headers/auth_style | `llm/providers/openai.ts` | 连接测试走 buildRequestHeaders，chat 不走。 | 对齐 Anthropic。 | 未对抗 |
| llm-adapter-04 | jailbreak 扫描误杀且不 abort provider | `llm/adapter.ts` | `/jailbreak/i`；return 不 abort signal。 | 收紧短语；先 abort。 | 未对抗 |
| llm-adapter-05 | Vision LRU key 忽略 customPrompt | `llm/vision-pipeline.ts` | 同图不同 prompt 命中缓存。 | key 含 prompt。 | 未对抗 |
| security-02 | analyze_image IMAGE_FETCH 绑 overlay 为 originWs | `tool/image-fetch-admission.ts` | 不 fan-out；overlay 不能 response → 45s 超时。 | resolveConfirmBinding。 | 抽查路径存在 |
| security-04 | PageSanitizer 词库远小于 companion | `page-sanitizer.ts` | ~11 条；overlay 聊天还不经过它。 | 共享模块；靠 wrapUntrusted。 | 未对抗 |
| security-05 | 未知 L2 工具 HMAC 绑空 payload | `security-policy.ts` default `""` | 新 L2 名可跨工具重放。 | default throw。 | 抽查属实 |
| bridge-tools-02 | TAB_ATTACH_FROZEN 建议 list_tabs 但不能解冻 | `tool/site-op-memory.ts` | THAW 只有 navigate/set_tab_url。 | 改提示。 | 未对抗 |
| bridge-tools-04 | downloads_find 用路径段名当 Downloads 笼 | `downloads-find.ts` | 任意 `Downloads/下载` 段即放行。 | realpath 用户下载根。 | 未对抗 |
| bridge-tools-05 | screenshot/getTabId 绕过数字 tabId | `browser-bridge.ts` | truthy 即过；无 tabId 截前台。 | coerceTabId；必填。 | 未对抗 |
| mcp-02 | page-export 同意按 caller_id，后签发的 grant 升级旧 token | `outbound-grants.ts` | `grantAllowsPageExport(callerId)` any live。 | 按 grant_id。 | 未对抗 |
| mcp-03 | HTTP MCP URL 任意 scheme，add 无 L2 | `handlers/mcp.ts` | `new URL` 而已；stdio 才 spawn confirm。 | 仅 http(s)+非环回 L2。 | 未对抗 |
| mcp-04 | `__thread_id` 等内部参数原样进 MCP callTool | `mcp/dispatch.ts` | additionalProperties:false 会炸；恶意服务器看到线程 id。 | 剥 `/^__/`。 | 未对抗 |
| computer-host-05 | Netsec 拒 `*` 但接受 `0.0.0.0/0` | `capability/modules.ts` | bits=0 掩码匹配所有 IPv4。 | 拒绝 /0。 | 未对抗 |
| computer-host-06 | modules.update 可关 task-auth、改 allowlist 无额外 HITL | `capability/modules.ts` | Object.assign 可写 require_task_auth。 | 扩 allowlist / 关闸走 L2。 | 未对抗 |
| overlay-privacy-ack | Overlay HTTP 伪造 privacy_ack，绕过声明的服务器闸 | `summoner-web.ts:839` | `/api/stt/start` 恒 `privacy_ack_v2:true`；meeting 同。测试还锁死这一行为。 | 会话级 ack；改测试。 | 抽查属实 |
| voice-meeting-03 | Overlay 会议无 3h 硬顶 | `summoner-web.ts` | 8s STT 循环直到用户点结束。 | 镜像侧栏硬顶+服务器 cap。 | 未对抗 |
| orchestrator-packs-04 | spawn 后 pack.apply 打在 worker 上，board_mode 不上 host | `companion-dispatch.ts` | host 读 board_mode，工人被写了。 | 组合给工人，board 给 host。 | 未对抗 |
| orchestrator-packs-07 | WORKER_HARD_DENY 漏 workspace_* 与 cookie 工具 | `orchestrator/constants.ts` | 未绑 tool_allow 时可进工人白名单。 | 补进硬拒绝。 | 未对抗 |
| security-ui-optimism | 解除危险旗标 / 确认台 / require_grant 乐观 UI | SettingsSlideout / Cockpit / OutboundMcpSettings | 先 SET_CONFIG 再 fire-and-forget；确认先清再 send；require_grant 一键关。 | 等 companion 回声。 | 抽查 disarm |
| extension-ui-05 | SW 把 knowledge update/export/delete 的 user_gesture 强行 true | `background/index.ts:941` | 0.5.3 手势诚实在扩展边界失效。 | 原样转发，默认 false。 | 抽查属实 |
| overlay-cta-lease | 「打开确认台」只拉起 Chrome；send 忽略 lease 失败 | `summoner-web.ts` | attachChrome 非 confirm；`/api/lease` 单次 claim；send 丢 body。 | 走 /api/operate；claim CAS；失败不 chat.create。 | 抽查属实 |
| knowledge-pin-hud | Overlay pin 用 name\|\|id；HUD 仍 tray-origin knowledge.import | menu-bar-agent + SummonerOverlay.swift | 遗留 id≠name 芯片撒谎；#229 说导入继续藏，按钮仍在。 | 只存 id；去掉 HUD 导入。 | 抽查属实 |
| x-correctness-08 | L2_CONDUCTOR_ELSEWHERE 进程级：任意 CU 活着挡住全部 overlay 聊 | `ws/l2-conductor.ts` | `registry.size>0`。 | 按 thread_id。 | 抽查属实 |
| x-integration-01 | chat/RunProgress 单播到发起 WS，双面分裂 | `ws/lifecycle.ts` | `sendToExtension` 只 `ws.send` 发起者。 | broadcast 或双写 SSE。 | 抽查属实 |
| x-integration-03 | protocol_version 握手演戏 | `protocol.ts` + ws-client | 双方写死 1，忽略 auth.ok 字段。 | 共享常量+拒绝不匹配。 | 未对抗 |
| x-integration-06 | outbound-grant CLI 从不连活 Companion | `grant-cli.ts` | 只改 json；snippet 写死 23401 与 import 时 DATA_DIR。 | getConfigDir()+config.port。 | 未对抗 |
| x-ops-01 | Darwin tray 自启 plist 到不了 daemon start | `menu-bar-agent.ts` | ProgramArguments=`argv[1] daemon --daemonize`，无 execPath、无 `start`；index 只认 start\|stop\|status\|logs。 | `getSelfSpawnArgs(['daemon','start','--daemonize'])`。 | 抽查属实 |
| ops-packaging | esbuild 未声明；Node 三处漂移；Release 无 DMG；SEA 弱于 NSIS | package.json / package.sh / release.yml | 官方 zip 无用户装的 .app/TCC 身份。 | 钉死版本；macos 任务打 DMG。 | 未对抗 |
| x-tests-cluster | 0.5.3 Overlay/知识/grant 测试缺口且有锁错行为 | overlay-md.test.ts 等 | 无引号突破；HTTP 测试要求伪造 ack；无 hide→release；扩展套件编不过面板。 | 见 P2 测试项。 | 报告交叉属实 |
| x-architecture-drift | Surface 表三份、所有权五图、god file、L2 import tray | 多文件 | overlay-eligible 漏 cookie/download；evaluate UI=L1 companion=L2。 | 一张表生成三处；ConfirmSink 端口。 | 架构交叉 |

### Low（摘要，不逐条抬进计数）

daemon logs 忽略 `CMSPARK_DATA_DIR`；chat 路径无 `stripLoneSurrogates`；document filename 未擦洗；DOM.getDocument depth:-1；MCP 名碰撞 n>99；outbound health 未认证披露；hwnd Darwin 用 Windows normalize；STT tmp GC 仅启动时；overlay 隐私首屏溢出 360×420；digest 队列无新鲜度；RunProgress 与 Board 两套 SoT；看山 chip 用 lastFocusedWindow；KeepAlive alarm 非顶层；Swift HUD 仍 `NSApp.activate`（#229 相邻）；launcher.sh 死文档；`build-tray.sh` SHA 注释指错文件。

## Subsystem health matrix

| 子系统 | 输入分 | 校准后 | 备注 |
|--------|--------|--------|------|
| core-runtime | C | C | XSS 是真 High；其余多为 Medium 身份/CSRF |
| llm-adapter | C | C+ | 原 High 围栏降 Medium；无 Critical |
| security | C | C | 与 overlay-xss 合并；IMAGE_FETCH 是 Medium 超时而非绕过 |
| bridge-tools | B | B | osascript 错 tab 是唯一 High；catalog 谎言 Medium |
| mcp | C | C | env HITL 真 High；HTTP scheme/grant 宽化 Medium |
| computer-host | C | C | 01/03/04 High；02 驳回 |
| voice-meeting | C | C+ | XSS 并入 overlay-xss；ack 伪造 Medium |
| orchestrator-packs | C | C | token 绑定 + index 打烂 + overlay 组合 = 三条 High |
| extension-ui | B | B | 乐观解除武装降 Medium；侧栏仍是最成熟 UI |
| overlay-summoner | C | C | 本轮最差新平面：XSS/租约/ACL |
| knowledge-loop | C | C | 截断保存是 0.5.3 诚实回归 |
| ops-ci-packaging | B | B | 无 High 安全；自启/DMG/esbuild 是 Medium 交付 |
| x-architecture | C | C | L0 未进回路 = High |
| x-correctness | C | C | abort/租约 High |
| x-security | C | C | 与子系统 High 去重 |
| x-tests | C | C | 覆盖缺口，不是产品洞 |
| x-ops | C | C | Darwin 自启坏了，值得 P2 |
| x-integration | C | C | 单播分裂是 Medium/High 交界，计入 Medium 表 |

## Prioritized action plan (P0/P1/P2)

**P0（挡下一刀 Overlay 补丁 / 0.5.4）**

1. Capture-card markdown XSS：属性转义 + 去掉 `unsafe-inline`。
2. Overlay hide/close → `handleSummonerClosed`（释租约、作废 session、按产品决定是否 abort overlay 回路）。
3. Overlay 真 L0：chatCreate 按 stampedSurface 裁工具；删除 overlay/tray-dispatch 的 mcp.toggle/add；pack.apply/skill.activate 绑 overlay 线程。
4. 知识 `truncated` 时禁止 Save body，服务端拒绝短覆盖。
5. Darwin estop：不要把匿名 `/tmp` accept 当武装。

**P1（安全/完整性，跟 0.5.4 或紧随）**

6. osascript_eval fail-closed + token 绑 URL。  
7. MCP stdio L2 展示 env 键 + denylist。  
8. Shell allowlist 看解析 argv。  
9. Windows 脚本双 opt-in。  
10. spawn_worker 绑 tool_allow/deny/intent_id。  
11. SkillEngine 单例 ThreadManager。  
12. 中止路径排空（upload owner + close=abort drain）。  
13. chat.* 扇出 overlay+panel。  
14. Overlay token 离开 argv；POST 要求 Origin。  
15. shrink 保持 untrusted 关闭标签。

**P2（交付/架构/测试；不挡 Capture 狗食）**

16. Handshake Origin 盖章。  
17. 打包：esbuild 依赖、Node 钉死、Release DMG、launchd `daemon start`、Win 自启单一 SoT。  
18. 测试：href 引号、hide 释租约、截断保存、双 grant page-export。  
19. 一张 Surface 表 + ConductorRegistry；router 体积门。  
20. 隐私 ack 真闸；page-export 按 grant_id；`require_grant:false` 要短语确认。

明确 **不** 在本计划扩：#228 profile、#229 WorkBuddy 五轨、#230 F-S-10 overlay-acl 整票（本报告的 overlay ACL 修复是「拿掉越权」，不是给 overlay 加 Allow/Deny）。

## Delta vs 2026-08-11

| | 2026-08-11 | 2026-08-28（本轮） |
|--|------------|---------------------|
| Critical | 7（过打分：同用户/需 L2 被写成未认证 RCE） | **0** |
| High | 18 | **14**（去重+怀疑；Overlay 新平面补进来） |
| 总评 | C（通胀） | **C+**（校准） |
| 08-09 Health | 6.6/B-，0C/9H | Overlay 未存在；本轮不能直接复用 B- |

**已在 08-12 P2 / 后续 closeout 合上、不再当新洞：** MCP `process.env`/`user_env` 全量继承（SEC-02；残留是 **config.env** HITL）；若干 L2 `originWs` 扇出（IMAGE_FETCH 仍漏）；token 空绑的部分工具已补（spawn 的 tool_allow 仍漏）；知识 CRUD 读/下载/手势 UI（服务端手势仍在，SW 又盖 true）；outbound first-exfil HITL 骨架；ChatShell 看山；RunProgress UI。

**本轮相对 08-11 的新压力：** Overlay Capture-card（XSS、租约、HTTP 伪造 ack、tray MCP）；知识截断保存；Darwin 自启 plist 少 `start`。

## What looks healthy

- HMAC 配对仍是 WS 门；未发现 pairing bypass。
- `evaluate` / `osascript_eval` 默认仍走确认台；工人 HARD_DENY 含 osascript/shell/host。
- Cookie 工具仍 `trusted_domains`；非 http(s) navigate 仍拦。
- `wrapUntrusted` + wrap-after-truncate **测试仍在**（被 mid-loop shrink 破坏，但机制没拆）。
- overlay-eligible pack 过滤器存在（只是没套到 chat 工具面 / skill.activate）。
- `require_grant` 默认 true；cmg_ 与 ws_secret 分离的主路径还在（一键关掉是 Medium）。
- 侧栏 ChatShell 看山、RunProgress 展示、知识 related≤3、grant CLI 签发——0.5.3 用户可见项可狗食。
- CU 仍有 L2 +（Windows）hotkeyOk；Darwin 是 socket 合同而非「完全没闸」。
- 扩展 bridge 对 chrome:// 的 ensureAttached 仍拦；Mission Pack Trust 字段 overlay 已禁。

## Method (fanout map + adversarial verify)

**Fanout：** 12 子系统（core-runtime, llm-adapter, security, bridge-tools, mcp, computer-host, voice-meeting, orchestrator-packs, extension-ui, overlay-summoner, knowledge-loop, ops-ci-packaging）+ 6 横切（architecture, correctness, security, tests, ops, integration）。每份自带 smell + 分级 findings。

**对抗验证（10）：** core-runtime-01、llm-adapter-01、security-01、bridge-tools-01、mcp-01、computer-host-01..04、orchestrator-packs-01。结果：9 真 1 假（computer-host-02）。真阳性一律 **非 Critical**（需已配对 / 已 L2 / 同用户）。

**本次抽查：** overlay-md href、darwin-estop CONNECT-first、shell 正则、powershell NODE_ENV、spawn_worker payload、hideSummonerWebShell、privacy_ack 伪造、pack.apply 无 thread 绑、SkillEngine `new ThreadManager`+`saveIndex`、knowledge Save body、`llmLoopOwnerPanel` 无 upload、lifecycle `sendToExtension` 单播、adapter 无 surface 过滤、menu-bar mcp.toggle 走 tray、launchd 缺 `start`、originOk null、token 仅 query。

**计数规则：** 同一根因只记一次；缺 skeptic 且未抽查的「High」降出 High；#228–#230 产品余项不进 findings。

**未做：** 不跑利用、不打 live Companion、不改代码。结论是诊断不是补丁。

## Dual re-review (kimi + claude · 2026-08-28)

| 路 | VERDICT | 路径 |
|----|---------|------|
| Claude | **APPROVE_WITH_NITS** | `docs/audit/reviews/deep-diagnosis-20260828-claude-20260828-190219.md` |
| Kimi | **APPROVE_WITH_NITS** | `docs/audit/reviews/deep-diagnosis-20260828-kimi-clean.md` |
| 合成 | `both_ok=true` | `docs/audit/reviews/deep-diagnosis-20260828-dual-synthesis.md` |

两边独立确认：Critical=0、总评 C+、P0 五条属实、14 条 High 代码存在。定级分歧只在 `computer-host-04`（Claude 降 Medium / Kimi 留 High）和 overlay token-in-argv（Kimi 升 High 候选）。合成保持报告 14 High，P1 仍含这两项。Pi CLI 本机不在 PATH，未跑。
