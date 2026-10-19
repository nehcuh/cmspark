# 编程接力与终端：诚实状态和有限观测
GitHub: #722
GitHub: #724
Base: 6684b63336c650061533939ff9d87d8fe107e4ce
Status: IMPLEMENTED — root finite approval received; independent and hosted gates pending

## 现状与用户表述
Chip 已把 offered/confirmed 显示为“待启动”，保留此已实现行为。实际 Panel 空输出区域仍把 offered/confirmed 合并到 live 并说“已启动”；CPU actual JSX subtree 两例 FAIL。真实 relay 已把 output 原样转给终端且不记录正文，但首个 data 没有计数日志、原 heartbeat 没有输出年龄；actual relay 两例 FAIL。8控4P4F自然exit1。不是实际 Windows 安装build复现，不知道真人安装SHA，不用源码状态覆盖其体验。

本组：用户能分清尚未启动的提案、登录 shell 来源、内嵌 Agent 启动来源，以及终端有没有传出字节。来源不等于 Agent 健康/ready/任务完成；没有内容观察通道。

## 诚实显示（不增加启动动作）
- offered/confirmed：Panel 明示“待启动：尚未启动 Agent”，不写等待已启动 Agent 输出；Chip 原“待启动”保留。running 的 ACP/CLI 监视桥与 embedded PTY 来源分开，不把桥/PTY open 当作 Agent 就绪。
- 常驻终端入口保留现开页行为，文字“打开本机终端页（非 Agent 启动入口）”，解释新普通页为本机用户 shell；若已有终端只聚焦原页。不能因为此入口无 thread_id，就把已有 embed 页标成 shell。
- terminal.opened 新增可选 launch_kind: "local_shell" | "embedded_agent"。由真实 owner-bound terminal handler 在原确认/descriptor对齐/真实spawn返回成功后，根据实际 consumed embed descriptor 设置，不从 URL/thread/Agent名/CLI名猜。新字段无授权/执行能力、不影响 admission/singlePTY。
- 终端页收到当前session opened后，显示“本机用户 shell（非编程 Agent）”或“内嵌 Agent 启动来源（用户驱动；就绪与输出请在终端核实）”。缺失/未知字段显示“终端来源未知（旧版/未提供）”；opened前、打开失败和结束态不得写Agent正在运行。此字段只说明来源/用途，不证明真正完成start、正在产出或登录成功。
- Panel 既有 embed_intent→embed_running 字段只表明记录意图或曾观察到启动事件；显示“内嵌终端启动来源/请到终端查看”而非据此声称当前Agent健康。Stop/急停/真实进程关闭语义保持原样。

## 仅有限诊断字段（root 已批准）
复用原 PTY heartbeat 定时器，不加任何 timer/轮询/缓存队列/新服务。LiveSession 只增加 output_bytes、ack_frames、pause_count、lastOutputAt 四个诊断标量；从实际 emitChunks/既有unacked移除/既有pause转变更新，不参与控制。

heartbeat 的可选 metrics 固定8字段：seq（现有最后输出序号）、output_bytes（累计发出的UTF8净荷字节）、unacked_frames（现有Map.size）、unacked_bytes（现有值）、ack_frames（实际从原Map移除的帧累计数，非收到ACK消息数）、pause_count（false→true转变数）、paused（现有布尔）、last_output_age_ms（从无输出为null，输出后为非负年龄）。累计诊断量饱和Number.MAX_SAFE_INTEGER；unacked沿用现有256KiB保护，字节/帧上界不提高，seq/control/watermarks不改。计数不是送达/渲染成功证明。

扩展只对白名单有限合法metrics写入原 heartbeat日志；无metrics旧版照常回应ping且不伪造0/健康状态；坏metadata只省略诊断，不改变原ping/数据转发。首个当前session有效terminal.data仅记一次事件{id,seq,bytes}，bytes由已校验净荷长度得出；随后只在原heartbeat汇总，不逐帧灌日志。原opened/closed/error诊断频次保留。不记录b64、文本、输入、路径、prompt、Agent名或env；不把整个rawframe放进log。

## 不变与验收
Panel-only、owner/WS/Port校验、L2、单PTY含closing、16KiB分块、64/16/256KiB水位、overflow、ack、输入/resize/ping/watchdog和内容流都不改。PTY仍是人用交互面；Agent内容来自既有ACP/CLI progress/tainted handback；另票的显式人工review report通路保持不变，不因本票新增PTY→模型内容出口。

实际组件/事件producer RED→GREEN：offered/confirmed无假start；source kind只权威opened且legacy/failed/foreign/out-of-order不冒称；本地shell/已有embed聚焦正确；首帧计数、heartbeat无输出null、实际ACK/pause、水位/overflow/owner与日志无内容控制。只CPU DOM/真实回调seam，不启动本机browser/PTY/native/provider。冻结后共享必要机器+两互盲非作者+精确head/mainCI；真原生门禁不能用CPU替代。#724按全部原DoD验收，#722仍PARTIAL（生命周期、多offers等未交）。

实施验收口径：root 后续明确允许实际 React SSR、生产 JSX/onClick、原 App open-event effect 闭包与真实 store reducer 的受控事件投影，结合既有 priority/尺寸测试和构建；不必为本机禁 browser 另造通用 DOM 框架。此证明不是整 App 挂载、真实浏览器布局/焦点或原生执行，相关边界须在报告保留。
