# #826 Windows build/runtime + Mac finite observation — actual GLM source gate

- Unit1 Windows CPU build/runtime separation: **APPROVE**.
- Unit2 Mac nine-point finite close/query observation: **APPROVE**.
- Actual model confirms both B independent source approvals and reports no reachable defect.
- Base `0666fc8d066ec6a0941c5edec865063a30692cf9`.
- Frozen18path manifest SHA256 `648806b2d99cc9e422e0ec6998b94df2823d4a3e126ace4318fee6e33acd07f0`; all18 per-file hashes in structured receipt.
- Complete18path cached source diff SHA256 `a8c2b3ccbb1dcbc97c19edfb5e775db6b4c1d312a272196b0567abdd9c6dafb2`.
- Prompt SHA256 `1fea15b2cb3d32b9764b728cb06a350b97ad9dec4486e29750c7702c265bad4e`; 502394 bytes.
- Input disclosure:16 complete whole-file bodies; two giant legacy files supplied complete affected functions/dependencies, full diffs and whole-file current/base hashes, with exact source-inverse proof and independent98-case family. This was a **complete changed-code and affected-function view**, not all18 whole-file bodies. TAP logs were mechanically projected without dropping case result/name/failure/footer; raw hashes/bytes recorded.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, provider host `open.bigmodel.cn`, process exit0/is_error false, one tool-free turn; duration `165109ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 134605, "outputTokens": 11138, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.9514750000000001, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Measurement boundary is explicitly changed: Windows new CPU20s in-test compilation→existing120s build;30s case runtime-only; old total/E2E enlarged under recorded owner decision. MCP20s/exe6s, all original business/rights/cleanup, Mac/Linux20s/30s unchanged.
- Mac query tuple column9 is the original limited flag, including shared-deadline limitation; not exclusively byte overflow. ROOT_REMOVED is positive history, not query read order/cause. Original45s/5s/2query/caps/close authority remain.
- Permission is frozen-source commit plus one purposeful exact-head platform CI after coordinator gates. No Windows/Mac acceptance, historical cause, merge or release success is claimed.

## Actual reviewer response (verbatim)

# 实际 GLM-Claude 独立源码复审(两单位逐项判定)

审阅范围确认:18 路径缓存 diff、全部新模块完整冻结源、两巨型遗留文件的完整受影响函数视图+全文件 hash、OBS826 精确逆向证明、以及 TAP 投影(附原始 hash/字节)。这是"变更代码+受影响函数"级审阅,与披露一致,不伪称全 18 文件全文逐字喂入。

## UNIT1 Windows CPU 构建/运行分离 — **APPROVE**

依据(源码可验):

1. **纯生成器确为纯**:冻结源中 driver 仅 import assert/desktopMcpFixture/desktopMcpBootstrapObservationFixture773,无 node:test、无 child_process、无顶层执行;826 测试以 `doesNotMatch` 机械断言,AST 断言 builder 全文恰一次调用且在 `testFixtures` 守卫内(`calls===[true]`)。
2. **边界迁移诚实**:runtime 模块 Windows 分支仅 `consumeMcpSnapshotCpu825`,else 分支保留 Mac/Linux 20000ms 编译;编译端 `checked(cl,...,{cwd:root,env,stdio:['ignore',...fds]})` 无 timeout 覆写,沿用 builder `checked` 的 120000ms/error/status 双拒。`timeout:6000` 恰两次、MCP20000ms、原命令顺序/条件均被测试钉住。**旧总/E2E 边界确实扩大**,已按 root 记录透明披露,不冒称用户逐字批准。
3. **产物闭环无放行**:`target825()` 钉 win32/x64/v22.23.4;manifest 严格键集/schema/target/sourceSha256/inputs/binarySha256,源漂移在二进制读取前拒收;`bytes825` 以 BigInt 全字段(named/opened/final)复核 regular/单链/限尺寸;硬链/替换/部分/缺失/JSON 破损负控齐备;编译前先撤销旧 manifest/binary,open/spawn/nonzero/timeout/diagnostic-read/close-only 失败路径均不发布(fds 全关、close-only 仍抛)。Windows 缺失产物经实际分支传播 ENOENT,826 用 `spawnSync(){throw WINDOWS_RUNTIME_MUST_NOT_COMPILE}` 断言无回退编译。
4. **CI/合同消费正确**:ci.yml 仅向 bootstrap/process 步追加一个 compiled operand;760 先整对象整命令精确校验再投影历史;750/760 的 missing/duplicated/substituted/错lane/no-fixtures/先失败/乱序负控在实际日志 119 PASS 全过。TS 入口 Windows 恰一注册 30000ms 非 skip,他平台零注册(node:test 语义下空文件文件级通过),Mac/Linux 原 mjs 路由保留。
5. **等价性证据**:sealed 0666 fixture 由旧真实 method/cppDriver 捕获,八 EOL 组合逐字节等价;9258 字节 runtime 尾逐字一致;本机真实 clang 编译共享 TU 后走完原九排程/BigInt/live-fd/latewrite 全断言。

不构成阻塞:历史 MSVC 物理原因未证(裁决已明示);真实 Windows 构建/双 lane 执行待新 head CI(授权范围内);早期 Windows 交接用受控 compiler 叶并已如实声明不冒充 MSVC 成功。

## UNIT2 Mac 九点有限观察 — **APPROVE**

依据:

1. **九点/首试一次/同钟**:`note826` 先置 `seen826` 再读 `closeClock476`,时钟 NaN/Infinity/-1 或抛错时首试已耗、后续不得回填——测试显式断言"failed first observation is not replaced";同一 250ms/240 饱和桶、闭集退出枚举;返回值为拷贝。九点位置与授权一致(1 构造末、2/3 spawn 前后、4 native exit、5 complete 拒绝、6 首 cancel、7 exit、8 close、9 rm 成功后/settled 前)。
2. **exit 不夺权**:spawnOwned 的 'exit' 监听只调 note826;`xcodeClosed/xcodeCode` 仍仅由 close 回调写;测试用真实 EventEmitter 序列证明 exit 后 settled 仍 false、close 才按原变体结算,原 canSettle/complete/清理权威不变。
3. **ROOT_REMOVED 语义正确**:仅插于 `if(uiClosed){rmSync;observeRootRemoval826();settled()}` 成功返回与 settled 之间;rm 抛错/cleanup 拒绝不可达该点(测试 trace 证明),只证 rm 先于投影的历史,不证 OS 读序或因果。
4. **query 事实与原值保全**:`record826` 只消费既有 capture 变量,阶段去重、code 闭集或 -1、signal 枚举、EOF、字节钳 1048577;**第九列确为原 `limited` 标志(共享截止亦可触发),非专属字节溢出**——OUT/ERR_LIMIT 用第六/七列区分,源码与测试均未误标。emit 仅增可选第二参,原 Result705Projection 与全部拒绝原样;最终回调新鲜内存快照、候选≤1024 否则保原值、facts/timeline 抛错回退原值——三类均被实际测试覆盖。5s/两 API/1MiB/45s/身份/quiescent/cleanup 全保留。
5. **血统可逆**:OBS826 先行剥离后,helper/native 整文件精确恢复 0666(current/prior hash、块数 16/5、LF/CRLF、篡改/追加/缺块拒收),且内嵌于 OBS476_CLOSE 内的 note826(8) 剥离后原样;788 的 476 逆向对非 OBS826 文件在 kind 断言前原样返回,无回归。原混合批次唯一 cross-realm harness 失败已披露并以 JSON 语义比较修正,独立 98 PASS 全族(含 ok 9)取代。

无新增 raw 日志/SDK 形状/worker/poll/read/wait/权限;无原生 UI 激活;纯测试侧。

## 结论

- UNIT1:**APPROVE**。
- UNIT2:**APPROVE**。

未发现任一单位存在可达缺陷。本批准授权范围:冻结源提交+协调门后一次目的明确的精确 head 双平台 CI;不构成 Windows/Mac 验收、历史归因、merge 或 release 许可。新 CI 中构建/运行失败保持失败,不得自动扩时、skip 或回退。
