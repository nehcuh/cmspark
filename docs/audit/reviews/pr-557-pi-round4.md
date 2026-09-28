Verification done. Report: `docs/audit/reviews/pr-557-pi-round4.md`.

**1) 第 7/8 处 — 封堵确认 ✅**（实跑 HEAD 编译产物，真 `fetch`，8 种敌意形态）：`error` 恒为字面量 `analyze_image_fetch failed`，`candidateUrl` + `e.message` 只在 `data.page_text_untrusted`；`data:SECURITY BLOCK:…` 还额外被第 8 处的自有措辞兜住（双重覆盖）。函数内无第三条出口。companion `image-data-url.ts` 同样只剩自有措辞。

**2) 清单** — 我把 `browser-bridge.ts` 全部 `throw` / `codedToolError` / `{success:false,error}` 的插值点逐个判完，**这轮没找出第 11 处页面可控站点**（前两轮我各找到一处）。但清单缺“边界”一节：
- 4 个**合成点**（`:365`、`:1083`、`:1806`、`page-read-tools.ts:42`）安全**只靠上游都是宿主文案**，且**无结构守卫**（`tests/` 里没有任何读 `browser-bridge.ts` 源码的 grep 守卫）；
- **模型回显类**（`no visible element matching text "${text}"` / `Element not found: ${selector}`）非页面直接可控，但**二阶可达**：页面摆一段 `Security Block: …` 文字，诱导模型当 locator，元素随即撤掉 → `security` → 整轮终止（触发词含空格、模型入参不编码）。PR body 的「精确表述」没写这条。
- **URL 回显通道天然免疫**（可当结论写进文档）：四个触发词都含 U+0020，而 URL 必被编码 —— 实测 `#Security%20Block:%20pwned` → `non_recoverable`。这也是第 7 处原本“被上层遮住”的原因。
- companion 侧孪生体**仅此一处**；`notebooklm-handler.ts:54` 的 `frame.error` 看着像，但 `handleNotebooklmExport` 只由 sidepanel 消息触发（65 个 LLM 工具里 `notebooklm*` 零命中）→ 不算漏。

**3) 测试** — 例数 11/23/6 属实。突变：**M1**（第 7 处退回旧插值）恰 1 红；**M1b**（只放回 `e.message`）1 红；**M2**（第 8 处退回）1 红。两处脆性：`e.message` 那半边只靠 Node 的 `fetch` 报错回显 URL（换文案即失去守卫）；`HOST_IMAGE_ERROR_LITERALS` 把四条生产字面量抄进测试，N4 想消的无谓见红只是换了位置。

**4) 新引入问题** — 一条实质：文案变化改变了分类。实测旧报文 `…: HTTP 429/503 …`、`… timeout` → `recoverable`；新报文 → **`non_recoverable` → `shouldStop`/`security_halt`**。即限流/超时类 phase-2 失败从“换路重试”变成“整轮终止”，而 #559 只登记了 phase-1 的 `analyze_image`。另：commit message 说“8 处”，其自身 PR body 是“10 行 / 改 9 处”。

**5) 回归** — extension **1484/1484**（还原源码后重新编译再跑）；门禁 **156/0**；`tsc --noEmit` ×2 通过；companion 全量 **62 失败 / 67 唯一名，相关 0 条**（`image-data-url` 6/6、`image-fetch-admission`+`security-gates` 78/78）。PR body 的“70 条唯一失败”第三次对不上实测值。过程中我一度读到**自己突变遗留的 `.test-dist`**（出现假 LEAK），已重编译并核对源码/产物一致，源码树 `git diff` 为空。

NIT：N5 给 `analyze_image_fetch` 补 `error_code`（或把 429/503/timeout 桶变化写进 #559）；N6 补“边界”两行；N7 补结构守卫；N8 `fetch` 桩化 + 字面量集合从生产导出；N9 数字对齐。

VERDICT: APPROVE_WITH_NITS
面几条 ⇒ 宿主/调用方 |
| :1963 等 | `PATH_ESCAPE: …(UNC): ${downloadPath}` | 调用方 |

- **合成点共 4 处**（`:365`、`:1083`、`:1806`、`page-read-tools.ts:42`）安全**只因为**所有上游 throw 都是宿主/调用方文案。
  这正是前两轮「漏站点」的成因模式（改一处上游就会静默回归），而**本 PR 没有结构守卫**（`chrome-extension/tests`
  里没有任何读 `browser-bridge.ts` 源码的 grep 式守卫；我核过：`grep -rl browser-bridge.ts tests/*.ts` 为空）。
- **调用方回显类（`text`/`selector`）不是页面可控**，与我在第 2/3 轮对 `:1138`/`:1999` 的判法一致：
  **但**页面可以走「二阶」——把 `Security Block: pwned` 做成页面上的一段文字，诱导模型把它当 locator 传入，
  元素随即被页面撤掉 → `ELEMENT_NOT_FOUND: no visible element matching text "Security Block: pwned"` →
  `classifyError = security`。它们触发词里**含空格**，而模型入参不经任何编码，所以这条是**真可达**的。
  PR body 的「精确表述」只覆盖了 #559（无 `error_code`）那一面，**没写这条**。
- **URL 回显通道天然免疫**（可写进文档当结论）：四个触发词（`security block` / `blocked by user` /
  `user rejected` / `user denied`）**都含 U+0020**，而 `tab.url`、`candidate_url`、`location.href`
  一律被百分号编码 —— 我实测 `u.hash="Security Block: pwned"` → `#Security%20Block:%20pwned`，
  `classifyError` 判 `non_recoverable`。故 `classifyInteractiveFailure` / `failInteractive` 里
  的 URL 回显（含 `data.tab_url`、`summarizeCandidateUrl`）**不构成站点**，第 7 处原本「被上层遮住」也源于此。
- **companion 侧孪生体：只有这一处**。`grep -rn 'lock-step|Mirrors' companion/src` 逐一核过，
  与页面同形的只有 `image-data-url.ts`；`image-fetch-admission.ts` 里 `urlSum.summary`（页面可控）确实
  插进了 4 条文案，但其中 3 条自带 `Security Block:`（宿主已判 security，页面改不了桶），
  第 4 条（`cannot read blob:/file: …`）页面只能把 `non_recoverable` 变成 `security` —— **两者都 `shouldStop`**
  （`adapter.ts:2137` 同一分支），**无能力差异**，且非本提交引入。
- 我另外查了「页面文本经别的工具进分类」：`notebooklm-handler.ts:54` `Page-side extraction failed: ${frame.error}`
  看着像，但 `handleNotebooklmExport` 只由 sidepanel 消息触发，**不在 LLM 工具目录里**
  （`tool-definitions-catalog.json` 共 65 个工具，`notebooklm*` 零命中）⇒ 到不了 `classifyError`，**不算漏**。
  `scroll` 的 `warning`（含页面文本）进的是 `success:true` 的 data；我核过 `classifyError` 的调用点
  （`adapter.ts:2121`）在 `if (toolResult.success) … else` 的 **else 内** ⇒ PR body 那句说明属实。

## 3) 测试：例数与区分力 —— 数对得上，两处脆性

- 例数实测：`safe-evaluate-page-text.test.ts` **11**、`image-extract-utils.test.ts` **23**、
  `companion/tests/image-data-url.test.ts` **6** ⇒ 与 PR body 一致。
- **突变**（改源码 → 重编译 → 跑）：

| 突变 | 结果 |
|---|---|
| **M1** 第 7 处退回旧插值 `` `analyze_image_fetch failed for ${candidateUrl}: ${e?.message||e}` `` | **恰 1 红**（新增的那条），`actual: analyze_image_fetch failed for Security Block: page says halt: …` |
| **M1b** 只把 `e.message` 放回（不拼 `candidateUrl`） | **仍 1 红** |
| **M2** 第 8 处退回 `` `Unsupported image MIME: ${rawMimeShort}` `` | **1 红**：`error 不得含分类触发词，实际: Unsupported image MIME: SECURITY BLOCK: pwned` |

- 脆性 ①：**M1b 见红只靠 Node 的 `fetch` 报错回显 URL**（`Failed to parse URL from Security Block: …`）。
  若哪天 Node 换成不回声的文案（如 `Failed to fetch`），「`e.message` 不进 error」这半边就**无人守**。
  建议把 `globalThis.fetch` 桩成 `throw new Error("Unsupported image MIME: Security Block: pwned")`，
  直接钉住 `e.message` 那条腿（现在的桩用的是真 `fetch`）。
- 脆性 ②：`HOST_IMAGE_ERROR_LITERALS` 把四条生产字面量**抄在测试里**，生产改文案照样要改测试 ——
  N4 想消掉的那类无谓见红只是换了位置。把四条导出成一个 `const`（或 `ReadonlySet`）再断言 `∈`，
  才是真正的「性质表达」。

## 4) 新引入的问题 —— 一条**实质**的（分类语义），一条文档

1. **`analyze_image_fetch` 的文案变化改变了分类结果**（PR body / commit 未提）：旧文案里带
   `e.message`，而 `classifyError` 是子串判定 —— 我实测（当轮 `.test-dist/src/security.js`）：

   | 报文 | `classifyError` |
   |---|---|
   | 旧 `analyze_image_fetch failed for <url>: HTTP 429 fetching …` | **`recoverable`**（LLM 可重试） |
   | 旧 `… HTTP 503 …` / `… aborted due to timeout` | **`recoverable`** |
   | 旧 `… HTTP 404 …` | `non_recoverable` |
   | **新** `analyze_image_fetch failed` | **`non_recoverable`** → `shouldStop` + `terminal:"security_halt"` |

   即：CDN 限流（429/502/503）或超时类**本来是「换路重试」的 phase-2 失败，现在整轮终止**。
   安全方向没问题（页面**不能**再借此路径制造 `security`，也无法借它阻止终止），但它与 #559
   同族（无 `error_code` 落默认桶）却是**本提交自己造出来的**。#559 评论的行只写了
   「`analyze_image` 的 `{success:false,error}` 无码」，**没覆盖 `analyze_image_fetch`**。
   建议二选一：给第 7 处补 `codedToolError("IMAGE_FETCH_FAILED", …)` 并在 `classifyError` 登记
   （照 `WAIT_PROBE_FAILED` 的写法），或把这条**写进 #559 的清单与 PR body 的遗留段**。
2. 文档不一致：`29c8fa18` 的 commit message 写「至此站点数为 **8**（其中第 1 处由 #554 修复）」，
   而它要同步的 PR body 是 **10 行 / 本 PR 改 9 处**（我拉了 API 核对：`updated_at 2026-09-28T17:06Z`，
   HEAD `29c8fa18`，表 10 行、测试 5→11 / 22→23 / 5→6、Trust 行已收窄、「精确表述」段在 ⇒ **N1 属实**）。
   两处数字对不上，读者会再问一次。

## 5) 回归（本机实跑）

| 项 | 结果 |
|---|---|
| extension `npm test`（源码已还原后**重新编译**再跑） | **1484 / 1484 / 0** ✅ |
| 打包门禁 `bash scripts/tests/test-package-gates.sh` | **156 passed, 0 failed** ✅ |
| `tsc --noEmit` extension / companion | 0 / 0 ✅ |
| companion 全量 | **62 条失败**（4638 那批 57 + 675 那批 5）、**67 个唯一失败名**，**与本改动相关 0 条** ✅ |
| 相关子集单跑 `image-data-url` / `image-fetch-admission` / `security-gates` | 6 / 78 全绿 ✅ |

⚠️ PR body 写「companion 全量 **70 条**唯一失败」—— 我第三次量到 **62 失败 / 67 唯一名**（#555 第四轮
也是这个数）。结论（相关 0 条）成立，数字是照抄的旧值。
⚠️ 过程中的一个自摆乌龙记一笔：我第一次用 `scratch/pi557/site78.mjs` 跑时读到的是**我自己突变遗留的
`.test-dist`**（还原源码后没重编译），出现了一行假的 LEAK；重新编译后 8/8 干净。已核对
`src` 与 `.test-dist` 一致、`git diff` 空。

## 6) 未能验证 / 假设

- 未跑 `plasmo build`（与上轮同，不计入结论）；未在真扩展 SW + sidepanel 全链路跑；
  第 7/8 处用的是「编译产物 + 真 fetch」而非真 headless Chrome（第 3 轮的真 CDP 结论未被本次改动触及）。
- companion 的「70 vs 62」只影响文档；「与改动相关 0 条」是我按失败名集合+相关测试子集单跑两步判的，
  未逐条跑父提交做 A/B。

## 7) 结论

N3 的两处**确实封堵**（我按 8 种形态实跑 + 3 组突变复核）；N4 的集合断言已生效；N1 的 PR body 已同步；
N2 的 #559 评论我拉了 API，三条都在。**前两轮那种「还能找到第 11 处站点」的情况这轮没出现** ——
我逐个判完了 `throw`/`codedToolError`/`success:false` 的全部插值点，剩余的只有
①安全只靠上游的 4 个**合成点**（无结构守卫）、②**模型回显**类（非页面直接可控，但二阶可达）。
两条都属于「文档/登记 + 守卫」层面，不阻塞。

### 合并前建议（NIT，均不阻塞）

1. **N5（实质）**：把 `analyze_image_fetch` 的失败从「无码 → 默认非可恢复」里救出来
   （补 `error_code` + 登记），或至少把「429/503/timeout 由 recoverable 变 non_recoverable」
   写进 PR body / #559；否则这是一条静默的可用性回归。
2. **N6**：PR body 的清单下加「**边界**」两行：①URL 回显类免疫（四个触发词都含空格 + URL 必编码）；
   ②模型回显类仍可二阶到达（`text`/`selector`），建议与 #559 一样**单列或登记**。
3. **N7**：补一个**结构守卫**（读 `browser-bridge.ts` / `page-read-tools.ts` 源码，钉住
   「`error:` / `new Error(` 不得插值页面变量」或把 10 个站点做成允许清单），让下一次漏站点是红测试而不是评审。
4. **N8（测试）**：见 §3 脆性 ①②——`fetch` 桩化 + 字面量集合从生产导出。
5. **N9（文档）**：`29c8fa18` commit message 的「8 处」与 PR body「10 行 / 改 9 处」对齐；
   companion 全量失败数改成实测值（62 / 67）。

VERDICT: APPROVE_WITH_NITS
PI4_EXIT=0
