# #825 Scope 夹具真实 readiness 单元 GLM-Claude 回执

- 实际裁决：**APPROVE**；只批准两个测试 source 提交并进入最终 hosted Windows CI。
- Base：`bd43d8ac3a39991065ea78ab8b59da5ee5afaebc`。
- Source diff SHA256：`09fa2f70d6d138b14dc92ea92e7da862cb06f5a1b658ef00861f578df89bddbc`。
- Prompt SHA256：`41f5c8fc48650c289eb1350ba8763a48049981dba9d9f98bdddf955d1a5079c0`；58247 bytes；API起始UTC `2026-11-02T17:52:46.535897+00:00`。
- Reviewer：Claude Code 2.1.153 / `open.bigmodel.cn`，实际modelUsage仅`glm-5.3`；process exit=0，is_error=false，耗时160229ms；无格式补充API。
- 范围仅为自有C#fixture和源码派生控制；未改生产代码、原Node native断言、10s/180s或cleanup。该审阅者只新增审计回执，不改source、commit或push。
- 已亲证的是旧handler可无视真实前台/焦点而发布ready的逻辑缺口；不认定bd43外来PID的唯一物理原因。正确head仍须真实Windows编译、前台授予和scope native通过；本回执不表示完整CI、打包dry-run或release已过。

以下为实际GLM-Claude完整原文（未经改写）：

---

## 复审结论（scope825 夹具 false-readiness 两source）

**1) receipt gate 构成与旧错修复** — 属实。`IsReady` 要求：该窗口自身 ContentRendered（每窗闭包 `rendered`）+ `Current == window && ReceiptWindow == window && PendingReceipt != null` + `WindowInteropHelper(window).Handle != IntPtr.Zero` + `GetForegroundWindow() == hwnd`（同一目标窗口的真实 HWND）+ 捕获 TextBox 的 `IsKeyboardFocused`。旧 body 的“Activate/Focus 返回任意值均无条件 Write”路径被结构性消除：VM 首测试逐字节执行旧 body（SHA 固定），四组合全写；新 gate 每次发布前重读原生事实。测试覆盖 foreground≠、focus=false、零 HWND、`Current`/`ReceiptWindow` 不符、null pending 时均不写。

**2) 事件顺序/旧窗/一次receipt/popup/resize** — 正确。三种先后顺序（先 foreground/focus/rendered）均只按合格时刻判定；Activated/GotKeyboardFocus 仅经 `DispatcherPriority.Input` 排程重核，flush 时重读状态（测试3首段证明排程后状态丢失不发布）。每窗 `requested` 闭包恰好一次 `Activate()+Focus()`（calls 序列 `activate:17,focus:17,activate:27,focus:27`）；`PendingReceipt` 写前置空 → 单次请求单次回执。旧窗口事件因 `Current/ReceiptWindow != window` 无法发布新 popup receipt；popup 把自己的一次请求移到自身 ContentRendered（数量不变）；resize 保留原 `Width += 80; UpdateLayout()` 后经同一 gate，且不新增激活请求（与旧 resize 行为一致），一次 layout 调用被断言。

**3) 强度/无轮询/权威断言** — 保留。无 SetForegroundWindow/AttachThreadInput/重试/额外延时；50ms timer 仍只读 control.json，非 readiness 轮询。native 测试、receipt helper（10s）、180s、PID/HWND/OCR/crop/pending 清理均逐字节未变（sha 已给），Probe 权威性不弱化——前台事后漂移仍由原 PID 断言拒绝。

**4) 控制是否源码派生** — 是。`one()` 对真实 staged fixture 做 exactly-one 正则提取（IsReady body、整段 per-window 接线、resize handler），`port()` 每处替换断言 split==2，源漂移即测试失败；旧 body 是逐字录制。仅适配语言语法与受控 WPF/Win32 叶子，未镜像重写守卫逻辑；关键反例（未render/外前台/无focus/零HWND/对象不符/null pending/迟到排队事件/重复事件）均由真实提取体执行。B 又从 git HEAD 独立提取旧体交叉验证。

**5) 可达缺陷** — 未发现阻塞级。nits（不阻塞）：
- resize/popup 的 ack 只能由合格即写或后续 Activated/GotKeyboardFocus 事件兜底；若控制时刻前台/焦点真丢失，将以 10s receipt timeout 失败而非假回执——这正是本次修复定义的正确失败边界，且通过流程中前置 `probe().hwnd == ready.hwnd` 断言钉住前台身份。
- `check` 中 `PendingReceipt` 先置空后 `Write`；若 Write 在 dispatcher 回调中抛出，回执丢失且可能以 CHILD_CLOSED 终止（fail-fast，无假回执，风险类别与旧码相同）。
- 旧体 SHA 自引用，来源凭 B 的 git-HEAD 独立提取背书（已完成）。

边界确认：本机结果不证明 Windows 前台授予/hosted 编译/原生 case；此门仅批准两 source 入库并跑最终 windows-latest CI。生产输入/打包 dryrun 不属此夹具 gate。

**可以 commit 这两个 source 并进入最终 CI。**

VERDICT: APPROVE
