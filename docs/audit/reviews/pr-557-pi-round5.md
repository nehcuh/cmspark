第五轮已收口复核完毕，报告写入 `docs/audit/reviews/pr-557-pi-round5.md`（只读评审，源码树 `git diff` 为空）。

## 1) N5 — 真修回了，且判定与文案解耦 ✅
用**当轮编译产物**串起「真 bridge + 真 `classifyError`」，`globalThis.fetch` 桩 6 种形态：

| fetch 失败 | `error` | `data.error_code` | level |
|---|---|---|---|
| HTTP 429 / 503 / 404 | `IMAGE_FETCH_FAILED: analyze_image_fetch failed`（六种形态**逐字节相同**） | `IMAGE_FETCH_FAILED` | **recoverable** |
| `net::ERR_TIMED_OUT … timeout` | 同上 | 同上 | **recoverable** |
| 中性文案 | 同上 | 同上 | **recoverable** |
| 页面原文 `Security Block: …` | 同上 | 同上 | **recoverable** |

页面可控文本只在 `data.page_text_untrusted`（300 字符截断）→ **没有回到 message**。基线复核：旧 `… 429/503/timeout` → recoverable，改文案后无码 → `non_recoverable`（回归属实），现在中性文案也 recoverable。
突变：**M1** 编译产物退回无码报文 → 恰 1 红；**M2** 删 companion 分支 → 恰 1 红；还原均绿。
**顺带核过同族残留（新增检查，无同类回归）**：`EVAL_THROWN` 仍 recoverable（`"eval_thrown"` 本就在子串表 + code 前缀）；`safeEvaluate`/`probe` 桩页面异常 × 多文案 × 多工具，`error`/`code`/`level` 与页面文案**无关**且恒 recoverable。

## 2) N7 绊线 — 有效，但是**变更探测器，不是性质证明**
独立实测：+1 处 `?.text` → 红（8≠7）；+1 处 `?.exception?.description` → 红；还原 → 绿。
**换行不误伤**（`exception?\.description` 仍命中）；但**加注释会误伤**（只加一行含 pattern 的注释 → 红），**异形读取会漏**（`details.exception.text` → 绿）。不够脆到该拆 —— 建议计数前剥注释（2 行），并别当性质证明。另：绊线注释把 `:1347`/`:1821` 的归属写反了（实际 `:1347` 是 scroll SPA，`:1821` 是 `EVAL_THROWN`）；站点集合 4 个/7 处没错，scroll 那条确实进 `success:true` 的 `data.warning`。

## 3) 是否过宽 — **可接受**，但确实比旧行为宽
① 404/410 这类确定性失败从"立即终止"变为"最多 3 次后终止"；② 代价有界：`MAX_SAME_TOOL_RECOVERABLE_FAILURES=3` → `circuit_breaker`，`loop-kernel.ts:341` 对它也**不 auto-continue**（无人值守不会自转）；③ 面很窄：`analyze_image_fetch` 是内部工具（admission 拒直接调用），`data:`/`blob:`/非法 scheme 在 companion 侧已被拒，到达 catch 的基本只有 http(s)。安全上只失去"用文案换桶"的能力，不涉及权限。想更精确可将来拆 transient/permanent 两码。

## 4) 回归（实测）
extension **1486/1486**；companion 相关 7 批 **373 例 / 0 失败**（含 security-gates、classify-error×2、image-fetch-admission、same-tool-guard、loop-kernel 等）；门禁 **156/0**；两侧 `tsc --noEmit` 通过。PR body（API 核 `83536633`、17:20Z）例数 13/23/6/7 与「10 行/改 9 处」一致。**唯一文档 NIT**：PR body 未写 phase-2 已按码放行，读者会把"analyze_image 失败会终止"读成整条链的结论。

无阻塞项；剩余全是 NIT（绊线剥注释、绊线注释两行归属、PR body 区分 phase-1/2、`safeEvaluate` 的 recoverable 目前"靠 fallback 文案"）。

VERDICT: APPROVE_WITH_NITS
4 的 `WAIT_PROBE_FAILED` / `WAIT_TIMEOUT` 码 |

> 观察（不算缺陷）：`safeEvaluate` 的 `recoverable` 现在是**靠合成报文里的 fallback 文案**侥幸拿到的，
> 与 N5 原来「靠 429 子串」同形。它不可被页面文案左右（那半截是宿主文案），所以性质成立；
> 但下次谁改那句合成文案，就会重演一次静默换桶。若顺手，给它一个码（如 `PAGE_EXCEPTION`）更稳。

## 2) N7 绊线：有效，但**是变更探测器，不是性质证明**

**独立验证（改源码 → 不重编译，测试运行时读 `.ts`，事后 `git diff` 为空）**：

| 突变 | 结果 |
|---|---|
| **A** 新增一处 `(c as any)?.exceptionDetails?.text` | **红**：`8 ≠ 7`（失败信息给出常量与处理指引） |
| **A2** 新增一处 `…exceptionDetails?.exception?.description` | **红**：`8 ≠ 7` |
| 还原 | **绿**（13/0） |
| **C** 在既有链里换行（`cdp.exceptionDetails?\n.exception?.description`） | **绿** —— 第三个替换式 `exception?\.description` 仍命中，故换行不误伤（实测） |
| **D** 只加一行**注释** `// note: exceptionDetails?.text is page-controlled` | **红**（`8 ≠ 7`） |
| **E** 新增一处**非可选链**写法 `details.exception.text` | **绿**（漏检） |

⇒ 「加一处读取 → 红、还原 → 绿」**属实**；换行不误伤**属实**；但**注释会误伤**、
**换写法的读取会漏**。两者都实测。
判定：**不够脆到该拆**（见红方向是"多报警"，失败信息可操作，且它不是安全控制），
但要如实登记它是 **count-based 变更探测**：
- 便宜的修法：计数前先剥注释（`src.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*\/\/.*$/gm,"")`）→ 消掉 D 类误伤；
- 想少漏：把 pattern 放宽到 `exception(?:Details)?\??\.(?:exception\??\.)?(?:description|text)`
  （注意放宽会改变期望值，须重测一次再写常量）；
- **C 类重构（把四处读取抽成一个 helper `pageExText(d)`）会掉计数 → 红**：这不是错，只要同步常量即可，
  但请把它当"有人动了这块，去看一眼"，不要读成"性质被破坏"。

（小瑕疵：绊线注释把 `:1347` 归给 `evaluate(EVAL_THROWN)`、`:1821` 归给 `scroll` SPA —— 实际**互换了**
（`:1347` 是 scroll SPA 的 `errors.push`，`:1821` 是 `evaluate` 的 `EVAL_THROWN`）。站点**集合** 4 个、7 处读取没错，
我另核了 scroll 那条确实进 `success:true` 的 `data.warning`（`:1553` / `:1563`），不经 `classifyError` ⇒ 说明本身成立。

## 3) 新引入的问题：`IMAGE_FETCH_FAILED` 登记为 recoverable —— **可接受，但比旧行为宽**

三点事实（都实测/读码确认）：

1. **旧集合 ⊂ 新集合**：旧行为把 `429/502/503/timeout/network error/…` 判 recoverable，其余（如 404）判
   `non_recoverable`；新码把**全部** phase-2 失败统一 recoverable。故 404/410 这类**确定性**失败
   从"立刻终止"变成"最多重试 3 次再终止"。
2. **代价有界**：`MAX_SAME_TOOL_RECOVERABLE_FAILURES = 3` → 第 3 次走 `decideSameToolFailure` 的
   `stop` 分支（`adapter.ts:2201`）→ `shouldStop` + `terminal:"circuit_breaker"`；`loop-kernel.ts:341`
   对 `circuit_breaker` **同样不自动续跑**（paused，非 stopped）。即在无人值守下**不会**变成自转。
   （相对旧路径的差别只是 terminal 标签 `circuit_breaker` vs `security_halt`，二者都不 auto-continue。）
3. **面很窄**：`analyze_image_fetch` 是内部工具，companion `image-fetch-admission.ts:99` 直接拒直接调用；
   `data:`/`blob:`/非法 scheme 在 companion 侧**已被拒**（`:141` 起 `decodeDataUrlImage` 本地解码、
   `schemeOk = isHttp || (isFile && cruise)`）⇒ 到达 bridge catch 的基本只有 **http(s) 失败**（巡航下还有 `file:`）。

**安全方向**：`security_halt` 只是标签/自动续跑权，不是权限；页面**失去**了"用文案换桶"的能力，
新增的只是"确定性失败多试 2 次"。**没有**扩大权限面，也没制造无限循环。
判断：**不过宽到需要拦下**，但如果要更精确，将来可拆
`IMAGE_FETCH_TRANSIENT`（429/5xx/timeout/网络）→ recoverable 与
`IMAGE_FETCH_PERMANENT`（4xx、decode/MIME）→ 保持 non_recoverable；现在文档里如实登记"宽在哪里"即可。

## 4) 回归 / 文档数字

| 项 | 实测 |
|---|---|
| extension 全量 | **1486 / 1486**（`ℹ fail 0`） |
| extension `tsc --noEmit` | 通过 |
| companion `tsc --noEmit -p tsconfig.json` | 通过 |
| companion 相关测试（7 批 373 例：classify-error×2 / image-data-url / image-fetch-admission / same-tool-guard / security-gates+adapter×3+security-thread / adapter-content-risk、peek-breaker、board、history、loop-kernel、loop-unattended、m10、web-act-wave1、single/files） | **373 pass / 0 fail** |
| 门禁 `test-package-gates.sh` | **156 passed, 0 failed** |
| 例数核对（拉 API 读 PR body，`updated_at 2026-09-28T17:20Z`，head = `83536633`） | 13 / 23 / 6 / 7 与实际一致；「10 行清单 / 第 1 行由 #554 修 / 本 PR 改 9 处」一致；N6 两行在；1486/156 一致 |

**文档 NIT（唯一还值得改的文档项）**：PR body 的「端到端」表与 `#559` 段仍只把 phase-1 `analyze_image`
写成"无 `error_code` → `non_recoverable` → 仍整轮终止"，**没写这次新登记的 phase-2 `IMAGE_FETCH_FAILED` → recoverable**。
读者会把"analyze_image 失败会终止"当成整条链的结论 —— 加一行区分"phase-1 仍终止（#559）/ phase-2 已按码放行（本提交）"即可。
（#559 未关的结论本身仍然成立，我核过 phase-1 三处仍未带码。）

---

## 结论

- Q1 N5：**修回**，六种文案形态恒 recoverable、error 恒同一字符串、页面文本只进 data；M1/M2 各恰 1 红。
- Q2 N7：**有效且不误伤换行**；但注释会误伤、异形读取会漏 —— 建议剥注释，别当性质证明。
- Q3 过宽：**可接受**（有界 3 次 → circuit_breaker 不 auto-continue；面只到 http(s)），建议文档登记"宽在哪"。
- Q4 回归：1486/1486、companion 相关 0、门禁 156/0、双侧 tsc 0。
- 无阻塞项；剩余全是 NIT（绊线剥注释、绊线注释里两行归属写反、PR body 补 phase-1/phase-2 区分、
  `safeEvaluate` 的 recoverable 是"靠 fallback 文案"——将来可补码）。

VERDICT: APPROVE_WITH_NITS
PI5_EXIT=0
