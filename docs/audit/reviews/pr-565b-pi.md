diag: pi=/c/nvm4w/nodejs/pi
## BLOCKING（必须修才能合）

评审基线：工作树 = `80eba16b`（`git diff` 干净）。方法：自写 AST 扫描器（`ts.createSourceFile`，覆盖 `error_code:` 对象字面量 + 外层对象 `error:` + `new …Error("CODE",…)` + helper 返回值 + 含码字面量）扫描 `companion/src`（478 站点 / 199 个不同码），再用「base = `10115dc6` 的 `security.ts`」与「head」对**每个 (码,报文) 对**独立求 `classifyError`，并实际跑突变（每轮重编译）。

- **[P1] `security.ts:1089`、`tests/classify-by-code.test.ts:110`、PR 正文表 —— 「11 个变更点 / 4 个码」是错的：实际是 13 个点 / 3 个码**
  我逐 (码,报文) 对重算，`before !== after` 的变更点**恰好 13 个**：
  - `BOARD_HOST_INVALID` 1 点：`board/intent-claim.ts:67`（recoverable→non_recoverable）
  - `SUMMONER_L0` 1 点：`menu-bar-agent.ts:1840`（同向）
  - `SUMMONER_ACL` **11 点**：`message-router/handlers/knowledge.ts:9`、`message-router.ts:3299/3901/3920/3966/4030/4278/4299`、`ws/summoner-acl.ts:73`、`message-router/handlers/overlay-shell.ts:22`、`message-router/handlers/ui-open-sidepanel.ts:74`（全部 recoverable→non_recoverable，全部因 `"not allowed"` 误命中）
  即 `SUMMONER_ACL` 是 **11 点**，不是 PR 表的 8 点、也不是代码注释的「6 个报文对」（我自己上一轮说 8 点是**我的漏计**——漏了 `overlay-shell.ts:22`/`ui-open-sidepanel.ts:74`（码与报文分参传入 helper）和 `knowledge.ts:9`；此处更正）。
  另外 `CALLER_DISCONNECTED` **根本不是变更点**：唯一带报文的产出点 `outbound-mcp/companion-http.ts:601` 的报文含 `"disconnected"` → base 已是 recoverable，登记后仍 recoverable（0 变更）；`:703/:718` 无报文且按作者自己的说明不在 `classifyError` 路径上。所以「第三处真实行为变更」不存在 —— 见 P2-2。**净运行时变更只有 1 点**（见下条）。
  影响：这是本 PR 唯一的交付物（登记记录 + 声明），计数错会让后续 owner 误判收紧面。

- **[P1] `security.ts:939-945` + 提交信息 —— 「退回的 30 个码报文动态、静态无法验证」对其中 ≥11 个是假的**
  以下 11 个码的**每一个**产出点的 `error:` 都是普通字面量/模板串（0 个动态点），且这些报文在 base 全判 `non_recoverable` → 登记它们可证明零变更，却被一并退回：
  | 码 | 产出点 | base 等级 |
  |---|---|---|
  | `PLAN_READONLY_BLOCKED` | `tool/plan-readonly.ts:160`（模板串） | non_recoverable |
  | `BOARD_COMPLETE_L2_REQUIRED` | `tool/companion-dispatch.ts:796` | non_recoverable |
  | `BOARD_COMPLETE_SELF_APPROVE` | `tool/companion-dispatch.ts:788` | non_recoverable |
  | `BOARD_TRUST_INSUFFICIENT` | `board/service.ts:1181` | non_recoverable |
  | `HOST_CHROME_TAB_LEASE` | `orchestrator/tool-pregate.ts:291` | non_recoverable |
  | `INVALID_ARGS` | `tool/companion-dispatch.ts:201/2307` | non_recoverable |
  | `NO_ELIGIBLE_EXPERTS` | `orchestrator/expert-team.ts:479`、`tool/l2-admission.ts:1374` | non_recoverable |
  | `WORKER_PATH_DENIED` | `path-sandbox.ts:165` | non_recoverable |
  | `PROPOSE_REQUIRED` | `llm/adapter.ts:235-236` | non_recoverable |
  | `OVERLAY_THREAD_MISMATCH` | `ws/composer-lease.ts:138/146` | non_recoverable |
  | `GRANT_CALLER_MISMATCH` | `outbound-mcp/companion-http.ts:882/953`、`outbound-grants.ts:294` | non_recoverable |
  其中 `PROPOSE_REQUIRED`、`WORKER_PATH_DENIED`、`BOARD_SCHEMA_INVALID` 正是 `security.ts:944-945` 用来**举例说明「动态报文」**的码（`BOARD_SCHEMA_INVALID` 确为 `zodIssues.map(…)`，算对的；前两个不算）。除 `GRANT_CALLER_MISMATCH`/`OVERLAY_THREAD_MISMATCH` 外，其余都在 `adapter.ts:2121` 的同一路径上。
  影响：本票的**中心口径**（「只收可验的」）被当成边界理由，但执行不一致 —— 11 个可验码以假理由延期，#563 的剩余面被高估。

- **[P1] `board/intent-claim.ts:67`（`security.ts:1078`）—— 本 PR 唯一的真实运行时变更，方向与仓库自己的判据、以及同族分支冲突，需要显式决策记录**
  这是 13 个点里**唯一**能走到 `adapter.ts:2121` 的（其余 `SUMMONER_*` 点全在 `message-router.ts`/`menu-bar-agent.ts:1840` 的 WS/tray 表面，`classifyError` 全仓只被 `adapter.ts:2121` 调用）。登记后该失败从「喂回模型换路」变成 `shouldStop` / `terminal="security_halt"`。
  理由链有问题：① 依据是「7 个报文里 6 个原本 non_recoverable」= **多数票**，不是本仓库其它条目使用的判据「**agent 本回合能否自修**」（见 `module.test` 里 `HINT_REQUIRED` 的注释）；「board host not found or not a host thread」是模型选错线程/工具，本回合可自修。② 同一工具族的**兄弟分支**今天仍是 recoverable：`tool/companion-dispatch.ts:759` `if (!hostId) return { success:false, error:"board host not found" }`（无码 → 命中 `"not found"`）。产出方的 `recoverable:false` 声明出现在**另外三条报文**（`service.ts:179/922/1205`）上，不能外推到 `intent-claim.ts:67` 这条。
  即：本 PR 不是「零行为变更」，而方向恰好把一条可自修的失败变成整轮终止 —— 要么给出决策记录（#563 或 owner 签字），要么退回 recoverable 与兄弟分支一致。

## NITS（非阻塞）

- `security.ts:1064-1066` — 段落头仍写「#563 A 批（**8 条**）…（两者的结论一致，故**零行为变更**）」，但该段实际有 **12 个码**，且段内三个 `⚠️` 条目自己声明了收紧/放宽（`BOARD_HOST_INVALID`、`SUMMONER_ACL`、`SUMMONER_L0`）。这正是提交信息里承诺「不再声称零行为变更」的那句话，残留在了源码真相源里。
- `security.ts:1082-1087` — `CALLER_DISCONNECTED` 注释两处不成立：(a)「产出点在 …`companion-http.ts:703/718` 只给 `error_code`、不给 `error`」漏掉了 `:593/:601` —— 那里**同时**给了 `error`（我上一轮的 NIT 已指出过，这次没改）；(b)「是本批**第三处真实行为变更**」与同句「**不在** classifyError 路径上」自相矛盾，且实测 `:601` 的报文 base/head 都是 recoverable → 净变更为 0。`base` 里本没有该码，改的是**映射**，不是任何 (码,报文) 对。
- `security.ts:948-951` — 「生产者**自己声明过** `recoverable: true` 的 **9 个** `BOARD_*` … 与登记结果**冲突**」：实际产出方自写 `recoverable: true` 的是 **10 个**码（漏 `BOARD_HINT_INVALID`，`board/service.ts:668/704`）；且列出的 9 个里 `BOARD_SCHEMA_INVALID`/`BOARD_FACT_INVALID`/`BOARD_INTENT_INVALID` **本批根本没登记**（在退回的 30 里），不存在「与登记结果冲突」。真正冲突的是 6 个：`BOARD_TOO_LARGE`/`MODE_OFF`/`TRUST_REJECTED`/`CAP_FACTS`/`CAP_INTENTS`/`CAP_HINTS`。
- `security.ts:1074` — 引用 `board/service.ts:179/1206/1389` 自写 `recoverable: false`：实测是 **`:179` / `:922` / `:1205`**；`:1387`（作者想指的那个 `cannot resolve board host`）**没有** `recoverable` 字段。漏掉的 `:922` 恰是上一轮 P0 里真正在 `collect_handback` 上的那条。
- `security.ts:941` vs `user-env.ts:262` — 口径自相矛盾：文档说「报文由 …`String(err)` 拼出的码**一律不收**」，但 `IO_ERROR`（在 66 条默认桶里）的报文就是 `err?.message || String(err)`。今天它在 `message-router/handlers/user-env.ts` 表面上，不进 `classifyError`，所以无运行时影响 —— 但「66 条全可验」的说法因此不成立。
- `security.ts` 默认桶 doc + PR 正文「可验产出点 103 个 / 7 个动态点」**不可复现**：按「新登记的 78 个码」统计，站点 = 149（静态报文 118 / **无 `error` 字段 27** / 动态报文 4）。那 27 个「无 `error` 字段」点里，`tool/companion-dispatch.ts:2226/2261` 把 `error_code` 直接当报文（`error: decided.error_code`）——我按「报文=码」对全部 66 条重算，base 全 `non_recoverable`（66/66），所以桶的结论**仍然成立**，只是计数口径对不上。
- `tests/classify-by-code.test.ts:132/187/189-193` — 陈旧数字：`100 条`、`登记时是 100 条 … → 现 99 条`（现为 66）；:190/:192/:194 有拆句的孤立空行，:200 之后缺空行贴在 :201 上。`tests:110` 同 :1089 的「6 个报文对」。
- PR 正文「（4 种形态恒定）」vs `tests/classify-by-code.test.ts:19-28` 的 `HOSTILE_SHAPES` = **9 条**（属少报，方向安全）。

## 未能验证

- 「ComputerErrorCode 35 个 / 另有 79 个码已记入 #563」：本机无 `gh`、仓库内无 #563 记录，无法确认 issue 内容；我只独立确认这些码在 head 仍**未登记**（`OUT_OF_BOUNDS`、`DANGER_HARD_DENY`、`CLICK_OCCLUDED`、`INTEGRITY_LEVEL_DENIED`、`DESKTOP_DENIED`、`RATE_LIMITED`、`TASK_ABORTED`、`EMERGENCY_STOP_LOST` 全 `false`）。
- 「companion 唯一失败与基线同」：403 个测试文件未全跑。抽跑相关子集 176 个用例 → 175/1，唯一失败是 `tests/execution-contract.test.ts:115 extractShellWrites: redirections resolved against cwd`（Windows 路径解析，与本次两文件无关；`git diff --name-only 10115dc6 80eba16b` 只有 `security.ts` + `classify-by-code.test.ts`），与该失败**相关 0** 成立。extension 1498/1498 未跑。
- 「7 个动态点」的原始清单/口径（见上，我数出的是 27 无报文 + 4 动态）。

**已独立复现的守卫/突变**（每轮 `tsc -p tsconfig.test.json` 后跑）：M1 删默认桶码（`BOARD_MISSING`）→ 1 红；M2 整体翻转默认桶等级 → 1 红（正是新增用例抓的）；M3 翻转 `SITE_OP_ESCALATE` → 1 红；M4 删码优先（`false && byCode`）→ **7 红**（采纳更正后的数字 ✓）。我另加两处：默认桶内**重复条目** → 1 红（`表与期望表双向一致`，重复键确实被抓）；翻转显式条目 `SUMMONER_ACL`/`BOARD_HOST_INVALID` → 各 1 红。`40 显式 + 66 默认桶 + 7 image 族 = 113`、桶内 66 无重复、两清单无重叠 ✓；`npm run build`/`tsc --noEmit` 0 错 ✓；门禁 `156 passed, 0 failed` ✓；用例 11/11 ✓。

## 上一轮 P0 是否已修（逐条）

1. **[已修·已验证] P0-1 `SITE_OP_ESCALATE` 推翻 `adapter.ts:2157-2159` 契约** —— `security.ts:1107` = `recoverable`。契约被尊重：真实报文只有一个来源（`site-op-memory.ts:612-620` 的 `originEscalateError()`，经 `:654` 的 `bannedSiteOpResult`；唯一消费者 `adapter.ts:1774`；`:319` 的 `SITE_OP_ESCALATE` 只是内部 `SiteOpBan` 标记，不是工具结果），报文含 `SITE_OP_BANNED` → base `recoverable`、head `recoverable`，**零变更**。`adapter.ts:2159` 的排除逻辑**不再是死代码**（注册后 `classifyError` 必返 recoverable → 必达该分支跳计数；`adapter.ts:2008-2010` 的 `SITE_OP_BANNED`/`TAB_ATTACH_FROZEN`/`SITE_OP_ESCALATE` 三码现全为 recoverable，一致）。唯一 `failCode` 特判点就是 2002-2010 与 2159，无第三处契约被推翻。
2. **[已修·已验证] P0-2 `INTENT_CAP` 是收紧** —— `security.ts:1111` = `recoverable`；`board/intent-claim.ts:79` 模板串静态部分含 `already holds` → base `recoverable` = head ✓。
3. **[方向已修·依据/引用有问题] P0-3 `BOARD_HOST_INVALID`** —— `security.ts:1078` 改为 `non_recoverable`，与产出方 `recoverable: false`（`:179/:922/:1205`）一致；但引用行号错（见 NIT），且这条现在是全票唯一的真实运行时变更、方向与兄弟分支冲突（见 P1-3）。
4. **[未修·仅声明] P0-4 枚举缺口** —— `ComputerErrorCode`（含 `DANGER_HARD_DENY` 等 fail-closed 闸门）与其它 79 个码在 head 仍全部未登记，本 PR 只在提交信息里声明并声称记入 #563（无法核对 issue）。作为范围收口可接受，但它仍会使「等级由文案决定」在这一大类上成立。

补充（对本次判定有利的核查）：66 条默认桶**没有任何一条**在可静态验证的报文上改变等级（含「报文=码」形态 66/66 仍 `non_recoverable`），所以桶的登记本身是行为保持的；所有 `data.error_code`/`error_code` 的消费者只有 `adapter.ts:2121`（全仓 `ERROR_CODE_LEVELS` 仅被该处 + 测试引用）。问题**不在映射，在声明**：这个 PR 的交付物就是声明与计数，而上面的 6 处声明与代码/实测不符（含作者已承诺删除的「零行为变更」）。修法是纯文档级（改注释/提交信息/PR 表），但必须先改。

VERDICT: REJECT
PI_EXIT=0
