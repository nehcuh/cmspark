# #826 MCP non-acceptance probe — actual GLM design gate

- Verdict **APPROVE**, implementation only; machine/independent/source gates precede any dispatch.
- Base `67c5e209d239995b930fe1dfcc54f444005e44f8`; no implementation diff.
- Prompt SHA256 `2e95736ada44cfd9918d3d7f00e3dd21605cf6ba5afecbd33df66866aad98a2e`; 59090 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, host `open.bigmodel.cn`, exit0/is_error false, one tool-free turn; duration `81309ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 14051, "outputTokens": 5752, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.214055, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Full B report input included Fresh-VM scheduling refinement, including **needs: preflight**; the actual reviewer explicitly approved that dependency. The runner remains independent/fresh with no previous native UI.
- Planned experiment: at most one explicit non-acceptance60s derived MCP registration, canonical20s and snapshot20s unchanged. Defaultfalse typed dispatch input; probe=true skips package/publish including tag-ref dispatch; normal release paths conserved.
- No immediate dispatch, canonical acceptance/budget change, release dry-run credit, historical cause, merge or release is approved.

## Actual reviewer response (verbatim)

结论:**APPROVE**(本批准仅允许进入实现与既定 machine/independent/source 门,不构成立即 dispatch、验收或合并授权)。

理由:

1. 工作流守恒逻辑成立。package 新增条件 `github.event_name != 'workflow_dispatch' || !inputs.mcp_latency_probe_826`:tag push 时第一项为真,打包照常;普通 dispatch(布尔缺省/false)时取反为真,照常;仅显式 probe=true 的 dispatch 跳过。在 tag ref 上 dispatch 且 probe=true:event_name 仍为 workflow_dispatch→package 跳过;release 因 `needs: package` 在依赖被跳过时连带跳过(未用 always()),其 tag-only if 与 needs 原样未动,故既不打包也不发布。typed boolean 在 push 事件下 inputs 上下文为空、取反为真,不扰动 tag 路径。push-tag/分支 dispatch/probe dispatch/tag-ref probe dispatch 四态真实解析控制已列为前置,可达。

2. 探测作业边界正确:独立 Windows VM、needs preflight、contents:read 覆盖工作流级写权限、persist-credentials false、锁版 22.23.4、companion npm ci/build、原 --test-fixtures 构建与 tsc,全部复用现有产物链,无新工具链/SDK/profile/权限;preflight 未改;输入为类型化布尔,仅进 if 表达式,不进任何 run 的 shell 文本。

3. 字节级反事实可达。AST 控制已证实际编译文件中唯一 MCP 注册、该注册内唯一数值 timeout=20000,仅替换为 60000 后其余字节精确不变,snapshotDeadline825 保持 Date.now()+20000,内部快照仍按原 ~18.5s 采样;60s 注册超时与 t.signal 触发的 OWNED_NATIVE_MCP_DEADLINE 一致延长,原全部业务/断言/finally/清理/租约语义保留。派生文件为同目录 CJS 兄弟,require/__dirname 语义原样;官方 run-tests.mjs 定向模式要求目标位于 walk 可发现集(`*.test.js`、非下划线开头)、wx 独占创建满足;win32 `--test-concurrency=1` 与 data-dir 隔离照旧;session-lock 预构建不触发(不在请求集)。控制要求(加载器/隔离/创建/清理/漂移/缺失/歧义负控与逆等式)在 source gate 与 dispatch 前真实执行,可达成。

4. 判读边界正确:20..60s 完成仅证明本次探测晚成,不证明原失败实例会完成或冷启动成因;≤20s 不判别;60s 超时/其它失败原样保留;不自动重跑、不放宽 20s 契约;原 canonical 失败结果不被覆盖;结果必须回独立方与 GLM 后另行决策;probe 运行永不替代 release dry-run 或验收。

随实现必须落实的既有条件(非新增范围):派生文件删除须置于 finally,探测断言失败、超时或取消时同样不得遗留进入后续 census 发现;派生文件名唯一且不与现存测试冲突;canonical TS/编译 JS 全程只读并事后校验不变;探针脚本对非显式 GHA Windows 拒绝执行;无运行时重编译回退。

未发现可达成阻断项。
