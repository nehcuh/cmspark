# #826 Activity-first + completed probe retirement — actual GLM source gate

- UnitA strict current Activity-first schedule: **APPROVE**.
- UnitB completed MCP probe retirement: **APPROVE**.
- Base `f3edcae61c88acfe7e58e6449b24c1fe8792f626`;9paths=7completepresentfiles+2deletions.
- Manifest SHA256 `fa58e0af1753e28bf7a9fc5cb26cad545fc6c9d9a7bf422785f083dd18721ce2`; full9pathdiff SHA256 `573fce2a4a4329125ad4ae867b954291fb8e08f27ed619154c13858466616238`.
- Prompt SHA256 `c15cc83d81a20bd9a33e294eb2bce7f5226f5c0908822ab97d2fce3478ef945b`; 370935 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, host `open.bigmodel.cn`, exit0/is_error false, one tool-free turn; duration `130621ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 94976, "outputTokens": 10430, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.73563, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Complete7source/full9diff and unchanged core/seals reviewed. TAP mechanical projections preserve all case names/results/failures/footer with rawhash lineage. T0docs attached separately from9codehash and reviewed as truthful.
- Actual current750/directNSIS/raw760 mustacceptnewfiveoperandfrontform and rejectcompleteoldf3form; historicalhelper acceptance is not currentingress. BothoriginalMCP20/alljobfail/censusprefix stay; nativeUI/inputhistory intentionally changes, notMCPfix.
- Release/759raw67restored,2probe filesabsent/nocallers,historyarchived; no newprobe. Permission only frozenunitcommit+nextpurposefulexactheadCI aftercoordgates; no nativeacceptance/causality/merge/release approved.

## Actual reviewer response (verbatim)

# 独立源码评审(GLM-Claude source gate)

证据基础:9 路径冻结清单、含 2 处删除的完整 base-f3 统一 diff、7 个当前完整源文件、未动核心/封存约束全文、176/9/6 三组机器与独立日志(附 raw SHA/字节的机械投影谱系)、T0 文档与负责人裁决。diff 与所给当前源逐段一致;清单 base/current 哈希及两删除文件 base 哈希完整闭合。

## UnitA:Activity-first 精确调度迁移 — **APPROVE**

1. **调度最小性有字节级证明**。final-controls 的机械逆变换仅剥离移动块内两个精确操作数并把块放回共享编译之后,所得 SHA256 精确命中 f3 的 `78df6f35…`;即 ci.yml 相对基线只有这一处移动+两个已审源控参数,原条件 `windows-latest && native`、bash、`CMSPARK_ACTIVITY_NATIVE_758`、无 timeout/COE、注释及其余全部字节不变。

2. **`projectActivityFirst826` 满足关键的"先当前、后历史"次序**。它先以严格 deepEqual 要求唯一、恰含 name/if/shell/env/run 五键的当前对象,run 为固定顺序的五个精确操作数；缺/重/替任一操作数、新增键(timeout、COE)、删改 env、改条件均使比较失败。继而要求 build→compile→Activity→bootstrap→interaction 五名各出现一次且位置严格连续,拒绝插步、换位、重复与 bootstrap 后置。仅在此之后才克隆生成三操作数 legacy 对象插回唯一共享编译之后;已投影的历史整形因五操作数 deepEqual 失败而被显式拒绝,不存在历史快路径、运行时标记或步骤名/命令泛归一化。

3. **三条当前入口全部前置严格投影**。750 全量校验改为 `collapseNativeStages760(projectActivityFirst826(...))`;直接 NSIS `censusStepsWithReviewedFirstEvidence723` 先投影再入历史 helper;760 raw loader 在返回原始当前 steps 前调用投影断言当前形状。独立 6 项入口控制实测三入口接受当前新形、拒绝完整 f3 旧形(LF/CRLF)。`validateCockpitSteps748` 仅在隔离中接受其历史 fixture;新测试同时证明该历史 helper 接受旧对象而当前 NSIS 入口拒绝同一来源——不构成当前验收绕过。

4. **原语义保全**。census 车道条件过滤后的 MCP 前可执行前缀与 f3 逐对象相同(新步骤 native-only 被滤除,且旧位置本在 bootstrap 之后);raw 五阶段失败模型证明 Activity 失败阻断 bootstrap/interaction、任何失败不转化为作业成功;原 151 项测试全保留,新增 25 项覆盖五操作数×缺/重/替、重复步骤、env 三态、always()、timeout、移位、未知插步;760 核心合同、封存 baseline/supplement/758 fixture 逐字未动;重复共享编译、双 MCP20(含 CPU825 操作数钉)、interaction、census、整作业失败负例均在。本变更被如实界定为 native 车道 UI/输入历史的改变,非旧桌面等价或 MCP 因果/修复证明。

## UnitB:已完成一次性探针退役 — **APPROVE**

1. **字节精确还原**。release.yml 现值 `484078da…`、759 现值 `468818a…` 均等于删除前测试内记录、并经 `git show 67c5e209` 独立逐字节比对的原始对象;diff 仅删 dispatch 输入、package 排除 if、专属 job、两私有文件,以及 759 两行注释与计数 3→2,与恢复后 setup-node 2 处 22.23.4 清单自洽;tag/依赖/权限/发布行为回到已知良好原状。

2. **无残留调用者**。两删除文件的 base 哈希真实;对三个标识符在 `.github`/`scripts`/`companion` 代码目录与各 package 清单的搜索为零;canonical MCP20、snapshot20、CPU 驱动/工件/运行时及六个冻结 Activity 文件逐字节未动;无新探针、无打包重派发。已完成的 7.964s 非判别结果仅作归档事实。

3. **T0 文档(在 9 代码哈希之外)如实陈述**:测量已归档且入口退役、Release/Node 清单逐字恢复、native 车道输入历史改变并链接负责人裁决、census 前缀逐对象相同、0.8.0 尚未正式发布、最终 tag 工作流仍重建并验证全部资产、预演复用仅限相同生产输入。

## 结论

UnitA:**APPROVE**;UnitB:**APPROVE**。二者均为源码门批准:不预支下一 changed-head 的真实 Windows/Activity 结果,不作 MCP 根因或修复声明,不重置历史轮数;合并与发布仍需精确 head、main CI 绿及各自后续规范门。
