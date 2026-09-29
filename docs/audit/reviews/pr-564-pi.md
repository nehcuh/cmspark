diag: pi=/c/nvm4w/nodejs/pi
# PR #564 独立对抗评审 — `fix/560b-code-uncoded-sites`（`5642bb05`）

工作树未被我改动（`git status` 干净，`.test-dist`/`dist` 均为 gitignore 产物）。下面每条都跑了命令或读了源。

---

## BLOCKING（必须修才能合）

（无。代码本体没有找到需要阻断合并的缺陷：三条等级改动的**方向与安全性我逐条验过**，测试有效，无回归。所有发现都在「声明与口径」层，见 NITS。）

---

## NITS（非阻塞）

- **[P1] `companion/src/security.ts:987-990` + PR body「自相矛盾」论证不成立（结论对、理由错）**
  fail 分支**确实**把 `suggested_action` 发给了扩展（`adapter.ts:2150` → `ws/l1-actuator.ts:18-40`），但面板 `chat.error` 处理器**根本不读它**（`chrome-extension/src/sidepanel/hooks/useWebSocket.ts:599-635` 只取 `error` 字串）。所以真实缺陷是「建议谁也没收到」而非「一边建议一边终止」。更关键：同一条理由也适用于 `DOWNLOADS_API_UNAVAILABLE`（`chrome-extension/src/background/downloads-find.ts:187` 同样带 `suggested_action`），而 PR 把它保留为 `non_recoverable`（`security.ts:959`），并给了另一套理由。判定标准其实是「agent 本回合能否自修」，不是「有没有带 suggested_action」。建议改措辞（决定本身没问题）。

- **[P1] `companion/src/security.ts:987-990` + PR body「两条真实的行为变更」高估了 HINT_REQUIRED 的可达性**
  **常规路径根本到不了 `classifyError`**：`bridge/tool-schemas.ts:186-194` 的 zod refine 先在 companion 侧拒掉 `downloads_find({})`，`adapter.ts:1683-1710` 只回一条 tool_result 然后 `continue`（不调 `classifyError`、不终止）。实测 `tryParseToolArgs("downloads_find", {})` → FAIL。仍可达的只剩两条窄路：
  ① 空白 hint（`z.string().min(1)` 放行 `" "`，扩展 `.trim()` 后判空 → `downloads-find.ts:151-158`）——实测 `tryParseToolArgs("downloads_find",{filenameHint:"   "})` PASS + `runDownloadsFind({filenameHint:"   "})` → `HINT_REQUIRED`；
  ② dotted 别名 `downloads.find`（`server.ts:475-478` 归一化；`tryParseToolArgs("downloads.find",{})` 落 `GENERIC_FALLBACK` → PASS，别名在 `browser-bridge.ts:207-208` 已接）。
  PR body 的端到端证据（我复现了，确实 recoverable）只证明**分类**，不证明「LLM 可触达」。改动仍是净正收益，但「原先不是决策、是没人登记」的叙事对这条件只对了一半。

- **[P1] `#563`「`required`/`requires` 子串**在原理上**无法安全区分」→ 过强**
  实测（把子串注入编译产物的 recoverable 表后与线上版 diff）：通用 token 确实危险 —— `"required"` 把 5 条 HITL 闸门报文从 `non_recoverable` 翻成 `recoverable`（`operator HITL required for page export`／`GRANT_REQUIRED`／`user_gesture required`／`task authorization required`）；`"requires"` 把 `host_read/skill_install requires L2 security_token confirmation` 一族翻成 recoverable。**但窄子串是安全的**：`"targets required"`/`"command required"`/`"session_id required"` 修好笔误站点，7 条 HITL 报文**一条都不动**。准确说法应是「通用 token 不安全；窄子串可行但违反 #560 的码优先纪律」，而非「原理上不可能」。

- **[P1] `#563` 口径缺口：**有码但未登记** 才是同样大的一类（本次 PR 的族里就有）**
  全仓扫生产者写入的 `error_code` 字面量 vs `ERROR_CODE_LEVELS`（35 条）：**≥108 个码被产出但未登记**（我这条正则会漏掉三元表达式，故是下界）。未登记 → 走文案启发式 → 等级由报文决定，正是 #560 要消灭的东西。同族实例：`DOWNLOADS_FIND_CHUNK_LOAD` / `DOWNLOADS_SEARCH_FAILED`（`chrome-extension/src/background/downloads-find.ts:249-259`，还自带 `suggested_action`+`recovery_zh`）、`WORKER_PATH_DENIED`（`companion/src/path-sandbox.ts:112-120`）。实测当前等级：`"Invalid query: chrome.downloads.search"` / `"importScripts failed"` / `WORKER_PATH_DENIED: workers may only download…` → **`non_recoverable`（整轮终止）**；只有报文里恰好含 `chrome-extension://` 才 recoverable。建议把这类明确写进 #563（或补进表）。

- **[P2] `companion/tests/classify-by-code.test.ts:215-218`（SELECTOR_REQUIRED 用例）零独立验证力**
  它不调 `classifyError`，只断言两个 map 值相等。实测：把 `SELECTOR_OR_TEXT_REQUIRED` 改 `non_recoverable` → 该用例与登记守卫同时红；把 `SELECTOR_REQUIRED` 改回 → 同样两条同时红。**所有能红它的突变都能红守卫** → 纯重复声明。
  反例（公平起见）：`:192-203` 与 `:205-211` **有**独立价值 —— 我构造了「码优先被破坏」的定向突变（`if (byCode && !/requires/.test(errorMessage))` / `!/already in progress/`），守卫（中性文案）**照样绿**，只有这两条红。所以「两条有针对本次改动的显式用例」成立，「三条」不成立。

- **[P2] `companion/tests/classify-by-code.test.ts:58-66`** — `// non_recoverable` 表头下面现在挂着三条 `"recoverable"`（`:61`/`:62`/`:66`），分组注释与取值矛盾，正好复现登记表想消除的那种读串。建议挪到 `// recoverable` 段。

- **[P2] 回归数口径** — companion 全量（我独立跑）：主批 4651 tests / 57 fail + settings 679 / 5 fail = **62 失败、67 个唯一失败名**（`grep -v 'failing tests:'`），PR 声称 70（与 #562 评审里 pi 独立测得的 67 一致）。**「相关 0」成立**：67 条里没有一条沾 security/classify/error_code/download/path-escape（全是 0o600/符号链接 EPERM/macOS 主机类 Windows 环境失败）。属估计偏差，方向无害。

- **[P2] `#563` 数字** — 我按「同一对象字面量内无 `error_code` + `error:` 是静态字面量」的严谨口径（花括号配平）实测：`success:false` 350 处 → 无码 273 → 静态报文 103 → **默认桶 `non_recoverable` 96 处 / 88 个唯一报文**（仅 companion/src：101/94/86）。「约 90」≈ 我的**无码静态**口径；「其中约 50 落默认桶」比实测少约一半（低估，方向安全）。

- **[NIT] `companion/src/security.ts:994-998`** — PR body 把 SELECTOR_REQUIRED 不可达归因于 `failInteractive` 改写（我实测验过：`classifyInteractiveFailure(msg,"ELEMENT_NOT_FOUND")` → `ELEMENT_NOT_FOUND`，`locator-classify.ts:85-102`），但更硬的理由是它**压根抛不出来**：唯一会传空 selector 的嫌疑点 `browser-bridge.ts:600` 拿的是 `plan.selector`，而 `planLocator` 用 `presentLocator()` 保证非空（`locator-classify.ts:64-71`），其余调用点 `:1214/:1660/:1735/:1738` 全部有 `selector ? … : null` 守卫。

---

## 未能验证

- **#563 的真实 issue 正文**：本机没有 `gh`（`timeout: failed to run command 'gh'`），只能检验 PR body 转述的那几条声明。
- **生产里 DOWNLOADS_SEARCH_FAILED 的真实报文**：无法造出真 Chrome `downloads.search` 失败，只用构造报文（`"Invalid query…"`/`"Error: search failed"`）测过，均 `non_recoverable`。
- **LLM 实际会不会发空白 hint / `downloads.find` 别名**：无生产日志，只能证明「可达」而非「常见」。
- **`main` 基线的失败名集合**：只测了本提交（67 个），没做对 main 的差分，故「相关 0」是「失败名与本次改动无关」而非严格的 before/after 差分。

---

## 已核实为正确的声明

- **`DOWNLOAD_BUSY` → recoverable 安全，不会变成无限重试**：busy 位在 `download-busy-entry.ts:50-57` 的 `finally` 释放，handler 自有路径在 `browser-download-handler.ts:345-350` 释放。我用真模块跑过四条路径：entry 正常完成 / inner 抛异常 / handler `DOWNLOAD_TIMEOUT` / handler 成功 ⇒ **释放全部成立（`size===0`）**。唯一滞留场景需要同 tab 上一个**无关**调用永不 settle（`tab-queue.ts:19-40` 无超时），那本来就把该 tab 彻底堵死，且同工具熔断（`adapter.ts:2162-2202`，阈值 3 → `circuit_breaker`）仍然会结束轮次。
- **`PATH_ESCAPE` 保持 recoverable 可接受**：沙箱在 dispatch **之前** fail-closed（`server.ts:621-631` → `path-sandbox.ts:106-148` 拒 UNC/device/越根/realpath 容器越界），扩展侧还有第二道 UNC 拒（`browser-download-handler.ts:48-54`）。等级只决定「重试 vs 终止」，重试有界。
- **`SELECTOR_REQUIRED` 确实不可达（两重原因，见上）→ 该条改动行为上无变化**，PR 如实标注，未冒充行为修复。且**「死条目」只有它一个**：扫 `companion/src`+`chrome-extension/src` 非测试文件，「没有任何站点把 error_code 设成该码」的注册码**仅 SELECTOR_REQUIRED**；`WAIT_PROBE_FAILED`（`browser-bridge.ts:1807`）与 `TYPE_UNSUPPORTED_EDITOR`（`:1280`）会被 `classifyInteractiveFailure` **有条件**改写（我用 `locator-classify.js` 实测：probe 的 both-channels 报文含 `Cannot access…` → 变 `CDP_ATTACH_FAILED`），但二者都改写为另一个 recoverable 码，**等级无影响**。
- **端到端（真生产者 → 真分类器）**：跑 `chrome-extension/.test-dist/.../downloads-find.js` 与 `download-busy-entry.js` 产出真结果，喂 `companion/.test-dist/src/security.js` 的 `classifyError` → `HINT_REQUIRED`/`DOWNLOAD_BUSY` 均 `recoverable`。与声明一致。
- **突变**：`HINT_REQUIRED` 改回 `non_recoverable` → **恰好 2 红**（登记守卫 + 该用例），与声明一致。另测：`DOWNLOAD_BUSY`/`SELECTOR_REQUIRED` 改动各 2 红；**删掉** HINT_REQUIRED 条目 3 红；往表里**新增**未登记码 `["NEW_CODE_XYZ","recoverable"]` → 双向守卫 **1 红**（#562 评审建议的反向断言确实生效，M6）。
- **测试与其他计数**：`classify-by-code` **11/11**；`bash scripts/tests/test-package-gates.sh` → **156 passed, 0 failed**；extension `node --test .test-dist/tests/*.test.js` → **1498/1498**；`git show --numstat` = **2 文件 +60/−20**。全部与声明一致。
- **Trust/闸门未被触碰**：三条被改的码都不是 HITL/L2 闸门；`classifyError` 的生产调用点只有 `adapter.ts:2121` 一处，`security_halt`（`loop-kernel.ts:313` → `halt_security`，「永不自动继续」）不再被 `DOWNLOAD_BUSY` 这类非安全瞬时错误占用，属语义改善。

VERDICT: APPROVE_WITH_NITS
PI_EXIT=0
