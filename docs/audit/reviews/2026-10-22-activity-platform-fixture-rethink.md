# #758 Windows 测试夹具重想（T1）

## 真实反例与边界

整合 head `e2f661e302623090bbd25d175cbd49c6d58a101b` 的 [run39700966925](https://github.com/nehcuh/cmspark/actions/runs/39700966925) 中，Linux X11 原生专项、build、macOS、Ubuntu、ACP restart 已 SUCCESS。Windows #758 原生在约10,069ms 拒绝 `OWNED_ACTIVITY_FIXTURE_NOT_READY {"phase":"UNKNOWN","stderr":""}`，发生在 own fixture 就绪之前，未执行该次产品采集/OCR。此前 `81057e01` 的同一专项实际1PASS/0SKIP仍是那个head的正证，不能覆盖新失败。两次就绪失败均未定位实际API/原因，保留 UNKNOWN。

达到原方法的有界调查上限后，负责人重想测试架构：直接编译并启动独占 WPF GUI，而不是由 PowerShell 承载该测试窗口。不把这称为已证明的因果修复，不增加等待，不开始历史 #723 的另一轮实验。原 PS 测试夹具和失败可从前序commit/日志恢复。产品 `src/host-use/win/scripts/activity-windows.ps1` 未改。

## 不变的验收

原90秒总预算、10秒ready预算、实际PID/HWND绑定、前台不变、真实被动像素/本地OCR、最小化拒绝、通知提交，以及child close后才settle的lease和清理均保留。新增固定 csc 编译10秒包含在原90秒内，不构成独立延时豁免。不改CI工作流、权限、skip、不添加重跑或历史 #723 标记。

仅在GitHub Actions Windows专属验收环境允许启动该窗口。固定系统 Framework64 csc 和7份实际系统引用，无PATH查询、缓存产物或shell。全新私有目录编译，真实退出才返回，失败/abort清掉部分产物；GUI以 `winexe` 启动，不涉及用户聊天工具。原有限ready/ack/failure协议和一次owned窗口初始激活保留。

## 本地机器与未运行项

Node22.23.2、清洁环境正式Companion build与完整test类型编译；实际observer/compiler producer控制5项 + platform12项 + activity28项，共45项。编译producer的边界使用明确标注的惰性文件和注入的编译器，验证真实固定argv/references、缺引用拒绝、部分失败清理、取消及缓存拒绝，绝不声称这些惰性文件是真实PE/系统SDK。Mac没有Windows WPF运行环境，因此实际C#编译、实际GUI和Windows产品原生新路径均NOT_RUN，必须由新head Windows CI证明。

T1仅测试架构调整，产品、UI、包装和工作流字节均不变，复用此前T3独立对抗→Pi有效意见。本次另做一次有界独立源码检查；新路径只进行一次有意义的changed-head原生验收，如仍不足即保留UNKNOWN，停止猜修/追加标记/加时。完整CI还受已知主线 #723 原生门红灯约束，任何专项绿均不自动等于合并放行。

## 4行case

1. 执行真实owned WPF就绪测试及有限首错观察，再次在10秒内得到UNKNOWN，未观测到产品阶段。
2. Linux及各非Windows-native门通过；新Windows就绪失败，不用旧正证覆盖新反例。
3. 归责：夹具启动/调度原因未知；不能凭空stderr或耗时归因某cmdlet、API或冷启动。
4. 保护实际窗口身份/像素/OCR/不恢复最小化窗口及不伪造CI完成；重想测试载体保持原断言/预算。

## 有证据的编译生命周期修复

首轮独立对抗REJECT一个P2：真实Node22 `promisify(execFile)` 的abort拒绝先于child close；原45项惰性编译边界控制未覆盖。保留完整首轮报告。默认producer现在保持原参数和拒绝，但finally await它实际child的close，之后才清理/返回；未改原90秒/10秒预算。真实惰性Node子进程对照三次：旧producer每次拒绝时close=false，实际新producer每次拒绝时close=true。它不是C#或桌面验收。完整测试类型编译通过，相关46PASS/0FAIL/0CANCEL/0SKIP；正式build此前同产品字节通过。

一次补充命令误用不存在的旧编译测试名，仅执行17项，不能冒45项；更正为实际 `activity-752.test.js` 后45项实际通过，本次修复后46项实际通过。

独立增量复审APPROVE，独立46项控制通过，原P2实际close边界闭合。冻结差量SHA256 `16a46aa1e42b93938eb8bd9d6f5da724e145becfbdd5b3b9075bb117dad50096`；之后只补本结论及原样独立报告，无源码再变。此T1意见仅允许计划的一次changed-head Windows验收，不提前宣称C#/GUI成功，不放行主线#723。
