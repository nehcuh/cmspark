diag: pi=/c/nvm4w/nodejs/pi
I've finished the pass. Everything below was executed on this machine unless labeled otherwise.

---

## BLOCKING（必须修才能合）

- **[P0] `companion/src/tool/site-op-memory.ts:43-46` — 排除集点名了「死码」，漏了活码；`UNKNOWN` 兜底仍然计数 ⇒ 「参数拒执不再计入熔断」这一类**没有**被关上。**

  三块证据（都实测/逐行核）：
  1. **`SELECTOR_REQUIRED` 在现树不可达。** 唯一生产者是 `chrome-extension/src/background/browser-bridge.ts:2039-2041`（`getElementCenter` 收到 falsy selector）。5 个调用点全部传真值：`:600`（在 `plan.kind==="css"` 分支内，而 `locator-classify.ts:64-65` 保证 selector 是非空 string）、`:1214`/`:1660`/`:1735`/`:1738` 都写成 `selector ? await ... : null`；即便抛了，`:601` 的 catch 也会经 `classifyInteractiveFailure`（`locator-classify.ts:85-103`，永不返回 `SELECTOR_REQUIRED`）改写为 `ELEMENT_NOT_FOUND`。⇒ 这一半「双重排除」是空转。
  2. **活码仍在计数（实测）**：`wait_for({tabId, network_idle:false})` 是**完全合法**的模型调用（catalog `wait_for.required=["tabId"]`；zod 无 refine，`tool-schemas.ts:145-157`；`normalizeWaitForParams` 明确保留显式 false，`tool/wait-for-params.ts:18-22`；扩展侧 `wait-for-mode.ts:40-41` + `browser-bridge.ts:1765-1768` 产出 `WAIT_CONDITION_REQUIRED`，带 `data.error_code`）。实测 4 次：`originFails=4`、`originEscalateDue=true`，随后一个普通 `click` 被 `SITE_OP_ESCALATE` 拒执。
  3. **`failCode === undefined` 是故意放行的**（`companion/src/llm/adapter.ts:2018` 的 `failCode === undefined ||`），落到 `site-op-memory.ts:387` 的 `code = errorCode || "UNKNOWN"` ⇒ 仍然累计。实测 4 次 undefined → `originFails=4` → 同 origin 后续 CDP 工具被 `SITE_OP_ESCALATE` ban。可达例子：`scroll({})`（`scroll` 无 zod schema → `GENERIC_FALLBACK = z.record(z.unknown())`，`tool-schemas.ts:419`；catalog 的 `required` 只是给模型看的），adapter 只把 `pinned_tabs[0]` 注入 `tabId`（`adapter.ts:1727-1730`，可能为 undefined），扩展 `getTabId` 抛 `"tabId is required"`（`browser-bridge.ts:468-470`）无码 → UNKNOWN。

  **触发条件/影响**：正是 #528 的事故形态（多次参数拒执 → origin 升级 → 本该成功的 selector 主路径被拒）。提交把根因叙述成「没有码 → UNKNOWN → 计入」，但实现只对**一个**码做了特例，把「无码即计入」的兜底原样留着。修法很小：把判据反转为**正向**谓词（只有已知 CDP 健康信号码才累计），或补进活的参数拒执码（`WAIT_CONDITION_REQUIRED` 等）并停止放行 undefined——这也正是 #563「补码 × `ERROR_CODE_LEVELS`」的方向。

- **[P1] `companion/src/llm/adapter.ts:2018` / `:2130-2156` — 「参数/授权拒执 = 模型可自修」在运行时对 `EVALUATE_AUTH_REQUIRED` 不成立；而且提取者自陈的遗留（登记进 `ERROR_CODE_LEVELS`）**修不了**这条路径。**
  - 实测：对 HEAD 产出的真实报文 `classifyError(msg)` = **`non_recoverable`**（无 ctx / `{toolName:'evaluate'}` / 带 `error_code` 三种都试过）→ `adapter.ts:2135-2156` 立刻 `shouldStop=true` + `break`，**走不到** `:2167` 的 recoverable 回喂。新加的「prefer get_page_text…do not count this against the page」是写给模型的，而本回合模型拿不到它。
  - 登记无效的原因：该拒绝是 **`return`**（`browser-bridge.ts:1831-1835`），不是 throw，因此扩展的「前缀 → `data.error_code`」翻译（只在 catch 里，`:222-228`）不会执行；`classifyError` 只读 `error_code` 字段（`adapter.ts:2130-2135`、`security.ts:1149`）⇒ 登记在表里也永远查不到。要真「可自修」，生产者得走 `codedToolError` 式（`locator-classify.ts:43-53`）或让调用点解析前缀。
  - 已核实 `EVALUATE_AUTH_REQUIRED` 确实未登记（`ERROR_CODE_LEVELS.get(...) === undefined`，表 size 109）。

- **[P1] `companion/builtin-skills/browse.md:37,44,76` + `companion/src/bridge/tool-definitions-catalog.json:809` — `osascript_eval` 仍在**模型可见**文案里被列为候选。**
  - `browse.md:44` 表格仍写 `macOS | … | osascript_eval (AppleScript JS) — LAST RESORT only`，`:37` 写「macOS only (last resort)」，`:76` 仍提；skill 内容会进 prompt（`adapter.ts:760/836/1299` 的 `skillPrompt`）——与本次新写的 Rule 8「NEVER call it」（`adapter.ts:704`）直接矛盾。
  - `tool-definitions-catalog.json:809`（`loop_declare_blocked` 描述）仍写「directed route (host_computer / osascript_eval)」，而它经 `getToolDefinitions` 原样进模型（过滤只按 name，`tool-definitions.ts:127`）。
  - 这两处正是 `7db41447` 的清理项（`git show 7db41447 -- companion/builtin-skills/browse.md companion/src/bridge/tool-definitions-catalog.json`），提取时漏了 ⇒ **`Closes #529` 提前了**。附：`chrome-extension/src/sidepanel/components/PacksPanel.tsx:131` 场景白名单 UI 仍列该工具（非模型面，观感问题）。

## NITS（非阻塞）

- `companion/tests/bridge.test.ts:373-380` — 本提交**删除**了两条 main 上已有的断言（`shouldL2GateOsascript("win32") === false`、`OSASCRIPT_MACOS_ONLY_ERROR` 的 `/macos-only/i`），正是 `7db41447`（NIT）恢复的那两条。darwin 上无替代覆盖（`security-gates.test.ts:1122`、`security-thread.test.ts:231-234` 都按平台跳过），`macos-only` 又是有语义的子串（`security.ts:1204`）。建议补回。
- 提交/PR 文案「`SELECTOR_REQUIRED` 报错明确『缺参数，不是封禁，补 selector 重试』」**未实现**：全仓 grep `不是封禁|补 selector` 只命中评审 prompt 自己；`2a1ca91c` 对 `browser-bridge.ts` 的 diff 为空，该报文前后逐字节相同（`browser-bridge.ts:2041`）。属于 over-claim（且按 P0，这个码本就死）。
- `companion/src/llm/adapter.ts:2018` — 「双重排除」只有一层有牙：我删掉 adapter 那一条子句（M2）后**全量 companion 一次不红**（失败集与基线逐条相同），因为 `site-op-memory.ts:386` 已对它早退。要么补集成覆盖，要么删掉冗余层。
- `CHANGELOG.md:6` — `## [Unreleased]` 为空；姊妹提交 `c2521847` 专门为 #528/#529 写了条目但没提取，而本次有两处用户可见行为变化（macOS 工具下架、站点熔断语义）。仓库惯例是写的（`b5a7396a`）。
- `chrome-extension/src/background/evaluate-code-policy.ts:47-53,58-64` — 两处拒绝文案字面量重复（漂移面）；且这段长英文、面向模型的文案会**原样给用户看**（`adapter.ts:2135-2151` → `capability/user-gate-copy.ts:42-51,186-187` 无 evaluate/security_token 规则）。
- `companion/src/bridge/tool-definitions.ts:92-99` / `companion/src/bridge/companion-tools.ts:14` / `companion/src/loop/tier-bind.ts:54` — schema 下架 ≠ 能力移除：macOS 上模型幻觉出的 `osascript_eval` 仍会执行（`shouldL2GateOsascript` 仍 darwin-true，`l2-admission.ts:287`），`COMPANION_TOOLS` 与 `osascriptAvailable` 仍是活路径/死标志。若这是有意的，PR 措辞应说「不再提供」，别暗示「移除」。
- 命名漂移：`SITE_OP_FAIL_ESCALATE` 全仓不存在；实际码是 `SITE_OP_ESCALATE`（`site-op-memory.ts:332`），阈值常量是 `SITE_ORIGIN_FAIL_ESCALATE`（`:30`）。

## 未能验证

- #528 那 4 次真实 UI 事故本身（无 macOS/真实 Chrome 环境）；我只验证了这些码**能**产生所描述的聚合与升级。
- 提取者声明「companion 全量唯一失败 **70** = main 基线」：本机实测 `tests 5333 / pass 5255 / fail 62`（57+5），数字不复现；我**没有**在同一机器上跑 main 构建逐条比对，只核到「失败清单里没有任何一条与本提交触碰的文件相关」（逐条看过 + 两个直接相关测试文件单独绿）。
- 原分支（落后 52 提交）上的 5296/5271/0 与 extension 1459/1459/0 —— 基不同，无法复核。
- 现场装着**旧版扩展**（不带前缀）时的兼容窗口行为 —— 只能在实机验证。
- macOS 上模型幻觉 `osascript_eval` 的实机执行结果（仅代码推断）。

## 已核实为正确的声明

1. `EVALUATE_AUTH_REQUIRED:` 前缀在两条拒绝分支都加了（`evaluate-code-policy.ts:48,59`），companion 的 `^([A-Z][A-Z0-9_]+):` 提取（`adapter.ts:2007-2010`）确实只吃 error 字符串（该路径无 `data.error_code`，`browser-bridge.ts:1834` 是 return）——扩展契约测试**有牙**（M4 去掉前缀 → 1 红）。
2. `recordSiteOpFailure`（`site-op-memory.ts:386`）与 adapter 调用点（`adapter.ts:2018`）两处判据**确实都存在**，语义等价；全仓唯一生产调用点就是 `adapter.ts:2020`，`originFails` 除 `recordSiteOpFailure` 外只有 `hydrateOriginCdpFails` 恢复写（`site-op-memory.ts:276-284`）——**无绕过路径**。
3. `getToolDefinitions` 全平台过滤（`tool-definitions.ts:121-127`）、`shouldExposeOsascript` 恒 false；测试有牙（M3 恢复 darwin 暴露 → 3 红）；未找到其它模型工具面（outbound MCP profile 无 osascript；ACP 无）。
4. 数量声明：`tsc --noEmit` ✓、`site-op-memory` **42/42** ✓、`bridge` **32/32** ✓、extension **1499/1499** ✓（逐字对上）、`scripts/tests/test-package-gates.sh` **156/0** ✓。
5. `adapter.ts:2013-2018` 原有三个排除（`SITE_OP_BANNED`/`TAB_ATTACH_FROZEN`/`SITE_OP_ESCALATE`）完好，新 gate 叠加在其后。
6. `route-engine.ts:192-198` 的 osascript 分支确为死分支：`route-engine.ts:323` 硬编码 `target = "host_computer"`，`buildSteerText` 无其它生产调用点——注释属实。
7. 新增回归测试 M1 有效：清空 `NON_AGGREGATING_SITE_OP_CODES` → 恰好 1 红（`site-op-memory.test.ts:625-641`）。
8. 被排除的两个码本身**不可能由坏 origin 造成**（都在任何页面交互之前产出：`evaluate-code-policy.ts:38-68`、`browser-bridge.ts:2039-2041`），所以这两条不会掩盖真实 CDP 故障 —— 问题不在「改宽」，而在「点名点错 + 兜底没动」。

VERDICT: REJECT
PI_EXIT=0
