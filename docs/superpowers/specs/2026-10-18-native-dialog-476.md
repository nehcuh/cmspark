# #476 原生对话首组合同

状态：root已真正非作者批准实施（APPROVE_FOR_IMPLEMENTATION_ONLY，原批准原件位于作者packet）；本组已实现，等待whole非作者、模型及真实hosted原生门禁，作者不得自批。Issue-first 是原 #476，body2/5/9/13 已要求独立桌面对话、新建/切换、Stop和重开，不新建计数票。固定公开基线 main820464d62b68f5b53deb09ae219c4f480aa63c1f/treef69e9bd51aaf7384dcf5baced93511877cbfa4d2。遵守当前DESIGN.md，复用现四类导航、同一native主窗口/compact/workspace与反馈样式，不重写品牌、全§5或管理路线图。metadata与stdio MCP首组已交，不重做。

## 一个可用结果

native新建空对话或选已有对话→输入纯文本并显式发送→同一canonical对话接收累计输出→Stop该次真实运行→重开读取同一持久历史。新建/选择本身不启动模型、mic、工具、Agent、Chrome，也不改变配置。仅Send进入原模型/线程/技能/工具策略。此组不含附件、模型/技能切换、队列/steer/regenerate、归档/搜索、PTY/ACP操作或Chrome策略；这些不被本组假称完成。无外部Agent不阻止普通对话，也不新要求安装Agent。

## 真实基础与新增差额

main820 capabilities.ts:4–12只有六读、MCP edit/save、metadata edit/save及controller-only decision。channel.ts:23–83没有聊天入口。新权限须由launcher撤销/重铸method-set v3→v4，两个host与bootstrap固定版本同步；auth protocol1/HMAC域/anonymous bootstrap/registry、旧overlay/extension/tray ACL不变，旧capability不能在线升级。以下是**拟新增native DTO，不是现存API**。

| renderer→native→Companion精确方法 | Companion仅有键 | 实际canonical基础及成功投影 |
|---|---|---|
| desktop.thread.create | type,id | ThreadManager.create("",undefined)生成ID，不接收用户指定ID/alias/config；实际完成后返回同id、ok/created、thread_id/title。 |
| desktop.thread.open | type,id,thread_id | 同ThreadManager真实历史及thread存在/未trash检查，返回同id/target、ok、safe messages、running/owned_run_id或null；选择只读，不触发chat。 |
| desktop.chat.send | type,id,thread_id,message | 用户非空纯文本原样进入canonical文本chat.create链；返回/事件见下节。不得擅自trim后改写正文。 |
| desktop.chat.stop | type,id,thread_id,run_id | run_id仅指本连接此前send的native请求UUID；校验捕获的真实run/controller/generation后才走原abort清理，不能裸转发任意thread的chat.abort。 |

renderer层另有既有generation；native验证同源/主frame/文档后移除它，用已存在UUID重写id。Stop的renderer run_id必须由native存活send记录翻译成原native UUID，禁止任意字符串代入。stream多帧不能沿用“第一个reply就erase request”的当前一次应答实现；须保留一个真实send关联到终态。双端exact keys/类型、duplicate与escaped duplicate/prototype、非法thread ID均拒；id沿用现metadata非空及200限制，thread ID复用isSafeThreadId。禁config_override、llm_override、skill_ids、context_refs、rawargs、role/surface、user_gesture、enqueue、权限/lease-holder/执行策略输入。四个方法不是generic forward。

服务只得到真实registry principal、socket及当前性闭包。既有router SessionCallbacks.surface仅panel/tray/summoner，lifecycle当前desktop只注入read/MCP服务；**尚无可假借的native聊天session**。实现需有限可信server桥接，把真正desktop身份明确带入canonical actor/policy判定，不注册成legacytray、不给unknown-surface默认许可、不把renderer JSON当内部stamp。复用canonical非overlay的composer类别不等于冒充panel/tray认证；原overlay持有lease时仍拒发、不自动抢占或release它。若当前actor分支不能明确承载native，须向root报具体源码差额，不用fallback绕过。

## 运行归属、双发与Stop

router.ts:1293–1314在await前安装controller/llmLoopGeneration，并有run_active与panel owner；当前chat.token只有thread_id+累计content，没有run_id。仅用选中thread、广播消息或本地计数不能证明归属。拟加私有窄hook/handle：在原同步claim点捕获实际controller+generation与发起native UUID；origin的sendToExtension闭包属于这次canonical调用。新wire run关联复用该UUID，只作correlation，不新授权token或全局generation系统。内部Stop必须在无await的检查/abort区确认map仍指捕获controller/generation；旧run不得杀继任或他人run。原chat.abort清队列、pending/worker/PTY等既有语义通过同原清理链保留，不另造cancel实现。

首组native单composer只保一个存活send记录；A运行时可新建/选择B只读，但不能再启动第二个native send，状态栏保留可键盘操作的“停止A”。这是本组有限UI/bridge状态约束，待root批准，**不修改canonical其它客户端并发预算**。两个快速Send/同请求重入必须在同步admission前拒第二次，不能等模型await后才设busy。可复用adapter既有clientMessageId回显和reservedUserMessageId私有入口绑定原native UUID；后者当前router纯文本路径未透传，属于所需有限差额。若用它做持久防双发，须对实际保留的canonical消息ID+原文本核同，并先查重，不能指望insertMessageAt自身去重；不声称跨历史裁剪/daemon重启的永久exactly-once。

用户点击New时只允许一个in-flight create，原native请求UUID在本连接当前operation中单次消费，已知重复返回同结果/拒绝，不能再建一次。丢ACK后New/Send都不自动重试或重新mint请求救援；先列出/重开核对，再由用户明确新动作。没有新持久去重库或全局事务框架。

## 流与持久化诚实语义

所有native事件外层至少绑定type/id/thread_id/run_id与有限kind；send id/run_id由server固定，不从后续selectedThread决定。只接受该origin callback实际产出的白名单：chat.user、chat.token、chat.assistant、chat.done、chat.aborted、chat.error，必要tool状态仅固定种类/安全显示名/状态。chat.token是**累计快照替换**而非delta追加。历史/输出只用惰性textContent或既有安全文本呈现，redactor处理完整累计快照，不能按截断碎片漏过跨chunk秘密；不下发reasoning_content、tool_calls/args、工具原始输出、检索原对象、配置/凭据、内部错误/路径或raw session。未知event忽略且不算完成。

adapter.ts:735–752在实际addMessage返回后才发chat.user（含持久message_id和可选client_message_id）；done通常有assistant message_id，但round_limit的done没有新消息ID。UI须区分：已接收/运行中、用户消息已持久化、assistant已持久化、停止请求已接收、运行已终结、错误/结果未知，不能将token、accepted、Stop ACK、process exit或任意done都叫“回答已成功完成”。只有实际canonical写后出口才能给persisted状态；未带message_id的终态不得发明持久回答。原run_stats终值/length截断提示保留。

ThreadManager.create先写index再messages；addMessage先写messages再index，不是跨文件事务。异常可能已有部分持久副作用；保留草稿、反馈UNKNOWN并重新读取，不能承诺失败必回滚。现getMessages把read/parse错误折为[]，不足以证明空历史：拟增加同manager的有限严格读取/投影入口区分错误，旧caller语义不变，不建第二store。历史DTO只含canonical消息id、user/assistant角色、安全文本与created_at，tool/system行用明确隐藏占位或安全计数；与同一原消息顺序/ID对应。输入/输出沿现WS 10MiB界限、store1000消息保留规则；超出可用帧返回明确过大/未完整，不静默当空或全量。SUMMONER_PEEK_MAX_CHARS=2000仅旧preview，不能冒聊天输入或全文上限；本合同不新加聊天timeout/条数/自动重试预算。

A→B→A、open请求乱序和doc替换需同时核target、请求UUID、既有native generation/socket epoch、renderer本地selection epoch及当前run绑定。切走A不改A归属、不偷焦点、不自动停；重新打开A只有在fresh open明确返回同一仍owned run时才重新绑定其后续事件，否则仅显示存盘历史/未知运行状态。旧A响应不得污染新A草稿，B事件不写A。断线/host退出/revoke先退休live映射、拒pending，再中止本owner捕获run和关闭确认；每个await后及实际启动前复验。新principal重连不能Stop/接续旧handle或自动重发；重开读盘，已落盘但丢ACK就是UNKNOWN，不伪造后端ACK。

## 原工具策略与明确限制

Send可能触发现线程既有模型、auto技能/知识和工具行为，不称纯UI/无副作用；不自动更改模型/provider/default/liveconfig、工具白名单或trust。复用真实createToolExecutor及其policy/HITL/AbortSignal与originWs，但需真实desktop current-session绑定；不把新WS仅传入就当已认证。

现两个native begin_confirmation只支持MCP save add/update/server，**本组不扩通用tool确认adapter**。遇需确认而该native桥不支持的L2动作，必须在原manager链failclosed拒绝/取消并给固定准确反馈，tool effect0；禁止用MCP窗口、privilegedtray.respond、延长原45s或自动批准。原有无需确认的允许路径按原策略执行，原策略拒绝仍拒绝。Stop/断线使原origin的pending取消，不消耗别人的confirmation。此限制使整476确认组合仍partial，UI不能宣称所有工具已可批准。

## 本组门与非目标

先actual canonical producer/store/event/DOM红→绿与两个thread/两个run负控，真实非作者、focused host+freshlockedARM；原票要求official Grok4.6-build和directDeepSeekV4Pro独立完整意见，另保留Kimi/现配置GLM、真实输入/identity/EOF/自然exit及精确head/main CI。最终Hosted Win/Mac实际native键盘New/select/Send/累计输出/Stop/重开、断线和既有policy/HITL拒绝必须有原生receipt。受控provider/工具seam仅验证真实产品链，不冒真人批准/真实模型业务成功；不要求本机原生或额外真人前置。整个#476保持OPEN，技能/知识管理、终端/Agent、Chrome及其余原AC不因本叶假完成。
