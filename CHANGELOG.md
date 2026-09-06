# Changelog

格式大致遵循 [Keep a Changelog](https://keepachangelog.com/)。版本号与 `companion/package.json` / `chrome-extension/package.json` 对齐。

## [Unreleased]

## [0.6.5] — 2026-09-07

召唤器「五条需求」补齐波次（#433 P1/P2/P3 + #439，多 lane 并行 + 逐 PR 对抗复审）：召唤器从「命令面板壳」变成真正能读历史、控插件、跑后台任务的独立入口；AI 在任意对话里也能主动检索历史与知识。

- **召唤器接脱敏检索（#433 P1）**：命令面板数据层从本地标题匹配升级为真检索——输入即查（150ms 防抖 + 代际守卫防迟到回包盖新状态），结果带摘要 snippet；方向键选中线程 → 脱敏蒸馏预览；「引用进新任务」把该线程以摘要卡带进新对话（LLM 只见蒸馏，不见原文）。[#433](https://github.com/nehcuh/cmspark/issues/433)
- **召唤器控制面（#433 P2）**：`ui.command` 白名单推送帧五动词——打开侧栏 / 打开确认台 / 打开浏览器 / 面板新建对话 / 打开内嵌终端 tab（联动 #432）；档位从召唤器只可**降档**（收紧免确认），升档必须去面板确认台。[#433](https://github.com/nehcuh/cmspark/issues/433)
- **召唤器后台任务（#433 P3）**：命令面板新增「后台任务」动词——任务句 + user_gesture + 当前线程租约，三重闸全保留（plan 档拒、确认仍回确认台，overlay 零新确认 UI）；浏览器后台执行复用 loop/SITE_OP/CU 升级链零改动。[#433](https://github.com/nehcuh/cmspark/issues/433)
- **LLM 历史/知识检索工具（#439，70mj33 实证）**：catalog 新增 L1 只读 `search_threads` / `search_knowledge`——在召唤器或侧栏里问「我今天聊了什么」「有没有关于 X 的笔记」AI 真的能查了。复用脱敏检索内核（标题/摘要/tags，永不回消息原文），默认 5 条上限 10，plan 档可用；与 `thread_recall`（本线程旧轮次）分工写进 prompt。[#439](https://github.com/nehcuh/cmspark/issues/439)

## [0.6.4] — 2026-09-06

- **内嵌终端（#432，对标 Zed Terminal Threads）**：插件内真 PTY 终端——全页 tab 跑 xterm.js（canvas 渲染，MV3 安全），companion 用 @lydell/node-pty（prebuilt）托管真 shell；I/O 复用既有 WS（16KiB b64 帧 + write-ack 水位反压 + 25s keepalive）。权限面：默认关（设置「编程助手」里显式开）、每次开门 user_gesture + L2 确认（巡航/无人值守不豁免）、plan_readonly 线程拒开、同时最多 1 个会话、起始 cwd 约束、env 剥离 CMSPARK_*/密钥、审计不含击键流。P0 为裸 login shell；Mode C「内嵌 agent TUI」在 P1。[#432](https://github.com/nehcuh/cmspark/issues/432)
- **召唤器命令面板化 + UI 高级化（#433 P0+P1）**：召唤器从聊天框升级为 Raycast 式命令面板——三段式（动词 frecency / 历史·知识命中 / fallback「问 AI」），720 宽、行高 44、150/120ms 动效、NSTableView 虚拟化、CJK IME 修复、全屏 Space 可见。新增三条服务端脱敏检索（thread.search 只搜标题/摘要/标签不读正文、thread.peek 蒸馏预览 ≤2000 字、knowledge.search 复用派生索引），拼音首字母匹配。零新 L2 类；overlay 仍永不渲染确认；后台任务 arm 留 P3。[#433](https://github.com/nehcuh/cmspark/issues/433)

## [0.6.3] — 2026-09-06

- **内容风控 400 不再误杀对话（#430，4zi17x 实证）**：DeepSeek 等内容审核拒绝（`400 Content Exists Risk`）是确定性错误，原先被当瞬时故障——同一 payload 重发 5 次全部 <200ms 瞬挂，烧光熔断预算杀死对话。现在单列一类：首次命中隔离「最近的大型工具结果」（最可能触发源，内存 + 持久化历史同步替换，下次 run 不再重发）并重试一次；二次命中或无可隔离对象立即致命，给出中文可操作文案（新开对话/调整描述/换模型）。恢复全程不透英文 400 原文帧；`isContentRiskError` 钉 400 状态，5xx 网关含 content-filter 字样仍走原 recoverable 路径（零改动）。[#430](https://github.com/nehcuh/cmspark/issues/430)

## [0.6.2] — 2026-09-06

- **低语料知识图谱：AI 整理 lane（#427，用户实测 4 篇死面板）**：图谱画布闸与 #273 聚类闸解绑（`KNOWLEDGE_GRAPH_MIN_DOCS=1`）——2–19 篇不再只有「知识不足 20 篇」死文案：画布直接画节点 + TF 实线边（可能诚实散点）+ CTA「让 AI 整理现有 N 篇」。点击后一次批式 LLM（仅 title+tags+description，不进正文）出分组 + 命名/摘要 + 关联洞察（虚线 +「AI 关联」+ 可查 reason）；`organized` 信号区分「未整理」与「AI 判无结构」（后者散点 +「AI 未发现明确关联」，不再复发 CTA）。分组锁（「保留这版分组」）= 图谱着色 overlay，跨 20 篇切换 TF 着色后仍存活、不进聚类输入；防抖重建 carry-forward 不失效。指纹（id/title/description/tags）漂移只标 stale 不自动重跑；organize 失败走 ok 帧 + 中文错误条（不碰 #356 error 合同）。红线：`KNOWLEDGE_CLUSTER_MIN_DOCS` / `scoreRelatedKnowledge` / ≥20 TF 路径零改动；无自动 LLM 触发。[#427](https://github.com/nehcuh/cmspark/issues/427)
- **peek 拒执不吃熔断预算（#425，gbkq2q 实证）**：SITE_OP_BANNED / SITE_OP_ESCALATE（peek 拒执，工具未执行）不再递增同工具 recoverable 熔断计数——此前「1 次真实超时 + 2 次封禁提示」即误杀对话；origin 已升级时熔断解锁指引覆盖所有工具（不再限 osascript/host_computer）。第二道闸不变：L-3 路线引擎跨 run steer ×2 无视 → blocked。[#425](https://github.com/nehcuh/cmspark/issues/425)
- **全历史专家归纳打磨（#418）**：草稿恢复「AI 建议工具（不预勾）」展示（suggested_tools 透传）；候选池先按元数据截 cap 再读消息体（大库不再全量读）；扫描期间批次进度事件上屏（「全历史归纳中：批次 n/m」）；批内聚类/归并 prompt 经真实 LLM 三轮实证调优（超时 150s/240s、evidence 并集兜底、silent-zero 诚实 fallback）。[#418](https://github.com/nehcuh/cmspark/issues/418)

## [0.6.1] — 2026-09-06

0.6.0 发版当日的修复与能力波次（多 lane 并行开发 + 逐 PR 独立对抗复审）：**#404 测试污染事故闭环**（config 路径全 live 化）；**失败升级链修复**（#409，uokwyw 实证四断点）；**outbound MCP 三件**（Grok 兼容短名、双轨同名、interact 命名 profile）；**全历史专家抽取**（#411）。

### 事故修复：测试污染真实配置（#404 #405 #406 #412）

- **config.json 读写全 live 化（#404/#405）**：`settings-web-tokens.test.ts` 静态 import `settings-web` → `config.ts` 在 `before()` 设 `CMSPARK_DATA_DIR` 前冻结 `DATA_DIR` 为真实 home，测试夹具（sk-test/https://x/m/port 23491）覆写真实 `~/.cmspark-agent/config.json`，致 0.6.0 启动 model_probe 失败 + tray 硬编码 `WS_PORT=23401` 探测失败误报「已停止」。修复：9 处 config.json 路径 + initDataDir 内 3 处 + getLogDir 全部改走 live `getConfigDir()`。[#404](https://github.com/nehcuh/cmspark/issues/404)
- **残余冻结点清扫（#406/#412）**：`getPidFilePath()`、outbound-grants `GRANTS_PATH`、ws-auth secret/.paired、obsidian 三缓存路径全部 live 化；**tray 端口探测改读 `getConfig().port`**（`resolveWsPort()`，非法回退 23401），端口漂移时 `syncCompanionClientPort` 重定向两个持久 WS client——用户改端口后 tray 不再误报。残余：Tray.swift 显示串硬编码 :23401（需 Swift 重编译，另票）。[#406](https://github.com/nehcuh/cmspark/issues/406)

### 失败升级链（#409 #414）

- **uokwyw 四断点修复**：CDP 连败 origin 封禁后——(A) 未武装 CU 时升级文案不再撒谎说「MAY call host_computer」，改指 `loop_declare_blocked` + 解锁路径（linux 分支同步：CU 永不可用，`suggested_action` 恒 `declare_blocked`）；(B) `closeRouteRun` 只把**成功**的 host_computer/osascript 记为已换路，失败不再清 staleRuns——`r3-unarmed`「请打开坐标 CU」解锁合同能浮出；(C) `host_computer` zod schema 补 optional `trigger_reason`（对齐 catalog，第一次升级调用不再死于 `.strict()`）；(D) 熔断 chat.error 在 origin 已升级时附解锁指引（设置→坐标计算机使用 / 换任务）。loop 仍**永不**自动打开 coordinateEnabled。[#409](https://github.com/nehcuh/cmspark/issues/409)

### outbound MCP（#407 #408 #410 #419）

- **租手 stdio `tools/list` 短名（Grok `tool_count: 0`）**：Grok 把 MCP 工具写成 `server__tool` 且合格名只允许一个 `__`。旧 `mcp-outbound` 直接暴露 `cmspark__list_tabs`，Grok 再前缀成 `cmspark__cmspark__list_tabs` 后丢掉全部工具——`grok mcp doctor` 仍报 10 tools / healthy。`tools/list` 改为短名（`list_tabs`）；`CallTool` 短名与 `cmspark__*` 都收。HTTP invoke / 默认 profile 白名单不变，**不扩** outbound L1。
- **租手 HTTP invoke 与 stdio 双轨同名（#408）**：`companionInvokeOutbound` 入口套同一 `canonicalOutboundMcpName`，短名（`list_tabs`）与 `cmspark__*` 均可；短名 exfil 仍走 grant 门（`DISCLOSURE_NOT_GRANTED`）。非法格式 vs 真不在 profile 的 `PROFILE_FORBIDDEN` 文案分开；审计记 `tool`（canonical）+ `wire_name`（原始名）。**不扩**默认 outbound L1。[#408](https://github.com/nehcuh/cmspark/issues/408)
- **outbound `outbound_l1_interact` 命名 profile（#410，同层补全）**：默认 8 工具 + 2 meta **逐字节不变**；interact 档 = 默认 ∪ {scroll / get_element_info / press_key / select_option / hover / dblclick / fill_form / drag_and_drop / create_tab / get_page_html / analyze_image}，`outbound-grant issue --profile outbound_l1_interact` 显式索取。DOM/像素读（get_page_html / analyze_image）入 exfil 类，**复用** `allow_page_export` 门（不拆新旗）。HTTP 轨按钥匙 profile、stdio 轨按 caller live grant（同 exfil 双轨）；stdio `tools/list` 经认证 `/outbound-mcp/v1/profile` 按钥匙裁剪（fetch 失败降级默认集）。**豁免旗不溅射（收紧）**：auto_approve_dangerous / god-mode / auto_approved_domains 对 outbound 一律无效——auto-approved 域仍确认台、非 http(s) 仍硬拦；outbound 只认 grant per-key 旗 + 操作者 HITL。[#410](https://github.com/nehcuh/cmspark/issues/410)
- **interact 残余三项（#419）**：(1) stdio profile **懒重拉**——companion 晚于 mcp-outbound 启动时不再终身降级默认集：tools/list / CallTool 在降级态且距上次 fetch ≥30s 时重试（有界 ≤5 次），成功即升级广告集与本地门，失败仍默认集不拓宽；(2) 扩展设置页签发 grant 加 **profile 下拉**（outbound_l1_default / outbound_l1_interact，走既有 issue 通道 profile 字段）；(3) HTTP 形状预检 **allowlist 感知**（#413 复审 P2-1）——预检不再拒「任一已知 profile 上已授权」的工具（未来 camelCase 成员不会被 HTTP 轨误拒而 stdio 放行），非法格式 vs off-profile 的文案分层保留，HTTP/stdio 双轨对同一 wire name 同 allow/deny 判定。默认档语义与内容均不变。[#419](https://github.com/nehcuh/cmspark/issues/419)

### 专家模式（#411 #416）

- **全历史专家抽取（方案 A 两级聚类）**：专家段新增「📚 从全部历史归纳专家」——一次性确认弹窗（写明 N 条摘要发所配 LLM + 时间窗/关键词预排除，count_only 零 LLM）→ 候选池（沿用 #370 skip 规则，cap 200）→ 浅层画像（fresh digest 优先，否则首末 user preview，全 redact，不读全量正文进 LLM）→ 25/批出候选角色（companion 硬校验 ≥2 有效线程、伪造 id 丢弃）→ 按需深读 ≤20 条（既有 8k cap + 脱敏）→ 跨批归并 + 与已装专家去重（名字精确或工具面 Jaccard≥0.8 → conflicts_with「覆盖/另存」用户裁决）→ K≤5 份草稿进内存 pendingDrafts（不落盘、不自动保存、重启即丢），草稿队列「上一份/下一份」逐份进同一编辑器手动保存。无定时器、无后台扫描（watermark 增量另票）。LLM 调用数 = 批次数+1 归并，与线程数解耦。[#411](https://github.com/nehcuh/cmspark/issues/411)

## [0.6.0] — 2026-09-06

0.5.9 之后的大波次：**消费者级侧栏 UI 重构**（#321 系列——状态带合并、消息行降噪、空态/作曲同脸、Cockpit 抢焦点收敛）；**自主性三件套**成链——Composer 巡航档位选择器（#325）、plan_readonly 计划模式（#327）、L-1/L-3/L-5 无人值守 loop（#386–#391，默认仍 off）；**专家团队 v1**（#366–#371：`kind=expert`、七个预置角色、一张 L2 卡组队）；**CU 完整性链**（#359–#362：Qwen3-VL sha256 钉死 + held-out 评测门）；**跨平台诚实化**（darwin host follow-ups、CDP 失败升级建议、grant 审计）。L2/ACL 边界零扩张，execution_contract 仍 shadow（#328）。

### 自主性：巡航档位 / 计划模式 / loop（#325 #327 #386–#391）

- **L-1 完成谓词 + stall-classifier（#387，史诗 #386 首票，T1 零自动执行）**：`companion/src/loop/` 纯函数信号库——双层完成谓词（全 evidence-tick ∧ 收口轮无 tool_calls ∧ 无未决 confirm/nonce；claim⊆tick 交叉核验，被拒 steer 直指未勾项；四态 verdict：complete / claim-rejected / request-claim / incomplete）；受阻五分类（needs-human-confirm / needs-credential / external-wall / route-exhausted / model-noncompliance）+ 机器可读解锁契约（试过路线/败因/解锁条件，每类有完成通道）；progress ledger 连续 K=3 个 run Δ=0 → stalled 信号（干预归 #389）；stall 卡数据结构（渲染归 #390）。`complete` 仅机检信号，L-4 映射为 DONE 报告待用户终审，永不当「任务已完成」文案；click success tick ≠ 表单过关（残余风险，默认档用户终审兜底）。不改 run_progress 勾选语义；execution_contract 保持 shadow（#328）；不挂 adapter、不触发续跑（#388）。[#387](https://github.com/nehcuh/cmspark/issues/387)
- **L-3 换路引擎（#389）**：route-directive steer（originFails≥4 后连续 2 run 无替代路线且无 tick → 注入定向指令）+ `loop_declare_blocked` 受阻申报；steer 两次无视 → 项 `model-noncompliance` blocked。策略链 R1 CDP-DOM → R2 CDP 备选 → R3 host_computer → R4 osascript → R5 human；**R3 资格 = escalation ∧ `computer.coordinateEnabled`**，未武装则 blocked + 解锁契约（loop **永不**打开 CU）。换路预算：每项 cross-class ≤2、steer ≤2、总 steer ≤ runs/2。blocked 聚合为 IMPOSSIBLE 报告；匹配解锁动作后 checkpoint 恢复。只关门/指令/申报，不强制调工具；evaluate / spawn_worker / 开模块不进链；每跨类仍走既有 L2。复用 #357 originFails，不改计数器。[#389](https://github.com/nehcuh/cmspark/issues/389)
- **L-5 无人值守 loop + #326 叠加（#391，T2，loop 收官）**：值守 loop 下 NEVER 清单确认 45s 超时 deny → **该项 blocked**、其他项继续、终态出钥匙清单（**45s fail-closed 不改、不 auto-allow**）。focus lease 与 `llm-loop-gate` 分层：同一时刻仅一个 loop/worker 持有 CU 驱动权，后来者排队（`CU_FOCUS_LEASE_QUEUED`）；`COMPUTER_TASK_BUSY` 执行互斥零改。blocked 报告 tray 徽标 + Board intent 呈面，`steal_focus:false`（cockpit `loop_blocked` → stay_background）。值守终态文案 **「计划完成待复核」** + evidence digest 进 `capability-audit.jsonl`（无 claim / 无正文）。grant TTL 到期 → `paused`（可显式 re-arm 恢复，loop **不延长** grant TTL）。deny-storm ≥3 次 loop 主动 pause。用户回场触碰输入走既有 re-L2，loop 不死。值守默认仍 off。[#391](https://github.com/nehcuh/cmspark/issues/391)
- **L-5 round-2（#402 对抗 MAJOR）**：drain 门 TTL-pause 不再 `takeNextRun` 吞用户消息（只 drop loop source）；`CU_FOCUS_LEASE_QUEUED` 映射 `classifyError` recoverable，排队不再 `security_halt`；worker CU waiter 用 `source=user`，drain 不再饿死。[#391](https://github.com/nehcuh/cmspark/issues/391)
- **本线程 plan_readonly 计划模式**：`execution_policy: default | plan_readonly` 线程级执行帽，只收紧不放宽。pregate 硬拒绝白名单外一切工具（deny-by-default；MCP 全拒**无例外**——`mcp_list_resources` 曾以「只读本地缓存」放行，冷缓存实际 fall through 到 server RPC，例外已撤；`analyze_image` 因 IMAGE_FETCH 出网 phase 被拒——读像素走 `screenshot`）。与 run_progress_propose 正交，propose 不是豁免。写入只认新 WS 消息 `thread.execution_policy.set`（`user_gesture:true`；工人线程拒绝；spawn 仅在父 plan 时盖章，无章工人 gate 侧实时跟随父当前策略——中途 arm 罩住已 spawn 工人；召唤器 ACL 拒），落 `capability-audit.jsonl`。UI 另票。[#327](https://github.com/nehcuh/cmspark/issues/327)
- **Composer 巡航档位选择器**：发送键旁芯片，四槽每次确认/网页巡航/全自动巡航/全自动+协议（无值守）。显示值现场 `deriveAutopilotTier`，升档复用设置武装 sheet（短语+后果矩阵），降档一键 `disarmAllFlags`；arm/disarm 写入 `capability-audit.jsonl`。无新 config enum / TTL。[#325](https://github.com/nehcuh/cmspark/issues/325)
- **召唤器巡航档位只读镜像**：hydrate 下推派生 chip 文案（Swift/HTML 不解三 bool）；点击走既有「打开侧栏/确认台」深链。ACL / 确认方言 / #230 不动。[#324](https://github.com/nehcuh/cmspark/issues/324)

### 专家团队（#366–#371 #395）

- **Pack `kind: mission|expert` 字段（#367，I1）**：`pack.yaml` 新增可选 `kind`（缺省 mission，旧包兼容；validator 收录——未知 kind 值校验失败不静默丢）。**expert 为可调度的角色视图，仍非 runtime**：kind 只影响列表过滤/匹配/文案，apply/spawn 引擎对两种 kind 走同一装配路径。`pack.list` / `pack.get` 返回 kind；四个 builtin 包显式标 `kind: mission`（安装保持 force refresh）；ADR-014 加修订段、ADR-020 组合面表加 Expert view 行。禁项：pack.yaml 无 model 字段、无新顶层数据目录、Trust B 边界与 skill `sub_agent` 均未动。[#367](https://github.com/nehcuh/cmspark/issues/367)
- **七个 builtin 预置专家 Pack（#368，I2）**：`expert-product-manager`（产品经理）/ `expert-sre` / `expert-project-manager`（项目经理）/ `expert-ops`（运维）/ `expert-architect`（架构师）/ `expert-developer`（开发）/ `expert-qa` 七个 `kind: expert` 的 community builtin Pack——用户可在场景/专家列表直接组队或派活，persona 差异化（PM 用户价值 / SRE 事故与 SLO / 项目经理计划与风险 / 运维变更与回滚 / 架构师结构与权衡 / 开发实现与质量 / QA 验证与边界）。工具面全部 allowlist：只读基线 `list_tabs/get_page_text/screenshot/use_skill`，开发/QA 另加页面点按（navigate/click/scroll，无 evaluate），全员 deny shell/host_*/netsec/evaluate/spawn_worker/acp_*；`author: cmspark`（builtin 只读）；无 trust、无企业模块。预置角色 = 浏览器侧顾问，persona ≠ 权限，需主机操作走主对话 + 企业模块。[#368](https://github.com/nehcuh/cmspark/issues/368)
- **专家组队 v1 核心（#371，I5）**：`propose_expert_team`（只读匹配：任务简述 → ≤4 个已安装 `kind=expert` id + rationale；发明/停用 id 被滤）+ `spawn_expert_team` **一张** L2 确认卡（队员、HARD_DENY 后有效工具面、完整可见可编辑任务切片、将升 orchestrator / 开 Board；token 绑定 pack id 集合 + 切片指纹）。批准后循环既有 `spawnWorkerThread` + `applyPack(allowTrust:false)` + `tool_allow=pack.tools.allow`，每 worker 写入 brief 并 fire-and-forget `chat.create`（无 brief / 无 kick = 失败）。任一步失败删已建 worker 并 `restoreParentAfterFailedSpawn`（#292）。parent `board_mode=true`；>4 截断、总 worker ≤5。巡航跳过与 `spawn_worker` 完全一致，无新 waiver。NEVER：auto-spawn、N 次串行 L2 冒充组队、worker 互聊、突破 5、LLM 写 `base_url`。[#371](https://github.com/nehcuh/cmspark/issues/371)
- **#371 round-2：组队 kick 走 `tryAcquireMultiAgentLlmLoop`（Pi MAJOR）**：`spawn_expert_team` 不再裸调 `adapter.chatCreate` 绕过 `max_concurrent_multi_agent_llm_loops=5`。满员时 kick **入队**（brief 已落盘，worker 待命），slot 释放后 FIFO drain；第 6 个 kick 不回滚组队、不超跑。N-2：`tools.mode=unchanged` 不再把 `roleAllow=[]` 打成空白名单（与 spawn_worker 的 null→安全默认一致）。N-3：已满 5 worker 时 L2 预拒 `MAX_WORKERS`，不再弹 0 成员空卡。N-1 applyPack parent∩ / N-4 异步 LLM 失败不回滚 sibling / propose 审计 / catalog 描述：不改（pre-existing 或已声明 residual）。[#371](https://github.com/nehcuh/cmspark/issues/371) / [#395](https://github.com/nehcuh/cmspark/pull/395)

### CU 完整性链与本机模型（#359–#363）

- **Qwen3-VL 发版钉死 sha256（#359 / CU-A）**：`companion/assets/qwen-vl.manifest.json` 随 release 钉入 2b/4b/8b 每文件 name/size/sha256（权重取 HuggingFace tree `lfs.oid`；sidecar 取 huggingface.co/resolve/main 实测）。`probeQwenModelDir` 改为 config.json 存在 **且** 清单全量 size+流式 sha256（含全部 safetensors，无 stat-only 捷径）。缺文件 `model-file-missing`、哈希错 `sha256-mismatch` 拒 admission / worker load（load 前再验 TOCTOU）；失败时 `modelEnabled` 强制 false。HF / hf-mirror / ModelScope 只换 origin。2B ~4.26GB 哈希在设置/准入/load，不按点击重算。[#359](https://github.com/nehcuh/cmspark/issues/359)
- **本机定位 held-out 评测门（#362 / CU-D）**：`companion/scripts/cu-locate-eval.mjs` + `companion/tests/fixtures/cu-locate-eval/` 入仓（10 例合成 PNG：中文桌面 5 + OSR 5，确定性生成、`--check` 逐字节校验；与 #361 红队集样本不重叠，红队样本不进准确率）。候选：**文本层-缺陷对照器**（非测得 OCR——用 corpus 权威文本层 + 确定性删词档模拟 OCR 漏词，措辞如实降格，删词档属门定义）对照 Qwen3-VL-2B BF16 与 int4（int4 无官方可钉 sha256 源则记「无合规源」跳过，不用社区包；验证于 2026-09-06）。过门三条件：优于对照器（≥0.15，有效门槛 qwen ≥0.85 ≈ 9/10）且绝对下限 ≥0.7 且 desktop 地板 ≥0.65（全语料皆中文——该条件实为桌面 vs OSR 子集地板，非中文分隔）；golden 不进提示；过门 ≠ 摘 experimental（#363）。无 GPU 时模型跑分诚实标「待有模型机器执行」+ 命令，不编造数字。[#362](https://github.com/nehcuh/cmspark/issues/362)

### 侧栏 UI 重构与观感（#321 #323 #326 #342 #396）

- **一条 Now（状态带合并）**：SceneStatusBar / RunBusyChip / WorkerScopeBar 并入 FocusBand 槽位体系（worker_scope > run_busy > L1 > scene，场景可作次行搭车）；对话上方只剩 rail + FocusBand，≤80px 不变；`buildScopedRunBusyInput` 五处推导收敛为单 hook（`use-scoped-run-busy`）；弹出对话框按钮并入 rail。旧 data-testid 挂新节点。[#321](https://github.com/nehcuh/cmspark/issues/321)
- **消息行降噪（#321 PR-6）**：消息动作条（复制/编辑/分支/导出/</>接力）改 hover/focus-within 门控——隐藏态用 opacity+pointer-events（非 display:none），按钮留在 Tab 序、键盘聚焦即显整条；最后一条消息常驻。触屏/coarse pointer 每条消息保留一颗 ⋯（aria-expanded，展开同一动作组——硬验收）。四种紧凑横幅（shrink/unknown/prompt/compacted）与 ToolCallCard 内嵌指路/userHint 统一 `NoticeCard` primitive（warning token 家族；无折叠态）。ToolCallCard 纯视觉收口（radius/mono 栈进 token），cascade 逻辑零改动。红线：失败/安全披露（错误工具卡、warning userHint、SEC-C 桩提示）永不默认折叠；RunProgress 折叠语义不动。[#321](https://github.com/nehcuh/cmspark/issues/321)
- **空态与作曲同一张脸（#321 PR-4）**：CompanionMark 空态 92→48（仍是 #323 红色小牛）；招呼 22px；三条建议回到首屏折叠线以上；作曲胶囊 minHeight 72→52；用户气泡去满铺 indigo（canon 修订：浅底+细边为交付方案，左细 indigo 条为备选截图）；未武装发送 `sendDisabledBg`，武装才 indigo；L0 装配芯片降为弱样式（不删）。[#321](https://github.com/nehcuh/cmspark/issues/321)
- **Cockpit 抢焦点收敛**：非 nonce 轻量确认不再自动抢桌面焦点（侧栏 MinimalConfirm + macOS 托盘承担）；nonce/重预览级确认与 CU paused 仍自动开并聚焦；巡航/值守武装下 CU started 不再抢焦点。确认条数不变（forceConfirm 代数零 diff）。[#326](https://github.com/nehcuh/cmspark/issues/326)
- **MeetingPanel 双「收起」去重（#342）**：面板内按钮改名「结束并收起」（title/aria 同步）——它与 Host header 的「收起」语义不同（前者结束录制+收起，后者纯收起面板），不再同屏同文案。[#342](https://github.com/nehcuh/cmspark/issues/342)
- **settings-web 去 Material 硬编码，token 化（#396a）**：tray「设置」页内联 CSS 从 Material 暗色板（蓝/绿/红/黄/深蓝卡蓝输入蓝）改为 **CSS 变量单一来源**——`:root` 手工镜像 Side Panel tokens.ts dark 家族（bg/elevated/border/text/muted/accent/success/danger/warning + field-bg），同 SummonerTokens / summoner-web :root 的镜像模式并注单一映射来源。语义色全走 var：主色→darkAccent(indigo-400)、成功→darkSuccess、危险→darkDanger、警告→darkWarning；**字阶对齐侧栏 11/12/13/15 家族**（消灭 14px 中间档：输入/按钮/range 14→13，区块标题 14→15；页标题 20 保留）。hover/focus 对齐侧栏观感（focus 用 accent 边框）。**Material hex 源码零残留**（含注释）；渲染页 GET / 无 Material 值（服务端集成测试钉）。零行为改动——设置项逻辑/保存/CSRF/SSRF 面不动。[#396](https://github.com/nehcuh/cmspark/issues/396)

### 会议、平台韧性与审计（#69 #244 #347 #357）

- **浮窗会议台（#244）**：隐私「我已了解」后盖住 Capture 卡，实时转写滚动进会议台（不进草稿框）；结束 / 生成纪要 / 返回对话。`generate_minutes` 失败不写「已生成」。打开侧栏跳过 `--app` 浮窗，落普通 Chrome 窗口。**ACL 增量：零**——`append_transcript` / `generate_minutes` / list / get 等上涨发生在 [#246](https://github.com/nehcuh/cmspark/issues/246)，本票复用。本票收紧：overlay 剥 `auto_diarize`（#244 NEVER：仍扩展-only；浮窗撤「自动标说话人」）。`import_text` 仍扩展-only；overlay never Allow/Deny。[#244](https://github.com/nehcuh/cmspark/issues/244)
- **CDP 死磕升级建议（#357）**：同一 `(thread, origin)` 上 CDP 交互失败累计 ≥4 次（跨 locator / 工具名）后，后续 CDP 调用被 site-op-memory peek 拒执，`suggested_action=escalate_to_host_computer`，错误文本建议 `host_computer`（Chrome token，**仍走 L2 确认**）或 macOS `osascript_eval`。evaluate `success:true` 且 `result:null` 视为假成功（不重置失败计数、不消耗 DOM-script budget）。不改 `classifyError`，不自动跳过 CU 确认。Round-2：`origin:unknown`/非 http(s) 不计不拦；`justBanned` 只表示 locator 2 败；共享读面 `getOriginFailCount`（#358 rebase 对齐 `originFails`）；escalate 文案含 `list_tabs` 逃生门。[#357](https://github.com/nehcuh/cmspark/issues/357)
- **host_read max_chars 真透传（#69 Phase 2，审计 M8 完整修复）**：read-mail / list-mail 预编译 .scpt 转 handler 形态，cmspark-host 经 'ascr'/'psbr' 子程序 Apple Event（kASSubroutineEvent）把 `--max-chars`（1-5000，匹配 zod）/ `--limit`（1-500）传入 readMail/listMail handler——脚本侧硬编码 500/100 移除（max_chars>500 不再被 500 硬截）。非法 argv typed exit 7（不静默 clamp）；TS 层 slice 保留为纵深；list-notes/list-files 不变（仍固定 top-100）。[#69](https://github.com/nehcuh/cmspark/issues/69)
- **list-files CJK TargetId 有损（#69 F3）**：producer 不再用 `cid mod 256` percent-encode（U+4E00「一」与 U+4F00「伀」曾撞成 `%00`）；改为输出原始 UTF-8 文件名，由既有 M2 `encodeRawTargetId` base64url 在 list 边界编码。选这条而不是在 AppleScript 里重写 UTF-8 percent-encoding：少一层易错逻辑，notes/mail producer 已是 raw。M2 codec 行为不回退。Finder `readOne` 仍是 M1 NotImplemented（Mail-only）——回读是 decode 文件名后读 `~/Documents`。[#69](https://github.com/nehcuh/cmspark/issues/69)
- **值守 grant arm/disarm 入 capability-audit（#347）**：`security.unattended.armed` / `.disarmed` / `.expired` 三事件补全审计面板可见性——config.set 双向已记（#334），grant 路径（ADR-021 进程内存值守）此前只有 logger。armed/disarm 带来源 surface（panel/tray/summoner 归一，stampedSurface 派生），expired 记 `cruise_restored`；字段按构造 redact（无短语/token/命令文本）。bare disarm（无活跃 grant）不伪造审计行；审计写失败永不 gate 生命周期。不改 grant 语义 / TTL / 确认代数。[#347](https://github.com/nehcuh/cmspark/issues/347)

### Known residuals

- **#328 execution contract 仍 shadow 观测期**：L-1 完成谓词（#387）未消费 contract，shadow → enforce 的升级待观测数据；升级前 loop `complete` verdict 只当机检信号，L-4 出 DONE 报告待用户终审。
- **#363 待真实模型跑分**：#362 评测门与对照器已入仓，Qwen3-VL 实机跑分需有模型的机器执行（命令随 #362 入仓）；过门 ≠ 摘 experimental。
- **#372 / #373 / #364 deferred**：专家团队与 CU 链 follow-ups，本切点未含。
- **Linux 桌面层缺口**：见 README「Linux 功能缺口总表」（系统语音引擎 / host_computer / 召唤器原生 overlay 与全局热键 / 生物识别门）。
- **ADR 待补**：无人值守 loop（史诗 #386，L-1–L-5）与专家团队（史诗 #366，I1–I5）本切点尚无独立 ADR，决策记录散落于各 issue/PR；补 ADR 前以本 CHANGELOG 及 ADR-014/020/021 修订段为准。
- T1 已记分；[#228](https://github.com/nehcuh/cmspark/issues/228) 已关。**仍禁止**扩默认 outbound profile。

## [0.5.9] — 2026-09-04

0.5.8 工厂切点（512k / listen-first / zip node-first）之后的知识库波次：AI 草稿、检索/分布/开闸、多级文件夹、sha256 去重、PDF 导入修复；Windows launcher 后续。`[0.5.8]` 仍是 9-02 切点，不改历史。

### Added

- **知识 AI 草稿预填**：单篇导入两阶段 preview——先启发式草稿（含源文件 frontmatter tags），再 LLM 建议 description/tags（只填用户没改过的字段）。目录导入 / 库扫描零 LLM。[#272](https://github.com/nehcuh/cmspark/issues/272)
- **知识检索打分（Wave A）**：query-aware TF-IDF + top-k + 8000 字跨文档预算；智能匹配默认开，关掉走站点∪勾选。无 embedding / 图谱。[#273](https://github.com/nehcuh/cmspark/issues/273)
- **分布视图 + 可选簇路由（Wave B）**：自动分组 chips（「自动分组，不准就移到文件夹。」）；「按堆选文」默认关。[#273](https://github.com/nehcuh/cmspark/issues/273)
- **认证簇路由分支开闸**：eval 双列通过后工厂常量打开；用户开关仍默认关——开闸 ≠ 替用户打开。[#280](https://github.com/nehcuh/cmspark/issues/280)
- **多级文件夹**：最多 3 层，磁盘目录为 SoT（Obsidian 可读）；`knowledge.move` 保 pin。[#274](https://github.com/nehcuh/cmspark/issues/274)
- **完全重复导入**：正文 sha256（不是 MD5）；预览标 `duplicate_of`，目录导入跳过重复。[#281](https://github.com/nehcuh/cmspark/issues/281)
- **内置技能 `cmspark-macos-app-replace`**：DMG 换装 playbook（禁 `xattr -cr` / `pgrep -f` 坑）。

### Fixed

- **darwin host jsonEscape 覆盖全部 C0（#69 F1）**：`host.swift` runReadMessage 与 `read-mail.applescript` 的 jsonEscape handler 除补 `\b`（char id 8）/ `\f`（char id 12）分支外，新增逐字符白名单 pass——其余 C0（0x00-0x07 如 BEL、0x0B、0x0E-0x1F）统一 `\u00XX` 编码。此前含此类 C0 控制字符的邮件产生非法 JSON（TS `parseJsonSafe` fail-closed 致该邮件不可读）；现全 C0（0x00-0x1F）+ `"` `\\` 均可 JSON.parse 往返。两处 handler 保持逐字节等价（源码级 lockstep 测试钉死）。另修 host.swift 嵌入层 M3 潜伏转义 bug：换 `\"` 步骤 Swift 源层缺引号转义（会导致含引号邮件的 jsonEscape AppleScript 编译失败）——Swift 剥层后与 read-mail 逐行等价 + osascript 实跑对拍 IDENTICAL。
- **darwin host-bin resolver 路径数学（#69 F2）**：候选列表删除永不命中的 `dist/dist` 死路径（`../../dist`），dev-mode fallback 由 `__dirname/../../dist` 改为 `../../../dist`——host-bin.ts 恒在 companion root 下 3 层，该路径在编译与 dev-src 两态都正确解析到 `companion/dist/cmspark-host`。真实目录结构测试断言无死路径、dist 可达。
- **PDF 导入**：整文件 `readAsDataURL` 编码（与对话框附件同路），修 chunked `btoa` 导致 >32KiB PDF 损坏。[#282](https://github.com/nehcuh/cmspark/issues/282)
- **Windows launcher**：VBS 递归建 `logs` 目录（干净配置不再卡错误对话框）；`launch.bat` SEA echo 括号转义；无 bundled node 时探测系统 node 并给出诚实报错；CI `windows-latest` launcher smoke（S1–S9）。[#279](https://github.com/nehcuh/cmspark/issues/279)
- **知识预览失败可见**：解析失败不再永远「正在解析…」；可「跳过解析，手动填写」。（#270 / #271）
- **shrink 横幅三态**：旧 companion 省略 `shrunk` 时走 unknown 分支，不再谎称「仅提示/未压缩」。
- **LLM `complete()` recap**：对齐 `streamChat` 预算；overflow 半窗重试一次，避免原样重发。
- **依赖**：`npm audit fix` 清掉 fast-uri high advisory（CI 门禁恢复绿）。

### Known residuals

- T1 已记分；[#228](https://github.com/nehcuh/cmspark/issues/228) 已关。**仍禁止**扩默认 outbound profile。

## [0.5.8] — 2026-09-02

工厂默认 `context_window` 512000；过小磁盘运行时按 128000 且不写盘；官方 zip node-first；Companion listen 不再等 MCP start。[#268](https://github.com/nehcuh/cmspark/issues/268)

### Changed

- **`context_window` 工厂默认 512000**：新装 Agent 工作预算，不是供应商窗口承诺。磁盘过小（`< 16000` / 非正）本轮按 **128000** 做预算，**不写** `config.json`。shrink 不再切出半截 JSON（`{"succes…`）。设置页 Save 在 companion `config.updated` 水合前禁用。shrink-only 横幅不再谎称「仅提示未压缩」。512k 默认**不是**对已有 4000 磁盘文件的修复。
- **F1 文案诚实**：活切点不再保证聊天列总有「本轮步骤」清单——页面工具前必须 propose；成功后才挂卡；模型放弃 / 纯问答则无卡。
- **F2 官方 zip 启动器**：`launch.bat` / `launch-hidden.vbs` 优先 `node.exe`+`cmspark-agent.js`，leftover SEA `cmspark-agent.exe` 垫底。
- **F3 listen-first**：23401 不再等 MCP start；本轮未提供的 `mcp__*` 拒执行（`tool_not_offered`）。

### Known residuals

- `createToolExecutor` 未串 offered-catalog（LLM 路径已由 adapter 包一层）；tray settings-web 无三档过小窗口文案；Windows `0o600` 测试在 NTFS 上失败（预置）。

## [0.5.7] — 2026-09-01

当轮活计划：侧栏本则消息里页面工具前必须 `run_progress_propose`；shell allowlist W1e fail-closed；`run_progress` sticky-clear。文档活切点与包装 lockstep。

### Added

- **当轮活计划**：页面工具前必须 `run_progress_propose`；成功后才挂「本轮步骤」卡（不必等 H1）。模型放弃 / 纯问答则无卡。[#265](https://github.com/nehcuh/cmspark/issues/265) / [#266](https://github.com/nehcuh/cmspark/pull/266)

### Security

- **shell allowlist W1e（quote/join fail-closed）**：0.5.4 闭合的是执行旗标 *变体*（pwsh 前缀、`/c`、`=`、`.exe`、node `-p` 等），不是「判定 tokenizer ≠ `spawn({shell:true})` 引号语法」。本次：POSIX 相邻引号拼接（`"-"c` → `-c`）；旗标比对前去掉空引号并认 unquoted `\`；`tokenizeSimpleArgv` 失败改为 deny（删除空白 fallback 放行）。`policy=allowlist` + 裸解释器条目下，`bash '-c' … '*'`、`bash -""c`、`bash "-"c … X=1` 不再匹配。默认 `confirm_per_command` + L2 不变（非社区默认 RCE）。含 `*`/`?` 的 allowlist 命令（即便在引号内）改为 matcher deny；词中未闭合撇号（`echo don't`）同样 tokenize-null deny——需要 glob/query/撇号字面量的操作者用 `confirm_per_command`。

### Fixed

- **`run_progress` adapter 三态**：显式 `null`（sticky clear）不再被 tool_result 成功路径 `!th.run_progress` 当成未播种而重新 seed。抽出 `nextRunProgressAfterToolSuccess`；toggle 对 `null` 不再 `?? { items: [] }` 写成空对象。无生产写入方（潜伏契约）。
- **语音回退横幅 CTA**：本机模型未就绪改用浏览器听写时，横幅带「去设置」（`local_fallback`，不复用 fail-closed 的 `model_missing`）；听写结束后仍保留直到关掉或下次开始。
- **Whisper 下载失败**：`get_state` 带回 `lastDownloadError`；打开设置不再先清空错误位；文案指向模型下载源（hf-mirror）。
- **会议自动 K**：`meeting.diarized` 回显 `K=N`，下拉同步 2–4。

### Known residuals

- 位置参数 `bash evil.sh` / GTFOBins；`$VAR` + 残留 `shell:true`；win32 `cmd.exe` 引号语法；cwd 依赖的 `bash -[c]` pathname glob；macOS bashism `-{c,}`。

## [0.5.6] — 2026-08-31

召唤器 HTML 流式出字、本机 Whisper 自动激活 / 可见回退 / HF 镜像、会议说话人「自动」档。文档活切点与包装 lockstep。

### Added

- **召唤器 HTML 卡流式出字**：Windows HTML shell 跟 `chat.token` 累积快照逐 token 渲染（此前只在 assistant 轮末整表 refetch）。Swift overlay 本已流式，未改。
- **本机 Whisper 下载完成自动激活** `localModelId`（不改 `sttEngine`）；`get_state` 自动修正失效的 active 模型。
- **本机模型不可用时当次会话回退浏览器听写**：`voice.autoFallbackToBrowser`（默认 true）显示可见横幅（含云残留），非静默、不改配置。ADR-023 L13 2026-08-31 修订为禁止**静默**回落。
- **模型下载源镜像**：`voice.modelDownloadEndpoint` / `CMSPARK_HF_ENDPOINT`（仅重写 huggingface.co 主机，https fail-closed；sha256/size pin 不变）。
- **会议说话人人数「自动」档**：silhouette 选 K（`meanSilhouette` / `selectBestK`）；UI 默认「自动」。仍是 3 维特征近似，experimental。

### Documented

- **补记**：`cmspark-agent outbound-grant` 对未知 flag 失败且不签发（[#235](https://github.com/nehcuh/cmspark/issues/235)）。0.5.3 Honesty 段仍描述当时切点，不改历史。

### Known residuals

- 语音 UX Hex 式 [#258](https://github.com/nehcuh/cmspark/issues/258) · Windows SAPI 兜底 [#259](https://github.com/nehcuh/cmspark/issues/259) · speaker embedding diarize [#260](https://github.com/nehcuh/cmspark/issues/260)。
- [#230](https://github.com/nehcuh/cmspark/issues/230) 仍冻 F-S-10 / overlay-acl；grant-cli 未知 flag 与 H1 `{text,tool}` 精确勾已不在该冻清单。
- T1 已记分（CMspark 臂 Y / Playwright `ERR_EMPTY_RESPONSE`）；[#228](https://github.com/nehcuh/cmspark/issues/228) 已关。**仍禁止**扩默认 outbound profile。

## [0.5.5] — 2026-08-29

侧栏对落盘脱敏桩的友好渲染（SEC-C 脱敏的 UX 补缺；两路对抗评审 + grok 复核 SHIPPABLE）。

### Fixed

- **重载对话后工具结果不再显示原始桩 JSON**：敏感工具（evaluate/shell/host_*/workspace_*/部分 MCP）落盘脱敏桩（`{redacted:true,len,sha256}`）改渲染友好提示——「出于安全未持久化：原始长度 · sha256。实时轮次中内容对模型与界面可见（超长会截断），重新加载后不再保留」；失败桩追加「该调用当时已失败」。
- 同步门控三个会露出占位符的分支：shell 命令条（`<redacted:hash=…>`）、host_computer 空任务卡（「?/? 步」）、tool 消息气泡正文（桩 JSON markdown）。
- 判定下沉为纯函数（`redacted-stub-utils.ts`：`extractRedactedStub` / `isRedactedStubContent`），13 用例钉住 A/B 形状、失败桩、len 边界、误伤面。
- 版本字面量补齐 lockstep：index.ts 横幅 / ACP clientInfo / outbound serverInfo 三处硬编码版本（0.5.3 bump 时的历史遗漏）纳入 `version-lockstep` 测试。

### Known residuals（下轮，grok 复核记录）

- 复制 / `</>` 编程接力仍输出桩 JSON；generic/MCP 深键嵌套叶桩仍在 JSON 预览中原样显示；plainError（INTERRUPTED）shell 行的命令条占位符未门控；脱敏范围讨论见 [#255](https://github.com/nehcuh/cmspark/issues/255)。

## [0.5.4] — 2026-08-29

四路独立对抗评审 + grok 多路验证驱动的修复批次（spec/plan：`docs/superpowers/specs|plans/2026-08-29-post-review-adversarial-fixes.md`）。全部为已有行为 bugfix，无新需求。

### Security

- **shell allowlist 回归闭环**：裸 shell 家族条目（`sh/bash/zsh/pwsh/powershell/deno/bun/cmd`）的执行旗标恢复拒绝——`-c`/`-Command`/`-EncodedCommand`/`eval`/`-p`/`--print`/`-r` 等，含 PowerShell 唯一前缀（`-com`/`-enc`）、斜杠形式（`/c`）、`=` 粘连、`.exe` 基名归一、大小写变体；tokenized 与 fallback 统一复用同一判定函数。`grep -c`、`bash -e/-eu`（errexit）、`ruby -r` 等合法形态不误伤。位置参数与 GTFOBins 类在代码注释声明为设计边界（旗标 deny 是纵深，L2 确认才是门）。
- **外泄授权 per-key**：HTTP 轨按认证 grant 自身 `allow_page_export` 判定，同 caller 的 sibling 带旗钥匙不再放行无旗 token（`grantAllowsPageExportById`）；stdio 轨保持 caller 级并注释文档化双轨。与 grant-cli「这把钥匙」承诺及 TROUBLESHOOTING 对齐。
- **打开侧栏结果帧**：仅 panel/extension 来源可裁决（origin 绑定），settle 单漏斗先到先赢。
- **外发 HITL 断连**：操作员批准时调用方已断连则不再执行工具，审计记 `CALLER_DISCONNECTED`（与已执行明确区分）。

### Fixed

- **「打开侧栏」假成功**：`sidePanel.open()` 在无手势上下文必失败却回报成功。改为真结果回传（关联 id broadcast + 结果帧 validator + 6s 超时），失败/超时 overlay 如实显示「请点工具栏」。
- overlay 附件发送成功后清空 file input，旧附件不再随后续消息重复发送。
- **SSE 瞬断不再即杀会议/听写**：最后 SSE 断开改 8s 重连宽限（重连取消）；热键关窗不再同步释放 composer 租约（关窗后 1s 短宽限 + 8s 硬兜底）；Windows 关窗保存 spawn PID 直接 `process.kill`（原 `ps` 路径 win32 恒 no-op，窗口假活撞 `OVERLAY_STANDBY`）。
- `run_progress` 显式清除（null）持久生效：仅 `undefined` 才从 handoff 初始播种，`get()` 读路径同修；无关 update 不再重播种。
- `thread.updated` 双发去除（broadcast 已覆盖扩展端）；`llmLoopOwnerPanel` 在 chat.create/file.upload/regenerate 三路所有出口对称清理。
- Swift overlay `confirmPending` 六处复位（hydrate-attach / token 恢复 / done / 新线程 / 换线程 / 终态错误），HUD CTA 不再永远粘在「需要确认」。

### Tests

- #252 握手 terminate、#250 WS fanout 改行为级集成测试（替代源码 grep 假防线）；`ui.open_sidepanel` 双端 lockstep 测试。

### Known residuals（下轮）

- `stopSummonerWebServer` 丢 PID 不杀进程；overlay SSE 收不到 slash-pin 的 `thread.updated`；hydrate-detached 换线程 CTA；win32 不扫进程树；`chat.aborted` 不在 summoner 映射；`thread.digest_updated` 同款双发（`message-router.ts:678`）。
- 协议版本未 bump（MIN=MAX=1 期间语义变更靠同步发版，#252 起）；`mcp.toggle_server` WS ACL 残留属 #230。

## [0.5.3] — 2026-08-27

0.5.2（Windows 官方 NSIS）之上的产品切点：**知识 CRUD 诚实** + **形态切片 1–3 / 5 / 6**。这不是召唤器或租手「做完」的里程碑——T1 真人 bake-off 仍待（[#228](https://github.com/nehcuh/cmspark/issues/228)）。

### Added

- **知识诚实（#222 / #223 / #226）**：Side Panel 可点开正文、确认后保存、下载 `.md`、related≤3 芯片。图谱 / 双链 / Project / 默认 embedding 本季不做。
- **租手钥匙 + L8（切片 1–2，#226）**：`cmspark-agent outbound-grant` 签发 `cmg_`（不打开侧栏设置）；空 grant 默认 `GRANT_REQUIRED`；首次外泄走确认台 / Mac 托盘。`require_grant` 仍默认 true。overlay **永不** Allow/Deny。
- **召唤器诚实文案（切片 3，#226）**：默认收起条；「展开对话 / 打开浏览器 / 打开确认台」；MCP 轨藏而不删。禁止「展开工作台」「去侧栏批准」。
- **侧栏空态看山（切片 5）**：CompanionMark + 22px 招呼 + 句子邀请 + 作曲区。
- **匹配诚实 + 本轮步骤（切片 6，#227）**：技能匹配补 IDF（仅 skills；knowledge related 与 Obsidian 仍 TF）；聊天列 L0「本轮步骤」种子来自 H1 handoff todos。**v1 勾选基本只能点**（seed 行常无 `tool`，见 [#230](https://github.com/nehcuh/cmspark/issues/230)）。

### Changed

- 产品句锁定：家 = **已登录 Chrome + 硬闸**（[PRODUCT.md](PRODUCT.md) / [GOAL.md](docs/GOAL.md)）。侧栏是 Operate 面之一，不是家。
- **需求设计 Issue-first**：新需求必须先建 GitHub Issue，再写 spec/plan。模板：[`.github/ISSUE_TEMPLATE/design.md`](.github/ISSUE_TEMPLATE/design.md)。本季余项：[#228](https://github.com/nehcuh/cmspark/issues/228) T1 · [#229](https://github.com/nehcuh/cmspark/issues/229) 召唤器 P2 · [#230](https://github.com/nehcuh/cmspark/issues/230) 残留。

### Fixed

- Windows：`launch-hidden.vbs` 设 `NODE_PATH`，打包后 systray2 能解析（#224）。
- Overlay：合并冲掉的 paper HUD / I1/I2 恢复（#225）。

### Honesty / not in this cut

- T1 真人 bake-off **未跑**；不得扩默认 outbound profile，不得对外声称护城河。
- F-S-10（trusted/cruise 下 `mcp__*` 可能不弹确认）本季不修完；禁止用 overlay 管 MCP 掩盖。
- `outbound-grant` 对未知 flag 仍静默忽略。

## [0.5.2] — 2026-08-20

### Packaging

- **Windows 官方安装器**：GitHub Release 在 `cmspark-v*-windows-x64.zip` 之外增加 `CMspark-Setup-v*.exe`（NSIS）。安装器包装与 zip **同一份** `package.sh` staging（`node.exe` + `cmspark-agent.js` + 扩展），每用户装到 `%LOCALAPPDATA%\CMspark`，HKCU 开机自启 + ARP 卸载。CI 钉 Chocolatey `nsis` **3.12.0**，`CMSPARK_REQUIRE_NSIS=1`：缺 makensis **失败**，不静默只发 zip。SEA（`build-windows-exe.ps1`）不再产出官方同名 Setup.exe。产物未 Authenticode 签名（REL-1），SmartScreen 会警告。见 [#204](https://github.com/nehcuh/cmspark/pull/204)。

## [0.5.1] — 2026-08-18

### Added

- **对话框用户附图**：Side Panel 可粘贴 / 点选 / 拖入 PNG·JPEG·GIF·WebP。线程生效主模型 `likelyMultimodal` 时原生看图，否则走视觉轨；工具截图 / PDF 内嵌图仍走视觉轨。
- 附件芯片、48px 对话缩略图、首次发送目的地主机提示；sidecar 落盘（0o600/0o700 + realpath）；WS 帧 10MiB−256KiB 拒发。

### Security / Trust (already on main since 0.5.0; recorded at 0.5.1 cut)

- **C1** 无人值守 dual-write：武装前快照三旗；解除/TTL 过期**始终**恢复快照（不再仅 `clear_cruise`）
- **C2/C3** 急停 ≠ 解除：值守仍开 banner；确认台空桌面常驻「值守中：桌面确认已静默」
- **C4** 后果矩阵拆分 evaluate vs 导航；默认值守不 waive evaluate forceConfirm
- **C5** Pack Trust `skip_l2`/三旗需 Settings 同款短语 step-up（服务端拒绝 + PacksPanel）
- **C6** Worker `WORKER_HARD_DENY` 运行时 `isToolAllowed` 再强制；`thread.update` 不可开全表面
- **C7/C8** shell cwd / netsec ports L2 bind 与 execute 预规范化一致
- **C12** security-gates 去掉 `force_confirm` 假绿断言
- **C9** CI lockstep：`ws-router-validator-lockstep` 测试
- **C11** UI `SURFACE_BY_TOOL` 表（含 shell_exec / netsec / scroll_to / upload_file）
- **C13–C16** SoT/文档诚实：SUPERSEDED Aug-02 设计；mcp.md `require_grant` 默认 true；CU Apps 坐标开关 0.5.0；ADR-021 residual windowLevel hard

### Also on tip since 0.5.0 (recorded at 0.5.1 cut)

- **#160** 无人值守 re-L2 静默（ADR-021 2026-08-09 修订）
- **#161** Windows voice/shell closeout（shell/netsec token binding 对齐）
- 会议用户指南：STT `resource_conflict` 恢复说明 + 纪要模板用法（§3.5–3.6）
- 会议 **P1 近实时**（默认渐进假设 + ~8s 定稿）与 **P2 长会**（直播/上传硬上限 3h、软提示 2h；纪要输入 20 万字）

### Fixed

- Windows：外部编程 Agent（ACP）启动不再命中 npm 的 Unix shebang 垫片（`spawn ENOENT`），也不再对 `.cmd` 直接 CreateProcess（`EINVAL`）。发现优先 `.exe`/`.cmd`，并把 Claude/Pi 等 shim 解包为 PE / `node script.js`。
- Windows Mode C / wrapViaCmd 共识 R1–R5：禁止 WindowsApps `wt.exe` 假 L1；`auto` 先 `start` 失败可 L0；`cmd /c` 剥离 `-p`/prompt；cmd-host 只走 L0；粘贴行带 `Get-Content` 任务文件。
- Windows ACP P2（R6–R14）：临时文件 `wx`+延迟删除；`start` 全 token 引号；`System32\taskkill.exe`；拒绝用 companion PE 当 node；unwrap `%~dp0`；`joinDp0` 反斜杠；spawn 接线锁；设置补 WT/cmd；空列表说明 shebang 垫片。
- Windows Mode C post-#191：`start` 走 `cmd /d /s /c` extra-quote + `windowsVerbatimArguments`（不再被 CRT 改写成 `\"`）；真 PE `wt.exe` 的 exit 0 视为 CLI 交班成功；`cmd`/`powershell` 钉 System32；成功时间线用实际打开的 app，不用 config pref。

### Packaging

- `run-esbuild-bundle.mjs` 直接 spawn esbuild 原生二进制（避免 node 解析 Mach-O）

## [0.5.0] — 2026-08-08

### 稳定切点

听写 / 会议 / 本机 STT 产品线合入并文档化；Computer Use 实验定位仅保留 **Qwen3-VL**；macOS DMG 可打包安装。

### Added

- **听写+ D2**：按住热键；设置中 **按键盘录制** 组合键；文字/语音改设置命令条  
- **实时出字**：浏览器 Web Speech interim；本机 Whisper **M2 渐进假设流**（PCM 流式 + `voice.stt.partial_request`，约 8s 窗定稿）  
- **会议**：装配 › 场景 › 会议 工作台入口；Mtg0–3（粘贴/本机录/上传/实验发言人N）  
- ADR-023 / ADR-024 与用户指南 [meeting-and-dictation-user-guide](docs/meeting-and-dictation-user-guide.md)

### Removed

- **TinyClick / Florence-2 ONNX** 全栈与 `onnxruntime-node`、CI vendor 校验（PR #151）  
- 实验桌面定位统一为 **Qwen3-VL**

### Changed

- 产品版本 **0.4.0 → 0.5.0**
- 文档导航、GOAL G22、architecture §9 与 README 能力表同步  

### Security / Trust

- 本机 STT 仍走 chrome-extension origin fence；partial 失败 soft-skip 不杀 live 会话  
- Pack 仍不得写 voice / hotkey / ack  

## [0.4.0] — 2026-08

### Added / shipped under 0.4.x

- Multi-agent · Mission Board · Pack / 企业模块  
- Computer Use / Host / Apps · Confirm Center · Outbound MCP 骨架  
- Qwen3-VL 实验定位层  
- 听写 M1 + Path B 本机 STT 初版 · Dictation+ D1 · 会议 Mtg 初版（后续并入 0.5.0 文档）  

## [0.3.0] — 2026-07

- MCP · Mission Pack · Computer Use / Host 主路径 · Multi-agent P0  

---

链接：

- [docs/README.md](docs/README.md)  
- [GOAL.md](docs/GOAL.md)  
