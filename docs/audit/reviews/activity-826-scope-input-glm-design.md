# Scope owned-input setup — actual GLM design gate

- Actual reviewer verdict **APPROVE**, implementation only; independent/source/platform gates remain.
- Base `67c5e209d239995b930fe1dfcc54f444005e44f8`; no implementation diff.
- Prompt SHA256 `5b3e65e2deec3a0939e72e96c498528816287faeba2f3d1a95e03a13591d5122`; 69303 bytes.
- Actual Claude CLI `2.1.153`, modelUsage solely `glm-5.3`, host `open.bigmodel.cn`, process exit0/is_error false, one tool-free turn; duration `127985ms`.
- Actual usage: {"glm-5.3": {"inputTokens": 17085, "outputTokens": 9019, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "webSearchRequests": 0, "costUSD": 0.31089999999999995, "contextWindow": 200000, "maxOutputTokens": 32000}}.
- Replacement contract: one guarded OS click per newly built owned main/popup window replaces Activate+Focus; not fallback, human approval or product activation. Original10s/180s/business/cleanup and actual readiness remain.

## Coordinator correction / required implementation fence

Root found a concrete prototype gap while this API was running: after short insertion0/1/2 throws, requested/rendered remain true; later queued qualified activation/focus checks could publish ready in the prototype. The original22controls replayed render but did not establish this late-event refusal. The model's explanation that Main catch suffices is not independent evidence of fail-stop. Do not cite its wording or old22controls as proving that property.

Implementation must add local setupComplete=false, set true only after exactly3 inserted inputs, and require it before any ready publication; actual source-derived late-qualified-event negative controls must prove short/rejected setup never ready. This implements the submitted original no-ready-after-short-insertion requirement without retry, another input or budget. Root/A are supplying the concrete counterexample/fence evidence. Approval remains conditional on this requirement and all source gates; this report is not current-source or Windows acceptance.

## Actual reviewer response (verbatim)

**结论：APPROVE（仅授权实现，不含 CI/接受/合并/发布）。**

**变更边界成立。** 唯一改动点是自有夹具 `activity-scope825-windows.cs` ContentRendered requested 块内的 Activate/Focus 一对调用，替换为每个新建主/独立窗各一次 SetupOwnedClick，属替换而非激活失败后的 fallback；产品 recorder/preview/capture、授权、consent、模型路径不动。spec 第26行本就要求真实用户先手动选中应用再做被动预览，测试 setup 由自有夹具点击自身惰性只读 TextBox 建模该前提，且点击发生在 ready.json 发布之前，被动探针断言（probe hwnd==ready.hwnd、采集不改前台）不受影响；输入桌面 lease 仍持有。

**拒绝面与输入面自洽。** 22 项可执行控制覆盖可见/启用/非最小化/HWND/pending/receipt/当前布局/几何/虚拟屏范围/WPF 命中/无命中/外根窗口/外 PID/PID 查询失败及直接未渲染调用，均零输入零写入；WindowFromPoint→GA_ROOT 恰为自身根 HWND 且 GetWindowThreadProcessId 命中实际自有 PID，覆盖窗时拒绝且不提升/遮挡他窗。单批三 MOUSEINPUT（ABSOLUTE|VIRTUALDESK 移动+左按下+左抬起），负原点先减、端点归一 0..65535 已以 -1920 原点实测落界；requested 先置位使事件重放不重发；插入数≠3 抛错，经既有 Main catch→failure.json→receipt 立即失败，是可达的 fail-stop；ready 仍由原 IsReady 的真实 GetForegroundWindow==hwnd 且 IsKeyboardFocused 决定，SendInput 成功不替代；resize 不新建窗不再点击；旧窗事件因 Current!=window 先返回，不能点击也不能发布新 receipt；10s/180s 及全部裁剪/OCR/模型/嵌图/popup/子关闭/cleanup 语义保持。设计诚实声明检查→输入非原子、非 HWND 定向，仅受控测试桌面假设，未见过度声明。

**实现附带必做项（非阻塞）：**
1. C# 侧 INPUT 须为真实联合布局并实测 Marshal.SizeOf（x64 应为 40）随 cbSize 传入，新增结构体尺寸/联合/平台匹配控件；原型受控端口不构成该证明。
2. 现有 8 个 readiness 控件与观察闭环对被替换文本强耦合：port 适配串（如 `bool activated = window.Activate();`）与 observation.cjs 的 names 及 `source.includes('"ACTIVATE_TRUE"')` 检查会因调用消失而在加载期失败。必须与夹具同批更新为消费真实新 helper/callsite，保留八案例判别语义（128 组合、旧窗反例、resize 同 gate），不得改造为自造替身。
3. ACTIVATE_/FOCUS_ 相位消失后 D825 名称表需一致更新保持闭环；拒绝与插入失败应以可判别异常类型进入 failure.json（现仅记类型名），否则实际 Windows 首失败无法区分“前置拒绝”与“其它夹具失败”，削弱已声明的判别式验收。
4. 单击背景窗时键盘焦点是否随首击落到 TextBox 属实际 Windows 经验问题，本设计不下结论：未合格即原案例失败、无 fallback，两分支均可判别；对历史 ACTIVATE_FALSE 的 OS 原因同样不做推测。

门禁：批准仅到实现；随后独立与 GLM 源码复审，再在真实 Windows 跑一次原有全业务案例，通过方进入 CI/验收。
