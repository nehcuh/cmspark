# Cockpit native bridge：首个身份纵向开发门（#723 D2）

此实现属于 **0.6.14 开发候选**。新增的扩展权限仅为 `nativeMessaging`，固定 host 为 `com.cmspark.cockpit`；它不能执行通用命令，也不增加 screen/debug 权限或常驻服务。当前只接 bind/dispose，sample、pair、geometry 和双帧遮罩尚未实现。PR748 精确 head 曾通过真实 Windows/Chrome 身份首门，但同树 main 的原 45 秒门失败；历史原因仍 UNKNOWN，不据 head 通过宣称 main 完成。本页不是发版或本机安装指令。

实际 cockpit document 的独立 runtime Port 经当前 owner 检查、已认证 WS 的一次性 5 秒 challenge，再由该 document 的 `connectNative` 启动固定 host。原 hydration/log Port 保留。host 从浏览器启动参数取得 parent HWND，不接受消息指定 HWND；同一进程标准输入/输出 pipe 的浏览器 PID、parent HWND PID/TID、实例内随机窗口属性和当前 document/owner 必须都成立。`GetNamedPipeServerProcessId` 对实际 Chrome 继承句柄的支持仍是 **UNKNOWN / STOP 前提**，argv、标题、Chrome windowId 或 PID 不能替代证明。窗口属性没有 CAS 或 HWND 对象锁，不能单独宣称消除所有复用竞态。

注册必须提供实际精确扩展 ID（32 个 a–p 字符），不猜 ID、不接受 wildcard。测试注册器只操作 HKCU `Software\Google\Chrome\NativeMessagingHosts\com.cmspark.cockpit` 和本次 owned 安装根；两 registry view 观测到同一个 shared key 时仍须完全匹配唯一 REG_SZ 默认值、manifest、精确 ID 与固定 EXE hash。已有不同注册或子键立即拒绝。卸载只移除仍精确属于本次根的配置，不动其它 native hosts；临时 framing 注册先完整清理，controller 才建立另一个 live owned 注册。

2026-10-22 经用户明确批准，自动 CI 移除首个身份验收及其专属有限失败产物上传。独立入口 `scripts/tests/run-cockpit-bridge-first.ps1` 保留，供另行安排的隔离 Windows 验证；其失败仍以非零退出报告，不被当作通过。CI 绿色不证明 #723 身份、窗口遮罩或原生清理完成。该独立验收读取已审源码 pin 表 `scripts/tests/cockpit-bridge-browser-admission.cjs`，仅接受一个固定官方 Chrome for Testing win64 ZIP 的版本、URL、归档长度/SHA 与 EXE SHA。空 pin 是 NOT_READY，发生在任何下载、npm、注册或 launch 之前；不选择系统 Google Chrome，不取 latest。branded Chrome 137 起的 `--load-extension` 限制不能通过“文件存在”或 runtime boolean 绕过。

供应器只有一次固定官方 URL 的 HTTPS transfer：**新增 600000 ms 网络准备预算，无 retry、无 redirect**。校验精确 Content-Length、完整归档 SHA、ZIP32 结构、每项 CRC/展开长度、Windows 路径唯一性及 EXE SHA，只解包到新 owned 目录，不安装或执行供应文件。此准备预算不改变原 45 秒 native surface 预算、5000 ms bind 窗口、原 job 步骤或原验收阈值。下载失败保留 owned partial；不自动换来源。

该独立验收不依赖另一个 build job 的前端 node_modules，因此准备阶段在当前候选源码上执行 frontend `npm ci`、真实 build 与测试编译；npm 仅使用 public registry、owned 空 user/global config/cache。所有新增 Node/PS/npm 子进程显式白名单环境，不继承 provider/proxy/Node hooks/HOME/USERPROFILE；只保留既存 job orphan tracking 值。随后依次执行 C# framing/owned 注册负控、真实序列化 receipt 的 document CPU 消费，随后执行同次固定源码的 build preparation，再进入原 controller：交接 live host／Job 产物、Job CPU 一次、实际 candidate extension + CFT。两个 host build 属于不同的 scratch/live owned 目标，不把 scratch receipt 冒作真实身份。

controller 的隔离壳在 unnamed Job 关联 completion port 后，以 SUSPENDED 创建 Chrome，Assign 后才 Resume，不允许 breakaway。清理必须在原剩余预算中收到同一 Job 的 ACTIVE_PROCESS_ZERO；单 child close、PID 枚举或 kill 返回不算整个树已清理。真实 document→native parent/pipe→当前 owner/auth socket→server verified 正控及父句柄不支持、旧 owner/迟到、伪 receipt、断线和清理负控都须真实验收。不能证明则 UNKNOWN/失败，不放宽隔离、另加 timeout 或启用 mask。

惰性 CPU/源码检查和 C# framing 控只证明对应受控输入。它们不证明真实浏览器、Win32 pipe/窗口身份、native cleanup、opaque self-scope、双帧 mask 或整张 #723 已完成；原四 dialog channels、阈值、L2 与 macOS 既有 owner 规则保持。

### 同次编译与原生阶段分离（用户明确批准）

原编译、运行和清理共用 45 秒。新合同将固定源码的 build-only preparation 限为 120 秒，之后原 controller 的运行与清理仍限 45 秒；两段成功窗口总计最多 165 秒，不能与旧整体 45 秒测量等同，也不称冷启动或历史根因已修复。原 5000 ms bind、身份、权限、零重试及 Job ACTIVE_PROCESS_ZERO 清理要求保持。

准备阶段在本次新 owned 根内并行调用原两个 PS5.1 builder，保留原编译参数和全部好／坏源码控制；不执行 EXE、不注册、不启动浏览器。两个原子进程须真实 close／exit0。120 秒超时锁存失败，仍等待原进程关闭；晚到成功不能进入原生阶段，不以只杀 PowerShell 父进程冒充编译器树已关闭。失败后的 drain 可以更久，但该次始终失败，不能计为预算内成功。

三个固定 EXE 与原 host 摘要仅从同次 prepared-build 交接。16 KiB 有限清单绑定运行 nonce、根／目录身份、五份固定源码及四份输出的 SHA 和文件身份；它不是动作授权。controller 只接受父进程给出的 nonce，持有只读 FD 跨固定 PS FileAttributes 非 reparse 查询，再核文件名／FD／摘要，独占复制至本次空安装目录。交接和查询计入原 45 秒；任何来源、身份或关闭回执未知即拒绝，不复用其它运行、缓存或注册夹具产物。

该功能的验收仍须精确候选的真实 Windows build／身份／清理证据；这项独立功能验收不再阻塞无关 PR 的自动 CI 合并。合并仍须其余必过 CI，再核精确 main。惰性 CPU、ownedFS 和 ARM 不替代 PS5.1 或 Win32 验收。
