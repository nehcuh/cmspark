# #825 Windows 应用列表与 3 秒间隔：独立设计验证

范围：微信、企业微信、钉钉、飞书、QQ 的 Windows 应用发现，以及采集间隔设置。只读检查当前 release 源码，未修改生产文件或实时配置。此结论可交 GLM-Claude 复审，属于设计批准，不属于 Windows 实现或 0.8.0 发布批准。

## 结论

应用发现应改为同会话、可解析映像路径的运行进程枚举，并保留原稳定路径身份摘要。窗口是否显示、最小化、前台或可采集，分别作为状态及采集时的资格判断。现有 Apps 与 Probe 共用 Window-Info，能够直接解释“程序仍运行，但最小化后列表消失”的代码路径。

3 秒需要锁定可验收语义：推荐本切片先实现“最短检查间隔 3 秒，上一轮截图/模型未完成时跳过、不排队、不并发”。实际验证表明当前单路流水线在模型慢时不截图。本票不增加模型队列框架，也不承诺慢模型期间每 3 秒保存画面；该行为如后续明确要求，再单独设计。

## 直接证据

### 1. 列表混用了窗口采集资格

- `companion/src/host-use/win/scripts/activity-windows.ps1:54` 的 Window-Info 第一条 guard 排除 Zero HWND、不可见、IsIconic。
- `:67` 还要求可取得窗口 geometry。
- `:72` Apps 遍历 EnumWindows 后调用上述 Window-Info；无 HWND 的存活进程没有进入该分支的机会。
- `:77` Probe 同样调用 Window-Info，之后才核前台焦点、密码控件、遮挡与桌面。这些要求应留在采集路径。
- `companion/src/activity/platform.ts:33` 的 listApps 还调用完整 winWindow decoder，要求 hwnd/pid/started/geometry/safe。因此只修改 PowerShell 枚举方式仍不完整，TypeScript 消费者也必须拆分 DTO。
- 当前列表直接返回 Map 插入顺序，并在遍历中限制 200 项。窗口 Z 顺序变化会改变显示顺序；仅在返回前排序，仍会让截断成员受到原始顺序影响。

### 2. 3 秒当前被两层拒绝

- `companion/src/activity/validation.ts:34` 下限为 5000ms。
- `chrome-extension/src/sidepanel/components/personal-workspace/PersonalWorkspace.tsx` 的数字输入下限为 5 秒。
- `companion/src/activity/service.ts:101` 在 pending 时跳过整轮；`:119–137` 的 pending 同时覆盖截图、持久保存和模型抽取。

## 已执行的受控验证

脚本：`/tmp/cmspark-825-apps-design-probe.cjs`；日志：`/tmp/cmspark-825-apps-design-probe.log`。

```sh
source ~/.nvm/nvm.sh
nvm use 22.23.4
node /tmp/cmspark-825-apps-design-probe.cjs
```

exit 0，最终输出 `DESIGN_PROBE_PASS`。实际输出摘要：

```text
SOURCE_GUARD_RESULTS
visible -> excluded false
minimized -> excluded true
hidden -> excluded true
no-window -> excluded true

REAL_ADAPTER_ORDER
first=[Zulu,Alpha]
second=[Alpha,Zulu]

BASELINE_TRUNCATION
returned=200, omittedChat=true, wire201=false

CURRENT_VALIDATOR
interval3000=false, interval5000=true

REAL_SERVICE_SLOW_MODEL
elapsed=3000 captures=1 extractions=1
elapsed=6000 captures=1 extractions=1
elapsed=9000 captures=1 extractions=1
afterRelease elapsed=10000 captures=2 extractions=2
manualWhileBusy=BUSY
```

方法：第一项从真实 PowerShell 源码导出原 guard 表达式，固定 HWND/visible/iconic 的输入检查谓词；第二项执行真实已编译 WindowsPassiveRecorder，叶子 runner 仅返回受控窗口 DTO；补充构造 201 个可用进程对应行，确认位于第 201 位的聊天程序在旧 adapter 中被截断，同时真实 matchingActivityReply 拒绝 201 项；第三项调用真实验证器；第四项执行真实 ActivityService，以假时钟和受控未完成模型 Promise 核计数，仅在测试实例的 config getter 投影拟议的 3000ms，生产验证器及持久配置保持原样。

宿主为 Darwin，无 pwsh。以上是源码与跨平台消费者的 CPU 证据，未执行 Windows API，未证明用户现场的每次列表缺失都由最小化导致；无窗口、不可见、路径不可解析和截断均有各自明确路径。没有读取用户应用清单、聊天或凭据。

## 最小完整设计

### A. 稳定的应用发现与选择

1. Apps 分支使用 Get-Process，先限制当前 Windows session，再取得可解析路径、应用显示名和必要进程身份。沿用现有路径规范化及 `win.<SHA256>` 计算，去重维度为 exe 身份，不以进程名或窗口标题授权。将路径到 app_id 的计算抽成同一个内部 helper，Probe 与 Apps 共用，避免两套身份规则。
2. 分离 `App-Identity` 与 `Window-Info`。应用身份不依赖 HWND、visible、IsIconic 或 geometry；原敏感应用排除与同会话限制保留。路径不可解析的进程不伪造 app_id、不增加权限；已选但当前未核实的应用保持选择，并显示“当前列表未发现/身份不可核实”。
3. Windows App DTO 只向面板投影 app_id、显示名、运行发现状态及窗口摘要枚举，例如“有可见窗口 / 仅最小化窗口 / 暂无可见窗口”。进程仍存活但无窗口时可选择、可保留授权，显示“运行中 · 暂无窗口”。无窗口不能标成已退出。Apps 不返回 exe 路径、消息标题或聊天文本。
4. “当前可采集”只能由实际 Probe 和后续原安全检查确认。Apps 的“有可见窗口”只表示发现窗口，不承诺安全焦点、遮挡、权限或对话范围已通过；这些检查继续在截图前后执行，不自动激活、还原或切换窗口。
5. 采用有界全进程列表：同会话、可解析路径、排除敏感应用、按 app_id 聚合后，先以显示名与 app_id 作确定性排序，再作最多 4096 项的边界限制。原 200 项限制同时从 Windows decoder 与前端 matchingActivityReply 放宽到 4096；只改 producer 或只在旧 cap 后排序都会继续漏聊天程序。刷新相同集合得到相同顺序。超过 4096 或无法完成枚举时显示截断/不完整状态，不冒充完整列表；已选记录独立保留，不受当前页/过滤/截断影响。
6. 界面明确标为“运行进程（含后台程序）”，选择仅保存应用身份，不表示该进程一定有可采集聊天窗口。4096 项结果按显示名、身份摘要和已知常用名称搜索，过滤先于前端分页，沿用每页 6 项或既有分页控件，不能要求用户逐页翻找。微信/WeChat、企业微信/WeCom、钉钉/DingTalk、飞书/Feishu/Lark、QQ 的别名只服务发现，不作为身份或采集授权。优先使用应用版本资源的 ProductName/FileDescription，读取失败回退 ProcessName；所有标签作为普通文本渲染。
7. 保留现有跨页选择逻辑，将本次已发现的友好名称在表单刷新间保留；缺失的已选应用继续可见并可取消。更新 ActivityApp 类型、Windows decoder、消息投影与扩展 matchingActivityReply，避免新状态被旧严格 decoder 拒绝。macOS/Linux 维持既有发现行为，状态缺省明确为未提供，不伪造 Windows 状态。

### B. 本切片推荐的 3 秒契约

- 后端校验下限改为 3000ms，前端数字输入下限改为 3 秒；保存、重载及运行显示同一个值。不修改用户实时配置或悄悄覆盖已保存的间隔。
- 名称为“最短检查间隔（秒）”，提示“上一轮采集或识别未完成时跳过，不并发；耗时较长时实际间隔会增加”。现有 1 秒 tick 和 lastPoll 可继续使用。
- 3 秒指两轮开始的最小间隔，不保证每 3 秒完成一次，也不保证慢模型期间持续截图。忙时跳过，不积压定时器请求；结束后下一个满足条件的 tick 开始，单次点击仍遵守 BUSY。
- 测试使用可控时钟，不用实际 sleep：2999ms 不启动，3000ms 可以启动；截图、OCR、模型分别被阻塞时重入 tick 不增加采集数；释放后只启动一轮，不补发漏掉的 3/6/9 秒任务；停止和撤销授权依旧阻止新结果入库。

### C. 本票不增加持续留图队列

受控验证确认，拆分截图和模型会改变本票语义与状态机。按最小方案保留现有单路：不增加 capture/analysis 双队列、不覆盖未分析来源、不把跳过的 tick 记作成功采集。运行状态可显示“正在采集/识别，下一轮等待完成”，最近成功采集时间仍取实际来源保存回执。

若未来用户明确要求“模型慢时仍每 3 秒保存截图”，届时再设计独立 capturePending 与单路 analysisPending、来源待分析状态及容量规则；这一后续设想不作为本票实施内容。

## 后续实现的验收门

- CPU/契约：当前源导出的拒绝路径、新 Apps decoder（无 HWND 仍可列出）、201 项与 4096 项跨 producer/decoder/wire 的边界及聊天命中、稳定排序后截断、重复 exe 去重、同名不同 exe 区分、已选缺失保持、搜索跨页选择、3000ms 保存重载与忙时不并发。
- Windows 原生：用同一次受控聊天夹具的真实进程身份验证可见→最小化→隐藏/托盘→无窗口但进程存活→退出；列表与状态按设计变化，原 Probe 在不可采集状态继续拒绝。确认列表读取不截图、不切换焦点。
- 五款实际聊天客户端：记录已安装版本，在同一新构建上核对正常运行、最小化/托盘发现与选中保留；不使用聊天正文作为日志证据。某款现场未安装时保留该款未观察结论，不能用其他软件代替其原生兼容性证明。
- 0.8.0 发布需实现、机器和 Windows 原生验收完成，再按用户要求经独立 agent 与 GLM-Claude 放行。本报告不提前批准发版。

VERDICT: APPROVE
