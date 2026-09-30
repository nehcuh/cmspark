diag: pi=/c/nvm4w/nodejs/pi
## BLOCKING

**无。** 三条都实修了，且我找不到新的阻塞项。下面每条都带**我实际跑过**的证据。

---

## NITS

**N1 [P2·建议本轮改] 声明边界比注释里的例子宽 —— 仍会累计的「拒执码」实测清单**

`companion/src/tool/site-op-memory.ts:34-48` 的边界句是诚实的（「其余一律累计，包括 `undefined`」），但**举例只举了参数缺失**（`scroll({})`）。我用探针（`.test-dist/src/tool/site-op-memory.js`，4 次 `recordSiteOpFailure` → 看 `getOriginFailCount`/`peekSiteOpBan`）实测仍会累计的码：

| 码 | 产出点 | 4 次后实测 | 类别 |
|---|---|---|---|
| `INVALID_SELECTOR` | `browser-bridge.ts:585-597`（模型给坏 CSS，zod 只要求非空串 `tool-schemas.ts:78`） | `originFails=4, clickBanned=true SITE_OP_ESCALATE` | 参数（非法） |
| `DOM_SCRIPT_LOOP_CAPPED` / `DOM_SCRIPT_VOLUME_CAPPED` | `tool/dom-script-budget.ts:88-93`，`adapter.ts:1786-1788` 在**工具执行前**返回信封 | 同上 | 机器预算（与已排除的 `SITE_OP_BANNED` 同形态，见 `adapter.ts:2167` 的 #425 约定） |
| `L2_ADMISSION_TIMEOUT` | `tool/l2-admission.ts:1176`（**所有** L2 工具都走该队列，`l2-admission.ts:1156-1170`；60s 排队超时 `orchestrator/l2-admission.ts:26`） | 同上 | 授权/编排 |
| `UNATTENDED_CONFIRM_DENIED` | `tool/l2-admission.ts:1625-1631`（`error_code` **和** `data.error_code` 都写了） | 同上 | 授权（用户/超时拒批） |
| **无码**：`"Invalid or expired security token for evaluate"` | `tool/l2-admission.ts:1887-1890` | `originFails=4, clickBanned=true`，且 `classifyError` 实测 **non_recoverable** | **授权 —— 与 #528 同形** |

最后一条值得点名：它是 `evaluate` 的**授权拒执**（模型的 token 过期/被回放；历史里 token 被脱敏成 `<redacted:hash=...>`，`history/store.ts:234-235`，模型照抄即失效），走 `failCode = undefined`（我实测 ` /^([A-Z][A-Z0-9_]+):/ ` 对该报文不匹配）→ 累计 → 封掉后续 click。**它与 #528 是同一类**，且修法是一行：该分支复用 `error_code: "EVALUATE_AUTH_REQUIRED"`（自动进入排除集，等级不变——实测带该码时 `classifyError` 仍 `non_recoverable`，与今天一致）。

我**不**因此判 BLOCKING，理由写在第 5 节判据里；但注释里的例子应补一句「含**无码的授权拒执**（token 过期/回放）」并把 #563 的补码清单写上这条，否则读者会以为残留只是 `scroll({})` 这种参数笔误。

**N2 [P2] 能力声明那句是「类级」措辞，代码注释才是「码级」**
`3aabaa54` 的 `## 能力声明`：`Trust: 减少误封（参数/授权拒执不再计入熔断：新增 WAIT_CONDITION_REQUIRED）`。括号把范围收在一个码上尚可辩，但主句「参数/授权拒执不再计入熔断」被 N1 的表格证伪。建议改成：「本票新增的 `EVALUATE_AUTH_REQUIRED`/`WAIT_CONDITION_REQUIRED` 不再计入熔断；其余码与无码失败仍按 CDP 健康信号累计（#563 收口）」。

**N3 [P2] 「双重排除」只有一层有牙（我上一轮 NIT，本轮未变）**
`adapter.ts:2018` 的子句删掉后**没有任何测试变红**（`site-op-memory.ts:402` 已早退，语义等价；本轮我确认新用例全在 `recordSiteOpFailure` 层，且全仓无 `NON_AGGREGATING` 的 source-lock）。要么加一条 source-lock（本文件已有先例：`tests/site-op-memory.test.ts:142-147`、`:437-440`），要么在 `adapter.ts:2016` 注释里写明「防御性冗余」。

**N4 [P2] 扩展前缀 ↔ companion 排除集是单向契约**
扩展侧用 `evaluate-code-integrity.test.ts:126-141` 钉住了前缀格式（我删掉 `EVALUATE_AUTH_REQUIRED:` 改名 → **恰好 1 红**，有牙）；但 companion 侧只用字面量 `"EVALUATE_AUTH_REQUIRED"`（`site-op-memory.ts:52`、测试 `:651`）。扩展改名时 companion 侧**静默留下死条目**且没有测试报警。建议加一条 companion-side 源码扫描/source-lock 断言该字面量在扩展产出点存在。

**N5 [P3] 新用例里 `SELECTOR_REQUIRED` 那半是「零独立验证力」**
`site-op-memory.test.ts:648-656` 对 `SELECTOR_REQUIRED` 断言「不累计」，而作者自己在 `site-op-memory.ts:58-60` 判定该码**不可达**（我独立复核成立，见第 4 节）。这与本仓先例（`#560` 删掉 SELECTOR_REQUIRED 的零验证力用例，见 `memory/session.md:58`）冲突。留着无害，但应标注为「意图登记」，别算进回归覆盖。

**N6 [P3] 残留的模型/用户可见 `osascript` 提及（均非「候选」，故不阻塞 `Closes #529`）**
- `loop/route-engine.ts:344`：`巡航档…跨类路线（host_computer/osascript）不进本档扇出` → 经 `buildUnlockContract.detail` → `loop/unattended-overlay.ts:220` 进 Board intent 描述。**我无法确认它能进 prompt**（`loop/loop-status.ts:70` 那条是面板报告），故降为观察。
- `bridge/tool-definitions.ts:89`：`OSASCRIPT_MACOS_ONLY_ERROR = "osascript_eval is macOS-only…"` 与 Rule 8「macOS 上也不可用」措辞矛盾；仅在模型**幻觉调用**时可见（`message-router.ts:5659`、`tool/companion-dispatch.ts:1312`、`tool/l2-admission.ts:288`）。
- 刻意保留的非模型面：`packs/validator.ts:25`（我核对 `getAllToolDefinitions()` 确为 pack 校验用）、`PacksPanel.tsx:131`、`SettingsSlideout.tsx:2604/2861/2922`（用户设置文案，现略陈旧）。全部 12 个 pack 的 `osascript_eval` 都在 **deny** 里（我逐文件扫过）⇒ 下架不削弱任何 pack。

**N7 [P3] 其它**
- `browse.md:77` 行尾多了一个空格（`". "` 收尾）；`:37` 的 `adapter.ts:704` 文案「removed from your tool list … **and is not in your tool list**」重复。
- `evaluate-code-policy.ts:48` 与 `:59` 长英文文案逐字重复（漂移面，上一轮 NIT 未处理）；且它是**用户可见**的（`adapter.ts:2130-2151` → `capability/user-gate-copy.ts` 无 evaluate 规则）。
- `tool-definitions.ts:92-99` 的 `shouldExposeOsascript` 现在**无生产调用点**（只有 `bridge.test.ts:374-376`），却仍被导出；建议让 `getToolDefinitions` 继续咨询它（单一事实源）或标注为 deprecated。
- `CHANGELOG.md:6` `## [Unreleased]` 仍为空，而本票有两处用户可见行为变化（macOS 下架 + 熔断语义），仓库惯例是要写（`0.6.10` 段落即例）。

---

## 未能验证

1. **#568 的内容**（无 `gh`/网络）。这很关键：`classifyError` 的修复需要**同时**做两件事 —— (a) 让该码进 `toolResult.error_code`/`data.error_code`（现在该拒绝是 `return`，只有 `browser-bridge.ts:224-228` 的 `catch` 会翻译前缀，**我核对了这段确实存在且只在 catch 里**），(b) 在 `ERROR_CODE_LEVELS` 登记。**只做 (b) 无效**（字段空 ⇒ `security.ts:1149` 永远查不到）；**只做 (a) 也无效**（我实测 `classifyError(msg,{error_code:"EVALUATE_AUTH_REQUIRED"})` = **`non_recoverable`**，因为该码未登记）。若 #568 只写了其中一半，它修不动。
2. **真机 macOS 的数字**「companion 失败 70」：本机 Windows 实测 **失败 62**（`tests 5335`），数字不复现；但**等价性**我逐条比过了（见下）。
3. #528 那 4 次真实 UI 事故本身（无 macOS/真实 Chrome）。我只验证了这些码**能**产生所描述的聚合与升级。
4. `route-engine.ts:344` 的 Board intent 描述是否进过任何 prompt。
5. 现场装旧版扩展（无前缀）时的兼容窗口行为。

---

## 上一轮 3 条是否已修（逐条）

**1. P0「点名死码、漏了活码」——已修（三块我逐条复核）**
- 活码补入 `WAIT_CONDITION_REQUIRED`，且我复核其一整条可达链：catalog `wait_for.required=["tabId"]`（我 `require()` 了 catalog 打印出来）→ `tool-schemas.ts:143-152` 明确**不** refine `selector|network_idle` → `tool/wait-for-params.ts:20` 保留显式 `false` → `wait-for-mode.ts:36-39` 判 `invalid` → `browser-bridge.ts:1764-1768` 产码。**突变1**（删该码）→ `#528b` 红（我复现，`1 !== 0`）。
- 死码标注独立复核**成立**：`SELECTOR_REQUIRED` 唯一生产者 `getElementCenter`（`browser-bridge.ts:2039-2041`），5 个调用点 `:600/:1214/:1660/:1735/:1738`——`:600` 在 `plan.kind==="css"` 分支内（`locator-classify.ts:64-65` 保非空），其余四个都写成 `selector ? … : null`；即便抛出，`:601` 的 `failInteractive(…,"ELEMENT_NOT_FOUND")` 经 `classifyInteractiveFailure`（`locator-classify.ts:85-103`）也永不返回该码。**附加证据**（作者没写）：companion 侧 zod refine（`tool-schemas.ts:81/87/109/115/121/129`）在到达扩展前就拦掉了「无 locator 的 click」。
- **兜底没动**（含 `undefined` 仍累计）：我**改判为可接受的取舍**，判据见下节。**突变2**（把判据正向化）→ `#528c` 红（我复现，`actual: 1, expected: 0` 类断言失败，1 红 43 绿）。

**2. P1「osascript 仍在模型可见文案里」——已修，我独立核实模型面已清**
- `getToolDefinitions` 探针：darwin/win32/linux 均 **75 个工具且不含 `osascript_eval`**；`JSON.stringify(getToolDefinitions("darwin"))` 里 `"osascript"` 出现次数 = **false**；`getAllToolDefinitions()` 仍含该条目（pack 校验稳定，`validator.ts:25-26` 复核）。
- catalog 全量扫描：**只有** `osascript_eval` 自己那条描述含该词，而它按 name 被过滤 ⇒ 不进模型。`loop_declare_blocked` 描述已改为 `(host_computer)`（我打印了实际下发给模型的描述确认）。
- `browse.md:37/45`：残留的两处措辞是「**no longer offered**/removed」，非候选；该文件确实进 prompt（`adapter.ts:760/836` → `skillPrompt`）。
- Rule 8 两分支（`adapter.ts:704/705`）都说 NOT available / NEVER call；`escalateGuidance`（`site-op-memory.ts:626-645`）与 `adapter.ts:2225` 的解锁文案已无 osascript。
- `bridge.test.ts:378-381` 两条断言**已恢复**，且 `origin/main`(b50f6dfc) 本来就有（`b50f6dfc:companion/tests/bridge.test.ts:375-377`）⇒「本提交误删」描述准确。
- `Closes #529` 成立（残留提及都不是「候选」）。

**3. P1「`EVALUATE_AUTH_REQUIRED` 走不到分类器」——作者的**精化正确**，我逐项实测**
| 侧 | 我验的 | 结论 |
|---|---|---|
| 熔断侧 | `adapter.ts:2007-2010` 确有 `/^([A-Z][A-Z0-9_]+):/` 兜底；扩展该拒绝是 `return`（`browser-bridge.ts:1829-1835`）⇒ 无 `data`，我构造该报文实测 regex 提取到 `EVALUATE_AUTH_REQUIRED` | ✅ **生效**，排除真的落地 |
| 等级侧 | `adapter.ts:2128-2134` 只读字段；实测 `classifyError(报文,{toolName:"evaluate"})` = **`non_recoverable`**，带码（未登记）也是 `non_recoverable` | ❌ 失效 ⇒ 整轮终止，与作者所述一致 |
| 「只登记修不了」 | 我核对：字段确实没有（`return` 路径 + 前缀翻译只在 `browser-bridge.ts:224-228` 的 catch） | ✅ 成立（但须补一句见「未能验证 1」） |
| 是否回归 | 旧报文同样实测 `non_recoverable` ⇒ **本 PR 未使这条变差** | ✅ 划界「不属本 PR」可接受（附 #568） |

**声明/测试核查（作者的新声明 4/5/6）**
- 突变：**#528b、#528c 我各自复现**；另加**突变3**（删 `EVALUATE_AUTH_REQUIRED`）→ `#528` 红；扩展前缀改名 → 契约测试红。三项全绿回位后 `site-op-memory` **44/44**。
- 计数：`bridge` **32/32**、extension **1499/1499**、门禁 **156 passed, 0 failed** —— 全部逐字对上。
- 「companion 唯一失败 = main 基线、相关 0」：我在 **`origin/main`(b50f6dfc) 的独立 worktree** 上跑全量（5331 tests / fail 62），与 head（5335 / fail 62）**失败清单逐条 `diff` 完全相同**（68 行 `✖` 完全一致，全是 Windows 平台类：`0o600` 权限、symlink EPERM、macOS vault bundleId 等）⇒ 等价性成立；绝对数 70 ≠ 我这里的 62（平台差），只作记录。
- over-claim 删除**恰当**：`git show 2a1ca91c -- chrome-extension/src/background/browser-bridge.ts` **diff 为空**（grep 命中的只有提交信息里的那两行文字）⇒ 旧提交「SELECTOR_REQUIRED 报错明确…」确实未实现。我另行扫描全文，**未发现别的 over-claim**；`文件:行号` 引用我抽查全对（`adapter.ts:2007-2010` ✅、`browse.md:37/44/76` ✅、`getElementCenter` 5 个调用点 ✅、catalog `required` ✅、`normalizeWaitForParams` 保留 `false` ✅、前缀翻译只在 catch ✅）。仅一处需要更正**我上一轮**的口径：`"Script injection failed…"` 在 `browser-bridge.ts:**465**`（非 466）。

---

## 判断题：合 / 仍不该合 / 该收窄 —— 选 **(A) 合**

**我的判据（P0 为何不再 BLOCKING）：**
1. **动机码全中**：本票真正要关的两个活码都关住了，其中一个（`EVALUATE_AUTH_REQUIRED`）我验到了「扩展报文 → regex 提取 → 排除集 → `recordSiteOpFailure` 早退」整条链；另一个（`WAIT_CONDITION_REQUIRED`）我验到「合法调用 → 产码 → 排除」，并有突变守住。
2. **正向化今天是**不安全**的（这是作者理由，我实测支持）**：真正属于「CDP/脚本健康」的失败**大量是无码的** —— `browser-bridge.ts:465` 的 `Script injection failed in both ISOLATED and MAIN worlds`（`safeEvaluate` 三路全败；`get_page_text`/`get_page_html` 经 `page-read-tools.ts:16/36` 直达，二者都在 `CDP_INTERACTIVE` 里）、`page-read-tools.ts:18/38/44` 的 `PAGE_READ_INVALID_RESULT`（**无冒号**，companion 的 regex 抓不到）。我实测这些 `undefined` 情形**今天会正常累计并升级**；一旦改成「只有已知 CDP 码才累计」，这些真实信号会**静默消失**。所以「反向排除 + 声明取舍」在当前编码覆盖度下是**更安全的方向**，而不是偷懒。
3. **残留是「声明过的、方向安全的」**：`site-op-memory.ts:41-48` 明写「其余一律累计，含 `undefined`」，多累计的后果是把模型导向 `host_computer`（要人工确认），不是数据/安全损失；且注释已指定收口路径（#563 补码 → 届时正向化）——这正是我上一轮要求的修法之一，作者选了 B 并声明了边界。

**为什么不是 (C) 收窄**：#528 的修复经我验证对两个活码真实生效，收窄会把已到手的收益退回，且 osascript 与 528 无耦合，没有「半成品混入」的收窄理由。**为什么不是 (B)**：我找到的都是 NIT 级（边界措辞、无牙的冗余层、零验证力用例、陈旧 UI 文案、CHANGELOG），**没有一项使这次改动变成错的或危险的**；N1 里那条「token 过期/回放的无码授权拒执」虽与 #528 同形，但它是作者**已声明的**无码残留（含在「其余一律累计，包括 undefined」内），且一行即可收口——建议**合入后立刻在同一线程处理或写入 #563 清单**，不建议为它再压一轮。

**给作者的三件事（合入前顺手改即可）：** ① 能力声明那句收窄为「本票新增的两个码」；② `site-op-memory.ts:41-48` 的边界例子补上「无码的**授权**拒执（`l2-admission.ts:1887-1890`）」并写进 #563；③ `#568` 明确列出两半（populate 字段 + 登记等级），否则修不动（实测依据见「未能验证 1」）。

VERDICT: APPROVE_WITH_NITS
PI_EXIT=0
