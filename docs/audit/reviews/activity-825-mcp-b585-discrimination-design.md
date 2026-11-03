# Main b585 MCP 启动：有界根因调查与独立快照设计

2026-11-03；当前分支 `codex/mcp-startup-observation-0.8.0`，基于 b585；只读产品/测试源码，在 `/tmp` 做受控实验，未改工作区源码、重跑 CI 或放宽时限。

## 结论与实际证据

实际首因仍为 **UNKNOWN**。现有 BOOT/phase 在 UI 线程同步调用原 `Desktop::send()`，可以自身阻止 UI 调度；但当前 main 日志不能证明这次确实发生了该等待。

`/tmp/cmspark-825-windows-main-b585-native-job.log` 的最后证据为 API5 entry b0、env callback6 b7/hr0/present1、API7 entry b7/return b9/hr0、API5 return b9/hr0；没有 controller phase 或 BOOT8，业务 mask=0，20 秒超时且 child 尚未报告退出。原生 b9 是原生 first-hook 后约 2.25–2.50 秒，不能与 Node deadline 跨钟域相减。

真实链路：`obApi773` 的原 API 返回后，`obRecord773` 将行存入内存并立即 `obFlush773`；flush 在原 UI 调用栈中经过 D476 string emit → wchar_t emit → `Desktop::send`。send 持 `socket_lock` 调用同步 WinHTTP send。controller callback 最前面则先做 `DESKTOP_TEST_NOTE(controller_callback)`，之后才记录 BOOT8。因此：

- peer 已收到最后一条 BOOT，不能证明 native send 已返回，也不能证明 obApi wrapper 已返回。
- 缺少 controller phase/BOOT8，不能证明 callback 从未进入；它也可能已进入但尚未完成最前面的 phase 发送。
- 原 UI callback、UI dispatch 与发送返回之间的本机状态，当前全部经同一个待怀疑的 WS 发送路径投影，存在共同盲区。

微软官方资料明确 Send 可与另一线程 Receive 并发，不能把“有并发”当违规或据此改产品锁。[WinHTTP concurrency](https://learn.microsoft.com/windows/win32/winhttp/concurrency-in-winhttp)。WebView2 callback 依赖 STA UI message pump，阻塞该线程会阻止后续 callback；这只支持候选机制，不证明此次物理根因。[WebView2 threading](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/threading-model)。

## 实际源码 C++ 实验

命令（Node 22.23.4，clang++，仅 `/tmp`）：

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null
node /tmp/cmspark-825-mcp-send-discrimination.mjs
```

exit 0；生成的 C++ `/tmp/cmspark-825-mcp-send-discrimination.cpp`，完整输出 `/tmp/cmspark-825-mcp-send-discrimination.log`。

实验使用真实 MCP producer 的 declarations、obApi/record/flush、两层 emit，以及产品原 `Desktop::send` mutex/调用体、`test_note` 函数体。Json/string/WinHTTP/SDK 返回与回调排程是受控边界；没有运行 Windows WebView2 或复现其内部行为。C++ 原线程和条件变量使选定 native send 边界真实处于未返回状态，观察线程读取独立原子状态，不借助该 WS 回执。

三个控制都产生与本次形状一致的 **6 条 BOOT + 2 条 phase**：

| 控制 | 原 SDK API 已返回 | obApi5 wrapper 已返回 | controller callback 已进入 | peer 所见 |
| --- | --- | --- | --- | --- |
| 暂不投递 callback | 是 | 是 | 否 | 相同 6+2 |
| peer 收到末条 BOOT 后，send 暂不返回 | 是 | 否 | 否 | 相同 6+2 |
| wrapper 返回后进入 callback，phase send 在 peer 收到前暂不返回 | 是 | 是 | 是 | 相同 6+2 |

这些是对真实源码在受控边界下的可达性证明，**不是**三选一认定本次 CI。它也说明下一次仅加更多 WS 行或无变化 rerun 没有区分能力。

## 一次有目的的最小独立快照

建议仅对未分发 Windows MCP fixture 增加固定数值快照，不改产品文件、其它 family、原 COM 调用次数、认证/业务/权限、20 秒或 cleanup 成功判据。需要 root 协调、B 非作者与 GLM 审核后才实施。

### 使用现有 owned 文件机制

- 复用已导出的 `ownedDirectoryIdentity`、`copyOwnedAcceptanceAssets` 和 #480 parent case 的做法：把同一受审 MCP exe 与固定七项 assets 复制到现有 test-owned 私有目录，预建一个固定名字、固定尺寸的 `wx+`/0600 receipt。源/目标普通目录及源 regular/non-link/single-link 检查照旧；不新增 env、argv、bootstrap 字段、HANDLE 权限或 binding 方法。
- 原生只从自身模块目录打开该固定 receipt，采用既有 OPEN_EXISTING、FILE_FLAG_OPEN_REPARSE_POINT、普通单链文件和固定尺寸核验。不开其它路径、不输出路径；DesktopNativeChild 仅有 terminate()，不为诊断扩展 PID/进程访问 API。
- 只在失败投影读取固定长度、固定 schema 的数值；保持原有 inode/文件身份重读、两次一致版本核对。缺失、损坏、写入未完成、超界或身份不符都为 UNKNOWN，不成为原生 pass/业务完成/授权依据。

### UI 只写原子状态；独立 worker 在固定时刻采样一次

- 在现有 fixed fixture 中放一个小的固定 `atomic<uint32_t>` 字段结构，验证这些原子在目标 x64 构建上 lock-free；不使用可能内部加锁的整结构 atomic。UI hook 只改固定字段/版本，不等待网络、磁盘、worker 或 observer 锁。
- 仅一个 test-owned worker：Node 在原测试 callback 入口记录诊断目标时刻（原 20 秒预算之前固定裕量，例如入口 wall-clock +19 秒），写入私有 seed receipt；原生 worker 从自身目录打开后，按同主机 wall-clock 剩余量做一次 wait，随后采样一次并写一次固定数值结果。worker 不获取 socket_lock、不 send、不调用 UI dispatcher。没有 polling、队列、周期 heartbeat 或重新调用 SDK；原 Node:test 20 秒仍是唯一业务截止。
- 原 finally 只读届时已经发布的结果，不等诊断、不加时间、不重试。若 worker 启动太晚、结果未发布、采样落在字段更新中、版本不一致或文件有误，一律 UNKNOWN。记录采样目标/实际时刻的有限差值；这一 wall-clock 观察不与原 native BOOT bucket 跨钟域相减，也不改测试的真实 timeout。
- 采用一次采样而非纯 UI 事件驱动文件发布，是因为后者会在 UI 停住后留下旧快照；旧快照不能冒充接近 deadline 的本机状态。新结果也只证明它实际采样时刻的状态，不能排除之后的变化。
- 不建议让 UI 同步写每条文件记录：那会把同一类自阻塞盲区换成磁盘 I/O。独立 writer 失败或滞后仍可能让快照 UNKNOWN，但不会要求 UI 等待它。原有进程终止与 close 清理继续决定资源回收，不添加 worker join 或额外清理预算。

### 只覆盖当前歧义的固定字段

1. **controller callback entry**：放在原 `DESKTOP_TEST_NOTE(controller_callback)` 之前；只锁存 entered、原 HRESULT uint32 和 host-present 位。不记录对象/HWND/路径/指针。
2. **原 API7 return / 环境 callback leave-marker / 外层 API5 wrapper leave-marker**：保留原值和原 return，不把“即将返回”写成 SDK 已观察到完整 return；给出当前栈区间。
3. **只针对既有 fixed phase/BOOT 的发送边界**：记录当前 enum kind/site/edge 与 `before socket_lock`、`lock acquired`、`before WinHttpWebSocketSend`、`returned`、`emit left`。不解析或记录认证、业务 message/body、capability、secret、URI 或任意字符串；其它 send 调用不进入该状态。
4. **原 UI outer dispatch 返回的一次 marker**：在 API7 原返回后 arm；于原 `run()` 的既有 `DispatchMessageW` 返回位置至多锁存一次。无需额外 PostMessage、唤醒循环或 heartbeat，也不把 COM 嵌套消息分发误写成原 outer dispatch 已返回。
5. 固定 schema、版本/完整性、写入状态及既有 250ms native bucket（明确自己的起点/UNKNOWN）；公开只投影布尔、闭集 enum 和 uint32。文件始终为固定尺寸，无 raw memory dump、任意错误文本或动态路径。

该 worker 只是单个夹具固定结构的发布端，不应抽成新的通用观察框架。既有 BOOT recorder/192 行限制与 WS 协议先保持不变，快照用于判断其发送是否干扰原 UI。

## 每项结果怎样改变修复决策

| 有效独立快照 | 决策 |
| --- | --- |
| 最后 BOOT/phase 对应 send 尚未离开 lock/WinHTTP，而原 SDK 调用已返回 | 首先修复未分发观测的 UI 同步发送干扰；不改 WebView 业务/SDK调用、并发权限或 deadline。原生再验证后才认效果。 |
| callback entered=true，卡在其最前 phase send，WS 却无 controller phase/8 | 直接确认“没有回执≠未进入 callback”，针对测试观测递送路径修复；原 callback HRESULT/presence 保留用于区分原失败 guard。 |
| 采样时所有诊断发送已离开，outer dispatch 已返回，callback entered=false | 排除采样时“UI 正被该观测 send 阻塞”的候选，转向在此时仍未交付的 WebView 异步 controller completion；不据单点保证之后状态，也不猜 runtime 内部原因或加时。 |
| send 已离开但 leave/outer-dispatch marker 缺失 | 继续限于原 callback 尾部/返回/dispatch 区间，不宣称 event pump 健康或 SDK 没回调；按实际最后边界决定下一步。 |
| callback 原 HRESULT 失败或 host 缺失 | 走原失败 guard 的明确 HRESULT 诊断；不以观测阻塞掩盖或放宽该 guard。 |
| 独立快照缺失/无稳定版本/发布失败 | 结果 UNKNOWN；不能推断 WS、SDK 或物理根因，不以无改动 rerun 消红。 |

## 实施前机器验收边界

若方案获批，需用真实生成源码做 LF/CRLF 全逆变换和原 API 次数/参数比较；测试读取实际新状态结构/发布器/闭集 reader。延用上述三个真实源码受控发送/回调排程，核独立快照分别区分三者，而 WS 形状仍相同；覆盖文件身份/短读/版本未完成/超界、迟到采样/writer 不可用为 UNKNOWN、诊断异常不替换原失败或 cleanup。核原 readFile/AST/VM 消费者是否需要绑定新增数值 hook，不能仅以 import/tsc 通过替代真实消费者；原 #773/476 消费者和完整 TS 编译保持。这里只是设计与实验，不是 Windows 原生通过，也不允许 release tag。
