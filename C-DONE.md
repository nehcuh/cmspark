# C-DONE — #502 切片 C（ACP 挂现有 xterm PTY = #432 P1）

**Worktree**: `/tmp/cmspark-502/c` · **Branch**: `feat/502-c-pty-embed` · base `c61285c6`
**Plan**: `docs/superpowers/plans/2026-09-18-502-c-pty-embed.md` · **规格 §4** · **Blast: T2** · darwin
**Node**: 22.23.2 (`nvm use 22`) · 主仓 `/Users/huchen/Projects/cmspark` 未改（保持 `c61285c6` / `feat/502-operate-surface`，脏文件与开工前一致）

## Goal（达成）

编程接力可把 agent 的交互 stdio 挂到**已有** xterm.js + node-pty 全页 tab；侧栏只放入口。ACP JSON-RPC 时间线 / permission / diff **并存**。不嵌 Alacritty，不侧栏跑 TUI，**默认仍关** `embedded_terminal.enabled`。

## 队长拍板的 Option 1（已落地）

`ACP start 不自动 embed` = **不得创建** PTY / 全页 tab / 外跳窗口。允许在用户已 L2 确认的 Mode C opt-in 分支里**只记录意图**。

```
manager.maybeOpenLocalTerminal()                        ← 现有 opt-in 分支内（open_local_terminal_snapshot === true）
  embedEligible = embedded_terminal.enabled === true && darwin
  └─ embedEligible → openLocalTerminalForAgent({embed:true})
       └─ 只 recordEmbedIntent({cwd, file, args})，返回 {ok:true}；**不 spawn、不开 tab、不开外窗**
  └─ 否则         → 行为与今日**逐字节相同**（照旧开 Terminal.app）
用户点击侧栏「在本插件打开终端」
  └─ terminal.open_tab{thread_id} → 全页 tab → terminal.open(user_gesture)
       └─ L2 确认（文案描述真实将要运行的东西）→ takeEmbedIntent → spawnPtySession({file,args})
```

**禁止的两条都已遵守**：未实现 Option 2（打开内嵌终端就静默取消外跳）；未加任何新 WS 帧/端口（`wire.ts:15` 的 `argv` 字段在我这版 base 上已存在）。

## Commits（6，未改写历史）

| commit | 内容 |
|---|---|
| `83452b90` | `feat(pty): optional argv for agent embed` — `file`/`args`；无 file 的 caller args **拒绝**（free shell 封死）；显式 file 省略 args 给 `[]` 而非 `-l` |
| `5f73e77c` | `feat(acp): Mode C embed intent into existing PTY` — `buildEmbedArgv`、embed 早退决策、意图 store、handler 消费、manager Option 1 + 审计 |
| `7aa9582a` | `feat(sidepanel): open embedded PTY from coding panel` — 按钮 + 闸 + Mode C 文案 |
| `1d3193fe` | `test(pty): pin free-shell refusal with the production spawn path armed` — 闭合独立 lane 的 BLOCK |
| `b6e7e5d0` | `fix(sidepanel): hydrate enabled + darwin gate + honest embed copy` — 修 P1（按钮在现实中永不显示） |
| `88cd1fc2` | `fix(acp): fail closed on a replaced embed intent between L2 peek and take` — 最后 3 条 NIT |

改动文件：`companion/src/pty/{session,handler}.ts`、`companion/src/acp/{open-local-terminal,manager,types}.ts`、`chrome-extension/src/sidepanel/{coding-handoff/{embed-entry,copy}.ts,utils/normalize-config.ts,components/{CodingAgentPanel,CodingSessionChip}.tsx,store/agentStore.tsx}`、`chrome-extension/src/background/{terminal,index}.ts`、3 个测试文件。

## 计划里没写、但必须做的六处

**C-1（计划与硬约束冲突，已按队长裁决解）**：按计划字面实现则**无人**记录 argv → 功能惰性。裁决 Option 1 后落到 manager 的既有 opt-in 分支。

**C-2 `args` 不带绝对 `file` = free shell（MAJOR，独立 lane 也判 BLOCK）**
`spawnPtySession({args:["-c","任意命令"]})` 会跑 `$SHELL -c 任意命令`。已封：无 `file` + 任何 `args`（含 `[]`）→ `INVALID_PTY_OPTS` 拒绝；`-l` 与 caller argv 结构性互斥（`hasFile ? [] : ["-l"]`）。

**C-3 L2 确认文案与实际不符（我按质量评审的提醒扩了计划）**
计划未提。若在 spawn 处消费意图，L2 弹窗仍说「打开登录 PTY / 本机用户 shell」，而实际启动的是 **agent + 用户任务文件** —— 用户批准的不是将要发生的事。已做 peek/take 分离：peek 在**构造文案前**，文案点名 agent basename + 参数个数（**不含** prompt 正文）；take 仅在批准后。**两条竞态都 fail-closed**：
- `EMBED_INTENT_UNCONFIRMED`：批准的是 shell，确认期间冒出意图 → 拒绝（不降级为登录 shell）
- `EMBED_INTENT_EXPIRED`：文案承诺了 agent，take 时意图已失效 → 拒绝
- `EMBED_INTENT_REPLACED`：peek 到 A、take 到 B → 拒绝（否则文案说 A 而启动 B）

**C-4 侧栏拿不到 `embedded_terminal.enabled`（P1，最终评审判定 CHANGES_REQUIRED）**
`normalize-config.ts` 无该键的透传 → 面板重载后永远 `undefined` → **按钮在现实中永不显示**，而 companion 还在提示用户去点。这与切片 B 的 B-G2 是同一类「配置白名单丢键」缺陷。已加嵌套透传 + 根因锁（断言闸读的是**水合后**的 config，不是测试里手搓的字面量）。

**C-5 背景页丢 `thread_id`（实现者自查发现，比计划要求更根本）**
`background/index.ts` 只在 `thread_id` 与 `review_id` **同时**为字符串时才建 binding → 只带 thread 的 `open_tab` 静默生成**未绑定** tab → `terminal.open` 无 `thread_id` → companion 起 `$SHELL -l`。仅加按钮会是装饰性的。已改为 thread-first binding（`review_id` 可选）；既有 review 路径的 query 逐字节不变。

**C-6 darwin 闸（队长明确要求「仅 darwin + enabled」）**
上一实现者称客户端无 darwin 信号；评审发现 `navigator.userAgentData.platform === "macOS"`。已加 `isDarwin()`（userAgentData → platform → UA 回退，**fail-closed**）+ 面板闸 `enabled && isDarwin()`。

## 独立 lane（Kimi）对抗复审的收敛

Kimi 在**主仓** `docs/audit/reviews/502-c-kimi.md` 逐 commit 增量复审。其 **BLOCK（窄、机械）** 打在 `83452b90`：该轮 amend 在重写测试时**静默删掉了「生产 spawn 路径 armed 时拒绝仍成立」的钉**。已闭合（`1d3193fe`）：新钉用**会抛异常的 spawn 陷阱**（非被动记录器），断言陷阱未浮现、code 为 `INVALID_PTY_OPTS` 而非 `spawn_failed`、error 命中守卫自己的 matcher —— 真实 spawn 失败**无法**满足它。变异验证：注释掉守卫 → 该测试以 `SPAWN_MUST_NOT_BE_REACHED` 命名失败。

Kimi 的 NIT-2（「审计不记 argv，应随 Task 2 补」）已满足：`acp.mode_c_embed_intent` 记 `agent_file_basename` + `argv_argc` + `cwd`；**刻意不记全文 prompt/完整 argv**（队长要求）。

## 验收证据

```
companion 全量:       5197 tests / 5173 pass / 0 fail / 24 skipped（既有 win32/PowerShell/TCC 门）
                      + settings-web 20/20  →  5217 total, 0 fail
chrome-extension:     1382 tests / 1382 pass / 0 fail
tsc --noEmit          companion + chrome-extension 均 clean
```

| 计划验收项 | 证据 |
|---|---|
| 默认关：无入口 | 闸 `enabled === true && isDarwin()`；`{}`/`1`/`"true"`/缺失/flattened → false |
| **embed 不自动随 ACP start** | `embedEligible` 在 `open_local_terminal_snapshot !== true` 早退**之后**计算；embed 分支只 record，无 spawn/无 tab/无外窗（抛异常 opener 从未触发） |
| `terminal_busy` 诚实 | `isPtyBusy()` → `{ok:false, detail:"terminal_busy"}`，不外跳 |
| 非 darwin `unsupported` | embed 决策首条即 `unsupported`，不外跳；UI 侧另有 fail-closed darwin 闸 |
| **L2 不被 cruise 跳过** | `requestConfirmation` 位置未动；peek 在建文案前、take 在批准后；拒绝/取消/过期/被替换四种情形都**零 spawn** |
| ACP permission / apply_diff 仍走 L2 | 未触碰时间线、permission、diff UI |
| 无新端口 / 无新 WS 帧 / 无新 config key | 复用 `terminal.open_tab` + `terminal.open`（`argv` 字段 base 已有） |
| 侧栏不挂 xterm / 不嵌 Alacritty | 源码锁 + 变异 M3/M4 验证 |

**变异证明（守卫非摆设）**：Kimi-BLOCK 新钉（陷阱式）、FIX 1（水合透传注释掉 → 2 测试红）、FIX 3（把文案改成「Agent 已在终端运行」→ 红）、NIT 1（删守卫 → 2 新测试红）、NIT 2（改名 → 精确前缀钉红）、NIT 3（回退文案 → 2 测试红）、Task 3 的 M1–M12（12 处锁逐一变异）。

## NEVER 遵守

| NEVER | 状态 |
|---|---|
| Alacritty 嵌 MV3 | ✅ 未加依赖、无引用（源码锁） |
| 侧栏 TUI / 侧栏 xterm | ✅ xterm 只在全页 tab |
| 自动 spawn | ✅ ACP start 只记录意图；spawn 仅在按钮 + L2 之后 |
| 新监听口 / 新 WS 帧 | ✅ 复用既有帧；`argv` 字段 base 已有 |
| free shell | ✅ 无 file 的 caller args 拒绝；`-l` 与 caller argv 互斥；embed 不降级为 `$SHELL -l` |
| 用 Computer Use 操作 TUI | ✅ 未触碰 |
| cruise 跳过 `terminal.open` L2 | ✅ 位置未动，四类竞态 fail-closed |
| Win/Linux 首发承诺 | ✅ 非 darwin 诚实 `unsupported` |

## 已知残留（不在本 PR）

1. **意图单次消费后状态不复位**：tab 真正启动 agent 后 `session.local_terminal` 仍是 `embed_intent`，banner/按钮继续邀请启动一件已经发生的事。修它需要 companion 侧新增「已 claim」信号（超出本切片"不改 companion 之外"的边界），已由实现者显式记录。
2. **`local_terminal === "failed"` 文案梯级为防御性死代码**：两处调用点都经 `isModeCInvolved` 排除 `failed`，未接线。
3. **面板按钮仅在 `enabled && darwin && 本线程有 embed_intent` 时出现**：即「可认领时刻」。enabled 但无意图时，侧栏不提供「开一个裸终端 tab」（该入口仍是设置页那个**未绑定 thread** 的旧按钮）。若要侧栏也能开裸终端，是一行闸改动。
4. **`opened_l0` chip 文案与面板统一**（可见字符串变化，仅 cosmetic）。
5. **`isDarwin()` 是 UI 隐藏闸，不是安全边界**：companion 仍独立拒绝非 darwin。
6. 非对象 `opts` 传给 `spawnPtySession` 仍会 TypeError（不可达：唯一生产调用方构造字面量）。
7. `history.db` / `logs` / 切片 A / G1：本切片不管。

## 过程记录（诚实）

- **两个 subagent 静默死亡**：Task 2 首个实现者在改完 6 个文件后进程消失、日志 0 字节（未 commit）。我未手动接管，而是先做只读诊断（`tsc` 干净 + 7 组测试中 4 组绿、3 组红且失败原因是测试自身缺陷），再把「resume + 具体三条红」交给新 subagent 收尾。这符合 subagent-driven 的「不回退到手动修」。
- **我自己的 shell 事故**：`cd X && nohup … &` 里的 `&` 把整个 `cd && …` 列表后台化，导致随后前台的 `git log` 在**主仓**执行，我一度误以为 worktree 被重置。已显式复核两仓：worktree HEAD 正常、主仓未被改动。教训：后台派发要写 `nohup bash -c 'cd X && exec …'`。
- **一处有意的流程偏离**：Task 3 用了**单个**评审者同时覆盖 spec + 质量（而非两阶段两个 subagent）。理由：该改动小、纯 UI、且实现者已自做 12 处变异验证；两个阶段拆开在该体量下收益低于成本。Task 1/2 保持严格两阶段。已在最终整体评审中补齐覆盖。
- **不改写历史**：`5f73e77c` 的 commit body 里写的测试数（5206）是当时的真实数字，后续 commit 增加了测试使其成为历史值。Kimi 正在按 SHA 增量复审，改写 SHA 会破坏其评审链，故**刻意不改**，最终数字以本文件为准。
