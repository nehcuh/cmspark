diag: pi=/c/nvm4w/nodejs/pi node=/c/nvm4w/nodejs/node
## BLOCKING（必须修才能合）

无。核心语义变更方向正确、有界、无新增可利用面。以下全部为可合并后收口项。

## NITS（非阻塞）

- **[P2] PR body / commit `2fc77c21` 的「修复前」表第 1 行是错的（over-claim，有仓库自身反证）** — 表称「元素不在页面上 修复前 `non_recoverable`」。实测（真 bridge + 真 `companion/dist/security.js`）修复前的文案就是 `"Element not found"`，而 `companion/src/security.ts:1023` 的 recoverable 子串表里有 `"element not found"` → **修复前已经是 recoverable**。我独立跑出的对照：`classifyError("Element not found", {toolName:"analyze_image"})` = `recoverable`（另见 `.../scratch` 无关 harness 输出）。**仓库自己的历史材料也这么记**：`docs/audit/reviews/pr-557-pi-round3.md:17` 的 A3 行 `{fail:"missing"}` → `"Element not found"` → `recoverable`。故「5 类失败全部（修复前 non_recoverable → 修复后 recoverable）」应为 4/5；该行真实收益只是「判定不再依赖文案」（这本身是 #560 的正经收益），但 PR 的*主证据表*有一格与事实不符。其余 4 行的对照我逐条复现为 `non_recoverable`（`Cannot render element` / `Cannot extract image (cross-origin, no src)` / `Failed to extract image data` / `selector is required for analyze_image`）。这是我最想在合并前改的文本项（PR body 可改；commit message 需 amend 或至少在 issue 里更正）。
- **[P2] `chrome-extension/src/background/browser-bridge.ts:995` — `ELEMENT_NOT_FOUND` 复用把 analyze_image 拉进 pivot 路径，带来两处未声明的行为变化。** 实测（`decideSameToolFailure` + 真 bridge 产物）：`ELEMENT_NOT_FOUND` 在 `failCount=3` 时返回 `pivot`，adapter 随即把计数清零（`companion/src/llm/adapter.ts:2171`）→ **同一 code 的失败预算从 3 变 6**（`MAX_SAME_TOOL_RECOVERABLE_FAILURES=3`，`adapter.ts:255`），且注入了 click 专属文案「不要再点击这句文字…」（`companion/src/llm/same-tool-guard.ts:15`），而 analyze_image 从不点击。结论仍有界（6 次后 `stop` → `circuit_breaker`，非 `security_halt`），pivot 文案本身是宿主字面量（不引入页面文本进可信通道）——所以不阻塞；但建议要么让 pivot 指令按工具分叉，要么把 analyze_image 排除在 pivot 之外。
- **[P2] `browser-bridge.ts:999-1002` — `suggested_action: "refine_text_or_selector"` 对 4 个码里的多数是误导。** `IMAGE_EXTRACT_FAILED`（跨域 taint / 无 src）、`BLOB_URL_UNSUPPORTED`、`IMAGE_MIME_REJECTED`、`IMAGE_RENDER_FAILED` 的成因与选择器无关，刷选择器不会好；该字段随 tool result 进模型上下文（`data.suggested_action` 在 recoverable 路径仍被 wrap 后喂回 LLM）。建议 `get_page_text`/`screenshot`/`switch_strategy`。
- **[P2] 测试表达力（`chrome-extension/tests/safe-evaluate-page-text.test.ts:77-101`）** — `hostImageFailure()` 校验「码 ∈ 宿主集合」「措辞 ∈ 宿主字面量集合」「`data.error_code` == 前缀」三者**独立**成立，不校验 (码, 措辞) 的**配对**。突变 M5（把 `IMAGE_RENDER_FAILED` 的措辞换成 `"Cannot extract image (cross-origin, no src)"`，两半仍是宿主字面量）→ **20/20 全绿**，未捕获。安全性质（两半都来自宿主）仍成立，故只是表达力缺口。另：`HOST_IMAGE_ERROR_CODES` 含 `SELECTOR_OR_TEXT_REQUIRED`，但 `HOST_IMAGE_ERROR_LITERALS` 不含它的两条措辞 → 那两条新 coded 路径根本无法被该助手校验（两个新测试只查了 code）。
- **[P2] 无跨包「码必须登记」的结构性守卫。** companion 侧 `IMAGE_FAMILY_CODES`（`companion/tests/classify-error-wait-for-codes.test.ts:150-158`）是手抄自 extension 的码表；extension 新增一个 image 码而 companion 忘登记时没有任何测试变红——即本 PR 修的那类漂移本身没有被绊线锁住（对照：同文件 `:340` 有 page-text 站点的 N7 绊线）。可选：加一条「extension 产出的 `codedToolError` 码 ⊆ companion 已登记集合」的结构断言。
- **[P2] 「family 全收」并不完整；PR body 的 Trust 行比 diff 宽。** 仍会整轮终止的 analyze_image 路径（均已实测）：`browser-bridge.ts:805` `"No active tab found"` → `non_recoverable`（无码、无子串命中）；`companion/src/tool/image-fetch-admission.ts:234` 的 `file:` 闸门文案 → `non_recoverable`；以及**页面可触发**的 `javascript:` candidate_url（页面改写返回对象为 `{fetchSrc:"javascript:alert(1)"}` → 真 bridge 实测返回 `success:true / type:fetch_required` → 闸门自有文案 `Security Block: analyze_image blocked scheme javascript: …`、**不带码** → `security` → 整轮终止，见 `docs/audit/reviews/pr-557-pi-round3.md:44` 登记）。最后一条是闸门在正常工作、非「良性形态」，且不在本 diff 内，所以不算缺陷；但 body 的「不再有『页面让操作失败即可整轮终止』的路径」应限定为「本 PR 触及的 5 条 phase-1 路径」。
- **[P3] `security.ts:944-955` 的分支位于 `:987` 的 `msg.includes("security block")` *之前*** —— 若将来有人把某个 image 码挂到 security 形态的文案上，会被降级成 recoverable。实测「hypothetical」：`classifyError("Security Block: analyze_image blocked scheme javascript: …", {error_code:"IMAGE_EXTRACT_FAILED"})` → `recoverable`。今天不可达（闸门拒绝不带码，7 个码的文案全是宿主良性字面量），仅作防卫性备注。
- **[P3] `#559` 第三条「页面可致假成功」被延后的理由不覆盖最尖锐形态。** 我实测（真 bridge）：页面让返回值为 `{}`/`5`/`"str"`/`[]`/`{foo:1}`（均可在 `returnByValue` 下产生）→ `success:true, type:"canvas", image_base64: undefined`；adapter 的 `VISION_TOOLS` 分支要求 `image_base64` 为真（`adapter.ts:1851`）→ 跳过视觉、工具却报成功。它不是门禁绕过（作者的判断成立），但「成功但没有图」比「伪造 base64」更容易让模型声称已看图。属既有行为、本 diff 未改，只是建议把这一形态写进 #559 的登记文本。

## 未能验证

- **真 headless Chrome 端到端**：我用的是测试同款桩 `chrome`（真 `browser-bridge.js` + 真 `companion/dist/security.js`）。「页面可改写整个返回对象」这一前提我**引用**前轮实测（`pr-557-pi-round3.md` §1，15 种形态），未自己起真浏览器复跑。
- **跨域像素确实取不到**（claim 6 的实质）：我只读代码确认 `IMAGE_FETCH_GATE` 与 `fetch_required` 判定未被本 PR 触及，未尝试从真页面获取跨域像素。
- **companion 全量失败项是否全部 pre-existing**：我观测到 **68** 个唯一失败名（claim 说 70），全部为 lock/symlink/EPERM/macOS/vault 族，与 4 个改动文件无关；我没有对 base commit 逐条 bisect，也无法解释 70↔68 的差（判为环境/时序抖动）。
- **#559 issue 正文**：本机无 `gh`/网络，未直接读 issue，仅引用前轮评审的引述。
- claim 5 的「companion 相关 0」我只能证明「无相关失败名」，不能证明 70 这个数字。

## 已核实为正确的声明

1. **claim 1** ✅ `companion/src/security.ts:944-955`：7 个码收进**一个显式 `error_code` 分支**（全 `===`，非子串表），并已把 `#556 N5` 的 `IMAGE_FETCH_FAILED` 单条分支并入同处。
2. **claim 2** ✅ 逐条对照代码：`browser-bridge.ts:987-996` 三令牌 → (码, 措辞) 二元组；`:995` `missing` → `ELEMENT_NOT_FOUND`；`:996` 兜底（令牌不匹配/页面伪造）→ `IMAGE_EXTRACT_FAILED` + 兜底措辞；`:921` → `IMAGE_EXTRACT_FAILED`；`:795` / `:1029` → `SELECTOR_OR_TEXT_REQUIRED`；页面可控文本仍只进 `data.page_text_untrusted`（`:1000`）。
3. **claim 3（端到端）** ✅ 部分：真 bridge 产出 → 真 `classifyError`，**所有可达形态均为 `recoverable`**；我额外把 `IMAGE_TOO_LARGE`（>>6MiB data:）、`INVALID_DATA_URL`（`data:image/png;base64` 无载荷）、`BLOB_URL_UNSUPPORTED` **都跑到真 bridge 出口**并判 recoverable（不止 PR 表里的 5 类）。对照组：4/5 形态修复前 `non_recoverable`（第 5 形态见第一条 NIT）。
4. **claim 4（突变）** ✅ 精确复现：注销 `IMAGE_RENDER_FAILED` → companion **2 红**（`every image-family code …` + `level does not drift …`）；`:921` 退回无码 → extension **1 红**。我另加：把 `missing` 改成 `IMAGE_EXTRACT_FAILED` → extension 1 红（码映射真被钉住）。
5. **claim 5（回归）** ✅ extension `1493/1493 fail 0`；`tsc --noEmit` 通过；`plasmo build` 通过（10.5s）；门禁 `156 passed, 0 failed`；companion 相关失败 0（数字见「未能验证」）。
6. **无限循环问题：不会** ✅ `MAX_SAME_TOOL_RECOVERABLE_FAILURES=3`（`adapter.ts:255`），计数器按 `toolName` 计（`:1286/:2160`），`analyze_image` **不在** `CDP_INTERACTIVE`（`site-op-memory.ts:35-51`）故不触发 locator ban / origin escalate / `SITE_OP_ESCALATED`；`ELEMENT_NOT_FOUND` 因 pivot 清零实际最多 6 次后 `stop` → `circuit_breaker`，其余码 3 次后 `stop`。页面无法把计数清零（清零只在同工具**成功**时，`adapter.ts:1983`）。
7. **`codedToolError` 的 `"CODE: wording"` 形态无下游依赖** ✅ 全仓 grep 旧四字面量：只有 `dist-package/**` 的旧构建产物与 docs；侧栏状态取自 `result.success`（`ChatView.tsx:1380-1395`），`toolResultUserHint`（`:1066+`）按 `error_code`/正则匹配、无 analyze_image 分支；`adapter.ts:2003` 的 `^([A-Z][A-Z0-9_]+):` 前缀解析是**受益方**。UI 无回归。
8. **成功语义未被改变** ✅ 三条路径都是**直接 return**（`executeInner` 的 catch 只包 `throw`），无二次包装；`codedToolError` 恒 `success:false`，`data.error_code` == error 前缀，与 adapter 的 `failCode` 读取（`data.error_code` 优先）一致。
9. **兜底分支不是新可利用面** ✅ 页面本就可用 `render`/`extract`/`missing` 任一**合法**令牌取得同等级、同上限的 recoverable；伪造令牌只多了一种入口，预算同一把计数器管。改动前该形态是 `non_recoverable` → 1 次即终止（实测 `"Image element could not be captured"` → `non_recoverable`）——所以是**净改善**（把「页面按下急停」换成有界的可恢复失败）。
10. **`hostImageFailure()` 不会自相矛盾地通过** ✅ 措辞只能由宿主字面量按令牌选取，码/措辞全 `===` 比较、无插值；页面文本只进 `page_text_untrusted`（测试断言其仍在）。唯一缺口是 NIT 里的 (码,措辞) 配对（M5）。
11. **pivot 注入仍无页面文本** ✅ pivotNotes 由 `toolName` + 宿主常量拼成，无页面串。

（工作树保持干净：`git status` tracked-dirty = 0；突变均已 `git checkout --` 还原；新增文件全在 `/tmp/pi561/`。）

VERDICT: APPROVE_WITH_NITS
PI_EXIT=0
