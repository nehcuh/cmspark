# Lane C2 — 测试质量 / 变异验证：acp Mode C 修复（opencode --prompt / kimi Windows 裸启动 / manager 接线测试）

**Reviewer**: 独立对抗评审 lane-c2-tests（未参与实现，不信任实现会话与其他评审路；关键结论均自读活码 + 亲自执行）
**Date**: 2026-08-20
**Range**: HEAD = `2576b53b97fac34561b7ce78fecaefe096812f3e` + 工作区未提交改动（`git diff 2576b53`，4 文件：`open-local-terminal.ts`、`message-router.ts`、`acp-open-local-terminal.test.ts`、`acp-handlers-gates.test.ts`）
**Frozen patch**: `docs/audit/reviews/head-2576b53-acp-modec-fix-diff-20260820-222819.patch`
**Live tree**: `git diff 2576b53 | diff - <frozen patch>` **字节一致**（diff 无输出，exit 0）`[executed]`
**Host**: Windows 11 + Git Bash，node v24.18.0

证据标记：`[executed]` 本机亲自执行 · `[inspected]` 读活码路径 · `[fetched]` 抓取一手外部文档/源码 · `[assumed]` 未直接验证。

**评审范围（本 lane）**：本补丁 6 条新测试的质量与变异敏感性；变异验证（编译产物私有副本）；全量回归及失败集独立归类；覆盖缺口。修复正确性本身（opencode `--prompt` 文档核实、kimi Windows 行为、回归面逐字节比对、文案术语核对）属 lane-a2，本 lane 不评分。

---

## Machine

```text
cd companion && node --test .test-dist/tests/acp-open-local-terminal.test.js \
  .test-dist/tests/acp-discover.test.js .test-dist/tests/acp-diff-apply.test.js \
  .test-dist/tests/acp-handlers-gates.test.js
→ ℹ tests 86 / pass 86 / fail 0   [executed]

cd companion && node scripts/run-tests.mjs        # 只读跑共享 .test-dist
→ ℹ tests 3101 / pass 3034 / fail 58 / skipped 9   [executed，全量日志 .tmp/lane-c2-fullrun.log]
```

Δ 对照（前次同宿主基线 3095/3025/61/9）：tests **+6**（恰为 6 条新测试，3101=3095+6 ✓）；fail 61→58，失败集合为同一类环境失败的抖动（逐条归类见下）。6 条新用例全部 PASS `[executed]`：

| 用例 | 结果 |
|------|------|
| `kimi L1 launches bare — no $task variable at all (POSIX parity)` | PASS |
| `opencode L1 passes the task via --prompt $task` | PASS |
| `kimi launches bare — no $task invocation, no task file load` | PASS |
| `opencode passes the task via --prompt $task (root positional is the project dir)` | PASS |
| `opencode Mode C passes the task via --prompt (root positional is the project dir)` | PASS |
| `start() passes resolveProtocolArgs(session.agent_id, server.args) to the protocol session` | PASS |

## 全量 58 失败的独立归类 [executed]

逐条提取失败用例 + 首行错误（awk 脚本从全量日志），58 条全部落入已知 Windows 宿主环境类别，**无一触及本补丁文件**（open-local-terminal / message-router / acp 系被改文件）：

| 类别 | 计数 | 构成 |
|------|------|------|
| EPERM rename/symlink（真实 `~/.cmspark-agent` 被锁；无开发者权限 symlink） | 9 | adapter-recovery 1、capability-workspace 1、host-use-darwin-integrity 1、m10-abort-orphans 2、m2-untrusted-marker 1、swift-tray-integrity 1、vault-templates 2 |
| AF_UNIX `listen *.sock` EACCES | 13 | daemon 7、daemon-cli 3、server-lock 3 |
| POSIX mode 位 / 路径断言 | 20 | config 2（0o600）、daemon 2（0o600 + `~/` 路径）、daemon-cli 2（lock 路径 + 0o700→666）、ws-auth-handshake 1（0o600）、packs-audit-log 1（权限位）、acp-agent-env 2（`/usr/bin` + POSIX login shell）、capability-workspace 3（`~/CMspark-projects` 形态）、cruise-path 1、host-bin-resolve 2（darwin `Contents`）、mcp-filesystem-home 1（`/Users/alice`）、vault-templates 1（`/` 根）、vault-index 1（`Topic\|pipe.md` Windows 非法字符）、vault-profiler 1（`notes\b.md` vs `notes/b.md` 分隔符） |
| 共享 home 竞争 / 宿主态 / 信号 / 计时 | 16 | security-thread 1、single/files 1、thread-manager-lock 3（EBUSY copyfile builtin-skills）、skills 1（宿主 `~/.claude/skills` 内容）、skill-engine 1（宿主 `knowledge/` 内容，2!==1）、crash-handlers 3（crash.log ENOENT）、daemon 5（SIGTERM/SIGINT marker、多进程竞争）、computer-task-mutex 1（timeout） |

反证（隔离重跑）`[executed]`：
- `security-thread`（含 **message-router 的 thread.update 路由用例**）单跑 **34/34 绿**；`single/files`（message-router thread.delete）单跑 **58/58 绿**；`thread-manager-lock` 单跑 **3/3 绿**；`m2-untrusted-marker` 单跑 **4/4 绿** —— 全量红均为共享真实 home 竞争伪影，与本补丁的 message-router 文案改动无关（且改动仅为两条错误字符串，不动控制流 `[inspected]`）。
- 隔离仍红的 8 条（skill-engine getBySite、vault-profiler scanVault、crash-handlers 3、computer-task-mutex、acp-agent-env 2）逐条核对错误原文，均为 POSIX 路径分隔符 / POSIX shell / 宿主目录内容 / Windows 信号与 fs 时序差异；其被测源码（`agent-env.ts`、`vault-profiler.ts`、`crash-handlers.ts`、skills、computer mutex）均不在本补丁内 `[inspected]`。

---

## 6 条新测试质量评估（逐条）

### acp-open-local-terminal.test.ts（+5 条）

- **`kimi L1 launches bare — no $task variable at all (POSIX parity)`**：真断言。钉 `buildWindowsModeCScript`：invoke 行精确正则（`& 'C:\Tools\kimi.exe'` 后无 positional）+ `doesNotMatch($task)` + `doesNotMatch(Get-Content)` + 横幅仍带 goalHint（`任务: fix auth`）。变异 B 验红 `[executed]`。
- **`opencode L1 passes the task via --prompt $task`**：真断言。正向 `--prompt $task` + 负向 `doesNotMatch(/opencode\.exe' \$task/)`（防 bare positional 回归）。变异 G 验红 `[executed]`。
- **`kimi launches bare — no $task invocation, no task file load`**（`buildWindowsCommandLine`）：真断言，额外 `doesNotMatch(/task\.md/)` 钉住「连任务文件加载都没有」（而非仅不拼接）。变异 B 验红 `[executed]`。
- **`opencode passes the task via --prompt $task`**（`buildWindowsCommandLine`）：真断言，同 L1 用例的正负向结构。变异 G 验红 `[executed]`。
- **`opencode Mode C passes the task via --prompt`**（POSIX `buildInteractiveExecFragment`）：**精确等值断言**，期望值用测试内独立重算（`shellSingleQuote(pf)` / `shellSingleQuote(cmd)` / `shellSingleQuote("fix the bug")`），promptFile 与 inline 两变体都钉，含 `"${CMSPARK_TASK}"` 的双引号包裹形式。变异 A 验红 `[executed]`。
- 既有 `with promptFile uses Get-Content…`（claude，不传 agentId）同时钉住 **agentId 缺省 → generic `$task`** 的默认路径 `[inspected]`——「agentId 未传」无覆盖缺口。

### acp-handlers-gates.test.ts（+1 条，manager 接线）

- **`start() passes resolveProtocolArgs(session.agent_id, server.args)…`**：真断言、真接线。只 mock `tryStartProtocolSession`（捕获 argv + 返回假 handle），`resolveProtocolArgs` 与 `manager.start` 走真实路径；kimi/opencode/claude/grok 四 agent 逐一 propose+start，`assert.deepEqual(c.args, expected)` 逐 agent 精确钉（kimi/opencode=`["acp"]`，claude/grok=`[]`）。**上一轮 N1/G1（manager.ts 接线无覆盖、可静默回退）已被本条钉住**——变异 C 验红 `[executed]`。
- Nit（不阻断）：该用例 `initDataDir()` + `saveConfig()` 写**真实**数据目录（`~/.cmspark-agent/config.json`），finally 恢复——沿用本文件既有的非 hermetic 风格，是全量跑「共享 home 竞争」类失败的贡献者之一。见 N4。

---

## 变异验证记录 [executed]

全程在**私有副本** `companion/.test-dist-mut`（`cp -r .test-dist .test-dist-mut`）上做，共享 `.test-dist` 零改动；每次验完 `cp` 恢复并 `cmp` 字节校验；收尾 `rm -rf .test-dist-mut` `[executed]`。

| # | 变异 | 跑的测试 | 结果 | 恢复 |
|---|------|----------|------|------|
| A | `open-local-terminal.js` 删除 opencode `--prompt` 分支（POSIX，退回 generic positional） | acp-open-local-terminal | **红**（fail 1：恰为 `opencode Mode C passes the task via --prompt`） | 已恢复，`cmp` 一致 |
| B | 删 Windows 构造器 kimi 裸启动（`buildWindowsCommandLine` + `buildWindowsModeCScript` 两处 `id==="kimi"` 失效化） | acp-open-local-terminal | **红**（fail 2：恰为两条新 Windows kimi 用例；POSIX kimi 用例保持绿，分支未被误伤） | 已恢复，`cmp` 一致 |
| C | `manager.js` 接线回退为 `(server.args \|\| [])` | acp-handlers-gates | **红**（fail 1：恰为新接线用例）——上一轮该接线无覆盖（旧变异 D 全绿），本轮已钉住 | 已恢复，`cmp` 一致 |
| D | `message-router.js` 两条新文案改回旧串（`obsidian export not configured` / `vault 分析失败`） | message-router-summary + config-acp + config-security（29 用例） | **全绿** —— 无测试钉住文案；grep 全部 tests 源对新旧四个字符串零命中 `[executed]`。记观察项 N3 | 已恢复，`cmp` 一致 |
| E（追加） | `buildWindowsModeCScript` L0 粘贴行删 `agentId: opts.agentId` 透传 | acp-open-local-terminal | **全绿 62/62** —— L0 粘贴行 agentId 透传无测试钉住（N1） | 已恢复，`cmp` 一致 |
| F（追加） | `openLocalTerminalForAgent` 两处调用点（pasteLine `:941` / writeModeCPs1 `:1084`）删 agentId 透传 | acp 四文件 | **全绿 86/86** —— 生产入口调用点无测试覆盖（grep 确认无任何测试直接调用 `openLocalTerminalForAgent`）（N2） | 已恢复，`cmp` 一致 |
| G（追加） | Windows 构造器 opencode 特例失效化（`--prompt $task` → generic `$task`） | acp-open-local-terminal | **红**（fail 2：恰为两条新 Windows opencode 用例） | 已恢复，`cmp` 一致 |

收尾：`git status --porcelain` 仅剩评审前已存在的 4 个修改文件（评审对象）与未跟踪评审产物（patch、各 lane 报告），无本 lane 引入的源码/测试改动、无 `.test-dist-mut` 残留 `[executed]`。

---

## 发现

无阻断发现。上一轮两条 P1 的修复行为均已被变异敏感的测试钉住；上一轮 N1（manager 接线无覆盖）已闭环。以下为 P2 测试缺口/观察项。

| ID | 严重度 | 发现 |
|----|--------|------|
| N1 | P2 test | `buildWindowsModeCScript` L0 分支 → `buildWindowsCommandLine` 的 `agentId` 透传无测试钉住（变异 E 全绿）。若该透传被回退，kimi L0 粘贴行静默退回 `& kimi $task`（即 P1-2 的 L0 形态回归），无测试报警。既有 L0 用例均不传 agentId。修复方向：补一条 `l0:true + agentId:"kimi"/"opencode"` 的 pasteLine 断言 |
| N2 | P2 test | `openLocalTerminalForAgent` 两处调用点（pasteLine、writeModeCPs1）的 `agentId: opts.agentId` 透传无测试覆盖（变异 F 全绿；无测试触及该函数）。纯构造器已钉住，但生产接线可静默丢失。与上一轮 N1 同级别（上一轮同类缺口记 P2，本轮 manager 侧已补、终端侧未补）。修复方向：stub 终端 spawn 的集成用例，或直接断言 pasteLine/ps1 内容 |
| N3 | P2 观察 | message-router 两条新文案（`笔记库导出未配置…` / `笔记库分析失败…`）无任何测试钉住（变异 D 全绿 + grep 零命中）。纯文案改动，可接受；与上一轮 N6 同型 |
| N4 | P2 test | 新接线用例沿用 `initDataDir()`+`saveConfig()` 写真实 `~/.cmspark-agent` 的非 hermetic 模式（finally 恢复）。单跑无害，但属共享 home 副作用，是全量跑竞争类失败的结构性贡献者 |

### 覆盖缺口汇总（修复后行为矩阵中仍无测试钉住的点）

- **G1（已闭环）**：manager.ts `resolveProtocolArgs` 接线 —— 本轮新测试 + 变异 C 验红，已钉住。
- **G2**：L0 粘贴行的 kimi/opencode 行为（N1）。
- **G3**：`openLocalTerminalForAgent` 调用点 agentId 透传（N2）。
- **G4**：message-router 两条新文案（N3，观察项）。
- 无缺口项（明确排除）：POSIX opencode promptFile/inline 两变体（精确等值钉住）；Windows 两构造器的 kimi/opencode 分支（变异 B/G 验红）；`agentId` 缺省默认路径（既有 claude 用例钉住）；Windows inline 变体不存在任务投递（无 promptFile 时 `cd /d … && command` 不带任务，系全 agent 既有约定，非本补丁新增面）`[inspected]`。

---

## Trust / ADR-020 · ADR-025

- 本补丁不触碰确认门禁：open-local-terminal 改动只影响 Mode C 终端命令行构造（用户显式动作）；manager 接线测试用 mock 拦截协议握手，不削弱 L2 Confirm 链路；message-router 仅错误文案。
- 既有 gate 用例（`acp confirm copy (RN5)` 等）在本轮 acp 四文件 86/86 与全量跑中全绿 `[executed]`。ADR-025「never auto_approve skip」未被削弱。

---

## Verdict rationale

补丁字节一致；acp 四文件 86/86 绿；全量 3101 用例的 58 红逐条归类全部为 Windows 宿主环境失败且与本补丁文件零交集（message-router 相邻用例隔离重跑全绿反证）。6 条新测试全部是真断言且变异敏感（A/B/C/G 验红）；上一轮的阻断性测试缺口（manager 接线无覆盖）已闭环（变异 C 验红）。遗留 N1/N2（L0 粘贴行与调用点 agentId 透传无测试）与 N3/N4 均为 P2 级测试缺口/观察项，不构成阻断——构造器层行为已钉死，缺口在生产接线的可见性，与上一轮同级缺口处理方式一致。

VERDICT: APPROVE_WITH_NITS
