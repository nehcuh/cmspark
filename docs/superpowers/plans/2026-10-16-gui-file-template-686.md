# GitHub #686 — Windows GUI file-template 实施计划候选

GitHub: #686 (https://github.com/nehcuh/cmspark/issues/686) · Parent #70

**HOLD: CONTRACT ONLY. 不执行下列编码/测试步骤，直到 root 正式非作者合同批准并真正 followup 启动。**

对应 spec: `../specs/2026-10-16-gui-file-template-686.md`。baseline243109；当前仅两份新文档，原PR684/652/609工作树和产品源码不动。根已选择候选A便于起草，不代表本spec/plan已经通过。

## 1. 已查事实与有限决定

真实 source 当前非空templates拒绝、host_app launch-only、L0engine只[]；host_cli已有，不能作为本票实现。原owner决策是所有带参都L2、危险原第二因素、L0 threadtrust例外不遗传。原generic forceConfirm会被fullcruise清除，必须行动感知的硬地板。原SecurityPolicy validate成功消费单次token，因此危险模板不能消费后await再validate同token。

仅一个目标profile：pinned官方NPP8.9.8.1 x64 portable exeSHA c52c9ed…，固定4literal+1file；配置保留owner已登记exe，不安装/新增app。真实目标parser和后续文件splitter已读；真实doOpen的session/workspace扩展旁路已保留，不能忽略。root选A：portable-local marker、cloud choice不存在、bounded现有config metadata扩展检查，不创建profile/新settingsDir。

spec中1template/1slot/5argv、id32/name80、path259UTF16/config64KiB/file1MiB/template4KiB均是冻结的**待批准候选**，带来源与rationale；不能编码时悄悄择值。目标文件不读正文，不假验证UTF8或OS只读沙箱；config自身只支持UTF8/可选BOM的无DTD有限解析。不泛化到其它版本/任意GUIexe。

## 2. 单次源门禁前的任务划分

### A. 先保真实旧RED，再建封闭准备语义

1. 启动时先亲核实际最新main、精确公共tree、已有工作树diff、原spec/plan批准哈希；若main前进，只窄组合保留其它已交付delta，不整文件覆盖。选择干净可复用managed worktree；本合同owned clone不因方便变成用户liveconfig。
2. 永久回归先调用真实 `validateAppEntry` 与 canonical Zod/catalog/gate：配置非空template和run_template在旧source实际不支持。保原source、完整TAP/exit。schema-only RED不替代vertical RED；没有新feature的代码前不能宣称功能机器已绿。
3. 增加最小profile/prepare模块：无自由regex/token拼接；严格exact模板形状及allowedfields、1slot、profile身份与文件路径/budget；owner risk只state-changing/dangerous。复用已有结构guard、保守mixedidentity、policycap和sanitize行为；勿把所有App未知metadata改成不兼容硬拒。
4. 纯argv与canonical operation构造只一处，返回deep immutable值；不复用旧L0有await probe之后才spawn的路径绕过最后fence。先写accepted中文/空格/零byte文件、边界以及unknown/污染/过限/quote/response/flag/URL/ADS/reparse负控，真实old→new有因果，不镜像手搓假payload。

### B. 真实file/profile只读准入

1. 现存local portable marker+config+cloud absence的路径均从已登记canonical exe派生，不能让模型给metadata读取路径。真实系统ProgramFiles路径保守排除，不能在POSIX用字符串假装证明Windowslayout。
2. 有界读取config（先size再boundedread，增长/换inode/partial/encoding/DTD/重复/未知结构失败关闭），不写文件或follow cloud path。解析只取两个相关设置；旧sessionExt/workspaceExt=.txt的实际源等价反例必须拒，正常不相等accepted。原真实source触发的歧义不是说所有profile活动必须沙箱化。
3. 文件original/canonical/type/identity/locality/reparse/size每await后和最终重查；保持空格/中文原值不trim/替换，不读目标正文。Windows真实路径判定后留actualraw，不把POSIX mock当Windows正控。
4. 对exe实际SHA/profileconfig/file身份变化，记录所见stale reason，不更新/修复配置。不得用same-user Q4残余否认已观测的pending变化；也不得承诺能看见所有externalfilesystemABA。相关副作用/日志至少验证0目标正文读取/0配置写/0native child（惰性Node阶段）。

### C. L2/binding/第二因素纵向接线

1. 在实际request firstawait以前安装subject watcher，包含完整selectedtemplate/risk/profile规则，finally退订；当前app事件变化永久latch，owner全局/删除/禁用/替换/ABA和unrelatedsibling均实际producer控。把新增模板authority纳入相关既有grant subject；不要恢复旧wholeentries或误删sibling。
2. strict action discriminator只给run_template新字段；更新canonical catalog/index和真实gate/executor。gate末端显式template-never-skip，逐个覆盖auto/ai-trust/manual/god/fullcruise/enterprise/直接token/preauthorized路径。既有L0行为countercontrols必须绿。
3. Preview的full字段、binding、最终spawn必须来自同一canonical operation；fullescapedplain预览不截断。接口不能要求模型自行生成私有snapshot或approval；用既有host execution options关联同请求的真实interactiveapproval，false/absent直接拒。若必须新持续approvalmap/authority，先向root报具体合同差异，不先写通用grant框架。
4. 原单次token只在最终fence消费一次。危险模板在最终executor走原origin-bound requireAppsBiometric后，再复验同operation/subject/abort。取消不得noncefallback，Hello unavailable才nonce，任何失败零spawn；禁止把同一个已消费token当复验API。重放/并发只能一次spawn。
5. 所有import/probe/fileI/O/Hello await先完成；最后sync current/latch/metadata/token/receipt check→精确canonicalexe+5argv spawn之间无await。原L0[]/AUMID/mac/host_cli不得旁路到template branch。保持原L0launch evidence，不虚报“文件已经展示”。

### D. 可见性与日志

只读AppsPanel/extension type显示模板name/id/risk/profile/错误原因；不新增ownerconfig编辑器/mastertoggle。模型索引沿用app总20/name80scrub，只列可用templateID/risk，不塞exe/metadata正文/私有路径。确认中心逐项展示完整argv，危险第二因素明确独立，模板不提供trust勾选。审计/历史真实核其payload，不新增路径/正文/nonce泄漏；既有trace残余不得被报告成“全局零日志”。

## 3. 永久反例矩阵（不是本轮已执行结果）

- config/schema: absent/[]向后兼容，非空oldRED；empty/duplicateid、badprofile/argvliteral/order/extras、cli/aumid/bundle/vault/lolbin/mixed身份、风险降级、污染与每bound±1。
- filepath: 空白/中文空格正控；引号/控制符/%/!/response/flags/UNC/device/ADS/mappednetwork/reparse/目录/不存在/消失/身份变/超size/259与260；目标正文read-trap保持0。
- profile: marker不存在/reparse、ProgramFiles/layout不明、cloud存在、configmissing/size64KiB+1/growth/encoding/DTD/duplicates/sessionalias/workspacealias；正常其它设置不是全部禁止。
- actualgate: auto/ai-trusted/manual × skip旗组合、callerstoken/不同app/template/argv/risk/currenteventABA、approvedlate/disconnect/abort；模板每次1interactiveL2、取消0spawn，L0countercontrol仍按原策略。
- actualexecutor: ordinaryapprove≠Hello；dangeroussuccess/unavailable→nonce/cancelnofallback/error/missingorigin。每个await处currentmutation/alias及finallyresource控制、singleusetoken/同token并发/无关sibling保留。
- UI真实component/confirmationprojection: readonly列表/escaped恶意name/完整大于1200预览/无trustcheckbox；确认批准的canonicalargv==final数组。
- targetparser Windows: Node真实argvreceiver记录原始5items；同精确NPP发布target的空格/中文路径解析和四固定flag，oldsession/workspacealias反例拒不执行。不能仅在另一个echoexe绿后说自定义NPPparser安全。

## 4. 分组机器/独立/模型/交付

功能全部冻source后，同module/risk共享一轮必要host backend/frontend实际producers/TSC/build/freshlockedARM；product/testfixture输入精确SHA，平台skip逐条诚实，不逐票重复整仓。真正非作者独立对抗读同完整diff+所有实际失败/纠正/raw，再完整Kimi/用户现配置Claude等所需模型门禁；保持normalcompaction允许，actualinput/identity/EOF/自然exit原件可核。工作日禁Pi/no--model/defaultconfigs更换。

hostedWindows实跑exact target/路径与argv/nativehelper，严格原安全负控；ownedfixture只处理自己PID/目录，不杀用户App、不在本机启动浏览器/GUI。是否需要额外Windows步骤由实际freeze确定，但无Windows不能伪造native绿。Hello物理验收与软件nonce/接线证据分开记录，缺硬件不冒真人通过；任何必需原生测试红不能通过skip/retry/扩deadline取得通过。

源门禁过后才显式精确source stage/commit/push PR `Closes #686`、`Refs #70`；每个新head所有CI真实绿后才已授权matchheadmerge，随后精确main所有jobs/tree/sourcehash与真实close入tracker。T3 floor 不因用户总授权合并而省略。不能关闭#70整票、改CLI/gallery或默默覆盖684/652/609的独立修改。

## 5. 当前交付与停止条件

本轮交付：这两份文档、原Issue-first真实receipt、source/primary identity与读取范围哈希、候选A/B及root选A记录、doc-onlydiff/proof/report/safeindex。**当前所有实施步骤均NOT_RUN；没有token/人类批准/native/CLI/source gate claim。**

root必须真正非作者读完并形成正式合同APPROVE后，另一次真实followup才开始代码。若REQUEST_CHANGES，保留原版、只窄修改合同并重读增量；不要把“可起草A”当实现授权。遇到新authority或不能闭合的目标parser问题先报告实证，普通已批准实现bugfix不循环新spec。
