diag: pi=/c/nvm4w/nodejs/pi
## 验证方法（先说清做了什么）

- 自写 AST 扫描器（`companion/node_modules/typescript`）：433 个 `error_code`/`code` 对象字面量站点 / 221 个码（companion/src），+chrome-extension 31 站点 / 20 码；另对 112 个已登记码逐字面量定位（464 命中），用「base = `10115dc6` 的 security.ts」的 `classifyError` 逐 (码, 报文) 对独立求 before/after。
- 实际跑了：`npm run build` ✓、`tsc -p tsconfig.test.json` + 目标用例 **11/11** ✓、`test-package-gates.sh` **156/0** ✓、extension `npm test` **1498/1498** ✓、**12 处突变**（逐轮重编译）。
- 独立复算：registry keys **112** = 42 字面量显式 + 63 默认桶 + 7 image 族；三组两两无交集、桶内无重复 ✓（claim 8 成立，已独立复现）。

## BLOCKING（必须修才能合）

- **[P0] `security.ts:958`（+ `board/intent-claim.ts:119-120`、`board/service.ts:172`、`tool/companion-dispatch.ts:748`）— 「本版只有放宽、没有收紧」是假的：`CLAIM_FAILED` 是本票的一处收紧。**
  链条（AST + 逐行核实）：`claimIntent` 的失败回退 `error: result.error, error_code: result.error_code || "CLAIM_FAILED"`（`intent-claim.ts:119-120`）；`mutateMissionBoard` 的 5 个 `ok:false` 返回里**唯一没有 `error_code`** 的就是 `service.ts:172` = `` error: `host thread not found: ${hostThreadId}` ``；它经 `companion-dispatch.ts:748`（`{success:false, error: r.error, data:{error_code: r.error_code}}`）成为 LLM 的 tool result → `adapter.ts:2121` `classifyError("host thread not found: …", {error_code:"CLAIM_FAILED"})`。
  base：码未登记 → 命中子串 `not found` → **recoverable**；head：登记为 `non_recoverable` → `adapter.ts:2136-2137` `shouldStop = true` / `terminal = "security_halt"`。
  触发条件：父线程在 `claimIntent` 的预检（`:66`）与 `mutateMissionBoard` 内 `tm.get`（`service.ts:170`，中间隔一个 await/lock）之间被删掉 —— **窄竞态**，但状态迁移是真的，且方向与提交信息的能力声明（ADR-020「全部为放宽，无任何收紧；未削弱任何安全判定」）直接冲突。
  更正自己的上一轮：v2（`80eba16b`）时 `CLAIM_FAILED` 已在 66 条桶里，我上轮只核了「可静态配对的报文」，没追这条动态报文，所以漏了 —— 这轮补上，结论是收紧而不是零变更。
  另：同一句 ① 口径「本批收的是产出报文能被静态手段认定为普通字面量或模板串的码」（`security.ts:940-941`）也被这条和 `BOARD_HINT_INVALID` 否证 —— `board/service.ts:700` 的报文正是 `hr.error.issues.map((i) => i.message).join("; ")`，与作者用来解释「其他码为什么不收」的 `zodIssues.map(…)` 是同一形态。**收紧正是从这个口径缺口漏进来的。**
  修法一行：`CLAIM_FAILED` 改 `recoverable`（或移出本批）。

- **[P0] `security.ts:1084-1088` — `PROPOSE_REQUIRED` / `ALREADY_HAS_STEPS` 的理由与代码相反，这两条实际是运行时中性，不是「放宽」。**
  注释称「`adapter.ts:1990-1994` 把这两个码归为 `proposeDenied`…**但** `classifyError`（`adapter.ts:2121`）在该块**之外**，故此前判 non_recoverable 会让…直接以 `security_halt` 终止整轮」。
  AST 实测：`if (!proposeDenied) {`（`adapter.ts:1994`）的 then 分支 **跨 1994-2234 行**，**包含** `classifyError`（2121）、`shouldStop = true`（2136）、`terminal = "security_halt"`（2137）与 recoverable 回喂分支（2159）；**没有 else**（`else? false`）。两个码的产出点全部写 `data.error_code`（`adapter.ts:236`、`:1750`、`companion-dispatch.ts:2226`），正是 `proposeDenied` 匹配的字段 → 该码到达时整块（含分类与终止）被跳过。
  因此：(a) 注释里的「此前会被 `security_halt`」不成立；(b) `security.ts:1076`「② 运行时可观测变更（**3 个码**，均放宽）」对其中 2 个是错的；(c) 提交信息「15 个变更点 / 5 个码（全部放宽）」里这 2 个码不该计入。放宽本身无害（不可达），但**真相源里的因果写反了** —— 这是我前两轮打回过的同一类问题。
  附（潜在脆弱点，非本次阻塞）：该守卫只看 `data.error_code`，而 `classifyError` 还读顶层 `toolResult.error_code`；若将来有产出点把码放顶层，守卫失效、这两条立刻变成真实的放宽 —— 建议注释里点明。

- **[P1] `tests/classify-by-code.test.ts:192`、`:194-198` — claim 5（陈旧数字已清）未达成，这段注释本身是坏文本。**
  `:192` 仍写「**100 个码**的等级被整体翻转」、`:196` 仍写「**→ 现 99 条。**」（现为 63）；且 `:194` 与 `:196` 是**同一句被拆成两半的重复残留**，中间夹 `:195`/`:197` 两个孤立空行。提交信息声称「`100 条 / 现 99 条` → 63」已完成 —— 与代码不符。

- **[P1] `security.ts:943-944`、`:948-949`、`:950`、`:1061`、`:1062-1064` — 真相源里的数字/口径仍有多处与代码不符（这是本票唯一交付物）。**
  - `:1061`「#563 A 批（**12 个显式条目**）」→ 实际 **14**（42 = base 28 + 新增 14：`DOM_SCRIPT_LOOP_CAPPED`/`DOM_SCRIPT_VOLUME_CAPPED`/`SITE_OP_BANNED`/`TAB_ATTACH_FROZEN`/`INTENT_NOT_FOUND`/`L2_ADMISSION_TIMEOUT`/`CALLER_DISCONNECTED`/`BOARD_HOST_INVALID`/`PROPOSE_REQUIRED`/`ALREADY_HAS_STEPS`/`SUMMONER_ACL`/`SUMMONER_L0`/`SITE_OP_ESCALATE`/`INTENT_CAP`）。12 是 v2（`80eba16b`）的旧值。
  - `:1062-1064`「① 运行时中性：这些码的产出点**不在** `classifyError` 的路径上（…它们走 WS / tray / HTTP 表面）」→ 与同一批里 `:1076`、`:1099-1100`（作者自己更正 `SUMMONER_L0` 不中性）以及与 `SITE_OP_BANNED`/`SITE_OP_ESCALATE`/`TAB_ATTACH_FROZEN`/`DOM_SCRIPT_*_CAPPED`/`PROPOSE_REQUIRED`/`ALREADY_HAS_STEPS`/`BOARD_HOST_INVALID` 都矛盾；`:1065` 之后编号又回到「①」，两条 ① 并存。
  - `:948-949`「10 个 `BOARD_*` 里，**6 个**落在本表、**4 个**未登记」→ AST 实测自写 `recoverable: true` 的正好 10 个码（`BOARD_TOO_LARGE`/`SCHEMA_INVALID`/`MODE_OFF`/`TRUST_REJECTED`/`CAP_FACTS`/`CAP_INTENTS`/`FACT_INVALID`/`INTENT_INVALID`/`HINT_INVALID`/`CAP_HINTS`），其中**7 个**在默认桶、**3 个**未登记。6/4 是 v2 的 `66` 条清单下的数。
  - `:943-944`「pi 的 AST 扫描器…多找到 3 个 `SUMMONER_ACL` 产出点（**本仓扫描 8 个、它 11 个**）」→ 我的重扫：`SUMMONER_ACL` 有 **23 个产出点**（26 次字面量出现 − 2 处类型注解 `ws/summoner-acl.ts:68/:86` − 1 处登记项本身）：`message-router.ts:3135/3299/3901/3920/3966/4030/4278/4299`（8）、`ws/summoner-acl.ts:73/93/104/112/135/154/169/176`（8）、`tool/companion-dispatch.ts:2211/2235/2288`（3）、`pty/handler.ts:58`（1）、`message-router/handlers/{knowledge.ts:9,overlay-shell.ts:22,ui-open-sidepanel.ts:74}`（3）。**同时更正我自己上一轮的「11」——那是我当时的漏计**（漏了 `ws/summoner-acl.ts` 的 6 处与 `companion-dispatch` 的 3 处）。「下界」这个限定本身恰当、也确实写进了源码（`:944`），但挂在它上面的具体数字不可复现。
  - 「15 个变更点 / 5 个码」不可复现：我按「base(报文) ≠ head(码)」独立算得 **21 个站点**（`SUMMONER_ACL` 11 + `SUMMONER_L0` 1（`adapter.ts:542`，`menu-bar-agent.ts:1838` 的报文含 `not allowed` → 0 变更）+ `BOARD_HOST_INVALID` 6 + `PROPOSE_REQUIRED` 1 + `ALREADY_HAS_STEPS` 2），其中 3 个被 `proposeDenied` 守卫吃掉（上条）。方向核对：这 21 个**全部是放宽**，唯一收紧就是上条那个 `CLAIM_FAILED`（它藏在动态报文后，正因如此才没被「可验站点」口径覆盖）。

- **[P1] `security.ts:950` — 「尚未登记的 31 个产出码…不能仅凭静态扫描归类」仍是过度概括（上一轮 P1-2 的窄化残留）。**
  我扫出 ≥5 个未登记码**每个只有一个产出点、报文是普通字面量/模板串、base 全 `non_recoverable`**（即登记必为可证明的零变更），且它们**在 v2 的桶里、本版被移出**：`INVALID_KEY`（`user-env.ts:233`）、`OVERLAY_STANDBY`（`menu-bar-agent.ts:1534`）、`OVERLAY_SHELL_UNAVAILABLE`（`menu-bar-agent.ts:1853`）、`UI_COMMAND_UNKNOWN`（`message-router/handlers/ui-command.ts:15`）、`POST_CONFIRM_CANCELLED`（`orchestrator/tab-lease.ts:515`）。若真实理由其实是**等级决策**（如 `INVALID_KEY` 是模型可自修的输入错误），请像 `BOARD_*` 那样写清；现在的措辞把「可静态验证」当成延期理由，与代码不符。

## NITS（非阻塞）

- `tests/classify-by-code.test.ts:146-148` — 「两清单无重叠」的守卫只查 `DEFAULT_NON_RECOVERABLE_CODES × EXPECTED_LEVELS`。在显式表里给一个**已在默认桶**的码加条目（不改 EXPECTED）会被末尾的 spread **静默覆盖**且 **0 红**：我加的突变 M11（`["INTENT_CAP","recoverable"],` 后插 `["THREAD_REQUIRED","recoverable"],`）→ `pass 11 / fail 0`。当前文件无此冲突（我核过：字面量 ∩ 默认桶 = ∅），但守卫挡不住将来这手。
- `security.ts:972-975` — 默认桶数组后有 3 个连续空行。
- `security.ts:1039-1043`（本票范围内、v2 遗留）— 引用行号偏差：`plan.selector` 在 `chrome-extension/src/background/browser-bridge.ts:572`（调用点 `:512`），不是 `:600`；`failInteractive(…, "ELEMENT_NOT_FOUND")` 在 `:603`；另 `browser-bridge.ts`/`locator-classify.ts` 都属 extension，注释未给目录前缀。`locator-classify.ts:64-71` 正确。
- `security.ts:1065/1066` — 「②」之后又出现「①」，两类编号混用（可读性）。

## 已验证（作者声明逐条）

| # | 声明 | 结论 |
|---|---|---|
| 1 | `CALLER_DISCONNECTED` 净变更 0 | **成立** ✓：唯一带报文的产出点 `companion-http.ts:599-603` 报文含 `"disconnected"` → base/head 均 recoverable；`:586`/`:703`/`:718` 只给码不给 `error`（extension 侧无该码）。 |
| 2 | 补 5 个可验码进默认桶 | **成立**（`BOARD_COMPLETE_L2_REQUIRED`/`BOARD_COMPLETE_SELF_APPROVE`/`BOARD_TRUST_INSUFFICIENT`/`HOST_CHROME_TAB_LEASE`/`WORKER_PATH_DENIED` 的报文均静态、base 均 non_recoverable）。 |
| 3 | 移出 `IO_ERROR` | **成立** ✓（已不在桶内，`user-env.ts:260` 报文为 `err?.message \|\| String(err)`）。 |
| 4 | 不再声称「退回的码报文都是动态」 | 旧断言已删 ✓，但新措辞仍有反例（见 P1）。 |
| 5 | 陈旧数字 `100/99` → 63 | **不成立**（见 P1，`tests:192/196` 仍在）。 |
| 6 | `SUMMONER_L0` 在 `adapter.ts:542` 有产出点、非运行时中性 | **成立** ✓（`:542` 确有，报文 `adapter.ts:215-216`）。 |
| 7 | 15 变更点 / 5 码（全部放宽）+ `SUMMONER_L0` = 6 码 | **不成立**（见 P0-2、P1：计数不可复现；2 个码中性；且有 1 处收紧）。 |
| 8 | 112 = 42 + 63 + 7，无重复无重叠 | **成立** ✓（独立复算）。 |
| 9 | 突变 1/1/1/7、用例 11/11、extension 1498/1498、门禁 156/0 | **成立** ✓：我另跑的突变 M1（删桶内码）1 红、M2（整体翻转默认桶）1 红、M3（翻转 `PROPOSE_REQUIRED`）1 红、M4（删码优先）**7 红**、M5（桶内重复）1 红、M6/M7/M10/M12（翻 `BOARD_HOST_INVALID`/`SUMMONER_ACL`/`SITE_OP_ESCALATE`/`DOM_SCRIPT_LOOP_CAPPED`）各 1 红、M8（缩到 61 触发 anti-vacuity）1 红；`npm run build` 0 错；registry 112 且无坏键；属性用例 0 不稳定。 |

## 未能验证

- 「可验产出点 **106 个**」「本仓扫描 **8 个**」以及 #563 里那份 **31 个**名单本身：作者脚本不在仓库内、本机无 `gh`，无法核对 issue 内容；我只能独立数出「我扫到的未登记码 = 79 个」（与提交信息里另一处「pi 扩展重扫后仍剩 79 个未登记」一致），并逐条否证其中 5 个的「不可静态归类」。
- 「companion 唯一失败与基线同、相关 0」：未跑全量 403 文件（只跑了目标用例与门禁）；本 PR 只动 `security.ts` + 该用例文件，风险低。
- 提交信息里已无「4 种形态」字样（应是 v2 正文残留），本版不适用；`HOSTILE_SHAPES` 实为 9 条。
- 「全部 112 个已登记码等级与 message 无关」：由通过的属性用例间接验证 ✓（非我独立重写）。

## 上一轮 3 个 P1 是否已修（逐条）

1. **计数错（「11 点 / 4 码」、`CALLER_DISCONNECTED` 算变更点）→ 部分修好。** `CALLER_DISCONNECTED` 已按实测改为「净变更 0」并在源码注明（`:1079-1081`）✓；但替换上去的数字（`12 个显式条目`、`本仓 8 / pi 11`）同样与代码不符（实为 14 / 23），且我上一轮给的「11」本身也是漏计 —— 这次一并更正。新引入的「15/5」同样不可复现。
2. **「退回的码报文都是动态」对 ≥11 个是假的 → 方向已改，执行仍不准。** 那句被证伪的普适断言已删，改为中性的「31 个…需逐条核实」✓；但新措辞对 ≥5 个（`INVALID_KEY`/`OVERLAY_STANDBY`/`OVERLAY_SHELL_UNAVAILABLE`/`UI_COMMAND_UNKNOWN`/`POST_CONFIRM_CANCELLED`）仍不成立（见 P1）。
3. **`BOARD_HOST_INVALID` 方向不该收紧 → 已修，但整体「无收紧」不成立。** 该码现为 `recoverable` ✓，且我复核 `intent-claim.ts:67`（base recoverable，0 变更）与 `service.ts:175/258/267/918/1201/1384`（base non_recoverable，6 处放宽），我上轮指的那处危害确实消失；引用 `service.ts:179/922/1205` 也已改对 ✓。**但**同一 PR 里 `CLAIM_FAILED` 是把 `host thread not found` 从 recoverable 变 `security_halt` 的收紧（P0-1），所以「只有放宽、没有收紧」这句仍不成立 —— 这句恰是本版新加的能力声明。

**总评**：主体（63 条默认桶 + 14 条显式登记、零重复、守卫/突变/回归全绿）经我独立复算基本成立；但本票的唯一交付物是「声明」，而本版新写的声明里仍有 1 处收紧被漏、1 处因果写反、5 处数字/引用与代码不符 —— 与前两轮同一病根（我的上一轮也漏了这条动态报文的收紧，已在上文认领）。修法都是注释/一行等级，成本很低，改完可直接复核通过。

VERDICT: REJECT
PI_EXIT=0
