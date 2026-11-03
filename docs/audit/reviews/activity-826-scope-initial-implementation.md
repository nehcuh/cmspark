# #826 scope INITIAL 有限观察实施交接

作者root，base64dbdaaf，实际B设计和GLM设计APPROVE后实施。仅四个manifest路径；不包含A并行compiler脚本、本机hostpin或root归档文档。

C#沿用#758 Observe/Record模式，18个固定phase名，每点至多尝试一次，wx pending→rename，写入异常吞掉。所有payload只有实际producer的phase与sameSta。只初始主窗记录SourceInitialized/Loaded/ContentRendered、原Activate和Focus返回值（以TRUE/FALSE闭集名编码）、IsReady曾到达的八种返回路径、ready写成后标志、原Run入口/返回。InitialReady停止后续资格观察，不压掉ReadyWritten；popup原行为与轮询/事件调度不变。RUN_ENTER在原Show返回后、原app.Run前，不声称统一相位顺序。

IsReady展开原七个短路资格，顺序/查询次数/真值保持；不新增GetForegroundWindow、focus getter或Activate/Focus请求。观察不是ready或截图授权，不改变原180秒/10秒、业务断言、control命令与surface lease。

新Node reader只读取18个固定文件，schema严格phase/sameSta二字段；missing/partial/foreign省略，空集UNKNOWN，非空OBSERVED。结果只是曾遇事件/分支，不是最后状态，不由缺失推否定。原native finally在child close之后、rm和lease之前投影；异常catch不盖主错或跳过清理。生产/其它fixture/workflow未改。

机器：Node22.23.4，`npx tsc -p tsconfig.test.json` exit0（/tmp/cmspark-826-scope-initial-types.log）；官方隔离runner `node scripts/run-tests.mjs .test-dist/tests/activity-scope825-readiness.test.js` 8PASS/0FAIL/0SKIP（/tmp/cmspark-826-scope-initial-tests.log）。原4真实C# gate/event控制保留；新控制128组合与记录的64db原guard比返回值和Handle/foreground/focus查询次数，正常/抛错观察均一致。实际C# Observe body及匿名producer表达式被执行，payload与实际Path.Combine目标喂reader，once/失败inert/initial-only/ReadyWritten先后/schema负例/pending不入投影通过。实际native finally的LF/CRLF输入归一后执行验证close→projection→rm→lease（不单独证明raw CRLF抽取），投影抛错仍保原primary。Windows C#编译/实际相位未验，须B源码→GLM源码→有目的CI。

源码已冻结，manifest /tmp/cmspark-826-scope-initial-source-manifest.json。未stage/commit/push/CI。无历史根因/正式发布声明。
