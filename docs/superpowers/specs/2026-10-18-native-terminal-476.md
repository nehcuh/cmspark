# #476 桌面本地终端 / 编程接力：最小合同候选 R1

状态：CONTRACT_CANDIDATE_ONLY。原 #476 DoD4 + `2026-09-08-desktop-workbench.md` §5；不得在 两位真正互盲非作者 reviewer 正式批准前编码。本轮不创建新 Issue、不改变旧 panel、普通 tools 或 workspace工具行为。

## 1. 交付及排除

当前 native workbench 线程可显式启动一个真实交互用户 PTY，也可选一个现有可用后台 Agent 执行接力；两者独立，操作和结果绑定启动时 canonical thread。交互终端需真实输入/输出/resize/Stop，不用日志框冒充。Agent 的真实 handback 通过原持久化出口进入原线程；终端内容只有用户明确选定的摘录或原结构化 review 报告可回写。

不增加安装 Agent、rediscover/config adoption、任意 exe/argv/env/cwd、PTY exec替代、shell配置、diff apply、自动读写运行、Chrome forwarding、全局 Agent permission gate、raw TTY历史或外部终端 Mode C 自动启动。不开默认 module，不把 readonly profile 当 OS 沙箱。不宣称此组闭合整票476。

任务起始基线 main ee05 同公开 tree65a5，v6/read7/renderer19/native20。落稿时parent报告workspace34 v7/read10/renderer24/native25已双审+ARM采纳并commit889108b0正在push，OS未验，不冒main已合。本合同在最终获批 workspace 字节上机械组合，拟下一 method-set v8/read11/renderer35/native36，**实施冻结时必须从真实数组展开计数验证**；若基线变动按真实版本更新，不能硬套旧计数。

## 2. 私有 owner / 状态

每 authenticated native WS 的 actor 仅持有它真实当前 host/document 与 canonical thread；renderer 的 ID 不是授权。延续现200字节 frame-id语法、safeThreadId、flat JSON strict exactkeys、既有帧预算。所有 `id` 作为请求关联；`operation_id` 为该 owner 的原启动请求ID，不接受 legacy ACP/session/PID，也不跨连接恢复控制权。

`desktop.local.state` 先退休该 actor 待确认操作和未用启动快照，再 canonical验证；线程删除/module off/FS异常也不能保旧确认。显式 root 存在且 module允许时生成 fresh64hex `revision`；disabled/unavailable/unbound 状态 revision=null，不创建默认目录。不因只读按钮启 module、启动shell、读正文或安装/执行agent。目录路径/dev/ino等只在 server私有 snapshot；correlator不是grant，不保证跨调用inode永不复用。

启动快照含 canonical thread身份/updated_at、显式root身份、module/policy、当前 owner/doc；启动前/确认后/真正 spawn 前同步复核，变化/unknown拒绝。实际 thread busy 判定复用现 project活动 helper；同线程已运行或未知时不启动第二工作，原系统PTY live+closing / ACP并发1不扩。proposal已登记自身offered后只允许该actor捕获的同一proposal继续，不能将自己的状态误作外部busy或忽略别的活动。运行中每次有副作用control仍核canonical存在、原root/owner/policy；普通消息更新updated_at本身不冒root变化或自动kill。所有 wait/acquire/release 复用60s admission、run1/process2、45s native确认；不拿 held admission 等二次嵌套 permission造成死锁。

## 3. 精确 native wire（11个新方法）

所有方法共有 `{type,id,thread_id}`，未知/嵌套/额外字段拒绝。表列出**仅额外字段**；没有列出的字段不可输入。所有字符串最终 UTF8 JSON 总长还须 <=既有maxPayload，不能只按字符数放行。

| 方法 | 额外字段 / 约束 |
|---|---|
| `desktop.local.state` | 无；read-method。返回 modules/platform/可用agent安全标签、绑定状态、fresh revision、当前owner操作的有限状态。 |
| `desktop.terminal.open` | `revision` exact64hex；cols integer1..500/rows1..200；没有cwd/file/argv。固定实际默认用户shell、已批准显式root。 |
| `desktop.terminal.input` | `operation_id,seq,b64`；seq正safeinteger且严格递增，仅此新native协议；canonical base64，解码单帧<=16KiB（取现输出chunk数值作为新native更紧输入界限；旧panel输入不变），UTF8按现用户PTY输入语义。 |
| `desktop.terminal.resize` | `operation_id,cols,rows`，同尺寸界限。 |
| `desktop.terminal.ack` | `operation_id,seq`，正safeinteger，不得超过已发送seq；旧ACK只可幂等忽略，不可释放别的owner缓冲。 |
| `desktop.terminal.ping` | `operation_id`；只刷新真实当前会话。 |
| `desktop.terminal.close` | `operation_id`；也可取消本owner尚未 spawn 的open。 |
| `desktop.terminal.return` | `operation_id,text`，非空，<=现默认handback48000个UTF16代码单元且帧内；明确“用户选择的终端摘录”，需当前可信native确认，不根据terminal stdout假认verifiedresult。原review报告路径保留，不能转成自由 report身份。 |
| `desktop.agent.start` | `revision,agent_id,goal`；agent_id须精确在server当前available列表且长度不超过既有可表示帧，不由renderer给命令；goal非空<=现8000个UTF16代码单元；本叶固定`review_readonly`，云披露+执行确认由controller真实显示并确认，不由payload自称已接受。 |
| `desktop.agent.prompt` | `operation_id,text` 非空<=8000个UTF16代码单元；live协议输入仍对确切prompt做native确认；CLI/已关闭followup成为新runtime会话，重新确认并更换私有映射，不冒同进程继续。 |
| `desktop.agent.cancel` | `operation_id`；仅此owner session，取消待确认与startup也生效。 |

Agent初始只接现review_readonly；propose_diff/写回patch为原运行时能力保留而非此叶暗中grant。选Agent不会隐式开启第二PTY或外部终端：私有proposal必须显式`openLocalTerminal:false`（内部类型/定值，不是renderer字段）；原legacy默认snapshot与thread-global embed intents原义不变。

## 4. 真实确认与 runtime 边界

复用 `SecurityConfirmationManager`；新增固定purpose `local-work`、固定kind `terminal-open / terminal-return / agent-start / agent-prompt / agent-permission`，frame/target/doc/epoch、exact payload、一次decision和超时按现resource/workspace惯例。两个实际 C++/Swift controller、bootstrap及真实fixture同步；renderer不得产生decision或借chat工具确认。

可信界面显示 thread安全标题、动作、server真实shell或Agent标签、server私有显式root供人核对、完整goal/prompt/摘录及现云披露；绝不把root或可执行路径塞回WebView。若完整exact内容不能在既有 native/frame预算显示，拒绝；不批准一个截断后不同的payload。shell一次L2后输入是该用户交互会话，不要求每键一次L2；失owner立刻停止接收输入。

PTY复用spawn/session/native加载/env/ownedtreekill；增加窄受信任入口，而不是扩旧panel handler允许desktop。PTY新入口不消费legacyembedintent，不复制桥、不扩全局slot，closing未回收不能当空闲；natural exit不kill可能复用的PID。其起始root containment不是运行时文件沙箱，确认需诚实说明用户shell可cd/执行，用户Agent环境故意保留，Companion特定凭据仍按旧envbuilder剥离。

ACP复用propose/start/protocol/CLI fallback/owned cancellation。新增仅内部 per-session permission callback与owner-current/abort出口；native session缺callback、owner失效、无法完整确认均deny，不能回落到旧全局permissionGate。原legacy调用不变；无新通用tool/grant。请求permission在原开始admission释放后另取同既有admission，拒绝/超时不得允许，不能仅凭agent自由detail字符串生成权限flag。

真实 resolved Agent命令/配置、目录与policy必须绑定server snapshot；确认后resolve若变拒绝，不能同label换exe。asyncWindows owned-job准备期间也复核owner/abort；既有启动30s/会话15min/closekill流程沿实际配置，不能另加retry/warmup或提高预算。

## 5. 输出、归属、持久化及晚到

PTY只对原owner发送 `{type:'desktop.terminal.data',thread_id,operation_id,seq,b64}`，单chunk16KiB、high64/low16/max256KiB及45s heartbeat复用；当前页面内存显示，既有scrollback5000，不记raw按键/TTY日志/证据包，不广播其他线程、extension或nativewindow。UI明确这是用户shell输出，不是可信assistant说明；不可把输出自动作为tool指令。不承诺对交互raw屏幕内容做完整secret剥除；其保密边界是原owner的真实终端会话。

其余DTO白名单，text先复用native safe redaction/bounds，禁wholeACPsession、pid、agent_session_id、command_line、env、pendingdiff正文、工作目录路径和任意error.message。ACP progress只是进度，非saved receipt；采用closed state/kind/partial与安全截尾tail，不forward旧broadcast整帧。目录/命令身份用于原生可信确认，不流入WebView。

ACP唯一handback sink仍先真实 `ThreadManager.addMessage`，成功后才发native完成receipt：`operation_id,thread_id,message_id,status:'saved',partial`；失败/关闭前落盘未确定为`unknown/not_saved`，不凭exit0说saved。observer只在原commit后订阅，不再调用addMessage；通知丢失由canonical消息重载恢复。新native operation的commit须固定幂等message identity，防sink重复/重放；不能把旧全局sink替换为只服务本owner。现addMessage不会按ID去重、messages/index不是跨文件事务；新窄commit闭包必须先严格读取/核原ID和内容，部分写异常保持UNKNOWN，不自动重试，不声称跨daemon重启/1000条裁剪永久exactly-once。

terminal.return每原owner/operation只允许一次成功回写，稳定幂等messageID，exacttext redaction后原生确认，真实canonical持久化成功才saved；重复同text返原receipt、改text或换owner拒绝。未完成PTY也可用户显式回写部分，必须标“用户摘录/partial”，不由exit推导验证。原结构化CodeReviewService schema/acceptance/receipt与幂等链保留，不能将任意摘录伪装其正式review。

切换thread/页先退休未用启动snapshot与pending确认，不把A运行归属改为B。已运行A可继续，UI保留明确“停止A”，B不可输入A；重开A只有fresh state核同owner同operation才重新显示其流。旧A事件不写B或新A草稿，原operation的Stop仍固定A。document退休/断开/host撤权则先发cancel/close本actor仍pending操作，再退休映射；server同步退休snapshot/确认，ownedPTY关闭、ownedACP取消，不能kill其他owner会话。已线性化spawn/commit不能声称撤回：返回unknown，原thread历史仍唯一durable来源；late事件/ACK/permission/receipt不得投新document或新线程。重连只恢复canonical已保存消息，不把私有runtimeID重新授权；daemon重启旧operation全失效。

## 6. 必须有的实证与完成条件

1. 实际旧HMAC/channel拒新增方法与真实PTY desktop拒绝 RED；新真实HMAC→actor→现runtime inert seam→manager→DOM纵向，不用Map冒runtime。所有shell/agent effects均guard，至少验证输入/resize/ACK/close真实方法调用。
2. 所有strict键/数值/base64/UTF8/上限、moduleoff、noagent、不显式root、worker/readonly、busy/unknown、wrongthread/owner/replayedseq、deletedtarget、samepathroot替换、OCC、确认丢失、cancel/startup/close/live/exit、lostACK、save failure和reconnect晚到负控；secret marker不进safeDTO/消息/log，rawTTY仅原owner显示。
3. 原PTY与ACP/CodeReview回归不弱化；特别legacy ModeC仍原义、新native仅一个后台进程、ACPpermission不能借legacy全局gate；真实durable消息只写一次且归原thread。模板/launcher/methodtable全部消费者exact同步，固定本地资产不得网络加载。
4. 唯一affected lockedARM验证TS/Node与真实ownedFS/child stubs；此非native通过。两独立有效合同/source review，作者/协作者不能自批。
5. hosted Win+Mac：真实native确认→真实PTY子进程echo/Unicode输入+resize+Stop/退出→输出原owner、兄弟owner0收到；真实当前thread历史重开显示确认摘录；实际ownedAgent进程走现协议或CLI完整handback→saved真实重载；拒permission/断开/退出/absentagent继续内建chat。使用受控owned CLI不声称外部厂商账户已验。测试原native45s生命期、runtime原budget不扩；失败保完整public阶段，不能用source绿代替。

两平台门槛未过不称该叶交付；此叶过后也仅#476 DoD4的终端/接力部分，剩余原票scope逐项保留。

## 实施基线 T0

当前 owned 实施从精确889108b0802a7fc04f026b7e370d3b888fd5c3b2/tree9d577171afec6b38b98080bd400f9f8510ef147c开始。workspace34已受审但PR705 nativeRED，不称已交付或main通过。上文起始快照为合同历史，冻结时重数实际方法表。state只读既有有限discovery utility可调用固定which/where；不运行shell/Agent、不安装/写配置，不能声称其为0OS进程。


<!-- Approved narrow fixed-asset compatibility correction, 2026-10-18. -->
固定 xterm 6.0.0/addon-fit 0.11.0 使用原 extension 已锁版本/完整性，原生包离线复制，不安装或改变模块默认值。实际源码证明 Document override 不能覆盖全部动态 style 创建；仅对已锁原 bundle SHA/版本和恰四个 style 工厂表达式进行可逆拷贝变换，原 receiver/调用次数/返回 element 不变，只设置该 HTML 文档随机 style nonce；全局 document 不改。原 vendor LICENSE 随固定资产保留。两 host 对每次允许的固定主文档导航生成随机 64hex，仅在原固定 HTML 的 CSP/meta 两个唯一占位进行内存替换，坏占位拒绝。只增加 style-src-elem 的该 nonce，原 script/connect/导航/来源限制不扩大；不是身份、grant 或业务消息字段，不持久化或输出。相同 HTML 内的 WS 重连只换原业务 generation，不伪称重载/换 CSP；真正显示仍须 hosted Windows/macOS 验收。
