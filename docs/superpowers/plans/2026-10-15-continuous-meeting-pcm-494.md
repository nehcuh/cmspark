> Implementation checkpoint (2026-10-15): root independently approved R2, the sole R3 speaker, R4 explicit New, and R5 HTTP Begin pin increments for implementation only. The historical frozen contract below is preserved verbatim. The owned d007 implementation now awaits nonauthor source review; real browsers, allowed local model, named Grok/DeepSeek, fresh ARM and exact CI remain pending. This note grants no release or closure approval.

# #494 — 持续会议 PCM 实施与验收计划（只设计，未开工）

Issue-first：已有#494先于本spec/plan。本plan与spec基于公开caca0517，R2核相关23个Git对象在已交付d007仍exact（不以移动工作区代替）；R1独立P1 REQUEST_CHANGES完整保留，本轮只修E1当前backend观测/fence及实际q1 ACK relay，**DESIGN_CANDIDATE / ROOT_NONAUTHOR_CONTRACT_PENDING / NO_PRODUCT_CODE**。不改33path/wire3/476/480/配置，不跑模型/Pi。设计者不能自批；任何下面步骤都未因列在plan就算已执行。

## 0. 批准前冻结与机械核对

全文冻结spec/plan/设计报告、existing494全body/comments0、原actualscope+probe+2FAIL、32Git对象/root递归收据。核existingproducer响应：start是voice.stt.partial(receiving)，chunk旧成功没有ACK，end是result或empty_result/error，abort返回error aborted；meeting.start是meeting.started，旧会globalforceAbort。这些真实shape必须进入评审，不能假造旧ACK。

校核60s PCM=1920000B、8s segment=256000B、40ms block=1280B、8credit10240B含同budget、ceil60/8=8段、8×330+2+5=2647<3600。仅设计一致性检查，不运行queue产品、ASR/原型token/native。root非作者正式完整合同判定后，才把批准docs带入root指定isolated实现树。批准前不建产品分支/不写源码，不用report自称APPROVE。

## 1. 冻结真正实施边界（后续root批准才开始）

候选生产组件表（实际开工时再次核文件存在；新增路径只是候选，不是已经真实存在）：

| 模块 | 候选路径 / 目的 | 禁扩 |
| --- | --- | --- |
| one server queue | companion/src/voice/meeting-pcm-queue.ts(new) | fixedbuffer/credit/segment/ledger纯状态，不多ASR池、不磁盘PCM |
| queue contract helper | companion/src/voice/meeting-pcm-contract.ts(new) | 一fixed q1 version/caps DTO；无config/token |
| real single slot/service | companion/src/voice/stt-session-service.ts、stt-session-core.ts/runner仅必要helper | 当前singlebound判别lease/retirement；不提高legacycaps/模型权限 |
| real handlers/schema | stt-handlers.ts、ws/validate.ts、message-router.ts，仅q1字段/受限pong/pinning | 无新client verbs、ACL/Role bypass |
| meeting lifecycle/persistence | meeting/meeting-handlers.ts、meeting-store.ts | 固定summary/epoch/OCC、existingsegment持久owner；无新Execution/audio store |
| shared capture | chrome-extension/src/sidepanel/voice/meeting-continuous-capture.ts(new) | browser-onlycontinuousresample/creditedproducer，不加载ASR |
| actual plugin caller | MeetingPanel.tsx、meeting-caps.ts/adapter必要窄接线 | 不重写普通dictation、导入、参考、PP/PTT |
| actual Summoner caller/HTTP | summoner/meeting-workflow.ts、summoner-web.ts | HTTP/SSE identity+q1fields/status；voice-settings仅投影actual backend当前观测，不从localcfg/helper合成能力 |
| actual tray relay/client | companion/src/menu-bar-agent.ts、companion/src/tray/companion-client.ts | 真实summonerClient/socket/auth当前观测失效与同连接无await发送fence；q1 chunk/abort correlated actual ACK分支；legacy sendAppMessage/noACK保留 |
| actual plugin WS send boundary | chrome-extension/src/background/ws-client.ts与实际会议transport adapter必要窄接线 | 已读实际send/auth前pending/flush与generation guard；ping绑定current认证socket，q1最终无await fence且不进入legacy pending/重连flush；不重写generic连接架构/扩大权限 |
| generated browser asset | companion/src/summoner/meeting-continuous-generated.ts(new)与bounded generator/check script | 输入SoT为canonicalcapture；不手修duplicate/运行时eval；不新依赖/permission |
| tests/docs | 实际owningqueue/handlers/caller/UI/regression、specplan更新 | 无skip/更低assert/budget，旧失败保留 |

与其它交付同文件只能真实窄merge；禁止wholefile覆盖共享message-router/validate/Summoner或复用33/wire3源码批准。先记录base/head/path/hash，再有必要共享affected检查，不盲跑whole仓库每小步。

## 2. 按合同分段建立真正RED→GREEN

### P1 — 真实响应/旧caller反例，先保失败

从实际现有handler/serializer生成old shape fixture，不运行有效token，不接个人config。复现原两端sample-ID gap：16k source96/actualwire64，expected96 assertion真FAIL；短prefix/control、legacydictation/voice caps保持正常。记录source/code/hash/emit/raw，setupfail不算产品RED。永久test oracle不写一个“模拟实现的新queue”然后测自己。

### P2 — one bounded server queue与credit reservation

root已批准数字后才写fixed buffer/sparse bounded descriptors。纯state测试做offset/byte-hash/partial/frame ceiling、two-rates continuousreference、repeated/equivocating/unknowncredit、reservation不重复计/释放、one epoch dispose、8segments/9descriptor/8credits边界。数学test只支持caps一致，不当producerAC完成。

容量触顶负控必须观察stop input/actual boundary/所有已admittedprefix drain，而不是允许queue grow或抛error后继续mic。测试实现onovercap不能丢最末合法块，不能隐藏由于failure不可恢复的范围；输出fixed状态，禁止PCM进日志。generator sharedbrowserasset按exactsource重生/hashcheck。

### P3 — actual global service与peer/epoch lifecycle

实际SttSessionService/handler分支，不替换成手搓success：protectedcontinuouslease贯穿firstlastjob、legacy与另peer拒、samepeer旧abort无flag仍不能取消新epoch、oldmeeting.start全局clear不能preemptcontinuous。actual runner fake exec counter max1、delayedabort/childclose、resourceconflict/partial禁新infer；旧service兼容tests保留。

捕获beginOCC/atomicstorefailure/unknownACK、persistedepoch与liveobject同步；固定summary不是authority。新q1权限仅现origin/surface/peer+privacy；未知contract/capfield、sensitive混包、fakecapturedgrant、emptywrongtype全拒。能力必须是actual queue-owner backend当前认证socket的correlated pong，不是proxy同编译helper常量。`summoner-web` voice-settings经实际summonerClient投影当前观测；`menu-bar-agent`长寿HTTP closure不可持有已替换client冒current。`tray/companion-client` disconnect/close/error/auth reset/challenge/failure/重新认证/reconnect/endpoint/client/socket replacement立即失效，旧socket/pending/auth callback不能复活旧positive。插件actual WS sender同样执行，auth.ok/OPEN不自动有q1。

实际q1最终send边界重核current client+确切socket+认证生命周期+observation；准备/await后重核，最后check→该连接pending注册→socket.send之间无await/微任务/任选replacement。只加窄q1观测/conditional request，不造新generic generation框架或auth字段。连接变化failclosed/fresh pong/新的显式Begin；不自动replay未知Start、重开mic或进入旧loop。真正oldserver控制必须0legacy meeting mutation/0global forceAbort/0mic admission/0newlease。

真实relay必须显式分支：q1 chunk与q1 abort用绑定该连接的correlated sendAppRequest，actual backend E7 ACK/取消受理状态及fixed拒绝原样安全投影、匹配request/owner/epoch/credit；不能只sendAppMessage后造ok。q1 abort受理不等于child退出；legacy无q1 chunk/abort继续原sendAppMessage/noACK，不承诺旧WS新增ACK。现有HTTP body forwarding须保留受审q1字段而不全量透传；currentcap positive也不能绕dispatch fence。

R3唯一窄增量（待root非作者正式批准后才加字段/产品源）：按spec E2a在q1 meeting.start严格allowlist接收可选speaker<=32，插件显式Begin同步snapshot旧trim/slice、lease固定、server真实append同值；blank/omitted不造label。same operation replay比较speaker，差异collision不改epoch/lease/原稿。两端UI保原默认label禁改期间并覆盖q1 drain，下一capture可改；Summoner原无speaker保持。不得进summary/config/status/权限，不动legacy/import/bulk speaker。

R5唯一HTTP Begin相关性增量候选：按E1e显式Begin既有capture_id query把actualbackend观测pin为单bounded pending、原30s deadline不续期；普通settings refresh无重绑/复活效应。先保存实际HTTP→tray/currentclient→handler/service/store 2PASS1FAIL（oldBegin跨newpositive实际Start=1应0），再控制断线/重认证/替换、同ID/异ID/过期/await-before-finalsend、samecurrent Start/实际receiving/terminal/lostACK；pending转actual accepted owner与清理须真producer、无3h新RPC缓存。失败0旧mutation/globalclear/lease/mic、独立draft不回滚，不跑真实凭据/麦克风。源query字段须root正式增量审后才加。

P3明确pause/abort/restart guard必须在serverawait前后，不能只前端判断捕获ID。取消表示请求，actual child结束后才让新job进入；超清理deadline记录retiring/busy，不造并发成功。

### P4 — actual segment ASR→原存档→状态投影

重用现实际model/path/probe/runner/tempcleanup，不启第二child/partialASR。以producer构造唯一8s/shorttail range；实际serializer actual receiving/chunk q1ACK/draining/status/recognized/persisted outcome均录制后再写fixtures。legacy chunk noACK仍不变。q1 output仅ownpeer DTO，不广播PCM/secret/modelpath。

实际meetingstore控制：oldhistory read、同segment stable replay、lostsaveACK、precommitwrite failure、sameID不同text/range collision、cancel-vs-synccommit、当前meeting切换/staleappend拒。empty_result无文字终态不伪“确定静音”，真实inferfail显式封口；不会自动重识别unknownRPC或skip坏段后绿finish。每个段保存commit前不release PCM，cap可能因此提前stop必须真实提示。

summary/ranges字段与生成纪要source fingerprint一致，knownincomplete sticky；restart boot reconciliation标partial/unknown，PCM不重建。禁止把volatile已received计数写成durable保存保证。

### P5 — 两端实际capture/caller闭环

R4唯一有限UX候选：现有显式New动作沿原create接口确认draft ID，Begin空ID提示先新建/选历史且无mutation/mic；已有ID按q1继续。不得在Begin内部自动create；成功draft是此前独立用户动作，不回滚，也不掩盖失败q1操作真实effects。源字段/按钮实施须root正式增量批准。新增T18控制：actual两端New create回执/失败/迟到owner；empty-ID Begin零create/Start/mic；显式成功draft→cap失效Begin失败时draft保留、失败操作增量mutation/globalclear/lease/mic均0；samecurrent positive与历史ID继续原门。

插件实际MeetingPanel→sharedcapture→real WS validator/service/queue/store；召唤器actualHTML generatedcapture→real authenticated HTTP dispatcher/SSE/service/store。可以syntheticauth/config但必须明确边界，initial只有用户Start；不触个人live config、正常浏览器profile或有效grant。

在allowedowned fakeAudioContext/PCM fixtures验证：same graph跨ASR慢窗，sample sequence跨rate/chunks、旧96→64同oracle变96→96；quietempty、lastpartial、stop/cancel/unload/gUMlate/revoke/mute/networkstall、overflow/highwater/deadline、wrongpeer/epoch/dup/outoforder/savedlate。capturestop/trackstop/contextclose/childretire/queuezero/owneddata cleanup必须active计数及实际assert，不只初始化allow0。

共享module test不能替代actualproductiontwo caller test。HTTPUI测试必须旧CSP/cookie/origin/nonce保持；真实forwardedwire fields如actualproducer，不假造newcompletion。owner侧持续比displaythreads/meetings所选ID更权威；新meeting按原guard停采/排空或明确Cancel，不把lateA重选到A。

### P6 — 原要求的真实浏览器与真实本机模型（本阶段没有执行）

root批准实现、适用机器/安全范围后才运行owned真实两端浏览器：plugin真实生产React component与Summoner实际HTML/HTTP，各390窄/短与960桌面，Stop/Cancel/queue/ETA和键盘实际DOM、点击/焦点；mic输入可用owned合成连续设备/PCM，识别边界slow deterministic fixture与actualbackend。sample/order/hash来自生产wire和queue，不用timer count代替sample完整性。不能用forceclick躲实际不可达按钮。

至少一个真实已允许的local runner/model输入非用户合成材料，当前允许config只读/不改；证明新queue slow/bursty segment/尾drain和actualmax1/临时文件cleanup，记录实际model/binary/source/tool/process身份。旧492 Tingting句4805/6408ms记录不能借为新的run。若真实模型/浏览器入口受阻，保原raw/原因，root裁决真实availability；不能假绿/冒另一provider，不默认install/启engine/改模型。

普通dictation/SAPI compatibility可先deterministic adapter验证，不发明全nativeWindows硬前置；实际需要的平台分支按真正改动验证并准确披露未native的范围。不得将Mac/native skip当新Windowspass。

## 3. 最低完整验证矩阵（每行可亲证而非口号）

| ID | 触发与oracle | 所需层 |
| --- | --- | --- |
| T01 | oldsame96 oracle两端缺32；new received/saved范围0..96无重叠 | actualcaller+queue+wire，不仅purecore |
| T02 | 16k/44.1k/48k reference，不同callback/segment切法同byte输出 | actualsharedresampler/producer |
| T03 | budget-1/exact/+1、creditsinflight、maxdescriptor/alloc；N边界后stop | queue+actualcapture |
| T04 | slowfinal/coldstart，duringinfermic仍active；pendingincreases，ETA未知→估计 | actualworker/twoUI |
| T05 | shortfinalblock、userstop、cap/hardcapstop，prefix真drain、limit不是fullmeeting | service/store/producer |
| T06 | cancel-before/aftercommit、midinferlatechildclose、wrongpeer/epoch/oldtimer | actualservice/nativefakechild+store |
| T07 | oldmeeting.start/oldabort不杀protectedlease；legacybound oldflows不回退 | realhandlers/router/state |
| T08 | gUMpromise迟到、permissionrevoke、mute/suspend/gap；inputstop不假continuity | sharedcapture/realbrowser候选 |
| T09 | networkbeforeACK/unknownend/save ACK、reconnect、unload/daemoncrash | transport/service/store/status |
| T10 | atomicsummarybeginfail/lostACK replay/OCC stale begin/newUUID | actualmeetingstore/lease |
| T11 | empty_result正常无字；inferfail/timeout/writefailure不skip/假complete | realservice/resultfixture |
| T12 | actual newproxy+oldbackend/localhelper为1仍拒；invalid/missing/错类型/未知版本/错request/旧socket pong拒；current同连接capable positive与真实q1 ACK；敏感字段/rawPCM秘钥无输出 | actualbackend serializer + realHTTP/menu-bar-agent/trayclient + actualpluginWS sender，禁止仅手写capflagfixture |
| T12a | capable pong后、最终send前触发disconnect/auth reset/reconnect/endpoint/client/socket replacement；旧pong迟到/普通重连旧positive；恢复后未显式Begin不得自动send | 同一actual sender/relay可控调度；拒绝分支0legacy record mutation/globalclear/newlease/mic admission，active counters/assertions |
| T12b | q1 chunk/abort真实correlated backend ACK/拒绝通过HTTP；wrong id/socket/epoch/credit拒、send失败/timeout unknown；legacy无q1同旧noACK | actual menu-bar-agent dispatch→CompanionClient pending→backend serializer，取消受理不伪资源retired |
| T13 | narrowshortStopCancel、phaseconcurrent/backlog/ETA、switch/stale回复 | realproduction DOM/browser |
| T14 | capture3h/drain60min/idle10s/stop2s/retire5s边界压缩testclock，数值不改 | actualownerstate +deadlineproducer |
| T15 | fixed volatilePCM no defaultdisk；oldtmp cleanup/ownerdata removed；restoreunknown | activeeffects/FS/provenance |
| T16 | two realbrowser/one reallocalmodel final allowedrun，fullsourcehash对应 | 原DoD必须独立记录，未执行保持pending |
| T17（R3候选） | actual Begin trim/slice snapshot→lease→raw archive；blank/omitted无label；32边界；同op不同speaker collision零epoch/lease/原稿变化；capture/drain禁改、下一capture可改；Summoner omitted；fixed DTO/summary无speaker | actual plugin producer + strict schema + actual handler/service/store + DOM；批准前只有source/control设计证据，不冒GREEN |

T12系列先复用并冻结独立R1的6个actual producer控（legacy schema/handler确实accept+mutate+clear、privacy负控、HTTP settings无backenddispatch、oldHTTP剥q1、tray本地ok、samepeer staleabort），证明oracle能看到危险旧路径；它们不是新实现GREEN。新测试须实际new relay/client/serializer连到该真实oldbackend producer（auth/transport仅可明确owned seam），而非自己造一个拒绝flag的helper。reconnect-before-send在首个meeting.start的实际async准备完成和最终send之前注入连接替换（gUM尚未调用），观察旧/新两个backend该失败操作新增Start/mutation/clear/lease均0、gUM无调用；fresh observation后仍需显式Begin。后续gUM等待/活跃期间断线另按T08/T09亲核tracks停止/迟到cleanup、无新admission，不伪称此前gUM从未调用。same-current positive须实际Start只到观测backend、actualmatching q1ACK才推进credit，且旧noACK仍不挂等待。不跑真实token/个人配置/麦克风来伪批准。

真正时钟加速只用tests seam，不更改productbudget。真实longaudio资源样本必须在root批准的owned预算内，测试取消/cleanup失败同样阻断，禁止用更多whole-repo绿色数字淹掉实际红。

## 4. 实施进度与gate纪律

D0：本设计者全文spec/plan/report冻结→root非作者完整read+原DoD/source/limits核→明确正式合同APPROVE后允许编码。设计者不自批准。root若更改数字/字段/architecture，必须重冻结实际全文/哈希，不只口头标题。

D1：实现者实际红→绿与范围manifest，分层machine/probe、oldfails/setup全保；必要共享affected/build/lockedARM适应实际paths。没有stage/push/合/close授权则不做。source/sharedfile真实merge，不wholeoverwrite其它leaf。

D2：真正非作者实际源码/producer/两端链路复审；原要求Grok+DeepSeek真实允许入口和身份完整EOF/verdict。原named要求不会被GLM驱动Claude冒名替代；当前weekdayPi禁，不以availability自创审批。此设计阶段不启动模型。root如何安排后续真实namedjudges需如实获得允许，不靠旧票审批。

D3：实际最终exactsourcefreeze +真实两端browser/一本机模型门禁 + exactPRhead所有CI、授权合并、exactmainCI与root原494验收后才能关票。raw失败/limits保留，pending机器/截断报告/native未执行都不是通过。#492已完成不重开，476/480不借queue顺带新设计开发。

当前完成：只D0作者R2设计修订及机械一致性准备；R1 P1待真正非作者增量复审，不能由作者判resolved/APPROVE；全部产品实现/T01newGREEN/T16/models/CI都PENDING。没有任何“完成”checkbox因本plan而自动打勾。
