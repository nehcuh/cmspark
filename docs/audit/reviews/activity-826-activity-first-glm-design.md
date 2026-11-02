# #826 Activity-first + completed probe retirement — actual GLM design gate

- UnitA Activity-first exact schedule migration: **APPROVE**.
- UnitB completed noninformative MCP probe retirement: **APPROVE**.
- Base `f3edcae61c88acfe7e58e6449b24c1fe8792f626`; not implemented at review time.
- Prompt SHA256 `d4f0d247928712ad3e83d0b6572a56acbdf25177d2b53ad4b3f082383faac6dd`; 322925 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, host `open.bigmodel.cn`, exit0/is_error false, one tool-free turn; duration `138852ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 83362, "outputTokens": 10022, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.66736, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Native-lane UI/input history intentionally changes; this is not old desktop-schedule equivalence or a MCP fix. Condition-filtered census executable step-object prefix remains exact by actual controls; no globally cold-OS claim.
- Exact projector must precede750/760 and direct NSIS consumers; sealed constraints/hashes stay. Verify direct760 raw-YAML callsites also use the projector. Both original MCP20s and whole-job failure remain.
- Retirement restores Release rawSHA484078da… and759 rawSHA468818a…; no new probe, canonical/source/CPU changes or repeated diagnostic dispatch. Historical receipts remain archived.
- Only implementation is approved; machine/independent/sourceGLM/exact-head and mainCI/platform/release gates remain. No Windows proof, MCP attribution, merge or release approval.

## Actual reviewer response (verbatim)

# 独立设计评审(GLM)

## UNITA Activity-first 精确调度迁移:APPROVE

1. **位置与依赖闭合成立**。新位置紧随 `Compile native desktop acceptance tests (#480)`、先于 bootstrap/MCP。Activity 全部前置(原生 tsc 全量编译、`stage:win-scripts` 已复制一方 `.ps1` 且有源回退、UIA DLL 与原生 fixture 构建、npm ci 提供的 typescript/node-notifier)均在该位置之前完成;反向路径中 bootstrap/MCP/interaction 自建数据根、能力注册与生命周期,不读取 Activity 文件/画像/候选状态,重复共享编译保留。本地官方 runner 五文件实跑 28 例=24 PASS+4 SKIP,与“9 选中非 9 GUI+19 新源控”算术一致,且明确不冒充 Windows 证明,符合“不以模型/CPU 充当原生证据”。

2. **精确性**。条件 `windows-latest&&native`、bash、`CMSPARK_ACTIVITY_NATIVE_758`、默认失败策略与三旧操作数顺序不变,仅追加两个当前源控文件;无 always/continue-on-error/timeout/权限/车道变更。31 个负例(缺/重/替任一新旧操作数、错车道、错 env/failure、置于编译前或 MCP 后、MCP/interaction/census 删除或豁免、未知插步、共享编译删除)在 LF/CRLF 下全被拒;四矩阵默认失败/取消语义保持任一原门失败即整作业失败,两处 MCP20 门未动。

3. **消费者迁移合规且同构于仓库惯例**。projector 先完整校验新对象与其唯一 compile→Activity→bootstrap 邻接,再仅移除两个新操作数、放回原共享编译位置供封存 750/760 断言;封存 baseline/supplement/fixtures 与全部哈希不变、不删不刷封存。这与既有“先验精确 delta 再归一”模式(#825 操作数、CPU825_OPERAND、794/806/650)同构,非任意 interleaving/步骤名剥离/命令归一;直接 NSIS 消费者 `censusStepsWithReviewedFirstEvidence723` 已被明确纳入并被证明会拒绝未审候选。

4. **边界诚实**。明确此改变 native 车道 UI/输入史,非旧桌面等价调度、非 MCP 修复/因果;census 条件过滤前缀逐字节不变(实测打印前缀一致),不做全局冷启动断言;未发现“MCP 必须首个 UI”的既有要求,四原生组相对次序保留,760 的连续性钉按该唯一对象显式迁移。

**非阻塞实现门**:须核实 `native-ci-stages-760.test.mjs` 若直接对原始 ci.yml 调用 collapse 也经同一 projector;三个已识别消费者之外的加载点由机器检查兜底。758 提交 OS toast 未声明已消除,属既有行为移位;若致后续 MCP 失败,按原语义整作业失败,不得新增清理或放宽。

## UNITB 一次性 60s MCP 路由退役:APPROVE

1. **精确还原**。逆向仅删除 dispatch 输入、package 排除条件、专属 job、两私有脚本与单元,以及 759 的两行注释并把 setup-node 计数 3→2;release.yml 与 759 的 SHA256 分别精确命中 `484078da…`/`468818a…`,与独立推导的 67c5 目标哈希一致,即返回已知良好原始字节,而非新近似的发布流;preflight/package/publish/tag/权限与 Node22 钉随之原样返回。

2. **无残留调用者**。在 `.github`、`scripts`、`companion/scripts|src|tests`(排除两删除文件与 node_modules/.test-dist/dist/.git)对三个标识符的运行时引用搜索为空;历史文档/测量/评审回执仅作归档证据保留,活跃描述改为已归档。759 回调经 AST 提取真实执行:原配对与退役配对通过,3/2 错配拒绝,ci.yml/release.yml 脆弱运行时变异仍拒,canonical MCP20、snapshot20/18.5 采样、CPU 驱动/工件/运行时及其测试未动。

3. **范围克制**。测量已完成且 7.964s≤20s 非区分性,保留 60s 休眠入口无剩余授权测量需求,删除是更小的最终行为;不新增探针、不扩大 MCP 诊断;生产字节不变故不为发布重派发,既有三平台正常构建结果仅在完全相同输入范围内复用,最终 tag 工作流仍重建并校验全部资产。

4. **门与边界**。本次批准仅授权实现及后续机器/独立/sourceGLM/exact-head 规范门;合并与发布仍需 exact-head 与 main CI 绿;不预支 Windows 结果、不重置历史迭代计数、不做一般发布重设计。

## 结论

UNITA:APPROVE;UNITB:APPROVE。二者均按上述限定条件放行至实现与其后规范门,不构成即时 CI/原生验收/合并/发布批准。
