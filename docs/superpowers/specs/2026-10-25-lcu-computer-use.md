# LCU 桌面后端集成

GitHub: #775 — https://github.com/nehcuh/cmspark/issues/775

状态：实现规格；用户已确认按 LCU 当前正式版检测对应桌面运行时。

## 目标与基线

让 CMspark 的主对话使用本机 LCU 提供的原始 computer-use runtime，而不是仅发现一个 `codex` 命令就宣称可用。默认关闭，安装与权限由用户控制。

适配基线为 LCU v0.13.0 / `c38f4b6286ba74ebf053c2b3d1970e387556a559`。其 README 与安装文档要求本机官方 ChatGPT 桌面应用；独立 Codex CLI 不满足运行时依赖。发布平台为 macOS arm64、Linux arm64/x64（glibc/X11/D-Bus）；Windows、Intel Mac、Wayland、musl 不宣称支持。

上游的 MIT 许可覆盖 LCU 的开源适配代码，不将本机 OpenAI 应用或运行时复制进 CMspark 安装包。此项不改其他 agent 配置，不安装 LCU、Chrome 扩展或录音组件。

## 用户流程

设置中的 Computer Use 增加独立 LCU 区域：检测到的可执行文件、版本、所选桌面应用/运行时版本、兼容状态、启用状态、限制说明和官方安装入口。缺 LCU 时仍显示入口；不以 PATH 中存在 Codex 作为成功依据。

检测分两层：无副作用的候选路径发现，以及用户主动触发的 `lcu status --json` 兼容检查。后者只投影所需状态，不存储/广播上游 setup、pending、日志目录或诊断原文。生产检查通过独立 argv 启动，拒绝 shell 模板、相对命令及附带任意参数。检测成功不是原生操作验收。

首个可启用切片为 macOS Apple Silicon 上的认证扩展主对话。它复用现有原生生物识别确认渠道。Linux 先提供安装路径发现，不启动兼容检查或桌面操作；原始 Linux runtime 没有逐 App elicitation，CMspark 不把其现有浏览器手输 nonce 当作新增全桌面执行的安全证明，操作启用在独立平台授权验收前保持关闭。上游支持与 CMspark 已交付平台分别展示。Windows 不启动候选安装器或运行时。

启用是新能力授权，必须经现有生物识别门，默认 false。停用总是可用：阻止后续动作，取消待确认请求，终结当前拥有的 LCU turn 和 transport。全局 Computer Use 关闭也必须阻止 LCU；启用 LCU 不静默批准任何 App。CMspark 原生后端继续存在，不把 LCU 宣称为旧的窗口白名单或自窗遮罩实现。

## 运行时合同

使用官方 MCP SDK 与已有 owned stdio transport，建立专用适配。LCU 不经过只支持普通字符串结果的通用 MCP 快捷配置来冒充完整集成。

每个真实 chat run 拥有一个独立连接，身份来自 Companion 的 thread 与实际 execution ID，不接受模型参数覆盖。首次模型请求之前，握手、读取并冻结原始初始化 instructions 与原始 `js` / `js_reset` 描述。原始 instructions 保留不改写；只在外围说明 CMspark 的工具名称映射和本机授权边界。host-only `turn_ended`、`js_add_node_module_dir` 等不能进入模型目录。

模型工具是独立 LCU 工具，不替换旧 `host_computer` 参数语义。每次调用仍需当前 thread 允许、非 plan_readonly、原调用方仍有效、全局与 LCU 开关仍开启、真实 run 未结束以及交互式高风险确认。取消当前对话的 LCU 选择、撤销工具白名单或切入计划只读模式，会终结该线程旧的 LCU turn；不能通过先撤销再恢复选择复活旧连接。不得利用 god-mode、自动批准或旧 host_computer 的信任缓存免除新边界。worker、outbound MCP、summoner 和无确认通道的入口不提供该能力。

`_meta.x-codex-turn-metadata` 由宿主填真实 session_id / turn_id / call_id。请求元数据不从模型 JSON 透传。一个 run 的 reset、状态和变量不能干扰另一 run；不会在错误后重放原 JS 动作。

仅处理上游实际已有的、无任意表单字段的 computer-use App elicitation：保留原始 message、App 与风险；首期仅支持当次授权和拒绝，不自动选择上游提供的 session/always 持久授权。未知请求形状、无 owner、断连、取消、过期或迟到回复均拒绝。模型没有回复 elicitation 的工具；不写上游授权文件、不启用 Chrome 或录音。禁止批准承载本 agent 的应用，遵守原始 runtime 的拒绝。

正常结尾发送原始 `turn_ended` Stop，取消/替换/错误用 Interrupt；随后关闭拥有的 transport。清理失败保持 UNKNOWN，不标记原动作成功，也不自动重试用户动作。关闭期间不接受新动作。只记录阶段、错误类别和数值，不记录完整 JS、屏幕像素、原始 stderr 或 App 内容。

## 图像与模型上下文

当前 canonical tool message 只接受字符串，因此补专用、受界限约束的 LCU 结果投影。原始 text、isError 与图像 MIME/字节语义保留；图像作为标明来源为工具观察的临时多模态内容传给当前模型，不将 base64 截成一段文字。投影不把 UI 文本当用户新指令，不保存截图到聊天正文或日志。

首期只对已确认支持原生图像输入的当前模型提供 LCU 工具；不自动更换模型或调用另一模型/服务。无图像能力时明确说明原因。图像数量/体积有界，坏 MIME/base64、音频或不支持内容形状明确报错，不能编造截图描述。

## 验收

机器验收先于源码复审。必要 focused 用例包括：路径/平台/版本与真实 status producer 合同；默认关闭、撤销与检查中切换；实际 MCP SDK 握手/原始指令/工具闭集；真实 run 元数据、并发隔离、迟到授权、取消与 host-only 隔离；原始 text/error/image 转换与日志/持久化不含像素；Stop/Interrupt 清理与不得重放。

测试 payload 来自锁定上游的真实 producer 或其真实测试 server，不手搓假设字段。CPU/内存传输证明协议与状态机，不冒充桌面操作。原生验收需在用户实际安装依赖并明确绑定一个拥有的测试应用后完成：读取窗口 → 一次受控输入 → 观察结果 → 停止后无新输入；不启动本机未经授权的 GUI/native/provider 实验。

冻结同版完整受影响 diff，恰好两路独立非作者复审；不作者自批、不加第三第四票、不重跑既有无关验收。正式 CI 与真实桌面证据分开记账。此批代码只按默认关闭的实验接线评审：机器检查、同树两路独立非作者放行和正式 CI 是该受限组件的合并门禁。没有真实桌面证据时，始终保留“实操未验收”，不得将代码合并称为原生验收完成，也不得关闭整个 #775；正式桌面支持声明仍以实际依赖和拥有的测试应用验收为准。

## 能力声明

T3，新默认关闭的桌面执行桥。Surface=L2 本机主对话；L2-classes=桌面读/输入与执行；Compose=认证连接+真实 run+owned MCP transport；Autonomy=不变；Trust=仅显式授权，不从页面/模型提升；Channel=既有认证 UI 与原生确认。

不扩大旧 Windows 诊断次数、旧冻结能力或 #723 的 self/mask 范围。先前已完成的 PR、CPU、源码票和主线 CI 不重做。


## 2026-10-26 有限原生资格记录

精确 darwin/arm64、LCU 0.13.0、ChatGPT 26.1016.61520、CUA `0.0.33/20261020111233-d92591792fee` 已在自有空白窗口完成读取、固定输入、AX 与自身 producer 内容核对、JPEG 返回及 Stop 清理。只允许这个精确 tuple 使用独立 CMspark 资格记录，不改上游 `untested` 或 `nativeVerified:false`，不外推其它应用、像素正确性或完整模型任务。未知/更新组合继续拒绝；逐次检测、安装身份、人工确认、Touch ID、App 当次授权和 cleanup quarantine 保留。[有限记录](../../testing/lcu-owned-pad-20261026.json)。
