# Lane C — 测试质量 / 变异验证：acp discover grok/kimi/opencode（PR #206）

**Reviewer**: 独立对抗评审 lane-c-tests（未参与实现，不信任实现会话与其他评审路；关键结论均自读活码 + 亲自执行）
**Date**: 2026-08-20
**Range**: `2b97cfa..2576b53`（HEAD = `2576b53b97fac34561b7ce78fecaefe096812f3e`）
**Frozen patch**: `docs/audit/reviews/head-2576b53-acp-discover-diff-20260820-211701.patch`
**Live tree**: `git diff 2b97cfa..2576b53 | diff - <frozen patch>` **字节一致**（diff 无输出，exit 0）`[executed]`
**Host**: Windows 11 + Git Bash，node v24.18.0，npm 11.16.0

证据标记：`[executed]` 本机亲自执行 · `[inspected]` 读活码路径 · `[fetched]` 抓取一手外部文档/源码 · `[assumed]` 未直接验证。

**评审范围（本 lane）**：本 range 新增/变更测试的质量与变异敏感性（`acp-discover.test.ts` +35、`acp-open-local-terminal.test.ts` +19、`acp-diff-apply.test.ts` 改 35）；变异验证（编译产物）；独立复验 Lane A 的两条 P1；覆盖缺口。
**不在本 lane 评分**：chrome-extension 9 个文件的 UI 文案改动（Lane B）；实现正确性的完整论证（Lane A）；`memory/session.md`、`docs/coding-handoff-user-guide.md` 文档改动。

---

## Machine（全量回归）

```text
cd companion && npm test        # = 清空 .test-dist + tsc -p tsconfig.test.json + scripts/run-tests.mjs
→ ℹ tests 3095 / pass 3025 / fail 61 / skipped 9 / cancelled 0 / duration ~50s   [executed]
```

本 range 的 6 个新增/变更用例全部 PASS `[executed]`：

| 用例 | 结果 |
|------|------|
| `probes grok / kimi / opencode with vendor install dirs` | PASS |
| `discovers grok and kimi when their vendor bins exist on this host` | PASS（628ms，本机两候选目录真实存在，非空转） |
| `kimi Mode C does not pass the task as a positional (subcommand collision)` | PASS |
| `uses grok --prompt-file for CLI bridge` | PASS |
| `injects kimi -p prompt and uses acp protocol args` | PASS |
| `appends opencode run prompt and uses acp protocol args` | PASS |

**61 个失败全部与本 range 无关**，逐条核对失败文件清单（27 个测试文件）后确认：没有一个是本 range 触碰的测试文件，其被测源码也均不在 range 内。失败形态为 Windows 宿主环境限制 `[executed]`（错误分类统计自全量日志）：

- `EPERM rename/symlink`（16 处：写真实 `~/.cmspark-agent/threads/index.json` 被 Windows 文件锁/杀软拦截；无开发者权限 symlink）
- `EACCES listen *.sock`（13 处：daemon/server-lock 的 AF_UNIX 监听）
- POSIX mode 位断言（`0o600`/`0o700`，Windows 报 `666`）与 POSIX 路径断言（如 `env.PATH.includes("/usr/bin")`、`/` 根目录）
- 并行测试进程共享真实 home 目录导致的状态竞争

佐证：逻辑型失败 `m10-abort-orphans › P0-B: multi-tool shouldStop…` 单独重跑 **5/5 PASS** `[executed]`——全量红是并发/共享态伪影，非回归。对照同格式前次评审（Darwin 主机）同类用例为绿，亦支持「Windows 环境差」结论。

---

## 新测试质量评估（逐条）

### acp-discover.test.ts（+35）

- `probes grok / kimi / opencode with vendor install dirs`：**真断言，非套套逻辑**。期望值用测试内独立的字符串字面量（`.grok` / `.kimi-code` / `.opencode` / `.bun`）+ `os.homedir()` 重算，与实现各自独立；变异 A（改源码 `.grok`→`.grok-mut`）立即变红证明其钉的是真实注册表内容而非自身 `[executed]`。
- `discovers grok and kimi when their vendor bins exist on this host`：**真断言但宿主条件性**。`if (!fs.existsSync(candidate)) return` —— 候选不存在时空转通过。本机 `C:\Users\HuChen\.grok\bin\grok` 与 `.kimi-code\bin\kimi` 均存在 `[executed]`，故本机确实走了真断言；在无这些二进制的机器（如 CI）上该用例零断言。见 N2。
- 任务关切的「只测注入 fake PATH」问题：**不存在**——测试根本没有注入 fake PATH；但反面是**没有任何 hermetic 方式**验证 `discoverCodingAgents` 真正遍历 `commonPaths` 命中 agent（homedir 不可注入）。`vendorBins`/`nvmNodeBins` 的拼接逻辑仅靠注册表字符串断言间接钉住（见覆盖缺口 G4/G5）。
- `[executed]` 本机真实 `discoverCodingAgents(true)` 返回 claude / pi / grok / kimi 四个 agent（grok=`C:\Users\HuChen\.grok\bin\grok.exe`，kimi=`…\.kimi-code\bin\kimi.exe`），端到端发现链路在 win32 真实可用；opencode 本机未安装，未被端到端覆盖。

### acp-open-local-terminal.test.ts（+19）

- `kimi Mode C does not pass the task as a positional`：**真断言**（`assert.equal` 精确等于 `exec '<cmd>'` + `doesNotMatch(/CMSPARK_TASK/)` + inline 变体不含任务文本），钉住 POSIX 片段构造器的 kimi 特例。变异 B 证明其敏感性 `[executed]`。
- 局限：只测 `buildInteractiveExecFragment`（POSIX 片段）。**Windows 构造器（`buildWindowsModeCScript`/`buildWindowsCommandLine`）没有任何 kimi 用例**——而且不可能有，因为它们根本没有 `agentId` 形参（即 P1-A2 的实现缺口本身）。

### acp-diff-apply.test.ts（改 35，launch presets describe）

- 三条新用例均为**精确 deepEqual / 逐元素断言**（grok argv 全等、opencode `["run", "fix the bug"]` 全等、kimi `args[0]/args[1]` + 排除 `-y/--auto` + `resolveProtocolArgs` 三种 configured 形态），无套套逻辑、非只测 mock。变异 C 证明 kimi `-p` 注入被钉住 `[executed]`。
- 局限：全部钉在**纯函数层**。`manager.ts:540` 调用点接线（`args: resolveProtocolArgs(session.agent_id, server.args)`）无测试——变异 D 证明 `[executed]`（见 N1）。

---

## 变异验证记录 [executed]（全部在 `.test-dist/` 编译产物；先 `cp` 备份至 `.tmp/lanec-mut/`（gitignored），验红后 `cp` 恢复并 `cmp` 校验字节）

| # | 变异 | 跑的测试 | 结果 | 恢复 |
|---|------|----------|------|------|
| A | `discover.js` grok 厂商目录 `".grok"`→`".grok-mut"` | `acp-discover.test.js` | **红**（fail 1：`probes grok / kimi / opencode…` 断言失败，输出含 `.grok-mut` 路径） | 已恢复，3/3 绿，`cmp` 一致 |
| B | `open-local-terminal.js` kimi 特例分支 `id === "kimi"`→`"kimi-off"`（等于删除该分支） | `acp-open-local-terminal.test.js` | **红**（fail 1：`kimi Mode C does not pass the task as a positional`） | 已恢复，57/57 绿，`cmp` 一致 |
| C | `launch-presets.js` `-p` 注入条件 `agentId === "kimi"`→`"kimi-mut"` | `acp-diff-apply.test.js` | **红**（fail 1：`injects kimi -p prompt and uses acp protocol args`） | 已恢复，11/11 绿，`cmp` 一致 |
| D | `manager.js:474` 接线回退为 `(server.args \|\| [])`（即撤掉 `resolveProtocolArgs`） | acp 全部 5 个相关测试文件（live-events / handlers-gates / diff-apply / discover / open-local-terminal） | **全绿 82/82** —— 证明该调用点**无测试覆盖**（N1） | 已恢复，`cmp` 一致 |

变异全部收尾后：三文件合跑 **71/71 PASS** `[executed]`；`git status --porcelain` 仅剩评审前已存在的未跟踪文件（patch 与 lane-a/lane-b 报告等），无源码/测试改动、无残留变异 `[executed]`。

---

## Lane A 两条 P1 的独立复验

### P1-A1：opencode Mode C 把任务文本当 `opencode [project]` positional —— **证实**

- 活码：`buildInteractiveExecFragment` 只对 `kimi` 特例（`open-local-terminal.ts:199-202`），opencode 落入 generic 分支 `[inspected]`。
- `[executed]` 直接调用编译产物：
  - `buildInteractiveExecFragment({agentId:"opencode", promptFile:"/tmp/t.md"})` → `CMSPARK_TASK=$(cat '/tmp/t.md') && exec '/usr/local/bin/opencode' "${CMSPARK_TASK}"`
  - inline 变体 → `exec '/usr/local/bin/opencode' 'fix the bug'`
- `[fetched]` [opencode 官方 CLI 文档](https://opencode.ai/docs/cli/)：TUI 的形式是 `opencode [project]`——positional 是**项目路径**；任务消息只能走 `opencode run [message..]`（headless）或 TUI 的 `--prompt` flag。
- 结论：Mode C（POSIX 与 Windows 同构）把整段任务文本塞进 `[project]` 位置 → 任务**不会成为会话消息**（非路径文本按项目路径处理，报错或开错目录，两者都丢任务）。本 PR 修了 kimi 的同型问题却漏了 opencode。**无任何测试**钉住 opencode 的交互 argv 约定（G2）。

### P1-A2：kimi Mode C 的 positional 特例只在 POSIX 片段实现，Windows 构造器缺 `agentId` 必然拼 `$task` —— **证实**

- 活码 `[inspected]`：`buildWindowsModeCScript`（`open-local-terminal.ts:330-374`）与 `buildWindowsCommandLine`（`:299-314`）形参均无 `agentId`；promptFile 存在时无条件生成 `$task = Get-Content …` + `& <tokens> $task`。Windows 分支调用点（`:1205-1213` 与 pasteLine `:1068`）也都不传 `agentId`。
- `[executed]` 直接调用编译产物生成 kimi 的实际命令行：
  - L1 ps1 末尾两行：`$task = Get-Content -LiteralPath 'C:/tmp/task.md' -Raw -Encoding utf8` / `& 'C:/Tools/kimi.exe' $task`
  - L0 ps1 的 Write-Host 粘贴行与 `buildWindowsCommandLine` 输出同样是 `& 'kimi' $task`
- `[fetched]` kimi-cli 一手源码（[MoonshotAI/kimi-cli `cli/__init__.py`](https://raw.githubusercontent.com/MoonshotAI/kimi-cli/main/src/kimi_cli/cli/__init__.py)）：根命令是 typer Group（`invoke_without_command=True`），**根回调没有任何 positional 形参**（无 `typer.Argument`），子命令为 `web/acp/login…`——未知 positional 会被 click 当子命令名解析并报 `No such command`。
- 结论：Windows 上 kimi Mode C 无论 L1（run.ps1 直接执行）还是 L0/粘贴行，都会把整段任务文本作为伪子命令抛出 usage 错误，任务丢失。POSIX 特例（变异 B 已证明被测试钉住）没有平移到 Windows。Lane A 描述的两处事实（缺 `agentId` 形参、必然拼 `$task`）均与本 lane 的读码 + 执行结果一致。

---

## 发现

两条 Lane A P1 独立复验均成立，构成本 lane 的阻断发现；其余为测试质量 nits。

| ID | 严重度 | 发现 |
|----|--------|------|
| F1 | **P1** | opencode Mode C 任务文本走 `[project]` positional，任务进不了会话（复验 Lane A P1-A1，证实；POSIX+Windows 同构） |
| F2 | **P1** | kimi Mode C Windows 路径无 `agentId`，`& kimi $task` 必触发子命令解析错误（复验 Lane A P1-A2，证实） |
| N1 | P2 test | `manager.ts:540` 的 `resolveProtocolArgs` 接线无测试：回退为 `server.args \|\| []` 后 acp 全部测试 82/82 绿（变异 D）。kimi/opencode 走 `acp` 子命令说 ACP 是本 PR 的核心行为，调用点可静默回退 |
| N2 | P2 test | `discovers grok and kimi when their vendor bins exist on this host` 宿主条件性空转：无候选二进制的机器（CI）上零断言通过 |
| N3 | P2 观察 | kimi Mode C 的 POSIX 修复方式 = 完全不带任务开裸 TUI（任务全文只存在于即将被 `scheduleUnlink` 的临时文件，横幅仅 ≤120 字 goalHint，pasteLine 也不含任务）。kimi 根命令其实有 `--prompt/-p`「User prompt to the agent…prompt interactively」`[fetched]`，即存在交互态投递任务的通道但未被使用。新测试恰好把这个「丢任务」行为钉成了规格——产品是否接受请 Lane A/产品裁决 |
| N4 | P2 test | `nvmNodeBins` 路径拼接、`vendorBins` 的 win32 `.exe`/`.cmd` 变体、`windowsCommonAgentPaths` 对新 agent 的覆盖均无直接断言；本机无 `~/.nvm/versions/node`，nvm 分支实际返回 `[]` 未被执行 `[executed]` |
| N5 | P2 观察（转 Lane A） | kimi CLI-bridge preset 为 `["-p", "--output-format", "text"]`，而 kimi-cli 文档对 `--output-format` 的说明是 “Must be used with `--print`” `[fetched]`；`-p` 在 kimi 是 `--prompt` 而非 print 模式。若真实二进制强制该约束，bridge 预设会被拒。测试把该预设钉成了规格（含排除 `-y/--auto`），但其与真实 CLI 的契合度本 lane 未能端到端验证（kimi-cli 与新版 Kimi Code 的 flag 差异属版本知识），请 Lane A 定夺 |
| N6 | P2 test | UI 文案改动（Obsidian→Markdown、agent 清单）无任何 extension 测试钉住（range 未触碰 extension 测试；grep 确认无断言这些字符串的用例）`[executed]`。纯文案改动可接受，仅记录 |

### 修复方向

- F1：opencode Mode C 改用 `opencode --prompt "$task"`（TUI 官方 flag）或像 kimi 一样裸 exec + 明确 paste 通道；为 opencode 补 `buildInteractiveExecFragment` 用例。
- F2：给 `buildWindowsModeCScript`/`buildWindowsCommandLine` 增加 `agentId` 形参并平移 kimi/opencode 约定（kimi 可 `& kimi --prompt $task`）；补 Windows 构造器的 kimi 用例。
- N1：补一个 manager 层测试（stub `tryStartProtocolSession`）断言 kimi/opencode 的 args 含 `acp`。

---

## Trust / ADR-020 · ADR-025

- 本 range 不触碰确认门禁：discover 为只读探测（`which/where` + `fs.stat`）`[inspected]`；session start / apply_diff 的 L2 Confirm 链路未改（`acp confirm copy (RN5)` 等既有用例全绿 `[executed]`）；`ACP_PROTOCOL_ARGS` 只是 spawn argv，session 启动仍经 HITL。ADR-025「never auto_approve skip」未被削弱。
- 能力坐标（ADR-020）：新增三个 agent 是既有 ACP Composition 面的横向扩展，不是新 Surface/runtime；Mode C 仍是用户显式动作。
- F1/F2 是功能正确性缺陷（任务误投/丢失 + 用户看到 usage 错误），不构成确认绕过；但它们使「发现并启动 opencode/kimi」这条本 PR 新增路径在 Mode C 下实际不可用/丢任务，故阻断合入。

---

## 覆盖缺口汇总（本 PR 声称行为中无测试钉住的点）

- **G1**：`manager.ts:540` 调用点（kimi/opencode ACP 会话真正带上 `acp` argv）——变异 D 全绿证实。
- **G2**：opencode 的 Mode C 交互 argv 约定（任何平台）——无测试，且当前实现是错误约定（F1）。
- **G3**：Windows Mode C 的 kimi 行为——无 `agentId` 形参所以无从测起（F2 即实现缺口）。
- **G4**：grok 的 Mode C 交互约定（注释声称 `grok [prompt]`）——无 grok 专门用例，仅 generic 分支被既有 claude/pi 用例间接覆盖。
- **G5**：`nvmNodeBins` / `vendorBins` win32 变体 / `windowsCommonAgentPaths` 对新 agent——无直接断言；discover 全链路只有宿主条件性测试（N2/N4）。
- **G6**：extension 文案改动——无测试钉住（N6，可接受）。

---

## Verdict rationale

补丁字节一致；全量 61 红均为 Windows 宿主环境失败且与 range 无交集（含隔离重跑反证）；三个测试文件的新增断言是真断言且变异敏感（A/B/C 验红）。但 Lane A 的两条 P1 经本 lane 独立读码 + 编译产物执行 + 一手外部文档/源码复验**双双成立**：opencode Mode C 把任务当项目路径、kimi Mode C 在 Windows 必拼 `$task` 触发子命令错误——两者都让本 PR 新增的「发现并使用 grok/kimi/opencode」路径在 Mode C 下功能不成立。叠加 N1（核心接线无测试，可静默回退），不足以放行。

VERDICT: REQUEST_CHANGES
