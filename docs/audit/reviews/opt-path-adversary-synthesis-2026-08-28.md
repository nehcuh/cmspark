# 0.5.3 体检优化路径 — 四路合成 2026-08-28

> **GitHub:** [#245](https://github.com/nehcuh/cmspark/issues/245)  
> **状态:** 四路合成 PASS_WITH_CHANGES — **尚未** kimi+claude dual，**禁止实现**  
> **基线 strawman:** `docs/superpowers/specs/2026-08-28-post-diagnosis-opt-path.md`  
> **HEAD:** `feat/overlay-card-first-paint`（合入前 rebase `main`）

```text
Surface:      Capture overlay L0 honesty ; Operate sidepanel unchanged
L2-classes:   host_computer (estop only in Batch B) ; no new confirm dialect
Compose:      pack/skill 仅绑 overlay 当前租约线程 ; overlay 不管 MCP 开关
Autonomy:     n/a
Trust:        overlay never Allow/Deny ; markdown CSP ; estop not anonymous /tmp
Channel:      community
Blast:        Batch A/B = T3 ; C = T3 ; D = T2 ; E = T1/T2
```

**产品句（修订）：** 召唤器 Capture 卡：模型回的字打不穿页面；关掉卡停止本轮 overlay 回路，侧栏不能卡住、也不接手 busy；这张卡不能当侧栏去操浏览器、开关 MCP、改别人的对话。大知识截断不能保存正文/会丢尾。Mac CU 不能把抢绑的 `/tmp` 套接字当成急停。Capture = 可以继续聊（附件/听写/会议/历史）；Operate = 打开侧栏。

**实现是否允许开工：否。** 须 kimi+claude dual 都 APPROVE* 之后才允许写码/开 PR。本合成不是 dual。

## 1. 四路表

| 路 | verdict | 抽查后站得住的 BLOCK | 与 SoT 冲突需折 |
|----|---------|----------------------|----------------|
| Security | PASS_WITH_CHANGES | A1 引号突破；A1-3 unsafe-inline+拼接 href；A3-1 五名 denylist 是谎；A2 hide 不 abort；B2 漏 Swift `/tmp` | DISPATCH 拆 toggle ≠ 改 SUMMONER_ALLOW |
| Product | PASS_WITH_CHANGES | A3-2 活 MCP 开关未死；A3 文案仍承诺 overlay 操网页；CI 锁死后门；B1 Save 仍发截断 body | 「无开关 MCP」= 路径死，不是 ACL rollback |
| Impl | PASS_WITH_CHANGES | ChatCreateParams 无 surface；hide 不走 closed；SSE-only 不是 closed；测锁 toggle 存在；B1 漏 knowledge.ts；B2 Node-only | 反转 ALLOW 测会变成 #230 rollback — **不折这条** |
| Skeptic | PASS_WITH_CHANGES | strawman L40 把 overlay-acl-rollback 写反；B2 漏 Aqua `/tmp`；abortThreadChat(thread_id) 误杀 Operate；B1 长度规则误伤短替换 | 与「拆 MCP 后门」可并存：拆路径、不动 ALLOW |

**抽查（[inspected]，非执行）：**

- `companion/src/summoner/overlay-md.ts:32-34`：`href=\""+u+"\"`；`esc` 只 `&<>`。`overlay-md.test.ts:29-36` 无引号突破负例。encodeURI **不够**。
- `summoner-web.ts:358-361` hide = SSE close + SIGTERM；`:570-572` SSE 只 `delete`；`:524-525` `script-src 'unsafe-inline'`；`:193-196` `originOk` 放行 null。
- `menu-bar-agent.ts:1020-1026` `handleSummonerClosed` = invalidate + `releaseAllOverlayComposerLeases`，**无 abort**。注释 `:1153-1154` 明确 never chat.abort。overlay LLM 走 `summonerClient` WS，hide **打不中** `lifecycle.ts:1418` 的 `abortLlmLoopsForPanel`。
- `adapter.ts:127-158` 无 `surface`；`:619-623` 全量 catalog ∩ whitelist（null=全开）；`:1271/:1528` `executeTool` + `list_tabs` 恢复仍跑。`message-router.ts:428` `stampedSurface` 未传入 `:674/:1189/:1575`。
- `summoner-acl.ts:42-43` ALLOW 含 `mcp.toggle_server`。`summoner-web.ts:60` DISPATCH 亦含；`:628-636` POST `/api/mcp/toggle`；`:2305-2306` 隐藏轨仍 POST。`menu-bar-agent.ts:1634-1636` tray 绕行；`:894-910` HUD toggle。`SummonerOverlay.swift:682-712` `mcpRowClicked`/`mcp.add`。
- SoT：`2026-08-26-summoner-strategy-rethink-design.md:167`、`product-form-deepening-design.md:346`、`post-227-status.md:49` — **overlay-acl-rollback = 从 SUMMONER_ALLOW 删冻结的 toggle/activate**（Security 倾向删，本季冻）。strawman L40「rollback=把 toggle 加回产品面」**定义反了**。HTTP 4xx ≠ ACL rollback。
- `KnowledgeSubPanel.tsx:679,727-770`：`tooBigToExport` 只禁下载「无法下载」；Save 仍 confirm 发 body。`skill-engine.ts:1452-1503` get 截断、update 全文写。`handlers/knowledge.ts:45-53` 无 truncated 闸。
- `darwin-estop.ts:28` `/tmp/cmspark-estop.sock`；`:174-180` CONNECT-first = ok。`host.swift:517` Aqua 写死 `/tmp`；`host-skylight.swift:602` 默认同路径。08-01 合同是 Aqua 子进程 + 长连 EOF，不是 bug。
- `composer-lease.ts`（`ws/composer-lease.ts`）与 `abortControllers` 是两张图：overlay 占租约 **不会** 改 `llmLoopOwnerPanel`（`message-router.ts:563`）。`abortThreadChat(lease.thread_id)` 会杀掉同线程上 **panel 拥有的** in-flight Operate。
- 目录不止五名：`tool-definitions-catalog.json` 含 `list_tabs`/`navigate`/`click`/`get_cookies`/`host_*`/`spawn_worker`/`workspace_*`/`acp_*`/`get_page_html` 等。overlay-eligible `tools.mode=unchanged` 使 whitelist 仍可为 null（`pack-engine.ts:702`）。
- CI 锁死后门：`summoner-web.test.ts:1171-1179`、`summoner-workbench-compose.test.ts:43/185-226`、`summoner-acl.test.ts:67`。

**被推翻/降级的针：**

- strawman「A3 从 ALLOW 去掉 mcp.toggle_server」= #230 overlay-acl-rollback → **必须折掉 ALLOW 变更**；改拆路径。
- strawman B1「patch.body 字节 < 磁盘则拒」→ **必须换成 truncated-only**（针 4）。
- strawman A3-1 五名列表 → **必须换成完整执行器集 + exec 硬拒**。
- strawman/Impl「hide → abortThreadChat(租约线程)」→ **必须换成 overlay session 面 abort**。
- Impl「反转 summoner-acl.test.ts 为 ALLOW 不含 toggle」→ **不折**；只反转路径测。
- computer-host-02（Darwin 降级热键仍允许 CU）保持 **假/合同**，不进 A/B。

四路皆 PASS* 且 BLOCK 可折 → **overall_verdict = PASS_WITH_CHANGES**。任一未折的 BLOCK 会把路径打回 REJECT。

## 2. 必须折进路径的针（folded pins）

1. **A1 XSS：** 属性转义（含 `"`）或 `a.href=` DOM 赋值；禁止 `href=""+u`；`javascript:` 仍拒绝。encodeURI 不是 A1-1。
2. **A1-3 CSP：** 先关 markdown sink。token 仍在 `--app` argv（Batch D）会放大 XSS，故 **A1 必须先于 D**。nonce 内联 SPA，**或** 仅 DOM 建链后才保留 `unsafe-inline`；二者不可「OR 成拼接 href + unsafe-inline」。
3. **A2 关闭路径：** `hideSummonerWebShell` 与「最后一个 SSE client close」走同一幂等 `handleSummonerClosed`。
4. **A2 abort 键：** `abortLlmLoopsForPanel(overlay 的 panelId/session)`，**禁止** `abortThreadChat(lease.thread_id)`。不中止 panel 拥有的回路；不把 overlay busy 转交给侧栏。释租约仍要做，否则侧栏永 `OVERLAY_STANDBY`。SSE-only 跳过 pagehide 时也结束 overlay meeting/stt。
5. **A3-1 真 L0：** `ChatCreateParams.surface` 只收 router `stampedSurface`（已在 `message-router.ts:428` 剥离客户端字段）。三处 `chatCreate` + `drainNextRun` 都 stamp。adapter **同时** 裁 offer 与 exec（含 `list_tabs` 恢复路径）。禁止只在 router 复制一份 catalog。禁止 `validate.ts` 给 `chat.create` 加客户端 `surface`。
6. **A3 执行器裁切：** 完整 native 执行器（CDP/cookies/host/shell/spawn/workspace/acp/get_page_* / screenshot/evaluate/osascript_eval…），不是五名 denylist。`executeTool` 对召唤器面 **硬拒** 这些名字（幻觉或 whitelist=null 也不跑）。`L2_GATE_TOOLS` 仍服务 Operate/侧栏；overlay **永不** Allow/Deny。
7. **A3 MCP 路径 vs ACL：** 删除 POST `/api/mcp/toggle`、从 `SUMMONER_WEB_DISPATCH_ALLOW` 去掉 `mcp.toggle_server`、拆 `dispatchSummonerWeb` 的 tray `companionClient` 绕行、Swift `mcpRowClicked` / `mcp.add` / `handleSummonerMcpToggle|Add` 变为 4xx/no-op。`mcp.list` 保留。MCP 轨保持 hidden（hide-not-delete）。**不修改 `SUMMONER_ALLOW`。** 这是拆隐藏后门（overlay-summoner-03），**不是** #230 overlay-acl-rollback。
8. **A3 文案：** `summoner/client.ts` 的 `SUMMONER_L0_CHROME_DOWN` / `SUMMONER_CDP_NEEDED` / renter 改为 Capture=可以继续聊、Operate=打开侧栏。保留 `operateOpen`。空态「附件和听写不用开浏览器」保留。不得承诺 attachChrome 之后 overlay 操作网页。不得宣称 Capture 无副作用（若仍跑 `mcp__*`，只有 `MCP_OVERLAY_CONFIRM_NOTICE`）。
9. **A3 组合绑定：** `pack.apply` / `skill.activate` / `skill.deactivate` / `knowledge.set_active` 的 `thread_id` 必须等于 overlay 租约线程（holder===overlay）。`skill.activate` **不写** `skill_selection_mode`（切片 6）。隐藏 pack/skill 轨仍是 USE-on-current-thread，不是 Operate。
10. **CI：** 反转 `summoner-web.test.ts`、`summoner-workbench-compose.test.ts` 的 **dispatch/HTTP/Swift** 断言为 toggle 路径 ABSENT。`summoner-acl.test.ts` **保持** ALLOW 含 `mcp.toggle_server`（冻结）。新增 adapter surface deny 与 hide→lease+abort 测。A3-1 机核是 `handleMessage(stamped summoner)` 的工具名，不是伪造客户端 surface。
11. **B1：** `truncated===true` 时 UI 不 POST body（可禁整颗保存或省略 body 只改标题/标签）；服务端按「上次 getKnowledge truncated（或无完整读 token）」拒 body，**不是** 长度比较。未截断短文替换仍允许。DoD 文案 ≠「无法下载」。文件地图补 `message-router/handlers/knowledge.ts` 与 chrome-extension 测。
12. **B2：** `darwin-estop.ts` + `host.swift` `launchAgentTrayAndExit` + `host-skylight.swift` + `startTrayOwnedEstopBestEffort` 锁步 `--socket-path`。套接字进 `DATA_DIR`（或 0600 + getpeereid / nonce）。预绑 DATA_DIR 套接字也 fail-closed。证明-of-life = 长连 EOF，不是 CONNECT-first。拒绝匿名 `/tmp`。检查 `sun_path` 104。测离开生产 `/tmp`。不改热键/TCC 合同；daemon-spawn 不是打包 happy path。
13. **PR 形状：** Batch A = **一张 PR、三个 commit（A1/A2/A3）**。禁止三张 stacked PR 抢 `summoner-web.ts`+`menu-bar-agent.ts`。不拆 `message-router.ts`。预算：三处 stamp + 租约线程绑定；工具裁切活在 adapter。
14. **mcp__*：** 允许 fail-closed 从 overlay LLM catalog+exec 省略；**不得**声称 F-S-10 完成；**不得**加 overlay MCP confirm 方言；**不得**用 overlay 管 MCP 掩盖 #230。

## 3. 修订后的批次 A/B/C/D/E

| 批 | 名 | 体检 id | Blast | 合入后用户能看见 | #245 范围 |
|----|----|---------|-------|------------------|------------|
| **A** | Capture 面 | overlay-xss · overlay-summoner-01 · x-architecture-01 · overlay-summoner-03 · orchestrator-packs-02 | T3 | 卡上 markdown 打不穿；关卡停 overlay 回路且侧栏不卡；对话无 CDP 执行器；用户够不到 MCP 开关；pack/技能只动当前卡对话 | **是（主线）** |
| **B** | 完整性 | knowledge-loop-01 · computer-host-01 | T2/T3 | 截断知识不能保存丢尾；estop 不再信匿名 `/tmp` | **是（主线）** |
| **C** | 宿主 P1 | bridge-tools-01 · mcp-01 · computer-host-03 · computer-host-04 · orchestrator-packs-01 | T3 | 另票 | **否**（只列序） |
| **D** | 运行时 P1 | orchestrator-packs-03 · x-correctness-abort · x-integration-01 · overlay-token-csrf · llm-adapter-01 | T2 | A 合后再开 | **否** |
| **E** | P2 | handshake-surface · ops-packaging · x-tests-cluster · x-architecture-drift | T1 | 不挡狗食 | **否** |

**本季主线只锁 A+B。** #228 / #229 / #230 整票不并入。可选：B 另开兄弟票，让 #245 只含 Capture；仍 **A 先于 B**，永不把 C/D/E 混进 A PR。

### 批 A 内部顺序（同一 PR，三个 commit）

1. **A1 XSS** — 属性转义 + DOM 建链 / nonce CSP。先着陆：token-in-argv 会放大 XSS。
2. **A2 hide→closed** — hide 与 last-SSE 走 `handleSummonerClosed`：先 abort overlay 面回路，再 invalidate session、`releaseAllOverlayComposerLeases`。
3. **A3 真 L0** — stamp surface；adapter 裁+拒完整执行器；拆 MCP **变更路径**（不动 SUMMONER_ALLOW）；pack/skill/knowledge 绑租约线程；重写 Capture/Operate 文案。

A3 **不是** overlay-acl-rollback。回滚票的 SoT 含义是「从 ALLOW 删除冻结项」；本批禁止做那件事。本批是「藏着的 HTTP/tray/Swift 后门拆掉」。UI 已藏的 MCP 轨保持藏。`skill.activate` 不写 `skill_selection_mode`。

overlay MAY 仍保留：`chat.create/steer/abort`、`file.upload`、`voice.stt.*`、`meeting.*`、`thread.list/select/create`（trash/alias）、`mcp.list`。不要把这些 HTTP 路由当「L0」删掉。

### 批 B 内部顺序

1. **B1 知识截断** — 针 4：truncated 禁 body；未截断短保存允许。下载路径已禁，不动。
2. **B2 Darwin estop** — 只换 socket 位置与鉴权；Aqua 子进程 + 长连 EOF 合同不动。

B1 与 B2 无文件重叠，可两 PR 并行（worktree），但 **A1 合入前不宣称 Capture 狗食安全**。A+B 合入后仍不宣称 CU/estop 已是产品闭环，也不宣称 F-S-10 完成。

### C/D/E（顺序承诺，非本票）

- **C：** `osascript_eval` tab 绑定；MCP stdio env 预览/denylist；shell allowlist 解析后拒 `-c/-e`；`CMSPARK_WIN_SCRIPTS`；`spawn_worker` HMAC 绑 allow/deny/intent。**禁止拉进 A。**
- **D：** SkillEngine 快照写 index；WS close abort 完整性；token 出 argv（cookie/header）+ Origin 收紧；围栏截断。A1 已降 XSS 放大面之后才能动 token。
- **E：** handshake surface Origin 盖章；打包；测试簇；架构漂移（含拆 message-router — **本路径永不拆**）。

## 4. 修订文件地图（A+B）

| 文件 | 批 | 做什么 |
|------|----|--------|
| `companion/src/summoner/overlay-md.ts` | A1 | 属性转义或 DOM `a.href=`；禁止 raw concat |
| `companion/tests/overlay-md.test.ts` | A1 | 引号突破负例 `[x](https://evil/"onclick="…)` + `javascript:` 回归 |
| `companion/src/summoner-web.ts` | A1–A3 | CSP；hide+last-SSE→closed；删 `/api/mcp/toggle`；DISPATCH 去 toggle；L0 文案；loadCompose mcp 点了也 4xx |
| `companion/src/summoner/client.ts` | A3 | 重写 L0/CDP/renter 字符串 |
| `companion/src/menu-bar-agent.ts` | A2–A3 | `handleSummonerClosed` abort overlay 面再释租约；去掉 toggle/add 的 companionClient 活路径 |
| `companion/src/tray/SummonerOverlay.swift` | A3 | `mcpRowClicked`/`mcpAddClicked` no-op；行保持 hidden；不要 unhide |
| `companion/src/llm/adapter.ts` | A3 | 可选 `surface`；summoner 裁 offer + exec 硬拒；既有测默认非 summoner |
| `companion/src/message-router.ts` | A3 | 三处 chatCreate + drainNextRun 传 stampedSurface；pack/skill/knowledge 绑 overlay 租约线程。**不拆文件** |
| `companion/src/ws/summoner-acl.ts` | — | **本批不改 ALLOW 集合** |
| `companion/src/ws/validate.ts` | — | **不加** 客户端 surface |
| `chrome-extension/.../KnowledgeSubPanel.tsx` | B1 | truncated 不发 body；文案不是「无法下载」当保存错误 |
| `companion/src/skills/skill-engine.ts` | B1 | truncated/缺完整读则拒 body |
| `companion/src/message-router/handlers/knowledge.ts` | B1 | update 闸：truncated 拒 body |
| `companion/src/computer/darwin-estop.ts` | B2 | DATA_DIR（或 0600+getpeereid）；CONNECT≠armed |
| `companion/src/host-use/darwin/host.swift` | B2 | Aqua spawn `--socket-path` 与 Node 锁步 |
| `companion/src/host-use/darwin/host-skylight.swift` | B2 | 默认同路径，不再回落匿名 `/tmp` |
| 测：`summoner-web/workbench-compose/acl/adapter/overlay-session/darwin-estop` + knowledge-crud-ws + chrome-extension | A/B | 见 §5 |

## 5. 外部可观察 DoD（机核）

### A1

| ID | 观察 | 机核 |
|----|------|------|
| A1-1 | `[x](https://evil/"onclick="alert(1))` 渲染后 **没有** 属性断出 `href` | `overlay-md.test.ts` 新负例 |
| A1-2 | `javascript:` 仍拒绝 | 现有测仍绿 |
| A1-3 | overlay CSP 不再 `script-src 'unsafe-inline'` **或** 链接只经 `a.href=` 且无 inline handler | grep CSP + 测 |

### A2

| ID | 观察 | 机核 |
|----|------|------|
| A2-1 | hide 之后 overlay composer lease count = 0 | spy `releaseAllOverlayComposerLeases` |
| A2-2 | 侧栏不再因 hide 永久 `OVERLAY_STANDBY` | 状态机断言 |
| A2-3 | SSE-only 断开也走同一关闭路径 | 单测 |
| A2-4 | hide 中止 **overlay 拥有的** LLM 回路；同线程 panel 拥有的回路仍在 | spy `abortLlmLoopsForPanel`；负例：`abortThreadChat(lease.thread_id)` 不得作为唯一实现 |
| A2-5 | 用户可见：关掉卡停止本轮 overlay 回路，不把 busy 交给侧栏 | 测 + 文案/注释锁针 |

### A3

| ID | 观察 | 机核 |
|----|------|------|
| A3-1 | stamped summoner `chat.create` 的 LLM 工具名不含完整执行器集（至少 `list_tabs`/`navigate`/`screenshot`/`evaluate`/`get_page_text`/`get_page_html`/`click`/`osascript_eval`/`shell_exec`/`host_computer`/`spawn_worker`） | `handleMessage(stamped summoner)`，不是客户端 surface 字段 |
| A3-1b | 幻觉/whitelist=null 时 `executeTool("list_tabs")` 仍硬拒 | adapter 测 |
| A3-2 | `POST /api/mcp/toggle` → 4xx；DISPATCH 无 toggle；tray 绕行消失；Swift toggle/add 无活 dispatch | HTTP + grep；workbench 测 ABSENT |
| A3-2b | `SUMMONER_ALLOW` **仍含** `mcp.toggle_server`（冻结） | `summoner-acl.test.ts` 保持 |
| A3-3 | overlay `pack.apply`/`skill.activate` 带其它 `thread_id` → 错 | 单测 |
| A3-4 | overlay `skill.activate` 不写 `skill_selection_mode` | 现有测仍绿 |
| A3-5 | Capture CTA 不再承诺 overlay 操网页；Operate 门仍是 `operateOpen` | `summoner/client.ts` + HTML 文案测 |

### B1 / B2

| ID | 观察 | 机核 |
|----|------|------|
| B1-1 | `truncated:true` 的 Save 不发 body 或 Companion 回错且磁盘字节不变 | companion knowledge-crud-ws/skill-engine + `npx tsc -p tsconfig.test.json && node --test .test-dist/tests/*.test.js`（或 `npm --prefix chrome-extension test`） |
| B1-2 | 未截断的短正文替换仍允许 | 正例测 |
| B2-1 | 预绑无关 `/tmp/cmspark-estop.sock` 之后 `ensureEstopHelper` **失败**（只认 DATA_DIR 身份） | darwin-estop 测（可 mock net） |
| B2-2 | 预绑无关 **DATA_DIR** 套接字同样 fail-closed（nonce/getpeereid） | 同测 |
| B2-3 | Swift 与 Node 的 `--socket-path` 一致；测不依赖生产 `/tmp` | grep + `computer-darwin-estop-owner.test.ts` 改道 |

**测先于码（TDD）。** companion: `npx tsc -p tsconfig.test.json && node --test .test-dist/tests/<file>.js`。实现 agent 不得自评放行。每批独立对抗 → kimi+claude dual APPROVE* 才 PR。

## 6. NEVER

- overlay Allow/Deny，或 overlay 确认方言（允许/拒绝）出现在卡上；`openConfirm` 只是 notice+Chrome
- 扩 #228 profile / cookies / evaluate / L2 / shell 进默认租手
- #229 WorkBuddy 五轨、HUD 导入当产品、`NSApp.activate` 整票
- #230 F-S-10 宣称完成、**overlay-acl-rollback（改 SUMMONER_ALLOW）**、RunProgress 自动勾、grant-cli
- 用 overlay 管 MCP 来「修」F-S-10；unhide MCP 轨当 L0 诚实
- 拆 `message-router.ts`；改 live `~/.cmspark-agent/config.json`
- 只做 adapter.surface schema 过滤而不做 executeTool deny（「不能操浏览器」会是谎）
- 只在 router 滤工具（神文件 + catalog 漂移）
- 客户端 surface 进 `validate.ts` `chat.create`
- 三张 stacked PR 抢 `summoner-web.ts`
- A1 单独合入后宣称 Capture 已闭合 / 安全狗食
- hide = minimize / continue-in-sidepanel 把 busy 交给侧栏
- `pack.apply`/`skill.activate` 打非 overlay 租约线程
- 把 daemon-spawn estop 当打包 happy path；把 CONNECT 成功当已武装
- 把 spawn_worker token-bind 或 shell allowlist 解析修复拉进 A
- 用 overlay MCP toggle 掩盖 F-S-10

## 7. KEEP（四路共识，不改）

- A 内部顺序 XSS → hide-lease → 真 L0；A 先于 B；C/D/E 列出但不进 #245
- hide 中止 overlay LLM，不交接 busy；必须释租约
- overlay MAY：问答 / 附件 / 听写 / 会议 / 历史 thread.list / mcp.list / operateOpen
- 空 Capture 脸 + operateOpen 作为 Operate 门
- L2 门仍给 Operate/panel；estop 长连 EOF 合同；computer-host-02 不是缺陷
- 切片 6：`skill.activate` 不写 `skill_selection_mode`
- token-in-argv 留 D；spawn HMAC 与 shell 引号绕过留 C

## 8. 对抗针（锁定）

1. A3 裁工具不误伤问答/附件/听写/会议 — 保留 chat、file.upload、voice/meeting、thread.list/select/create、mcp.**list**。
2. hide 时 overlay 正在跑 LLM：**中止 overlay 面回路**，不把 busy 偷偷交给侧栏；也不误杀 panel 面回路。
3. estop 改路径不破坏 08-01 TCC：证明-of-life 仍是长连 EOF，只换 socket 位置与鉴权。
4. 知识：truncated 禁 body；未截断的短保存仍允许。

## 9. 实现闸

- **现在不允许实现。** 等 kimi+claude dual 都给出 APPROVE / APPROVE_WITH_CHANGES 且本合成的 must_fold 被 dual 吸收。
- dual 若把任一条 BLOCK 打回且无法折 → 路径 REJECT，不得开工。
