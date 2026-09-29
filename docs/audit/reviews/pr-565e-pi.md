diag: pi=/c/nvm4w/nodejs/pi
## 验证方法（做了什么）

- 自写 AST 扫描器（`companion/node_modules/typescript` 5.9.3），扫 `companion/src` + `chrome-extension/src` 620 文件：值位置码字面量 1847 处 → 按角色分 producer/compare/bare；对 producer 抽出报文模板（含 `${…}` 插值源码文本）。
- **把 base（= `main` 的 `security.ts`）与 head 各自 `transpileModule` 后真跑**，对每个 (码, 报文) 对独立求 before/after —— 不依赖作者的脚本/计数。先验证 `classifyError` 函数体含子串表 base↔head **逐字节相同**（`diff` 184 行无差异），故「未登记的码行为 = main」可证。
- 三条独立通路找「报文继承另一个错误值的码」：(a) 插值表达式 regex；(b) 数据流-lite（局部变量/参数被赋值自 `X.error/.message/.reason`、`String(e)`、`catch`）；(c) 用户给的 6 个码逐条核对。
- 实跑：`npm run build` ✓、`tsc -p tsconfig.test.json` + 目标用例 **12/12** ✓、`test-package-gates.sh` **156/0** ✓、**9 处突变**（含我上轮原样突变 × 5 种格式）。

---

## BLOCKING（必须修才能合）

- **[P0] `companion/src/security.ts:965` + `companion/src/tool/companion-dispatch.ts:2076-2077`（macOS 同族 `:1960-1961`）— `EMERGENCY_STOP_UNAVAILABLE` 正是本版声称「整类不收」的那一类，却被登记成 `non_recoverable`，产生一处**未声明的真收紧**。
  链条（逐行核实）：
  1. `companion-dispatch.ts:2076` 报文 `` `host_computer refused: emergency-stop unavailable (${estop.reason}). …` ``，`:2077` 钉 `data.error_code: "EMERGENCY_STOP_UNAVAILABLE"`（macOS 分支 `:1960-1961` 用 `darwinEstopOk.reason`）；
  2. `estop.reason` 由 `computer/estop.ts:251-252` 拼成 `` `${last.reason}; ${lastSpawnDiag}` ``，而 `lastSpawnDiag` 的两个取值是
     `:172` `` `computer-estop.ps1 not found at ${scriptPath} (stage host-scripts-win next to cmspark-agent.exe)` ``、`:191` `` `spawn failed: ${err.message}` ``（ENOENT）；
     `:169-172` 的注释把这条写成**打包 SEA 的预期路径**（"the common 'ready file missing' root cause"）；
  3. `adapter.ts:2121` 取 `data.error_code` → `:2137 shouldStop = true` / `:2138 terminal = "security_halt"`（AST 实测行号）。
  **实测**（两个 `security.ts` 都真跑，报文按 `estop.ts:172` 逐字拼）：

  | 报文 | base(main) | head(本版) |
  |---|---|---|
  | `… emergency-stop unavailable (estop helper ready file missing (helper not running); computer-estop.ps1 not found at C:/… (stage host-scripts-win next to cmspark-agent.exe)). …` | **recoverable** | **non_recoverable** |
  | `… emergency-stop unavailable (spawn failed: spawn powershell.exe ENOENT (script=…)). …` | **recoverable** | **non_recoverable** |
  | `… (estop helper ready file missing (helper not running)). …`（无 diag） | non_recoverable | non_recoverable |
  | `… (estop helper ready file is corrupt). …` | non_recoverable | non_recoverable |

  即：Windows 打包版缺 `host-scripts-win/` 时，同一个失败在 main 上让模型换路继续，在本版上**整轮 `security_halt`**；无测试钉这条等级（`tests/computer-estop.test.ts`、`tests/integration/computer-task-mutex.test.ts:274/292` 只断言 `error_code`）。
  **声明与代码冲突**：`security.ts:939`「本批收的码…等级一致（零变更）」、`:1067`「有意变更**全部是放宽（无收紧）**」、`:945-949`「本批因此排除了 6 个」—— 实际这一类至少 **7** 个，且 `EMERGENCY_STOP_UNAVAILABLE` 在 `security.ts` 里只出现在桶数组内（`:965`），**没有任何逐条声明**。作者自己的扫描漏掉它，是因为污染源是对象属性 `estop.reason`（非直接插值 `X.error`）。
  **修法**（三选一，均一行）：把 `EMERGENCY_STOP_UNAVAILABLE` 从桶里移出（走 base 行为，与那 6 个一致）；或登记为 `recoverable` 并在 ② 段逐条声明（它本就是「本回合换工具/换路」信号）；或产出点保留上游失败码。
  （注：我实测「从桶里删掉它」会被作者自己的 `tests/classify-by-code.test.ts:200-204` 抓到 → 1 红，所以这处修不了于无声。）

---

## NITS（非阻塞）

- `companion/tests/classify-by-code.test.ts:206-219`（过滤条件在 `:215`）— **守卫已不再是恒真式**（我复现：`", "` 规范格式 → **1 红** ✓，这是对我上轮 P1 的实质修复），但它是**行文本扫描**，验证力依赖作者排版：同一处突变我跑了 5 种格式，`["THREAD_REQUIRED", "recoverable"],` → 1 红；**`["THREAD_REQUIRED","recoverable"],`（我上轮报告里逐字引用的那个）→ 0 红**；多行拆写 → 0 红；追加到已有行尾 → 0 红。本仓无 prettier/校验格式化（根 `package.json` 无 prettier 依赖，无 `.prettierrc`），故 `", "` 不是强制形态。运行时影响为 0（末尾 spread 覆盖），属卫生守卫 —— 但这意味着「用你原样的突变验证 1 红」只在带空格的变体上成立（over-claim 的边缘）。
- `companion/tests/classify-by-code.test.ts:97` — 本 diff 新写的「**#563 A 批：8 条**「等级随文案漂移」的码」：其下实际 **15** 条（AST 数：`:98-122` 去掉 `PATH_ESCAPE`；对照 `security.ts:1070-1081` 的 ① 组是 **9** 条）。8 既不等于 15 也不等于 9，不可复现。（上轮已报，未修。）
- `companion/tests/classify-by-code.test.ts:112-113` — 「`classifyError(:2121)` 在**该块之外**，故此前判 `non_recoverable` 会让整轮 `security_halt` 终止」仍与 `security.ts:1106-1110` 自相矛盾：AST 实测 `if (!proposeDenied)`（`adapter.ts:1994`）then 分支 **1994–2234、无 else**，**包含** `classifyError`(2121) → 这两码今天**到不了**分类器。同 PR 里源码那处已按事实改写，用例这处没有。（上轮已报，未修。）
- `companion/src/security.ts:1108` — 行号 off-by-one：AST 实测 `shouldStop = true` 在 **`adapter.ts:2137`**、`terminal="security_halt"` 在 **`:2138`**（注释写 2136/2137）。（上轮 NIT，未修。）
- `companion/src/security.ts:1077` — 「唯一带报文的产出点（`companion-http.ts:601`）」：带报文的行是 **`:600`**（`:601` 是 `error_code`）；「唯一」成立（`:703/:718` 只有码无报文）✓。
- `companion/src/security.ts:941`+`:950` — 「**两个**先天限制」下面列了三条，且第 2、3 条**都编号 ②**；`:940` 有笔误「已在 下方」。
- `companion/src/security.ts:1045-1046` 与 `companion/tests/classify-by-code.test.ts:279-282` — 同一段 SELECTOR_REQUIRED 理由的**两份副本不一致**：源码已改成 `` `chrome-extension/src/background/browser-bridge.ts:572`…（调用点 `:512`）``，用例仍是 `` `browser-bridge.ts:600`…`` 并保留 `:1214/:1660/:1735/:1738`。我逐条核过：`getElementCenter` 只有 5 个调用点（`:600` 无守卫、`:1214/:1660/:1735/:1738` 都带 `selector ? … : null` ✓），`SELECTOR_REQUIRED` 唯一产出点是 `browser-bridge.ts:2041`（`:2039-2041` 的抛点）——两份写法各说一端，意思不算错，但同一 PR 内两份不同步。
- `companion/src/security.ts:979-981` — 默认桶数组 `]`（`:978`）后仍有 **3 个连续空行**（第 3 轮 NIT，未处理）。
- `companion/tests/classify-by-code.test.ts:210` — `readFileSync("src/security.ts")` 用 **CWD 相对路径**（作者的 runner 在 `companion/` 下成立；从仓库根跑同一条用例会 ENOENT）。

**边界（不是本轮新增缺陷，仅如实标注）**：口径 ② 「只排除嵌入另一个错误值的码」并不足以支撑「零变更」——真正可证的不变量更弱：「**可静态确定的产出报文**等级不变；报文静态部分永不含 recoverable/security 词」。输入派生串仍可翻等级，例如 `WORKER_NOT_OWNED`（`companion-dispatch.ts:706` 的 `workerId`、`:942` 的 `wid`）、`PLAN_READONLY_BLOCKED`（`tool/plan-readonly.ts:160` 的 `toolName`）、`NO_ELIGIBLE_EXPERTS`（`orchestrator/expert-team.ts:479` 的 `invented`）、`INVALID_KEY`（`user-env.ts:235` 的 `name`）。这些需要模型/外部传入含 `not found`/`timeout` 之类的畸形值，我**不**计入 P0；另 `GRANT_CALLER_MISMATCH`/`GRANT_DENIED`/`GRANT_REQUIRED`/`PROFILE_FORBIDDEN` 只在 outbound-MCP 表面产出，不进 `classifyError`（唯一生产调用点 `adapter.ts:2121` ✓）。

---

## 未能验证

- 本机无 `gh`：作者的 PR 正文/回复文件不在树上，故「用你原样的突变验证 1 红」这句**原文**我核不到，只核到结果（带空格变体 1 红、不带空格变体 0 红，见 NIT-1）。
- macOS 侧 `darwinEstopOk.reason` 的另一条翻转来源（`computer/darwin-estop.ts:296-302` 把 `stderrBuf` 前 400 字拼进 reason）：机制成立，但我没有实测到一条**确定**含 recoverable 词的 host-stderr 串，故 P0 只以 Windows 的 `estop.ts:172` 为准（那条是确定性的，且被注释写成预期路径）。
- companion 全量测试未跑（只跑目标用例 + 门禁 + build）；本 PR 只动 `security.ts` + 该用例文件，`git status` 干净、HEAD = `c24fb930`（核对过 md5 还原）。

---

## 上一轮 2 个 P0 + 1 个 P1 是否已修（逐条）

| # | 上轮发现 | 本版结论 |
|---|---|---|
| P0 | `SPAWN_INTENT_FAILED`（`companion-dispatch.ts:325-326`）嵌 `intentClaim.error` → 未声明收紧 | **已修 ✓（用「整类移出」的方式）**：`security.ts` 里该码只出现在注释 `:948`，**不在桶也不在显式表**；`classifyError` 函数体 base↔head 逐字节相同 ⇒ 行为与 main 完全一致（我实测同一报文 base=head）。**但**「整类」没收干净：`EMERGENCY_STOP_UNAVAILABLE` 同类且仍登记（见 BLOCKING）。 |
| P1 | `SETTINGS_REQUIRED`（`settings-pointer.ts:65-67`）嵌 `baseError` | **已修 ✓**：同样只出现在注释 `:949`，不登记 ⇒ 不变。 |
| P1 | 守卫是恒真式（我上轮突变 → 0 红） | **主体已修 ✓ / 残留 ✗**：新守卫 `tests:206-219` 从源码文本取显式条目 ∩ 默认桶，**不再恒真** —— 我用上轮脚本原样突变（`", "` 形态）复现 **1 红** ✓；但按我上轮**报告里逐字引用的写法**（无空格）仍 **0 红**，多行/行尾追加亦 0 红（见 NIT-1）。 |
| 上轮附带 P1 | `tests:96` 陈旧「8 条」、`:111-112` 被推翻的因果 | **未修 ✗**（本 diff 仍在，`tests:97` / `:112-113`，见 NITS）。 |

**其余声明核对**：`110 = 43 显式 + 60 默认桶 + 7 image 族` **独立复现完全成立 ✓**（AST 数：显式字面量条目 43、桶 60 去重后 60、image 7；三组**两两无重叠**、组内无重复；`ERROR_CODE_LEVELS.size = 110`）；`显式表∩image = ∅` ✓；「全仓 `classifyError` 只被 `adapter.ts:2121` 调用」✓；「单 `SUMMONER_ACL` 就达 20+ 处」✓（我数出 **23** 个带码产出点 / 35 次提及）；12 用例全绿且两处新用例**都有牙**（M1 整体翻转桶 → 1 红；M3 显式表塞桶内码 → 1 红；基线 0）；`npm run build` / 门禁 156/0 ✓。**claim「零变更 / 有意变更全部是放宽（无收紧）」不成立**（见 BLOCKING P0）。

**总评**：本版的系统性做法方向对，且是真的结构性改进 —— 那 6 个码确实被收干净，base 行为可证不变，守卫也不再恒真，registry 计数与措辞大体可复现。但同一病根第五次咬在同一处：作者的新扫描只认直接插值的 `X.error`，漏掉了**经对象属性二次携带的** `estop.reason`，于是 `EMERGENCY_STOP_UNAVAILABLE` 仍以 `non_recoverable` 入桶，把「打包版缺 host-scripts-win」这个**有注释背书的一等路径**从「换路继续」变成「整轮终止」。修法很小（移出桶 / 或改 `recoverable` 并在 ② 段声明），改完可直接复核通过。

VERDICT: REJECT
PI_EXIT=0
