# Computer Use 能力台账

**建立于** 2026-09-30 · **参照** [trycua/cua `libs/cua-driver/docs/action-support.md`](https://github.com/trycua/cua/blob/main/libs/cua-driver/docs/action-support.md)
**背景分析**：[2026-09-30-cua-driver-reference-and-gap-analysis.md](decisions/2026-09-30-cua-driver-reference-and-gap-analysis.md)

---

## 0. 为什么有这张表

我们的 `ComputerErrorCode` 有 37 个精确拒绝码、`executor.ts` 有动作后不变量、
`computer-cu-redteam-corpus.test.ts` 有对抗语料 —— **机制不缺，缺的是一张表**。

没有这张表的代价，我们已经付过一次：`osascript_eval`（现代 Chrome 上确定性死路）
**长期作为 last resort 写在工具文案里**，一直被模型当候选调用，直到 PR #566 才全平台下架。
那不是实现问题 —— 是**「没有一张表说明这个动作在什么条件下不可能」**的问题。

---

## 1. 判据（三态 + 证据规则）

借 cua 的判据，原文要点：*"derived from typed `CaseSpec` rows and accepted E2E evidence,
not from a successful driver response alone."*

| 状态 | 判定标准 |
|---|---|
| **Delivered** | 观测到**靶子拥有的状态变化**（不是「调用返回成功」） |
| **Refused** | **精确的结构化拒绝码** + 相关副作用 oracle 全部通过 |
| **Gap** | 不支持，或**尚未证实**。⚠️ **空白行永远不能作为「该动作不可能」的证据** |

**硬规则（本表的纪律）**

1. **工具返回 `success:true` 不是证据。** 证据是「靶子状态变了」或「精确拒绝码 + oracle 通过」。
2. **不许把 Gap 标成 ✅。** 未证实就写 `Gap`，并写明「缺什么才能证实」。
3. 每行须可追溯到**具体证据**（测试名 / 运行号 / 提交）。
4. 已知残余（如「低于阈值的弹窗会漏检」）必须**记名列出**，不得含糊。

---

## 2. 我们的投递路线（现状事实，代码可核）

| | 事实 | 证据 |
|---|---|---|
| **选择（怎么找到目标）** | 像素坐标（`click{x,y}` 客户端逻辑点）**或** OCR 文本锚点**或** UIA accessible-Name 锚点 | `tool-definitions-catalog.json` 的 `host_computer.actions` |
| **UIA 定位** | **只读**。按 accessible-Name 锚点定位，返回元素中心 + 屏幕物理像素 rect；置信度 1.0(唯一) / 0.9(同名取树序首) / 0.8(子串)；离屏/零 rect 不返回 | `computer-uia-locate.ps1` 头部契约 |
| **前台投递** | **`SendInput`，且必须先 `SetForegroundWindow`**（重试 3 次；失败即 `FOCUSLOST` 拒绝，绝不盲注入） | `computer-input.ps1`（26KB，WP1/WP2） |
| **UIA 动作模式** | `PsInputInjector.invokeUia()` 用两个顺序直接 PS（`computer-uia-select.ps1` → `computer-uia-act.ps1` + no-focus DLL），共享原 15s 剩余预算；五种 pattern 均已有 WPF 当前原生证据，executor 仍只接窄条件的左键 `Invoke` | `win-adapters.ts`、`executor.ts`；当前证据与旧 CLI 兼容收紧见 §3.3 |

### ⚠️ 两条投递路线的边界

**前台坐标路径使用 `SendInput`；已有的后台路径使用 UIA 动作模式。**

坐标路径仍保留前台提升与既有人工确认要求（#534 / #530）。后台接线仅在左键、
非空 target、`uia+ocr` 互证等现有条件成立时尝试 `Invoke`，不绕过动作闸门。
脚本支持的其它模式不等于 executor 已接线，也不等于所有工具包已验收（见 §3.3 / §6）。

---

## 3. Windows 台账

> 本节记录 Windows；macOS AX 动作及比较 oracle 已有实现，逐行验收与未完事项见 §4。
> **本表的空白 = 尚未用夹具证实，不等于不可能。**

### 3.1 投递路线（机制级）

| 路线 | 状态 | 精确拒绝码 | 证据 |
|---|---|---|---|
| 前台 `SendInput`（坐标键鼠） | **Delivered**（机制存在且被使用） | `FOCUSLOST`（提前台 3 次失败）、`SENDFAILED`（注入事件数不符） | `computer-input.ps1` |
| **后台 UIA 投递（不经前台）** | **Delivered（当前 WPF 左键，另有四种 WPF adapter pattern 验收，见 §3.3）**；其它靶子仍按行记 Gap | `UIA_ELEMENT_GONE` / `UIA_ELEMENT_MISMATCH` / `UIA_PATTERN_UNAVAILABLE` / `UIA_METHOD_FAILED` 等精确码；不确定终态不再做第二次动作 | `PsInputInjector` → select/act → no-focus DLL、executor 左键接线、WPF 夹具 |

### 3.2 结构与策略性拒绝（**不是**未实现，是**有意拒绝**）

| 项 | 状态 | 精确拒绝码 | 证据 |
|---|---|---|---|
| 浏览器类应用的坐标控制 | **Refused**（结构性排除，强制清除 hints） | `APP_COORDINATE_STRUCTURAL`（日志原文：`has coordinate/UIA hints on a vault/LOLBIN binary — force-cleared (structural exclusion, A10/Y5)`） | `docs/host-and-apps.md`、#534 |
| 高危区域（假 UAC / 假支付 / 凭据邻域） | **Refused** | `DANGER_HARD_DENY`（零 re-L2 路径） | `computer-cu-redteam-corpus.test.ts` ③ 类 |

### 3.3 按靶子/框架的行

| 靶子/框架 | 前台左键 | 后台左键 | 后台键盘 | 后台滚动 | 后台拖拽 |
|---|---|---|---|---|---|
| **WPF** | Gap | **Delivered（当前生产 Invoke 已验证）** ✅ | Gap | Gap（通用 executor 路线；WPF `ScrollPattern` 已验收，见下） | Gap |
| WinForms（下述历史夹具） | Gap | **Refused（`UIA_PATTERN_UNAVAILABLE`）** | Gap | Gap | Gap |
| WinUI3 | Gap | Gap | Gap | Gap | Gap |
| WebView2 | Gap | Gap | Gap | Gap | Gap |
| Electron | Gap | Gap | Gap | Gap | Gap |
| Tauri | Gap | Gap | Gap | Gap | Gap |
| 原生 Win32 | Gap | Gap | Gap | Gap | Gap |

#### 当前 WPF 原生证据（2026-10-18，PR #696）

证据绑定：[head `a544264b6fa03c69a871405a5d998b02b75ad68f`](https://github.com/nehcuh/cmspark/commit/a544264b6fa03c69a871405a5d998b02b75ad68f)，
[Windows run `39120491143` / attempt 1 / job `117654931313`](https://github.com/nehcuh/cmspark/actions/runs/39120491143/job/117654931313)。
实际 checkout `f4ec5b558e86498d455a9b79c2ade0c77d9803ce` 与 head 同 tree
`a0145cd7bf9e6efb6ee45e298f6a79cf2d02db08`；该 tree 随后合入 main `1629ad34749658d4ec339ea963dbf3010690a6fc`。
这里引用的是该 PR 的实际原生结果，不把随后 main CI 的状态当作本轮已完成验收。

正常用例 `#572 current WPF background Invoke changes only the target while all four desktop oracles hold`
实际走生产 `PsInputInjector` 的 select → clean act → DLL，而非插桩副本。靶子标记改变，
前后 foreground 均为 **SIBLING**，兄弟标记未出现，focus/z-order/cursor/no-leaked-input 四项及
`background_verified` 均为 true，两个 owned children 已关闭。独立 client-phase diagnostic 用例
也通过同样断言；它的成功不替代原正常用例。

| WPF adapter pattern | 当前真实用例（均有靶子拥有的状态变化、兄弟未变、四 oracle 通过、两个 child 关闭） |
|---|---|
| `InvokePattern` | `#572 current WPF background Invoke changes only the target while all four desktop oracles hold` |
| `ValuePattern.SetValue` | `#572 actual no-focus setvalue changes target state with all four desktop oracles`（值含中文） |
| `SelectionItemPattern.Select` | `#572 actual no-focus select changes target state with all four desktop oracles` |
| `TogglePattern` | `#572 actual no-focus toggle changes target state with all four desktop oracles` |
| `ScrollPattern` | `#572 actual no-focus scroll changes target state with all four desktop oracles` |

对应公开 Windows job 原始日志：正常 Invoke 的 plain `ok` / 闭 DTO 在行 7081 / 7086，
独立诊断在 7091 / 7096；四个额外模式在 7155–7178。该完整日志为 715696 bytes，
SHA-256 `6ab92797912620bf7cdf8e8ed95dbc77eb5860d2188a6bd84d576150e7440d15`。
`computer-uia-invoke-integration.test.ts` 与 `helpers/uia-no-focus-native-572.ts` 中的原生断言
不仅检查调用成功，还检查靶子标记、兄弟未变及四 oracle。

**拒绝证据：**同一 job 的 missing / invalid-pe / wrong-architecture / missing-symbol 四个 loader
用例均以 `pattern_unavailable`、`terminal: true`、固定 `background UIA terminal refusal` 拒绝，
无靶子动作、兄弟未变、四 oracle 通过、两个 child 关闭（日志 7183–7206）。ABI 用例验证十种
非法参数形状无靶子动作，同样保留 oracle 与清理（7211–7213）。这不是所有第三方框架的
模式不可用证明；具体模式不支持仍由 `UIA_PATTERN_UNAVAILABLE` 等精确码及对应夹具判定。

**兼容边界：**旧 standalone `computer-uia-invoke.ps1` 动作入口现为 failclosed
`host_pipeline_required`（固定 `UIA_TERMINAL:UIA_PATTERN_UNAVAILABLE`，不执行动作）。
当前生产动作由 host 在一个原 15000ms 总剩余预算内完成 select/act；没有 nested PowerShell。
旧混合客户端的失败反事实与原生历史保留，不能把旧 CLI 写成当前成功动作路线。
详见 `companion/tests/fixtures/win/README.md`。

以上是 **WPF pattern 级**证据：executor 仍只把符合现有闸门的左键映射为 `Invoke`。
`SetValue` 不等于通用键盘/热键，`ScrollPattern` 成功不等于 executor 的通用 scroll 已改走后台，
更不证明其它工具包的相同行。输入泄漏仍为 **derived**，未升级为物理输入队列观察。

#### 历史 WPF / WinForms 证据（保留）

**WPF 历史证据**（2026-09-30 本机实测，夹具 `companion/tests/fixtures/win/uia-wpf-fixture.ps1`）：

```json
{"ok":true,"mode":"invoke","controlType":"Button","automationId":"cmspark_fixture_button",
 "tried":["invoke:ok"],"foreground":false,"ms":2107}
```

UIA 树为 `Window/Button/Text`；点击处理器写的标记文件出现 ⇒ **靶子侧状态变化** ⇒ Delivered。
**四个后台 oracle 现已全部通过**（同一台机、同一夹具、同一轮实测）：

```
focus_kept           true
zorder_kept          true
cursor_kept          true
no_leaked_input      true   (类型: derived —— 见 §5 的诚实说明)
background_verified  true
```

oracle 脚本：`computer-bg-oracles.ps1`（`snapshot` / `compare` 两模式）。
**且已证明 oracle 有牙**：`computer-bg-oracles.test.ts` 用合成快照逐项触发 ——
焦点变 / 光标动 / z 序变 各自都会把 `background_verified` 打成 **false**；
并且 **`-Delivery sendinput` 即使桌面一切未变也必须判 false**（前台路径不得冒充后台）。

> ⚠️ `no_leaked_input` 是 **derived** 而非 observed：它由 `focus_kept ∧ cursor_kept ∧
> 投递方式是 UIA-pattern` 推出（SendInput 注入输入队列、必然作用于持焦窗口；UIA 模式直接作用于元素）。
> 这是**强代理而非证明**，故台账记为 derived。将来若加输入队列观察者，可升级为 observed。

**同为 Windows 的 WinForms 是反例**（同批实测）：其 Button 经 UIA 只暴露成**裸 `Pane`、无动作模式**：

```
UIA_PATTERN_UNAVAILABLE:no usable UIA action pattern for 'SubmitTest' (Pane) tried=[invoke:unsupported]
```

⇒ 表中该历史夹具记为 **Refused**（精确码），**不是** Delivered。夹具 `uia-winforms-fixture.ps1`。
此结论限于该轮暴露为 `Pane` 的控件，不代表所有 WinForms 控件或模式都不可用。
**这就是「UIA 暴露面取决于工具包」的实证** —— 也是 cua 自建原生夹具的原因。

**其余行仍是 Gap**：填它们需要可复现夹具（§5③）+ 后台 oracle（§5②）。在那之前不填 —— **不许猜**。

> 参考：cua 在 Windows 上已证实的行可供我们**假设**，但**不能当我们的证据**。
> 例如它记 Windows/Electron **后台左键可做**，而右/双击、type、press key、hotkey、scroll、editor save
> 返回 `background_unavailable`；Windows/Tauri 则连 hotkey 与 scroll(PX) 都不可。
> **我们若照此实现，必须自己跑夹具验收后才填行。**

---

## 4. macOS / Linux

macOS 的 `host.swift` 已有外部 AX 定位与 press/increment/decrement/confirm/cancel/setvalue，
`darwin-adapters.ts` 可直接调用；`computer-bg-oracles.sh` 提供真实窗口/光标 snapshot 和严格
compare。它们是**源实现**，不是后台 Delivered 证明。Linux 桌面投递仍为 Gap（无实现）。

### macOS 焦点观测边界（#571，源码修正，原生验收待完成）

屏幕堆叠的首个 CG 窗口不等于接收键盘焦点的窗口。`window-list --foreground`
保留原有全部返回行和顺序，并额外返回只读 `foregroundWindowId`（数字或 null）：从系统级
AXFocusedApplication/AXFocusedWindow 读取真实焦点对象，要求其 PID、非空精确标题和有限精确
位置/尺寸与唯一已列出的 CG 窗口对应；不按层级、前台应用首行、标题近似或距离猜测。

对应前要求 focused window 是该应用完整 AXWindows 数组中唯一 CFEqual 成员，且完整元数据
在 AX 与 CG 两侧都不歧义。新实现证据预算为 **最多256个 AX 窗口**，超过即整次未知，绝不截前缀；
数组成员任一缺失/错误/无标题/不合法几何也未知。读取后再次核对 focused app/window、完整数组
及元数据；变化、无权限或无法对应都返回 null。该保守条件可能拒绝拥有无标题或未完整暴露窗口的应用。
公开 AX/CG 调用不是原子快照，双读不是对两次调用之间任意 ABA 或未来焦点变化的保证。

snapshot 仅接受唯一实际列出的正整数测量 ID，没有顶项回退；完整原始 z-order、cursor 和
sibling 的 before/after 严格断言不变。纯 Node 受控源投影不是 Swift SDK/native 执行，当前历史
OTHER 行的 owner/layer 和唯一原因仍 UNKNOWN。该修正不新增动作、激活、TCC 权限或清理权；
只有新 head hosted Mac 的实际 marker 和原全部 oracle 通过，才能回填 Delivered/Refused。

### macOS 目标窗口遍历与夹具身份（#571，原生验收待完成）

`ax-locate` / `ax-invoke` 不再从常常没有 AXSize 的 AXApplication 节点遍历：旧实现会在
读取该节点的子节点之前用零尺寸过滤整棵树。现在先将请求的 CGWindowID 与当前 PID、
UTF8 精确标题和有限正尺寸几何对应到唯一实际 AXWindows 成员，再从该窗口开始原有遍历。
请求 ID 必须是正的 UInt32 整数，布尔、分数或截断回绕不能形成新身份。完整目标窗口证据
使用独立的新 **256窗口上限**，超限、AX 成员证据缺失、仍可能匹配目标的 CG 行证据缺失/歧义、
两次 CG/AX 观察或成员次序变化都拒绝，不选第一个窗口，也不以同名 sibling 代替。
只有 CG 行已知的 UTF8 标题字节或有限几何分量与完整目标值相异时，才排除该不可能匹配的行；
缺失、类型不符或非有限值本身不能证明不匹配。目标 ID/完整元数据仍在此排除之前严格验证。该读证据过程不激活窗口、不扩 TCC；
`ax-invoke` 保留原动作/值校验、周期与动作前 E-Stop 检查，并在证据读取阶段检查停止。
原 hidden/zero-size 过滤、50层遍历、元素 name/role 复核和支持动作条件保留。

owned 夹具中的 `NSWindow.windowNumber` 是应用设备编号，不能与全局 CGWindowID 直接比较。
夹具改为用当前 `NSScreen.screens.first` 的完整主屏 frame，将实际 NSWindow 全框转换到 CG
上左原点坐标，再按当前 PID、固定精确标题和有限精确全框唯一选取 CG 行；不使用 keyboard
screen、Retina 倍率、最近几何或 first-row 猜测。再次观察同一 screen/window 对象、完整 frame
和 CG 对应，缺失或变化不发布 ready。既有 activation/key、20秒期限和 owner cleanup 不变。

这些对应仍是非原子的保守双读，不承诺排除两次系统调用之间的任意 ABA；无标题或不完整
暴露的应用可能被拒绝。CPU 源投影不是 Swift SDK/AppKit/CG 执行，已有原生失败的唯一原因
仍 UNKNOWN。AppKit/WK 的 target marker 与同轮完整 oracle 未通过前，下表继续保留 Gap。

### 4.1 macOS AX：逐框架 / 动作与证据

当前所有下列行仍是 **Gap**，因为本变更没有运行本机或 hosted AX。原生验收代码的存在、
Swift 类型检查、纯 Node 比较控和 owned fixture 都不能代填 Delivered / Refused。

| 靶子/框架 | 动作 | 当前状态 | 确切证据 / 尚缺什么 |
|---|---|---|---|
| AppKit NSButton | press | **Gap** | `computer-ax-native-571.test.ts` 的实际 external AX AppKit 行已接 hosted Mac；待真实 target marker + 同轮 focus/z-order/cursor 与 derived no-leak 回执。 |
| WKWebView | press | **Gap** | 同文件实际 external AX WKWebView 行；marker 必须来自真实 trusted click→当前 WebView 主 frame，待同轮四 oracle。 |
| AppKit | increment | **Gap** | `cuAXInvoke` 已有源分支；本叶未提供对应靶子 / action 实测。 |
| AppKit | decrement | **Gap** | 同上；未验不当不可用。 |
| AppKit | confirm | **Gap** | 已有 AXConfirm 源映射；未取得实际靶子效果或带 oracle 的精确拒绝。 |
| AppKit | cancel | **Gap** | 已有 AXCancel 源映射；缺实际该行验收。 |
| AppKit | setvalue | **Gap** | 已有 AXValue 源映射；缺实际该行验收。 |
| WKWebView | increment / decrement / confirm / cancel / setvalue | **Gap** | 是否由控件暴露取决于实际 AX provider；本叶不捏造统一结果。 |
| macOS | selection / scroll / drag | **Gap** | 没有本组对称动作映射与验收；不是本叶新增的全模式关闭前置。 |

**实际运行后如何回填**：hosted `macOS external AX action and background oracles (#571)` 先构建
真实 `cmspark-host` 源码（仅验收构建启用固定阶段诊断，普通 host 输出不变）和独立 unshipped owned
target，再运行完整 native test。
`AX571_PERMISSION` 只包含固定身份/布尔事实；`AX571_ROW` 只包含框架/动作、三态、有限码和 oracle
布尔。只有 target-owned marker 确变且 focus/z-order/cursor 均 true，才可把对应 press 行改
Delivered 并附本轮 commit/run/test；真实精确拒绝码且同轮 oracle 全通过才改 Refused。
未知错误或缺权限/观测仍为 Gap，不用返回 ok 冒成功。TCC 权限 false 是真实硬失败，不 skip。
原票最低成功标准是**至少一条**真实 AX 动作通过三项实测后台 oracle，不要求本表所有模式都 Delivered。

**身份边界**：builder 校验签名 Identifier 为 `com.cmspark.agent`；运行前现有 `security-check`
实测 `axTrusted` / `secureInput`。该测试路由为 Node 直接父进程→签名 CLI，不安装 app、不改权限。
TCC 的最终责任身份仍为 **UNKNOWN**，不以 codesign Identifier 或父 PID 冒授予权限；hosted
实际信任状态需保留。如果 trust=false，保留该次有限拒绝，不能把旧身份记录或别的 native 绿挪来代验。

**负控与残余**：同 owned target 的 estop、错误 role 负控要求 marker 未写；未知 / null 观测
严格失败。`no_leaked_input` 始终标 derived。production `executor` 当前没有把 Mac AX 自动接入
坐标回退链，仍是明确残余；这是原票最小 native 验证之后的独立接线事项，不偷偷新增为本叶关闭条件。

---

## 5. 验收 oracle 现状（诚实盘点）

「后台」要成立，至少需要这四类 oracle。我们的现状：

| oracle | 现状 | 证据 |
|---|---|---|
| **靶子状态变化** | ✅ 有 | `executor.ts` 的 `crossverifyChannel: "pixel-region" \| "uia+ocr"`；`computer-imgdiff.ps1` 的 `maxZoneRatio`/`maxBlobRatio`（专为区分「弹窗出现」与「光标闪烁」设计） |
| **弹窗不变量（A2.1）** | ✅ 有（每次注入后跑） | `executor.ts:1403` |
| **focus 未变** | ✅ **有**（已实测） | `computer-bg-oracles.ps1`（`focus_kept`） |
| **z-order 未变** | ✅ **有**（已实测） | 同上（`zorder_kept`，EnumWindows 顶序 Top-16） |
| **无输入泄漏** | 🟡 **derived**（非 observed，见 §3.3 说明） | 同上（`no_leaked_input`） |
| **光标保持** | ✅ **有**（已实测） | 同上（`cursor_kept`，GetCursorPos） |

⚠️ **注意区分**：前两项服务于**安全**（别在弹窗上乱点），后四项才能证明**「后台」真的成立**。
后四项已有实现、WPF 历史及 §3.3 当前原生验收记录，其中输入泄漏仍为 **derived**。
其它靶子的后台结论仍须各自夹具与同轮 oracle 支持，不能借用 WPF 的结果。

**另有两项既有资产值得记名**（比 cua 更强的部分）：
- `computer-evidence-seal.ps1`：凭据区域**先打码**（原始像素**永不落盘**）→ DPAPI 加密 → 删原始输入。
- `computer-cu-redteam-corpus.test.ts`：对抗配对语料（「任务目标 ≠ 注入目标」，
  跨语料注入坐标与目标 bbox **重合率 0%**），且**要求诚实记录残余**、**不许标 ✅**。

---

## 6. 缺口与下一步（Windows 先行）

| # | 事项 | 状态 |
|---|---|---|
| 1 | **本台账** | ✅ 本文件 |
| 2 | **补 4 个后台 oracle** | ✅ 已做（`computer-bg-oracles.ps1`；基础 5 项比较测试，Windows 门禁另设 56 项校验＋1 项真实新旧脚本对照，按实际回执验收；`no_leaked_input` 为 derived） |
| 3 | **Windows 后台投递**：UIA 动作模式 —— 脚本已落地并在 WPF 实测；**executor 已接线**（仅左键，条件窄；不绕过 A2.1/预算/速率窗） | ✅ |
| 4 | **GUI 夹具** | 🟡 当前 WPF Invoke / 四种额外 pattern 正控与 loader/ABI 负控；旧 WinForms 反例保留为历史，其余靶子待做 |
| 5 | **逐靶子回填**：WinUI3 / WebView2 / Electron / Tauri / 原生 Win32 | **记名 Gap** —— 当前已有 WPF 五种 adapter pattern 原生证据，不外推到这五类框架；仍缺各自夹具与同轮 oracle |
| 6 | 通用键盘 / 滚动 / 拖拽的后台投递 | **记名 Gap / 部分机制已证** —— WPF `SetValue`/`Select`/`Toggle`/`ScrollPattern` 已验收；executor 仍只接后台左键，key/scroll/drag 仍走前台。不能把 SetValue 当通用键盘或把 adapter Scroll 当 executor 后台滚动；UIA 无右键/双击模式 |
| 7 | **macOS 对齐** | #571：源 AX / oracle + owned AppKit/WKWebView gate 已接线，§4 当前按行 Gap，等待真实 hosted 最小动作回执 |

#572 原 body 的最小验收是一个 WPF 或 WinUI3 夹具、先左键、四 oracle、精确拒绝和台账回填，
并明确允许残余记名。当前 WPF 最小路线已有上述实际证据；第 5、6 项仍是原评论中的
记名残余，不宣称全框架/通用动作已交付，也不以 WPF 通过替它们验收。macOS 仍归 #571。

**纪律**：第 3 步无论成败都要**写回本台账** —— 那是这件事的价值所在。
第 3 步的拒绝要**精确码**（例如 `uia_pattern_unavailable` = 该控件不暴露可调用模式），
而不是笼统失败。

---

## 附：本表的维护规则

- 新增动作/靶子 → **先加行并标 Gap**，实现并用夹具证实后再改状态。
- 任何 `Delivered` 行都必须能指出**证据**（测试名或运行号）。
- 已知残余**记名**列出，不得含糊（沿用 `corpus.knownResiduals` 的做法）。
- 状态降级（Delivered → Gap）必须留痕说明原因。
