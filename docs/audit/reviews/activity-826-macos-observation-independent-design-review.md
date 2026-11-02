# #826 Mac close/query 观察：非作者独立设计复核

2026-11-03，审查 `/tmp/cmspark-826-macos-0666-next-step-design.md`。我是该 Mac 观察单位的非作者；仅读实际 source/现有测试并复跑控制，无 GLM 调用、产品/测试源改动、原生UI运行、CI动作或预算调整。

## 结论

**APPROVE 设计，无可达 blocker。** 当前证据支持一个有限观察单位，尚不支持产品修复或XCTest效率调参。所有提议的 Node 点均有当前失败的决策价值，无需另加UI文件到达采样或删减成只能复述现有close结果的方案。批准只允许按下列 DoD 实施后再经机器、独立source、实际GLM；不代表Mac门通过、根因已知或release批准。

能力边界：test-only Node闭集诊断（T1）；既有明确测试入口及已有owned child/query组成；无新增L2操作/权限/SDK调用/网络；既有UI、日志和结果皆为不可信观察，不能驱动完成/授权；只向原输出槽投影固定数值/枚举。

## 实际 source 与价值

- `workspace-xctest-owned-705.ts:287–295`：现有closeClock476在构造body前初始化，noteClose476用同一Node performance时钟和250ms bucket，饱和240；不读Swift时间。构造返回点可观察原copy/setup成本；xcode spawn前后可界定原start边界，原native退出到xcode exit/close则区分业务完成后的区间。
- 同文件`:309–312`：xcode/observer现已用regular-file fd输出。没有证据支持把这次Mac失败当Windows compiler pipe问题来修。
- 同文件`:310、342–350`：原close回调才更新xcodeClosed并notify；complete/canSettle/cleanup与scene.closure共同要求原真实关闭。新增exit事件只能填观察字段，不能更新这些权威字段或代替close。
- 同文件`:324–340` 及 native workspace callback：已存在一次post-cancel xcode-close回调。重投影这时已记录的Node数值即可观察晚close，无需新wait、watcher或worker。首cancel标记防把终止后的exit0误当原45秒内成功。
- 同文件`:131–166`：现result查询已有shared5s、CAP1MiB/stream、two distinct APIs、error/status/signal/EOF/stderr guard。TOOL_FAILURE吞并多个现成事实；附加这些事实能区分spawn/执行/严格stream拒绝，而不解释或解析SDK内部错误文本。

0666的具体支持路径是：all native receipts、Cancel returned、native exit0、UI receipts31，原deadline时observer已close0、xcode尚未close。新增timeline可区分原setup/UI阶段占时与实际xcode exit/close区间；query事实可区分当前后置TOOL_FAILURE。缺失事件仍UNKNOWN，不能负向证明某阶段未发生。

## 独立机器证据

Node22.23.4，在 `companion/`：

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null
node /tmp/cmspark-826-macos-close-query-probe.cjs
node scripts/run-tests.mjs .test-dist/tests/desktop-workspace-xctest-705.test.js .test-dist/tests/desktop-native-observation-788.test.js
```

- 实际AST提取的query producer，经真实Node ChildProcess的四类边界，三轮 **12/12 PASS**。独立日志 `/tmp/cmspark-826-macos-close-query-independent-agent.log`。nonzero7、exit0+stderr、spawn缺失均为原TOOL_FAILURE；无stderr的exit0+`{}`为INVALID_RESULT。`{}`只作原parser阴性，不是有效SDK假payload；原argv/stdio/真实源hash与bundle身份守卫保留，未启动xcrun/XCTest。
- 原官方runner family **69 PASS / 0 FAIL / 0 SKIP**。日志 `/tmp/cmspark-826-macos-observation-independent-runner.log`。覆盖原exact-bound/quiescent/observer+xcode closure、invalid/partial receipts、single clock、real source inverse、already/late close first-once、post-cancel一次投影、主错误和清理隔离、原timing consumer。
- 最初直接 `node --test` 的同family有1项surface环境拒绝：缺官方preload的CMSPARK_TEST_RUN_DIR/DATA_DIR。核真实native-surface-650与run-tests后改用原runner，原69项全通过；没有修源或把环境错误升级产品缺陷。初次日志 `/tmp/cmspark-826-macos-observation-independent-family.log` 保留可审。

## 实施须满足的精确 DoD

1. **固定同域有限点**：保留原closeClock476 origin、250ms/240饱和边界；只constructor return、xcode spawn enter/return、native exit observed、complete rejection、first cancel、xcode exit/close及原observer close。每点一次尝试；首次无效clock/sink为UNKNOWN，重复cancel不得用较晚时间填成首次事件。异常不得改变原路径；不增加scene/receipt读取或SDK操作。
2. **原authority逐字守恒**：原真实close/identity/quiescence/observer与code guard、wait注册后立即recheck、notify、原native exitResolve、cancel动作/次数和cleanup/lease顺序保持。exit观察不写原xcodeClosed/xcodeCode，不额外notify、settle、kill、wait。验证exit-before-close、非0 close、迟/缺close和全UI receipts仍不能提前settle。
3. **post-close复用**：只在原失败投影与原observeXcodeCloseOnce回调输出同一有限timeline；已有first-once、已关闭/迟close/注册或logger异常继续覆盖。不新建事件等待；post-cancel上下文明确，不能把取消后的exit0记作原测试完成。
4. **query事实保持原拒绝**：TESTS/DETAILS闭集阶段、spawn/stream-error、code0..255或UNKNOWN/category、闭集signal、EOF、饱和byte计数/overflow。全部取实际capture callbacks原变量；原reason/status/nativePassClaim、two calls、shared5s/CAP、完整EOF与空stderr守卫不变。保持原输出字节上限；最大允许投影要机器验证。无raw stderr/path/nonce/环境/异常文本、无重试或新SDK shape。
5. **真实消费者控制**：实际改后AST/VM所需字段/方法显式接线，不能因缺port提前失败造成伪通过。原family继续全通过；new points要真实source-derived first-once/invalid-clock/throwing-sink测试，query沿用实际进程四类对照，并经原capture port覆盖signal/EOF/overflow；clean-capture的parser正/负例复用已有真实schema资产，不手搓有效SDK返回。

保持原workspace45秒、native/权限/业务断言及actual child close。新观察即使更丰富仍只算诊断进展；后续目的明确的新head Mac实际门必须满足原全完成/清理要求。

VERDICT: APPROVE
