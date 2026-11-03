# #826 macOS有限关闭与查询观察：实施交接

作者root，base0666fc8d。两设计及ROOT_REMOVED小增量均经过非作者实际实验与实际GLM设计APPROVE才实施。仅manifest六路径；Windows12路径另单位。未stage/commit/push/CI。

## 行为

原OwnedWorkspaceUI705的closeClock476为唯一250ms桶原点，上限240。新增9点各至多尝试一次：1构造/setup结束，2/3原xcode spawn调用前后，4原native exit callback已观察，5complete rejection，6首次cancel请求，7xcode exit，8xcode close，9原rmSync成功返回后/原settled之前。每点只存固定编号/桶/是否已请求cancel/闭集退出类别，失败第一次不由后尝试改写。exit只记录，不写原close/退出码/invalid等权威字段。无新文件、读取、worker、watcher、poll或时间预算。

在原failure和已存在post-close callback各投影一次有限timeline。原最终query-result输出槽读取当时内存query facts与timeline，包括若已发生的ROOT_REMOVED；仅候选JSON<=1024才附，过大或sink失败保原value。缺失是未知，ROOT_REMOVED只证明合法退场先于这次投影，不认定查询读路径顺序或0666原因。

原result705AfterActualClose只向原emit额外传可选第二参数，原Result705Projection对象与原拒绝原样保留。原owner wrapper收集facts，外部旧单参callback不变。每query阶段1/2至多一行9列：stage、原process/stream error布尔、code0..255或-1、signal enum(0 none/1 TERM/2 KILL/3 other)、两EOF、两输出字节数(各夹到1048577)、原limited标志（可由字节或共享截止触发）。无SDK新schema、raw错误/路径/标题/nonce/PID/环境。原5秒/两次query/1MiB流限额、所有拒绝保持。

全部实施是OBS826插入块，精确逆转后两个完整source逐字恢复0666；新inverse先于旧476/788/782全源权威，旧历史SHA、所有原业务/45秒/权限/cleanup/Swift保持。新inverse固定当前/原SHA与block数，LF/CRLF输出保持且拒篡改/重复/追加。

## 机器结果

Node22.23.4，Companion工作目录，官方隔离runner。

- 当前完整工程 `npx tsc -p tsconfig.test.json` PASS，覆盖A最终Windows12与本单位。/tmp/cmspark-826-build-mac-types-final.log。
- 新6项定向 PASS/0FAIL/0SKIP：/tmp/cmspark-826-mac-targeted-final.log。真实AST owner/start/close及原completion，exit不能替close、原其它资格拒绝；first-once/clock失败/copy/上限；真实Node非0/stderr/ENOENT/signal/overflow/stream error与{}非法SDK负控；真实record两阶段9列/去重/隐私；实际最终callback新鲜内存/1024与sink失败回退原值；原cleanup尾段rm失败/cleanup拒绝/观察异常及主错；精确全源逆转。
- 相关旧族92项在当前同helper/readset通过：/tmp/cmspark-826-mac-family-final.log。该次batch总96PASS/1FAIL，其中唯一失败是新增VM返回值与JSON解码值的跨realm原型比较；仅修该新harness为按实际JSON语义完整比较，后重跑新6全过。没有删原断言/重置pin或把这次harness失败当产品缺陷。旧未改族结果复用，原日志保留。
- Windows新entry standalone types、JS182/workflow119另见A报告；所有平台的真实UI/新预算构建验收仍待精确head CI。

源已冻结：/tmp/cmspark-826-mac-observation-source-manifest.json。待B非作者完整增量→实际GLM源码门；不能依据本机绿发布。
