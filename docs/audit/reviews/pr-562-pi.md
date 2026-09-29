diag: pi=/c/nvm4w/nodejs/pi
## BLOCKING（必须修才能合）

无。我没有找到任何「码优先把本该 security/本该终止的失败放过去」的真实路径，也没有找到行为回归。

---

## NITS（非阻塞）

- **[P2] `companion/tests/classify-by-code.test.ts:97`** — 守卫是**单向**的：`EXPECTED_LEVELS` 只钉住「表里有、期望里有」的条目（`for (const [code, expected] of Object.entries(EXPECTED_LEVELS))`），没有「表 ⊆ 期望」的反向断言。实测：往表里加 `["SITE_OP_BANNED","security"]`（真实存在的码 + 错误等级）→ **0 红**；加 `["TOTALLY_FAKE_CODE","recoverable"]` → 0 红（后者符合实现者声明）。建议补 `assert.deepEqual([...ERROR_CODE_LEVELS.keys()].sort(), Object.keys(EXPECTED_LEVELS).sort())`，一行即可把「新增码必须显式定级」变成红测试。

- **[P2] `companion/tests/classify-by-code.test.ts:19`（HOSTILE_SHAPES）** — 所有形态都不带 `domain`，而 `companion/src/security.ts:1042` 的「untrusted domain + cookie」security 分支在表**之后**。实测突变 M10：把该分支整体提到 `byCode` 之前 → **0 红**（其它 11 处突变全部按预期变红）。即这是唯一一个可被搬到码优先之前而不被测试发现的 security 子分支。生产影响≈0（唯一调用点 `adapter.ts:2121` 从不传 `domain`，该分支在线上是死代码），故只算覆盖缺口。补一条 `{domain:"evil.example.com", toolName:"get_cookies"}` 的形态即可闭合。

- **[P1] `companion/src/path-sandbox.ts:176`** — `PATH_ESCAPE` 真实报文有**第二种形态**：非 `PathEscapeError` 抛出时是 `` `PATH_ESCAPE: ${String(e)}` ``。此时旧行为取决于内文：`"PATH_ESCAPE: Error: EACCES: permission denied, realpath '/x'"` → 旧 **non_recoverable**（命中 `"permission denied"`），`"PATH_ESCAPE: Error: boom"` → 旧 **non_recoverable**（默认桶）；新一律 **recoverable**。即「零行为变更」对**非规范报文**不成立（方向是 终止→重试，沙箱仍然 fail-closed、重试受 same-tool-guard 有界，无安全损失）。PR 的 ① 已把口径限定为「各自真实报文」，故不算 over-claim，但建议把这一形态补进报文清单。

- **[P1] `companion/src/security.ts:952`** — `COOKIE_TRUST_DENIED` 在**空 message** 下：旧 **non_recoverable** → 新 **security**。两者在 `adapter.ts:2136` 都 `shouldStop`，差别只在 `formatChatErrorLine` 文案（`user-gate-copy.ts:168/181`：`操作未通过安全确认` vs `无法继续`）。同理，`ELEMENT_NOT_FOUND: user denied …` 这类「码 + 页面可控内文」旧 security → 新 recoverable（这是本票想要的加固）。都是**声明版「零行为变更」之外**的已知方向性变化，建议在 PR body 的 ① 旁加一句「非规范报文的结论可能变（这就是解耦本身）」。

- **[P2/Doc] `companion/src/security.ts:957`** — 注释「以下三条的真实报文**不含码名**（如 "downloads API unavailable"）」对 `DOWNLOAD_BUSY` 不成立：`browser-download-handler.ts:124` / `download-busy-entry.ts:46` 的报文是 `"DOWNLOAD_BUSY: a browser_download is already in progress on this tab"`，**含码名**。结论（落默认桶 non_recoverable）仍正确，因为 recoverable 子串表里没有 `download_busy`（`security.ts:1066-1240` 全表已核）。只是给的理由错了。

- **[Doc] PR body「原 9 组显式 `if` 分支」** — 实际是 **8 组**（`git show main:companion/src/security.ts` 第 941/951/964/969/974/978/983/993 行；`grep -c "^\s*if (context?.error_code"` = 6，另有 2 处跨行 `if (`）。另：① 的验证口径是「**24** 个码」，而表里 ship 了 **35** 条 —— 11 条（`HINT_REQUIRED`/`DOWNLOAD_BUSY`/`DOWNLOADS_API_UNAVAILABLE`/`SELECTOR_REQUIRED`/`TAB_*`/`HANDBACK_*`/`WORKER_STILL_RUNNING`/`UNATTENDED_CONFIRM_DENIED`/`CU_FOCUS_LEASE_QUEUED` 等）没有被那句话覆盖；我用真实报文把这 11 条补齐验了（全一致，见下）。回归数「70 个唯一失败名」我独立测得 **67**（62 个失败事件），主分支同为 67。

- **[P2/范围外, 非回归] 等级被冻结但可疑**（`security.ts:958-964`，旧行为、本票不动）：
  - `SELECTOR_REQUIRED` = `non_recoverable`（`:964`）：真实报文 `browser-bridge.ts:2041` 抛出，LLM 补个 selector 就能继续；同族 `SELECTOR_OR_TEXT_REQUIRED` 却是 recoverable。**我判断这是真 mis-level**（非本票引入）。
  - `HINT_REQUIRED`（`:959`，`downloads-find.ts:159-168`，报文 `downloads.find requires filenameHint and/or urlContains`，甚至自带 `suggested_action`）、`DOWNLOAD_BUSY`（`:960`，并发冲突）、`DOWNLOADS_API_UNAVAILABLE`（`:958`，`user_hint_zh` 明确建议 fallback 到 `browser_download`）——都是 LLM 可自修的，却 **non_recoverable → 整轮终止**。同族无码站点同样中招（`browser-bridge.ts:681/1826/1995/2011/2041` 等 11 条 host 抛出串，我逐条跑过：**旧==新**，全 non_recoverable）。本票用「表 + ⚠️ 注释 + 红测试」把现状冻结，属合法重构立场；但建议**同时开一张 follow-up issue**，否则「等级由码定」的机制反而提高了改这些等级的显式成本。

- **[P0 判断] 逐条定级**（我的判断，`security.ts:949-1005` 全 35 条）：
  - `PATH_ESCAPE` = recoverable（`:1004`）：**可接受**。判定只决定「重试 vs 终止」，沙箱在 `path-sandbox.ts:166-180` 已 fail-closed 拒绝，重试受 same-tool-guard 有界；判 security/non_recoverable 会因为一个路径笔误整轮毙掉无人值守任务。但它确实覆盖了 UNC / `..` / junction realpath 这类**敌意形状**，应由 owner 明确拍板而不是靠 `"not allowed"` 子串兜到的现状 —— 本票已登记。
  - `SELECTOR_REQUIRED` = non_recoverable（`:964`）：**判断为不该**（同上，偏严；非本票引入）。
  - `WRONG_ORIGIN` = recoverable（`:1005`）：**判断正确**。`locator-classify.ts:34-39` 的语义是「tab 在 chrome:///chrome-extension:// 这类特权页 → 重新 list_tabs」，是选错目标，不是安全事件。
  - 其余 31 条：`BROWSER_UNAVAILABLE`(non_rec)/`WAIT_*`(rec)/image 7(rec)/`UNATTENDED_CONFIRM_DENIED`(rec, L-5 故意 bypass)/`CU_FOCUS_LEASE_QUEUED`(rec)/`HANDBACK_*`+`WORKER_STILL_RUNNING`(rec)/`TAB_LOCKED`+`TAB_BUSY_CONFIRMING`+`TAB_FORCE_RELEASING`+`TAB_LEASE_CAP`+`TAB_ID_REQUIRED`(rec)/`CDP_ATTACH_FAILED`+`ELEMENT_*`+`INVALID_SELECTOR`+`SELECTOR_OR_TEXT_REQUIRED`+`WAIT_CONDITION_REQUIRED`+`EVAL_THROWN`+`EVAL_DEAD_WORLD`+`TYPE_UNSUPPORTED_EDITOR`(rec) —— 全部与其真实报文的既有行为一致，且语义自洽，**无异议**。

---

## 未能验证

- 实现者 ① 的**码清单**（「24 个码」具体是哪 24 个）无法还原，因此「16 个漂移」的分母无法逐条复算。我按自己的口径独立复现了**同一现象**：扫 `chrome-extension/src` 得 21 个码，用 5 种形态跑**旧实现**得 **14 个漂移**，且 PR 点名的 10 个（`CDP_ATTACH_FAILED`/`ELEMENT_NOT_FOUND`/`ELEMENT_AMBIGUOUS`/`INVALID_SELECTOR`/`SELECTOR_OR_TEXT_REQUIRED`/`WAIT_CONDITION_REQUIRED`/`EVAL_THROWN`/`EVAL_DEAD_WORLD`/`TYPE_UNSUPPORTED_EDITOR`/`WRONG_ORIGIN`）**10/10 命中**「中性文案 → non_recoverable，生产形态 → recoverable」这一形态。分母差异来自码集与形态集定义，非结论差异。
- `ERROR_CODE_LEVELS` 的 `ReadonlyMap` 只是类型层面只读（运行时仍是 `Map`，且已 export，理论上可被 `as Map` 后 `.set`）；本仓库无此类调用，未深究。

---

## 已核实为正确的声明

1. **码优先在最前、之后才是文案启发式** — `security.ts:1033-1035`，`if (byCode) return byCode` 后紧跟 `const msg = errorMessage.toLowerCase()`；删掉/削弱它 → 3 红（独立突变 M1b、M8 各 3 红：属性用例 + 等级用例 + 「Security Block 不带走 recoverable 码」用例）。
2. **原显式分支全部收敛进表、无遗漏** — 旧 8 组共 19 个码（`git show main:…` :941/951/964/969/974/978/983/993）+ 新增 16 = **35 = 表大小**；`IMAGE_FAMILY_ERROR_CODES` 展开的 7 条经 `EXPECTED_LEVELS` 逐条核对。
3. **零行为变更（规范报文）** — 我**独立**建了 old(编译自 `main`, 同一 `isTrustedDomain` stub)/new 两套实现做差分，用**从源码 emit 点抽出的真实报文**（`codedToolError("CODE", msg)` → `` `${CODE}: ${msg}` ``、`failInteractive` 重算码、`downloads-find.ts`/`image-extract-utils.ts` 的无码前缀报文、`security.ts:145` 的 `Security Block:` Cookie 报文）跑：**18 个码共 60+ 条真实报文 + 22 条手工构造的真实形状，old == new，0 差异**；差分覆盖了 `SELECTOR_REQUIRED`(browser-bridge.ts:2041 抛出→:227 泛捕获补码)、`DOWNLOADS_API_UNAVAILABLE`、`HINT_REQUIRED`、`DOWNLOAD_BUSY`、`COOKIE_TRUST_DENIED`(空码前缀形态) 等**不在「24」口径内**的 11 条。PR 点名的 5 条「非 `CODE: …` 形态」也复现（我数到 8 条：`BLOB_URL_UNSUPPORTED`/`DOWNLOADS_API_UNAVAILABLE`/`HINT_REQUIRED`/`IMAGE_MIME_REJECTED`/`IMAGE_TOO_LARGE`/`INVALID_DATA_URL`/`IMAGE_EXTRACT_FAILED`/`COOKIE_TRUST_DENIED`）。
4. **属性成立** — 35 码 × 28 种形态（大小写/全角/CRLF/NUL/超长/`security block`/`user denied`/`permission denied`/`cookie domain mismatch`…）以及 `domain=evil.example.com` + `toolName=get_cookies` 变体，**0 不稳定**，且恒等于表中等级。
5. **无码/未登记码路径未变** — 旧实现 `security.ts:1046` 起（原 :1010 起）与新版逐字节相同（仅 CRLF 差异，`git show main` 出 LF 所致）；M 组采样（空码、未登记码 × 三种子串桶 × 有/无 domain × 有/无 cookie 工具）**0 差异**。
6. **突变 4/4 与其声明完全一致** — 去码优先 → 3 红；改一个码等级(`PATH_ESCAPE`→security) → 1 红；删一个码(`ELEMENT_NOT_FOUND`) → 1 红；多一个假码 → 0 红。我另加：翻转等级(M7) 1 红，去掉 security 条目(M12) 1 红，`COOKIE_TRUST_DENIED` 改级(M11) 1 红，security 子串提到码前(M5c) 2 红。
7. **`EXPECTED_LEVELS` 与 `ERROR_CODE_LEVELS` 逐条一致**（含 spread 7 条）：35 vs 35，无多、无漏、无值差（脚本比对，非人眼）—— 没有重演 #559 那类手抄漂移。
8. **P0「security 被绕过」否证** — 全仓扫 `Security Block` 站点 ±30 行内的 `error_code`：唯一配对是 `security.ts:172 COOKIE_TRUST_DENIED`（→ security ✓）；`mcp/dispatch.ts:291/331/645/677`、`image-fetch-admission.ts:102/218/219/261/289`、`url-cookie-admission.ts:286/316/341/375/406`、`file-url-admission.ts:21/25`、`security.ts:889/910` 全部**不带码** → 走子串 → 仍 security。确认环节唯一的「用户拒绝」码 `UNATTENDED_CONFIRM_DENIED`（`l2-admission.ts:1615-1632`）在旧代码里也是**更早的显式分支**，新旧同判 recoverable（L-5 故意）。`adapter.ts:2136` 显示 `security` 与 `non_recoverable` **同等终止**，故所有翻转的实际后果只在文案与 `error_level` 标签。
9. **回归全绿** — companion 全量：我跑 main 与 PR 各一次，失败**集合完全相同**（67 个唯一名，0 增 0 减），`pass 4572/4644` 两侧一致，PR 侧多 4 个测试全过；定向 8 个文件 83/83；extension `1498/1498`（PR 未改扩展）；`bash scripts/tests/test-package-gates.sh` → **156 passed, 0 failed**。（注：全量跑前必须重编译 `.test-dist`——突变实验只还原 `src` 不还原 dist，会得到假红；我第一次就踩了这个坑。）
10. **diff 范围与提交信息一致** — `companion/src/security.ts (+93/−58)` + 新增测试，工作区干净。

VERDICT: APPROVE_WITH_NITS
PI_EXIT=0
