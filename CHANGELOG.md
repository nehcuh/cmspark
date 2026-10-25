# Changelog

格式大致遵循 [Keep a Changelog](https://keepachangelog.com/)。版本号与 `companion/package.json` / `chrome-extension/package.json` 对齐。

## [Unreleased]

- Windows 原生验收：为未分发的 local/terminal 确认夹具补充按请求序号区分的有限阶段回执，保留完整生产源码逆变、原权限/断言/时限；不将观察或发送返回当作确认完成。

- Workspace (#753): add explicit full-page multi-selection for separately recording handling, feedback, or dismissing pending candidates. Save sequentially against original item revisions, stop on the first unconfirmed result or lost page/connection ownership, and retain per-item outcomes without automatic retry or outgoing messages.

- Fix (#754): expose offline voice-setting rule navigation through the existing settings destination. Keep configuration changes behind manual controls or explicitly confirmed semantic proposals; reject stale inactive/disabled navigation callbacks.

- ACP (#476): wait for the actual child close before reporting teardown complete, including exit-before-stdio-close; retain already-closed observation and the original bounded cleanup.

- Fix (#752): retain different screenshots when OCR is empty or whitespace-only. Keep image-identity and nonempty exact-text deduplication, original application/window scope and stored OCR unchanged.

- Windows desktop: use process self-termination when the exact owner has died, avoiding DLL detach on unknown live-thread state. Keep the original owner handle, exit code and native process-settlement checks. This addresses a documented shutdown risk; the earlier timeout’s physical cause remains unknown.

- Fix (#756): keep settings open and report blocked workspace navigation; report meeting and pack navigation only after the current thread's host accepts it. Invalidate pending navigation on thread selection changes, including A→B→A. Remove unreachable legacy intent branches while preserving the parser and saved-source compatibility.
- Workspace activity: omit retained source OCR before cloning state responses, preserve isolated metadata and evidence, clarify webpage context and the independent 16 MiB metadata budget, and distinguish the 6 MiB import limit from the 8 MiB decoder limit. Cover atomic quota refusal and cleanup recovery with real store-produced records.

- Fix (#756): classify missing Windows reminder sidecars or development packages as `NOTIFICATION_FAILED` inside the existing submission error boundary. Preserve explicit helper paths, timeout handling and failed reminder state; a missing helper never counts as successful delivery.

- macOS workspace acceptance: wait for an input candidate in the same owned picker after the Go to Folder shortcut, within the original shared deadline. Keep the original control-type selection, unique input, hittability, real path entry, selection, cancellation and cleanup checks.

- Windows terminal acceptance: join the first owned document with actual visible foreground readiness before installing the test form. Keep the original per-input, callback, confirmation, output, cleanup and 45-second guards; no focus request or retry is added.

- CI acceptance: check the fixed CFT runtime version and supplier close/EOF facts on the single actual ACP history business browser, replacing the separate startup witness. Keep all business assertions and existing deadlines. Preserve bounded terminal failure metadata in public census accounting and snapshot it on abort; raw output remains private and an observed failure remains a failure.

- Desktop acceptance source contracts: update the local-state consumer to retain the handled-reply guard and exercise its real refusal cases under LF and CRLF. Preserve the raw Swift source seals with exact LF checkout attributes. Bound macOS picker-button identity diagnostics to fixed enum values; keep the original UI actions, assertions, deadlines and cleanup authority.

- Desktop local acceptance: advance only on a state reply actually consumed by the current view, and forward that handled result through the app adapter. This prevents an untracked retirement reply from triggering the next action; original refusal and completion checks remain.
- Desktop terminal: retain one private owner-bound receipt capability to settle real outstanding output ACKs after close. Keep input, resize and ping closed; invalidate the capability on retirement, reset or a new successful spawn. The acceptance form waits for actual ACK accounting before DONE. Keep the auxiliary macOS picker-query census off the live selection path; preserve the real unique-button, hittability, click, cancellation and 45-second acceptance checks. Missing observations remain unknown and native validation is still required.

- Test fixtures: resize the Windows terminal window inward while retaining exact measured dimensions; set the unshipped macOS workspace picker prompt before presentation while retaining the real UI selection and cancellation. Replace the Session test’s PowerShell lock holder with a run-owned Win32 executable, keeping real sharing violations, both release/persistent controls, and existing deadlines. These changes remove fixture preconditions; remote native validation remains required. Keep prior source-authority hashes and account for the separate passive diagnostic increment through an exact source inverse.

- 原生桌面验收补充分段回执：区分 Agent 请求、确认、启动尝试与句柄返回，并在实际 Xcode 关闭后读取有限测试结果；保留全部原断言、超时和清理结果，不据此宣称 Windows/macOS 已修复。
- Test fixture (Windows terminal): explicitly select UTF-8 for the owned PowerShell Console writer before producing the fixed CJK output. This removes a locale-dependent fixture precondition; the original parser, output volume, browser-engine input route, ACK, resize, Stop, ownership and 45-second assertions remain. Native validation is required; this is not a claim that an earlier runner used a particular code page.

- Test diagnostics (terminal acceptance): record the bounded set of readiness operands actually observed by the original renderer short-circuit, plus input-CR and raw-output-marker booleans. Keep the command, parser calls, input actions, deadlines and success/refusal assertions unchanged; missing observations remain unknown.
- Test diagnostics (macOS workspace): split only the existing Choose first-match/deadline/wait observation boundaries and emit one separately marked strict Xcode snapshot to bounded stdout after its real close following cancellation, so a completed test context cannot silently drop the late observation. Keep UI actions, assertions, deadlines and cleanup authority unchanged; this is diagnostic coverage, not a proven GUI behavior fix.
- ACP native progress: deliver each current owner-bound update without the legacy broadcast throttle, preserving private routing, bounded payloads and legacy pacing.

- Test diagnostics (macOS workspace): publish a bounded main-thread UI stage snapshot before the existing XCTest calls, so the owner can report the last published stage even when a synchronous call has not returned. Keep original actions, 45-second deadline, refusal, success and cleanup authorities unchanged; a stage snapshot does not identify the physical cause of the earlier hang.

- Test diagnostics (#480): enable existing closed Windows native phase observations in acceptance fixtures and record them only from the current authenticated response socket. Reports explicitly describe lifetime-once attempts without reconnect-epoch attribution; success assertions and original deadlines remain unchanged.

- Security: upgrade body-parser to 2.4.0 and Zod to 4.6.6 for the current high-severity advisories, with OpenAI SDK 6.0.0 for Zod 4 compatibility. Refresh the actual legacy outbound-schema recording and retain safe-integer argument bounds; existing moderate audit findings remain tracked.

- Test diagnostics (#705): record a one-shot local terminal data-receipt observation and bounded daemon send counts without publishing terminal text or changing success assertions. Reap only the local acceptance callback’s exact PTY handles and confirm their real exits plus slot release before settling its native surface.

- Test reliability (#480): clone every pinned offline desktop resource and vendor license into owned inheritance and parent-death fixtures; reject incomplete or linked source files before publishing the asset directory. This fixes the demonstrated three-file clone gap without claiming it explains every native timeout.

- Test reliability (#705): ignore out-of-phase retirement snapshots in the local-work acceptance observer, matching the real UI’s untracked hide/open-dialog requests. Required state validation, native actions and final history assertions remain mandatory.

- Test reliability (macOS workspace): wait for the owned panel’s existing Choose/Open query to appear after committing its folder path, within the original remaining deadline; retain unique-button, hittability and real-click requirements. Production panel labels and behavior are unchanged.

- Test reliability (#758): publish the owned Linux window fixture’s ready and acknowledgement JSON only after an exclusive temporary write and close, preventing the watcher from parsing an empty final file. Preserve the original receipt parser, child-close rejection, desktop assertions and time limits.

- Fix (desktop): revoke host authority before graceful shutdown without terminating the authenticated socket before its final close frame; preserve immediate direct revocation, foreign hosts and reentrant retirement. Configure only the unshipped macOS XCTest runner to publish its owned scene handshake outside App Sandbox; retain strict file identity and original native assertions.

- Fix (Windows desktop): stop reconnecting after a validated terminal close begins, while retaining transient reconnect and authentication failure handling. Native workspace acceptance uses the retained dialog’s real Cancel button and reports bounded failure identities without changing its assertions or deadline.

- Fix (#752/#757): keep not-required feedback canonical after partial todo updates, so status-only edits cannot make completed tasks due again. Cover the real create/update response and reloaded state; retain required-feedback reminders.

- Security: update the extension's DOMPurify dependency from 3.4.16 to 3.4.17 to resolve the production dependency audit advisories, including GHSA-cg2g-xh64-v4q7. No other dependencies or audit gates are changed.

- Fix: keep filesystem `edit_file` anchor mismatches recoverable through a typed MCP error, so the agent can re-read the file and correct `oldText` without ending the turn. Preserve write confirmations and exact-match editing.

- Fix (Windows): retry only transient EPERM/EACCES/EBUSY failures of the existing atomic JSON/text replacement, with five attempts and 150 ms of scheduled waits. Preserve synchronous config updates, original files on terminal failure, and existing permissions. Add real Windows conversation-save lock/release and persistent-lock regressions; this does not identify the user's external lock owner.

- Sync the terminal retirement source contract with the current separate connect/offline cleanup paths; retain local retirement and stale-socket rejection.

- Windows Job cwd 使用 Node URL 构造器，保持文件 URL 路径行为并兼容测试中的 DOM 类型。

- Fix (#705/#747): serve Windows offline desktop resources through the existing nonce-aware exact-URL handler, removing the competing virtual-folder mapping and rejecting failed navigation/filter/handler registrations. Preserve #705 local/workspace retirement, all seven resources and the two-marker nonce helper. Source controls do not establish native acceptance or explain historical macOS exit65/Windows refusals.

- Refs #747: terminal acceptance checks the complete marker in each actual xterm parser's active buffer after real write callbacks. The independent Node observer serializes original bytes and successful resizes; the unshipped form binds its actual Terminal to the owned operation and document. Preserve full-marker, trusted input, ACK, selected-return, real exit and 45-second requirements. CPU controls do not establish a historical native cause or replace Windows/macOS acceptance.

- Test reliability (#625): publish the concurrent registration fixture's complete grant receipt by an exclusive temporary write and rename. Seeing the final file now means its JSON was fully written; preserve real competing registration, live-grant checks and the existing wait limits.

- Fix (#732): settle hosted Xvfb display readiness on terminal pipe/process events and reject a display whose owning process has already exited before starting Chrome. Reuse the same consumer in the supplier witness and history business; retain display framing, original deadlines, owned cleanup and all history assertions. Add finite pre-cleanup observations; the physical cause of the earlier hosted failure remains unknown.

- Windows installer (#764): request only `node.exe` and `cmspark-agent.exe` candidates from CIM before applying the unchanged installation ownership and system-Node script/mode checks. Preserve the complete NSIS/ZIP stop and sibling-survival regressions and their existing time limits. This reduces returned candidates; it does not establish the unique cause of earlier enumeration timeouts.

- Fix (#480): verify the sibling inheritance fixture with parent-side kernel-object identities before resuming its suspended checker. Preserve raw exit masks separately: reused numeric slots do not prove protected pipe/process inheritance. Real leaks, missing/unknown identity evidence and checker/cleanup failures still reject. Historical failing-slot identity remains UNKNOWN; native gates and time budgets are unchanged.

- Fix (#476): compare desktop history file identities as exact 64-bit integers before reading the opened transcript. Distinct device/inode values must not become equal through JavaScript Number rounding. Retain the real replacement regression and add large-identity acceptance/refusal controls; no CI gate or timeout is changed.

- CI / packaging (#757/#758/#759/#760): compose activity acceptance with the pinned Node 22.23.4 runtime and separated native stages. Pin the added X11 job, bind Windows notifier staging to the validated SEA executable, and update exact workflow/dispatch consumer inventories. Retain all activity assertions and the authorized retirement of only the two automatic #723 first-identity steps; this composition does not claim their native cause is fixed.

- Refs #723: remove the experimental Chrome/native first-identity gate and its dedicated failure upload from automatic CI at the user's request. Keep the independent acceptance scripts and CPU controls; all other CI gates remain required. CI success does not establish #723 native identity or masking readiness.

- Security (#759): upgrade packaged Node, all CI/release jobs, native build headers/import library and the digest-pinned validation image to Node 22.23.4 for the [2026-10-21 Node security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). Development engines now require `>=22.23.4 <23`; Windows SEA and native packaging require exact 22.23.4. Windows SEA resolves one executable and reuses it for validation, direct Node build calls and the embedded base. Node 24/26 are not yet qualified. This runtime security update does not establish the cause of existing Windows native CI failures. Product version remains 0.6.14 (unreleased).

- CI (#760): report native fixture build, test compilation, bootstrap/process acceptance and desktop interaction acceptance as separate ordered steps, preserving commands, failure handling, Windows/macOS checks and all native assertions. This improves failure attribution without claiming the outstanding Windows failures are fixed.

- #705 修复未发行 macOS picker 验收的目录 URL 字节合同：Swift 明确生成目录 URL，Node 严格匹配唯一带末尾斜杠的 runner bundle URL；补真实 Foundation 回执回归，原身份、ACK、静默与实际关闭门禁不变。此项不证明历史 exit65 原因或原生验收通过。

- #464 ACP v1 初始化改用标准 `clientCapabilities` 字段，保留原文件/终端能力全部关闭、超时和响应拒绝；补实际 JSON-RPC 请求捕获回归测试，并说明网页 diff 已支持的明确未加引号文本重命名。字段校准不证明真实 Agent 兼容或业务验收，#464 整票仍为 Partial。

- #705 在现有 macOS picker 失败点增加父进程关闭后的有限 Xcode 日志快照：只发布固定状态、标记和允许的错误域/码，保留私有文件/FD 边界、原错误及清理语义；退出 65 的实际根因和原生验收仍为未知，未改变 45 秒或启动/身份/ACK 门禁。

- #705 未发行的 macOS picker 验收包将 Format1 描述文件的唯一 UI 测试目标绑定到已构建并签名的固定 owned app；清单记录最终描述文件字节，保留原描述文件证据。此项不证明历史 exit65 根因，真实启动、身份/ACK、选择取消与关闭门禁仍须新 head 原生验收。

- 活动记录增加 Windows / Linux X11 被动采集、平台应用身份、本地 OCR 语言与系统通知回执；Wayland/受限环境提供主动 PNG 导入，保留人工确认和来源未知边界（#758）。

- Refs #752–#754：新增个人工作中心（今日、待办、资料与活动记录），侧栏保留对话入口；指定 macOS 前台应用截图与本地 OCR 默认关闭，模型分析单独选择。候选经用户确认后成为待办，保留来源并分别跟踪处理与反馈；本机后台服务持久安排提醒，明确系统通知提交不代表已读。无接口聊天不能覆盖不可见的群与历史；其他平台暂不支持此截图路径。
- Refs #754：一句话设置接入模型语义候选与逐项预览，显式确认后沿用原配置保存并读取核对。语音结束只填草稿；权限、语音偏好、记录与提醒策略需要在对应入口单独核对，不虚构自动应用结果。

- Refs #747: route Windows offline desktop assets through the existing nonce-aware, exact-URL response handler instead of virtual-folder mapping, which bypassed that handler. Fail closed if nonce/navigation or resource-handler registration fails; keep CSP and all native acceptance assertions. Source-derived nonce regressions do not replace Windows native validation or explain the separate heap-crash receipt.

- Refs #747: terminal acceptance observes the owned PTY PID when real data arrives, allowing the locked Windows implementation's initial PID 0; completion still requires a positive stable PID on the same handle and actual exit. Added inert real-producer regressions; native Windows acceptance remains required.

- Refs #747/#476: add a closed first-observed refusal code to the unshipped terminal acceptance fixture only; preserve original failures, native45s, authority and cleanup. Codes identify original rejection groups, not Windows physical causes; current native failure remains blocking.

- **#476 桌面用户终端开发候选**：从已明确绑定的对话目录，经原生确认进入原单 PTY 与离线 xterm；所选终端摘录另行确认后保存到原对话。目录缺失诚实不可用，该早期终端独立候选不含桌面 Agent／新目录选择；当前组合保留 #705 的工作区选择和 Agent 路径，两者仍须各自原生验收。不自动开启模块、默认目录或模型尾部读取。保留当前归档／浏览器与 ACP claims；当前组合的真实 Windows/macOS 原生验收尚未执行，不发版、不关闭整票。

- Refs #723/#755: bind the native-host registrar’s six filesystem reads to the built-in PowerShell Management module after a bounded Windows command-resolution comparison; retain ownership, reparse checks and cleanup. Native full-flow acceptance remains required.

- Windows CI (#723): add one human-approved, bounded phase/checkpoint observation for the first-identity gate; preserve build120/runtime-cleanup45, original results and 4096-byte finite evidence cap. Unknown intervals remain unknown.

- Refs #723：经用户明确批准，将同次固定源码编译拆为最多 120 秒的必过准备阶段，原生运行与清理仍限原 45 秒。交接绑定真实关闭回执、源码、nonce 和文件身份；超时晚到不能进入原生阶段。真实 Windows 与精确 main 验收仍须通过。

- Refs #723：远端身份夹具的 CDP transport 终止同步拒绝 target／default-context 事件等待，避免命令已 ACK 后只等外层超时；保留原 abort 原因、45 秒、身份及 cleanup。新增真实类的 LF/CRLF／关闭／迟到事件回归；此为已证生命周期缺口，不认定历史 Windows 超时原因，native 身份与 mask 仍未完成。

- Refs #723：隔离启动器的 CPU 自检读 claim 时显式兼容 Node 仍持有的写句柄，保留只读访问、原 nonce／身份校验与 lease；新增真实 Windows 旧默认共享拒绝负控及 LF/CRLF 源回归。此为验收夹具修复，不代表 Chrome 窗口身份或 mask 已通过。

- Refs #723/#732：修复新增 fd3 观察器在 Node22 Windows 上被 `isFIFO()`／`isSocket()` 固定 false 误拒的问题，按原 fd3 的真实类型位限定 pipe/socket；补齐历史连接 VM 对新增 bridge 断线消费者的惰性依赖与调用回归。保原 PASS／拒绝、4KiB 与身份门，不据此认定历史原生首错或启用 mask；仍为 0.6.14 开发版。

- Refs #732：hosted 验收改为固定官方 Linux CFT 包供应、独立精确端口／版本正证再执行原完整 SidePanel 历史业务；旧 A/B 实验步骤退休且失败保留。CPU／纯文件解压不是浏览器通过；后续真实 hosted Linux 验收已完整通过重启／重载历史、取消与清理，不代表 Windows 浏览器或实体真人授权；不发版、不改原业务时限或产品权限。

- Refs #723：首个 Windows 窗口身份验收的失败回执记录实际子进程 close/退出、固定 PS 源坐标与检查序号，区分子进程失败和随后回执数量断言；仅输出有限字段，不公开原始错误、路径或环境。此项修复验收证据缺口，未证明历史注册失败原因，不改变准入、原生门禁或时限。

- #750 CI 编排：Windows 全量 census 与定向原生验收拆为两台独立 hosted VM，保留各自完整原生准备、串行桌面保护、原测试／时限及 census 密封证据；两路都必须成功。已有 workflow／NSIS CPU 契约检查提前至原生编译前，npm 下载缓存键覆盖双锁而不缓存执行产物。墙钟与总 runner 成本以新 head/main 实测为准，不宣称修复 #723 的 UNKNOWN 原生超时；0.6.14 仍为开发版。


- Refs #723: add remote-only owned-window Windows capture acceptance for actual PS5.1/PrintWindow, passive refusal and real BitBlt quality; CPU checks remain separate from native verification.

- **Refs #723 Windows 观察质量（开发候选）**：窗口渲染源和屏幕拷贝使用闭合质量标签，遮挡／部分截图不作为目标页面 OCR 正文；凭证黑化、确认预览、模型结果、时间线和密封证据保留提示。只读捕获与确认前预览不恢复／抢焦点；原注入 L2、时限、对话框通道和阈值不变。可信 HWND 遮罩与只读准入尚未实现，CPU 不代表 Windows 原生或整票完成。

- **#723 D2 首个身份纵向开发候选**：仅增加 nativeMessaging 与固定 `com.cmspark.cockpit` host 的 document/当前 owner/认证 WS bind/dispose 链；新增 Windows smoke 末尾 gating 入口与固定 CFT 供应校验。真实 pipe/parent/Job 清理尚待远端验收，空 pin 明确 NOT_READY；不含 mask、通用执行、额外动作授权或发版安装，版本仍 0.6.14。

- **#726 Windows 选夹验收路径域**：仅测试的预期工作区使用原生 realpath 规范化，避免成功选夹返回的长路径与临时目录的 8.3 短名直接比较。保留实际选夹、绑定、取消、ACP cwd、所有者和清理断言；增加真实 Node JS realpath 与显式原生绑定 seam 的 LF/CRLF 回归。受控 CPU 通过不代替新 head 的 Windows 原生验收。

### Fixed

- 原生本地终端验收在原期限已失败后，只按确实观察到的自身 PTY 退出、关闭与槽位释放事实收回占用；保留原始失败，不新增清理计时或释放未知资源。

- Refs #732：hosted reload 验收先通过真实 stock 导航选择并核已提交 owner，再打开历史面板，避免 header 先于异步线程 hydrate 时被正常 owner 切换关闭。生产 owner、原导航／业务时限和原生历史断言不变；CPU 调度回归不代表当前远端首错或原生通过。

- Refs #732：历史连接广播只更新连接观察与历史失效，不再借用会清空聊天忙碌／流式内容的状态清理动作；保留原状态轮询的断线清理。新增实际广播→reducer 回归，并复验既有 Hint 断线保草稿／聊天不变约束，不放宽原断言或原生门。

- Refs #732：接力历史消费真实连接生命周期消息，连接丢失立即失效旧历史／待回执，以仅 UI 内存修订值跨同批快速重连刷新当前面板。保 owner/request/selection/runtime-object 围栏，不自动恢复进程；CPU 非原生通过，hosted 首拒绝谓词仍 UNKNOWN，0.6.14 为开发版。

- Refs #732：hosted 夹具在监听登记后等待同 worker 关联通道的真实 Chrome API 回执，并在原隔离准备子进程用正常 ThreadManager 持久化唯一合成预绑定对话，再通过实际导航 UI 选择与核验。移除不具原生选夹收据的 workspace.set／传输 ACK 假绑定路径；这不是 picker 或真人授权证明，真实 ACP 创建、确认、重启／重载／取消与隐私门禁保留。当前原生首失败仍 UNKNOWN，开发版不发版。

- Refs #732：hosted SidePanel 验收按固定 Chromium 155 的实际 DTO 分离 context UUID／大写32位文档 token；非 tab Port 只作其真实端点二级核验。正证改为原生事件／上下文与完整双目标集合唯一性、已知浏览器 profile 及实际 frame／loader 连续性，歧义、导航 ABA 和清理期间失效均拒绝。原手写 UUID／Port 字段正控不再冒充真实回执；CPU 非原生通过，原完整历史业务仍 NOT_READY，0.6.14 为开发版。

- Refs #732：hosted SidePanel 证明严格比较原生 `onOpened` 的 URL pathname（含前导 `/`），不再与相对资源路径混用；永久正控由实际 URL pathname 派生，并拒绝相对拼写。固定供应正控已实际完成，原完整业务仍在 `PANEL` 拒绝、唯一首因未被公开回执定位；本修正不冒称原生或历史业务已通过。

- MCP SDK 升至 1.32.0：HTTP 默认只跟随同源重定向，拒绝把自定义请求头、会话标识及 307/308 请求正文转发到其它来源；stdio 连接方式不变。补真实 SDK 与应用 HTTP 构造路径的受控回归。版本仍为 0.6.14 开发版，不代表已发版或安装；任务存储安全公告不表示本产品已启用或遭利用。

- #732 hosted 验收候选以请求内 `onOpened`、原生 `SIDE_PANEL` 上下文和实际临时 Port 的 `sender.documentId` 绑定目标，拒绝仅凭同 URL／非 tab 的不足证明。保留原真实 DOM、daemon 重启、历史、单一时限及清理门禁；只改验收与受控回归，不宣称已定位旧 `PANEL` 唯一原因或原生验收通过，版本仍为开发版。

- Refs #723：固定 Chrome Job 环境补入由同 SystemRoot 派生的 ComSpec，满足 CFT155 支持的 Native Messaging legacy 启动分支；保留原五字段、排序／双 NUL、固定 argv、隔离及 45 秒。新增实际源生产器与固定155消费者的惰性正负控，不继承任意父环境或覆盖 feature/policy；当前原生首错仍 UNKNOWN。

- Refs #723：补齐首个身份 controller 实际调用的 Job builder，两项 `/main` 分别等待原编译进程并读取自身 ExitCode；现有前置编译控制增加实际 Job 源正控及两项分别缺失 Main 的数值退出负控，不执行产物。原 45 秒、身份重编译和后续门保留，未认定当前 first-identity 失败原因。

- Refs #723：固定 csc 构建、framing 编译和 framing EXE 分别直接等待原 Process 并读取其真实退出码，不再依赖可能未设置或陈旧的 PowerShell 自动变量。原编译参数、拒绝、摘要和后续原生门保留；前置接入同 PS5.1／同编译器的好、坏源码必需控制，不执行其 EXE。当前仍需真实 Windows 验收，不据此认定历史 csc 分类或旧注册失败唯一原因。

- Refs #723：Windows 在完整 census 前单独验证固定桥接程序的真实 PS5.1 构建与产物摘要；原 Node 标量九项、注册、framing 和真实身份门禁保留。独立构建只编译、验证、清理自有临时产物，不运行或注册 host；构建失败立即拒绝，不再等长套件后才到嵌套构建边界。旧 `registration-framing` 首因仍 UNKNOWN，不冒称本次拆分已经修复原生问题。

- #723 首个身份验收的 Node launcher 显式限定 PATH 优先的单一 Application 与单一普通非 reparse EXE，拒绝数组后再读取标量属性；新增 canonical 前真实 PowerShell 分支回归，完整身份门仍在原末尾。尚不表示 CFT、bridge 或真实窗口身份通过。

- **#723 D3 只读会话开发候选**：全查看/截图/等待仅在同一真实认证扩展端点、服务端普通对话与应用内，首次origin+nonce人工L2且读取完整成功后受限复用；每次新token，只读探测保留本次UIA结果而不持久化缓存，避免正常写回自触发失权；断线/取消/失权/subject变化/失败/凭证未知退休，不借注入G1或模型标记。独立capture尝试限率复用原30/60秒，注入双开关/白名单/45秒与原例外不变；实际executor派生的started标记只令全读取留后台，首确认/暂停仍显眼。CPU不是Windows/浏览器证明，可信HWND/双帧mask和whole723仍未完成，不发版。

- #464 GitHub 比较观察拒绝未解析的可见表格行、混合非 TD 单元格或同一行额外未知 TD；changed/context 必须完整匹配原三列，hunk/空 expander 完整匹配原两列，仅跳过原固定三列辅助标题，避免遗漏内容后仍把代码覆盖标为 complete。补实际序列化 producer、存储与材料链负控；不改变审阅齐备状态，也不代表真实平台或企业业务验收。

- #735：显式“新对话”不再被空列表自动创建的 2 秒去重窗口吞掉；自动初始化仍保留原防风暴窗口。内部显式意图 hint 不证明真人、不授权且不进入 WS，原 sender／鉴权／确认不变；受控源码回归不宣称 hosted SidePanel 或 Windows 原生验收已通过。

- Refs #725: Windows 安装和打包对精确锁定的 node-pty beta.15 JS 应用自然退出后 output-worker 退休修正；复用原 worker dispose/flush，不按已退出 PID 再 kill。未知依赖拒绝，普通缺少 optional PTY 包仍降级；不声称解决当前 Windows CI pending 或全部原生资源退出。

- #725 开发候选：在原终端打开确认和首输出前明示回显、模型暴露及正常回复留存，仅对确实批准后新建的同一 live 对象开放当前认证对话的明确只读尾部拉取。内存8192 UTF-8字节与完整JSON8000字符双限、纯文本控制字/标记惰性化、先taint再返回；无写入/自动读/跨worker或新授权。工具自身持久化/二级投影不保留正文，不承诺去除普通模型回复转述；CPU控制不冒真实PTY验收或整票交付。

- **#726 MCP 本机目录候选（开发候选）**：仅实际官方 filesystem stdio 连接、当前授权与已生效允许根内的成功操作，携带后端私有来源到当前对话实时提示；目录操作使用实际已准备路径，文件操作只取明确非 home 的共同允许根，不解析正文或猜文件 dirname。最多16根／16固定操作数／每路径4096字符，仅 outer tool.result 增加目录观察，不改变模型 ToolResult、L2、MCP 结果与权限。HTTP／自称同名、注入 transport、失效／取消／跨线程或旧连接不生成候选；原三条内存预算与 native picker 唯一绑定不变。来源测试不是真实 MCP 服务验收；实际 Panel 的受控 mounted 消费链与独立远端 Windows 选夹／ACP cwd 已分别验证，边界见测试说明。候选不绑定，整体验收以精确发布 head/main CI 为准。

- #739 显式并发上限扩为1..4（默认1），用私有 session 对象占位统一准备、协议探测／CLI、取消至真实 close 的计数；同 Agent 仍单执行，N>1只允许已明确选择的纯 bridge，不扩 PTY 或逐次 L2 权限。提案改为4／对话、16／后台与同对话 Agent 去重；旧存量不删除。面板保留有序会话列表、显式选择和只读执行阶段，双 UI 修订与私有唯一回执关联防止迟到反馈跨选择覆盖；失败 handback、来源与 taint 不变。补受控生产者和 Windows CI-only owned overlap 夹具；未冒称真实 CLI／模型／平台已验收，不发版或安装。

- **#726 Git 目录来源连接（0.6.14 开发候选）**：既有编程接力 Git 状态请求沿用 WS `id`，仅保存当前线程／选择版本／连接的已登记请求；发送成功且精确回复同一次请求、规范目录一致、无错误且确为 Git 仓库时，才增加最多三个内存提示中的“Git 实际目录”。它是已执行状态查询的 cwd，不推断仓库顶根；旧回复、发送失败、断线、ABA 或重复请求均不授权绑定。已见提示在明确解绑后仍可预导航原生选择器，重载即清空；不新增查询、权限、RPC 或自动启动。MCP 本机来源与实际 Panel 的受控 mounted 消费链已有各自证据；原生门禁独立，整体验收以精确发布 head/main CI 为准。

- Refs #726: the remote-only native picker controller discovers the unique owned modal through held-child threads, including hidden-owner layouts; original picker success, cancellation and time budgets remain required. CPU projections are not Windows acceptance.

- **#726 工作区目录提示（0.6.14 开发候选）**：编程接力未绑定工作区时，仅从当前连接、当前对话实时完成的 shell/ACP 提案保留最多三个内存提示；提示只预导航原生选择器，实际确认选中的路径才可绑定，不自动启动或授信。UI 新提案优先使用已绑定对话目录；折叠／失败／旧回复、MCP 远端路径及无精确关联的 Git 状态不纳入，重载／切换／断线即清空。受控 Panel 挂载链与独立远端 Windows 原生 OK/Cancel、绑定及合成 ACP 进程实际 cwd 已分别验证；不冒称同一次物理浏览器／原生 e2e，精确发布 head/main CI 仍独立验收。 活动工具 ID 重复会保守停用该选择／连接的后续提示收集；字面 cd 仅由实际 shell 成功输出派生有限 declared_cwd，不广播原命令，cmd/POSIX 引号分别拒歧义。

- #480 Windows 原生 metadata 验收将同一测试的 abort 同时绑定 metadata 与 closing 等待，超时取消立即进入原 owned-child 清理并继续等待真实退出；正常完成卸载监听。保留原20秒、退出0、认证／元数据／窗口断言与 surface 清理，不冒称已定位或修复 Windows 晚退出原因。

- Windows #480 未交付 hostile 验收夹具仅在精确导航 ID 的取消完成事件、原 owned 页面及文档代际均匹配后推进下一脚本；保留生产导航拒绝与原生验收预算。该源码调度更正不宣称历史引擎失败原因。

- **#723 空闲确认台收起（开发候选）**：已认证扩展通过同一 WS 只读核对 Companion 全局确认/计算机任务是否空闲，再收起精确自有 popup；未知/忙保留，晚到重确认沿原 #326 策略重开，轻量确认不抢焦点。保留 L2/45 秒及原误拍保护；不代表原生验收或 quality/rect/只读脱 critical 已完成。

- #722 CLI 会话追加提问生成的后续提案复用同一容量预检、逐次确认和最终准入回执；忙碌在确认前可见，迟到批准、提案变化和启动取消不再被回复为已受理。错误绑定原请求会话，所属对话冲突仍拒绝并保留有效请求 owner；补齐源码耦合的 marker CPU 夹具接口，原单执行、L2、worker/owner、原生时限不变。

- #731 为 Windows 单一、无扩展／元字符的非 ASCII literal cmd `echo` 增加显式 Unicode stdout 合同与流式解码，保留原命令、cwd、环境、L2、逻辑 shell、退出／停止／超时和输出预算；`type`、复合命令、自定义 shell、外部程序及非 Windows 保持原路径，未知 stderr 仍标注。原生测试将 echo 加强为精确中文／CRLF／无虚假警告，受控字节不是 Windows 已通过；0.6.14 仍为开发版。

- Windows 原生继承夹具仅对 sentinel 使用确切内核对象身份，先捕获旧数值槽再打开独占命名 Event 引用；无关 Event／管道占槽不冒称继承，真实继承及未知 API／比较／关闭失败仍严格拒绝。保留 V1、原 protected endpoint、bootstrap、20秒与清理；不宣称已证明历史 launch 失败根因。

- #572 Windows 原生测试夹具仅在自有 sibling 已渲染、实际 IsActive 且前台 HWND 精确匹配后才原子发布 ready；Activate 请求本身不作成功证据。复用 ContentRendered/Activated 事件和原 45 秒边界，不加轮询、输入或前台权限；从未实际激活仍失败。LF/CRLF 源码回归不代表实际 Windows 已通过，也不判定旧原生失败的唯一原因。

- #732：只在本次独占创建且仍为空、保留句柄与精确 bigint 身份一致的 Windows history temp 上初始化当前用户 owner／受保护有限 DACL，再经原只读 PRIVATE 门后写元数据；已有 config/root/history ACL 不修复、不接受 Admin-owner 替代。原生夹具改为在绑定 owned parent 下显式安全描述符新建唯一 root/empty；CPU 与内存编译不代表 NTFS 或整票验收已通过，0.6.14 仍为开发版。

- #732 原生隐私 positive 首轮拒绝后，仅在显式 GHA Windows gate 下补一次同路径只读原因回执；默认生产输出与所有 owner／ACL 谓词不变，原失败不会被第二读或诊断替换。闭集原因和0/1/null索引不泄露 SID／SDDL／路径，不更改 ACL、token 或权限；不是已修复 NTFS 根因或整票完成。

- #605 Windows 原生管道回归夹具的 ready JSON 先写独占临时文件、完整关闭后再原子发布，避免 `exists` 已真却读取到空 JSON。补确定性开文件／写入失败控制，保留原管道、cwd、ignored stdio、时限和清理断言；不将夹具竞态冒称产品管道故障或所有 Windows 失败的根因。

- #730 将原坐标操作30次／60秒限流的拒绝透传为类型化可恢复反馈，对话可等待或改做其它工作；限流仍拒绝当前操作，不跳过确认或自动重试。相邻单任务忙出口保留原不可恢复等级，并补完整生产准入链、虚拟时钟与安全负控。

- #722 补齐同线程多提案的有限生命周期：4个／对话、64个／后台、15分钟仅待启动项懒过期；执行仍固定串行1个。面板可显式选择既有提案，按原快照逐次确认启动或取消；重复／过期／迟到批准不自动排队或启动，待启动／本机 shell 文案保持诚实。

- #722 编程接力 UI 在确认期间容量被其它会话占用时，向原所属对话返回真实 typed 拒绝，不再把未准入会话回复成 running。用请求内私有准入观测区分即时拒绝与已创建子进程后的同步取消；后者立即反馈取消，真实关闭前仍保留运行槽。已准入的长会话仍及时响应，拒绝与同步取消不自动重试；前端只显示“启动请求已受理，正在准备…”。保留固定单执行、逐次 L2、worker/owner 和原终态清理；受控 CPU 不代表实际 Agent/Windows 验收，整票的多提案与生命周期余项仍保留，0.6.14 仍为开发版。

- #732（0.6.14 开发中）：新增仅 hosted 的生产 Companion crash/restart 与真实 SidePanel reload 验收候选；保留原页面无幽灵 running、同数据历史、正常取消及严格清理断言。CPU 控制不代表真实浏览器/daemon 或 Windows ACL 已通过；真实第五 job 首轮在 BROWSER 拒绝且清理成功，根因未知。补最后固定浏览器阶段与 cleanup 前 child 存在性／有限退出码回执，不输出 stderr／身份／正文，不改沙箱、启动、预算或成功条件。

- #732 新增编程接力最小元数据历史与对话内只读清单，目标、路径、输出、命令与授权不落此文件；历史不恢复进程或旧会话权限，失去运行句柄的记录显示已中断。私有存储验证失败明确提示不可持久，真实 NTFS／服务重启与侧栏刷新仍待对应验收，整票保持 Partial。见 [会话历史说明](docs/acp-history.md)。


- #727 在既有“更多”能力菜单和编程会话 chip 增加打开编程接力入口，并补空对话入口提示；只开面板，不自动提案、启动或打开终端。#722 修正待启动提案的面板空输出提示；容量与生命周期余项仍保留。
- #724 内嵌终端显示权威启动来源，缺失或未知时不冒称 Agent 就绪；首个输出帧及既有 heartbeat 记录有限字节/ACK/暂停/输出年龄诊断，不记内容、不新增计时器或模型内容出口。

- #731 `shell_exec` 按流式 UTF-8 解码 stdout/stderr，避免中文字符跨数据块时损坏；非法 UTF-8、含 NUL 的输出及 Windows 非 ASCII 命令经 shell 控制台转换后的非空输出在既有 note 和进度尾部明确标为编码不可判定，不猜测 GBK、不改命令或系统代码页。保留确认、沙箱、退出／停止／超时及输出上限；受控 CPU 回归不代表真实 Windows 编码验收已完成，0.6.14 仍为开发版。

- #731 增加 remote-only Windows 原生 pipe 验收：真实固定 echo/type/CP936 emitter 经原 shellExec，拒绝缺失 canonical owned 前置，并保留编码不可判定分支与原清理／预算。源码候选和非 Windows skip 不宣称真实 Windows 已通过。

- #729：页面只读 DOM 观察与交互失败分开计数，保留四次来源失败、两次定位失败和 CDP attach freeze；读取被限时只提示换策略或显式重置计数，不再因点击失败连带禁止读取或引导升级权限。真实浏览器与 Windows 验收以当前 CI 为准。

- Windows computer capture now refuses a recognized confirmation-cockpit title in target selection, ownership, L2 preview and the final screenshot boundary. The existing BitBlt fallback rejects failed foreground/rectangle checks and foreground drift before saving. The title is spoofable and does not authorize a window; this does not prove absence of all occlusion or complete #723. Existing L2, thresholds and budgets remain unchanged (Refs #723).

- #722 修复 ACP 提案因当前会话或单进程容量占用而被拒绝时丢失结构码、误停整轮的问题；返回本线程有限 holder 与建议动作，其他线程会话信息不外露。start 在任何异步准备前同步检查唯一运行槽，防止不同线程预先获得的提案同时启动；取消后仍等进程真实关闭才释放。忙碌仍失败，容量、逐次 L2 和 worker/owner 门禁不变；提案生命周期、同线程多提案等原票余项仍待完成。

- #476 原生工作台新增当前对话的浏览器任务候选与显式背景／前台选择。状态与元数据仅访问已认证扩展；下一次同对话明确发送时才绑定真实运行，首行仅支持既有 `get_page_text` 精确 peer/tab 背景读取，未知浏览器操作拒绝且不自动聚焦／打开 Chrome。协议同步 v8；CPU 源码控制不代表真实原生／扩展验收，整票仍 Partial。见 [浏览器任务指南](docs/desktop-browser-tasks.md)。

- #464 开发中：GitHub tagged-release（限固定英文元数据布局、单段 ASCII tag，不含斜杠/编码 tag）的唯一完整发布元数据 HTML 可保留当前平台声明的仓库/tag/完整 commit 观测关系，材料按原 pilot、字段引用和 revision 核对。此状态不证明历史 tag、构建/资产/签名或发布批准，仍不提升 ready；真实 hosted browser 验收尚未完成。


- #476 原生工作台增加永久归档／恢复视图、标题及精确 ID 查询和同对话历史入口；归档保留 canonical 消息与附件，独立于 30 天回收站。写入绑定当前原生连接、一次性状态版本和真实活动检查；旧 Web 列表仍能访问归档对话。桌面能力协议同步 v7；受控 CPU 验证不替代 Windows/macOS 原生验收，工作区／本机／Chrome 等整票余项仍保留。见 [归档指南](docs/desktop-thread-archive.md)。
- #464 GitHub 比较采集在派生完整性前拒绝含额外代码单元格兄弟节点、未知包装、多义 BR/未知子结构或隐藏表格/行的代码；身份元数据必须位于 diff 外。保留合法空行 BR、普通高亮 span、原预算与全局非就绪状态；真实 hosted 浏览器验收仍单独执行。

- #464 新增 GitHub 完整 SHA 双点比较的有界网页观察候选：同次 producer 派生文件/hunk 清单，经服务端严格复核引用；保留通用未知、全局审阅未就绪及人工 Agent 回传。源码控制不代表真实浏览器、Agent 或业务验收，整票仍 Partial。

- 修复企业材料时间核对将二月三十日等不存在的日期正规化后误判齐备的问题；保留时区、时效和未来时间规则（#454、#455、#457）。

## [0.6.14] — 2026-10-19（开发版本，尚未正式发布）

汇总 0.6.13 源码切点之后已合并到主分支的改动。此处记录源码版本，不表示已经生成或发布安装包；发行包和未完成验收见 [版本与交付状态](docs/release-status.md)。保留 0.7.0 企业双场景里程碑的原验收要求。

### 10 月 19 日已验收增量

- #714 多 worker 协调修复：过早收集自有运行中子任务和等待查询转入同一有界运行时监督，整批工具结果先完整配对，等待时释放父模型槽，超时不再反复模型轮询或假报完成；保留真正失败三次熔断、用户停止、身份与确认边界。外层循环识别运行和排队子任务，部分报告的收集与验收统一来源校验。新增真实 adapter/dispatch/router 回归；本条记录源码行为，合并和本机换装另验。

- 测试夹具：STT 取消断言等待 fake runner 的实际进入事件，替代固定 20ms 猜测；macOS AX 夹具监听两个自有窗口的遮挡状态变化，仍经原完整绑定判据确认就绪。原时限、取消和背景安全断言保持；不将此归因于历史失败，也不声称所有原生环境已通过。

- #464 编程接力非零退出时，将已有部分输出判定同步到会话、handback、原任务保存标题和进度，避免失败回传仍显示“完成”；保留原终态、确认和报告引用校验。此修复不证明真实 Agent 兼容或业务验收，整票仍为 Partial。

- #464 对评语遗漏的已选业务引用补充明确缺项：按完整 kind/id/citation/commit 规范身份核对，不以同类引用或重复映射覆盖遗漏。仍接收部分评语，保留原状态、来源/范围拒绝和未就绪标记；此处仅核引用清单，不证明业务语义、真实 Agent 或企业验收。

- #571 按原票至少一条后台动作与逐行三态判据回填 d66 AppKit press 原生证据；WK 已知 TREE_EXHAUSTED 保留 Gap 与旧红历史，仅可经新零效果、fresh 完整 oracle 和原清理硬门验收。未知/权限/绑定/深度/超时不转 Gap，原动作与最低 Delivered 门不变；不是修复 WK 根因或宣布全 macOS 完成，新 head 原生/CI 待验。

- #571: native acceptance 的诊断编译开关下，locate 遍历失败新增固定分支布尔值、深度与 frontier 终态观测；不新增 AX/CG 查询，不改变遍历或后台动作，WK 原生失败原因仍待实际验收。

- #464 ACP v1 初始化改用标准 `clientCapabilities` 字段，保留原文件/终端能力全部关闭、超时和响应拒绝；补实际 JSON-RPC 请求捕获回归测试，并说明网页 diff 已支持的明确未加引号文本重命名。字段校准不证明真实 Agent 兼容或业务验收，#464 整票仍为 Partial。

- #571 CG 窗口对应不再要求已知与目标标题字节或有限几何分量相异的辅助行补齐其它元数据；只能排除确定不可能匹配的行。目标完整身份、可能匹配但未知的行、重复 ID、歧义与稳定复核仍严格拒绝；实际原生结果另验，不改变焦点/z-order/动作门。

- #571 hosted 原生验收新增同次 locate 的固定阶段理由与夹具四次窗口绑定理由；仅验收构建启用，私有有界观测不改变动作、ready、权限、20秒预算和清理。诊断尚不代表原生失败已修复。

- #571 AX locate/invoke 先用当前 PID、精确标题和有限窗口几何，把请求的 CG 窗口唯一绑定到完整且稳定的 AXWindows 成员，再从该窗口遍历；修复无尺寸 AXApplication 根在读取子节点前被过滤的问题。新目标窗口证据上限256，缺失、歧义或变化仍拒绝；原 hidden/zero-size、动作身份、E-Stop 和权限边界保留。
- #571 owned 原生夹具不再把 NSWindow 的应用设备编号当 CGWindowID；通过当前主屏坐标转换及完整标题/几何唯一对应，并复核同一窗口对象和两次 CG 观察。只修夹具身份，不代表 WK readiness 或后台动作已通过原生验收。
- #571 macOS 后台焦点 oracle 改读系统 AX focused app/window，并以完整窗口证据做唯一精确 CG 对应；缺失、歧义、变化或新256窗口上限返回未知，保留完整 z-order/光标/效果断言。仅源码修正，真实 hosted Mac 验收尚待完成，不代表后台动作已交付。


### 新增与改进

- **Office 导入**：使用锁定的 DeepSeek LibreOffice Kit 0.1.5 补充 DOC/XLS/PPT 与 ODF 转换；保留直接解析路径、引擎许可和缺字体提示。支持范围与拒绝边界见 [Office 契约](docs/office-import-contract.md)；专有 WPS/ET/DPS 仍需另存为受支持标准格式。
- **浏览器与协作**：新增有界页面控件编号快照；子任务返回父任务入口、编程接力反馈与手动入口、确认预览和站点恢复诊断得到补齐。站点计数重置绑定当前线程与服务端核验的站点来源；编号快照失效后须重新获取，不改变原动作授权。
- **项目与会议**：新增持久化项目元数据，项目归属不继承工作区或权限；侧栏和召唤器连续会议采集使用同一有界识别队列，显示积压与已保存范围，保留独立原稿和参考材料。见 [会议指南](docs/meeting-and-dictation-user-guide.md)。
- **宿主与应用**：补充 Windows 本机 Uninstall Registry 的有界候选发现、应用目录与漂移提示、原生对话/资源和 MCP 入口的已完成增量。Registry 候选不等于可信主程序，真实原生窗口与编程工作流的剩余验收仍见 #476 / #571，不能从组件通过推定整体完成。
- **ITCra 企业适配**：合入默认关闭的 REST/grant 扩展，绑定身份、浏览器实例、站点策略和单次人类授权；真实企业业务链接、第二身份与完整 T4 验收仍未完成，见 [接口契约](docs/itcra-enterprise-browser-contract.md)。

### 修复与验证

- Linux WPS 的 `application/wps-office.pdf` 正确归一为 PDF；上传 MIME 迁移保留自定义限制，解析/转换临时文件在失败时清理，格式错误保持可操作反馈。
- ODF 表格/图表采用累计展开预算；ODS 在 DOM 分配单元格之前收取列预算，保持全局限额与严格 XML 策略。#615 的 [四份公开政府 ODS 测量](docs/research/2026-10-18-odf-real-corpus.md) 记录拒绝和历史堆溢出，不承诺这些大型表格已成功转换。
- 修复多路 worker 汇总与反馈丢失、已关闭会话吞掉操作错误、切换线程后迟到回执覆盖当前 UI，以及已登记错误码被页面文案或 locator 元数据误分级的问题；保留原安全拒绝与未知错误边界。
- 应用授权和列表/新增等待期间重查当前配置，删除、禁用、替换与并行更新不再被旧回执覆盖；合并当前其它应用条目，保持确认与能力门禁。
- 增加 Windows 完整 canonical 测试普查与加密证据留存、逐文件 skip 记账、原生夹具隔离和实际子进程生命周期断言。历史 Windows 10 秒失败根因仍为 UNKNOWN（#639），不以重复跑绿或组件测试冒充根因修复。
- 版本同步检查覆盖两份包与锁文件、CLI/ACP/MCP、Windows 安装器默认值和活文档，避免只修改一个版本声明。历史文档中的版本与安装记录保持原样。

## [0.6.13] — 2026-10-10

0.6.12 切点之后的补丁，全部围绕**多智能体与编程接力的实测收尾**：Windows 内嵌终端端到端、编程接力面板常驻终端入口、collect_handback 对「像 handback 的报告」的 prose 兜底。版本锚齐 **0.6.13**。不叫 0.7.0（企业双场景未验收）。

- 编程接力面板新增常驻「打开内嵌终端页 →」入口（[#586](https://github.com/nehcuh/cmspark/issues/586)）：不依赖会话、不需要 embed_intent——「内嵌终端」开关开启且平台支持（macOS / Windows）时，随时可从面板工作区一行旁直达独立终端页（复用 `terminal.open_tab`，同设置区按钮）；会话级「在本插件打开终端」认领按钮语义不变（仍一次性、线程绑定）。
- **编程接力的内嵌终端（网页终端）支持 Windows，端到端**（[#584](https://github.com/nehcuh/cmspark/issues/584)）：五处 darwin 闸同口径放行 win32——`pty/session`、`pty/handler`、`acp/open-local-terminal` embed 早闸、`acp/manager` 的 `embedEligible`（embed:true 唯一生产者，不放行则下游全死代码）、`capability-context` 系统提示词（不再向 Windows 用户宣称「需要 macOS」）；侧栏「在本插件打开终端」按钮改用 `isEmbeddedTerminalSupported()`（macOS / Windows，Linux fail-closed）；win32 缺省 shell 为 PowerShell、不带 bash 主义的 `-l`、整段忽略 `$SHELL`（MSYS 注入的 POSIX 路径在 win32 spawn 必 ENOENT）；`terminal.opened` 帧 `platform` 如实上报、pid 未知时如实缺省（ConPTY 子进程异步就绪，wire 容忍缺省不再丢帧）；设置项文案去掉「仅 macOS」。真机实测（真 node-pty ConPTY + 完整 wire 面）通过。Linux 保持 unsupported 另票；默认关不动摇。
- collect_handback 不再把「有点像 handback 的报告」当硬失败：报告含非 JSON 代码块（YAML 示例/规范摘录）时降级走无 fence 路径；fence 改为从后往前逐个尝试、取第一个通过 schema 校验的——合法 handback 之后引用的 JSON 示例不再顶掉 handback；结构化解析失败（含引用示例缺 `schema_version` 等 schema 近失、empty_ok 语义拒绝）一律按 0.6.8 决策降级 prose 成功收取（`structured=false`），解析原因经 `parse_note` 穿透 cooperation 投影到父对话并如实入审计；`schema_version` 为字符串 "1" 刻意不容忍（模板回显会被幂等 fold，永久挡住真实发现）。`ibg908` / `9lvswp` 双实测的三连熔断断轮消除。

## [0.6.12] — 2026-10-09

0.6.11 切点之后的补丁。两条线：一是「本该能继续的失败被当成致命错误」的收尾（缺标签恢复、Windows UIA 点击、run 结束记录、跨平台测试）；二是 **#578 worker 上限改占名额口径**（PR #579）当天 12-agent 多路对抗评审的收尾（PR #580）——回收站占位可见性、墙钟回拨、双闸文案归因、测试绑定。版本锚齐 **0.6.12**。不叫 0.7.0（企业双场景未验收）。

- 多智能体 worker 名额的「占名额口径」补三个评审缺口：回收站里仍占名额的 worker 现在会在 `list_workers` 里以 `trashed: true` 列出、舰队快照新增 `trashed_occupied_count`——「5/5 occupied (trashed workers still count)」从此可在产品内对账（此前名额闸数它们、诊断面却看不见，paused+回收站变体更是永久占名额且不可见）。
- 逾期孤儿（从未跑过且超 idle_ttl）的让位判定改用单调高水位时钟：NTP 回拨 / 挂起恢复不再把已让位的 worker 翻回「占位」、不再让 spawn 门在两次评估间振荡。
- `spawn_expert_team` 的双闸（名额/预算）拒绝文案按真实阻塞归因并携带当前 N/5、M/20（此前「仅预算耗尽」被误报成 occupancy 上限，模型会去等一个永不变化的「占用释放」）；确认卡路径同款。
- 评审测试缺口补齐：dispatch / expert-team 两个生产点的活性谓词注入、双上限 `min()` 的预算腿（occupied=0、M=19 → 余量 1）、`list_workers` 行级 occupancy 均有「删除即红」的测试与源码守卫。
- 缺标签恢复不再把页面标题送进错误分类。分类先于标题拼接；`No tab with given id` 登记为可恢复的 `TAB_NOT_FOUND`。无码或未登记码仍走文案兜底。
- Windows 后台左键只把 UIA Invoke 当成点击。Select / Toggle 成功改走坐标点击。
- 上一段 run 的结束记录不再盖掉下一段。没有下一段时，中止仍记为 aborted。
- UIA 调用带上 `-StopFile` 的断言在所有平台的适配器测试里跑，不再只靠 Windows 集成测试。

## [0.6.11] — 2026-09-30

0.6.10 之后的补丁。这一批集中在**「本该能继续的失败被当成致命错误」**这一类上 ——
其中好几处会让对话无故中断，或让某个功能静默失效。

浏览器与工具：

- **等待页面元素此前基本不工作**（#554）：`wait_for` 内部的异常被静默吞掉、代码注释里承诺的
  兜底通道从未实现，于是每次都空等到超时，还把原因报成「等待选择器超时」。现在会换通道重试，
  并把真实原因带出来。
- **页面异常文本不再进入错误分类**（#556 / #558）：页面可控的异常文本此前会进入错误分类 ——
  一个异常页面就能把普通失败判成「安全中止」，**把整轮对话断掉**。这些文本改为只走数据通道。
  无码失败仍看文案；缺标签恢复当时还会把标签标题拼进分类输入（见 Unreleased）。
- **读图失败不再终止整轮**（#559）：`analyze_image` 此前任何失败（图片挂了、格式不支持）
  都会以「安全中止」结束对话；现在按可重试失败处理。
- **参数/授权类拒执不再计入站点熔断**（#528）：连续几次「evaluate 缺少授权」曾把一个站点升级成
  「禁止交互」，**反而封掉了本该成功的重试路径**。现在这类失败不计入熔断。
- **`osascript_eval` 全平台下架**（#529）：它在现代 Chrome 上是确定性死路（AppleScript-JS 默认关闭），
  却仍作为候选出现在工具目录与提示文案里，反复消耗动作预算。

错误判定的一致性与可维护性（#560）：

- **已登记的错误码不再看文案**（#560）：错误等级此前取决于报错文案有没有命中关键词 —— 同一个错误
  换个措辞，就可能从「可重试」变成「终止整轮」。已登记的码现在只看码。无码或未登记码仍走文案兜底。
- **补齐错误码登记**：登记表从 35 条补到 109 条，把此前**静默落入「终止整轮」桶**的码
  （如少传一个参数、授权过期）按语义重新定级；并加了守卫测试防止等级被悄悄改动。

## [0.6.10] — 2026-09-28

0.6.9 切点之后的补丁，含 0.6.9 拉取批次多路对抗评审裁出的三条 BLOCKING 修复（#544 / #545 / #546，PR #549）。版本锚齐 **0.6.10**。不叫 0.7.0。

以下 6 条此前写在 Unreleased、已在 main（`ad7f0980` 标签租约、`b5a7396a` 换策略，两者都晚于 v0.6.9 tag），随 0.6.10 归档：

- 标签独占收窄（#526）：多个 worker 一起看网页时，只有正在改页面的那一下才独占标签。读正文、读 HTML、等待元素不再占锁，也可以读别人正在用的页面。刚创建的标签由创建它的 worker 或编排线程独占 60 秒，或直到它自己第一次成功跳转。暂停不再整段占住标签；已经点下去的修改会保持到这一下结束。
- 点不到页面文字时的换策略（`b5a7396a`）：同一工具在**不同**目标上连续失败达阈值时，会提示模型改去读页面、往下滚动或搜索，而不是继续当按钮点；换过办法还在重复同一工具才停。**已知限制（#548）**：反复点**同一句**文字时，站点熔断在同一 locator 累计 2 次失败后、于**第 3 次点击前**拦截（`SITE_OP_BANNED`，`SITE_LOCATOR_FAIL_BAN = 2`），而换策略提示要到第 3 次失败才触发（阈值 3），且 `SITE_OP_BANNED` 不消耗熔断预算 —— 故该提示在「反复点同一句」场景不可达，与最初提交声称的场景不符，另票跟踪。
- 子任务的模型已经停、也没有暂停时，不再占着标签页，侧栏也不再把它们显示成「运行中 N worker」。暂停的子任务仍保留标签。父任务自己还在思考时，状态只写「思考中」。
- 别的子任务正占用某个标签（`HARD_HELD`）时，再去读或打开它只是可恢复的冲突：换一个标签或等对方结束即可，不再把整轮对话停掉。
- 多智能体：模型连接被对端提前掐断（Premature close / Connection error）时，同一请求静默重试，不再每断一次就在对话里刷 ⚠️；连续 5 次才暂停。对端在已经给出结束原因之后掐断连接时，这一轮工具调用仍然执行，不再整轮丢弃。
- collect_handback：worker 停在空的工具回合上时，收回更早写过的助手正文（标明未写完），不再报「没有助手消息」并当成不可恢复错误打断同批其余 worker。只有工具调用、没有任何正文时仍失败，但是可恢复的，不会停掉父任务。多个 worker 抢同一个 Chrome 窗口导致截图打到错误标签页时，worker 可以换标签重试，不再整段停掉。

评审后修复（0.6.9 拉取批次对抗评审，PR #549）：

- 舰队轮询不再误删他人在写的标签锁（#545）：侧栏舰队条每 4 秒的状态刷新此前会把「子任务停了就释放标签」的逻辑跑在这条**读路径**上，且绕过了它自己刚建立的三重保护（在飞的改动 / 60 秒新建持有 / 未决 CDP 调用），于是用户只要开着舰队条就可能释放别的 worker 正在写的锁、并作废 60 秒独占承诺。现改为逐租约尊重这三重保护；当「哪些线程在跑模型」查不出来时**完全跳过释放**（宁可徽标短暂过时，绝不误删写锁）。
- 换策略提示改走可信通道（#544，P0）：该提示此前被塞进「工具返回数据」通道，包在 `<untrusted>` 块里 —— 而系统提示词明令模型**不要**遵循该块内「调用某工具」类指令，于是提示既不可靠，又给提示注入防线开了坏头（示范「untrusted 块里的指令有时可以照做」）。现改为以可信的系统轮次投递；页面与工具内容永远无法冒充这个通道，安全边界收紧。
- Windows 上测试不再静默空转（#546）：测试清单此前拼成单条命令、超出 Windows 命令行长度上限，子进程根本没起来，却因启动错误被吞而表现为「退出码 1 且零输出」—— 看着像测试全挂，实际一个都没跑。现分批执行，并在启动失败时明确打印原因。
- 另：#550（确认弹窗撞上 abort 时的窄时序租约释放）、#548（换策略提示在其声称场景不可达）已开票跟踪，不在本批次修复范围。

## [0.6.9] — 2026-09-23

0.6.8 切点之后的补丁。版本锚齐 **0.6.9**。不叫 0.7.0。

- 租手确认与 Windows 配置（#524）：外部助手的 `[Outbound]` 确认会把确认台拉到前面（侧栏红条仍可批；普通轻确认仍不抢焦点）。首次页面外泄的正文写明调用方、工具，以及允许后只在本次 Companion 进程内免再问。侧栏签发钥匙时，「调用方 caller_id」和「权限」（页面外泄 / 上下文出口）是带标签的输入；`CMSPARK_OUTBOUND_CALLER_ID` 必须与之逐字相同。Windows 文档和复制片段改为展开后的绝对路径，不再让人把 `%LOCALAPPDATA%` 写进 MCP command。L2 确认发给侧栏的工具名与托盘使用同一 `[Outbound]` 前缀。签发命令若印出未展开的 `%LOCALAPPDATA%`，stderr 会提示不要复制。
- 舰队 kick 竞争修复（2026-09-21 拉取三路评审 F1）：排队的 spawn / expert-team kick 撞上用户在同一 worker 线程手动发起的对话时，不再复用对方 AbortController（此前单信号双跑，kick 收尾还会误删用户控制器）；拒装时丢弃本次 kick（brief 已持久化，后续舰队/编排动作可再 kick），排队项在活跃 run 结束后重排队 drain。
- stop/abort 不再复活排队 kick（复审追加，grok+kimi 双路独立命中）：`abortThreadChat` 改为先 cancel 再 release（release 同步 drain 会把本该丢弃的排队 kick 立刻拉起）；`fleet.stop_all` 在逐 worker abort **之前**统一预取消全部目标的排队 kick（否则先 abort 的 worker 释放槽位、同步 drain 拉起还没轮到迭代的 worker 的排队 kick——跨线程复活）；`scheduleWhenLlmSlotAvailable` 槽位有空也先看活跃 run（probe），占线则排队让位，不再丢弃 kick；`fleet.stop_all_result` 逐 worker 披露被取消的排队 kick 数（`cancelled_kick`）。
- collect_handback 在跑盲窗修复（2026-09-21 拉取三路评审 F2）：worker 的 LLM run 在飞或排队（abort map ∪ llm-loop-gate holders ∪ 排队 kick 三源并集）时，轮次间隙不再把前一轮叙述误读成 prose 成功收取——统一 WORKER_STILL_RUNNING（含 board 关闭路径）；谓词抽成 `buildIsThreadLlmActive` 命名导出并逐源单测。

## [0.6.8] — 2026-09-20

操作面切点：工具审计芯、归档诚实、舰队 Glance/Inspect/spawn kick、子任务身份、collect_handback 诚实、对话管理确认与清空回收站。不叫 0.7.0（企业双场景未验收）。#230 仍冻，#228 禁扩默认 outbound。

- **版本锚**：companion / extension / NSIS fallback / ACP / outbound serverInfo / CLI fallback / lockfile / AGENTS.md 齐 **0.6.8**。
- **供应链**：companion `adm-zip` 提到 **0.6.1**（修 GHSA zip 解压跟 symlink / 声明未压缩大小），CI `npm audit --omit=dev --audit-level=high` 过门。
- 检索 / 相关（#517）：spawn 后的主对话（编排父）仍可搜、可进相关；子任务不再当平级相关会话。图谱默认视图不含 worker（手动开 showIsolated 仍可见孤立点）。
- 对话图谱去重：index 里重复 id（Windows 测试把 `tool01` / `Tool result regression` 写进真实数据目录）不再画成一堆同名节点。`thread.list` 按 id 去重；create 同 id 覆盖不追加。
- Windows 测试隔离：`files.test.ts` / `thread-manager-lock.test.ts` 钉 `CMSPARK_DATA_DIR`（只设 HOME 时 `os.homedir()` 仍写真实会话库）。
- Windows 选夹/编程接力（#523）：PowerShell 选夹脚本以 UTF-8 BOM 写临时 `.ps1` 并 `-File` 执行（PS 5.1 无 BOM 按 ANSI 解码，中文提示/路径乱码崩溃）；取消选择走 `exit 3` 显式区分失败，不再显示为错误。
- 多智能体触发面（#513）：提示词新增舰队分派判据（含否定条件，默认倾向单干），任务适合并行时模型可调 fleet_suggest_propose 弹出非阻断建议卡「此任务适合多路并行」；点「派 worker 并行做」仅发送携带子任务清单的分派指令（不激活续跑），spawn 仍逐次 L2 确认；拒绝后 10 分钟静默。summoner 面全程排除。
- 操作面（#502）：对话里已完成的浏览器/工具步骤默认收成可展开审计芯，reload 后不再摊无名卡。归档默认只留工具名、成败与指纹（设置可打开完整操作史；cookie/本机命令仍脱敏；tool 行不删）。单次 100 步触顶改为换段续跑，不再显示「已暂停」墓碑；同工具空转与连续失败仍熔断。舰队 Glance 显示最近工具，Inspect 不抢主对话。编程接力可把 Agent 挂进已有内嵌终端（macOS、默认关），不嵌 Alacritty、不自动开 PTY。
- 对话管理（#516）：整理助手「移入回收站」的确认条钉在面板顶，不再被嵌套滚动裁掉；回收站列出全部已删行（含子任务），并提供「清空回收站」（面板内确认硬删，30 天 TTL 仍是兜底）。
- 子任务身份（#515）：最近对话 / 宽屏导航 / @ 引用默认不把 worker 摊成平级聊天；主任务行「N 子任务」打开已有 Fleet 列表；进入子任务时顶栏「← 主任务」。孤儿、人在子任务里说过话、当前正在看的行仍可见。
- collect_handback：worker 仍在跑 → WORKER_STILL_RUNNING；已写完的 Markdown 研究报告是成功收取（`structured=false` + last_assistant），不再 ⚠️「JSON parse failed / prose-only」；数学公式 `{ }` 不当坏 JSON。结构化 Fact/Intent 仍合并进 MissionBoard。
- 操作面对抗复审第二波（#512 后续）：进行中的工具/L2 卡不再被 mid-turn 旁白折进审计芯；默认归档 reload 文案改为「正文未保存」（安全折叠仍用「出于安全未持久化」）；`spawn_worker` kick 进入 abort map，全停能打断；goal 进 L2 预览与 HMAC；归档开关点击即 `config.set`；未武装触顶不再同时画「回复继续」与「继续做完」；内容风控隔离同步 live mirror；空闲舰队不再被 4s poll 续命 Glance；内嵌终端开关写入 companion allowlist。
- 操作面多路对抗复审修复（#504–#511）：同进程续跑/「继续」不再受归档桩影响，第二段保留第一段工具输出的完整上下文（仅进程内存，磁盘仍只存指纹）；未挂循环的对话触顶 100 步后显示可继续提示，不再静默截断；归档失败步骤同样省略填充值与页面正文，只保留错误原因与少量机器字段；Mode C 内嵌终端启动后状态如实（运行中横幅、启动入口收起、停止语义诚实），启动失败不吞已确认意图；待确认的 L2 工具步骤只影响当前对话当前轮，不再跨线程/跨回合误标已完成步骤。已完成轮次的思考过程折入对应工具审计芯（展开可回看），不再逐轮残留「思考过程」占位行。
- Windows 编程接力「选择工作区」（companion）：原生文件夹对话框加 STA / UTF-8 stdout / TopMost owner，避免藏在 Chrome 后或中文路径 mojibake；绑定比较在 win32 大小写不敏感；取消选择不再显示为失败。
- 召唤器附件 Forbidden（Chrome `--app` / WebView 常带 `Origin: null` 或 CORS 预检无 cookie）：已登录环回请求允许空 Origin，预检不再要会话 cookie，页面用 overlay header 上传并把 403 正文显示出来，不再只显示 `Forbidden`。
- 对话执行状态（#496）：网站上下文探测继续读取当前 Chrome 页面，但不再生成缺少完成回执的聊天工具卡片，修复首轮结束及切换对话后残留“执行中：list_tabs”；正常 Agent 工具调用继续展示执行状态。
- 宽屏侧栏（#497）：资料与工具置顶并默认展开，最近对话支持收起/展开；收起保留新对话与管理入口，恢复保留筛选和当前对话，窄屏继续使用节省空间的导航顺序。
- 双端会议材料闭环（#492）：插件与原生召唤器及时显示原始转写，确认末段与参考笔记保存后生成纪要；支持录音及独立 Word / Markdown / 文本参考笔记导入，保留原始档、校正依据与冲突，材料变化后标记旧纪要待更新。稳定段标识支持失败和丢回执恢复，两份稿不重复；插件保留中止导入。实时分段推理期间仍暂停麦克风，持续采集另见 #494。
- 知识图谱（#490）：修复异步快照到达后画布未绘制及跨 20 篇残留旧未锁 AI 分组；新增可搜索知识列表、节点定位、默认标题、缩放/适应画布与刷新恢复，保留分组和 AI 关联能力。
- Windows 对话管理复审修复（#488）：全选遵循当前筛选，整理建议与列表选择分开；删除和恢复按 50 条分批并等待真实回执，保留失败项，清理空白改为应用内确认并在服务端复核内容。短窗口可滚动访问列表和操作，保留标签、人工/AI 分组、整理及图谱入口。
- 会议关闭（#488）：收起、切换面板和打开设置先等待最后一段转写的相关写入回执及结束确认；失败保留草稿，可显式“保存转写”后重试。工作区统一连接图标，资源抽屉区分全局配置与对话使用范围。

## [0.6.7] — 2026-09-08

S107 六路对抗 + Claude/Kimi dual AWN 关门：活文档与代码锁步，不把 0.7.0 企业双场景验收算进本切点（#230 仍冻，#228 禁扩默认 outbound）。

- **文档诚实**：README / PRODUCT / CLAUDE / GOAL / architecture / 召唤器与听写指南锁 **0.6.7**。Capture 默认 **1040×760**（`OVERLAY_WINDOW_SIZE`），360×420 为紧凑档。知识「全选」改为 TF-IDF top-k（auto 5 / all 8）+ 8000 字预算，不再写灌库。#258–#260 从余项拿掉（embedding 仍 experimental）。GOAL G19 不再把交互式 PTY 当非目标（#432 Darwin-only、默认关、Windows unsupported）。
- **会议 Host「收起」**：录音进行中文案改为「结束并收起」（unmount 仍 `meeting.end`，防 status=recording 卡住）。恢复路径「设置 → 听写」改为「设置 → 输入与语音」。
- **CLI**：`--version` / `-V` / `version` 打印一行并 exit 0；`status` / `stop` 不再撒谎，分别等同 `daemon status` / `daemon stop`。
- **持久化**：assistant `tool_calls[].function.arguments` 落盘前走与 tool-role 同一套 `redactToolPayloadForPersistence`；非法 JSON 不留原文。
- **版本锚**：companion / extension / NSIS fallback / ACP / outbound serverInfo / lockfile 齐 **0.6.7**（extension lockfile 此前仍写 0.6.3）。

以下条目此前写在 Unreleased、已在 main，随 0.6.7 归档（企业双场景仍非 0.7.0 GA）：

- 听写修复（#482）：召唤器遵循所选引擎，展示启动/识别状态并接收实际 HTTP 转写结果；音频块按序上传，切换对话及取消后丢弃旧结果。插件普通本机听写复用渐进预览，停止后保留完整推理等待，不再套用连续会议的短截止时间。
- 代码工作归属修复（#483）：按会话缓存、按对话展示代码运行；后台和迟到事件不打开新对话面板，操作携带所属对话并核对服务端会话，目录选择与 Git 状态回包也按归属隔离。
- 工作空间整理（#481）：召唤器补齐人工标签/手动分组及派生查看方式，使用共享校验和真实保存回执；两端对话优先、辅助入口收纳为“资料与工具”。完成整体 UI/UX 审计和独立项目层级方案；项目实体、原生完整工作台仍未交付。

- 召唤器工作空间首批（#477 / #476）：宽窗口与紧凑切换、文字资源导航、独立历史搜索、可见停止按钮和现有 Chrome 连接入口；MCP 保持只读，完整桌面管理与终端仍在 #476 跟踪。

- 扩展、应用与托盘采用清晰连接图标；托盘去掉重复状态标题，绿实心运行 / 红空心停止 / 黄未知，保留状态详情与可访问说明（#474）。Windows桌面/开始菜单、安装与卸载器同步使用新应用ICO，并在打包时检查图标资产。

- 对话管理入口与分类（#473）：窄栏顶栏常驻“+”，显式对话管理/AI提取/规则整理/图谱入口；新增独立人工标签、应用内手动分组编辑及按 AI 主标签派生的分组视图。匹配服务端确认后才显示保存成功，管理面板让出停止和待确认操作。

- 召唤器与设置重设计（#471）：删除召唤器所有装饰性“山”，统一聊天输入和操作布局；设置改为八类导航页面，保留草稿和深链，明确保存范围，补齐语音取消及许可证弹窗键盘隔离。

- 整体 UI/UX 工作区重设计（#469）：宽屏常驻导航与可读对话列，窄屏非遮罩导航，统一输入区、历史键盘操作、设置分类和上下文布局；终端、确认台、图谱、召唤窗口和独立设置页同步视觉语言。保持现有确认和执行策略。

- 代码审阅开发切片（#465/#466/#467）：从网页观察解析实际 unified diff，锁定仓库和完整 base/head；CMspark 网页评语与可选终端 Agent 报告分别保存，关联真实任务引用和材料版本。终端支持登录 shell、连接归属校验、显式确认回传及幂等回执；不自动执行 Agent。通用网页覆盖与业务关系仍待核实，真实企业双场景验收继续作为发布门槛。

- 升级验收工具（#457）：新增临时数据目录中的新旧源码往返演练与可复跑证据台账；验证旧版钥匙写入保留新字段、证据幂等和未知 schema 拒绝。两版共用当前依赖，不代表真实安装或企业场景验收。

- 企业上下文开发切片（#451/#452）：共享所选站点知识投影，绑定经过浏览器验证的目标；网页正文与导航来源同步采样，保留范围、覆盖和截断信息。
- 企业材料开发切片（#453）：新增 scope 内不可变证据、锁定试点契约、固定草稿核对与引用、revision/幂等回放及 Markdown/JSON 输出；缺失、未核实、冲突和过期不判材料齐备。
- 两个独立 Mission（#454/#455）：变更材料与研发追溯复用既有聊天执行链和工具白名单，不依赖 Codex/shell/CU。真实企业双场景验收仍是 0.7.0 发布前置条件，当前版本未升级。
- 可选 MCP 上下文出口（#456）：独立 `outbound_context_v1` 档案按精确 origin、所选知识和具体 grant/session 导出上下文；页面许可保持独立，异步返回前复核撤销与文档版本，失效会话不自动重试操作。提供设置/CLI 入口，default/interact 工具集合保持原有范围；会话拒绝与失效原因留审计，不记录会话句柄或 token。

## [0.6.6] — 2026-09-07

- **Qwen3-VL 坐标系修复（#423，多路对抗：grok 实证 / pi 官方考证 / claude spec + 复审收敛）**：评测门 0/10 全 MISS 的归因修复——L-QW-3「clamp-only」裁决的前提（模型输出绝对像素）被证伪：官方 cookbook + 本机 9 探针实证 Qwen3-VL **恒输出原图相对坐标 [0,1000]**（always-map mean err 11.9px vs 绝对像素假设 364px）。修复：`_normalize`/`normalizeQwenVlPoint` 恒映射 `v/1000·W·H` 后 clamp（clamp 降为 >1000/负值安全网）；解析层新增真 JSON 解码阶段，数组形态 `{"x":[x,y],"y":[y]}` 按裁决取 `(x[0], x[1])`（d9 反例钉死 y 冗余拷贝不可靠）。Python worker 与 TS（`gui-action-parse`/`qwen-vl-coords`）双端 lockstep，评测门 **0/10 → 6/10**；余 4 例 MISS 为 2B 模型感知误差（看错控件），非解析/坐标问题——#363 摘帽门（需 ≥0.85）仍未过，后续选项（few-shot prompt / bbox 输出 / 4B+ 变体）另议。决策留痕：`docs/decisions/ui-tars-absorption-multipath-2026-08-08.md` L-QW-3 修订注记。[#423](https://github.com/nehcuh/cmspark/issues/423)

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
