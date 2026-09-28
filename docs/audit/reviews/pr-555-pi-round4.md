已独立核实（只读；tracked 文件零改动，基线对比用的临时 checkout 已还原并重编译，复核 12/12 绿）。完整记录写入 `docs/audit/reviews/pr-555-pi-round4.md`（新增未跟踪文档）。

**1. 分支位置/写法** ✅ `security.ts:933-935`，紧接 `BROWSER_UNAVAILABLE`、在 `security block`（:966）之前，形状与 `HANDBACK_*`/`TAB_*` 同型，注释风格一致。

**2. 与文案解耦：实测恒定** ✅ 对我自己编译的 `security.js` 打表，两 code × 10 种文案（含 `Security Block: page says halt`、`blocked by user`、`cookie domain mismatch`、塞满 `timeout/not found/attach failed`）全部 `recoverable`；同文案换未登记 code 则随文案变（含 `security`）。`classifyError('Security Block: whatever')` 无 code 仍 `security`。

**3. 反向破坏：无** ✅ 家族 7/7；全仓 grep 生产侧只有 `browser-bridge.ts:1684/1692` 产出这两码。更硬的一条：把三个文件退回 `61f19468` 跑**全量**，与 HEAD 失败名集合 diff → `IDENTICAL_FAILURE_SETS`（零新增零修复）。另确认 code 不会在链路丢失（`executeInner` 外层 catch 用 `/^([A-Z][A-Z0-9_]+):/` 重建 `data.error_code`；`handleToolResult`/`finishAndResolve` 原样透传）。

**4. 突变独立复现** ✅ 条件改 `if (false)` → **恰 4 条红**（3 条靠 code + 1 条「形态恒定」），同突变下家族文件仍 7/7；还原 12/12。

**5. 新问题：无** ✅ 你的担心不成立——这两码只由 `wait_for` 产出，`WAIT_PROBE_FAILED` 的 message 是 `probeFailureMessage()` 的我们自己的字面量、`WAIT_TIMEOUT` 是模板+selector，页面无法设置 `error_code`；伴生 `"Security Block:"` 生产者全在 companion 且都不设这两码；唯一消费点仍 `adapter.ts:2121`。实测「不可信域+cookie 文案」由 `security`→`recoverable` 属误报消除（该文案只来自 LLM 的 selector），控制组无 code 仍 `security`。

**6. 回归** ✅ 新文件 5/5、家族 7/7、门禁 `156 passed, 0 failed`。⚠️ 全量数字不符：我实测 **62 条失败 / 68 唯一失败名**（4 636+675 用例，两次一致），非 70 —— 结论（相关 0 条）成立，但这是第三轮已点过的照抄。

**NITs（非阻塞）**：① commit body 的 70 → 建议改成「与父提交失败集合逐名相同」；②「四形态」建议补一条 `Security Block: …` 形态（正是抢占风险面）；③「单一判定路径」只被单向钉住——注销分支必红，但把两条子串加回表则 0 条红，可选加守卫。

VERDICT: APPROVE_WITH_NITS
��
  `wait-for-probe.test.ts`。**无其它测试依赖这两条子串**。
- 更强的一条（比「失败集合构成」硬）：我把三个文件整体退回 `61f19468` 跑**全量**，与 HEAD 全量做
  失败**名字集合** diff → `IDENTICAL_FAILURE_SETS`（两侧均 `4636+675` 用例、`57+5` 断言失败、`68` 个唯一失败名）。
  即：本提交**零新增失败、零修复**。
- 结构性补充（承诺「生产路径仍然带 code」）：`executeInner` 的外层 catch（`browser-bridge.ts:207-210`）
  会用 `/^([A-Z][A-Z0-9_]+):/` 从 message 前缀重建 `data.error_code`；`handleToolResult`
  （`companion/src/ws/tool-forward.ts:177-199`）+ `forwardToolToExtension.finishAndResolve` 原样透传 `result`（只对
  list_tabs/navigate/create_tab/close_tab 动 `data`），适配器唯一消费点 `adapter.ts:2121-2129` 读
  `error_code || data.error_code`。所以「code 丢在链路上」不构成新的终止风险。

## 4. 突变：注销显式分支 → **4 条红**，独立复现 ✅

把条件改成 `if (false)` → 重编译 → 跑两个文件：

```
✖ WAIT_PROBE_FAILED is recoverable from error_code alone (message fully neutral)
✖ WAIT_TIMEOUT is recoverable from error_code alone (message fully neutral)
✖ emitted form (with the coded prefix) is recoverable too
✖ verdict does not depend on the message shape at all
ℹ pass 8 / fail 4          （同一条突变下 web-act-loop-wave1.test.js 仍 7/7 绿）
```

与你的 4 条一致（上一轮是 2 条）。注意其中 3 条靠 code 生效、第 3 条同时证明「子串条目确已移除」
（`WAIT_PROBE_FAILED: selector probe failed…` 不再被子串救回）。还原后 12/12。

## 5. 有无新引入问题 ✅（重点查了你问的 security 抢占）

- `security block` 检查（:966）确实在显式分支**之后**；但这两个 code **只由 `wait_for` 产出**
  （全仓 grep 仅 `browser-bridge.ts:1684/1692`），而这两处的 message 不可能承载真实安全信号：
  `WAIT_PROBE_FAILED` 的 message 是 `probeFailureMessage()` 的**我们自己的字面量**（页面原文只走
  `page_text_untrusted`，第 2、4 步与第三轮已确认），`WAIT_TIMEOUT` 是模板 + `JSON.stringify(selector)`。
  页面无法设置 `error_code`。→ **不存在「本应 security 被判 recoverable」的现实路径**。
- 伴生的 `"Security Block:"` 生产者全在 companion 侧（`mcp/dispatch.ts`、`tool/{file-url,image-fetch,url-cookie}-admission.ts`、
  evaluate 闸门），**没有任何一处设置这两个 code**；`classifyError` 的唯一生产调用点仍是 `adapter.ts:2121`。
- 顺带观测（非缺陷）：同 code + 不可信域 + 含 `cookie` 文案时，判定从 `security` 变为 `recoverable`
  （因为码分支在域检查之前）。`wait_for` 不触 Cookie、且该文案只可能来自 LLM 给的 selector 字面量，
  属于误报消除，不是语义丢失。控制组（去掉 code）仍 `security`。
- 其它：`BROWSER_UNAVAILABLE` 仍在最前且 code 互斥；三处改动不涉及 extension 生产码；
  未发现新的顺序/优先级冲突。

## 6. 回归数字（独立重跑）

| 声明 | 我实测 |
|---|---|
| 新文件 5/5 | ✅ 5/5（`classify-error-wait-for-codes.test.js`） |
| 家族文件 7/7 | ✅ 7/7 |
| 全量「70 条失败、相关 0 条」 | ⚠️ 数量不符：我实测 **62 条断言失败 / 68 个唯一失败名**（`4636+675` 用例，两次跑一致），`grep -Ei 'classify|security|probe|act-loop'` 命中 0（唯一形似命中是 `setupGracefulShutdown awaits …SIGTERM`，见 `await`）。**结论仍成立**，但数字是第三轮的 70，第三轮评审已提醒过别照抄 |
| 打包门禁 156/0 | ✅ `bash scripts/tests/test-package-gates.sh` → `156 passed, 0 failed` |

---

## NITs（非阻塞，均不影响本轮结论）

1. **commit body 的失败计数仍是 70**（实测 62/68），且这是第三轮已点过的同一条；建议改为
   「62 条失败 / 68 唯一失败名（两侧与 61f19468 逐名相同）」，或直接写「与父提交失败集合逐名相同」——
   后者的证据强度远高于条数。
2. **「四形态」用例可以再加一条 security 形态**：现在列的是 `""` / 中性 / 带前缀 / 塞满既有子串，
   没有 `Security Block: …` 或 `blocked by user`。那正是你关心的「抢占 security」风险面，虽然
   extension 侧 `wait-for-probe.test.ts` 已钉住页面文本回 message 的用例，companion 侧补一条更贴近语义。
   （我手工打表已确认它是 recoverable，缺的只是回归钉子。）
3. 可选：显式分支的「单一判定路径」不变式只被单向钉住——注销分支必红（4 条），但**有人把两条子串
   再加回 recoverable 表则 0 条红**（判定结论不变，只是恢复成冗余双路径）。若在意，可加一条
   「子串表不含这两条」的守卫断言。

---

## 结论

两条建议**真采纳且落地到位**：判定已与文案形态解耦（打表恒定），家族清单归位正确，突变从 2 条升到 4 条，
全量失败集合与父提交逐名相同（零新增），门禁 156/0。未发现新引入缺陷，第 5 问（security 抢占）
经生产者枚举 + 控制组实验排除。剩余仅为文档数字与可选测试形态两处 NIT。

VERDICT: APPROVE_WITH_NITS
PI4_EXIT=0
