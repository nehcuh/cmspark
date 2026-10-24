# Windows / Linux 活动适配：机器证据

Issue [#758](https://github.com/nehcuh/cmspark/issues/758)，PR #757；base `57b808651dccede3555ac64ebbd45aead393ab73`。合同见 [跨平台计划](../../superpowers/plans/2026-10-22-activity-cross-platform.md)。T3：用户选定应用的只读前台截图，本地 OCR；既有独立模型同意、候选与人工确认保持。没有执行真实聊天采集、模型外发或修改用户安装。

## 已执行检查

- macOS Node22.23.2：Companion 与扩展正式构建通过。最终源八个受影响家族 **83 PASS / 0 FAIL / 0 SKIP**，使用清洁环境及原 test-data-dir preload。包括活动、平台、认证 transport、路由锁步、语义设置、MCP 原子配置/保存及真实 MeetingPanel 消费者。
- 扩展完整 **1,807 PASS / 0 FAIL / 0 SKIP**；既有 ACP 实际源码消费者 **86 PASS / 0 FAIL**。
- 非 root Linux aarch64 / Node22.23.3 / `--init` 容器完整 Companion `npm test` exit0。三段 TAP 分别为6186+172、2318+7、20+0（PASS+SKIP），总计 **8,524 PASS / 179 平台条件 SKIP / 0 FAIL / 0 CANCEL**。此完整快照早于最终锁屏 broker 与本机 DISPLAY 限制，不冒称最终字节全量。
- 最终 Linux 增量 **55 PASS**；真实原生 **1 PASS / 0 SKIP**：自有 Tk 窗口、真实 XRes PID、焦点和像素、本地 Tesseract、伪造 `_NET_WM_PID` 不改变授权、遮挡/最小化拒绝、XScreenSaver、锁屏 broker true/unknown 拒绝、通知提交；无前台补救。锁屏 broker 是私有 D-Bus 上明确的受控服务，**不证明真实 GNOME/KDE 锁屏实现**。
- Linux 原打包门 **159 PASS / 0 FAIL**；Darwin 分支按原平台条件跳过。`git diff --check`、脚本语法检查通过。Linux Python sidecar 随源码构建及独立包资源保留。
- 真实 App 受控浏览器 **9项交互通过 / 0 Runtime 异常**：手动模式与默认关闭、不能枚举/启用自动采集、OCR语言保存独立、实际 FileReader→RPC→真实服务导入、明确导入日期而非消息时间、人工确认生成待办、1440/768/390 无横向溢出。模型/原生工具是明确的惰性 fixture，数据为自有窗口图片，未连接 live Companion。

命令范围、日志 SHA-256 和本机留存位置见同名 JSON；截图和浏览器回执留存于 `platform-758` 可视化目录。Windows 原生尚未在本机执行，必须在精确提交的 hosted Windows lane 验证新 WPF/WinRT case；已有 #723 原生门继续保留。新 Linux native lane 独立创建私有 Xvfb/D-Bus。

## 保留的失败与准备错误

1. 首个容器 PID1 为 sleep、未使用 init，原进程清理家族超时；实际 `/proc` 观察为 PPID1 僵尸。改为 `--init` 后原21项通过/5原平台SKIP，没有改时限、回调或生产代码。归责：AI 验收准备错误；保护真实 close/reap。
2. 新容器缺 git，完整 suite 两处 `spawnSync git ENOENT`；安装实际依赖后原7项与全量通过。归责：AI 准备错误；不冒产品 RED。
3. 本机原打包检查160通过/1失败：已有 tray 但没有 host/scpt，较早的缺 host 拒绝遮住 tray 缺失断言；保留原拒绝，未伪造产物。干净 Linux 原脚本159通过，Darwin原生打包不在本次 DoD。
4. 额外本机回归误继承 provider 环境，使原 MCP 缓存/落盘比较三处失败；原日志已脱敏留存，清洁环境原83项通过。归责：AI 操作器错误；没有读改 live config、改断言或调用模型。首次定向命令还误用了不存在的编译测试名，runner明确拒绝；改为实际发现的测试文件后执行。
5. 浏览器首轮选择到隐藏聊天附件 input，未验证目标导入。改为实际 aria 标签定位，重新启动独立 fixture 后9项通过；未改产品行为。

## 验收限制及闸门

Wayland/无桌面只提供主动 PNG 导入，不声称后台轮询。SSH/TCP DISPLAY 不授予本机采集。真实微信/钉钉识别准确率、实际中文系统语言包及系统通知的视觉展示/已读未验证；通知仅记录真实提交结果。没有替换安装包或开启用户采集。

MACHINE：上述范围 PASS；WINDOWS_NATIVE：待精确 CI。独立对抗 → Pi 尚待完成；不宣称 merge-ready 或已合并。


## 对抗 cycle1 修复及有界复验

独立报告发现唯一P2：正式Windows standalone/SEA路径不能用裸 `require.resolve` 取得未staging的SnoreToast。修复两个实际Windows打包入口的固定 `activity-bin` 资源和LICENSE staging；运行时先查真实exe/flattened JS旁固定资源，开发fallback改为文件系统 `createRequire`，未externalize纯JS依赖。新回归执行实际esbuild输出，从无项目node_modules的独立目录验证缺资源失败→实际staging字节一致且resolver成功→删除资源再失败，同时缺source拒绝及两个producer调用保留。

正式Companion构建及原平台12项再次通过；macOS和Linux上新standalone资源测试各1项通过，Linux原打包门159项通过。新测试首轮macOS遇到`/var`与`/private/var`别名差异，明确改为创建时固定同一真实根再作严格相等断言，未弱化路径比较。保留原RED日志；这是夹具操作器路径域错误。最终diff仍待独立增量复审及Pi，原Windows hosted执行条件不变。


## CI 旧消费者闭包补齐

推送前额外执行原 `nsis-ci-setup` / `windows-ci-feedback-750` 家族，实际发现新增job/原生step/资源测试使旧完整工作流pin拒绝；属于本次漏补消费者，非环境或历史原生失败。暂停尚未输出结果的Pi，未用旧批准推送。保留原RED；从真实当前YAML录制仅3个新增对象（Linuxjob、Windowsstep、build资源step），以固定摘要/完整对象核对后才从旧视图归一化这一个确定增量；原baseline摘要、旧失败/取消/上传/顺序门保留。增加缺失、错lane、弱化失败、错编译顺序和遗漏bundle测试的8个负控；原整家族和新增负控实际通过。只变更测试契约，无生产/工作流再变化，须独立增量复核后重新Pi。


## 最终源码闸门（推送前）

独立R2/R3均APPROVE；Pi读三份完整报告及同一冻结差量后APPROVE_WITH_NITS（CLI0.85.1；自报deepseek/deepseek-v4-flash，非provider-attested）。Pi独立重跑87个工作流控制、1个实际bundle资源控制、40个活动/平台控制，并重新编译比对7个实际单元。冻结diff SHA256 `d83e4ed54962359eccea7005b0728b55c662a03713ec96a3a40dc8440b75179f`。之后仅补审计结果/跟踪记录，无生产或测试变化。额外同族脚本122PASS/1原平台SKIP、Companion源码消费者31PASS；均0FAIL。

非阻断意见已由@nehcuh在[#756](https://github.com/nehcuh/cmspark/issues/756)跟踪。核对Pi一处旁证错误：其portable剪裁SnoreToast的引用位于Darwin case，原Windows portable本可找到vendor；实际阻塞为独立SEA闭包，修复已覆盖两种布局。导入6MiB与原生解码8MiB为不同预算，不能因文案意见提高协议限制。

此批准允许推送精确CI，不替代Windows原生验收；目前未合并、未安装、未启用用户采集。
