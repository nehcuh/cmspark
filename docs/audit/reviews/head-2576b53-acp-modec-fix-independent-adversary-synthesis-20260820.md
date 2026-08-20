# 两路独立对抗合成 — `2576b53` + working tree（Mode C P1 修复）

**日期**: 2026-08-20
**对象**: `git diff 2576b53`（未提交工作区改动）— 修复 PR #206 评审（`head-2576b53-acp-discover-independent-adversary-synthesis-20260820.md`）的两条 P1
**内容**: opencode Mode C 全平台改用 `--prompt` 直达 TUI；kimi Windows Mode C 改裸启动（`agentId` 形参平移 POSIX 约定）；补 6 条测试（含 manager `resolveProtocolArgs` 接线）；message-router 两条 obsidian→笔记库 文案残留
**方法**: 实现一路 + 独立对抗两路（正确性 / 测试质量·变异）；对抗路不信任实现会话，自读 frozen patch + 活码 + 定向执行；本合成会话未参与实现

Frozen patch: `docs/audit/reviews/head-2576b53-acp-modec-fix-diff-20260820-222819.patch`（两路各自 [executed] 校验与 `git diff 2576b53` 字节一致）

## 参与路

| 路 | 范围 | 裁决 |
|----|------|------|
| 实现 | open-local-terminal.ts / message-router.ts / 2 个测试文件 | （无自评资格） |
| **A2 正确性** | 修复实证、opencode `--prompt` 一手文档、回归矩阵、文案一致性 | **APPROVE_WITH_NITS**（P2×2） |
| **C2 测试/变异** | 6 条新测试质量、7 处变异、全量回归 | **APPROVE_WITH_NITS**（P2×4） |

报告：

- `docs/audit/reviews/head-2576b53-acp-modec-fix-lane-a2-correctness-20260820.md`
- `docs/audit/reviews/head-2576b53-acp-modec-fix-lane-c2-tests-20260820.md`

## 合成裁决

**APPROVE_WITH_NITS.** 两条 P1 均被对抗路以编译产物实证闭合；上一轮阻断的测试缺口（manager 接线无覆盖）经变异验红闭环。无 P0/P1。残留均为 P2 测试覆盖/注释级 nit，不阻断。

## 已闭合（本轮对抗重放）

| ID | 原缺陷 | 闭合证据（对抗路 [executed]/[fetched]，非实现方自评） |
|----|--------|----------|
| P1-1 | opencode Mode C 任务被当 `[project]` positional | A2 实证 POSIX 生成 `exec <cmd> --prompt "${CMSPARK_TASK}"`（inline 单引号转义正确闭合）、Windows L1/粘贴行 `& <cmd> --prompt $task`；[fetched] opencode 官方文档确认 TUI `--prompt` 存在、positional 为项目目录 |
| P1-2 | kimi Windows Mode C 必拼 `$task` → `No such command` | A2 实证 L1 ps1 与 L0 粘贴行均不含 `$task`/任务文本/Get-Content；`agentId` 在 2 构造器 + 3 调用点透传完整，grep 无第三条 `$task` 生成路径 |
| N1(上轮) | `manager.ts:540` `resolveProtocolArgs` 接线无测试，可静默回退 | C2 变异 C（回退 `server.args \|\| []`）→ 新接线用例精确验红；断言 kimi/opencode argv=`["acp"]`、claude/grok=`[]` |
| B1/B2 | companion 错误串残留 obsidian/vault 旧术语 | A2 核对新串与 `SettingsSlideout.tsx`「导出与集成」「笔记库路径」「刷新笔记库档案」一致 |
| 回归面 | claude/pi/grok/未知/缺省 agentId 的 argv 不得变 | A2 `node -e` 实证矩阵与旧形状逐字节一致；POSIX kimi 未动；380 行补丁逐 hunk 无夹带 |

## 残留 nits（非阻断）

| ID | 路 | Sev | 摘要 |
|----|----|-----|------|
| R1 | C2 | P2 test | `buildWindowsModeCScript` L0 粘贴行的 `agentId` 透传无测试钉住（变异 E 全绿） |
| R2 | C2 | P2 test | `openLocalTerminalForAgent` 两处调用点（pasteLine/writeModeCPs1）的 `agentId` 透传零覆盖（变异 F 全绿） |
| R3 | C2 | P2 test | message-router 两条新文案无测试钉住（变异 D 全绿） |
| R4 | C2 | P2 test | 新 manager 接线用例沿用写真实 `~/.cmspark-agent` 的非 hermetic `saveConfig` 模式（finally 恢复，既有模式） |
| R5 | A2 | P2 | `message-router.ts:3278/3281` 同 handler 仍残留 `vault 路径不存在`/`vault 路径不是目录`（B2 同型） |
| R6 | A2 | P2 注释 | opencode `--prompt` 上游语义为预填 TUI 输入框（需用户 Enter；auto-submit 是未决 feature request sst/opencode#3937），代码注释未注明该 caveat——任务已进入会话 UI，仍优于 kimi 的手动粘贴 |

## 机器（对抗路自行跑，非实现会话自评）

- A2：[executed] acp 四测试文件 **86/86**；编译产物构造器实证 kimi/opencode/claude/pi/grok/unknown/缺省 的 POSIX 片段 + Windows ps1/粘贴行矩阵；`kimi --help` 复证；补丁字节一致
- C2：[executed] 定向 **86/86**；变异 7 处（A/B/C/G 红——钉住；D/E/F 绿——记录为 R1/R2/R3），私有副本 `.test-dist-mut` 操作并 `cmp` 恢复、收尾删除；全量 `run-tests.mjs` **3101 tests / 3034 pass / 58 fail / 9 skip**（Δ=+6 恰为新测试；58 失败逐条归类全为 Windows 宿主环境四类，与本补丁文件零交集；相邻测试隔离重跑 34/34、58/58、3/3、4/4 反证非回归）
- 实现会话另有 stash 对照全量（改动 vs 纯净：失败集合不变）——对抗裁决未采用该数字

## Trust / ADR-020

```
Surface:      无新 Surface（Mode C 仍是用户显式动作；同一既有终端打开通道）
L2-classes:   none new
Compose:      none
Autonomy:     single
Trust:        单调——无 auto_approve/白名单/确认跳过改动；仅修正任务投递 argv 与错误文案
Channel:      community
```

VERDICT: APPROVE_WITH_NITS
