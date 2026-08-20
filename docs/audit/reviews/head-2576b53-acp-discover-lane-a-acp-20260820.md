# Lane A (ACP discover grok/kimi/opencode) — independent adversary

**Date**: 2026-08-20
**Reviewer**: lane-a-acp（未参与实现；不信任 PR 描述，全部结论自读活码 + 亲自执行）
**Repo**: `C:/Users/HuChen/Projects/cmspark`（Windows + Git Bash 实测）
**Range**: `2b97cfa..2576b53`（PR #206，HEAD = `2576b53`）
**Frozen patch**: `docs/audit/reviews/head-2576b53-acp-discover-diff-20260820-211701.patch`
**Scope**: `companion/src/acp/{discover,launch-presets,index,manager,open-local-terminal}.ts`、`companion/src/message-router.ts` 本 range 变更、`companion/src/obsidian/folder-picker.ts`。chrome-extension 文案归 lane-b，此处不重复评分。

## Patch freshness

[executed] `git diff 2b97cfa..2576b53 | diff - docs/audit/reviews/head-2576b53-acp-discover-diff-20260820-211701.patch` → **无输出，字节一致（PATCH_MATCHES）**。补丁不陈旧。评审开始前工作区干净；本人编译 `companion/.test-dist`（tsc，见下）未污染 git 工作区 [executed] `git status --porcelain` 仅见既有未跟踪评审产物；`git check-ignore companion/.test-dist` → IGNORED。

## Capability declaration（Trust / ADR-020 轴向，本范围）

| Axis | 本 range 行为 | Lane A |
|------|---------|--------|
| Surface | ACP discover 增加 3 个 probe；agent 启动本质就是执行发现的 CLI（既有 Surface） | **Hold**——发现阶段**不执行**任何找到的二进制（仅 `which`/`where` + `stat/access`，无 `--version` spawn），信任面未在发现阶段扩大 |
| L2-classes | 无新增 | **Hold** |
| Trust | 无新 `auto_approve_*` 写、无 whitelist 写、无 confirm 跳过。`onPermission` → `permissionGate` 链路未动 | **Hold（单调）** |
| Spawn 安全 | `spawnAcpChild` `shell:false`，argv 直传；Windows cmd wrap 走 `argvForCmdWrap` 过滤 + pin System32 | **Hold**（win-spawn.ts 本 range 0 commit，[executed] `git log 2b97cfa..2576b53 -- win-spawn.ts` 为空） |

## Method

1. 读活码：`discover.ts`、`launch-presets.ts`、`manager.ts`（resolveServer/start/startCliBridge）、`protocol-session.ts`、`win-spawn.ts`、`open-local-terminal.ts` 全文、`folder-picker.ts` 全文、`message-router.ts` diff hunk。
2. [executed] 本机恰好安装 kimi 0.23.6 与 grok 0.2.119 —— 直接运行其 `--help`/`--version` 核实 preset 事实（比 WebSearch 权威）；opencode 本机未装，用 WebSearch 多源核实。
3. [executed] 定向测试（未跑 `npm test`）：`.test-dist` 陈旧（00:31 vs src 21:16），先 `npx tsc -p tsconfig.test.json`（exit 0），再 `node --test` 三个目标测试。

---

## Claims

### C1 — discover：grok/kimi/opencode 探针与 vendor 目录真实有效

**Claim**：三 agent 可被 PATH 或厂商安装目录发现。

**Code** [inspected]：`discover.ts:53-157` PROBES。机制 = 先 `whichOnPath(basename)`（PATH），miss 则 `commonPaths` 逐个 `isExecutableFile`（stat + X_OK）。`vendorBins`（44-51）win32 下追加 `.exe`/`.cmd` 变体；`nvmNodeBins`（32-41）取 nvm 最近 3 个版本目录。

**Probes** [executed]：编译产物实测 `discoverCodingAgents(true)`（Windows 本机）：

```
claude → C:\Users\HuChen\AppData\Local\nvm\v24.18.0\claude.cmd (path)
pi     → ...\nvm\v24.18.0\pi.cmd (path)
grok   → C:\Users\HuChen\.grok\bin\grok.exe (path)
kimi   → C:\Users\HuChen\.kimi-code\bin\kimi.exe (path)
```

`~/.grok/bin/grok.exe`、`~/.kimi-code/bin/kimi.exe` 与 `vendorBins` 生成的候选**逐字节吻合**；`where` 命中、`.exe` 被 `pickWindowsWhereHit` 正确选中。`listCodingAgentProbes()` 返回 7 个 id 全齐。

**发现阶段不执行二进制** [inspected]：全文无对 discovered binary 的 spawn/exec（`execFileSync` 只调 `which`/`where`）。PATH 被劫持时，发现阶段最坏是**列出**攻击者路径；执行发生在用户确认启动 agent 时——那是功能本身，非本 range 扩大的信任面。

**Windows/Unix 路径解析** [inspected]：Windows `where.exe` pin 到 `SystemRoot\System32\where.exe`（`discover.ts:210-214`）且子进程 env PATH=`hardenPath()`；命中排行 `.exe>.cmd>非shebang>shebang(拒)` + sibling shim + cmd-shim unwrap（win-spawn.ts，既有测试覆盖）。Unix 侧 `which` 为裸名调用（211 行），依赖 `process.env.PATH`——**既有代码**（[executed] `git log -S 'return "which"'` → 3c31589，非本 range），见 P2-A4。

**输出解析**：`which`/`where` 输出按 `\r?\n` 切分 trim；Unix 取第一个可执行行；Windows 走排行器。2s timeout + stdio 忽略 stderr。健壮。

**Verdict on claim: HOLD.**

### C2 — launch-presets 三个 preset 的 CLI 事实

**Claim**：grok `--prompt-file` 单轮；kimi `-p` print；opencode `run` headless + prompt 尾随；kimi/opencode ACP 子命令 `acp`。

**Fact-check** [executed]（本机 kimi 0.23.6 / grok 0.2.119 `--help` 原文）+ [WebSearch]（opencode）：

| preset | 核实结果 | 证据 |
|--------|---------|------|
| `kimi: ["-p","--output-format","text"]` | **正确**。`-p, --prompt <prompt>` "Run one prompt non-interactively and print"；`--output-format` choices `text`/`stream-json`，默认 text | [executed] `kimi --help` |
| `ACP_PROTOCOL_ARGS.kimi=["acp"]` | **正确**。`acp` 子命令："Run kimi-code as an Agent Client Protocol (ACP) server over stdio" | [executed] `kimi --help`；[claudian#983](https://github.com/YishenTu/claudian/issues/983) |
| kimi 注释 "-p 不可与 -y/--auto 同用" | **与项目知识一致** | `memory/project-knowledge.md:816` [inspected] |
| `grok: ["--prompt-file","{{prompt_file}}","--output-format","plain"]` | **正确**。两 flag 均存在（`--prompt-file <PATH>` "Single-turn prompt from a file"；`--output-format` possible values 含 `plain` 且为默认） | [executed] `grok --help` |
| grok 无 ACP 子命令 → `ACP_PROTOCOL_ARGS` 不含 grok | **事实成立**：子命令列表无 `acp`；`grok agent stdio`（"Run the agent over stdio"）是 grok 的 stdio agent 入口，测试固化 `resolveProtocolArgs("grok",["agent","stdio"])` 暗示知情的手动配置路径。缺省裸 spawn → 5s 握手超时 → fail-soft 回退 CLI bridge（与 claude 既有行为一致） | [executed] `grok --help` / `grok agent stdio --help`；`acp-diff-apply.test.ts` 新断言 |
| `opencode: ["run"]` + append prompt | **正确**。`opencode run <message…>` 为 headless 非交互，prompt 是末尾 positional | [ComputingForGeeks cheat sheet](https://computingforgeeks.com/opencode-cli-cheat-sheet/)；[lobehub opencode-cli](https://lobehub.info/skills/spillwavesolutions-opencode_cli)；[anomalyco/opencode#28407](https://github.com/anomalyco/opencode/issues/28407) |
| `ACP_PROTOCOL_ARGS.opencode=["acp"]` | **正确**。`opencode acp` = "Agent Client Protocol over stdin/stdout (IDE bridge)" | 同上 cheat sheet；[hermes-agent#19493](https://github.com/NousResearch/hermes-agent/issues/19493)；[AionUi ACP-Setup](https://github.com/iOfficeAI/AionUi/wiki/ACP-Setup) |

**env/cwd/转义** [inspected]：`startCliBridge`（manager.ts:622+）prompt 写 `os.tmpdir()/cmspark-acp-<sid>.md`（`wx` 独占 + 0o600）→ `resolveLaunchArgs` 展开 `{{prompt_file}}`；`spawnAcpChild` `shell:false` argv 直传，无 shell 注入面；prompt 同时写 stdin（manager.ts:683-684 `child.stdin.write(prompt)`），与 preset 头注释一致。`resolveLaunchArgs` 对 kimi 用 `injectMissingFlagValue` 把 prompt 注入 `-p` 后——[executed] 测试断言 `args[0]==="-p", args[1]==="review me"` 通过。`resolveProtocolArgs` configured args 优先语义正确；`resolveServer` 发现路径 `args:[]`（manager.ts:270），故 kimi/opencode 协议尝试得到 `["acp"]`，配置路径用户自定义优先。env 由 `buildAcpAgentEnv` 构造（本 range 未改）。

**Verdict on claim: HOLD.**

### C3 — open-local-terminal：引用/转义与 per-agent argv 约定

**POSIX 侧** [inspected]：`shellSingleQuote`（`'\''` 转义）覆盖 cwd/command/promptFile/inline prompt；任务正文走 `CMSPARK_TASK=$(cat <quoted file>)`，不经插值；`agentId` 只用于分支选择，**不进脚本**。banner 的 label/hint 剥离 `'` 与换行。命令必须绝对路径（`rejectNonAbsoluteCommand` + realpath）。

**Windows 侧** [inspected]：PS1 全部 `-LiteralPath` + 单引号字面量（`quotePowerShellLiteral`），prompt 走 `Get-Content -Raw` 赋 `$task`，无正文插值；`start` 行全 token 双引号（R7）；System32 cmd/powershell pinned（F5）。

**kimi 特例（POSIX）**：`kimi` 不传任务位置参数 → `exec <cmd>`。**事实正确** [executed]：`kimi --help` usage 为 `kimi [options] [command]`，**无 prompt positional**，`[command]` 是子命令（acp/web/login/export…）——传入任务文本会被 commander 当未知子命令处理。PR 注释与事实一致。

**codex 分支删除**：旧代码 codex 分支与 generic 分支函数体**逐字相同**（均 `return \`${load} && exec ${cmd} "\${CMSPARK_TASK}"\``），删除为等价清理，无行为变更 [inspected]。

**grok 走 generic 尾随参数**：**事实正确** [executed]：`grok [OPTIONS] [PROMPT] [COMMAND]`，`[PROMPT]` 即"Initial prompt for the interactive session, e.g. `grok "fix the bug"`"。

**但同类适配不完整——见 Findings P1-A1 / P1-A2。**

### C4 — manager.ts / index.ts / message-router.ts / folder-picker.ts 无夹带

- `manager.ts` [inspected]：单行 `args: resolveProtocolArgs(session.agent_id, server.args)`（540 行）。行为变更 = kimi/opencode 协议握手注入 `["acp"]`（PR 核心意图），其余 agent `[]` 与旧行为一致。无夹带。
- `index.ts`：纯 export 扩展（`listCodingAgentProbes`、`resolveProtocolArgs`、`ACP_PROTOCOL_ARGS`）。
- `message-router.ts`：2 处纯文案（错误消息 + profile_ready reason）。引用的「设置 → 导出与集成」[executed] grep 确认存在于 `SettingsSlideout.tsx:3000`。消息 `type: "obsidian.profile_ready"` 未变，逻辑未动。
- `folder-picker.ts`：macOS/Linux 标题换文案（常量）；Windows 新增 `$d.Description`（`'…'` 单引号 doubling 转义）。三平台插值均安全：macOS 常量无 `"`/`\`；zenity `--title=` 为独立 argv；PowerShell 字面量转义正确。无行为变更。

**Verdict on claim: HOLD.**

---

## Hostile questions

### Q1. 发现过程会不会执行攻击者二进制（PATH 劫持 → RCE）？

**不会（发现阶段）。** [inspected] discover 只调用 `which`/`where`（`execFileSync`，2s timeout）+ `fs.statSync/accessSync`。无任何对 discovered binary 的 spawn。`--version` 探测不存在。执行发生在 `manager.start`（用户发起会话）——该路径本就是"运行用户机器上的 agent CLI"，且 Windows 有 where pin + shim unwrap + cmd wrap 过滤。残余：Unix 裸 `which` 本身经 PATH 解析（P2-A4，既有代码）。

### Q2. kimi/opencode 的 `acp` argv 会不会被用户配置意外覆盖/串味？

**语义清晰** [inspected]：`resolveProtocolArgs` configured 非空则全量采用（用户对自己 config 负责），否则 preset。`resolveLaunchArgs`（CLI bridge）与 `resolveProtocolArgs`（ACP 握手）分离，不会把 `-p/--output-format` 混进 ACP 握手（发现路径 `server.args=[]`）。配置路径若用户给 kimi 配了 `["-p"]`，则 ACP 握手也会用 `["-p"]`——但那是用户显式配置，`protocol:"acp"` 语义下自负其责；且 `protocolMode` 默认 auto，握手失败回退 bridge。可接受。

### Q3. Mode C 对新三 agent 的交互 exec 是否都正确？

**否——两条确定性缺陷**（Findings P1-A1/P1-A2）：

- **opencode（全平台）**：`buildInteractiveExecFragment` 无 opencode 特例 → generic 路径 `exec opencode "$CMSPARK_TASK"`。而 opencode 根命令 positional 是 **project 目录**（`opencode [project]` 启 TUI，[cheat sheet 核实](https://computingforgeeks.com/opencode-cli-cheat-sheet/)），任务 Markdown 会被当成目录路径——任务永远进不了 TUI。PR 已对同类问题（kimi positional=子命令）建立认知并加了特例，却漏了 opencode（positional=project path，同类不同形）。`open-local-terminal.ts:174-179` 注释列了 claude/pi/grok/kimi/others，opencode 落入 "others: trailing prompt arg"——**事实错误**。
- **kimi（Windows）**：POSIX 特例未延伸到 Windows。`buildWindowsModeCScript`（330-338）**无 agentId 形参**，`openLocalTerminalForAgent` win32 分支（1205-1213）不传 agentId → PS1 必含 `& '<kimi.exe>' $task`；paste line `buildWindowsCommandLine`（1067-1068）同样 `& … $task`。kimi 收到任务 positional → commander unknown command。本机 kimi 为 PE（`kimi.exe`）→ `modeCWindowsLevelForSpec` 判 L1 → **必现**。

### Q4. 转义面有没有因为新增 agent 名/路径扩大？

**没有。** agentId 不进任何脚本文本（仅分支键）；command 一律绝对路径 + 平台引用；任务正文全平台走文件读取（POSIX `$(cat)` / Windows `Get-Content -LiteralPath -Raw`），无正文插值点。folder-picker 三平台插值均为常量或正确转义。

### Q5. nvmNodeBins 版本排序是否正确？

**字符串排序，非语义版本排序** [inspected]：`readdirSync(nvm).sort().reverse().slice(0,3)`——`"v9.x"` 字符串序大于 `"v24.x"`，>3 个版本目录时可能漏掉实际最新版。影响仅为 fallback 发现不到（PATH 优先，且这只是候选枚举），既有 claude Caskroom 分支同款模式，本 range 提取复用到 pi/grok/kimi/opencode。P2-A3。

---

## Findings

| ID | Severity | 摘要 | 证据 |
|----|----------|------|------|
| P1-A1 | P1 | opencode Mode C（全平台）把任务文本当 project-path positional，任务永远进不了 TUI | [inspected] `open-local-terminal.ts:181-215` 无 opencode 特例；[WebSearch] `opencode [project]` positional=目录 |
| P1-A2 | P1 | kimi Mode C Windows 路径未应用本 PR 的 positional 特例，PS1/paste line 必带 `$task` → kimi unknown command | [inspected] `buildWindowsModeCScript` 无 agentId（330-338）、调用点 1205-1213、`buildWindowsCommandLine` 1067-1068；[executed] `kimi --help` 无 prompt positional |
| P2-A3 | P2 | `nvmNodeBins` 字符串排序版本比较不正确，>3 版本时或漏最新 | [inspected] `discover.ts:36`；既有模式提取复用 |
| P2-A4 | P2 | Unix `which` 裸名调用依赖 `process.env.PATH`（PATH 污染可执行恶意 which）；Windows 已 pin System32 | [inspected] `discover.ts:211,223`；**既有代码**（3c31589），非本 range 引入 |
| P2-A5 | P2 | grok 无 ACP 默认 argv → 每次 start 裸 spawn TUI 等 5s 握手超时再回退 bridge（fail-soft，与 claude 一致）；`grok agent stdio` 入口未文档化 | [executed] `grok agent stdio --help`；[inspected] `protocol-session.ts:136` 5000ms 超时 |
| Nit-A6 | P2 | `obsidian.profile_ready` 消息 type / `companion/src/obsidian/` 模块命名仍叫 obsidian，文案已泛化为 Markdown/笔记库——命名与文案不完全自洽（仅记录，勿在本 PR 扩大改动） | [inspected] `message-router.ts:3293`、`folder-picker.ts` |
| Nit-A7 | P2 | folder-picker macOS 常量插值未做 AppleScript 转义（当前常量无 `"`/`\`，安全；同文件 `pickFileMacOS` 对动态 prompt 有转义，模式不一致） | [inspected] `folder-picker.ts:46` vs `:116` |

### P1-A1 详述

- **File**: `companion/src/acp/open-local-terminal.ts:181-215`（`buildInteractiveExecFragment`），注释块 174-179
- **Sev**: P1（阻断：PR 新声称支持的 agent 在其声称的 Mode C 路径上确定性失效）
- **Evidence**: [inspected] 分支仅识别 `kimi`；opencode 落入 generic `CMSPARK_TASK=$(cat …) && exec <cmd> "${CMSPARK_TASK}"`。opencode 根命令 `opencode [project]` 的 positional 是项目目录（[OpenCode CLI Cheat Sheet](https://computingforgeeks.com/opencode-cli-cheat-sheet/)：`opencode [project]` — "Launch the TUI in the given directory"），多行 Markdown 任务串不是目录 → 报错或异常，任务不会成为会话输入。Windows 侧 PS1（`buildWindowsModeCScript`）与 paste line（`buildWindowsCommandLine`）同样 `& opencode $task`，一并失效。
- **Why not P2**: 非文案/nit——这是 PR 新增 preset 的 agent 在 PR 自己更新的 Mode C 代码路径（注释明写 agentId 列表含 opencode）上的确定性功能失败；PR 已对 kimi 的同类 positional 问题建立认知，漏修 opencode 属同类别不完整。
- **Suggestion**: 与 kimi 同法——`id === "opencode"` 时裸 `exec ${cmd}`（TUI 在 cwd 打开，用户粘贴任务；cwd 已由 banner `cd` 保证），勿传 trailing arg；注释补一条 opencode 约定。

### P1-A2 详述

- **File**: `companion/src/acp/open-local-terminal.ts:330-374`（`buildWindowsModeCScript`）、`:299-314`（`buildWindowsCommandLine`）、调用点 `:1067-1068, 1205-1213`
- **Sev**: P1（与 P1-A1 同根：Mode C per-agent argv 约定只在 POSIX 片段实现）
- **Evidence**: [inspected] Windows PS1 构造器无 `agentId` 形参，对所有 agent 一律 `& '<cmd>' $task`；[executed] 本机 kimi = `.kimi-code\bin\kimi.exe`（PE）→ `modeCWindowsLevelForSpec` → L1 → `& 'C:\Users\HuChen\.kimi-code\bin\kimi.exe' $task` 必现；`kimi --help` usage `kimi [options] [command]` 无 prompt positional → commander unknown command。POSIX 同场景本 PR 已修为裸 `exec`。
- **Suggestion**: `buildWindowsModeCScript`/`buildWindowsCommandLine` 增加 `agentId` 形参，`kimi`（及修复后的 `opencode`）时省略 `$task` 调用（仅打开 TUI）。paste line 同步。

---

## Targeted tests [executed]

`.test-dist` 原为陈旧产物（00:31，不含本 range 测试），先编译：

```
cd companion && npx tsc -p tsconfig.test.json        → exit 0
node --test .test-dist/tests/acp-discover.test.js \
            .test-dist/tests/acp-open-local-terminal.test.js \
            .test-dist/tests/acp-diff-apply.test.js
```

**71 pass / 0 fail / 0 cancelled**（528ms）。其中本 range 新增：`probes grok / kimi / opencode with vendor install dirs`、`discovers grok and kimi when their vendor bins exist on this host`（本机真实发现 grok+kimi）、`uses grok --prompt-file for CLI bridge`、`injects kimi -p prompt and uses acp protocol args`、`appends opencode run prompt and uses acp protocol args`、`kimi Mode C does not pass the task as a positional` 全部通过。未跑 `npm test`。

其他 [executed] 记录：`kimi.exe --help` / `grok.exe --help` / `grok.exe agent --help` / `grok.exe agent stdio --help` / `kimi --version`（0.23.6）/ `grok --version`（0.2.119）；discover 实测（上文 C1 表）；grep「导出与集成」命中 `SettingsSlideout.tsx:3000`；`git status` 确认评审未污染工作区。

---

## Claim scoreboard

| ID | Result | Evidence |
|----|--------|----------|
| C1 discover 探针/vendor 目录 | HOLD | [executed] 本机扫到 grok.exe/kimi.exe |
| C1 发现不执行二进制（PATH 劫持安全） | HOLD | [inspected] 无 spawn discovered binary |
| C2 kimi `-p`/`--output-format text` preset | HOLD | [executed] `kimi --help` |
| C2 kimi `acp` 协议 argv | HOLD | [executed] `kimi --help` + web 多源 |
| C2 grok `--prompt-file`/`plain` preset | HOLD | [executed] `grok --help` |
| C2 opencode `run`/`acp` | HOLD | WebSearch 多源（cheat sheet / hermes-agent#19493 / AionUi wiki） |
| C3 kimi POSIX positional 特例 | HOLD（事实正确） | [executed] `kimi --help` 无 prompt positional |
| C3 grok generic trailing prompt | HOLD | [executed] `grok --help` `[PROMPT]` |
| C3 opencode Mode C | **REJECT**（P1-A1） | [inspected]+[WebSearch] |
| C3 kimi Windows Mode C | **REJECT**（P1-A2） | [inspected]+[executed] |
| C4 manager/index/message-router/folder-picker 无夹带 | HOLD | [inspected]+[executed grep] |
| Trust 单调（无新 auto-approve/confirm skip） | HOLD | [inspected] |

两条 P1：PR 声称的 Mode C 适配矩阵对 opencode（全平台）与 kimi（Windows）确定性失效，修复各约一行分支/一个形参，属本 PR 范围内的事实性遗漏。

VERDICT: REQUEST_CHANGES
