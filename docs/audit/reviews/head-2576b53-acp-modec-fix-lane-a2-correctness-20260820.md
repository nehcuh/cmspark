# Lane A2 — 修复正确性复审：ACP Mode C opencode/kimi 修复（对 2576b53 的工作区未提交改动）

**Date**: 2026-08-20
**Reviewer**: lane-a2-correctness（未参与实现；不信任实现会话汇报与任务转述，全部结论自读活码 + 亲自执行）
**Repo**: `C:/Users/HuChen/Projects/cmspark`（Windows 11 + Git Bash，node v24.18.0）
**Range**: 工作区未提交改动，即 `git diff 2576b53`（HEAD = `2576b53b97fac34561b7ce78fecaefe096812f3e`）
**Frozen patch**: `docs/audit/reviews/head-2576b53-acp-modec-fix-diff-20260820-222819.patch`
**Scope**: `companion/src/acp/open-local-terminal.ts`、`companion/src/message-router.ts` 两处文案、两个测试文件（`acp-open-local-terminal.test.ts` / `acp-handlers-gates.test.ts`）的正确性面。测试质量/变异与全量回归归 lane-c2，此处不重复评分。

证据标记：`[executed]` 本机亲自执行 · `[inspected]` 读活码 · `[fetched]` 抓取一手外部来源。

## Patch freshness

[executed] `git diff 2576b53 | diff - docs/audit/reviews/head-2576b53-acp-modec-fix-diff-20260820-222819.patch` → **无输出，字节一致（PATCH_IDENTICAL）**。补丁不陈旧。
[executed] `git status --porcelain` → 改动文件恰为 4 个（`open-local-terminal.ts`、`message-router.ts`、两个测试文件），其余为评审产物等既有未跟踪文件。补丁全文 380 行，无第四方文件、无与修复无关的 hunk（逐 hunk 目检，见 C4）。

## Method

1. 逐 hunk 读补丁 + 活码：`buildInteractiveExecFragment`（:182-227）、`buildWindowsCommandLine`（:313-339）、`buildWindowsModeCScript`（:355-406）、两处调用点（:1098-1110 pasteLine、:1238-1250 writeModeCPs1）、注释块（:170-181）、`shellSingleQuote`（:97-99）；`message-router.ts:2049-2053, 3328`。
2. [fetched] 独立抓 opencode 官方文档与 issue 核实 `--prompt`（未复用实现者引用）。
3. [executed] 四文件定向测试 + `node -e` 直接调用 `.test-dist` 编译产物构造器做实证矩阵；未重新编译 `.test-dist`、未跑 `npm test`。

---

## Claims

### C1 — P1-1 复验：opencode Mode C 全平台经 `--prompt` 递送任务

**修复前缺陷**（上一轮 P1-A1，已独立确认存在）：generic 路径把任务文本作为 trailing positional，而 opencode 根命令 positional 是 project 目录。

**修复后活码** [inspected]：`buildInteractiveExecFragment` 新增 opencode 分支（`open-local-terminal.ts:205-214`），位于 kimi 分支之后、generic 文件分支之前：

- promptFile 变体：`CMSPARK_TASK=$(cat '<file>') && exec '<cmd>' --prompt "${CMSPARK_TASK}"`
- inline 变体：`exec '<cmd>' --prompt '<inline>'`

**引用/转义** [inspected]+[executed]：

- promptFile 路径走 `shellSingleQuote`（:209），与 generic 分支同一转义函数；`"${CMSPARK_TASK}"` 双引号展开，无 word-splitting。
- inline 变体走 `shellSingleQuote(inline)`（:213）——`'` → `'\''` 转义（:97-99）**覆盖新分支**。[executed] 实证：prompt `it's a \`test\` $HOME` → `--prompt 'it'\''s a \`test\` $HOME'`，单引号闭合正确，反引号与 `$HOME` 均在单引号内不展开。
- 任务正文不经插值（文件读取），agentId 仅作分支键不进脚本文本。

**Windows ps1** [inspected]+[executed]：`buildWindowsModeCScript` L1（:399-401）与 `buildWindowsCommandLine` 粘贴行（:330-331）均生成 `& '<cmd>' --prompt $task`（`$task` 由 `Get-Content -LiteralPath '<pf>' -Raw -Encoding utf8` 赋值，无正文插值）。

**`--prompt` 事实核查** [fetched]：

- [opencode.ai/docs/cli](https://opencode.ai/docs/cli/)：TUI 节 `opencode [project]` 的 Flags 表含 `--prompt` —— "Prompt to use"。**flag 真实存在于 TUI 根命令，positional 为 project 目录**，修复方向事实正确。
- 语义 caveat：[sst/opencode#4700](https://github.com/sst/opencode/issues/4700)（v1.0.108，2025-11）与 [mattpocock/sandcastle#795](https://github.com/mattpocock/sandcastle/issues/795)（2026-06）均指出 `--prompt` 当前只**预填** TUI 输入框、不自动提交（auto-submit 是未决 feature request sst/opencode#3937）。即任务文本**进入会话 UI**（用户按 Enter 提交），而非自动开跑。对照修复前「任务被当 project 目录 → 报错/进不了会话」，P1 成立性消除；预填语义见 Findings P2-A2-2。

**Verdict on claim: HOLD**（修复正确，递送通道真实存在且转义完备；预填语义记 P2）。

### C2 — P1-2 复验：kimi Windows 裸启动 + agentId 透传完整性

**修复前缺陷**（上一轮 P1-A2，已独立确认存在）：Windows 构造器无 `agentId` 形参，ps1/paste line 必拼 `& '<kimi.exe>' $task` → kimi positional 是子命令 → `No such command`。

**kimi CLI 事实** [executed]：本机 `kimi --help`（0.23.6）usage 为 `kimi [options] [command]`，`[command]` 是子命令（export/provider/acp/server/web…），交互模式无 prompt positional——裸启动方向正确。

**修复后活码** [inspected]：

- `buildWindowsCommandLine`（:313-339）新增 `agentId?: string` 形参；kimi 提前 return（:322-328）：`Set-Location -LiteralPath '<cwd>'; & '<tokens>'`——**无 `$task`、无 `Get-Content`、无任务文件引用**。
- `buildWindowsModeCScript`（:355-406）新增 `agentId?: string` 形参；L1 条件改为 `opts.promptFile && id !== "kimi"`（:394），kimi 落入 else 分支 `& '<tokens>'` 裸启动（:402-404）。

**透传完整性**（有无第三条生成路径漏传）[inspected]：

| 生成点 | agentId 来源 | 状态 |
|--------|--------------|------|
| `buildWindowsModeCScript` 定义 :355 | 形参 :359 | ✓ |
| L0 内部调用 `buildWindowsCommandLine` :382-386 | `agentId: opts.agentId` :385 | ✓ |
| `buildWindowsCommandLine` 定义 :313 | 形参 :316 | ✓ |
| 调用点 1：pasteLine :1098-1104 | `agentId: opts.agentId` :1103 | ✓ |
| 调用点 2：writeModeCPs1 :1241-1250 | `agentId: opts.agentId` :1245 | ✓ |

[executed] 全仓 grep `buildWindowsCommandLine|buildWindowsModeCScript`：生产代码仅上述 2 调用点 + 1 内部调用，无第三条路径；grep `\$task|CMSPARK_TASK` 于 `companion/src` 确认 `$task` 生成仅存在于 open-local-terminal.ts（host-use 下两个 ps1 的 `$task` 是 .NET Task，无关）。

**实证矩阵** [executed]（`node -e` 调 `.test-dist` 构造器）：

```
buildWindowsCommandLine kimi     => Set-Location -LiteralPath 'C:/ws'; & 'C:/Tools/AGENT.exe'
buildWindowsCommandLine opencode => Set-Location ...; $task = Get-Content ...; & '...' --prompt $task
buildWindowsCommandLine claude   => Set-Location ...; $task = Get-Content ...; & '...' $task
buildWindowsCommandLine (无id)   => 同 claude（generic，字节不变）
L1 ps1 kimi                      => & '...kimi.exe'（无 $task / 无 Get-Content）
L1 ps1 opencode                  => $task = Get-Content ... / & '...' --prompt $task
L0 粘贴行 kimi                   => Set-Location ...; & '...kimi.exe'（裸）
L0 粘贴行 opencode               => 含 --prompt $task 完整行
```

kimi L1 ps1 与 L0 粘贴行均不含 `$task` 与任务文本（banner 仍有 120 字 goalHint 供用户参考——与 POSIX kimi 既有设计一致）。POSIX kimi 分支（:200-203）本 diff 未触碰，行为未动。

**Verdict on claim: HOLD.**

### C3 — 回归面：claude/pi/grok/未知 agent 逐字节保持

[inspected] diff 对 generic 路径零改动：

- POSIX：`buildInteractiveExecFragment` 的 kimi 分支、generic 文件分支（:216-224）、generic inline 分支（:226）均无 hunk；opencode 分支为纯新增且置于 generic 之前，只拦截 `id === "opencode"`。
- Windows：`buildWindowsCommandLine` 无 promptFile 分支（:338 `cd /d … && …`）未动；pf 分支对非 kimi/opencode（含 `agentId` 缺省 → `id=""`）走 `& tokens $task`，与旧行逐字节相同。`buildWindowsModeCScript` 同理（`"" !== "kimi"` 为 true → 旧路径；invoke 三元对非 opencode 取旧串）。
- 形参均为可选（`agentId?: string`），缺省调用 = 旧行为。

[executed] 实证（上节矩阵）：claude/pi/grok/unknown-x/无 agentId 的 POSIX 片段均为 `CMSPARK_TASK=$(cat '<pf>') && exec '<cmd>' "${CMSPARK_TASK}"`，Windows 均为 `& '<cmd>' $task`——与 diff 删除行形状一致。

**Verdict on claim: HOLD.**

### C4 — 无夹带改动

[inspected] 补丁恰好 4 文件、全部 hunk 可归因：open-local-terminal.ts（注释块更新 + 两条 P1 修复 + 两个形参 + 两处调用点透传）、message-router.ts（实现者已声明的 B1/B2 两条文案）、两个测试文件（6 条新增测试，纯追加）。无格式化churn、无未声明重构、无配置/依赖改动。

### C5 — 文案 B1/B2 与 UI 术语一致性

[inspected]+[executed grep]：

- 新串 1 `笔记库导出未配置（请在 设置 → 导出与集成 填写笔记库路径）`（message-router.ts:2049-2053）——「导出与集成」命中 `SettingsSlideout.tsx:3000` 设置区标题，`笔记库路径` 命中 :3006 表单项 label。一致。
- 新串 2 `笔记库分析失败: …`（:3328）——与同 handler 既有串 `笔记库路径未设置…`（:3266）、`未识别到笔记库结构化约定…`（:3297）及 UI 按钮「刷新笔记库档案」（:3042）术语一致。
- 同型残留：同 handler 内 `vault 路径不存在`（:3278）、`vault 路径不是目录`（:3281）仍为 vault 术语——见 Findings P2-A2-1。另 grep 确认全文件无残留 `obsidian export not configured` / `vault 分析失败` 旧串。

---

## Hostile questions

### Q1. opencode inline 变体的单引号转义是否覆盖新分支？任务含 `'``$` 会注入吗？

不会 [executed]：inline 走 `shellSingleQuote`（`'` → `'\''`），实证 `it's a \`test\` $HOME` 被正确闭合为字面量；文件变体正文走 `$(cat)` 文件读取，不经插值。Windows 侧正文走 `Get-Content -LiteralPath -Raw` 赋 `$task` 变量，原生传参。无新增注入面。

### Q2. agentId 大小写/缺省会不会绕过分支？

不会 [inspected]：三处均 `(agentId || "").toLowerCase()`；缺省 → `""` → generic 旧行为（字节不变）。discover/manager 传入的 agent_id 为小写注册表键（上一轮 lane-a 已核实）。

### Q3. Windows ps1 的 `--prompt $task` 中任务含双引号会怎样？

PowerShell 5.1 原生传参对嵌入双引号的引用缺陷为**既有暴露**（claude/grok/generic 的 `& cmd $task` 同形态已存在），本 diff 未扩大该面，opencode 只是并入同一既有模式。不记 finding。

### Q4. `--prompt` 若被未来 opencode 版本改语义/移除？

属上游演进风险；当前官方文档一手来源确认 flag 存在且语义为 "Prompt to use"。既有 launch-presets 对全部 agent 均承担同类上游漂移风险，非本 diff 特有问题。

### Q5. 修复有没有漏掉 opencode/kimi 之外的同型 agent？

[inspected] 注册表其余 agent：claude（`claude [prompt]` trailing 正确）、pi（`pi [messages…]` trailing 正确）、grok（`grok [prompt]` trailing 正确，上一轮已 [executed] 核实）。无第四条特殊路径需求。

---

## Findings

| ID | Severity | 摘要 | 证据 |
|----|----------|------|------|
| P2-A2-1 | P2 | `obsidian.refresh_profile` 同 handler 内仍残留 `vault 路径不存在`/`vault 路径不是目录`（:3278/:3281），与 B2 新术语「笔记库」不一致 | [inspected] `message-router.ts:3278,3281` vs `:3266,3297,3328` |
| P2-A2-2 | P2 | opencode `--prompt` 当前上游语义为**预填输入框**（需用户按 Enter 提交），代码注释（:205-206, :329）只引文档未注明该 caveat；不影响 P1 成立性（任务已进入会话 UI），但用户预期宜在文档/注释中校准 | [fetched] [sst/opencode#4700](https://github.com/sst/opencode/issues/4700)、[sandcastle#795](https://github.com/mattpocock/sandcastle/issues/795) |

无 P0、无 P1。

观察项（不计分）：kimi Windows L0/L1 粘贴行不含任务文件引用（仅 banner goalHint）——与 POSIX kimi 上一轮已接受的裸启动设计对齐，属 parity 而非新缺口；lane-c2 若记录覆盖缺口可交叉引用。

---

## Targeted tests [executed]

`.test-dist` 编译产物与源码同步（22:28 编译，含 opencode 分支；grep 编译产物确认）。未重新编译、未跑 `npm test`（按 lane 约束）。

```
cd companion && node --test .test-dist/tests/acp-open-local-terminal.test.js \
  .test-dist/tests/acp-discover.test.js \
  .test-dist/tests/acp-diff-apply.test.js \
  .test-dist/tests/acp-handlers-gates.test.js
```

**86 pass / 0 fail / 0 cancelled / 0 skipped**（516ms）——与编排者实测数字一致。其中本 diff 新增 6 条全部在列：open-local-terminal 5 条（kimi L1 裸启动 / opencode L1 `--prompt $task` / kimi 粘贴行裸启动 / opencode 粘贴行 `--prompt` / POSIX opencode 双变体精确相等断言）+ handlers-gates 1 条（manager `resolveProtocolArgs(session.agent_id, server.args)` 接线，mock `tryStartProtocolSession` 捕获 argv，kimi/opencode→`["acp"]`、claude/grok→`[]`）。

其他 [executed] 记录：`node -e` 构造器实证矩阵（C1/C2/C3 各表）；`kimi --help`（0.23.6，usage `kimi [options] [command]` 无 prompt positional）；grep 确认无第三条 `$task` 生成路径、无旧错误串残留；`git status --porcelain` 确认评审未污染工作区（仅新增本报告）。

---

## Claim scoreboard

| ID | Result | Evidence |
|----|--------|----------|
| C1 opencode POSIX `--prompt`（file/inline 双变体 + 转义） | HOLD | [inspected]+[executed] |
| C1 opencode Windows `--prompt $task`（L1 + 粘贴行） | HOLD | [inspected]+[executed] |
| C1 `--prompt` flag 官方文档存在性 | HOLD | [fetched] opencode.ai/docs/cli |
| C2 kimi Windows 裸启动（L1/L0/粘贴行无 `$task`/任务文本） | HOLD | [inspected]+[executed] |
| C2 `agentId` 形参透传完整（2 构造器 + 3 调用点，无遗漏路径） | HOLD | [inspected]+[executed grep] |
| C2 kimi CLI 事实（positional=子命令） | HOLD | [executed] `kimi --help` |
| C3 claude/pi/grok/未知/缺省 agentId 逐字节回归 | HOLD | [inspected]+[executed] 实证矩阵 |
| C3 POSIX kimi 未动 | HOLD | [inspected] diff 无 hunk |
| C4 无夹带改动 | HOLD | [inspected] 380 行补丁逐 hunk |
| C5 文案 B1/B2 与 UI 术语一致 | HOLD（2 处同型残留记 P2） | [inspected]+[executed grep] |

两条上一轮 P1 均修复到位、转义与透传无遗漏、回归面逐字节保持、测试钉住修复行为且 86/86 绿。残留 2 条 P2 nit（vault 术语残留、`--prompt` 预填语义注释缺失），不阻断。

VERDICT: APPROVE_WITH_NITS
