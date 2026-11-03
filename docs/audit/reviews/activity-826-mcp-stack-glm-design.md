# MCP post-timeout stack experiment — GLM design gate

Verdict: **APPROVE — design only**. No implementation, dispatch, canonical acceptance, merge or release approval.

- Reviewed base: `c5776f1d54a7d4b920e6c5bfde45691496b947f8`; no implementation diff exists.
- Prompt SHA256: `30376370c4a074c0525c9a6bd4fe97c2b40ccec376ec513daea2c2bcb2435ac3` (156199 bytes).
- Actual reviewer: Claude CLI `2.1.153`, provider host `open.bigmodel.cn`, requested/actual sole model `glm-5.3`.
- Process exit: `0`; status `success`; duration `125259 ms`; actual modelUsage input/output `37969`/`7082`. Tools/hooks/MCP disabled by safe wrapper.
- Original canonical MCP 20s, business and cleanup statements remain design constraints. Declared extra query/tool budgets are up to 15s in a separate NON_ACCEPTANCE diagnostic tail. Actual Windows/tool execution remains pending.
- Input included complete relevant source and report/control bodies; historical scaffold is context, not current runtime approval. Hash bindings are in the JSON receipt.

## Coordinator factual correction

Reviewer wording correction: the residual-limit paragraph abbreviates the post-timeout tail as about 3s+6s. The supplied design actually permits one query up to 3s plus at most two sequential CDB children up to 6s each, hence up to 15s in declared query/tool budgets (native-tool failure skips browser, at most 9s). This is an explicit NON_ACCEPTANCE diagnostic tail, not the unchanged canonical 20s cleanup cost. No extra API was used to correct this arithmetic omission.

## Actual model response (verbatim)

**结论:APPROVE(批准最终混合模式设计进入实现与其后的独立 source gate;本批准不包含 dispatch、不构成验收、不重置既有三轮历史、不构成对任何产品修复的认可)。**

## 判定依据

**1. 触发门与信号别名正确。** snapshotDeadline 声明位于 withSurface650 之前,该处 `t` 是原始外层 TestContext,其 signal 即真实 20s 测试超时信号;Surface650 传给 action 的 `t.signal` 是 AbortSignal.any 组合租约信号,不能作超时判定——设计选择别名外层信号是对的。控制证据(6 模式)证明:租约中止/普通失败/成功路径 originalSignal 均未 aborted 且零 capture;仅超时路径(originalSignal.aborted && 墙钟≥deadline && child 存活 && 未 settled && snapshot825.binary)触发一次 capture。Node22 abort reason 不编码 failureType 的限制已由实际 TAP 断言覆盖(failureType:'testTimeoutFailure' 仅在超时类出现)。

**2. 混合 -pv/-pvr 与清理链安全。** -pv 仅限精确拥有的 native 克隆;launcher.c 实际 terminate_child 控制证明 alive 目标无论是否 suspended 都经不透明已持有 HANDLE 无条件 TerminateProcess、锁序不变;waiter 的 WaitForSingleObject 不依赖目标 UI 线程运行,故 CDB 失败/超时/被杀、目标残留挂起均不能阻断原始清理。qd 正常分离;native 工具失败即跳过 browser,避免以可能仍暂停的 host 污染 browser 观察;browser 只用 -pvr 不暂停,其不一致栈保持 UNKNOWN,不宣称跨进程原子快照。无 resume、无树杀、无回退调试器、无重试——边界与官方文档语义一致。

**3. 结果不可替换性。** hook 在既有 finally 的 rejectAll/terminate 之前;observerThrows/observerBounded 控制显示原始失败身份与 rejectAll→terminate→channel.close→legacy.close→server.close→snapshot.close→remove→settled 顺序完全保持;诊断 await 单独声明为 NON_ACCEPTANCE 尾部,不得记为原 20s 端到端清理成本,也不能把超时变 PASS;runner 保持非零退出。

**4. 目标识别与信息最小化。** 唯一 live 匹配:精确克隆路径+当前测试 Node 父 PID+创建区间;browser 限唯一直接 msedgewebview2 子进程;缺失/歧义/退出即 UNKNOWN;无 name-only attach、无通用扫描、无命令行枚举、无 caller PID;单一查询≤3s 只投影身份键;采集限两段顺序 CDB 各≤6s、原始流各≤512KiB、无重试。

**5. 预审与符号策略。** MCP 前一次性自有 CPU dummy 于实际安装的 Microsoft 签名 x64 CDB 上产出真实 vendor kc 输出喂给真实解析器,以 IPC ping-pong 证明实际 detach、杀死自有子进程并观察实际退出;资格失败在 MCP 之前停止;伪造 payload 不被接受。符号仅用自有本地缓存、禁 srv/网络;未解析/截断/溢出一律 UNKNOWN/INCOMPLETE,不伪造帧;不 /Zi、不改编译标志。CPU 预审被明确声明为工具交互证明,非全局 OS 状态等同、更非 native 证明——该诚实边界是本设计可信的一部分。

**6. 工作流保守性。** 默认 false 显式布尔入口;探针 job needs 原始 preflight、contents:read、persist-credentials:false;探针模式跳过全部打包/发布(含 tag-ref dispatch);absent/false/tag 路径按既有 truth-table 保序;Canonical 10 checks/main/tag 不变且仍必需;一次性结局后退役临时路由;≤20s PASS/无 capture 记为 NON_DISCRIMINATING 不重复。

## 已接受的残余限制(非阻塞)

- 本地缓存缺符号时整栈可能 UNKNOWN——结果政策已把该结局定价为单次非区分运行并退役,不授权重试或符号网络化。
- hook 内最长约 3s+6s 的 post-timeout 延续在惰性控制中仅以 8ms 时长验证;机制上与时长无关(事件循环待 promise settle),工具子进程自身有界被杀,原始结果已定、owned-HANDLE 清理不依赖目标配合,残余风险被限制在诊断尾部。
- 真实 Windows CDB/detach 语义仍以预审与单次实验为准;预审通过不等于实验必有区分力。

## 实现/source gate 必须落实(设计已含,非新要求)

严格 TS↔compiled 绑定与双插入逆变换、canonical 字节只读、wx 独占 sibling 全路径清理、PID 选择器以惰性事实验证零/多/歧义/退出、真实 dummy 输出驱动截断/噪声/溢出/头行拒绝、native 失败跳 browser 且仍达原始清理、argv 区分 -pv/-pvr、YAML 真值表矩阵全覆盖。结果仅作证据进入独立验证;缺失帧不得推出 SDK bug/main UI 结论或历史成因。

**最终:APPROVE 该最终设计(native 仅 -pv、browser 仅 -pvr、native 工具失败跳过 browser、原始 20s 契约与全部验收门不变)。批准范围限于进入实现及随后独立 source gate;dispatch 仍须待机器与独立非作者 source 审查通过后另行执行,现在不派发。**
