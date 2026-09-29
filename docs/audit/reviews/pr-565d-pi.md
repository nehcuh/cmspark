diag: pi=/c/nvm4w/nodejs/pi
## 验证方法（先说清做了什么）

- 自写 AST 扫描器（`companion/node_modules/typescript` 5.9.3）：扫 `companion/src` + `chrome-extension/src` 共 **617 文件**；三条独立通路 ——（a）`error_code:` 对象字面量（236 站点，含 `data:{…}` 向上找兄弟 `error`）；（b）**全部 66 个桶内码的字面量出现点 222 处**逐条列上下文；（c）模板串 `\${动态}` 跨 30 处（**这一条是抓 P0 的关键**）。
- 用 `ts.transpileModule` 把 **base = `main` 的 `security.ts`** 与 head 各自跑起来，对每个 (码, 报文) 对独立求 before/after（不依赖作者的脚本/计数）。
- 实跑：`npm run build` ✓、`tsc -p tsconfig.test.json` + 目标用例 **11/11** ✓、`test-package-gates.sh` **156/0** ✓、extension `npm test` **1498/1498** ✓、**10 处突变**（含 M2′/M9 两处针对「加固守卫」的突变，逐轮重编译）。

---

## BLOCKING（必须修才能合）

- **[P0] `companion/src/tool/companion-dispatch.ts:325-326` — `SPAWN_INTENT_FAILED` 是本版**新的一处收紧**，「收紧 0」不成立（而且触发条件是**日常模型错误**，不是窄竞态）。**
  链条（逐行核实 + 运行时可复现）：
  1. `spawn_worker` 带 `intent_id`（模型参数，`companion-dispatch.ts:227-229`）→ `claimIntent`（`:288`）；
  2. 失败时 `companion-dispatch.ts:325` 把 **`intentClaim.error` 原样嵌进报文**，并在 `:326` 把码**硬改成** `SPAWN_INTENT_FAILED`（丢掉上游码）；
  3. `intentClaim.error` 的取值来自 `board/intent-claim.ts:120`（`error_code: result.error_code || "CLAIM_FAILED"`，`error: result.error`），而它的**普通**失败报文含可恢复子串：
     - `intent-claim.ts:79` → ``intent not found: ${intentId}``（**模型传了板上不存在的 intent id** —— 作者自己在 `companion-dispatch.ts:302-304` 写明 intent id「**typically model-invented**」）
     - `intent-claim.ts:75` → `worker already holds N intents`（命中 `"already holds"`）
     - `intent-claim.ts:67` → `board host not found or not a host thread`、`service.ts:172` → `host thread not found: X`（命中 `"not found"`）
  4. 消费点 `llm/adapter.ts:2121-2126`：`classifyError(toolResult.error || "", { error_code: data.error_code })` → `:2137 shouldStop = true` / `:2138 terminal = "security_halt"`。
  **实测**（我把 base/head 两个 `security.ts` 都真跑起来）：

  | 报文 | base | head |
  |---|---|---|
  | `spawn_worker rolled back: intent claim failed — intent not found: int_1` | **recoverable** | **non_recoverable** |
  | `… — host thread not found: th_1` | recoverable | non_recoverable |
  | `… — board host not found or not a host thread` | recoverable | non_recoverable |
  | `… — worker already holds 3 intents` | recoverable | non_recoverable |

  即：同一个 `intent not found` 失败，走 `board_claim_intent`（`companion-dispatch.ts:748`，码 `INTENT_NOT_FOUND`，本票刚登记为 **recoverable**，`security.ts:1078`）时继续整轮；走 `spawn_worker` 时**整轮终止**。
  声明与代码冲突：`security.ts:1064`「本批的**有意变更全部是放宽（无收紧）**」、`:939` 收录口径「产出报文在登记前与登记后等级一致（零变更）」，桶内 `SETTINGS_REQUIRED/SPAWN_INTENT_FAILED`（`security.ts:969-970`）**没有**任何逐条声明。修法一行：`SPAWN_INTENT_FAILED` 改 `recoverable`，或保留上游码，并在 `security.ts` 逐条声明。

- **[P1] `companion/src/capability/settings-pointer.ts:65-67` — `SETTINGS_REQUIRED` 是第二处未声明的收紧（报文由**别的码**拼成）。**
  `:65` 把调用方的 `baseError` 原样放进报文首行，`:67` 钉 `error_code: "SETTINGS_REQUIRED"`。而 `baseError` 的静态来源含可恢复子串 `module_disabled`：`capability/modules.ts:70` / `netsec/scope.ts:135`（`module_disabled:netsec — enable in settings (modules.set_enabled) before use`），产出点 `netsec/scan.ts:86`、`tool/l2-admission.ts:1023`。
  **实测**：`classifyError("module_disabled:netsec — …\nsettings_path: 设置 → 本机与工具 → 网络扫描（NetSec）", {error_code:"SETTINGS_REQUIRED"})` → base **recoverable** / head **non_recoverable**。
  同文件 `settings-pointer.ts:52-54` 自己写着「keeps its original first line (… **classifyError patterns are untouched**)」—— 登记后这句也不再成立。（`allowlist_empty` 那条不命中子串表，零变更 ✓。）

- **[P1] `companion/tests/classify-by-code.test.ts:152-157` — 宣称「已补守卫」，但这个守卫是**恒真式**，一行验证力都没有。**
  `:155` 的 `explicitKeys` 定义即「`ERROR_CODE_LEVELS` 的键 **减去** 默认桶」，`:156` 又去筛「在默认桶里」→ 交集恒为空，断言永不失败。它挡不住它自己注释（`:152-154`）里描述的那一手 —— 我按注释原样复现：
  - M2′：在显式表 `["BOARD_HOST_INVALID","recoverable"],` 后插 `["THREAD_REQUIRED","recoverable"],`（不改 EXPECTED）→ **`fail=0`**
  - M9：换一个桶内码 `["TOOL_NOT_OFFERED","recoverable"],` → **`fail=0`**（末尾 spread 静默覆盖，等级仍是 `non_recoverable`）
  （对照：真的加进 `EXPECTED_LEVELS` 会被 `:150-151` 的 overlap 守卫抓到 → `fail=2`/`fail=1`，说明能抓的只有那一半。修法：把 `:155` 换成从**源码文本/AST** 取显式条目，或直接在 `:156` 用 `[...ERROR_CODE_LEVELS.keys()]` 交集默认桶。）

- **[P1] `companion/tests/classify-by-code.test.ts:111-112`（+`:96`）— 上一轮 P0-2 的**被推翻的因果**仍留在同一 PR 的登记注释里，且与 `security.ts` 自相矛盾。**
  `:112` 仍写「但 `classifyError(:2121)` 在该块**之外**，故此前判 non_recoverable 会让整轮 `security_halt` 终止」；AST 实测 `if (!proposeDenied) {`（`adapter.ts:1994`）then 分支 **1994–2234、无 else**（`hasElse=false`），**包含** `classifyError`(2121)，即这两个码今天**到不了**分类器。而源码 `security.ts:1102-1110` 已按 AST 事实改写成「运行时**中性**…今天到不了 `classifyError`」—— 两处登记注释互相打架，作者只改了源码那处。
  另 `:96`「#563 A 批：**8 条**『等级随文案漂移』的码」—— 其下实际 **15** 条（`:97-121`），claim 4/10「已改为不带脆弱计数的表述」不成立（这是本 diff 内的陈旧数字）。

---

## NITS（非阻塞）

- `companion/src/security.ts:977-978` — 默认桶数组 `]`（`:975`）后仍有 **3 个连续空行**（上一轮 NIT，未处理）。
- `companion/src/security.ts:1105` — 行号 off-by-one：实际 `shouldStop = true` 在 `adapter.ts:2137`、`terminal = "security_halt"` 在 `:2138`（注释写 2136/2137）；`if (!proposeDenied)`:`1994`、区间 `1994–2234`、`classifyError`:2121 均 ✓。
- `companion/src/security.ts:1044` — `locator-classify.ts:64-71` 指的其实是 `planLocator` 的返回与 `isInvalidSelectorMessage`；`presentLocator` 的非空保证在 **`locator-classify.ts:8-12`**（调用点 `:62/:64`）。括号里的 `chrome-extension/src/background/browser-bridge.ts:572`/`:512`/`:603` 我逐条核过 ✓。（**更正我自己上一轮**：上轮我把这个区间判成「正确」，是漏检。）
- `companion/src/security.ts:1096` — `["CLAIM_FAILED", "recoverable"],` 之后同一行就接了 `⚠️ SUMMONER_ACL / SUMMONER_L0 → …` 的说明，两码的备注挂在别人行上，易误读。
- `companion/src/security.ts:939`+`:969-970` — 口径边界（**无运行时影响**，仅提示）：桶内码的报文若含**输入派生串**也会翻等级，例如 `INVALID_KEY` 的报文嵌 key 名（`user-env.ts:236`，`Invalid key "MY_TIMEOUT": …` → base `recoverable`/head `non_recoverable`）。今天 `user-env` 只走 WS/HTTP 表面、不进 `classifyError`（全仓唯一调用点 `adapter.ts:2121` ✓ 已核），故不构成本次阻塞，但「桶内 66 条全零变更」这句话无法按报文静态验证。

## 未能验证

- #563 的 issue 正文与那几份「留给 #563」的清单（本机无 `gh`），因此「桶内本该 recoverable 的码交给 #563」**是否已被真实记录**无法核对；我只能核到源码里没有逐条理由。
- `SPAWN_PACK_FAILED`（`companion-dispatch.ts:272`、`expert-team.ts:554`，报文嵌 `packApply.error`）、`SPAWN_BRIEF_FAILED`（`:358`，嵌 `e?.message`）、`ORCHESTRATOR_GATE_ERROR`（`tool-pregate.ts:308`，嵌 `gateErr.message`）属**同一类**（嵌动态错误串）：我确认了机制与可产生 `not found` 类报文的既有生产者（如 `packs/pack-engine.ts:1599 thread not found`），但没触发到真实运行路径，故只按「同类风险」列出，不计入 P0。
- companion 全量测试未跑（只跑目标用例 + 门禁脚本）；本 PR 只动 `security.ts` + 该用例文件，`git status` 干净。

## 上一轮 2 个 P0 + 3 个 P1 是否已修（逐条）

| # | 上一轮发现 | 本版结论 |
|---|---|---|
| P0-1 | `CLAIM_FAILED` 是收紧 | **已修 ✓**：`security.ts:1095-1099` = `recoverable`，且我独立复算 `host thread not found: X`（`service.ts:172` → `intent-claim.ts:120`）base/head 均 recoverable ✓。**但**同一个上游报文经 `spawn_worker` 被改码成 `SPAWN_INTENT_FAILED` 后仍是收紧（本轮新 P0）。 |
| P0-2 | `PROPOSE_REQUIRED`/`ALREADY_HAS_STEPS` 因果写反 | **源码已修 ✓ / 用例未修 ✗**：`security.ts:1102-1110` 与 AST 一致（1994–2234、无 else、含 classifyError）✓，连「顶层 `error_code` 会让守卫失效」的脆弱点也写对了 ✓；但 `tests:111-112` 仍是被推翻的那句（本轮 P1）。 |
| P1-1 | 5 个可静态验证的码被移出桶 | **已修 ✓**：`INVALID_KEY`/`OVERLAY_STANDBY`/`OVERLAY_SHELL_UNAVAILABLE`/`UI_COMMAND_UNKNOWN`/`POST_CONFIRM_CANCELLED` 全部回到桶内（`security.ts:964/967-968/972-973`），逐点复算 base=head=`non_recoverable`（含 `overlayError(code)` 的默认报文=码名一处）✓。 |
| P1-2 | 陈旧数字/坏文本 | **部分修好**：`100/99`、重复半句、`12 个显式条目`、`本仓 8 / pi 11`、「31 个未登记」等**已清或改写为下界** ✓（「单 `SUMMONER_ACL` 就达 20+ 处」我独立数出 **23** 个产出点，可复现 ✓）；但 `tests:96` 的「8 条」仍在（本轮 P1）。 |
| P1-3 | `BOARD_HINT_INVALID` 动态报文违反口径被移出 | **已修 ✓**：已不在桶内也不在显式表；相对 `main` 是 0 变更。 |
| NIT | 显式表塞「已在默认桶」的码 0 红 | **未修（声称修了）**：`:152-157` 加了守卫但恒真，M2′/M9 实测仍 `fail=0`（本轮 P1）。 |

**声明核对**：claim 8（`116 = 43 显式 + 66 默认桶 + 7 image`、无重复无重叠）**独立复现成立 ✓**；claim 9（突变 1/1/1/1、用例 11/11、extension 1498/1498、门禁 156/0）**成立 ✓**（我另跑 M1/M3/M4/M6 各 1 红、删码优先 7 红、基线 0）；claim 1/2/3/5 基本成立；**claim 6 不成立**（守卫恒真）；**claim 7「收紧 0 / 有意变更全为放宽」不成立**（两处未声明收紧，见 P0/P1）；claim 4/10 部分不成立（`tests:96`）。

**总评**：主体（66 条默认桶 + 43 条显式、守卫/突变/回归全绿、`CLAIM_FAILED` 方向修对）经独立复算成立；但本票的唯一交付物是「声明」，而**第三轮同一病根又咬了一次** —— 隐藏点在**动态/拼接报文**里：`SPAWN_INTENT_FAILED`（嵌 `intentClaim.error`）与 `SETTINGS_REQUIRED`（嵌 `baseError`）各把一条 base 可恢复的日常失败变成 `security_halt`。修法很小（2 个码改 `recoverable` 或保留上游码 + 逐条声明 + 挪走测试里那句被推翻的因果 + 让守卫不再恒真），改完可直接复核通过。

VERDICT: REJECT
PI_EXIT=0
