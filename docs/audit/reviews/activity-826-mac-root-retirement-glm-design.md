# Mac ROOT_REMOVED — actual GLM design increment

- Verdict **APPROVE**, only ROOT_REMOVED and fresh in-memory timeline in existing final-query output; point count8→9.
- Base `0666fc8d066ec6a0941c5edec865063a30692cf9`; live eight-point implementation was unfrozen context, not source-approved.
- Prompt SHA256 `3e072decae0cd26cdf64d9bfaedc75a2cee09dc16087d3f6b0d2ad477e7b1259`; 77182 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, provider host `open.bigmodel.cn`, process exit0/is_error false, one tool-free turn; duration `55225ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 20218, "outputTokens": 3734, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.19444, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Record only after original rm succeeds and before original settled, isolated best-effort. Existing1024-byte result guard retains exact original result on candidate overflow/fault. No new read/query/wait/cleanup delay;45s/5s/2query and authority remain.
- Design implementation only is permitted; machine/independent/source-GLM and actual Mac acceptance remain. No historical cause/CI/merge/release success claimed.

## Actual reviewer response (verbatim)

## 增量评审(ROOT_REMOVED,8→9)—— **APPROVE**

(仅裁本点增量;八点 Mac 设计与 Windows 构建设计不重开;live diff 只作上下文、不作源门。)

**核查依据：**

1. **记录位唯一可达。** 仅插于原 finally 中 `if(uiClosed){fs.rmSync(...);surfaceLease.settled()}` 的 rm 成功返回与 settled() 之间。rm 抛错或 cleanup 拒绝(uiClosed=false)时该位不可达，负控语义由结构自动成立;原始错误、租约保留与 settlement 顺序不变。
2. **权威零变更。** first-once、best-effort try/catch、同一 closeClock476/250ms/min240 饱和；不参与 canSettle/cleanup/complete,不动 45s/5s/两查询/字节 CAP/拒绝路径；无 stat/read/exists/等待/快照拷贝/延迟清理/worker/timer/重试，与既有 note 模式同构。
3. **发射侧封闭。** 在既有 D705_XCRESULT_DETAILS_CLOSED 回调取当前内存 timeline,候选超 1024 或观察/序列化异常一律回退精确原值；不发新槽。`send()` 的 sent-once 加上快照在发射时刻读取，构造上禁止对已发射结果回溯注入；单线程事件循环保证 note9 与快照读无撕裂竞态。
4. **解释边界正确。** 点在只证 rm 已于最终投影前返回，不证查询 OS 读序、0666 因果、xcrun 内部或 45s 根因；缺失保持 UNKNOWN。双探针(作者与独立，独立版基绑 git0666,已消除活树依赖错配)各 6/6 证实合法 caller 清理可先于异步诊断叶读取并产 TOOL_FAILURE,该点确有判别价值。
5. **源机验收负控齐备。** rm 成功仅记一次且后续查询输出可见；拒绝/抛错无点;note/clock/logger 故障保全主失败与 lease;重复 note 不改首值;先完成的查询不得报告未来移除；溢出/故障回退原值；输出上限不增大以容纳此点。

**实施注意(非阻塞)：** 第 9 点无 code/signal,固定为“无事实”编码即可；插入处仍需独立 try/catch，确保 settlement 永不被观察跳过。

**许可范围：** 本 APPROVE 仅允许实施，随后经机器核、独立 source 与 GLM 源码门；不构成运行时/CI/merge/发布成功、根因归因或 Mac 通过证明。无可达阻塞项。
