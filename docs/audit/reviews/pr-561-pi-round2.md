diag: pi=/c/nvm4w/nodejs/pi
## BLOCKING（必须修才能合）

无。四点收口我都独立复现了，核心语义仍正确、有界，无新增可利用面。

---

## NITS（非阻塞，全部有实跑证据）

- **[P3] 跨包守卫有文件盲区 —— 换成第三个模块发码就静默通过。** `companion/tests/classify-error-wait-for-codes.test.ts:199-202` 只硬编码扫两个文件。突变实证：把 `IMAGE_PIXEL_LOST` 放进**新文件** `chrome-extension/src/background/zz-tmp-image-pixel-utils.ts` → 该测试 **11/11 全绿**（=真实漂移不被捕获）；放进被扫的两个文件之一 → **1 红**且正确点名 `unregistered: [ 'IMAGE_PIXEL_LOST' ]`。修法很便宜：我把全树 `chrome-extension/src/**/*.ts` 按同一正则扫了一遍，今天结果**仍是同样的 7 个码、0 误报**（`scratch/pi561-r2/scan-image-codes.mjs`），所以 `file list → glob` 可直接换。commit 里「直接读 extension 源码取码」这句比实现宽。
- **[P3] 同一守卫会对**行为等价**的重构误红。** 把 `security.ts` 的 7 个 `||` 显式分支重构成 `const IMAGE_FAMILY_CODES = [...] ; if (context?.error_code && IMAGE_FAMILY_CODES.includes(context.error_code))`（语义完全相同）：行为测试全绿，**跨包守卫 1 红**（它按 `error_code === "CODE"` 字面 grep）。对照：只加注释/空行的重构 → **11/11 绿**（无误红）。建议守卫同时接受数组/Set 形态，或让 `security.ts` 导出码集合供断言。
- **[P3] `TAB_ID_REQUIRED` 是「靠文案生效」，不是「靠码登记」—— commit 的机制叙述不准确。** 实测（真 `.test-dist/src/security.js`）：`classifyError("TAB_ID_REQUIRED: No active tab found", {error_code:"TAB_ID_REQUIRED"})` = `recoverable`，但 `classifyError("完全中性的文案", {error_code:"TAB_ID_REQUIRED"})` = **`non_recoverable`**。真正救命的是子串表里的 `"tab_id_required"`（`companion/src/security.ts:1096`），不是码分支——正是 #560 要消掉的那种耦合。新增测试 `safe-evaluate-page-text.test.ts:492` 只断言 `data.error_code`，**没有断言 level**，所以钉不住这条性质。修法：把 `TAB_ID_REQUIRED` 并入 `TAB_LOCKED` 那组显式分支 + 一条「中性文案 + 码 → recoverable」的断言。
- **[P3] 形状校验的残留：`"data:,"` 仍会报成功。** `:1023` 只校验「非空字符串」，而退化画布（`naturalWidth`/`width` 均为 0 → canvas 0×0 → `toDataURL()` 返回 `"data:,"`，注入表达式的 `replace(/^data:image\/\w+;base64,/)` 不命中）会得到 `base64:"data:,"` → 真 bridge 实测 `success:true, type:"canvas", image_base64:"data:,"`；adapter 的 `VISION_TOOLS` 只要 truthy 就继续 → 仍是「成功但没有可用的图」，只是从 `undefined` 收窄成了字符串。（`"data:,"` 的产出是规范推断，守卫行为是我用桩实测的。）一行可补：字符串仍以 `data:` 开头 → `IMAGE_EXTRACT_FAILED`。
- **[P3] commit message 的站点清点错了：第二处不在 `analyze_image`。** 两处改动是 `browser-bridge.ts:747`（**`screenshot`**，函数自 `:736`）与 `:808`（`analyzeImage`，自 `:790`）。`git show 2fc77c21^` 确认两条 `explicit tabId required`、两条 `No active tab found` 都在，本提交只给后者加前缀。**副作用未声明**：`screenshot` 的「无活动标签」也从 `non_recoverable`（整轮终止）变成 `recoverable`（我用真 classifyError 对照了两种形态）。属净改善、有界，但不在 #559 声明范围内。
- **[P3] 声明漏了 `SELECTOR_OR_TEXT_REQUIRED` 的同款副作用。** 它也在 `LOCATOR_MISS_CODES`（`same-tool-guard.ts:11`）。实测 `decideSameToolFailure`：修复前无码文案 `"selector is required for analyze_image"` → 第 3 次 `stop`；现在带码 → 第 3 次 **`pivot`**（注入 `LOCATOR_PIVOT_INSTRUCTION` 的「不要再点击…」文案），计数清零 → **预算 3→6**。与已声明的 `ELEMENT_NOT_FOUND` 完全同构，但声明只写了后者。仍有界（6 次后 `stop`，非 `security_halt`）。
- **[P3] M5 的配对表有两格永远走不到。** `safe-evaluate-page-text.test.ts` 的 `HOST_IMAGE_PAIRS` 加了 `SELECTOR_OR_TEXT_REQUIRED` 的两条措辞，但 `HOST_IMAGE_ERROR_LITERALS`（`:68-74`）**仍不含**这两条 → 我按同逻辑镜像验证：`"SELECTOR_OR_TEXT_REQUIRED: selector is required for analyze_image"` 会在 `措辞必须属于宿主字面量集合` 处失败，即 `hostImageFailure()` 对这两条路径仍不可用（两个测试只查 code）。上一轮「那两条新 coded 路径无法被该助手校验」只关了一半。

---

## 逐条回答你的聚焦项

1. **成功形状校验没改坏正常路径 —— 四条全部仍成功（真 bridge）**：同源 canvas `{base64:"AAAA"}` → `success:true/canvas`；`data:image/png;base64,…` → `success:true/canvas`（base64 解码自 payload）；跨域 taint / `https:` → `success:true/fetch_required`；`http://` → 同。另测：有真实活动标签时的 `tabId` 回落仍 `success:true`。唯一新拒的是 `base64:""`（退化为「没有图」）——正是目的。
2. **多智能体分支未受影响**：`browser-bridge.ts:741` / `:805` 的 `__require_tab_id` 抛出**与前两个提交逐字节相同**（`git show 2fc77c21^` / `2fc77c21` / HEAD 对照），实跑两种 flag 都得 `{"error":"TAB_ID_REQUIRED: explicit tabId required (multi-agent mode)","data":{"error_code":"TAB_ID_REQUIRED"}}`。附带验证：adapter 的 tabId 幻觉自动恢复（`adapter.ts:2066-2070` 匹配 `"No active tab found"`）**仍然命中**，因为前缀保留了该子串。
3. **M5 现在确实变红（独立复现）**：把 `IMAGE_RENDER_FAILED` 的措辞换成另一条宿主字面量 → extension **1 红**（`#559 渲染失败 → IMAGE_RENDER_FAILED`，失败点正是新加的配对断言；措辞仍在 `HOST_IMAGE_ERROR_LITERALS` 里，所以只有配对检查能抓到）。
4. **跨包守卫真的会咬**：(a) 注销 `IMAGE_RENDER_FAILED` → companion **3 红**，含 `#559 cross-package…`；(b) 在被扫文件里新发一个码 → 守卫红并点名；(c) 注释/换行重构 → 11/11 绿（不误红）；(d) 见 NIT：数组式重构会误红、第三模块发码会漏。也做了「去掉成功形状校验」突变 → 1 红（新测试咬得住）。
5. **没有新引入的缺陷；你描述的放置位置是反的。** 实际顺序是 `:921` 取值 → `:922` `!data` → `:933` `fetchSrc` → `:980` `fail` → **`:1023` 形状校验** → `:1029` Path A。校验在 `fetchSrc` 之**后**；若真放在 `fetchSrc` 之前（如你所述），`fetch_required` 与 `data:` 解码这两条合法成功会被整批误杀——现在的位置恰好是唯一安全的位置。逐形态核过：`{}`/`5`/`"str"`/`[]`/`{foo:1}`/`{base64:undefined}`/Proxy 空对象 → 全部 `IMAGE_EXTRACT_FAILED`（真 bridge）；`{fetchSrc:...}` 与 `{fail:...}` 在到达校验前已各自返回，无「无 base64 但有效」的合法返回被误判。
6. **回归**：extension **1496/1496 fail 0**；companion 全量 **4643+675 例、62 个唯一失败名、相关 0**（全是 0o600/symlink/macOS/lock/fixture 族；没有任何 image/classify/security/adapter 文件的名）；门禁 **156 passed / 0 failed**；`chrome-extension` 与 `companion` 的 `tsc --noEmit` 均 0 错；`git status` tracked-dirty = 0（所有突变已 `git checkout --` 还原，临时文件已删；我的脚本与日志只落在既有 scratch 区 `scratch/pi561-r2/`）。

## 未能验证

- **GitHub PR body 的实际文本**（本机无网/无 `gh`）。但更正后的**算式**我独立重算 = **5/6**（`!data` / `render` / `extract` / 兜底 / 缺 selector 为「真改变」；`missing` 修复前即 `recoverable`），并与仓库历史材料 `docs/audit/reviews/pr-557-pi-round3.md:17` 的 A3 行一致。
- **`plasmo build`** 本轮未重跑（两个包的 `tsc --noEmit` 均通过）。
- **`"data:,"` 在真页面上确实会被产出**（无真 headless Chrome），仅规范推断 + 桩实测守卫行为。
- companion 失败数在 62（我）／68（上轮）／70（claim）之间抖动，属环境时序；我只证「**相关 0**」，不证具体数字。

## 已核实为正确的声明

`codedToolError` 两条的新 `suggested_action` 无消费方白名单（`suggested_action` 只在 `adapter.ts:2189` 被写、在 `:2150` 透传 + `tool-persistence-redact.ts:365` 保留，取值任意字符串）；形状校验入口的 `!data`、`fetchSrc`、`fail` 三条 return 语义未被改动；`IMAGE_*` 7 码在 `security.ts:944-955` 仍是显式 `error_code` 分支（非子串表）；新增的 `TAB_ID_REQUIRED` 前缀不影响 `executeInner` 的 `^([A-Z][A-Z0-9_]+):` 解析（`:224-227`）。

VERDICT: APPROVE_WITH_NITS
PI2_EXIT=0
