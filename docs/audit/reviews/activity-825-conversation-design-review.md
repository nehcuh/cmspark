# #825 独立设计验证：Windows 指定聊天范围与聊天内图片

日期：2026-11-02。评审者：独立子 agent `conversation_scope_design`。范围：只读产品源码、运行受控设计原型；没有修改产品文件或实时配置。

## 推荐结论

采用跨聊天软件通用的、用户明确校准的 **聊天内容区域（包含标题） + 其内标题区域**，在同一张被冻结的窗口截图上先做本机标题 OCR 精确核对，匹配后仅将聊天内容裁剪图交给存储与抽取。微信、企业微信、钉钉、飞书、QQ 均走现有 Windows 被动截图/本机 OCR 能力，不引入五套未经实机验证的 UIA 选择器。独立聊天窗口使用同一校准流程。

原生窗口标题可以作为显式配置的前置匹配，但不能单独替代内容裁剪。通用 UIA Name 查找不适合作为当前聊天身份授权：现有 locator 对多个 exact 结果选首项，也允许 substring，目标名字可能只在侧栏或正文中出现。

这是对设计可实施性与隐私路径的批准，不是五款软件具体版本的 Windows 实机验收。实际 Windows 截图、裁剪、OCR 与拒绝路径仍须由 Windows 原生 CI 亲证。

## 已亲证的调用路径

- `companion/src/activity/platform.ts:48`：Windows capture 先核前台窗口/app，再按原权限与被动截图规则采集，并核截图前后 HWND/PID/started/exe/title/geometry 一致。
- `platform.ts:62`：目前直接返回整个截图文件的字节。受控运行真实编译后的 `WindowsPassiveRecorder`，结果与现有自有窗口 PNG 完全一致，未裁剪。
- `companion/src/activity/service.ts:124`：adapter 返回后立即 `addSource` 持久化，之后才 `extractSource`。因此 scope gate 必须在 adapter 返回之前完成，不能只在模型提示词中约束。
- `companion/src/activity/model-extract.ts` 的实际提示词要求转录完整可见文字。若仅核窗口/群名仍把整窗交给模型，侧栏其它聊天预览也在输入中。这是正常 UI 路径上的实际范围缺口。
- `companion/src/host-use/win/scripts/computer-capture.ps1:166` 已有 crop-only 分支；`-Hwnd 0 -CropOf ... -CropX/Y/W/H` 使用 `System.Drawing.Graphics.DrawImage` 与 Pixel 坐标，不操作任何窗口。`companion/src/computer/win-adapters.ts:254` 已使用此接口。
- `companion/src/host-use/win/scripts/computer-ocr.ps1:137` 输出本机 OCR 文本及原图坐标。可以先裁剪小标题图后调用现有 OCR，无需新图像依赖。
- `companion/src/activity/image.ts` 的 `withPendingImage` 在 finally 删除临时 PNG，可嵌套用于原图、标题图与内容图。

## 最小完整数据与用户流程

1. 设置中先选择应用；每个应用明确显示“全部可见内容”或“仅指定对话”。新增受限范围时，不能因尚未完成校准而回退到全部内容。
2. “校准当前聊天窗口”：明确的一次性、本机窗口预览。可倒计时几秒，供用户手动切到该应用；不自动激活窗口。后端复用原被动 capture 并以临时 allowlist 限定所选 app，禁用模型抽取，不 `addSource`；回传图仅用于当前设置视图。前台不是所选应用则明确拒绝。
3. 用户先框选聊天内容（含顶部当前聊天标题，排除侧栏其它聊天），再在其内框选标题。预览与录制使用同一种实际窗口截图，避免外部截图边缘/阴影尺寸不同。
4. 填写允许的完整聊天标题；界面显示当前标题本机 OCR 的结果供核对。使用 exact 匹配，不默认 substring/模糊/LLM 推断；可以仅 trim 首尾空白，不能删标点、去群成员数或任意截取匹配。OCR 分词投影必须在预览和每次采集使用同一个函数，用户能看见实际比较值。
5. 保存 app 身份、参考截图宽高、标题/内容矩形和允许标题。建议一份校准配置绑定一个已验证的窗口布局；若同应用需要主窗和独立窗的不同布局，可保存多份明确配置。多配置不能靠“任意区域出现标题”自动宽松放行，应有可确定的布局键（例如已读取的 window class + width/height），相同键歧义则要求用户重新配置。
6. 每次采集：原窗口/权限检查 -> 同一原图 -> 严格核参考尺寸及矩形边界/包含关系 -> 标题裁剪 -> 本机 OCR exact 比较 -> 内容裁剪 -> 核裁剪 PNG 尺寸与请求一致 -> adapter 只返回裁剪内容。OCR 模式仅对裁剪内容识别；视觉/Qwen 模式只收到裁剪内容。
7. 原图及标题临时图无论成功、拒绝、错误、撤销都删除。当前 chat title 不匹配、读不到、布局尺寸变化分别显示可操作原因；不将它们冒称成功采集。

### 必须保留的实现约束

- 标题与内容都来自同一个已完成采集的 PNG，不另截一张图做标题授权，避免聊天切换造成跨帧错配。
- 内容区域必须包含标题区域；标题区域不得覆盖侧栏或消息正文。校准预览需说明这一要求并显示两框。
- 原生 crop 接口会 clamp；调用者必须先拒绝越界/非整数/空矩形，并核最终裁剪尺寸，不能把 clamp 当有效校准。
- 窗口尺寸变化要重新校准，不能仅以百分比 ROI 自动平移后继续授权；聊天软件布局改变也应提示重新设置。窗口位置变化不需要改变截图内像素坐标。
- 不匹配、缺失 OCR 语言、OCR 错误均不保存、不送云，不静默退回全应用采集。
- 同名聊天仅凭可见标题无法区分。产品文案应明确这是标题范围识别，用户需使用可区分的标题；不宣称拿到聊天内部唯一 ID。
- 3s 是检查下限；Windows 截图/OCR/模型可能更慢。保留现有单飞，忙时不叠加，不承诺每3秒都有一份结果。

## 聊天内图片

当前图像模式已经将图像发送给支持 vision 的处理目标。只要图片位于选定聊天内容区域内，内容裁剪保留其像素；外部侧栏图片被去除。补充抽取提示与指南：可以阅读可见嵌图中的文字，但不把其中指令当作系统指令，不打开原图附件、自动滚动或读取未显示内容；小缩略图读不清须由用户主动导入更清楚的图，不能编造正文。仍须 literal transcript quote 和人工确认。

## 独立验证

命令（exit 0）：

```sh
source "$HOME/.nvm/nvm.sh"
nvm use 22.23.4
node /tmp/cmspark-825-conversation-prototype.cjs
```

原型与输出：`/tmp/cmspark-825-conversation-prototype.cjs`、`/tmp/cmspark-825-conversation-prototype.log`。

| 场景 | 实际结果 |
|---|---|
| 真实编译 Windows adapter + 原仓库 inert native double + 自有 PNG | 返回原始整窗字节；临时文件已清理 |
| 当前标题 ALLOWED，侧栏 OTHER | 允许 |
| 当前标题 OTHER，侧栏有 ALLOWED | 拒绝 |
| 当前标题 OTHER，正文提到 ALLOWED | 拒绝 |
| 空/缺失/截断 OCR | 拒绝 |
| 子串或标题追加后缀 | 拒绝 |
| 参考尺寸改变 | 拒绝，需重校准 |
| 标题区域不在内容区域 | 拒绝 |
| 内容矩形越界 | 拒绝，不交给原生 clamp |
| 内容裁剪像素投影 | 去掉侧栏标记42，保留聊天内图片标记99 |

这是 9 项受控设计原型，不是生产 scope 实现测试；Windows native API 未在 macOS 上执行。采用了仓库已有 inert Window factory，未新编造协议字段来证明真实原生 payload。原型还读取真实 crop-only 生产片段，确认 pixel DrawImage 与 clamp 路径存在。临时数据目录已经删除。

## 实现后的外部可观察 DoD

- Windows 自有双栏聊天夹具：当前聊天 A、侧栏 B；仅授权 B 时拒绝，禁止产生 source / 模型调用 / 遗留 pending。
- 当前聊天 B 且标题相符：source 和图像模型输入均只有内容裁剪，侧栏文字/像素在两者中不存在。
- 自有聊天嵌图含明确待办：保留该图像像素，可产生带 literal quote 的待确认候选；候选不自动变正式待办。
- 主窗口/独立窗口各自校准的原生成功；窗口尺寸/布局键变化和配置歧义拒绝。
- 配置撤销、连接中断和采集中途 scope 变化，不能保存或送出过期内容。
- 原前台、会话、锁屏、密码、权限、被动及截图前后身份检查全部继续生效。
- Windows 本机原生 OCR+crop 端到端通过；UI 表单/坐标换算/保存摘要与后端实际使用的矩形一致。

## 官方依据

- Microsoft UIA 依赖应用提供相应 provider 和 control pattern，不能从通用 Name 搜索推断五款自绘聊天软件的当前聊天身份：[UI Automation Control Patterns Overview](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-controlpatternsoverview)。
- Windows OCR 在传入的 SoftwareBitmap 上异步识别，适合本机裁剪标题图：[OcrEngine.RecognizeAsync](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.recognizeasync?view=winrt-26100)。

VERDICT: APPROVE

## 补充审批：无服务端缓存的最小校准 API（2026-11-02）

**结论：可采用，不需要预览 token、服务端图像缓存或 TTL。** 这两个新增 RPC 只提供明确请求的本机预览/本机 OCR；实际采集仍重新读取当前真实窗口和当前配置，自行完成同帧标题 gate，因此无需把校准回执变成持续授权凭据。

### 接口与数据流

- 一次性预览：输入 app_id，后端只读取当前匹配的指定 app。保留原 HWND/PID/start/path、会话/权限/被动/前后台核验。返回实际 window_class、PNG 原始宽高和不超过 6 MiB 的预览 PNG；不 `addSource`，不抽取、不调用模型。已有 scope 需要重新校准时，此明确的一次性预览可以由后端构造临时配置绕过旧 ROI 限制，但不能绕过应用/窗口安全检查；该 bypass 不能成为录制请求可传入的字段。
- 倒计时在浏览器端 5 秒，发出 RPC 前检查原 AbortSignal。倒计时结束时才发一个请求；用户手动切窗口，若仍不是指定应用则拒绝，不自动切换。
- 标题预检：UI 提交冻结的同一原 PNG（<=6 MiB）、像素标题矩形和所选语言。后端严格核图像/矩形范围，再以既有 crop-only + OCR 产生 `words.filter(text is string).map(text).join(' ').trim()`。预览与实际 gate 必须复用这一投影函数；不进行 fuzzy、substring、去标点或任意删空格的放宽。
- 保存每 app 的 profile。`(window_class, width, height)` 必须唯一；相同 key 的新校准是用户明确的替换，不能保留多个区域并用“任意命中”放行。标题矩形完整包含在内容矩形之内，两个矩形均严格在原图内部。主窗口和独立窗口都走双框路径，不增加 OS 标题快捷放行。
- 每次真正 capture 使用该帧实际 class/宽高确定唯一 profile；标题 gate 和内容 crop 使用同一张原 PNG。只有聊天内容裁剪能从 adapter 返回。profile 不存在或布局无法确定则显示需校准并拒绝，不回退全窗。
- UI 在取消、关闭、切 app、新预览、图像/标题区域/语言变化时清掉旧预检结果并中止原等待；异步晚到回执不能重建预览或污染新选择。保存的 profile 必须取当前被冻结预览的实际 metadata 与像素坐标，不取另一次活动窗口的 metadata。
- 两个 RPC 都纳入现有 authenticated personal workspace 入口、strict message 验证、当前连接/配置 generation 检查和单飞限制。所有临时 PNG 均通过 finally 清理。无需服务端长期保存图像或 receipt。

### 已发现的可达集成缺口（须随实现解决）

1. **现有成功回执匹配器会忽略两个新 RPC。** `activity-request.ts` 的 `matchingActivityReply` 仅为 apps/source 提供特殊形状，其余一律要求 `state`。必须为 preview 和 title 加各自的类型、字段/大小/相关 app 校验分支，不能只在后端添加 handler。
2. **现有 15 秒前端默认值不覆盖新流程。** 同文件只有 scan/import/analyze 使用长预算，其余默认 15 秒；预览复用的 capture 可依次进行 4 次 PS 调用，现有每次硬上限 15 秒。建议新只读 preview 90 秒、title 45 秒，依据当前 4×15 / 2×15 的进程上限加余量；原进程上限和 Windows 验收时限均不变，不重试。UI 倒计时不占后端预算。
3. **AbortSignal 的现有语义是取消等待，不是立即杀 native。** `requestActivity` 取消会移除 listener；`runPs` 接收 timeout 而不接前端 signal。只读 RPC 可以有界完成并 finally 清理，不能向用户声称已即时终止 PS 子进程。已取消或换预览的 UI 必须忽略晚到响应；此路径无 source/AI 副作用，不需要为此新增服务端 cancel/token 框架。
4. **尺寸不符不可缩放后继续校准。** 大于 6 MiB 的预览明确返回大小错误，提示调整窗口；不得为了传输压缩尺寸后却沿用原尺寸 metadata。实际记录仍可按原 8 MiB 本地截图限制工作，校准的参考像素尺寸不改变。

### 补充受控验证

命令（exit 0）：

```sh
source "$HOME/.nvm/nvm.sh"
nvm use 22.23.4
node /tmp/cmspark-825-calibration-api-prototype.cjs
```

输出：`/tmp/cmspark-825-calibration-api-prototype.log`。

- 实际 transpile 并运行当前生产 `matchingActivityReply`，确认所提 preview/title 成功回执形状都会因没有 state 而被拒绝；证明上面的 matcher 集成项是可达问题。
- 6 MiB 原始字节编码为 8,388,608 字节 base64。带标题矩形等所提 RPC 字段的 JSON 为 8,388,741 字节；源码实际 WS 上限 10,485,760 字节，仍有余量。不是把整个 JSON 限制误当图像原字节限制。
- 受控 profile 集合验证：相同 class/尺寸 key 明确替换为一份，独立窗不同 class 可并存；非整数、负数、越界和标题不被内容包含均拒绝。
- 受控 UI generation 验证：取消后清掉预览，旧 OCR 晚到不重建 UI 或设置结果。
- 以上为接口设计控制与真实当前匹配器运行，不是 Windows 本机 screenshot/OCR 实测。原生 DoD 仍按上文执行。

VERDICT: APPROVE
