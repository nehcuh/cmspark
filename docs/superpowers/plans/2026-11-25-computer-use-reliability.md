# macOS 与 Windows 桌面操作的授权与可靠性

GitHub: [#906](https://github.com/nehcuh/cmspark/issues/906) · 调研基线 `47306be4` · 2026-11-25

用户应能从应用面板选中目标，知道第一次确认覆盖哪些操作，并在任务中断时看到具体原因。本次沿用白名单、确认台、原生适配器和急停，优先修正日常主对话中的实际故障。已有授权模型见 [ADR-017](../../adr/017-computer-use.md)、[ADR-021](../../adr/021-unattended-desktop-session.md) 和 [LCU 接入规格](../specs/2026-10-25-lcu-computer-use.md)。

## 社区做法与取舍

| 一手资料 | 可借鉴的做法 | CMspark 的选择 |
| --- | --- | --- |
| [Cua Driver 权限设计](https://cua.ai/docs/cua-driver/guides/permissions) | 在运行时统一核对应用、工具、资源和授权期限。限定范围的会话可以安静地执行范围内操作。 | 从 Companion 已有的应用身份、只读会话和任务预算导出 UI 状态。保留当前产品已承诺的人工确认条件。 |
| [Cua Driver 平台说明](https://cua.ai/docs/cua-driver) | 驱动区分后台与必须置前的应用，Windows 依赖已登录的交互式桌面。 | 在宿主原生路径优先采用已经验证的窗口与控件操作。某个程序能够在后台读取，不代表它也能在后台输入。 |
| [OpenAI computer use 指南](https://developers.openai.com/api/docs/guides/tools-computer-use)、[集成示例](https://developers.openai.com/api/docs/guides/tools-computer-use-integration) | 驱动负责权限、会话和清理。有序执行允许的动作，取得新的观察，用应用状态验证任务结果。 | 同应用且预先确定的步骤可组成一个有界任务；界面发生未知变化时重新观察。无法确认结果的输入保留未验证状态，避免重放。这里依据公开 API 文档。 |
| [Microsoft UFO 控件检测](https://github.com/microsoft/UFO/blob/main/documents/docs/ufo2/core_features/control_detection/overview.md) | 原生 UI Automation 适合标准控件，视觉补充自绘界面。 | 保留已有 UIA、AX、OCR 分层。无控件或无权限时返回对应原因；增加视觉模型不会修复授权时机、窗口几何或身份错误。 |
| [pywinauto 远程执行实务](https://pywinauto.readthedocs.io/en/latest/remote_execution.html) · [Microsoft 的 UI 自动化权限说明](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview) | 键鼠投递依赖活动桌面。RDP 断开、窗口最小化和目标进程的完整性级别会改变可执行的操作。 | Windows 整机验收分别覆盖活动会话、断开及高权限目标；窗口枚举通过后，仍要单测输入是否到达预期控件。 |
| [Cua Bench](https://cua.ai/docs/cua-bench) | 为同一任务设置独立的初始状态和结果检查，跨变体复用完成条件。 | 用自有窗口、固定文本和目标应用回读验收；分开记录源码测试、原生 API 与完整桌面任务。 |

Cua 的两份现场记录直接影响验收设计。一份已修复的问题中，命令行探测到了父进程终端的辅助功能授权，却把它显示为驱动已获授权。CMspark 的安装包应由真正执行操作的责任进程核验权限，并记录签名身份。另一份开放问题记录了操作打开对话框后旧窗口标识仍被沿用的情况。针对这类故障，优先重新枚举应用窗口、观察新目标并核对身份，再决定下一步输入。[Cua 授权归属问题与维护者结论](https://github.com/trycua/cua/issues/1561) · [Cua 弹窗后的窗口重绑定问题](https://github.com/trycua/cua/issues/2238)

CMspark 的 Mac 宿主与 DMG 当前使用 ad-hoc 签名。此次修复消除了托盘启动时由产品主动触发的 AX 请求。跨版本授权保留还取决于系统能否将更新识别为同一应用，应使用发行团队的 Developer ID 和稳定的代码签名要求构建两个版本，在同一台 Mac 上覆盖升级并实测。开发机或 CI 上验证通过的 ad-hoc 签名只能证明该次构建的身份及完整性。[Apple 的代码签名要求](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements) · [项目 DMG 脚本](../../../scripts/create-dmg.sh)

## 当前调用链

- 网页内已有浏览器工具时直接读页面或操作控件。原生应用已有受支持的结构化操作时，使用相应的 `host_read` / `host_write`。需要原生窗口时进入 `host_computer`。
- 原生主路径是扩展应用面板 → Companion 的应用及坐标授权 → 主对话的 L2 准入 → 任务执行器 → macOS Swift helper 或 Windows PowerShell/Win32、UIA → 观察与任务回执。面板展示的是服务端状态，前端开关本身不能授予权限。
- LCU 是另一条可选执行路径。此项目锁定的集成只在符合资格的 Apple Silicon Mac 开放，需要图像模型、认证主对话以及独立的代码与 App 确认。Windows 的原生操作无需 LCU。Cua Driver 是此次参考的另一项开源项目。

## 实施顺序及验收

1. **先排除走不通的入口。** 在应用面板把手填的 macOS Bundle ID 以服务端接受的字段发送；Windows 使用可执行文件路径。由 Companion 用实际政策计算应用是否可申请持久坐标授权，浏览器指向单次任务确认，受保护应用显示限制。检查列表、更新广播与旧版服务端兼容。实验设置明确引导到原生入口。
2. **只为有效的权限变更弹窗。** 在 `computer/handlers.ts` 用真实配置和可延迟的确认通道复现重复启用、并发点击和等待中关闭。验收相同状态零新增认证、重叠启用至多一个在途认证、关闭后迟到批准不能重新开启。保持调用方身份和新授权的交互门槛。
3. **把失败前移。** 用主对话的 L2 准入验证不能执行的动作草案，确认之前拒绝。只有需要展示人工确认时才构造其原生预览。验证原有只读同意和输入授权的边界、无确认渠道与人工拒绝。
4. **分别修原生适配器。** macOS 区分被动检测与显式授权，保留已有急停机制，并区分录屏缺权与目标窗口或捕获失败。Windows 在截图与输入的置前过程中保持当前窗口几何，实际核对目标窗口状态。针对各自的真实消费者和负例执行验证。
5. **验证实际用户任务。** 在两端各用自有测试窗执行“打开窗口 → 查看 → 填入固定文本 → 回读 → 停止”；计数操作系统提示、产品授权、任务确认以及发生失败的阶段。相同线程重复读取、切换应用、拒绝后停止分别计数。使用同一平台、权限初态和窗口布局比较基线，只将实际运行过的部分记作通过。

## 哪些请求应该出现

| 情况 | 产品预期 | 用户的下一步 |
| --- | --- | --- |
| macOS 打开托盘，尚未使用桌面输入 | 急停辅助程序可被动检查已有权限；不主动调出辅助功能授权 | 要使用全局急停快捷键时，先确认相关系统授权并重启应用；面板也可以停止任务。 |
| 首次启用原生操作，或给普通应用第一次授予坐标权限 | 明示用途并做身份验证；已有的全局授权重复提交不会再打开认证 | 全局开关和应用菜单分别管理两项授权。 |
| 同一已认证连接、对话和应用连续观察 | 首次人工同意、成功读取且主体有效后，后续纯读取可复用同意 | 新应用、连接、配置或失败需要重新核对。读取同意不授权输入。 |
| 已批准在原生应用内完成一组输入 | 按已展示的文字、目标和预算执行；只有符合会话信任条件的后续任务才能复用 | 新文字、风险信号或范围变化时重新审核。后台 OCR 不延长人工批准的有效期。 |
| LCU 代码调用和运行时的 App 授权 | 完整代码审核、原生认证与运行时按需提出的 App 确认为独立步骤 | 日常原生窗口任务选原生路径。不能把授权任意 JS 与授予某个窗口的一次点击合并。 |

## 复现与本次实现

- **设置和应用选择。** 旧界面提示填写 `com.apple.Notes`，发送的却是 `path`，在服务端绝对路径检查失败。应用发现也漏掉了 `/System/Applications`。现按 Companion 平台发送标识，异步读取系统、共享和用户目录里的应用，按 Bundle ID 去重；服务端沿用同一套策略向列表及更新广播投影授权方式。系统应用和普通应用在 Finder 中可同时显示。[Apple 开发者支持](https://developer.apple.com/forums/thread/784220)
- **无效或重复的确认。** 原全局开关对已启用状态再次调用生物验证，等待批准时关闭也不能阻止迟到的批准。现在重叠请求共享一个在途状态，只有发起者可以完成这次授权。主对话准入复用执行器的草案校验，阻止缺少坐标与锚点、空任务、输入语料超限等请求进入确认台。有效信任路径不再额外截取一张仅为弹窗准备的预览。
- **同一应用的重复授权。** 两个面板快速启用同一应用时，历史实现会发出两次认证；原先已关闭的应用收到撤销请求后，迟到的批准仍可能落盘。现在每个应用只允许一个授权请求在途，撤销、断开连接、身份变化或拒绝均终止原请求。回归在旧代码复现 5 个失败，修复后覆盖该逻辑的 227 项测试全部通过。
- **macOS 的故障归因。** 发布用 Swift 宿主的急停初始化在启动时主动请求 AX。截图又把运行时错误、目标缺失与拒绝录屏混为一类。现被动检查当前 AX 和监听授权，截图按原始错误域和类别报告；捕获错误保留有限数字码。Apple 区分录屏被拒和流启动失败。[Apple 用户拒绝录屏](https://developer.apple.com/documentation/screencapturekit/scstreamerror/code/userdeclined) · [捕获启动失败](https://developer.apple.com/documentation/screencapturekit/scstreamerror/code/failedtostart)
- **Windows 的窗口几何。** 原生私有桌面复现了标题字符丢失、矩形序列化成字符串、最大化窗口置前后被还原，以及最小化恢复截图在保存前校验失败。枚举改用 Unicode API 并完整保留矩形。仅在目标已最小化且允许主动捕获时恢复，并在恢复后读取边界。Windows 能拒绝前台请求，输入前继续检查实际前台。改后的私有桌面取得真实 560 × 400 PNG，窗口状态经 Win32 回读。[Microsoft ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow) · [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)

## 本次验证记录

| 环境 | 实际执行与观测 | 覆盖边界 |
| --- | --- | --- |
| Windows 开发机 | 扩展全量测试通过 2,046 项。Companion 定向回归通过 615 项，按平台条件跳过 7 项。两端 TypeScript 通过编译。 | 覆盖准入、确认复用、过期、拒绝、撤权、应用策略和消息合同。 |
| Windows 原生私有桌面 | 以包含中文和 emoji 的标题验证 Unicode 枚举，核对数值型坐标，解码恢复后得到的 560 × 400 PNG，通过 Win32 回读确认最大化状态保留。 | 用真实窗口调用系统 API，未向使用者的前台应用发送输入。 |
| Chrome 158 临时配置 | 渲染实际 AppsPanel 组件，分别模拟 Mac 和 Windows 的 Companion，逐项点击核对手动添加、授权、撤权、断线禁用和重连刷新。 | 真实浏览器与 DOM，运行时消息及 Companion 状态模拟。 |
| [macOS ARM64 安装包构建](https://github.com/nehcuh/cmspark/actions/runs/45508463622/job/138849691536) | 编译实际 Swift 宿主，签名后核对 `com.cmspark.agent`，执行包含 `screen_capture_permission` 的分类自检，构建并上传 DMG。 | 构建使用 ad-hoc 签名。此次自检向分类器传入原生错误对象，首次授权与覆盖升级仍需交互验收。 |
| [Windows x64 安装包构建](https://github.com/nehcuh/cmspark/actions/runs/45508463622/job/138849692230) | 打包流程完成，已上传安装产物。 | 安装包构建与登录桌面中操作第三方应用是两项验收。 |

在开发环境中，按项目要求选择 Node 版本后，可在 `companion/` 目录重跑关键回归。最后一项在 Windows 上会创建私有桌面并实际执行 PowerShell 宿主脚本。

```sh
npx tsc -p tsconfig.test.json
node scripts/run-tests.mjs .test-dist/tests/apps-coordinate.test.js .test-dist/tests/apps-grant-race-649.test.js .test-dist/tests/apps-list-race-655.test.js .test-dist/tests/apps-gui-template-686.test.js
node scripts/run-tests.mjs .test-dist/tests/integration/confirmation-preview-532.test.js .test-dist/tests/transient-rate-feedback-730.test.js .test-dist/tests/session-trust-v4.test.js
node scripts/run-tests.mjs .test-dist/tests/apps-enumerate-macos.test.js .test-dist/tests/computer-darwin-estop-owner.test.js .test-dist/tests/computer-darwin-capture-degraded.test.js .test-dist/tests/computer-input-ps1.test.js
```

## 后续优先级与验收方法

| 优先级 | 做什么 | 决定是否交付的证据 |
| --- | --- | --- |
| P0 · 本次代码 | 修上面的准入、授权、应用选择和两个原生驱动问题。 | 双端受控准入测试中，无效草案发出 0 次确认、生成 0 次预览；已批准的同类任务生成 0 次确认预览；Windows 实际枚举字段、截图尺寸与最大化状态逐项核对。 |
| P1 · 两端整机验收 | 在发布形态的 Mac 和 Windows 安装包上，分别跑首次使用、重复只读、受控输入、目标切换、窗口遮挡、取消、急停和重新连接。Mac 另测同版本重启及升级后的系统授权；Windows 另测双屏不同 DPI、普通与已提升的目标进程、锁屏。 | 每个场景保留平台版本、签名/安装渠道、已有授权、各层弹窗数、首错码、耗时和目标内容回读。成功定义为目标内容相符或按预期拒绝，停止后没有新输入。一次点击已投递却无法核验时保留未知。 |
| P1 · 区分系统问题与产品问题 | 按本次首错分类完善设置中的按需诊断。Mac 核对真实发行包在系统设置中的责任应用，记录换版本前后是否再次要求批准；Windows 区分交互桌面、完整性级别、窗口不存在和前台不给予。 | 用户能从一个失败结果直接找到对应修复方法；同一不可恢复状态只提示一次，不自动提升权限或重复发送输入。Windows 的输入受 UIPI 约束。[Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput) |
| P2 · 评估新增驱动 | 先用同样的自有窗口对现有 UIA/AX 与 Cua Driver 做对照，按标准控件、自绘控件及浏览器分组。比较读取、填表、窗口切换和回读。隔离桌面与用户正在使用的桌面分别评估。 | 按组报告完成数/尝试数、每任务人工介入数、耗时中位数与 P95、前台或光标被打断次数。在特定组有可重复收益且能接入已有撤权、应用身份和停止机制后，再决定是否增加可选后端。 |

现场统计只记录阶段、耗时、类别和计数。按平台、应用类型及冷/热授权状态分别计算，避免把安装时的一次性系统同意与每个任务的确认相加后作为“弹窗率”。当前没有用户群任务成功率基线，也没有足够数据报告整体改善百分比。新增逻辑沿用既有服务端配置；回退可按应用发现、准入与平台适配器分别撤回，不需要迁移白名单或复制授权记录。
