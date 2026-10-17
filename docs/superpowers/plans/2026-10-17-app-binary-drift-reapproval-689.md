# #689 有限实施与验收计划

GitHub: [#689](https://github.com/nehcuh/cmspark/issues/689), parent #70

状态：**合同 R2 已获 root 正式批准实施，当前源码尚待全组门禁和发布。** 原19项旧路径探针只作为合同可行性证据；实现控制、独立审查与原生 CI 结果分别记录，不以合同批准冒充完成。

## 分组前置与源码投影

以届时真实main为base，先精确合入已源码批准的#688/#686依赖并核三方差异，不整文件覆盖 AppsPanel/handlers/types/guiTemplateSubject。当前合同读取 main08e142/tree42e 与 approved Apps33 tree51e；实施前需要 fresh实际交付态。686固定NPP profile/hash/bytes/helper/旧fullpreview/每次L2和危险D2均冻结复用，不能借新pin放开新版模板。

## 一组实现，不分散成每两行一个门禁

1. **永久RED，先冻结旧行为。** 从当前真实validator/router/handler/AppsPanel入口建立惰性FS与真实manager纵向控：没有专用重批准、旧切policy只保留旧pin；以拟新增record的有限fixture亲证旧policy/coordinate/pending subject忽略它，注意这是新状态接线缺口而非现有endpoint漏洞。旧2×12、扩展19与7FS只作合同可行参考，不替代最终永久producer。
2. **局部测量与严格新态。** 新一个apps本地drift测量/状态模块，限定一个登记exe，实行spec的strict6-key record、固定3WS、15s绝对measurement/256MiB/64KiB、BigInt identity与EOF/signer同文件复查。现有apps-signer helper可复用原body/wire，仅TS加strict status解析；若需GetDriveType/reparse固定只读helper，必须先清楚列单独路径，不在任意动态PS源码里拼接路径。没有global scanner、恢复任务、cache或新授权对象。
3. **持久manual与有限旧入口闭合。** types/normalization/handlers加入record；复用当前configEvents request-local latch并扩原grantSubject、addSubject、guiTemplateSubject。record存在时非manualpolicy与coordinate enable拒绝；same-manual/disable/coordinate clear使恢复意图invalidated，重新Check只从当前manual形成新意图。list/preset/current-map/sibling、并发、writer提交前/后异常与stricttrustclear均实际覆盖；合法digest mismatch仅review_again，不能与结构非法pin/policy/schema混淆。当前globaloff/disabled拒绝测量/采用，无record初始measurement失败不写、不伪称manual。
4. **现有socket与D2接线。** ws/validate、message-router、background转发、AppsPanel走同一真实Apps管理链；SessionCallbacks/AppsHandlerContext仅增加server-owned ownerCurrent闭包，来源是实际socket原wsAuth身份。无sender参数可造。使用原requireAppsBiometric及originWs manager，取消不fallback；所有await后/finalsync fence与finally清理。没有LLM/MCP/tool名单变化。L0沿原manual路径，原APP_EXE_DRIFT grade不变。
5. **owner可核对UI。** status只读不测量；Check明确是动作；卡片展示last-known/本次测得hash、原pin、将恢复策略、invalidated需重查、签名和模板支持边界。不显示新私人路径/正文，不把重批准成功说成新版模板受支持或已执行。原AppsPanel既有功能和686参数UI保持。

预计受影响边界（不是允许随意扩路径）：apps/types.ts、handlers.ts及新drift模块/测试；gui-templates.ts仅主体投影；ws/validate.ts、message-router.ts/SessionCallbacks、ws/lifecycle.ts；background/index.ts与AppsPanel.tsx；对应现有协议/DOM测试；必要固定readonlyPS helper及hostedFS test。config writer/biometric/confirmation manager/686files与profile不需要重写。若发现必须改其它authority或超出上述边界，先给实际反例和窄差异，不能泛化。

## 必须的同一producer矩阵

- record缺失/错误6键/非法hex/未知schema/非manual/旧pin不符；readonly0FS0write；无pin/平台/身份不支持；Check真A→B持久manual，旧pin不变，旧policy仅保存一次；重复Check/文件回A不自动恢复。
- real boundedFS：hash一致/变化，256MiB+1在读前拒，0/partial/size/EOF/identity/重parse/链接/同字节换inode、最後deadline过界、fd/stream清理。签名Valid同Subject/NotSigned无Subject正控，其余status/Subject变化/超限/失败拒；cap/user-writable/structural重查。
- set_policy(auto/ai/same-manual)、enabled A→B→A、coordinate alreadytrue/pendingtrue/clear、list/preset/add的旧快照覆盖、mutable alias、模板/identity改回；没有旧恢复意图复活，sibling merge保留。
- Reapprove server重新测old/new、D2、最终同hash/metadata；Hello成功/cancel/unavailable/infra；nonce错误socket/错误码/原lockout；任意await期间断连/失auth/换wsAuth/entry removal/disable/全局关闭/并发两审批；最终无await commit；完整actualwriter+owned disk分别验证prewrite抛仍旧状态、postcommit emit抛已新pin/策略、正常提交后ACK丢失；后两者unknown+显式fresh status，禁止blindrollback/resubmit或复用旧审批。strictclear失败、pending listener0。
- appPolicy restore不超过freshcap；新pin不能重开coordinate bit或复用旧template receipt；改NPP hash/bytes/profile仍被原686files拒，危险模板原额外D2和single-use不变。

## R2 有限纠正与停止点

保留R1全部174artifact和root真实REQUEST_CHANGES/原2case不改。R2只修改spec/plan：撤销“writer任何throw都未写”；明确Check初始失败不造manual悬置、已有manual后提交前失败才保留本请求原态；严格invalid-entry与合法过期digest分开，invalidated重启不复活旧auto；原globalconfig owner opt-in边界不扩。增量非作者审精确两doc及这些actualcontractcases，不重 unrelated整仓/旧模型/native。root批准前禁止产品coding。

## 机器与独立门禁

先focused真实RED→最小修→freeze整组source。一次相关host backend/WS/UI与必要build，freshlockedLinuxARM同源/锁/相关family+UI，真正非作者纵向对抗；复用字节相同的已交付native/profile基线，不逐票整仓。完整Kimi和现配置ClaudeCode实际glm5.3读同全diff/全部FULL报告/原失败纠正/真实raw，身份/内容EOF/自然exit核验。若root另有明确既有named要求再按真实原scope执行，不能把glm冒DeepSeek。

真实Windows CI验证drive/locality/reparse/fileID/hash/actualPS signer与strictwire以及实际schema/router/handler持久writer链（inertowned文件、不启动被测App）。原需人工/硬件的Hello成功/取消/nonce输入单独记实际事实；软件manager controls不是人类。本机继续禁浏览器/GUI/App/PowerShell/编译或执行native。

exacthead所有CI必须绿才已授权merge，精确main全4/tree/SHA/实际子票关闭写tracker，候选Closes689/Refs70。原687/688/686/652门禁/真实失败准确复用，不假整parent70闭票。若任何真实RED/REQUEST_CHANGES，保完整raw只修受影响增量，禁止unchanged重跑、扩deadline/skip/COE/weakening。
