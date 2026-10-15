# 有界可见控件 snapshot / 编号 click、type — 第一刀合同

GitHub: #521  
状态：R1 合同已获 root 非作者 APPROVE_FOR_IMPLEMENTATION（02e4846b…）；本 R2 资源生命周期修订为 CONTRACT_INCREMENT_CANDIDATE，尚未获实现批准。既有源码仅作者检查点，未获源码门禁；实现必须另 PR。  
公开源基准：caca05177efee40ad0ca76ad9cef57251d3f930b。能力：T2 / L1 CDP / Compose none / 单一现有 tool-loop / community。

## 1. 本票与旧 W2 的关系

#521 已存在且正文明确重开 W2，满足 Issue-first。2026-08-21 网页操作环 SoT §3、§11 的「禁止本波」约束旧 W1 波，不是永久禁止编号观察。只解除本票第一刀的波次排除；W1 text 优先、歧义拒绝、预算与 L2、ADR-017、ADR-022/#228、iframe/shadow 非目标均继续有效。旧方向报告不是新实现的审批。

唯一 GO：现有扩展采集短编号表，主模型在同一局部网页操作环以编号调用 click/type。保留 text/selector，禁止把观察表当任意 evaluate、授权或永久定位器。没有新决策模型、Pack、MCP profile、浏览器实例或第二扩展。

## 2. 外部调用合同

新增本地 Chat 观察工具 `get_interactive_snapshot({tabId})`。tabId 为明确正安全整数，拒绝省略、字符串、非有限数、小数和 active-tab fallback；不接收 code、selector、goal、timeout、budget、URL、owner 或 token 参数。schema 对该新工具严格拒绝未知字段。

click/type 新增成对 `snapshot_id`（UUID）和 `element_id`（1..64整数）。任何一个字段出现但配对缺失/空/非法均拒绝，不能被 zod 剥除后退回旧焦点输入。编号模式不能同时给 text、selector 或 exact（包括显式 false）。type 仍有必填 value；编号 value 另限16KiB UTF-8，旧 type 长度合同不变。合法编号不是授权。

不含两个新字段的旧请求逐字保留 W1 组合 C：非空 text 独占；否则 CSS；旧 CSS first-match 不升级；旧 type 无 locator 可走焦点；旧 dblclick/fill_form/download/hover/select_option 不接编号。新模式失败不能自动转旧模式，模型可以在收到明确拒绝后重新选择独立的旧调用，所有既有门仍适用。

观察成功的 data 精确字段：snapshot_id、expires_in_ms（<=30000）、complete:boolean、rows 数组、table 字符串。每 row 为 `{id, role, label, state, can_click, can_type, ambiguous}`，不含 CSS、坐标、URL、nodeId、owner、grant、输入值、HTML、属性全集。role 固定枚举 button/link/textbox/combobox/checkbox/radio/menuitem/tab/option/summary；state 固定 empty/filled/unchecked/checked/disabled/readonly/ready。table 是 rows 的确定性短文本投影，label 以 JSON 字面量显示，仍是非可信页面内容。以下仅合同示例，**不是生产录制 fixture**：

```text
[3] combobox "目的地" · empty
```

click 成功只返回 `{clicked:true, locator_kind:"snapshot"}`；type 成功 `{typed:true, locator_kind:"snapshot", chars:<value码点数>}`。不回显写入值、label、URL 或内部句柄。只能在固定执行函数报告完成后 success:true；CDP timeout/迟到响应仍依现有 UNKNOWN/timeout 处理，不能把发出命令等同已执行。

## 3. 有界采集及泄露边界

仅当前明确 tab 的 HTTP(S) 顶层 HTML/XHTML文档。禁止 file、privileged、PDF插件/非HTML、frame/shadow 穿透；文档不能证明时拒绝而非猜 URL 后缀。旧 locator 的 file 等行为不改。采集在扩展专属 isolated world，用固定函数，无模型 JS、MAIN world fallback、页面 DOM marker、页面共享属性或自定义回调参数。不 focus/click/scroll/导航，不触发 input/change，不读取 Cookie、截图或外链。

固定候选上限：遍历5000个顶层 DOM节点、最多64 rows、扫描循环100ms合作式截止；每 label 最多64 Unicode码点且128 UTF-8字节；扩展输出完整 ToolResult JSON的 UTF-8字节（含 rows、table、结构与转义，不含既有WS包壳/上游untrusted wrapper）最多24KiB。调用方不能调高。浏览器布局/协议执行不能被合作式时钟硬抢占；现有15s转发截止仍有效，不声称100ms/300ms实际SLA。超节点/时间/字节时 complete=false；若字节超限则从尾部移除rows并重建table直至完整序列化结果<=24KiB，最小空rows固定结构也必须满足；不能先slice JSON破坏结构或只测label原始字节。已有 rows仍可观察，但整个 snapshot 不能按编号执行（SNAPSHOT_INCOMPLETE），防止被截掉的同名控件造成 first-match。

可见：元素 connected，属于 captured document，非 display:none/visibility:hidden/opacity:0/inert，viewport内有正面积交集。采集 role 与状态，保留可见但 disabled/readonly项作为观察；不能执行它们。can_click/can_type还需采集时无遮挡检查，动作前仍重查。标签只取有界 aria-label、placeholder或可见自身/关联label文本，复用一个固定有界文本遍历预算，不读 full innerText/textContent/outerHTML全树，不 marshal完整DOM。label归一化 trim+折叠空白，大小写敏感；截短后碰撞也保守歧义。表格不读 input.value内容，只可读是否空/checked布尔状态。

排除 hidden/password/file、autocomplete含 one-time-code/current-password/new-password/username/cc-* 的敏感输入。除这些明确排除外，不能声称通用PII识别；可见label仍可能含业务数据，按现有页面读结果 untrusted wrapper进入本地对话。运行日志只固定码/计数/工具名，不能含 label/table/value/URL/query/内部scope；不新增知识/经验/截图持久化。普通对话记录沿现有策略，不声称完全不落对话历史。

编号 click v1 支持原生 button、HTTP(S)/同文档anchor、checkbox/radio、summary；受支持输入类在最终验证后执行固定原生focus再原生click（两者无await间隙），不是仅focus却报告clicked。纯ARIA自定义菜单/tab/option/combobox可观察，若非上述原生控件则 can_click=false。不得对 arbitrary HTMLElement.click假称打开了自定义控件。编号 type 支持原生 INPUT(text/search/email/url/tel)与TEXTAREA，且非敏感/disabled/readonly；非原生 contenteditable、select、custom textbox can_type=false。unsupported在任何动作前返回 SNAPSHOT_UNSUPPORTED_CONTROL。旧内容编辑器路径不变，知乎非SLA目标。

编号 type 的明确语义为**替换该输入控件的完整值**（原生prototype setter），随后固定 input/change事件；不是现有 Input.insertText追加路径。无需先focus，避免值检查后另一个异步焦点阶段。编号 click 采用 isolated realm 原生prototype的 click/focus，对最终验证的同一个对象操作；不伪造 userGesture，不开权限API或点击覆盖层。既有 text/CSS 的 CDP鼠标/insertText/fallback路径保持不变。页面正常事件可在合法动作后引起页面效果，不能承诺回滚。

## 4. owner、ID与缓存

只有 router `bindChatEvidenceScope`绑定、server二次校验线程仍存在的本地Chat执行上下文可用；非 trustedOutbound、非 enterprisePermit。不得信模型/HTTP params.__thread_id、URL/domain提示或传入 scope。server内部以该 executor的随机sessionId与验证threadId派生 SHA256 opaque scope_id，形成 `{scope_id, thread_id}` 放在 authenticated `tool.execute` **顶层内部 locator_scope**（不在params、不进catalog）；thread_id仅来自经校验的router scope，用于收到既有生命周期消息时释放对应记录，扩展从该实际WS入口第三参数获取。此标识不是grant/密钥；任何既有认证/pregate/执行policy拒绝仍先拒绝。未绑定真正scope则 SNAPSHOT_SCOPE_REQUIRED。扩展runtime消息不能提供该第三参数。

缓存 key 为 scope_id+tab，snapshot_id为扩展生成的新UUID；ID只在一个snapshot内1..N，不写DOM。记录 capture后的顶层 frame/loader/document backend identity、isolated context identity、完整精确URL的内部hash、64个以内 backendNodeId、裁切描述/状态/布局及有界表签名。内部不保存完整URL/query、value、页正文。opaque scope和backend IDs不能出结果。

固定**8 global total slots**，统一计算当前 SW 的 preparing/capturing/ready/inflight/retiring 与从旧 SW 继承的 quarantine claims，**不是两套各8个**。最多512个当前节点描述；同owner/tab至多一份当前snapshot。TTL绝对30000ms，不因任何存储await/读取/重试延长；TTL只使ID失效，不使未settle或quarantine资源腾出名额。容量满拒新 SNAPSHOT_CAPACITY，不能驱逐别人live/inflight或旧quarantine claim。snapshot ID、描述和owner缓存仅当前SW内存；重启/重连后旧ID不恢复。

每次编号动作在tab队列内同步验证owner/UUID/TTL后 reserve并消耗这个snapshot，单次尝试后必须新读；不自动retry未知效果。临时remote object group仅用于本次采集/执行；正常同SW须等待所有本组命令settled并在finally取得release ACK。ready cache只保存backend标识而不保持JS remote stronghandles，但其global claim仍占原slot。下列4.1–4.3是本次R2唯一新增资源合同，取代“SW内Map消失即资源消失”的隐含前提；不修改上文ID和授权合同。

### 4.1 有界、非敏感的 browser-session cleanup ledger

采用唯一常量key `cmspark.numberedSnapshot.cleanup.v1`，仅使用现有权限下的 `chrome.storage.session`，不调整其访问级别，不使用local/sync/文件。key的值为**至多8项数组**，每项精确 `{slot, tabId, group}`：slot为0..7唯一整数，tabId为正安全整数，group必须逐字等于 `cmspark-numbered-controls-v1-slot-<slot>`。不接任意group名、URL、owner/thread/scope、snapshot UUID、document/node/context ID、label、value、token或grant；不写model、知识、对话、日志或runtime响应。版本在固定key内，不接受模型提供的key/version/limits。没有清ledger的UI/工具/配置开关。

单个SW内由唯一模块级allocator/barrier统一ledger与当前cache占位，不能每个BrowserBridge/controller实例另建一套；初始读取完成且严格shape验证前不得分配任何remote object；不能只给每tab各8个。读失败、API不可用、非数组/额外字段/重复slot/错group/非法tab/超过8项均固定拒绝 SNAPSHOT_FAILED，不能把坏数据当空Map、覆盖/迁移或fallback到其它storage。该失败只拒绝新观察/编号动作，不能以初始化的未处理rejection或全局gate阻断既有text/CSS工具。任何write/remove失败或结果不确定时，本SW禁止后续新分配并保留已占名额；不能用内存回滚假定磁盘侧没有写入。

每次新观察在同tab排队前先同步预留本地current-owner/有效性占位，统一allocator最多8slot；远程分配前须将对应claim记入browser-session并等待write ACK。取消/owner失效在任一await后复核，ACK也不是授权。write未ACK时**零remote-object分配**。本地pending/已写claim是同一个slot，不能因异步prepare/并发调用双算或漏算。每个global slot只有一个固定group，collect和后续一次act复用该slot/group且前次已release，不以随机UUID生成跨崩溃不可寻址组。

### 4.2 正常同SW生命周期与retire

| 状态/事件 | ID与资源 | global名额与session写入 |
| --- | --- | --- |
| preparing / queued capture | 当前owner同步占位，未公开ID；claim ACK后才可分配 | 占1；并发/第9份拒绝；迟到ACK不能使失效owner复活 |
| capturing | 临时group，任一await后查ID/owner/tab/文档/取消 | 占同1；TTL/失效不能释放未settle占位 |
| ready（包括complete=false） | collect命令已settled且group release ACK后才公开；无JS stronghandles | 仍占同1，保留claim；不因组已空另给8个cache slots |
| act reserved | 同claim先consume ID，实际命令遵守既有最终同步验证 | 仍占同1；任何失败/未知效果不得重试动作 |
| ready到期/已观察失效/partial consume | 旧ID立即stale；ready前group已release，且本SW无该组pending命令 | 转retiring，session删除ACK后才释放；不延长30s，不恢复旧ID |
| 正常collect/act失败或完成 | 等待实际命令settled；若尝试过remote分配，direct release ACK；未尝试分配无需造CDP命令 | 转retiring并删除claim；删除ACK前仍占1；release失败/删除不确定仍占位拒新 |
| 同owner/tab显式替换idle ready | 旧ID立即无效；只替换已settled/released的旧ready | 原slot进入retiring；旧claim删除ACK→同slot新claim write ACK→新采集。中间不并存两份描述/名额，不替换capturing/inflight/quarantine |

所有retire动作绑定原slot身份，迟到finally/删除ACK不能清除新claim；读写barrier不能把DOM最终同步验证拆出新的await动作间隙。tab关闭、WS断连、thread删除/abort或上下文事件先使相关ID失效；未settle组仍须上述清理，不因事件callback清Map而释放未知资源。普通ID拒绝/30s失效不改变原15s工具deadline、UNKNOWN健康、阈值4、真实locator历史或任何安全状态。

### 4.3 跨SW quarantine与真正reset边界

新SW读取到的所有旧claims一律成为 **quarantine**，不区分其旧时ready/active；不恢复ID、owner、描述、执行、授权或动作。可对该条claim指定tab的**已正证属于本extension的现有debugger session**发送固定group的direct release做有限清理；不能ensureAttached/attach/detach、扫描其它tab、重试被拒命令或释放foreign/unknown会话。证明失败/target未知/不存在也保留claim，不伪称资源已清。

即使direct release成功，该旧claim仍quarantine并占名额至本次extension browser-session结束；**不凭release ACK声称旧inflight全部settled，不自动回收旧claim**。因此最多8次遗留即可耗尽编号容量，明确SNAPSHOT_CAPACITY；允许调用者独立选择现有text/selector（原有门不变），不能自动fallback/偷偷重载扩展/重启浏览器/清ledger。未来若要安全复用quarantine名额，须另有真实时序证据与合同批准，本票不实现。

唯一自然reset是extension真正unload/reload/disable/update或browser-session退出；storage.session清除须与Chrome client teardown相配。普通SW停止/重启、WebSocket重连、工具超时、用户换thread不是reset。与实测Chrome153匹配的 [Chromium debugger实现](https://raw.githubusercontent.com/chromium/chromium/971a7443b0c9b0a9b2860529b33331b76077ec62/chrome/browser/extensions/api/debugger/debugger_api.cc) 的OnExtensionUnloaded/OnAppTerminating/OnProfileWillBeDestroyed调用Close→DetachClient；[Chrome storage文档](https://developer.chrome.com/docs/extensions/reference/api/storage#storage-areas)说明session清除边界。必须再保留owned真实reload旧handle不可达且旧client拆除的证据，不能仅凭storage为空断言普通SW遗留已灭。未通过的native边界标NOT_DONE，不以正常finally绿替代。固定名称isolated world须在同frame/document跨多次观察与SW重启复用同一上下文，不能每次造不同world；最终原生验收比较私有context ID，只记录相等布尔及合并distinct计数，不暴露ID；不设置页面global registry或新增runtime。

tab关闭、onDetach、顶frame导航/同文档导航、documentUpdated、contextsCleared、WS断连以及收到既有 chat.aborted/thread.deleted对应线程消息均失效；事件只是快速失效，不替代调用时查询。任一该tab旧 mutating工具在开始动作前也使其snapshot失效。未来编号不能跨「继续」依赖新executor namespace存活，不能在新thread/同owner重新连接中恢复旧ID。

## 5. 最终验证与零效果定义

沿原 ensureAttached共享await、CDP owner proof与TabQueue；不reattach foreign、不固定sleep。新snapshot生命周期所需Page/Runtime/DOM domain启用须在该新路径显式await并验证成功；失败固定拒绝，不把旧attach best-effort Page.enable当新observer已就绪。域启用不影响旧工具的原有行为。server每次已有gate await后、最后forward前复核实际线程scope仍存在及signal；扩展采集前后及每次CDP await后检查本地已观察取消/失效、owner/scope、当前tab文档、slot状态。没有凭缓存替server审批。现forwarder无逐次CDP取消握手；不新增第二种grant/远程revalidate协议，也不声称未送达扩展的异步取消必能回滚已派发动作。此残余与既有L1一致，拒绝范围是输入/文档检查失败、已观察失效或dispatch前真实取消。新的observer不跳过现有 worker tab lease/pack allowlist/active+pending mutationhold。15s deadline和 timeout tombstone不变。

动作时用 DOM.resolveNode把捕获backendNodeId解析到同一个隔离上下文，固定最终函数做有界重采集，验证 connected/document/node identity、控制角色/label/state/row顺序/表签名、当前矩形、HTTP(S) URLhash与文档身份。删除、同形替换、重命名、重排、相关控件增删或位置变化均 stale。无关且不改变表/目标的普通文本变化不保证使缓存stale；不声称全DOM事务版本。最终函数用 viewport内目标点 elementFromPoint校验目标自身/后代；其他遮挡元素/全屏overlay拒绝 ELEMENT_OCCLUDED，不点击遮挡层；在节点/文档身份通过后，遮挡判定优先于其导致的can_*表签名变化，不能把遮挡层当新目标。

同一完整有界表内归一化同label>=2（跨role也算，截短碰撞也算）标ambiguous；即使指定编号仍 ELEMENT_AMBIGUOUS，不能以编号替同名自动消歧。没有label也不按编号执行。重新collect不完整同样拒绝。

最终检查与固定原生动作在**一个同步 callFunctionOn函数**中完成，之间不再await或用旧坐标。调用前已无效的ID必须点击/值写/focus/input/change/导航动作计数0。不承诺合法动作后的页面回调/浏览器调度全局原子回滚；如原生集成不能达到上述同对象验证语义必须拒绝/报告，不偷偷切回两阶段CDP坐标路径。

## 6. 固定错误及恢复边界

新码均显式登记 recoverable，不靠包含 timeout/forbidden等页面字来判级：SNAPSHOT_SCOPE_REQUIRED、SNAPSHOT_STALE、SNAPSHOT_INCOMPLETE、SNAPSHOT_CAPACITY、SNAPSHOT_UNSUPPORTED_DOCUMENT、SNAPSHOT_UNSUPPORTED_CONTROL、ELEMENT_OCCLUDED、SNAPSHOT_FAILED。拒绝形状沿 codedToolError：success:false，固定`CODE:`首行，data.error_code与固定 suggested_action。无label/URL/异常原文写首行或日志。

scope/stale建议获取本地有效上下文并重新观察；capacity固定建议等待当前调用settle，或独立使用现有text/selector；旧SW遗留名额不会因等待自动回收，不建议自动reset/重试动作；incomplete/unsupported建议独立现有 text/selector请求；occluded建议用户处理遮挡后重新观察；失败不推荐 evaluate/CU/native替代绕授权。原 ELEMENT_AMBIGUOUS/WRONG_ORIGIN/CDP_ATTACH_FAILED及Hard deny、auth/nonce/确认码仍保持原等级与拒绝，无“失败就READY”。实际CDP attach失败继续已有冻结/健康处理；固定collector异常/无效shape为 SNAPSHOT_FAILED，不能抹为成功。

SNAPSHOT_SCOPE_REQUIRED、SNAPSHOT_STALE、SNAPSHOT_INCOMPLETE、SNAPSHOT_CAPACITY、SNAPSHOT_UNSUPPORTED_DOCUMENT、SNAPSHOT_UNSUPPORTED_CONTROL、ELEMENT_OCCLUDED是本次ID或数据边界的拒绝，不是 durable locator证明。仅在实际新snapshot工具或有效配对编号click/type模式识别这些固定码（及编号的 ELEMENT_AMBIGUOUS），不计origin失败/不persist经验。任何编号mode都不把UUID、数字或空fallback locator写入durable locator bans；真实CDP_ATTACH_FAILED冻结与UNKNOWN原阈值4保留，旧text/CSS真locator禁用与历史手工备注不变。不能全局把ELEMENT_AMBIGUOUS等旧码非累计。SNAPSHOT_FAILED与未知真正通道失败按原健康策略，失败预算不reset。

## 7. outbound/权限与观察档

默认/交互/企业/context outbound profile名单、exfil flags、grants和lease合同字节不变；新观察不对它们广告或获准。尤其 shared native click/type schema不能让 outbound自动看到编号字段：outbound tool-schema继续使用同一exported legacy click/type基础schema投影，额外编号字段additionalProperties:false拒绝，旧合法wire形状/描述兼容。不能仅依“scope最后拒绝”而默认广告不可用新能力。

plan_readonly仅新固定观察可在充分零DOM事件测试后加入既有读allowlist；编号click/type仍被拒绝。新观察仅加入明确tab identity lease集合，不加入mutation/L2集合；普通click/type现有mutationhold不变。Pack未列新tool则保持deny，不自动加所有Pack allowlist。旧navigate/evaluate审批不会被新cache授予或消耗。metadatascope不能mint nonce/token/authority。

## 8. 实现锚点与有限验收

现生产链：router Chat scope→server createToolExecutor→既有pregate/L2/URL→tool-forward WS→background/index→BrowserBridge/TabQueue→CDP。观察/编号模块只在扩展；server只派生可信scope并转交，不重写locator或gate。官方协议：[Page.createIsolatedWorld](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-createIsolatedWorld)、[DOM.resolveNode](https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-resolveNode)、[Runtime.callFunctionOn](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-callFunctionOn)及releaseObjectGroup是机制候选；参数extract已取官方JSON，尚非当前Chrome版本实测。grantUniveralAccess/CSP/userGesture不设置。不建立新runtime或页面全球状态。

验收必须按下面DoD逐条出实际production producer/JSON/真实caller/native专用inert页证据，录制shape不得手造假key：

| DoD | 有限证据 |
| --- | --- |
| 本地模型可读编号短表后click/type | actual schema/catalog→router scope→real WS/extension→owned Chromium inertpage，按钮counter1、input替换值；流程不调用evaluate工具/外部选择模型 |
| 保留text/CSS/focus type | actual既有W1 producers正反，text优先、CSS first、无字段focus旧合同 |
| 同名无误点 | 2个同label原生button，编号两者都ELEMENT_AMBIGUOUS且所有effects0；完整表扫描负控覆盖预算之外重复 |
| stale和遮挡诚实 | replace/remove/reorder/rename/move、wrongowner/tab/doc/TTL/重启/ctxclear、真实overlay；固定码+zero effects，cache一次使用/迟到拒绝 |
| bounds与泄露 | 5001节点/65rows/UTF8 label与JSON转义/16KiB值/统一8claims+active/ready/inflight/TTL；no rawvalue/secret属性/DOM/URL/日志，partial不能编号 |
| resource跨SW反例 | 保留R5实际protocol与R6实际collector分配后SW终止→旧handle仍可达；不是产品通过。新ledger实现后8个不同ownedtab跨重启占满，第9份零分配拒绝；旧ID均stale |
| storage与retire负控 | write未ACK/throws/不确定、坏shape、并发第9份、release失败、删除未ACK、ready到期/替换迟到、重启旧claim即使release成功仍占位；无raw日志/授权恢复 |
| native reset/context边界 | 专用reload→session消失且旧client不可用→新own attach后旧handle仍不可用；普通SW重启反例session/handle保留。固定同名world同文档重启前16次+重启后16次合并仅1context，不能仅两个batch各自1却不比跨batch身份；frame导航按新doc失效，不声称全平台矩阵 |
| 原安全机制 | real pregate busy/lease/pending/abort/authnegative、planreadonly、navigate/evaluate原拒绝、foreign debugger不接管、真实未知健康与真locatorban控制 |
| outbound不扩 | 原三类profile名单及旧click/type wire schemas对照，编号/新观察各拒绝，enterprise没有新permit |
| 平台与能力 | 共享JS受影响组+fresh locked Linux ARM、两build、独立source对抗/完整允许模型/精确head/mainCI；专用owned Chromium真实动作，不把semanticOS mock或SSR写native结果 |

本合同没有现成native通过，也不把硬件/真实SSO/所有网站/三平台物理设备/性能SLA生造为前置。框架与owned inert验证可开发，遇到真实API不支持则明确partial而不是新路绕过。不得关闭521仅因为spec写完或contract批准。
