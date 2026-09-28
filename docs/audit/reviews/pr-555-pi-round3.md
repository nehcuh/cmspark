我已完成独立核实（未改动仓库任何文件，`git status` 无 tracked 变更；所有实验都在 `/tmp/pi555` 的**副本**上做，`.test-dist` 原样保留）。

---

# PR #555 第三轮复审（独立核实 `61f19468`）

先锁定对象：`git rev-parse HEAD` = `61f19468…`，被审四个文件工作树干净。我自己的编译：extension 由 `npm test` 全量重建 `.test-dist`；companion 由我另跑 `npx tsc -p tsconfig.test.json --outDir /tmp/pi555/comp-dist`（8s，exit 0）——不采信你的产物。

## 1. N1：攻击真的堵住了 ✅（这是本轮最重要的结论，实测）

用**真实编译产物** `chrome-extension/.test-dist/.../browser-bridge.js` + 恶意桩（CDP `Runtime.evaluate` 返回 `exceptionDetails.exception.description = "Uncaught Error: Security Block: page says halt"`，scripting 通道同时抛同一文案），再把**真实 `r.error`** 喂进**真实** `companion/.test-dist/src/security.js` 的 `classifyError`：

```
error_code : WAIT_PROBE_FAILED
r.error    : WAIT_PROBE_FAILED: selector probe failed on both channels — cdp: cdp probe:
             the page raised an exception while evaluating the selector; scripting: …
page_text  : Uncaught Error: Security Block: page says halt | Uncaught Error: Security Block: page says halt
classifyError → recoverable   （上轮：security）
```

- 页面文本**不再**出现在 `r.error`；`data.page_text_untrusted` 完整保留原文 ✅
- `classifyError` 对该串返回 **recoverable**（不是 `security`）→ adapter 不 `shouldStop` ✅
- 换 `blocked by user` / `user rejected` 版本同样 recoverable ✅（这三条正是 `classifyError` 的 security 子串）

**下游能不能污染分类器**：全仓只有一处生产消费点 —— `companion/src/llm/adapter.ts:2121 classifyError(toolResult.error || "", {toolName, error_code: …data?.error_code})`。它**只读 error 字符串，从不读 data**。`data` 全程不进分类器 ✅。UI 侧（`ChatView.tsx`）只读具名键（`user_hint_zh`/`error_code`/`target_domain`/`review_id`/`vision_description`），不渲染该字段 ✅。

**一句话回答你的第 3 问**：`probeFailureMessage` **产出的串只含我们自己的字面量** ✅；但**选哪一条**仍由页面文本经 `isInvalidSelectorMessage(pageText)` 决定（我实测：页面抛 `…is not a valid selector` → 归 `INVALID_SELECTOR` + `refine_text_or_selector`，而正常应为 `WAIT_PROBE_FAILED`）。两者都是 recoverable，**无越权、无整轮终止**，所以只是「诊断可被页面带偏」的 NIT；不过 commit body 里「依据是我们自己的字面量、不是页面的说法」这句严格说只对了一半——**被分类的输入**是我们的字面量，**分支选择**不是。

## 2. 同类的洞**仍存在，但是既有、不是本提交引入**（建议立即立案）

`safeEvaluate`（`browser-bridge.ts:1003-1008`）仍把页面异常原文 `throw new Error(text)`，该 message 经 `failInteractive → codedToolError → classifyError`。我在 HEAD 上端到端复现：

```
get_element_info {text:"Sign in"}，页面 Runtime.evaluate 抛 "Security Block: …"
→ error = "CDP_ATTACH_FAILED: Uncaught Error: Security Block: page says halt; scripting fallback: …"
→ classifyError = security  → shouldStop / security_halt
```

即 `click` / `type` / `get_element_info`（比 `wait_for` 更常态的工具）上恶意页面仍可终结一轮。`61f19468` 未触碰 `safeEvaluate`，故**非回归**（我上轮已记为既有暴露），但从这轮起它**有可复现证据**了，请按 Issue-first 记账；本 PR 的安全声明应读作「收紧了我上一提交新引入的那条路径」。

## 3. N2 / N3：真的修好了，突变 2/1/1 我逐条复现 ✅

N2 端到端（`[{error: "Failed to execute 'querySelector' … is not a valid selector."}]` + CDP attach 死）→ `INVALID_SELECTOR` + `refine_text_or_selector` + `page_text_untrusted` 保留原文 + `classifyError=recoverable` ✅

突变（在 `/tmp` 的编译副本上做，先确认突变已应用且模块可加载）：

| 突变 | 我实测变红 | 你的声明 | 结论 |
|---|---|---|---|
| 注销 `wait_probe_failed`（companion） | **2**（正向 + 反证第二条） | 2 | ✅（此前 1） |
| 页面文本回 `message`（extension） | **1**（仅 SECURITY 用例） | 1 | ✅ 且精准、非空 |
| `anyProbeSucceeded` 永不置真 | **1**（「中途成功过一次」） | 1 | ✅（此前 0） |
| 我加测：丢掉 `first.error` 记录（N2 原形态） | **1**（N2 用例） | — | ✅ 修好且被钉住（此前 0） |
| 我加测：去掉 `anyProbeSucceeded` 守卫 | **1** | — | ✅（此前 0） |
| 我加测：只注销 `wait_timeout` | **0** | 未声称 | ✅ 与你「双保险」的诚实标注一致 |

两个被改的 companion 测试文件：**我自己的编译 → 11/11 全绿**（新文件 4/4）。

小 NIT（文档漂移，非缺陷）：`web-act-loop-wave1.test.ts` 新加的 `WAIT_PROBE_FAILED: … cdp: Debugger attach failed for tab 7` 一行，在**注销登记**后**依然绿**（`debugger attach failed for tab` 本就是既有 recoverable 子串，我用突变 A 验的），与其上方注释「即便文案不含子串也判定为 recoverable」不符——真正测登记的是另一个文件（注释已交叉引用）。可在表里也补一条中性尾。
另建议（非阻塞）：登记目前靠 `codedToolError` 的 `"${CODE}: "` 前缀 + 子串表命中；若想彻底不依赖文案形态，可在 `classifyError` 顶部按本文件既有风格加 `error_code === "WAIT_PROBE_FAILED" → recoverable` 显式分支。

## 4. 新引入缺陷排查（第 3 问）

- `failInteractive` 第 4 参可选、`...(extraData || {})` 只在 `undefined → {}`；**16 个既有调用点全部 ≤3 参**，`tsc --noEmit` exit 0、全量 JS 编译通过 → 向后兼容 ✅
- 等待循环的 `anyProbeSucceeded` / `probeError` 逻辑与两个判据**未被本提交改动**（diff 里是上下文行），只多了 data 字段 → 无 verdict 漂移 ✅
- 全仓 grep：`page_text_untrusted` 只出现在新测试 + 本轮的 prompt 文档；无第二消费方 ✅（它确实进模型上下文——extension 把整个 `result` 通过 `tool.result` 转发——但上轮它就已在 `error` 里进模型，暴露面未变）
- 旧误导文案 `Timeout waiting for selector` 在 `src/` 计数 0 ✅；三条新文案在编译产物中各就位 ✅
- 顺带发现（**既有**、非本提交）：attach 错误文本被重复包了一层 —— `cdp: Debugger attach failed for tab 7: Debugger attach failed for tab 7: transient`。

## 5. 回归数字与证据强度

| 声明 | 我是否独立重跑 | 结果 |
|---|---|---|
| extension 1472/1472 | ✅ `npm test`（重建 `.test-dist`） | 1472 pass / 0 fail |
| 打包门禁 156/0 | ✅ `bash scripts/tests/test-package-gates.sh` | `156 passed, 0 failed` |
| `tsc --noEmit` exit 0 | ✅ | exit 0 |
| `plasmo build` | ❌ **我没跑** | 其 `prebuild` 会重写 `assets/` 里的**受版本控制** PNG，为保持只读评审我跳过了；改以编译产物字符串核对替代（风险很低） |
| companion 全量「相关失败 0」 | ✅ 我自己跑全量 | **59 秒**跑完，5310 用例、**62 条失败**（你报 70），全是 Windows 环境特异（EPERM symlink、0o600/0o700、macOS bundleId、packaged tray、fixture 逐字节）；按 `wait_for/probe/classify/security/act-loop` grep 失败名 → **0 条** |

对你那句诚实标注的评价：**结论够硬，论证方式偏弱但方向正确**。而且你漏掉了一个比「失败集合构成」强得多的结构性事实：**`61f19468` 对 companion 生产代码零改动**（`--stat` 只有 `tests/web-act-loop-wave1.test.ts` 一个测试文件），所以 companion 运行时行为**不可能**变化；唯一风险是那一个被改的测试文件，而它在我自己的编译下 11/11 绿。另外你「worktree 里跑到第 6 分钟无输出、判定挂住」在我这里**未复现**（59 秒跑完），那次应是环境问题，不必写进 commit body 当证据。数字口径 70 vs 62 不影响结论，但别再照抄。

## 结论

- **N1：真堵住了**（我把上轮的原始攻击形态在 HEAD 上重放，`security` 已消失、页面文本进 data、`classifyError=recoverable`）。
- **N2/N3：真修好了**，突变 **2/1/1** 三条我全部独立复现；我另加的两条突变也各 1 红。
- **无新引入缺陷**；`failInteractive` 向后兼容、`page_text_untrusted` 无下游误用。
- 余项都是 note：①同类的 `safeEvaluate` 洞（既有、可复现、更常态的工具面）**请立 Issue**；②页面文本仍能选我们两条字面量之一（仅诊断偏差，两者皆 recoverable）；③wave1 家族表那行注释漂移；④attach 文本重复包裹（既有）。

最后一行：

VERDICT: APPROVE_WITH_NITS
PI3_EXIT=0
