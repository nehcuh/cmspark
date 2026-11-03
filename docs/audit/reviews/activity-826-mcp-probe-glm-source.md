# #826 MCP non-acceptance probe — actual GLM source gate

- Verdict **APPROVE**, confirms B source approval including depth-one/no-historical-object correction.
- Base `67c5e209d239995b930fe1dfcc54f444005e44f8`; three exact paths/hashes are in the structured receipt.
- Complete threefile review diff SHA256 `1874d8d472da80b92bbbfd77b1d3ac93cef0e5bf69467004f5503d9b2b292931`.
- Prompt SHA256 `28a888425f43358c1a3678c0c439a9eecced6596b3e7d525d1fb64d89706d6bc`; 85710 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, host `open.bigmodel.cn`, exit0/is_error false, one tool-free turn; duration `94069ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 22261, "outputTokens": 7235, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.29218, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Permission: commit this frozen unit and perform exactly one explicit fresh-WindowsVM NON_ACCEPTANCE measurement after coordinator gates. Not scope source approval, canonical20s acceptance/change, release dry-run credit, historical cause, merge or release approval.
- Minor wording clarification: matching uses exact single-line compiled registration/snapshot strings. Newline bytes elsewhere remain unchanged by inverse; the model's statement must not be read as all compiled CRLF files necessarily failing.

## Actual reviewer response (verbatim)

# #826 MCP 非验收探针 — 独立 SOURCE 复审(GLM-Claude)

**结论:APPROVE。确认 B 的 SOURCE APPROVE(含最新 depth-one 修正后冻结版)，未发现可达阻断项。**

## 一、工作流守恒(与既批设计逐项一致)

- 新增输入为类型化 boolean、default false、非必填，仅进入 `package` 与探针作业两个 if 表达式，不进入任何 run 的 shell 文本；push 事件下 inputs 上下文为空，取反为真，tag push 打包照常。
- `package` 条件三态正确：tag push 真；普通 dispatch(缺省/false)真(原 dry-run 不变)；仅 probe=true 跳过。tag-ref dispatch 且 probe=true 时 package 跳过，`release` 因 `needs: package` 连带跳过(未用 always),其 tag-only if 与 needs 原样，故不打包不发布；tag-ref dispatch=false 保留原 tag-only 发布行为。测试中六态真实解析控制覆盖全部组合。
- preflight 字节未改(解析哈希钉死)。探针作业：needs preflight、独立 windows-latest、`contents: read` 覆盖工作流级写权限、`persist-credentials: false`、锁 22.23.4、复用 npm ci/build、原 `build-desktop-native.mjs --test-fixtures` 与 `tsc -p tsconfig.test.json`,无新工具链/权限。步骤顺序正确：先编译再跑控制测试(后者读取 `.test-dist` 编译产物)。ci.yml byte_equal,十项常规检查未被替换或扩张。

## 二、探针脚本

- 守卫先于任何读取/启动：非 win32、非 GHA、未显式 `CMSPARK_MCP_LATENCY_PROBE_826=1` 即拒。
- TS 源以规范化(CRLF→LF)SHA 钉死；要求编译文件中注册串恰出现一次、60000 变体不存在、`snapshotDeadline825 = Date.now() + 20000;` 恰一次；仅替换注册内 20000→60000 并验证逆等式，其余字节不变；无运行时重编译回退；若编译输出含 CRLF 则匹配失败即 fail-closed。
- 派生件为同目录 CJS 兄弟，`wx`/0600 独占创建，不收养也不删除既有文件；成功、断言失败、AbortError、result.error/signal 各路径均在 finally 删除;`run-tests.mjs` 定向模式可发现(非下划线、`*.test.js`),win32 `--test-concurrency=1` 与 data-dir 预载隔离照旧；session-lock 预构建不触发(未请求该文件)。
- canonical TS/JS 全程只读，外层 finally 字节级复校，漂移即抛;runner 退出码原样透传、非零保留；输出显式 `NON_ACCEPTANCE registrationMs=60000 canonicalMs=20000 snapshotDeadlineMs=20000`。原业务/断言/finally/清理/租约语义完整保留，60s 注册与 `t.signal`→`OWNED_NATIVE_MCP_DEADLINE` 一致延长。

## 三、测试与浅克隆修正

- 五测覆盖：派生唯一性/逆式/快照保留及四组漂移负控；兄弟文件生命周期含 EEXIST 存续与原文件不动；真实官方 runner 的 `__dirname`、相对 require、配置隔离写与盘上读回、磁盘哨兵(子进程去 NODE_TEST_CONTEXT 仅为独立测试骨架边界，不改业务路径)；本地拒绝；YAML 六态与作业结构断言。
- 基线钉改为实际解析作业 JSON 哈希，与独立重算值完全一致(raw `484078…` 及 preflight/package(仅去新 if)/release 三钉，与冻结 base_sha256 吻合)；真实 depth-one 克隆、67c5 对象缺席下 5 PASS/0 FAIL/0 SKIP,修正成立，运行时无需 git 历史。B 的 8 项故障控制(成功/非零/error/信号/spawn 抛/漂移 + 真实超时与断言失败、产物清理、无原生 UI)针对的生产脚本未被该修正触及，仍有效，无需重复。

## 四、判读边界

≤20s 不判别；20–60s 完成仅证本次探测晚成，不证原失败实例会完成、不证明冷启动成因；60s 超时或其它失败原样保留；源中无自动重跑、无 20s 契约放宽；原 canonical Windows 验收失败结果保持权威。

非阻断观察：安装步 `ONNXRUNTIME_NODE_INSTALL: skip` 复用既有 postinstall 开关，若环境致失败则按失败记录、不构成重跑或验收依据；CI 硬取消仅可能残留于一次性临时 VM 工作区，不会进入后续 census。

## 最终判定

**APPROVE。** 本批准仅允许提交此三文件，并在协调门之后执行恰好一次全新 Windows VM 的 NON_ACCEPTANCE 测量；不构成立即 dispatch 之外的 canonical 验收、20s 超时契约修改、合并、发布或 dry-run 记功授权。
