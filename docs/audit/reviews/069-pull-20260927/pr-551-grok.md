这是一次发布卫生的对抗评审，我先按声明逐条核对：看 diff、扫版本锚残留，并对照上一轮评审和 #549 的合并状态。分支和 diff 范围已经对上。接下来扫活版本锚、核对 CHANGELOG，并找出 `gh` 以便确认 #549 的合并状态。转义形式的 `0.6.9` 在源码里没再出现。接下来对 17 个版本文件做逐行 diff，并核对 CHANGELOG 和版本门禁到底覆盖了哪些锚点。`git grep` 把点当成了正则，刚才那批命中里有大量日期误报。我改用固定字符串重扫，并核对那 6 条 CHANGELOG 各自落在哪个提交上。## BLOCKING（必须修才能合）

无。

## NITS（非阻塞）

- `CHANGELOG.md:14` — 「站点熔断会先在第 2 次拦截」和 #548 的实机复现不一致。`SITE_LOCATOR_FAIL_BAN = 2`（`companion/src/tool/site-op-memory.ts:29`）是**记满 2 次失败后**才 ban；`peekSiteOpBan` 在 `fails >= 2` 时才拒（同文件 `:328`）。#548 记录的顺序是：第 1、2 次点击 `banned=false` 且都会真正执行并计数，**第 3 次调用前**才是 `SITE_OP_BANNED`。同一句文字因此最多把 `recoverableFailureCounts` 累加到 2，到不了 `adapter.ts:255` 的阈值 3，pivot 不可达——这个结论是对的，缺陷也没藏。错的只是「第 2 次就被拦住」。
- `memory/overview.md:5`、`:7`、`:37` — 这是已跟踪文件，仍把**当前**产品写成 0.6.9（`lockstep 0.6.9` / `产品 0.6.9` / 活切点 `0.6.9`）。它不进安装包，也不在 `b78e0962` 那 17 个文件里；`session.md` 里 2026-09-23 的历史条目不该改。但 overview 是现在时的状态页，下一轮会把它读成活切点。

## 未能验证

- 声明 6 的三件全量结果没有重跑：companion `tests=5306 fail=62`、chrome-extension `1458/1458`、`tsc --noEmit`。本轮只编了测试用的 `tsconfig.test.json`，再跑了版本相关的 5 个用例。

## 已核实为正确的声明

- 声明 1：`git show --stat 71ff2ff9` 与 `b78e0962` 的 17 个版本文件一致，另加 7 个 #549 评审归档（提交说明里写了）。`git diff` 里这 17 个文件只把 `0.6.9` 换成 `0.6.10`；`docs/GOAL.md:3` 的 `1.8.0` 和日期 `2026-09-20` 没动；两个 `package-lock.json` 只改了本包的 `version`（`:3` 和 `:9`），没有扫进依赖版本。
- 声明 2：`git diff d1ee60a6 HEAD -- PROJECT_CONTEXT.md` 为空。`PROJECT_CONTEXT.md:6,8,9` 仍是 2026-09-23 的 0.6.9 发布记录。`CLAUDE.md:137` 活切点已是 0.6.10，链上保留「0.6.9 是租手确认台到前面」。`chrome-extension/build/` 与 `.plasmo/` 被 `.gitignore` 忽略，且没有已跟踪的独立 manifest；扩展版本只在 `chrome-extension/package.json:4`。
- 声明 3：`CHANGELOG.md:5-7` 的 `[Unreleased]` 只有空标题，下面就是 `[0.6.10] — 2026-09-28`。空标题与 `v0.6.9` 当时的写法相同，不是漏归档。日期与本机 2026-09-28、提交时间 `Mon Sep 28 09:29:14 2026 +0800` 一致。
- 声明 4：`v0.6.9` 的 CHANGELOG `[Unreleased]` 是空的。现在这 6 条都在 tag 之后：`ad7f0980` 的提交说明写明租约、handback、premature-close、舰队标签是同一次提交带上的；换策略是 `b5a7396a`。不同 locator 连续失败 3 次会 pivot（`adapter.ts:2159-2171`、`same-tool-guard.ts:41-44`）；同一句走不到。#544 的提示在 `adapter.ts:2308-2316` 以 `role:"system"` 发出，不再写进 `<untrusted>`。#545 与 `fleet.ts:57-86`、`tab-lease.ts:712-739`、`FleetStrip.tsx:77`（4 秒）一致：在飞改动 / 60 秒新建持有 / 未决 CDP 三道都看，活跃集解析失败则整段跳过释放。#546 与 `companion/scripts/run-tests.mjs:54-102` 一致。
- 声明 5：`companion/tests/cli-version.test.ts:45` 现为 `v0\.6\.10`。已跟踪源码里没有残留的转义 `0\.6\.9`（评审提示稿里的那两处未进本提交）。刚跑的 `cli-version` 2/2 通过，stdout 断言为绿。
- 声明 6 里已复跑的部分：`test-package-gates.sh` **125 passed, 0 failed**。`CMSPARK_PACKAGE_GATE_ONLY=1 bash scripts/package.sh windows-x64` 打印 `Version: 0.6.10` 并以 0 退出。REL-4 在 `scripts/package.sh:55-58`，早于 GATE-ONLY 出口；版本不一致会先失败，所以这次是通过了，只是没有单独的成功行。`version-lockstep.test.ts` 3/3 通过。
- 全仓固定字符串 `0.6.9`（排除 `docs/audit/reviews`、`memory`、`.grok`）只剩 CHANGELOG 的历史段与限制说明、`CLAUDE.md:137` 的历史链、`PROJECT_CONTEXT.md:6,8,9`。`.github/`、`scripts/`、`companion/src`、`chrome-extension/src`、`companion/tests` 没有活的 `0.6.9`。`companion/dist/` 本地还有旧字符串，但是 gitignore 的构建产物，不在本 PR。
- 门禁覆盖面：`test-package-gates.sh:220-231` 只锁 companion `package.json`、extension `package.json`、`installer.nsi` 三处。`version-lockstep.test.ts:19-42` 再锁 `CLI_VERSION_FALLBACK`、`jsonrpc-stdio.ts`、`stdio-server.ts`、`AGENTS.md` 头尾。README / CLAUDE / PRODUCT / GOAL / `docs/README.md` / `companion/README.txt` / 两个 lockfile / `cli-version.test.ts:45` 的硬编码正则不在这两道门里。这挡不住 #547 的真正复发（tag 与其后的 main 提交仍报同一版本号）；PR 正文已把 `git describe --exact-match` 和「打 tag 前 Unreleased 必须为空」标成另票，没有假装这道门已经补上。`Closes #547` 会在合并时关掉那张把防复发写成「本票核心」的 issue，仓库里还没有后续 issue 号。这是流程口子，不是这次切版把锚点切错。
- 范围：`src/` 只有 `cli-version.ts:5`、`jsonrpc-stdio.ts:164`、`stdio-server.ts:252` 三个字面量。工作区里修改过的 `.gitignore` 和未跟踪的 `docs/audit/reviews/502-punchlist-20260919/` 不在 `d1ee60a6..HEAD`。#549 的评审材料进了这个发布提交（含约 5711 行的已合并 diff），提交说明已披露；不改变行为。
- ADR-020：PR 正文有 `Surface: n/a` / `L2-classes: (none)` / `Compose: none` / `Autonomy: n/a` / `Trust: none` / `Channel: n/a`。diff 没有新工具、确认方言或入口，这个声明成立。
- 顺序：`gh pr view 549` 为 **MERGED**，merge commit `d1ee60a6`（2026-09-28T01:12:48Z）。`git merge-base main HEAD` 就是它，`d1ee60a6..HEAD` 只有 `71ff2ff9`。`v0.6.9` 仍指向 `488252bf`。合并后不立刻打 `v0.6.10`，main 上再进提交就会再出现「版本串是 0.6.10、tag 还没有」的窗口；PR 正文这句警告是够的。已发布的 `v0.6.9` 仍应只认 `488252bf`；其间从 main 打出来、自报 0.6.9 的包装进 `[0.6.10]`，CHANGELOG `:11` 已经写明这些改动晚于该 tag。

VERDICT: APPROVE_WITH_NITS
GROK_EXIT=0
