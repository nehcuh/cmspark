diag: pi=/c/nvm4w/nodejs/pi
## BLOCKING（必须修才能合）

**评审基线**：在干净 worktree 中对 `f5ba6dd1` 复核（`git worktree add ... f5ba6dd1`）。注意主工作树当前有**未提交改动**（`SUMMONER_ACL` 提为显式条目），该改动修掉了我下面 P1-5 的同一条，但**没有**触碰 SITE_OP_ESCALATE / INTENT_CAP / BOARD_HOST_INVALID / 枚举覆盖。

---

### [P0] `companion/src/security.ts:978` — `SITE_OP_ESCALATE` 登记为 `non_recoverable`，**把「换路」变成「整轮终止」**

- **产出点**：`src/tool/site-op-memory.ts:652-660`（`bannedSiteOpResult`），报文 = `originEscalateError()` = `site-op-memory.ts:612-620`：
  `"SITE_OP_BANNED: CDP interactive tools already failed 4+ times on this origin …"`
- **入口**：`src/llm/adapter.ts:1774` `toolResult = bannedSiteOpResult(siteBan, { cuArmed })`（`peekSiteOpBan` 在 `site-op-memory.ts:325-327` 返回 `SITE_OP_ESCALATE`）。
- **实测（生产报文，同一字符串）**：
  ```
  SITE_OP_ESCALATE:  BEFORE (无码) = recoverable      AFTER (登记) = non_recoverable
  ```
  BEFORE 之所以是 recoverable，是因为报文里字面写着 `SITE_OP_BANNED`，命中子串表的 `site_op_banned`。
- **后果**：`adapter.ts:2145` `if (errorLevel === "security" || errorLevel === "non_recoverable") { shouldStop = true; … break }` → 回合直接以 `chat.error` 结束。而 `adapter.ts:2159` 的 `if (failCode !== "SITE_OP_BANNED" && failCode !== "SITE_OP_ESCALATE")` **成了死代码**，其注释（`adapter.ts:2157-2159`）明确写着「信封仍经 classifyError **recoverable** 喂回模型换路」——本 PR 直接把这条注释推翻了。
- **同类不一致**：同一批里 `SITE_OP_BANNED` 被钉成 `recoverable`，两者在 `adapter.ts:2159` 被同等对待，登记结果却相反。
- **触发条件**：任何 origin 连续 4 次 CDP 交互失败后的下一次 peek 拒执。

### [P0] `companion/src/security.ts:967`（`INTENT_CAP` 在 `DEFAULT_NON_RECOVERABLE_CODES`）— 是**收紧**，不是零变更

- 生产报文：`src/board/intent-claim.ts:79` `` `worker already holds ${MAX_INTENTS_PER_WORKER} intents` ``
- 实测：`BEFORE (无码) = recoverable`（命中子串表 `"already holds"`，那是为 tab lease 加的）→ `AFTER = non_recoverable`。
- 路径确认在 LLM 工具链上：`companion-dispatch.ts:734-749`（`board_claim_intent`）→ `intent-claim.ts:114-121` → `data: { error_code: r.error_code }`。
- 这直接否证 PR 声明 #2「三种测法结论一致（100 条全 `non_recoverable`）」：`INTENT_CAP` 的中性/生产报文结论**不一致**，本该进那 8 条。

### [P0] `companion/src/security.ts:1082` — `BOARD_HOST_INVALID` 钉成 `recoverable`，但 **6/7 个产出报文原本是 `non_recoverable`**

- 实测（逐条取自 `src/board/service.ts`）：
  | 站点 | 报文 | 登记前 |
  |---|---|---|
  | `board/service.ts:921` | `cannot resolve board host for structured handback` | **non_recoverable** |
  | `board/service.ts:178` | `workers cannot host mission_board; merge into parent` | non_recoverable |
  | `board/service.ts:261` | `cannot resolve board host (worker without parent?)` | non_recoverable |
  | `board/service.ts:267` | `workers never host mission_board` | non_recoverable |
  | `board/service.ts:1204` | `workers cannot complete mission_board` | non_recoverable |
  | `board/service.ts:1387` | `cannot resolve board host` | non_recoverable |
  | `board/intent-claim.ts:67` | `board host not found or not a host thread` | recoverable |
- **在 classifyError 路径上**：`companion-dispatch.ts:682-724`（`collect_handback` 工具）**直接 return** `collectWorkerHandback(...)` 的结果，而 `service.ts:918-925` 返回 `error_code: "BOARD_HOST_INVALID"`；`board_complete` 走 `companion-dispatch.ts:855` 透传 `result.error_code`。
- 即：`collect_handback` 这条失败**今天会中断整轮**，登记后变成可重试喂回模型 —— 这是**未声明的放宽**（PR 声明 #3 说 107/108 一致、只有 CALLER_DISCONNECTED 一处漂移）。
- **额外反证**：`service.ts:179 / 1206 / 1389` 三个站点自己就盖了 `recoverable: false`（`BoardResult.recoverable`，`service.ts:56`），登记的 `recoverable` 与产出方自述直接冲突。

### [P0] 枚举**只覆盖了约一半**：`new ComputerError(code, …)` 形态完全没扫

`ComputerErrorCode`（`companion/src/computer/types.ts:151-188`）共 **37** 个成员，**35 个未登记**：
```
COMPUTER_DISABLED APP_COORDINATE_DENIED APP_COORDINATE_STRUCTURAL APP_NOT_WHITELISTED
APP_WINDOW_NOT_FOUND APP_EXE_DRIFT HWND_NOT_OWNED HWND_DEAD INTEGRITY_LEVEL_DENIED
DESKTOP_DENIED OUT_OF_BOUNDS CLICK_OCCLUDED COMPANION_UI_CLICK_DENIED FOCUS_LOST
FOREGROUND_RAISE_FAILED OCR_LANGUAGE_MISSING OCR_FAILED STALE_SCREENSHOT DANGER_HARD_DENY
DANGER_DENIED_BY_USER DIALOG_PAUSED_DENIED BUDGET_DENIED UNCROSS_DENIED
TYPE_TEXT_NOT_CONFIRMED TYPE_TEXT_TOO_LONG TYPE_NO_EFFECT SEND_NO_EFFECT CAPTURE_FAILED
INJECT_FAILED EVIDENCE_ERROR INVALID_ACTION CONFIRMATION_UNAVAILABLE TASK_ABORTED
EMERGENCY_STOP_LOST RATE_LIMITED
```
- **确实在 classifyError 路径上**：`src/computer/executor.ts:428/448` `errorCode: err.code` → `src/tool/companion-dispatch.ts:2170` `data: { error_code: result.errorCode, … }` → `adapter.ts:2121`。
- 其中至少 6 个是**fail-closed 安全闸门**：`DANGER_HARD_DENY`（A4 支付/转账/验证码无再审路径）、`CLICK_OCCLUDED`、`COMPANION_UI_CLICK_DENIED`、`INTEGRITY_LEVEL_DENIED`、`DESKTOP_DENIED`、`APP_COORDINATE_STRUCTURAL`、`HWND_NOT_OWNED`。它们的等级目前仍由文案决定 —— 正是 #560 要消灭的东西。
- **`OUT_OF_BOUNDS` 与已钉的 4 条完全同类**：`executor.ts:1027-1032 / 1037-1042 / 1287-1292` 的报文含 `"outside client rect"`，**字面就在 recoverable 子串表里**：
  ```
  OUT_OF_BOUNDS  BEFORE (无码) = recoverable   registered = false（未登记）
  ```
  这属于「码名/报文本来就在 recoverable 子串表里，中性文案会掉回默认桶」这一类，扫描模式没覆盖 `new …Error("CODE", …)` 就漏了。
- 另外靠**标识符 / 三元 / `||`** 产出的码同样漏掉：`LEASE_REV_MISMATCH`（`ws/composer-lease.ts:47/64/316/450`）、`LEASE_CLAIM_FAILED`（`:448`）、`L2_CONDUCTOR_ELSEWHERE`（`ws/l2-conductor.ts:30`）、`EVALUATE_NULL_RESULT`（`tool/site-op-memory.ts:293`）、`BOARD_INIT_FAILED`（`board/service.ts:937`）、`HEARTBEAT_FAILED`（`board/intent-claim.ts:154`）、`DISPATCH_FAILED`（`outbound-mcp/bridge.ts:133/139`、`companion-http.ts:728`）、`INVALID_ACTION`（`computer/darwin-adapters.ts:79/106/181`）、`DOWNLOAD_CANCELED/FAILED/TIMEOUT`（`chrome-extension/src/background/download-waiter.ts:143/157/206`）。
- **量化**：我按他们的窄模式（同行 `error_code: "X"` / `codedToolError("X"`）重跑，**恰好复现 108 且无假阳**；把 `new …Error("CODE"` 与标识符/跨行形态并进来后，**仍处于未登记状态**的码还有 **79 个**（其中至少 35 个是上面那批 ComputerErrorCode）。PR 声明 #1 的「108 个未登记码」在给定扫描口径下自洽，但被表述成**这一类问题的全集**（提交信息「得 108 个未登记码」），实为 ~2× 低估；`security.ts:947` 的「清单来源」注释也没写「只扫了 `error_code:` / `codedToolError(` 字面量」这一限定。

---

## NITS（非阻塞）

- `companion/src/security.ts:1085-1086` — `CALLER_DISCONNECTED` 的论证**引用站点不成立**：`companion-http.ts:588-601` **同时**给了 `error: "caller disconnected while operator HITL was pending — approved tool not executed"` 和 `error_code: "CALLER_DISCONNECTED"`（不是只有 703/718 的无报文形态）。结论（不在本仓 `classifyError` 路径上）我独立验证**成立**——`mcp-outbound` 是对外 MCP server（`companion/src/index.ts:379`；消费方在 `chrome-extension/src/sidepanel/components/OutboundMcpSettingsSection.tsx:39`），错误回给外部客户端，不进本仓 LLM 循环——但「只给码不给 error」这句话是错的，应改成「整条 outbound-MCP surface 不与本仓 classifyError 相连」。顺带：在 :593 那个有报文的站点，登记前后**都是 recoverable**，所以漂移比声明的更小。
- PR 声明 #7「删掉码优先 → **3 红**」不可复现：我按字面删除 `security.ts:1123-1124` 的 `if (byCode) return byCode` → **7 红**（`if (false && byCode)` 同样是 7 红）。方向对，计数不对。
- `companion/src/board/service.ts` 有 **12 处**产出方自盖 `recoverable: true` 却进了默认桶（`BOARD_TOO_LARGE`、`BOARD_SCHEMA_INVALID`、`BOARD_MODE_OFF`、`BOARD_TRUST_REJECTED`×4、`BOARD_CAP_FACTS`、`BOARD_CAP_INTENTS`、`BOARD_FACT_INVALID`、`BOARD_INTENT_INVALID`、`BOARD_HINT_INVALID`×2、`BOARD_CAP_HINTS`）。它们今天确实是默认桶（零变更），但「诚实标注」里只点了 `BOARD_GOAL_REQUIRED` 等 5 个，而这 12 处有产出方**明写的恢复意图**，更该进后续批次清单。

---

## 未能验证

- 声明 #8 的后半：companion 全量「唯一失败与基线同、相关 0」、extension **1498/1498** —— 未跑全量（耗时），只跑了相关子集 **75/75** 通过。
- 79 个「仍未登记」码中非 `ComputerError` 系的（`code-review/*`、`business-evidence/*` 等）是否真的落 `data.error_code`：抽样看 `code-review/service.ts:78`、`business-evidence/draft-contract.ts:53` 是 `throw new Error("CODE")`（码变成 **message** 而非 `error_code` 字段），不算 `error_code` 产出，故未计入 P0 的硬结论。
- 每个 ComputerErrorCode 在实际运行时的可达性（需开 CU + 对应工具调用），结构性可达已由 `executor.ts:428/448` + `companion-dispatch.ts:2170` 证实。

---

## 已核实为正确的声明

| 声明 | 结论 | 证据 |
|---|---|---|
| #1 「108 个未登记码」 | **数字可复现**（口径 = 同行 `error_code:`/`codedToolError(` 字面量），且登记进表的 108 条**无假阳** | 我独立扫描：`prod-shaped 133`，减去已登记 25 → 恰好 108；用同一口径重跑得到同一集合 |
| #1 的 8 条漂移名单 | 码名**完全一致** | 与 `security.ts:1077-1091` 逐条对齐 |
| #5 属性：143 码等级与 message 无关 | **成立** | 143 码 × 8 种报文（含 `""`/`Security Block:`/`timeout`/`user denied`/`permission denied`/`not found`/`Cookie domain mismatch`/`429`）→ **0 违例** |
| #6 无码路径未变 | **成立** | 中性→`non_recoverable`；`timeout`→`recoverable`；`Security Block:`→`security`；未登记码 + `timeout` 报文→`recoverable`。且 `nonRecoverable`/`recoverable` 两张子串表 vs `10115dc6` **逐元素 byte-identical（6/6、103/103）**，所以「BEFORE = 新代码传 `error_code: undefined`」是精确等价，我的 before/after 对比可信 |
| #7 突变 M1/M2/M3 | **全部复现** | M1 塞未登记码 → **1 红**；M2 删 `ACK_NOT_OPERATOR` → **1 红**；M3 默认桶整体翻 `recoverable` → **1 红** |
| #7 的「补守卫前 M3 = 0 红」 | **复现** | 去掉 `#563 默认桶清单的等级也必须被钉住` 用例后再跑 M3 → **10 pass / 0 fail**。这正是本 PR 最有价值的贡献 |
| #8 用例 11/11 | **成立** | 干净 worktree 中 `tsc -p tsconfig.test.json` + `run-tests.mjs`：11 pass / 0 fail |
| #8 门禁 156/0 | **成立** | `bash scripts/tests/test-package-gates.sh` → `Results: 156 passed, 0 failed` |
| P2 紧凑数组 + map 展开是否会「隐式决定等级」 | **无问题** | `ERROR_CODE_LEVELS` 显式字面量条目 **36** + IMAGE 家族 7 + 默认桶 100 = **143**；默认桶内**无重复**（100 = 100 unique）；**无任何一个码同时出现在显式区和默认桶**（重叠集为空）；`security.ts:1094` 的展开是唯一绑定点，可查 |
| P2 143 条重复键 | **无重复键** | 显式字面量键去重后条数不变（36→36） |

---

VERDICT: REJECT
PI_EXIT=0
