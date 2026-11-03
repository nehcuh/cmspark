# #826 Windows build/runtime + Mac finite observation — actual GLM design gate

- Unit1 Windows CPU build/runtime separation: **APPROVE**.
- Unit2 Mac finite close/exit/query observation: **APPROVE**.
- Base `0666fc8d066ec6a0941c5edec865063a30692cf9`; no implementation diff existed.
- Explicit measurement-contract change: Windows new CPU compilation moves from20s inside30s test to existing checked testFixtures build120s;30s then measures runtime only. The old end-to-end total bound changes. Root recorded the responsible-owner decision under the user's standard autonomous workflow; this is not literal user approval of120s. MCP20s/exe6s/all product business/rights/cleanup remain.
- Prompt SHA256 `29137f435b1ae73b9f23a6973e346abac8e603aa858bcad94f6bb79ba604b9c0`; 275119 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, provider host `open.bigmodel.cn`, exit `0`, is_error false, one tool-free turn; duration `74238ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 69268, "outputTokens": 5074, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.47319, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Implementation only is approved. Machine, independent-source, actual-source-GLM and exact-head Windows/Mac gates remain. No cause/CI/merge/release success is claimed.

## Actual reviewer response (verbatim)

# GLM-Claude 设计复审（两单位独立判定）

## UNIT1 Windows CPU 构建/运行分离 — **APPROVE**

**判定依据（基于具体完整结构，非单纯加时限）：**

1. **合同变更透明且经授权。** 新增 CPU 编译20秒门由本次未发布测试自设，非用户规定的产品/编译 SLA；协调裁决明确记录 20→120、30秒 case 变为不含编译的 runtime 测量、旧端到端总界限不保留，并如实不称用户逐字批准120秒、不认作历史根因。这符合 docs「收敛与交付边界」：三轮后负责人结构重想、改合同先述已证缺口与原 DoD、#723 已有同类先例且要求透明表述。无支持的原始用户需求使该结构选择不可执行。
2. **结构完整可机验。** 独立探针实证：抽出的纯生成器与原 consumer 逐字节一致（16851字节）、模块顶层无 test 注册/无编译器导入；`checked()` 实际拒绝 nonzero、拒绝 error 即使 status0、timeout 恒120000；YAML 两 Windows lane 阶段序9→12→13→14 与 consumer 后置条件实测成立。迁移非影子实现。
3. **交接与拒收闭环。** testFixtures-only 编译一次、失败不发布、缺/源漂移/错平台/错Node/digest 漂移在 spawn 前拒绝、无存在性放行、无现场重编译回退/可选模式/retry；builder120秒失败仍阻断且不再自动加预算。清单只证约定生成输入+受信构建绑定，不伪称数学证明编译——表述诚实。
4. **覆盖保全。** 早期纯控制（source/inverse/EOL/AST）保留且不消费尚不存在产物；两 Windows lane 显式后置执行业务消费者并入 full census 非 skip；Mac/Linux 原真实编译+runtime 不变；全部9排程/UNKNOWN/BigInt/live-descendant 删除/latewrite 断言保留；MCP20秒、exe6秒、权限/清理不变。
5. **750/760 保全方式正确。** 只允许经验证的单一新增 compiled operand，投影回 sealed 历史 oracle 前精确移除该增量，配缺失/重复/替换/错lane/跳过构建负控；sealed hash/fixture 不动——与现有 validateCockpitSteps748 同一纪律。

**实施条件（非 blocker）：** Mac/Linux 上新入口按平台分支保留原 in-test 编译路径，不得因共享命令引入 macOS 消费 Windows manifest；826 原编译失败/cleanup 优先级负控须在 builder 端与消费端等效重建。批准仅为允许实施，其后机器、非作者源码、GLM 源码、精确 head/双 lane CI 及发行门全部保留；不构成 Windows 验收、根因或合并/发布许可。

## UNIT2 Mac 有限 close/exit/query 观察 — **APPROVE**

**判定依据：**

1. **纯观察、不夺权。** 新增 exit 点只填观察字段；现有源码中 `xcodeClosed/xcodeCode` 仅由 close 回调更新，设计明确禁止 exit 写权威字段、额外 notify/settle/kill/wait。close 仍为完成权威；DoD 含 exit-before-close、非0 close、迟/缺 close、全 UI receipts 不得提前 settle 的负控——与 `:342–350` 的 canSettle/complete 现状一致。
2. **有限、同域、first-once。** 复用单一 closeClock476 origin、250ms/240 饱和 bucket、闭合 exit 枚举；每点一次尝试，无效 clock/sink 为 UNKNOWN，重复 cancel 不得回填首次事件；无跨 Node/Swift 钟域相减。
3. **post-close 复用无新等待。** 在既有失败投影与既有 observeXcodeCloseOnce 回调重投影已记录的有限 timeline；标注 cancel 是否已请求，防止取消后 exit0 被误记为原45秒内成功。
4. **query 事实只取现成 capture 变量。** TESTS/DETAILS 闭集阶段、spawn/stream-error、code0..255/UNKNOWN、闭集 signal、EOF、饱和字节计数/overflow；原 TOOL_FAILURE/INVALID_RESULT 拒绝与两次调用 shared5s/CAP1MiB、输出上限逐字保留；无 raw stderr/path/nonce/环境，无重试、无新 SDK shape。原 45 秒、identity/quiescence/observer+xcode close/code0、cleanup/lease 不变。
5. **证据真实。** 探针用 AST 提取的真实 producer 与真实 Node ChildProcess，四类边界三轮12/12 PASS；`{}` 仅作原 parser 分类负控，未手造有效 SDK 返回。原 family 经官方 runner 69 PASS/0/0；初次直跑环境拒绝被如实披露并以原 runner 修正，未升级为产品缺陷。12 控制只证当前 TOOL_FAILURE 诊断判别力丢失，不证 CI 内部实际原因——该边界表述正确。
6. **决策价值成立。** 针对0666（observer close0、xcode 未 close、Cancel 已返回、剩744ms），constructor return/spawn 前后/native exit/xcode exit-close 区间确实区分 setup/UI 阶段与关闭区间消耗；明确拒绝向 FS 通知加 receipt 读取以免加重被调查预算。

**条件：** 批准仅允许实施，随后机器核、独立 source、GLM 源码门与下一次目的明确的新 head Mac 实际45秒门；更丰富的失败只算诊断进展，非 Mac 通过、根因、验收或发布许可。任何缺失/无效观察保持 UNKNOWN。

**总评：** 两单位均为边界清晰、负控完备、权威保全的最小结构方案；测量边界变更（UNIT1）已按仓规由负责人记录。均 APPROVE。
