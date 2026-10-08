# 本地制品评审：能力与验证边界

首次本地交付时未发布。用户随后授权分阶段提交并推送 `nehcuh/cmspark` 专用分支 `codex/windows-artifact-review`；禁止 force push、合并和部署。原工作目录 `/Users/huchen/Projects/cmspark` 未改动。
首次实现基线 `288ed02c` 包含用户未提交修改快照 `c098f404`。发布副本重新从干净远程 main `3d368a4e` 移植第一阶段补丁，不带入快照或整合提交。对快照整合产生的重复定义所做撤销在干净基线上为空，不纳入发布。后续回归与验证边界见 `2026-10-09-stage-validation.md`。

## 可观察能力（ADR-020）

- Axis：浏览器扩展 authenticated chat → Companion L2 → HTTPS ZIP 内存下载 → worker 扫描 → 可选 ACP 评审 → scope 内持久化 → 网页证据风险报告。
- 入口：`code_review_create` 先绑定网页 observation、repo/base/head、真实 diff 和业务引用；`code_review_run` 必须逐次真人确认。仅 server-owned chat scope 接收，拒绝 outbound/其他线程；计划只读禁止 run/cancel。`code_review_status` 和 `code_review_risk_report` 是只读回收入口。
- 下载授权：HMAC 绑定完整规范化输入、URL/query、SHA-256、前缀、review/request、agent 配置 digest 与服务端线程。模型伪造 token 会被剥离；另一个 WS 不能答复确认。完整预览使用已有 `full_preview`，确认台可滚动显示尾部制品和哈希。更换配置/制品需重新确认。
- Trust：不扩大 god-mode/cruise/session trust；run 永远 forceConfirm。只信任明确配置的 ACP 命令，不从 PATH 自动发现推理服务。默认不允许评审；`offline_review:true` 是运营者对离线推理的声明，或 `review_external_authorized:true` 表示运营者已授权源码发送到该配置服务，均还需本次 L2 确认。两项不得由网页内容或模型声明替代。真实私有代码外发授权未获提供，生产执行未启用。
- 本地进程不等于本地推理：上述 flags 不是 OS/network 沙箱；受信 ACP 自有工具可能不经协议权限请求。因此使用生产 agent 前必须验证它的推理位置、禁执行/禁联网设置与授权目的地。所有协议工具权限请求默认拒绝；不声称可以约束恶意 agent 二进制。
- 下载不带 cookies/Authorization/proxy；直连公网 HTTPS、拒绝跳转、所有 DNS 回答均须公网、socket lookup 固定批准 IP、TLS 仍校验原 hostname；下载内容必须匹配可信 SHA-256。支持普通 stored/deflated ZIP，不支持 tar、7z、zip64、加密 ZIP 或认证下载。
- downloaded code 不被 import/eval/spawn，不提取仓库到磁盘、不执行 scripts/AGENTS/hooks。worker 内仅固定可信解析代码。ACP 仅收到固定文件名 JSON 中最多 128 个变化文本文件、256KiB 源码胶囊，源文件名从不用于写文件。临时胶囊结束/取消删除；进程被强杀时可能残留在系统临时目录，Windows 验收需核查此限制。
- Resource：每个 ZIP ≤20MiB，≤2000 entries，单 entry ≤2MiB，展开 ≤64MiB；并发 2、队列 8、每 chat 最多 16 jobs、整任务含排队 120s。结果存档 ≤8MiB；队列是进程内的，进程重启后 queued/running 标记 interrupted，不自动重放。
- 取消/恢复：接受后与原 chat socket/AbortSignal 解耦；cancel/timeout 先写终态，再中止下载/worker/ACP，迟到结果不覆盖。成功返回 job_id；接受响应丢失可列出本 scope 的任务；完成结果跨重启可读取。断连不等于完整 chat 自动续跑。
- 证据：制品 hash、逐文件 base/head hash、静态规则 file/line hash、Agent job/input digest/session/path/line、网页 observation digest/time/url、需求/任务/测试引用。Agent 输出始终 untrusted；静态命中与语义评语分开。Agent 自报已评审文件不是独立覆盖证明。固定规则无命中仍风险 unknown；不声称已运行测试或发布批准。
- 未扫描：二进制、vendor/.git、未选择前缀、嵌套制品、超胶囊范围、无依赖漏洞库、无运行时/测试、hash≠Git提交身份、业务因果关系与测试执行待核验。额外 artifact 仅静态扫描，语义 ACP 胶囊只含 base/head 变化文本。

## 已复现的连接/ACP 缺陷

1. `companion/src/ws/lifecycle.ts` 只监听 WebSocketServer error，单个 peer Receiver error 无监听。非法 unmasked frame 修复前 exit=1 并影响健康 peer；修复后坏 peer 单独 terminate + `ws.peer_error`，进程、另一 peer、healthz 均存活，连续3次；加强版本对健康peer实际配对并验证坏帧后应用pong，亦连续3次通过。
2. `chrome-extension/src/background/ws-client.ts` 原保活依赖30s chrome alarm；连接/认证挂起及 OPEN 黑洞没有 deadline。新增20s应用 ping，15s建立/认证 deadline、60s收包deadline，丢弃/新连接时清理 timer，旧 socket 不可夺回身份。四个行为测试修复前4失败，修复后9通过（含既有 orphan tests），连续3次。Chrome 116+ 要求小于30s的应用消息交换：[Chrome 官方文档](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets)。这是可验证生命周期缺口，尚无 Windows 故障现场日志来证明该用户事件由它触发。
3. ACP cumulative timeline 被逐次追加到 agent_text，状态与重复历史污染结构化回传。基线 null 帧在独立进程复现 TypeError/exit=1。新增 message-only 输出，排除 reasoning/status，按 chunk 原样拼接；成功后 kill 回收 child。JSON-RPC合法JSON null/array/scalar及错误对象需先校验形状，超1MiB未换行帧终止该peer；stdin/stdout/stderr及sync写错误收敛到shutdown，避免进程级异常。握手阶段通过 onSpawn 立即登记 child，取消后禁止 fallback/late prompt。

## 受控验收

- `tests/local-code-review.test.ts`：真实 worker、实际 ACP JSON-RPC 子进程、split JSON、默认权限拒绝、进程回收、握手/评审取消、配置变化、错误 job identity、持久化重启/隔离、队列/超时、生产 createToolExecutor L2/origin binding、伪 token/thread、模拟重连结果回收、网页业务引用报告。合成 agent 证明通路，不证明 LLM 评审质量。
- `tests/local-download.test.ts`：TLS lookup pin、mixed DNS 拒绝、无 redirect、hash 不符、Content-Length/stream 超限；网络传输是 mock，未下载真实私有代码。
- `tests/ws-peer-error.test.ts`：真实随机 loopback listener 与真实 ws 帧，独立 child/config，未调用生产 LLM。
- Windows spawn 既有纯 helper suite 可在 Mac 检验参数；实际 `.cmd`/进程树 kill、SEA exe、Chrome/Edge MV3、托盘运行未验证。
- 没有全量 green 或 merge-ready 声明；独立对抗审阅结果应另存，Pi 合并闸门未运行，因为本任务禁止合并。
