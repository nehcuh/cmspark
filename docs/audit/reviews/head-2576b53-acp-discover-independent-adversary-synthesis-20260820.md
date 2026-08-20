# 三路独立对抗合成 — `2576b53`（PR #206 ACP discover grok/kimi/opencode）

**日期**: 2026-08-20
**对象**: `2b97cfa..2576b53`（本次 `git pull` 引入的唯一未评审头：PR #206「feat(acp): discover grok, kimi, and opencode coding agents」+「fix(ui): describe conversation export as Markdown, not Obsidian」）
**范围说明**: 同次 pull 的另两个 PR 已有在库评审产物（batch2 → #203；windows-nsis-official → #204），本轮不重复评审
**方法**: 三路独立 agent 读 frozen patch + 活码 + 定向执行；不信任实现会话；本会话（编排/合成）未参与实现，亦未自评放行任何路

Frozen patch: `docs/audit/reviews/head-2576b53-acp-discover-diff-20260820-211701.patch`（三路各自 [executed] 校验与 `git diff 2b97cfa..2576b53` 字节一致）

## 参与路

| 路 | 范围 | 裁决 |
|----|------|------|
| **A ACP** | discover / launch-presets / manager / open-local-terminal / message-router / folder-picker | **REQUEST_CHANGES**（P1×2, P2×5） |
| **B UI 文案** | chrome-extension 9 文件 + 文档；Obsidian→Markdown 文案 | **APPROVE_WITH_NITS**（P2×5） |
| **C 测试/变异** | 新增测试质量、编译产物变异、全量回归、独立复验 A 的 P1 | **REQUEST_CHANGES**（P1×2, P2×6） |

报告：

- `docs/audit/reviews/head-2576b53-acp-discover-lane-a-acp-20260820.md`
- `docs/audit/reviews/head-2576b53-acp-discover-lane-b-uicopy-20260820.md`
- `docs/audit/reviews/head-2576b53-acp-discover-lane-c-tests-20260820.md`

## 合成裁决

**REQUEST_CHANGES.** 两条 P1 被 A、C 两路**独立**发现并经 C 用编译产物实测 + 一手外部文档/源码复验，双双成立：

| ID | 缺陷 | 证据（两路独立） |
|----|------|------------------|
| P1-1（A1/C-F1） | **opencode Mode C（全平台）任务文本被当 `opencode [project]` positional**：`buildInteractiveExecFragment` 只对 kimi 特例，opencode 落入 generic `exec opencode "$CMSPARK_TASK"`；opencode 根命令 positional 是项目目录 → 任务永远进不了会话。POSIX/Windows 同构 | [inspected] `open-local-terminal.ts:181-215`；[executed] 编译产物生成 `exec 'opencode' "${CMSPARK_TASK}"`；[fetched] opencode 官方 CLI 文档 |
| P1-2（A2/C-F2） | **kimi Mode C 的 positional 特例只在 POSIX 片段实现**：Windows `buildWindowsModeCScript`/`buildWindowsCommandLine` 无 `agentId` 形参，必生成 `& kimi $task`；kimi 根命令（typer Group）无 positional 形参 → click `No such command`，任务丢失。本机 kimi 为 PE 走 L1，必现 | [inspected] `open-local-terminal.ts:299-374, 1067-1068, 1205-1213`；[executed] 编译产物生成实际 ps1/paste line；[fetched] kimi-cli 一手源码 + 本机 `kimi --help` |

修复方向（各路一致，均为小改动）：

- P1-1：opencode 同 kimi 法——裸 `exec ${cmd}` 开 TUI（任务由用户粘贴），或用 TUI 官方 `--prompt` flag；补 opencode 的 Mode C 用例。
- P1-2：`buildWindowsModeCScript`/`buildWindowsCommandLine` 增加 `agentId` 形参，kimi/opencode 时省略 `$task`（或 `& kimi --prompt $task`）；补 Windows 构造器用例。

## 已确认成立的关键声称（三路重放）

| 声称 | 结果 | 证据 |
|------|------|------|
| 三 preset CLI 事实（kimi `-p`/`--output-format text`/`acp`；grok `--prompt-file`/`plain`；opencode `run`/`acp`） | HOLD | A 本机 `kimi/grok --help` [executed]；opencode WebSearch 多源 |
| 发现阶段不执行任何发现的二进制（PATH 劫持在发现期无 RCE 面） | HOLD | A [inspected] 仅 `which/where`+stat，无 spawn discovered binary |
| Windows `where.exe` pin System32 + 硬化 PATH；argv `shell:false` 直传 | HOLD | A [inspected] |
| kimi POSIX Mode C 不传 task positional（事实正确） | HOLD | A/C [executed] `kimi --help` usage 无 prompt positional |
| manager/index/message-router/folder-picker 无夹带行为变更 | HOLD | A [inspected] 逐 hunk |
| UI 11 文件逐 hunk 纯文案；无「导出到 Obsidian」残留（余 2 处 Obsidian 字样为有意保留且属实） | HOLD | B [inspected] + 全仓 grep |
| 导出复选框三入口接线 `include_reasoning`，无过度承诺 | HOLD | B [inspected] |
| Trust 单调：无新 auto-approve / 白名单写 / 确认跳过；L2 链路未动 | HOLD | A/B/C 各自 [inspected] |
| 新增断言为真断言且变异敏感（discover 注册表 / kimi 特例 / `-p` 注入三处变异均验红） | HOLD | C [executed] 变异 A/B/C，验红后恢复 `cmp` 字节一致 |

## 残留 nits（非阻断，合并三路）

| ID | 路 | Sev | 摘要 |
|----|----|-----|------|
| N1 | C | P2 test | `manager.ts:540` `resolveProtocolArgs` 接线无测试：变异回退 `server.args \|\| []` 后 acp 82/82 仍绿——本 PR 核心接线可静默回退 |
| N2 | C | P2 test | vendor bins 用例宿主条件性空转（CI 无对应二进制时零断言通过） |
| N3 | C | P2 观察 | kimi POSIX 修复 = 开裸 TUI 丢任务全文；kimi 有 `--prompt` 交互通道未用；新测试把「丢任务」钉成规格——产品裁决 |
| N4 | C | P2 test | `nvmNodeBins`/`vendorBins` win32 变体/`windowsCommonAgentPaths` 无直接断言 |
| N5 | C→A | P2 观察 | kimi bridge 预设 `-p`+`--output-format text` 与 kimi-cli 文档「output-format 须配 `--print`」契合度存疑，未端到端验证 |
| A3 | A | P2 | `nvmNodeBins` 字符串排序非语义版本排序，>3 版本时或漏最新（既有模式复用） |
| A4 | A | P2 | Unix 裸 `which` 依赖 `process.env.PATH`（既有代码 3c31589，非本 range） |
| A5 | A | P2 | grok 无 ACP 默认 argv → 每次 start 等 5s 握手超时回退 bridge（fail-soft，与 claude 一致）；`grok agent stdio` 未文档化 |
| A6/A7 | A | P2 | obsidian 命名未随文案泛化（仅记录）；folder-picker macOS 常量插值模式与同文件转义模式不一致（当前常量安全） |
| B1/B2 | B | P2 | companion 2 条错误串残留旧术语（`obsidian export not configured` 几乎不可达；`vault 分析失败` 用户可见） |
| B3 | B | P2 | 会话导出 .md 无条件内嵌 Obsidian callout（`[!info]-` 等）——「导出为 Markdown」属实但非通用 Markdown；helpText 已披露 |
| B4/B5 | B | P2 | 内部命名/仓库文档保持 Obsidian 品牌（自洽/不在本 PR 范围，仅记录） |

## 机器（对抗路自行跑，非实现会话自评）

- A：[executed] acp 三测试文件 **71/71**；本机真实 `discoverCodingAgents(true)` 扫到 claude/pi/grok/kimi 且与 vendorBins 候选逐字节吻合；`kimi/grok --help`、`agent stdio --help`、`--version` 实测
- B：[executed] chrome-extension 全量 **771/771** + 定向子集 18/18
- C：[executed] companion 全量 3095 tests / 3025 pass / **61 fail 逐条归类为 Windows 宿主环境失败**（EPERM/AF_UNIX/POSIX 断言/共享 home 竞争，与 range 无交集；`m10-abort-orphans` 隔离重跑 5/5 反证）；本 range 6 个新/改用例全 PASS；变异 4 处（3 红 1 绿=N1）；三路评审后 `git status --porcelain` 干净

## Trust / ADR-020

```
Surface:      ACP discover 横向扩 3 个 probe（只读探测，既有 Surface）
L2-classes:   none new
Compose:      none new
Autonomy:     single
Trust:        单调——无新 auto_approve_*、无 whitelist 写、无 confirm 跳过；session start/apply_diff 仍 L2 HITL
Channel:      community
```

VERDICT: REQUEST_CHANGES（修掉 P1-1 / P1-2 后建议对两条修复路径各补一个测试，再快速复审）
