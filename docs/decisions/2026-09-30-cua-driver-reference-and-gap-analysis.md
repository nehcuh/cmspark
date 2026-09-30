# Cua Driver 参考分析与我们 Computer Use 的差距

**Date**: 2026-09-30
**Status**: 参考分析（**等 owner 定方向**，未动代码）
**来源**: [trycua/cua](https://github.com/trycua/cua)（27.5k★）→ `libs/cua-driver`
**我方对照**: `companion/src/computer/`（13,623 行）、`docs/host-and-apps.md`、
`docs/decisions/2026-07-23-foreground-raise-*.md`、#534 / #532 / #531 / #529

> ⚠️ 阅读范围声明：本文基于 cua-driver 的 **README 与 `docs/action-support.md`**
> （均为官方文本）以及 `libs/` 目录结构。**未**读其 Rust 实现、未读 `test-matrix.md`/harness fixtures 细节，
> 故凡涉及内部实现的说法都标为「据其文档」。我们的侧数据来自本仓实测（行数、码表、issue）。

---

## 0. 一句话

cua-driver 把**「不抢焦点地操作原生应用」**当作**首要设计目标**，并为此建立了一套
**可审计的能力台账 + 证据标准**。我们走的是相反方向 —— **把前台提升做可靠**（2026-07-23 决策），
于是每一次坐标操作都要一次性 L2 确认，而确认窗口只有 5 秒（#534 / #530）。

这不是「他们实现得更好」，而是**两条不同的轴**。值得参考的是**方法**，其中一部分可以正交地搬过来。

---

## 1. 它最值得学的三件事

### ① 证据标准：「成功响应不是证据」

`action-support.md` 开篇第一句：

> *"It is derived from typed `CaseSpec` rows and accepted E2E evidence,
> **not from a successful driver response alone**."*

三态定义：

| 状态 | 判定 |
|---|---|
| **Delivered** | 观测到 **fixture 拥有的状态变化** |
| **Refused** | **精确的结构化拒绝码** + 全部副作用 oracle 通过 |
| **Gap** | 不支持或尚未证实 |

并且：

> *"A missing row is never evidence that an action is impossible."*

**「后台操作」要成立，必须同时通过五个 oracle**：fixture state · focus 未变 · z-order 未变 ·
**无输入泄漏** · **光标保持**（Win/macOS/X11 需要）。Wayland 的光标 oracle **明确标为 unsupported**
并开 issue #2194 跟踪 —— 宁标 gap，不含糊。

👉 **对我们的直接映射**：#532「L2 预览失败（stale/solid frame）后**静默降级**，确认框不说明」、
#531「录屏开关显示已开启，进程侧仍报 ScreenCaptureKit -3801」——
我们缺的正是「状态变化即证据」这条判据：**开关的状态、工具的 success 都不是证据**。

### ② 台账的两个正交维度：**AX/PX 选择** × **后台/前台投递**

> *"AX and PX describe how the target is **selected**. They do not require the same delivery backend:
> a PX target may be hit-tested and delivered through AX/UIA when that is the background-safe route."*

即：**「怎么找到目标」与「怎么把输入送进去」解耦**。我们用像素坐标点击时，
其实可以先 hit-test 命中元素，再用 UIA/AX 语义投递 —— 那就不需要前台。

**它的实测结论对我们很有用**（macOS 行）：

| 目标 | 后台**可做** | 后台**做不到**（精确拒绝码） |
|---|---|---|
| macOS · Electron | 左/右/双击 AX+PX、type text、press key、hotkey、子窗口、editor save | scroll、drag(PX) → `background_unavailable` |
| macOS · Tauri / WKWebView | 同上 + **scroll** | drag(PX) → `background_unavailable` |
| Windows · Tauri | 左/右/双击、type、press key、子窗口、scroll(AX)、editor save | hotkey、scroll(PX) → `background_unavailable`；drag(PX) → `background_occluded` |

👉 **对我们的直接映射**：#534 的结论是「浏览器内多步自动化等于不可达」。
但按这张表，**Electron/Tauri/WKWebView 目标的点击与输入本来就可以在后台完成** ——
若我们能在这些 harness 上走「hit-test 命中 + 语义投递」，那条「每次都要 5 秒确认」的死结就可能松开。

### ③ 「拒绝」是一等公民，且有**精确码**

它的拒绝码如 `background_occluded` / `background_unavailable`：精确、结构化、可断言。

**这一条我们其实不差** —— 我们有 37 个 `ComputerErrorCode`
（`CLICK_OCCLUDED` / `FOCUS_LOST` / `FOREGROUND_RAISE_FAILED` / `STALE_SCREENSHOT` /
`HWND_NOT_OWNED` / `HWND_DEAD` / `INTEGRITY_LEVEL_DENIED` / `TYPE_NO_EFFECT` / `SEND_NO_EFFECT` …），
概念上与它高度对应。

**差距在于这些码之后没有「台账」**：它们散落在实现里，没有被汇总成
「哪个平台 × 哪个框架 × 哪个动作 × 能否后台」这样一张能被引用、被验收、被防回归的表。

---

## 2. 工程形态上值得注意的几处

| 做法 | 说明 | 我们能借鉴吗 |
|---|---|---|
| **MCP over stdio 作为唯一 agent 边界** | 语言 SDK 明确声明**面向客户端应用、不面向 agent**；「agent 边界」只有可执行文件一个 | ✅ 与我们 `mcp-outbound` 思路一致，是个正面印证 |
| **contract-first SDK** | Rust 契约 crate 生成 manifest；C ABI 头由 `bindgen --check` 在 CI 校验，**实现与分发头不可漂移** | ⚠️ 我们是 TS 单仓，收益有限；但「生成物必须 `--check`」这条通用 |
| **权限模式在启动时固定** | `standard`(默认无提示) / `bounded`(仅 manifest 内的工具与资源) / `unrestricted`(需 `--dangerously-bypass-approvals`)。模式属于持有 runtime 的进程，**运行中不可改，要重启** | ✅ 与我们 L2/grants 能对上；「启动时固定 + 需重启才改」是个值得抄的**抗绕过**性质 |
| **宿主渲染授权 UI** | `DriverAuthorizationHost` 由嵌入方实现；driver **不自绘弹窗** | ✅ 与我们「确认中心由扩展渲染」一致 |
| **Computer History：严格 allowlist + 明确的 never-store 列表** | 加密历史，**只存元数据白名单**，权限门控的 `history_status`/`history_query` 只读回灌；**绝不存**截图/输入文本/剪贴板/原始参数与结果/AX 树/路径/窗口标题/URL | ✅✅ 与我们 #569 刚做的「终止留痕」同源；**「never-store 列表」这个写法值得直接抄** |
| **自建 GUI harness 应用做 hermetic E2E** | `tests/fixtures/` 是**源码构建的** WPF/WinUI3/WebView2/AppKit/Electron/Tauri 夹具应用 | ✅ 这是我们最缺的一环（见 §3） |
| **license 边界** | driver MIT；`cua-perception` 扩展**不是 MIT**（OmniParser 图标检测器 AGPL-3.0-only），**再分发/网络提供可能触发 AGPL 义务** | ⚠️ 若我们借鉴其 perception，**必须注意这条**；宁可自己实现或用可商用模型 |

---

## 3. 我们的真实差距（按可修性排序）

| # | 差距 | 现状证据 | 参考它的做法 |
|---|---|---|---|
| **G1** | **没有能力台账** | 全仓无「平台 × 框架 × 动作 × 后台/前台」矩阵；`ComputerErrorCode` 有码但无汇总 | 建 `docs/computer-capability-ledger.md`：三态 + 精确码 + 每行可追溯的 E2E 运行号 |
| **G2** | **有 oracle 机制，但没有「按动作行的验收标准」** ⚠️ *（本文初稿写成「没有 oracle」，是**错的**，已更正）* | 我们**确实有**真 oracle：`executor.ts:1403` 的 **A2.1 动作后弹窗不变量**（每次注入后跑，用前台变化 **或** imgdiff 的 `maxZoneRatio`/`maxBlobRatio` 判定）、`crossverifyChannel: "pixel-region" | "uia+ocr"` 的效果交叉验证、`computer-evidence-seal.ps1` 的凭据打码+DPAPI（原始像素永不落盘）。**缺的是**：① 它们面向**安全/弹窗检测**，不是「能力验收」；② `focus 未变` / `z-order 未变` / `无输入泄漏` / `光标保持` 这四个 —— **恰恰是「后台」成立所必需的 —— 一个都没有** | 用现成的 imgdiff/UIA 机制补这 4 个 oracle；然后把「每行都要过 oracle」写成**验收标准** |
| **G3** | **没有 GUI 夹具应用**（我们只有 `scripts/spike/` 下的一次性探针，不是可复现夹具） | 无法 hermetic 复现「Electron 后台点击」这类断言；实测依赖真实浏览器/应用 | 先做**最小**夹具（一个 Electron + 一个 WPF/WinUI 窗口），够覆盖我们最痛的动作 |
| **G4** | **坐标与观测未绑定** | 我们的坐标是「client-logical points + 散文式 Retina 提示」；#532 有 stale frame 问题 | 抄 **一次性 `capture_id`**：由某次观测派生的点击必须携带**同一个一次性 id**，杜绝陈旧坐标 |
| **G5** | **后台投递未作为一等目标** | 2026-07-23 决策选了「把前台提升做**可靠**」；于是坐标操作每次都需一次性 L2 + 5 秒窗（#534/#530） | 不必推翻原决策 —— 而是**先补一条后台通道**并**用台账说明它覆盖到哪** |
| **G6** | **osascript 类死路曾长期作为候选** | #529（我们刚下架）：现代 Chrome 上 AppleScript-JS 是确定性死路，却一直作为 last resort | 它的做法：**进不了台账的动作直接标 Gap**，而不是留在文案里当候选 |

> G6 值得单独说：我们**刚刚**才把 `osascript_eval` 全平台下架（#529，v0.6.11）。
> cua 的台账如果早存在，这类「确定性死路」根本不会被写进工具候选 ——
> 那不是实现问题，是**缺一张表**的问题。

---

## 4. 不该照搬的部分（如实说明）

- **它是「跨 OS 车队 + 沙箱/VM + 基准」的盘子**（`lume` / `fleets` / `kasm` / `qemu-docker` / `cua-bench`），
  我们是**就地操作用户自己的桌面**。目标不同，别把 VM 那套搬进来。
- **Rust + UniFFI + C ABI + 多语言 SDK**：我们单仓 TS，这套分层的收益远小于维护成本。
- **`cua-perception` 的 AGPL 约束**（见 §2）。
- **它的平台面比我们宽**（Linux Wayland/Sway 等），但我们在 Windows/macOS 的**产品纵深**
  （确认中心、生物识别、紧急停止、vault/LOLBIN 结构排除、host_read/host_write）它没有 —— **别为了对齐而丢纵深**。

---

## 5. 建议路径（三步，均不推翻既有决策）

**第 1 步（低成本，先做）— 把台账建起来**
- 新 `docs/computer-capability-ledger.md`：行 = (平台 × 框架/靶子 × 动作 × 后台/前台)，列 = 三态 + 确切拒绝码。
- **诚实起步**：现在能填的只有我们已经验过的行，其余一律 `Gap`（并写明「未证伪 ≠ 不可能」）。
- 同时把 #532/#531 的「静默降级」按 oracle 判据重述为 Gap/Refused。

**第 2 步（中成本）— 挑一条后台路径打通并上报**
- 优先 **Windows/WinUI3 或 macOS/Electron** 的**左键点击**（cua 两边都标为后台可做）。
- 实现要点：**PX 选择 → hit-test → UIA/AX 语义投递**（§1② 的解耦）。
- 配上 5 个 oracle 的最小断言 + 一次性 `capture_id`（G4）。
- 结果无论成败**都写回台账** —— 这一条是整件事的价值所在。

**第 3 步（按需）— 夹具化**
- 只做**够用的**夹具（Electron + WPF/WinUI 各一个），把第 2 步的断言变成 hermetic E2E。

---

## 6. 待 owner 决断

1. **要不要做第 1 步？**（我倾向：要。纯文档、零风险、且立刻能暴露「哪些动作是 Gap」）
2. **要不要动后台投递这条轴？**（= 部分重开 2026-07-23 的「前台提升」决策。**这是产品方向选择，我不自行决定**）
3. 若要走后台轴：**先做哪个平台/框架**？（数据支持 Windows/WinUI3 与 macOS/Electron 的左键）

---

## 附：本次核对到的我方事实（可复核）

- `companion/src/computer/` 共 **13,623 行**（40 个文件）
- `host_computer` 参数：`task, app, actions, budget, trigger_reason`；`actions` 为结构化数组
  （click(x/y 或 OCR target) / type / key / scroll / drag / wait / screenshot / describe）
- `ComputerErrorCode` **37** 个
- `docs/host-and-apps.md:8` 的「能力坐标」讲的是 **Surface/Composition/Autonomy/Trust** 四轴，
  **不是**平台×动作的能力矩阵 —— 两者不是一回事
- 2026-07-23 决策的**明确否决项**含：`osascript AXRaise via System Events`（需额外 TCC 且会 raise 错窗）
