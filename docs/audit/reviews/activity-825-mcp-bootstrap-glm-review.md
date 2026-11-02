# #825 / #476 MCP 启动观测单元 GLM-Claude 回执

- 实际裁决：**APPROVE**。只允许提交本测试观测单元并执行一次有目的的 instrumented CI。
- Base：`2c8eb4ec6306483bc69a4467eade2a02992841b8`；source范围为10路径，不含未暂存的本机host-integrity pin。
- Source diff SHA256：`f77601b37e188abd43ce5cfbc0c733e9b54d53fcaa99714d49916729cf84193b`。
- Prompt SHA256：`5e538404f64bdc14992afad4b4d256ba88e09cb404abb27af3b249df728e2e07`；247085 bytes；API起始UTC `2026-11-02T17:24:38.305887+00:00`。
- Reviewer：Claude Code 2.1.153 / `open.bigmodel.cn`，实际 modelUsage仅`glm-5.3`；process exit=0，is_error=false，耗时581132ms。无格式补充API。
- 历史20秒超时根因仍为 **UNKNOWN**；本观测不表示修复根因、Windows新夹具已编译/执行，或完整CI/release已通过。原20秒、业务断言、权限与cleanup继续决定验收。
- 协调者在API启动后另报2c8 census：**9527 tests PASS / 67 SKIP / 0 FAIL**；157 suites单列，不并入test计数；真实PS producer 6413ms PASS。该追加事实未发送模型，不代表GUI directed或全CI通过；GUI仍被MCP前置失败挡住。原始凭据/配置或宿主全量日志均非本次输入。

以下为实际GLM-Claude完整原文（未经改写）：

---

VERDICT: APPROVE

（明确许可原话：**批准本观测单元提交（commit），并允许执行一次有目的的 instrumented CI**。本批准仅覆盖"未分发 MCP 测试宿主的 #773 目的性启动观测增量"进入 CI，不声称历史 20s 超时根因已修复，不声称 Windows 原生、完整 CI 或 release 已通过。）

## 关键核对

1. **只增观察，不改行为**
   - 生成器 MCP 分支仅：D476 结构体内插观测声明、ready 接受后 `obBind773(*this)` 绑定、追加 string emit 适配；`obApi773/obCallback773/ObScope773(30)` 均为包装——原表达式（含全部操作数与回调构造）逐字保留在立即调用的 lambda 内，每 API 仍恰好一次，返回值 `auto` 透传，异常不被吞（catch 只在 recorder/flush 内部）。6/8 回调插在 `DESKTOP_TEST_NOTE(...)` 与原 guard 之间，guard 判定字节不变。
   - 生产 `DesktopHost.cpp`、D476 wchar_t emit/receipt/form/controller fixture 均不在 diff，SHA 标注未变；476 测试 try 块、20s、断言、cleanup 顺序未动（B 的三片段移除后逐字节等于 HEAD 独立证实）。
   - builder 选择器实测语义：`mcp`→新入口、`local`→原确认观测、metadata/dialog/resource/workspace/archive→null；`/DCMSPARK_DESKTOP_TEST_PHASES` 条件与全部编译 flags 为上下文未改行；480 循环未动。

2. **旧输出与闭集一致性**
   - D480 路径重构后输出与 HEAD 版模块逐字节相同（LF/CRLF SHA 由 B 独立对比 + 仓库断言双重证实）；inline BOOT parser 抽共享后 6153 边界输入投影一致；`recordNativePhaseResponse` 无 bootstrap 时早退条件 `!bootstrap&&phases.size>=8` 与原 `phases.size>=8` 等价。
   - producer/parser 闭集核对通过：point1–30/ordinal1–8/edge0–2/bucket(≤359或361)/uint32 code/present 语义与 edge 规则两侧一致；192 全局与每 site 前 8 上限同源；短路与先做界检查再索引 `obSeen773[point][ordinal][edge]`，无越界。

3. **通道与信任面**
   - BOOT 行走原 `system.ping→system.pong` 已认证通道（测试证实未认证 socket 被关且 rows 不变），双 emit 重载委托原 wchar_t receipt 路径，无业务假成功、无新等待/重试/时限；finally 投影仅增 `bootstrap773` 字段且在原 try/catch 内，primary failure 与 cleanup 权威由 AST 实际 finally 消费者 LF/CRLF×诊断抛错覆盖。
   - 逆变换链 `observed.inverse===mcpVariant.source && mcpVariant.inverse===original` 机器验证（LF/CRLF），builder 双重 drift 守卫保留。

4. **目的性成立**：旧 773 直接套 D476 被 `BOOT773_ANCHOR` 拒绝（实验证明），新适配经真实 formatter 区分"进入未返回/失败 HRESULT/耗时"，非空重跑。

## 实际 blockers

未发现。

非阻塞 nit（不要求改）：parser 接受 bucket=360（producer 不可达值，属继承旧 parser 的既有宽松）；MCP 产物含未用的 `obMeasure773`（测试工件死代码）；476 pong 观察按连接包装而非 480 控制器那样的 owned-socket 门控（本拓扑单一已认证连接，且仅诊断无回执权威）；D476 宿主复用 `D480A_` 前缀（有意复用闭集，命名略混）。

## 剩余门（如实未过）

- 真实 Windows MSVC 编译新 MCP 测试宿主并跑原 476 原生断言/cleanup，获取实际 BOOT 行（本机/本批均未执行，不得冒充已过）。
- 完整 CI（当前 head 2c8 既有 #476 20s 首错仍在，根因 UNKNOWN；新观测只提供下一轮证据）。
- 最终 CI 与 release 门；未 stage 的 host-integrity pin 不属本批。
