# Numbered browser snapshot #521 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task only after the parent explicitly authorizes coding following independent contract approval. Steps use checkbox (`- [ ]`) syntax. No subagent dispatch, commit, implementation or live configuration action is authorized by this document alone.

GitHub: #521  
**Goal:** 有界可见控件观察表与一次性编号 click/type，保留旧locator，不接新模型/权限/运行时。  
**Architecture:** router-owned Chat scope经既有 executor/WS送到扩展；新扩展模块持有有限ephemeral ID记录，只有固定isolated/CDP函数观察和执行。现有legacy resolver、auth/L2/lease/timeout仍是前置，outbound继续使用legacy schema。  
**Tech Stack:** 当前locked Node22、TypeScript、Zod、Chromium MV3/CDP、现有Node测试runner；无新增依赖。  
**Source baseline:** caca05177efee40ad0ca76ad9cef57251d3f930b。  
**Contract:** ../specs/2026-10-15-numbered-browser-snapshot-521.md（以该文档为唯一行为合同）。状态：R1实现已有作者检查点但未过源码门禁；R2仅资源合同修订待非作者批准，以下新增资源步骤尚未执行。

---

## 0. 执行门和文件职责

这是合同可审查计划，下面新类型/函数和测试片段是**未来接口与测试草案**，不是已实现符号或录制payload。实施者必须按实际producer输出录fixture，不能拿本计划示例字段冒充生产回执。接口/机制若需放宽合同，停源交非作者复核，而不是边做边改授权。

- 新 `chrome-extension/src/background/interactive-snapshot.ts`：有界collector/label/result类型、固定isolated函数、shape/UTF8约束；不自行attach或浏览器全局配置。
- 新 `chrome-extension/src/background/interactive-snapshot-cache.ts`：30s/64rows/一次性reserve/cleanup纯ID状态机；当前preparing/ready/inflight与旧quarantine共享同一8slot allocator，不再独立Map清除即腾名额；注入monotonic now/UUID测试。
- R2新增 `chrome-extension/src/background/interactive-snapshot-cleanup.ts`：唯一session key、strict8claim schema、串行写ACK前分配屏障、正常retire/quarantine；只存slot/tabId/固定group，不读取其它storage，不给runtime/UI清除入口。controller负责实际CDP/direct release，ledger不能自行attach/扫tab/执行动作。
- 改 `chrome-extension/src/background/browser-bridge.ts`：复用TabQueue和ensureAttached；CDP object group、document/node proof、新分支，旧locator函数不整体重写。
- 改 `chrome-extension/src/background/index.ts`：仅实际authenticatedWS tool.execute顶层 locator_scope交给新分支，existing生命周期事件invalidate；runtime消息不能造scope。
- 改 `companion/src/bridge/tool-schemas.ts`、`tool-definitions-catalog.json`：本地新观察/编号参数，导出复用的legacy基础schema，旧输入不变。
- 改 `companion/src/outbound-mcp/tool-schema.ts`：仅click/type选择同一legacy基础schema，避免native扩展反向扩outbound；不改profile/grant文件。
- 改 `companion/src/server.ts`、`ws/tool-forward.ts`：server最后forward前从可信Chat scope派生内部metadata；forwarder只白名单带顶层metadata，pending/timer/owner/result校验不重做。
- 改 `companion/src/orchestrator/constants.ts`、`tool/plan-readonly.ts`、`chrome-extension/src/sidepanel/mode/surface-by-tool.ts`：新观察明确L1/readonly/tabidentity；不放开Pack/写工具/L2。
- 改 `companion/src/security.ts`、`tool/site-op-memory.ts`、`llm/adapter.ts`：固定新码登记、new-mode ephemeral拒绝不落durablelocator；原UNKNOWN/阈值/真实CDP冻结不变。adapter既有Rule7补“先观察表再选编号/失败后独立旧locator”，不改其他模型/Rule12安全策略。
- 新测试文件列在每项；原 `docs/superpowers/specs/2026-08-21-web-act-loop-design.md`仅加本票后继链接及历史波次说明，不能重写旧审查结果；本计划/spec保持头部Issue锚点。用户文档 `docs/architecture.md`补小段编号示例与一次使用/不保证SLA，不新增设置开关。

## 1. 参数、catalog与outbound不扩

**文件：** tool-schemas.ts、tool-definitions-catalog.json、outbound-mcp/tool-schema.ts；新 `companion/tests/interactive-snapshot-contract-521.test.ts`；现 tool-schemas/outbound-mcp-schema/outbound-mcp-profiles。

- [ ] 先加实际schema契约红例，覆盖合法pair、partial、空UUID、NaN/Infinity/0/fraction、mixed text/selector/exact:false、16KiB UTF8值，不能用测试自造validator。示例断言目标（函数tryParseToolArgs是当前生产符号，候选参数仅为输入）：

```ts
const id = "9dbe5d46-b71e-4bd5-8c47-c8c2c2bf5a35"
assert.equal(tryParseToolArgs("click", {tabId:7, snapshot_id:id, element_id:3}).ok, true)
assert.equal(tryParseToolArgs("type", {tabId:7, value:"x", snapshot_id:id}).ok, false)
assert.equal(tryParseToolArgs("type", {tabId:7, value:"x"}).ok, true)
assert.equal(tryParseToolArgs("click", {tabId:7, selector:"#save", text:"Save"}).ok, true)
```

- [ ] `nvm use22; ./node_modules/.bin/tsc -p tsconfig.test.json; node scripts/run-tests.mjs .test-dist/tests/interactive-snapshot-contract-521.test.js`，保留old actualRED。不能只因缺导出module让所有测试import失败算行为反例。
- [ ] 从原click/type shape提取共享基础schema，不手抄第二份；本地增加paired可选字段与refine，presence检查包含exact:false。新观察 `.strict()`；新typevalue byte cap仅numbermode。schema校验拒绝不能吞字段。
- [ ] catalog只新增 get_interactive_snapshot和click/type属性说明；default/outbound profile名单不动。outbound schema显式用legacy基础schema，原anyOf/text/selector义不变，两个编号字段仍additionalProperties:false。
- [ ] 同样cmd GREEN；加入actual getToolDefinitions和actual outboundToolArgumentSchema前后baseline快照相等断言、短/wrapped wire两形态；新观察profile forbidden，三种profile/enterprise未获新能力。

## 2. ID缓存、统一global名额与session cleanup ledger（R2）

**新/改文件：** interactive-snapshot-cache.ts、interactive-snapshot-cleanup.ts；新/改 `chrome-extension/tests/interactive-snapshot-cache-521.test.ts`、`interactive-snapshot-cleanup-521.test.ts`。本R2先合同批准，后才编码；不变更server/WS/token或另建generation系统。

- [ ] 先保存原33candidate source/67raw、R5/R6协议与actualcollector真实反例、原finding/proof、pinned Chromium/V8全文SHA；旧绿不豁免资源漏洞。单独证明session存储API shape/界限，不用手造字典冒生产正向receipt。
- [ ] 写生产ledger/cache/actualcontroller反例再实现：唯一key `cmspark.numberedSnapshot.cleanup.v1`，精确最多8 `{slot,tabId,group}`；slot0..7唯一、positive safe tab、group只能固定slot名字。假storage只作为受控失败seam，actualChrome.session补正向。不得允许extra keys/任意group/owner/URL/ID/label/secret，形状坏或读取/写入不确定一律拒绝新模式，不覆盖未知状态；不能constructor未处理rejection或全局deny阻断旧text/CSS路径，补legacy阳控。
- [ ] 单个SW模块唯一serialized allocator（多Bridge/controller实例也共享）把preparing/capturing/ready/inflight/retiring/quarantine算作同一8slot。write ACK前无remote allocate，ACK后仍查owner/取消/TTL；第9请求无CDP分配。并发write、同tabqueue占位、取消迟到ACK和异常barrier均有producer控制，不以两套Map各8个假绿。
- [ ] 保留假时钟TTL29999/30000和singleuse真实旧控制。ready前collect settled+release ACK，但claim继续占同slot；ready到期/失效/partial consume在删除ACK前不能腾slot。正常act/失败若曾尝试remote allocate须先settled+release ACK才retire；未尝试分配可直接retire。release失败或删除不确定保留占位，不当已释放。
- [ ] 同owner/tab仅替换idle ready：先旧ID无效→旧claim retire ACK→同slot新claim write ACK→新采集，迟到finally不能删新slot；不得替换inflight/quarantine或延长TTL。清thread/tab/WS事件只失效ID，不能清未知资源。当前SW纯缓存只有backend descriptors，无remote stronghandle。
- [ ] hydrate到的每个旧claim均quarantine至extension browser-session结束；direct已证ours session release可以清资源但**不回收名额**。foreign/unknown/missingtab均不得attach/detach/scan/reset或resume旧ID；未证inflight排序不要求靠猜来复用。8遗留后capacity，用户可独立旧text/selector，模型/工具无clear/reset按钮。
- [ ] focused actualproducer RED→GREEN、purefakeclock/storage fault seam与真实Chrome.session分别标清；不改变原100ms/5000/64/24KiB/16KiB/30s/15s、权限/UNKNOWN/阈值或错误等级。编译与旧cache生命周期全部受影响检查通过后才冻结资源源码。

## 3. 有界collector与固定执行函数

**新文件：** interactive-snapshot.ts；新 `chrome-extension/tests/interactive-snapshot-521.test.ts`。

- [ ] 定义有限类型/常量并写actual DOM function producer反例，避免手造result冒正向：

```ts
const LIMITS = { slots:8, ttlMs:30000, nodes:5000, rows:64,
  scanMs:100, labelCodepoints:64, labelBytes:128, resultBytes:24576, typeBytes:16384 } as const
type SnapshotRow = { id:number; role:"button"|"link"|"textbox"|"combobox"|"checkbox"|"radio"|"menuitem"|"tab"|"option"|"summary";
  label:string; state:"empty"|"filled"|"unchecked"|"checked"|"disabled"|"readonly"|"ready";
  can_click:boolean; can_type:boolean; ambiguous:boolean }
```

- [ ] 固定collector TreeWalker只顶层，5000节点+64rows+合作时钟；label与其文本查找共用全局预算，不能每控件各扫描无限子树。role/state规范、敏感输入排除；不读innerText/outerHTML/任意attribute集合。完整serialized ToolResult用TextEncoder测24KiB，超限partial不编号。table由rows确定性投影，用户label不插函数源。
- [ ] 支持范围与final函数按spec固定：原生对象、connected/document/表/node/矩形校验+elementFromPoint，然后原生prototype click或允许input/textarea value setter+input/change，无await；传value用CDP arguments，不字符串拼用户JS。readonly/disabled/inert/occlusion/ambiguous/unsupported先拒绝，zero焦点/点击/值写/事件。
- [ ] 真实 DOM fixture记录counter，在replace同形node、remove、reorder、name/rect/state变更、遮挡、重复/截短碰撞、5001/65/大Unicode/转义时断言拒绝计数0；正向原生button1、受支持type替换值1。纯candidate数组仅作helper测试不替真实DOM。
- [ ] Node focused先RED→GREEN；有DOM库不足不要安装新依赖/镜像假DOM成功，留actual owned Chromium脚本到任务8执行。固定函数单元可用已有CDP fixture检输出，但标明transport模拟。

## 4. 真实host provenance到extension

**改：** server.ts、ws/tool-forward.ts、background/index.ts、browser-bridge.ts；新 `companion/tests/interactive-snapshot-forward-521.test.ts`。

- [ ] 实际createToolExecutor/forwarder测试先RED：raw params写scope/__thread_id、无 evidenceScope、trustedOutbound、enterprisePermit、已删thread、abort在gate await期间、wrongextension result，均不能得到新metadata授权；正常真实router-ownedChat boundscope才有metadata。
- [ ] server在入口去掉模型scope字段，在最后已有forward前二次校验thread/signal，计算SHA256(sessionId+NUL+verifiedThreadId)；转发顶层 `{scope_id,thread_id}`，不向params/payload/result附加它。现有pregate、URL/L2、lease、timeout块不搬进server。
- [ ] forward ctx仅新增optional内部metadata，pending.originWs/timeout tombstone/settle/finally原文保持；get_interactive_snapshot/numbered calls没有合法scope立即固定拒绝，legacy无metadata照旧。
- [ ] extensionWS入口严格shape读顶层metadata传第三参数；runtime sendMessage来的模型object不能成为该第三参数。收到既有thread.deleted/chat.aborted或断连清相应slot，不能跨owner清掉别人的ready cache。
- [ ] actual forwarder test验证最终tool.execute JSON与wrongpeer/late response，在true Chat wrapper上验证metadata，不把fake authenticated flag当真实HMAC proof。canonical runner GREEN后再既有ws-tool-forward/tool-forward-actuator/l1-actuator/business-evidence-executor。

## 5. CDP绑定/主流程集成

**改：** browser-bridge.ts；新 `chrome-extension/tests/interactive-snapshot-bridge-521.test.ts`；原browser-attach-567/browser-owner-567/tab-queue。

- [ ] 实际BrowserBridge fakeChrome边界先RED：Page.enable gate未resolve不能collect；tabQueue同tab串行；unknown/foreign debugger proof不能attach/detach；URL/document/context在每一受控await后变更则拒绝不调用动作；CDP异常不读pageError判断等级。
- [ ] 新观察case复用ensureAttached；仅新路径对Page/Runtime/DOM domain启用显式await，失败拒绝，不修改旧attach best-effort行为。在Page.getFrameTree顶frame建立isolated world（不grantUniversalAccess/CSP/userGesture）；固定collector对象组最多64DOM引用，DOM.describeNode获取backendID，getDocument depth0不pierce。将group固定为当前global slot的唯一名称；claim write ACK之前不得发任何remote allocate。正常finally等待本组命令settled+direct release ACK；ready只backend IDs但claim继续占slot，不能因释放group另造8份ready容量。旧quarantine只做已证ours cleanup且不free，不自动复用。
- [ ] click/type在paired模式先reserve，然后DOM.resolveNode到同context，用objectId fixed callFunctionOn做最后验证+动作；禁止调用旧resolveLocator、scripting MAIN fallback、Input按旧坐标或evaluate工具。任何失败finally绑定同slot身份清理/正常retire；不确定release/ledger删除保持占位，timeout不重新执行，旧SWclaim永不恢复ID。
- [ ] onDetach/tab/document/context/navigation事件先失效ID；ready正常retire需session删除ACK，未settle/旧quarantine不腾slot；旧tab mutator开始前invalidate。事件未到仍靠实际frame/document/URL/target校验。不能承诺全DOM事务或未送达取消的回滚，保留现有L1残余。
- [ ] 同一actual BrowserBridge source必要focused GREEN，真实debugger/native不在此mockfamily中冒称；existing attach共享promise/foreign negative必须保持。

## 6. 恢复、经验与模式分类

**改：** security.ts、tool/site-op-memory.ts、llm/adapter.ts、orchestrator/constants.ts、tool/plan-readonly.ts、front surface-by-tool.ts；扩展新 `companion/tests/interactive-snapshot-recovery-521.test.ts`。

- [ ] actual扩展producer→JSON→classifyError→adapter consumer RED：八新固定码在neutral/timeout/security block/forbidden/LF等页面文字变化下等级固定；不建立新generic mapper。原auth/deny/HardStop不变。
- [ ] 单表登记八码recoverable与固定human hint/suggested action。newmode特定stale/shape/ambiguous/occluded拒绝不写durablelocator经验、不计origin失败；真正CDP attach/UNKNOWN仍走原健康逻辑，阈值4及true text/CSS ban不变。编号作为ephemeral ID不能用locator='none'污染旧键。严格有限工具+有效pair检测，不全局降低ELEMENT_AMBIGUOUS或删除历史记录。
- [ ] 原Rule7补固定说明：先read新表、选择can_*且非ambiguous编号；消费一次后重新观察；不完整/失效时独立text或selector、不得复用隐形ID。no Jev/0.6B/CU默认推荐。
- [ ] observer只加TAB_LEASE_TOOLS与readonly/L1表，不加mutation/L2/Pack/outbound。新编号click/type保留原mutationhold与plan拒绝。
- [ ] 同一canonical targeted GREEN，附unknown4次升级、attachfreeze、true locator2次ban、手工note保留、authnegative/planreadonly/busy/pending/abort控制；不reset这些状态使测试假绿。

## 7. 用户说明和契约fixture

**文件：** docs/architecture.md、旧SoT后继链接；新 `chrome-extension/tests/fixtures/interactive-snapshot-521-recorded.json`（只有真实producer完成后才录制）。

- [ ] actualcollect→JSON fixture录下bounded原生inert页正向与partial/ambiguous/stale错误，不保留原始页面/URL/token/内部scope；记录base/sourcehash/productionfunction/transport/native区分，不手填假字段。
- [ ] 用真实fixture跑schema/render/adapter contract；数字字段不会被strip，code首行/等级正确。基于真实观察输出给文档一个可复制短例子，明确type替换、一次使用与不支持customeditor；未测性能不写300ms。
- [ ] 对新文档及catalog检索Jev/kev/Qwen、outbound/defaultCU/Trust字句，确保只是明确非目标，未自称已接入。

## 8. 有限owned原生补证、同组机器和冻结

**测试脚本：** 新 `chrome-extension/scripts/test-interactive-snapshot-521.py`（uv执行）；新录制fixtures与证明仅owned inertpage。该脚本复用已有owned Chrome/MCP fixture原则，不创建第二扩展/默认profile。

- [ ] 专用新profile/临时loopback inert页，真实当前extension/authenticatedChat route→WS→CDP采集与两步（nativebutton、nativeinput）正向；模型选择可以是声明的确定性synthetic transport调用，不冒human/LLM决定或外部模型。记录按钮/输入counter、实际CDP类型和无evaluate工具/无L2token；不写pagecontent/QR/cookie业务数据。
- [ ] 保留R5/R6实际分配后SW终止反例；新8global claims分属不同ownedtab并跨SWrestart，第9份无分配，release成功的旧claim仍quarantine；正常同SWready expiry/replace可正确retire与复用，旧ID永stale。write异常/不确定ACK、release失败、迟到删除、未知owner负控不得attach/detach或隐藏reset。
- [ ] owned真实extension reload测试：先session marker+隔离world remotehandle→普通SWrestart两者保留→真正runtime.reload→session消失/原Chromeclient不可用→新own attach后旧handle仍拒绝。固定world同文档重启前16次+重启后16次合并只1context，私有ID比较只输出bool/count；reload后重复调用另记录distinct，不能以各batch单独1替代跨SW身份比较，不冒全平台/导航下无限context SLA；所有runtime imports前owned DATA。夹具等待错误保留，不改产品ready/sleep掩盖。
- [ ] 对真实DOM replace/overlay/same-name/tab导航/contextclear/owner差异/TTL至少各一次，动作计数0；所有fixed拒绝原样存；Page API不支持时partial而不是切回MAIN/attach陌生owner。清理仅ownedprofile/server/data，保留失败raw证明。
- [ ] Node22：Companion `tsc -p tsconfig.test.json`+canonical新4families与受影响旧schema/forward/pregate/outbound/site-memory；Extension新3families+W1/attach/owner/readonly/mode/queue。之后同组一次完整host/fullfront/双build、fresh locked LinuxARM受影响，source/四lock/compiled额外源0与beforeafter哈希。不得逐个小票重复全仓，也不得把Linux mock写nativeWindows。
- [ ] 输出manifest/full.diff/producerRED/GREEN/原生receipts/limits完整报告，冻结source。作者不能自批；提交只在root非作者与允许完整Kimi/当前配置Claude（工作日无Pi）源级门禁通过后由root执行。精确head/mainCI后再由root判断Closes或Refs521；native或DoD缺口仍partial不得假闭。

## 9. 完整性核对与不能偷渡的工作

任务1覆盖参数/广告/outbound，2覆盖ID/资源生命周期，3+5覆盖真实DOM与副作用，4覆盖可信owner/传输，6覆盖错误/安全预算与历史经验，7覆盖使用说明/真实payload来源，8覆盖真实producer及门禁。spec每条DoD均有任务；没有把spec完成当功能完成。

后续ranking/kev4b/Jev、iframe/shadow/知乎SLA、默认CU/模型切换、动态API预算、snapshot ID/内容持久化、新grant/远程取消事务框架不在此计划；唯一session例外仅本R2八条非敏感cleanup claim，不是snapshot恢复或新授权。不能为实现便利把平台API不支持改成无限sleep、rawmessage substring、CSSfallback、native驱动或免确认。若现状与预设协议不兼容，保留实际失败和有限最小修合同供root复审。

## R2 合同验收映射（仅设计，待非作者批准）

| Spec条款 | 永久focused/实际原生证据 |
| --- | --- |
| 4.1精确claim与write barrier | actualcleanup producer schema/bad-data/read/write/不确定ACK/并发/zeroallocate，actualChrome.session正向；原33/67与原finding不变 |
| 4.2统一名额/ready/retire/replace | active+ready+quarantine合计8；删除未ACK不free、旧finally不删新claim、TTL不延/未settle不释放、正常同SW可retire |
| 4.3跨SW保守策略 | 原actualcollector retention对照；8ownedtabs实际restart后claim保留且9th拒；release成功也不free，ID不复活，无native动作/授权恢复 |
| 4.3session reset与world | pinned同版OnExtensionUnloaded→Close→DetachClient全文；owned reload实际边界、SWstop负控、16次固定world同context；未执行项诚实NOT_DONE |
| 其余合同 | 原schema/outbound、owner/auth/busy/plan、fullvalue/ambiguity/overlay/partial、UNKNOWN4与真locator、双build/ARM/独立/完整models/精确CI；不借旧绿批准新资源代码 |

R2合同批准仅允许随后最小resource实现；不等于该实现已通过，也不赋予commit/merge/关闭521权限。原代码检查点及全部失败/修正日志保持可追溯。最终safe3way到main d00772eda2d430253845595f11f1c491930685aa时保留PR648全部33差量，不能整文件覆盖共享schema/security/router/browser。
