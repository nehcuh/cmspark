## 复审结论：上一轮的 BLOCKING 未被消除 —— 它以同一形态**迁移到了新票 #552**

### 1. 修法 (a) 生效的部分（已独立核实）

| 核实项 | 证据 | 结论 |
|---|---|---|
| #552 真实存在 | `gh issue view 552` → state: OPEN, createdAt 2026-09-28T01:58:44Z, url `.../issues/552` | ✅ |
| #552 内容对得上 #547 核心 | 标题即三条防复发检查（tag==HEAD / 工作树干净 / Unreleased 为空）；正文含落点 `scripts/package.sh`、`test-package-gates.sh`、`version-lockstep.test.ts`、完成标准、Blast T1、不做什么 | ✅ |
| #552 的事实前提不假 | 我本机复跑：`grep -rn "exact-match\|Unreleased" scripts/ .github/ Makefile` → **0 命中**；`scripts/package.sh:53-59` 确实只有 REL-4 `companion == extension` 一项；`version-lockstep.test.ts` 只锁 8 处锚、不查 tag/HEAD | ✅ 真承接票，非空壳 |
| `Closes #547` → `Refs #547` | 正文第 11 行 `- Refs #547（**不 Closes**：…）`；`gh pr view 551 --json closingIssuesReferences` **不含 547**；#547 state=OPEN | ✅ #547 不会被合并自动关 |
| 新提交 6605f033 | `git log --oneline 71ff2ff9..HEAD` → 仅 6605f033；`git diff --stat 71ff2ff9..HEAD` → `CHANGELOG.md | 2 +-`；本地 HEAD == `git ls-remote` 分支头 == PR `headRefOid` | ✅ 已推送、纯文档 |
| 熔断时序措辞（上轮 NIT） | `site-op-memory.ts:29 SITE_LOCATOR_FAIL_BAN=2`、`:328` 执行**前**判 `fails>=2` 拒执、`adapter.ts:255 MAX_SAME_TOOL_RECOVERABLE_FAILURES=3`、`adapter.ts:2159/2160` 与 `:2010-2018` 明确 `SITE_OP_BANNED`/`ESCALATE` 不计数 —— 「累计 2 次失败后、第 3 次点击前拦截；pivot 到第 3 次失败才触发 → 该场景不可达」**全部为真** | ✅ NIT 已修 |

### 2. BLOCKING（新，同一失效模式被搬到 #552）

PR #551 正文**第 12 行**：

```
- Closes #552 的前置说明见文末
```

这是一个货真价实的关闭关键字，GitHub 自己算出来了：

```
$ gh pr view 551 --json closingIssuesReferences
{"closingIssuesReferences":[{"number":552,...}]}
```

即：**合并 #551 会自动关掉 #552** —— 正是承接 #547「本票核心」（防复发机制）的那张票。
#547 虽然不再被自动关，但它唯一的承接票在合并瞬间从 tracker 上消失，核心诉求依然无人承接：
上一轮我 REJECT 的失效模式**原样复现**，只是从「关 #547」变成「关 #552」。

这条还与正文自相矛盾：
- 第 76 行：「本 PR 不含该机制，故 #547 保持 open，**由 #552 承接**」
- 第 12 行却声明 `Closes #552`
- 且「前置说明见文末」指向的文末只有 `⚠️ 请尽快打 tag`——**那个说明段不存在**（第二处可机器核验但为假/悬空的声明）

**最小修法（一条）**：删除第 12 行整行（信息与第 11 行 + 第 76 行重复），或改为
`- Refs #552（承接说明见文末）` 并在文末补上该说明。改后请自检
`gh pr view 551 --json closingIssuesReferences` 必须为 `[]`。

### 3. 关于 memory/overview.md（上轮 NIT）——**可接受，不阻塞**

操作者的三条理由我逐条核实，全部成立：
- `git show --stat b78e0962`（cut 0.6.9）= **17 文件、无 memory/**；锁步确由独立提交 `8e74b77b`（4 文件，含 `memory/overview.md`）完成 → 先例成立
- `memory/overview.md:23` 是「包装 0.6.9：本机已换装、Release 已挂」的既成事实；0.6.10 尚未打包/发布，现在写「包装 0.6.10」才是假声明
- 我上轮的原话是「打 tag 前必须有一次 memory 锁步提交」，是 **tag 的前置条件**，不是合并的前置条件

结论：留给合并后、打 tag 前的 session-handoff 提交 —— **接受**。唯一保留条件（写进合并后 checklist 即可）：`v0.6.10` tag 创建前，`memory/overview.md` / `memory/session.md` / `PROJECT_CONTEXT.md` 的锁步提交必须已落地。

### 4. 其余 NIT（均非阻塞，已复核为真）

- `companion/tests/cli-version.test.ts:45` 仍硬编码 `v0\.6\.10`（应改由 `pkg.version` 构造）—— 已由正文自认，建议并入 #552 或另开票
- `chrome-extension/plasmo.config.ts:7` 仍是 `"0.4.0"`（构建期产物，为占位历史值）
- `scripts/dual-external-review.sh:21` `BASE_COMMIT="${3:-HEAD}"`，缺省时 `git diff HEAD` 范围为空 —— 本次 patch 体积（`d1ee60a6..HEAD` 24 文件 / 7344 insertions，绝大部分是评审材料归档）仍偏大
- 版本工程本体：本轮增量仅 1 文件 1 行文档，上轮 17 文件 lock-step / CHANGELOG 归档 / CI 结论无需重跑；`statusCheckRollup` 三个 smoke 均 SUCCESS

---

**核心三问直答**：
1. #547 的核心现在有真票承接吗？——**有**（#552，内容与事实前提均核实为真）。
2. 合并 #551 还会悄悄关掉承接票吗？——**会，但换成 #552**（`closingIssuesReferences=[552]` 由 GitHub 计算确认）。这正是本轮唯一的 BLOCKING。
3. 正文还有「可机器核验但为假」的声明吗？——**有 2 处**：第 12 行 `Closes #552`（与第 76 行矛盾、且会导致关票），以及同行的「前置说明见文末」（文末无该段）。

VERDICT: REJECT
PI_RECHECK_EXIT=0
