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
| **投递（怎么把输入送进去）** | **`SendInput`，且必须先 `SetForegroundWindow`**（重试 3 次；失败即 `FOCUSLOST` 拒绝，绝不盲注入） | `computer-input.ps1`（26KB，WP1/WP2） |
| **UIA 动作模式** | **全仓为空**（`InvokePattern` / `ValuePattern` / `LegacyIAccessiblePattern` / `ScrollPattern` / `SelectionItemPattern` / `TogglePattern` 均无引用） | 全仓 grep = 0 |

### ⚠️ 这张事实表说明的结构性限制

**我们对 UIA 的用法只到「定位」，投递一律走 `SendInput` ⇒ 目标必须在**前台**。**

于是每一次坐标操作都要把窗口提到前台，而**提前台本身需要人工确认**（一次性 L2，窗口 5 秒）。
两者相乘 = **多步任务实际上不可达**（#534 / #530）。

cua 的做法不同：既然已经通过 UIA 找到了元素，就**用 UIA 投递动作**
（`Invoke()` / `SetValue()` 等），**不需要前台**。
→ 这正是本台账要记录、并要补上的那条轴（见 §6）。

---

## 3. Windows 台账

> 我们**只在 Windows 上有实现**。macOS 见 §4。
> **本表的空白 = 尚未用夹具证实，不等于不可能。**

### 3.1 投递路线（机制级）

| 路线 | 状态 | 精确拒绝码 | 证据 |
|---|---|---|---|
| 前台 `SendInput`（坐标键鼠） | **Delivered**（机制存在且被使用） | `FOCUSLOST`（提前台 3 次失败）、`SENDFAILED`（注入事件数不符） | `computer-input.ps1` |
| **后台投递（不经前台）** | **Gap** | — | 未实现（无 UIA 动作模式） |

### 3.2 结构与策略性拒绝（**不是**未实现，是**有意拒绝**）

| 项 | 状态 | 精确拒绝码 | 证据 |
|---|---|---|---|
| 浏览器类应用的坐标控制 | **Refused**（结构性排除，强制清除 hints） | `APP_COORDINATE_STRUCTURAL`（日志原文：`has coordinate/UIA hints on a vault/LOLBIN binary — force-cleared (structural exclusion, A10/Y5)`） | `docs/host-and-apps.md`、#534 |
| 高危区域（假 UAC / 假支付 / 凭据邻域） | **Refused** | `DANGER_HARD_DENY`（零 re-L2 路径） | `computer-cu-redteam-corpus.test.ts` ③ 类 |

### 3.3 按靶子/框架的行

| 靶子/框架 | 前台左键 | 后台左键 | 后台键盘 | 后台滚动 | 后台拖拽 |
|---|---|---|---|---|---|
| **WPF** | Gap | **Delivered（后台已验证）** ✅ | Gap | Gap | Gap |
| WinUI3 | Gap | Gap | Gap | Gap | Gap |
| WebView2 | Gap | Gap | Gap | Gap | Gap |
| Electron | Gap | Gap | Gap | Gap | Gap |
| Tauri | Gap | Gap | Gap | Gap | Gap |
| 原生 Win32 | Gap | Gap | Gap | Gap | Gap |

**WPF 行的证据**（2026-09-30 本机实测，夹具 `companion/tests/fixtures/win/uia-wpf-fixture.ps1`）：

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

⇒ 该靶子此行应为 **Refused**（精确码），**不是** Delivered。夹具 `uia-winforms-fixture.ps1`。
**这就是「UIA 暴露面取决于工具包」的实证** —— 也是 cua 自建原生夹具的原因。

**其余行仍是 Gap**：填它们需要可复现夹具（§5③）+ 后台 oracle（§5②）。在那之前不填 —— **不许猜**。

> 参考：cua 在 Windows 上已证实的行可供我们**假设**，但**不能当我们的证据**。
> 例如它记 Windows/Electron **后台左键可做**，而右/双击、type、press key、hotkey、scroll、editor save
> 返回 `background_unavailable`；Windows/Tauri 则连 hotkey 与 scroll(PX) 都不可。
> **我们若照此实现，必须自己跑夹具验收后才填行。**

---

## 4. macOS / Linux

| 平台 | 状态 | 说明 |
|---|---|---|
| macOS | **Gap（未系统化验证）** | 有 `darwin-adapters.ts` / `darwin-estop.ps1` 等实现，但**从未按 §1 判据系统验收**；且 `osascript_eval` 曾是确定性死路（#529，v0.6.11 已下架） |
| Linux | **Gap（无实现）** | 全仓无 Linux 桌面投递实现 |

→ **macOS 立 issue 跟踪**（本轮不做，见 §6）。

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
我们**有机制，缺后四项** —— 而它们恰恰是「不抢焦点」这件事的验收条件。

**另有两项既有资产值得记名**（比 cua 更强的部分）：
- `computer-evidence-seal.ps1`：凭据区域**先打码**（原始像素**永不落盘**）→ DPAPI 加密 → 删原始输入。
- `computer-cu-redteam-corpus.test.ts`：对抗配对语料（「任务目标 ≠ 注入目标」，
  跨语料注入坐标与目标 bbox **重合率 0%**），且**要求诚实记录残余**、**不许标 ✅**。

---

## 6. 缺口与下一步（Windows 先行）

| # | 事项 | 状态 |
|---|---|---|
| 1 | **本台账** | ✅ 本文件 |
| 2 | **补 4 个后台 oracle** | ✅ 已做（`computer-bg-oracles.ps1` + 5 项测试；`no_leaked_input` 为 derived） |
| 3 | **Windows 后台投递**：UIA 动作模式 —— 脚本已落地并在 WPF 实测；**executor 已接线**（仅左键，条件窄；不绕过 A2.1/预算/速率窗） | ✅ |
| 4 | **GUI 夹具** | 🟡 已有 WPF（正）+ WinForms（反）两个；其余靶子待做 |
| 5 | **逐靶子回填**：WinUI3 / WebView2 / Electron / Tauri / 原生 Win32 | 待做 —— 目前**只有 WPF 左键**被证实 |
| 6 | 键盘 / 滚动 / 拖拽的后台投递 | 待做 —— 脚本已支持 `setvalue`/`select`/`toggle`/`scroll`；executor 只接了左键（**只有左键有语义正确的 UIA 映射**：InvokePattern = 激活 = 左键；UIA 无右键/双击模式） |
| 7 | **macOS 对齐** | → #571 跟踪 |

**纪律**：第 3 步无论成败都要**写回本台账** —— 那是这件事的价值所在。
第 3 步的拒绝要**精确码**（例如 `uia_pattern_unavailable` = 该控件不暴露可调用模式），
而不是笼统失败。

---

## 附：本表的维护规则

- 新增动作/靶子 → **先加行并标 Gap**，实现并用夹具证实后再改状态。
- 任何 `Delivered` 行都必须能指出**证据**（测试名或运行号）。
- 已知残余**记名**列出，不得含糊（沿用 `corpus.knownResiduals` 的做法）。
- 状态降级（Delivered → Gap）必须留痕说明原因。
