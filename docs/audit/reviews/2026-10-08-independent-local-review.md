# 独立对抗评审：Windows 连接与本地制品评审

评审日期：2026-10-08。独立 reviewer `/root/adversarial_review`；依据 `.agents/skills/cmspark-eval-engineering-gate/SKILL.md`，安全面按 T3 检查。范围仅为隔离 checkout 的本地可交付结果；基线 `288ed02c`。读过 tracked diff、全部新增 `local-*.ts`、新测试、能力声明和机器日志。本 reviewer 未修改源码，未构建、发布或访问真实私有制品；唯一写入是本报告。

## 结论

本地链路具有实际可观察实现：生产 tool executor 经逐次真人确认，绑定制品与 agent 配置，后台下载/worker 扫描/真实 ACP JSON-RPC 进程完成，结果可在原 chat 中断后按 scope 回收，再与已有网页证据生成风险报告。没有发现当前源码中的授权绕过或会话越权。修复前后证据证明两类 peer 错误曾能影响整个 Companion，当前回归检查已隔离错误 peer。

这不证明用户 Windows 现场断连的唯一根因，也不构成生产 agent 启用或合并放行。当前支持的制品是受限 ZIP；真实私有代码评审的 agent/推理目的地尚待用户明确配置与授权。没有全量 green 声明，Pi 二次门禁未执行。

## 已发现并修复的 blocker

**P1 / Companion 进程隔离：ACP 合法 JSON `null` 可击穿进程。** 基线 JSON-RPC 接收器只捕获 JSON 语法错误，随后读取 `msg.id`；`null\n` 会在 stdio data callback 抛 TypeError。reviewer 用已编译类与 PassThrough 独立复现，实施者另用基线源码复现 exit=1（`task-2/evidence/logs/acp-null-before.log`）。当前 `companion/src/acp/jsonrpc-stdio.ts:64` 校验非空对象、RPC 版本、id/method/error 形状，坏帧终止本 peer；`:33` 收敛三个 stdio error，`:133` 收敛同步 write 异常。`companion/tests/acp-peer-isolation.test.ts:11` 覆盖 null/array/scalar/非法 id/error、过大无换行帧、EPIPE 和另一个健康 peer 正常响应。该 blocker 已关闭。

四行 case：
1. 动作：对 ACP JSON-RPC 客户端注入合法 JSON `null\n`，并保留独立健康 peer。
2. 结果：修复前 TypeError 可逃出 data listener；修复后只关闭坏 peer，健康请求仍完成。
3. 归责：实现遗漏协议形状校验；并非 Windows 平台或外部限流。
4. 保护能力：不可信子进程输出不能终止 Companion，保持并发任务隔离。

报告歧义也已修正：`companion/src/code-review/local-risk.ts:14` 在有实际 agent 结果时移除扫描器层面的 `NO_HUMAN_OR_SEMANTIC_REVIEW`，改为准确的无人类复审/agent 未独立验证缺项；原始 scanner 结果仍保留自身边界。

## Outcome / Trajectory / Component

- **Outcome：** `companion/tests/local-code-review.test.ts:257` 经过实际 `createToolExecutor`、正确 peer 的确认、伪 token/thread 剥离、chat abort、模拟重连、后台 ACP 和风险报告。agent 是合成本机 fixture，验证真实进程/协议/权限拒绝/回收，不证明模型审查质量。下载 transport 是 mock，worker 使用真实 ZIP 字节。报告保留 hash、文件/行证据、网页 observation、业务引用及未核实事项，`review_ready:false`、`release_approved:false`。
- **Trajectory：** 保留用户改动快照 `c098f404`，与上游整合后的基线 `288ed02c` 区分实施 patch；`orchestrator/spawn.ts` 删除整合产生的重复定义已在能力声明解释。两组 Pack 的工具白名单和只读模式路由与新增入口一致。未见擅自发布/启用生产 agent 的操作。
- **授权组件：** `local-contract.ts:32` HMAC payload 包含完整规范化输入、服务端线程、当前 agent digest，并校验待确认时捕获的配置快照。`tool/l2-admission.ts:320` 在展示确认前捕获 digest，`:336`/`:1557` 展示完整制品及 agent 目的地/命令。`local-agent-policy.ts:10` 默认拒绝未显式离线或外发授权配置；`local-jobs.ts:158`/`:173` 在排队后和 agent 启动前复验。run 永远 forceConfirm；模型声明与另一 WS 不能代替真人确认。
- **下载/解析组件：** `local-download.ts:24` 仅直连公网 HTTPS，DNS 每个答复均筛选、socket 固定批准 IP、保持原 hostname TLS 校验、不带 cookie/Authorization、不跟跳转、校验 hash 与容量。`:30` 的 DNS await 可由 abort 结束。`local-scan.ts:45` 校验路径、symlink/重复路径、展开与 CRC；`:153` 的 worker source 来自固定可信函数，下载内容仅作为数据传入，不提取/执行仓库。ACP 仅收到固定文件名的受限 JSON capsule，协议权限默认拒绝。
- **并发/恢复组件：** `local-jobs.ts:97`/`:143` 限队列与并发；`:131` 终态先写入，再 abort，迟到结果不能覆盖；`:69` 重启将 active 标记 interrupted，禁止自动重放；`:114`/`:119` 为 scope 内回收入口。普通 chat stop 不等于取消已确认后台作业，此行为与工具描述一致。取消/超时保留已完成静态结果。
- **连接组件：** `ws/lifecycle.ts:845` 在 admission 前注册 peer error 监听，RFC6455 错帧不再成为无人监听 EventEmitter error。`chrome-extension/src/background/ws-client.ts:100`/`:314` 新增 20s 应用 heartbeat、连接/认证与收包 watchdog，并保留 generation/orphan 隔离。Windows 用户事件没有现场日志，Chrome MV3 缺口只作为已测生命周期缺陷，不能被提升为该事件的已确认根因。

## 机器证据

reviewer 独立执行（未重新编译）：

```text
cd companion
node scripts/run-tests.mjs .test-dist/tests/acp-peer-isolation.test.js .test-dist/tests/local-download.test.js
13 tests / 13 pass / 0 fail
```

核对最新实施者日志：`task-2/evidence/logs/companion-targeted-final.log` 为 253 cases / 249 pass / 4 skip / 0 fail。统一证据目录 `task-2/evidence/logs/`：`peer-before.log` 的 WS 错帧使 child exit=1，`peer-after-{1,2,3}.log` 连续通过；`extension-peer-after-{1,2,3}.log` 的扩展相关 9 tests 连续 3 次通过；`companion-build.log` 记录 build/bundle，交付时由实施者在同一路径保存最终源码重跑证据。

`task-2/evidence/logs/extension-all.log` 为 1510 pass / 1 fail：未修改的 `katex-runtime.test` 检出 inherited trust 下 `javascript:` href。现场复用 KaTeX `0.16.47`，项目声明 `0.18.2`；这是明确依赖/全量验证阻塞，不因本 patch 范围较小而当作通过。需要恢复声明版本并重跑后才可宣称全量 green 或进入合并门禁。

## 已关闭 nit 与剩余限制

- **P3 / 命名与注释，已关闭：** 最后增量核对 `companion/src/code-review/local-agent.ts:10` 已改名 `assertAuthorizedReviewAgent`，`:15` 注释改为 explicitly operator-authorized，`local-jobs.ts` 三处调用也已同步。措辞与实际允许离线声明或明确授权 external service 的 policy 一致；默认拒绝行为不变。此轮无未关闭源码 nit。保留原本地范围 verdict，不扩大为生产启用或 merge-ready。
- **生产授权限制，不是绕过：** `offline_review` 和 `review_external_authorized` 是受信运营者声明，不是 OS/network 沙箱。ACP 自有工具可能不经过协议 permission；生产启用必须核验推理位置、执行/网络配置、授权服务与代码范围。本地进程不等于本地推理。强杀 Companion 可能留下源码 capsule 临时目录，需在实际平台验收清理行为。
- **报告边界，不是遗漏证明：** artifact hash 不证明 Git commit 身份；路径匹配不证明网页 diff 与下载内容同一提交；agent 自报 reviewed_files 不是独立覆盖证据。二进制/vendor/.git/未选前缀/胶囊以外变化、依赖漏洞数据库、运行时与测试、业务因果关系均仍有缺项。工具没有把这些假定为安全或测试通过。
- **Windows 未验证：** Mac 参数 helper/进程 fixture 不代替 `.cmd`、SEA exe、实际进程树 kill、托盘、Chrome/Edge MV3 及多个并发会话验收。还需用户最新 Windows 包版本与断连时间附近的 process/ws/task 日志，区分进程退出、service worker suspension、ws reconnect 与 task cancellation。

VERDICT: APPROVE_WITH_NITS
