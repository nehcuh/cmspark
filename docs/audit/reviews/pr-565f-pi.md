diag: pi=/c/nvm4w/nodejs/pi
## 验证方法（先说我做了什么，便于你核）

- AST 扫描 `companion/src` + `chrome-extension/src`（620 文件），抽出 **585 个 (码, 报文) 产出点**；污染解析覆盖：直接插值、**对象属性**（`.error/.message/.reason/.detail/.stderr/lastSpawnDiag`）、局部变量、**函数参数**、catch 变量、**函数返回值**、调用实参、**数组 `.join`**、`String()`、`new XError(code,msg)`，以及最关键的 **`error:` 与 `data:{error_code}` 的兄弟关系**（这一条才抓得到 `SPAWN_INTENT_FAILED`/`SETTINGS_REQUIRED`/`ORCHESTRATOR_GATE_ERROR` 那种形态）。
- base = `main` 的 `security.ts`（md5 `0b575015…` = `10115dc6` 的），head = 本版；两者 `classifyError` 函数体 `diff` **逐字节相同** ⇒ 未登记码行为 = base 可证。
- 实跑：`npm run build` ✓、`tsc -p tsconfig.test.json` + 目标用例 **12/12** ✓、门禁 **156/0** ✓、extension **1498/1498** ✓、**14 处突变**（逐轮重编译）、companion 全量（62 个失败，逐条看均与本 PR 无关，见「未能验证」）。

## BLOCKING

**无。** 我两轮独立扫描（第二轮的扫描面比作者更宽：多覆盖「函数返回值」「`data:{error_code}` 的外层兄弟 `error`」「参数字段」）都**没有**再找到第 8 个「报文拼装且落在桶里」的码，也**没有**复现出静态收紧：

- 那 **7 个**码确认已整类移出：`SPAWN_INTENT_FAILED` / `SPAWN_BRIEF_FAILED` / `SPAWN_PACK_FAILED` / `SETTINGS_REQUIRED` / `ORCHESTRATOR_GATE_ERROR` / `OUTBOUND_CONFIRM_REQUIRED` / `EMERGENCY_STOP_UNAVAILABLE` —— 在 base 与 head 的 `ERROR_CODE_LEVELS` 里**都不存在**（脚本核：`excluded 7 still in registry? []`）。它们只能靠注释出现（`security.ts:948-950`）⇒ 行为与 main 完全相同。
- **报文可能继承另一个错误值的、且仍被登记的码共 8 个**：`ELEMENT_NOT_FOUND`（`browser-bridge.ts:603/1201/1714/1756`、`browser-download-handler.ts:236`）、`ELEMENT_AMBIGUOUS`、`TYPE_UNSUPPORTED_EDITOR`、`WAIT_CONDITION_REQUIRED`（`browser-bridge.ts:1766` `mode.error`）、`WAIT_PROBE_FAILED`、`PATH_ESCAPE`（`path-sandbox.ts:179` `msg`）、`L2_ADMISSION_TIMEOUT`（`tool/l2-admission.ts:1175` `admit.error`）、`SUMMONER_ACL`（`ws/summoner-acl.ts:104` `error.message`）—— **它们在 head 里全部是 `recoverable`**，钉成 recoverable 不可能产出收紧（只会放宽）；且其中 6 个 base 本就是 recoverable / 本就在 base 表里。
- **收紧 0 独立复算成立（限定口径：静态可确定报文）**：registered 码的 **158 个字面量报文站点**逐点算 base vs head，`recoverable → non_recoverable` = **0**（base = `main`）。放宽只落在已声明集合（`CLAIM_FAILED` / `BOARD_HOST_INVALID` / `SUMMONER_ACL` / `SUMMONER_L0`）上；`PROPOSE_REQUIRED` 确实中性 —— 我把它的**全部**产出点核了一遍（`adapter.ts:236`、`adapter.ts:1750`、`tool/companion-dispatch.ts:2226` 经 `decideRunProgress` 的 `error_code`），全部写 `data.error_code`，而 `adapter.ts:1991-1994` 的守卫正好匹配该字段（AST 实测：`if (!proposeDenied)` 在 **1994**，then 分支 **1994–2234 且无 else**，含 `classifyError`(2121)）⇒ 到不了分类器。
- 另外我核过：**没有**新增「head=recoverable 而 base=security」的降级路径（`security` 与 `non_recoverable` 在 `adapter.ts:2136` 同判 halt，差异仅在文案；而新登记为 recoverable 的码，其真实报文 base 都已 recoverable）。

## NITS

1. `companion/src/security.ts:947` — **本版新引入的计数错误**：写「本批因此排除了 **6** 个：」，下面列了 **7** 个（`:948-950`，含新加的 `EMERGENCY_STOP_UNAVAILABLE`）。修 6→7 时忘了改数字。
2. `companion/src/security.ts:941` — 「**两个**先天限制」下面列了 **3** 条，且第 2、3 条都编号 **②**（`:942`/`:946`/`:951`）。上轮 NIT，未修。
3. `companion/src/security.ts:1110` — 行号 off-by-one：AST 实测 `shouldStop` 在 **`adapter.ts:2137`**、`terminal="security_halt"` 在 **`:2138`**（注释写 2136/2137）；本版把这组数字**同时复制进了用例**（`tests/classify-by-code.test.ts:114`），于是错了两处。
4. `companion/src/security.ts:1079` — 「唯一带报文的产出点（`companion-http.ts:601`）」：报文在 **`:600`**（`:601` 是 `error_code`）。「唯一」成立（`:703/:718` 只有码无报文）。
5. `companion/tests/classify-by-code.test.ts:281-283` — 与源码**同段理由的副本不同步**：用例仍写 `browser-bridge.ts:600` + `:1214/:1660/:1735/:1738`，源码（`security.ts:1046-1049`）已改成 `:572`（调用点 `:512`）。我逐条核过源码那版（`:572` = `const selector = plan.selector` ✓、`:603` = `failInteractive(…,"ELEMENT_NOT_FOUND")` ✓），是用例那版陈旧。上轮 NIT，未修。
6. `companion/tests/classify-by-code.test.ts:201` — anti-vacuity 下界本版从 **`>= 60` 降到 `>= 50`**（为容纳删掉 `EMERGENCY_STOP_UNAVAILABLE` 后的 59）。后果：默认桶**静默删 1~9 个码都是 0 红**。实测：删 `"THREAD_REQUIRED"` → **0 红**；删 9 个（`ACK_*`/`BOARD_CAP_*`/`BOARD_COMPLETE_*`）→ **0 红**；整体删空 → 1 红。所以 commit message 的「突变…**删默认桶码 → 1 红**」**不可复现**（只在整批删除时成立）——属 over-claim，建议改成「整批删除 → 1 红」或把下界钉成等值。
7. `companion/tests/classify-by-code.test.ts:216` — 守卫去掉了 `", "` 依赖（上轮 NIT 已修 ✓），但仍是**逐行文本**匹配：`["X","recoverable"]` 变体已能抓（1 红 ✓），而**追加到已有行尾**（`["PATH_ESCAPE", "recoverable"], ["THREAD_REQUIRED", "recoverable"],`）与**多行拆写**仍 **0 红**（实测）。运行时影响 0（末尾 spread 覆盖），属卫生缺口。
8. `companion/tests/classify-by-code.test.ts:216` — `readFileSync("src/security.ts")` 是 **CWD 相对**路径。从仓库根跑同一编译产物 → `ENOENT … cmspark\src\security.ts`（实测），而且这个 throw 还会**盖掉**后续断言。作者 runner 固定 `cwd: root`（`scripts/run-tests.mjs:91`）所以 `npm test` 下没事，但换入口就假红。
9. `companion/src/security.ts:939` — 收录口径写「本批收的码，其产出报文在登记前与登记后等级一致（零变更）」，**缺「静态可确定」限定词**。含输入/模型派生插值的桶内码，在插值串带 recoverable 触发词时 base 会是 recoverable、head 是 non_recoverable。可达且现实的至少两处：`tool/plan-readonly.ts:158`（`${toolName}`，工具名由模型给；我查过目录里 **62 个真实工具名无一含触发词**，但幻觉名可以）、`orchestrator/expert-team.ts:476`（`${invented.join(", ")}`，`invented` 是模型传的 expert id）；另有 `board/service.ts:1167`（`${id}`）。commit message 的说法（「可验站点里 … 为 0」）是准确的，源码这句口径不是 —— 建议补限定词。
10. commit message 抬头写「本提交是**第七次修订**」、「本次（第七版）」，而按评审流程这是**第八修订**；同段「companion **唯一失败**与基线同」与实际（本机 62 个失败）措辞不符，宜为「唯一失败**集合**同基线、相关 0」。

## 未能验证

- **「companion 唯一失败与基线同」**：我跑了全量（`ℹ pass 4580 / fail 57` + settings 批 `pass 674 / fail 5`，去重 **62 个失败名**），逐条看全是平台/环境型（`symlink EPERM`、`0o600` 权限断言、macOS bundleId、锁/信号），**没有一条**涉及 `classifyError`/等级（grep `classif|level|recoverab|error_code` 命中 0 条实质用例）。但「与基线逐名相同」需要另跑 main 全量（成本高）→ **推断**，未实测。
- 「拼装类识别**完备**」——本来也不可证；我这一轮是**尽力而为**的下界（585 站点 + 上述解析面），不能排除下一轮再冒出一个。
- 动态码站点（`error_code: <expr>`，**186 处**）中「码与报文来自同一个上游对象」的那一类（如 `board/intent-claim.ts:119` `result.error_code || "CLAIM_FAILED"` + `result.error`）我按「配对一致」判定无害，未逐点追上游是否改写字段。
- macOS 侧 `darwin-estop.reason`（本 PR 未触碰该文件）未复核。

## 上一轮 1 个 P0 + 2 个 NIT 是否已修（逐条）

| # | 上轮发现 | 本版结论 |
|---|---|---|
| P0 | `EMERGENCY_STOP_UNAVAILABLE` 是本类第 7 个、被登记成 `non_recoverable` ⇒ 未声明收紧 | **已修 ✓（真修，非文档修）**：`security.ts:964` 的桶里已无它，只在注释 `:950` 出现；我把 base/head 两个 `security.ts` 真跑，按上轮逐字报文复算：`… not found at C:/… (stage host-scripts-win next to cmspark-agent.exe)` → **base/head 均 recoverable**；`spawn failed: … ENOENT` → **均 recoverable**；无 diag / corrupt 两条 → 均 non_recoverable。作者的「实测均 recoverable」**成立**。 |
| NIT | 守卫依赖 `", "` 排版（我上轮逐字引用的无空格变体 0 红） | **已修 ✓**：`tests:216` 改为 `includes('",')`；我用**上轮原样的无空格变体** `["THREAD_REQUIRED","recoverable"],` 复现 **1 红**，带空格变体 **1 红**。残留：追加行尾/多行拆写仍 0 红（NIT-7）。 |
| NIT | 陈旧注释（用例「8 条」计数；一处被 AST 推翻的因果表述） | **部分修**：`tests:97` 的「8 条」已改写为「以下这些」✓；`tests:112-114` 的因果已按事实改写 ✓（我 AST 复核：`if (!proposeDenied)`@1994、then 1994–2234、无 else、含 2121 —— 与源码 `security.ts:1109-1110` 一致）。**未修**：同一段的 `shouldStop(2136)` 行号仍错并扩散到用例（NIT-3）；源码侧 SELECTOR_REQUIRED 副本仍与用例不同步（NIT-5）。另**新引入**一处计数错误「6 个」vs 7 个（NIT-1）。 |

**其余声明核对**：`109 = 43 显式 + 59 默认桶 + 7 image 族` **独立复现完全成立 ✓**（43 行显式条目去重 43、桶 59 去重 59、image 7、三组两两无重叠、组内无重复、`ERROR_CODE_LEVELS.size = 109`、base 35 → 新增 74 无删除）；「全仓 `classifyError` 只被 `adapter.ts:2121` 调用」✓；「`SUMMONER_ACL` 20+ 处」✓（51 次出现 / 23 行带 `error_code`）；「属性用例 109 码 0 不稳定」✓；用例 **12/12 全部有效**（我共 14 处突变：整体翻转桶→1 红、无空格重复登记→1 红、删显式条目→2 红、删码优先→7 红、`DOWNLOAD_BUSY`/`HINT_REQUIRED`/`COOKIE_TRUST_DENIED`/`PATH_ESCAPE`/`SELECTOR_REQUIRED`/`SITE_OP_ESCALATE` 翻转→各 1~3 红；基线 0）；`npm run build` ✓、门禁 **156/0** ✓、extension **1498/1498** ✓。

## 判断题：合 / 换修法 / 收成零变更 —— 选哪一个

### 选 **(A) 合**。

理由（基于这五轮的经验，逐条给机制而不是感觉）：

1. **本类风险的「危害面」已被结构性封住，而不是靠枚举穷尽。** 这一版把「无法证明等级不变」的码**移出登记表** ⇒ 它们的等级重新由报文决定 = **与 main 完全相同**（`classifyError` 体逐字节相同，可证）。于是「第 8 个拼装码」若**没被登记**，它的后果是**零变更**，不再是未声明收紧。这就是我前五轮每轮咬同一处的原因在本版被消掉的地方：风险从「漏一个 = 收紧」变成「漏一个 = 不变」。
2. **真正剩下的风险只有一种：既被登记（桶）又报文拼装的码。** 我这一轮把它当唯一 P0 目标穷举（585 站点、含 2 跳/对象属性/`join`/`new XError`/函数返回值/外层兄弟 `error`），结果是这类码**只有 8 个、且全部钉成 `recoverable`** —— 钉 recoverable 在分类器里不可能产出收紧。加上「收紧 0（158 个字面量站点）」与「无新增 `security→recoverable` 降级路径」，本版与它自己的能力声明（Trust: 收紧 0，变更全放宽）**一致**。
3. **(B) 换修法方向正确，但不是合的**前提**，而且它单独解决不了本问题。** 产出点修法（`companion-dispatch.ts:325` → `error_code: intentClaim.error_code || "SPAWN_INTENT_FAILED"`）能恢复「码与报文同源」这一不变量，我确认 `claimIntent` 的返回类型确实带 `error_code`，所以改造成本低（7 个站点 × 1 行 + 每个追一次上游是否带码 + 一处 UI/遥测文案影响 + 用例）。但它**不替代登记表**（上游码自己仍需登记），也不覆盖「上游同时改码与改文案」的其余形态；它属于**独立的一件事**，作者已如实记入 #563，我在本版看不到「必须先做它才能合」的理由。以「枚举不收敛」为由把 PR 永远卡在这一版，代价是把 59 个码的文案漂移（#560 的病根）继续留在树上。
4. **(C) 收成严格零变更不成立为「可证明」**，因为不可判定性对输入派生报文同样存在（要真做就得把 `INVALID_KEY`/`RESERVED_KEY`/`PLAN_READONLY_BLOCKED`/`NO_ELIGIBLE_EXPERTS`/`BOARD_*`/`GRANT_*` 等约 15 个带动态插值的码一并推迟），而它们恰恰是 #563 里量最大的一组；推迟只让漂移继续，换不到更强的保证。所以我把它列为次优。

**合的条件（建议随合或合后立刻做，均非阻塞）**：把 NIT-1/2/3/5/9 的措辞与计数改正（尤其 `:939` 口径补「静态可确定」、`:947` 6→7、`:1110` 行号），把 NIT-6 的下界钉回等值或改成显式清单，把守卫生效范围写清（NIT-7/8）。#563 请把 (B) 方向写成**产出点修法**的专项（保留上游码 + 每站点的等级决策），并把「可达的模型派生插值」（`PLAN_READONLY_BLOCKED` 的 `toolName`、`NO_ELIGIBLE_EXPERTS` 的 `invented`）单列，这是我这一轮唯一没能归零的那一小块。

VERDICT: APPROVE_WITH_NITS
PI_EXIT=0
