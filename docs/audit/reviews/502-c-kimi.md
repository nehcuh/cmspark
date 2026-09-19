# 502 C ACP 挂现有 PTY — Kimi 对抗复审

> 日期：2026-09-18 · 评审人：Kimi（READ-ONLY，未改任何文件）
> 对象：worktree `/tmp/cmspark-502/c`，diff `c61285c6..HEAD`
> 方法：对抗子代理 + 仲裁人抽检；随 commit 落地增量更新本文件
> 状态：**终裁 APPROVE-WITH-NITS**（2026-09-19，`f49978fb` 落地后 Task 3 BLOCK 解除；见附录 8。三个 Task 全部通过，残余仅 NIT：FIX 3 内容锁未禁「在该页」措辞、dead-tab 重聚焦不重生、`embed_intent` banner 过时、无 generation 对账）
>
> **2026-09-18 更新 2**：Task 1 经两次 amend 定为 `2f2a3a4e`（`369e818a` 的 Option 1 + 补一条真 `loadNodePty` 路径（无注入记录器）的拒绝测试；源码与 369e818a 相同）。仲裁人亲证 + 复跑测试：
> - **MAJOR-1 已闭合**：`-l` 默认与调用方 argv 互斥成为显式 invariant——`file` 缺省 + `args !== undefined`（含 `[]`）直接 `spawn_failed`「args require an explicit absolute file」（`session.ts:245-256`，注释明说 `$SHELL` + caller argv = free shell）。free-shell 洞封死
> - 同源窄边顺手闭合：显式 `file` + 省略 `args` 现在给 `[]` 而不是 `-l`（agent 二进制不吃 login 旗标）
> - 新测试钉死两种组合：「caller-supplied args without file are refused (no free shell)」（555）、「explicit file with omitted args gets [], never the -l login flag」（586）
> - 仲裁人复跑：`pty-terminal.test.js` **33/33 pass**
> - **Task 1 verdict 升级为 APPROVE-WITH-NITS**（残余仅 NIT-2 后半：审计不记 argv，应随 Task 2 补）

## Task 1 增量复审 — `9b8bf59c` feat(pty): optional argv for agent embed

> 范围：单 commit，2 文件（`pty/session.ts` +22/−2、`tests/pty-terminal.test.ts` +95）
> verdict：**APPROVE-WITH-NITS**，但含 1 条 MAJOR，**必须在 Task 2 接线真实调用方之前修掉或钉死**

### MAJOR-1：`args` 不带 `file` 会静默把用户登录 shell 变成 free shell

`companion/src/pty/session.ts:251-255`：`opts.args` 是数组而 `opts.file` 缺省/空时，`file` 回落 `$SHELL`/`/bin/zsh`，`args` 原样透传——`spawnPtySession({ args: ["-c", "any command"] })` 等价于 `$SHELL -c "any command"`，正是 plan NEVER 的「free shell」，也违背「默认仍 `["-l"]`」的意图（无显式可执行文件时应走默认）。今天无生产调用方（惰性），但 Task 2 马上接线——一行 guard 即可闭合（有 `args` 无绝对 `file` 时拒绝，或无 `file` 时忽略 `args`）。无测试钉此组合。

### NIT

1. 空 `file`（`""`/`"   "`）被 trim 成「缺省」而非按 plan 字面「拒绝空 file」——与 MAJOR-1 叠加后 `file:"" + args` 同样落 free-shell 路径。要么拒绝，要么改 plan 措辞对齐。
2. 审计轨迹不记 argv（`session.ts:300-307` 的 `terminal.open` 审计只有 id/cwd/pid）。Task 2 让 argv 可达后，审计日志看不到 embed 了什么——应随 Task 2 补上。

### 干净项（亲证）

- argv 验证：相对路径在 spawn 前拒（`spawn_failed`），非字符串 argv 项被过滤，带空格 file 安全（直传 `@lydell/node-pty` spawn，无 `shell:true`、无字符串拼接、无 PATH 解析）
- 默认路径不变：无参调用仍 `$SHELL -l`（含 SHELL 空/未设的 fallback 测试钉）
- **可达性：惰性**——`handler.ts` 不转发 file/args，`ws/validate.ts` 的 `terminal.open` 验证器无此字段，WS 今天无法供 argv
- env 继承未扩面：`buildTerminalEnv()` 不变（仍剥 `ws_secret`/`API_KEY`/`CMSPARK_*`）
- 红线：无新监听口、无自动 spawn、无 Alacritty、无 osascript 改动；diff 仅 2 文件均在 plan 清单内
- 测试：companion 全量 **5121 pass / 0 fail**（24 skipped 既有），含 5 个新 PTY 测试

## 待审（watcher 进行中）

- Task 2 embed 分支：L2 `terminal.open` 闸的调用顺序、`terminal_busy`/`unsupported`/`embedded_terminal_disabled` 诚实失败不外跳、`acp.ui_start` 不自动 embed
- Task 3 侧栏入口：按钮显隐闸（darwin + enabled）、`user_gesture:true`、源码锁无侧栏 xterm
- E 线（fleet inspect）：尚未有 feat commit，落地后另写 `502-e-kimi.md`

---

## 附录：增量复审 — Task 1 第二次 amend（`83452b90` 加固版）

> 范围：`2f2a3a4e..83452b90`（+201/−93，`pty/session.ts` + 测试）。一路对抗子代理（含对编译产物的实证探针）+ 仲裁人亲证关键 claim。
> verdict：**BLOCK（窄，机械性）**——代码本体可靠，但 amend 在测试重写中**静默删掉了真 `loadNodePty` 路径的 free-shell 拒绝钉**。

### 新加固项（子代理实证核实，全部可靠）

- `describeValue` 真全函数：对 revoked Proxy、抛异常 toStringTag/getPrototypeOf/toJSON/Symbol.toPrimitive、Symbol、BigInt、循环对象全部返回 `{ok:false, code:"invalid_pty_opts"}`，无一抛出、无一触达 spawnFn；拒绝路径再无 `JSON.stringify`
- `MAX_PTY_ARGV_BYTES=128KB`：用 `Buffer.byteLength(utf8)` 求和（非 UTF-16 length）、边界正确（恰好 128KB 过、+1 拒）、先于 env 构建与 spawn
- 空串 argv 项拒绝：合理取舍（`--opt=` 内联形式仍可用）
- `$SHELL` trim-once：修了旧码「检查 trim 后值、spawn 未 trim 值 = 必 ENOENT」的 bug，无钉被破
- `invalid_pty_opts` 与 `spawn_failed` 分码：今天惰性（handler 不转发 file/args）；Task 2 接线时注意——该码落 `deny()` 而非 `terminal.closed`（`handler.ts:166` 只映射 unsupported/spawn_failed），有导出钉测试提醒
- 其余旧钉全部存活或加强（每案仍断言 `calls===[]` + `getLivePtyId()===null`）
- 红线不变：无新端口/自动 spawn/Alacritty/osascript；pty 测试 33/33

### BLOCK 理由（仲裁人亲证）

`2f2a3a4e` 版本里有一条「不注入 spawn 记录器、走真 `loadNodePty` 路径仍拒绝」的防御纵深钉（防未来有人把 spawn 解析上提到拒绝分支之前）。amend 后所有拒绝用例都过 `freshSpawn()`（必注入记录器），该钉消失（仲裁人 grep 亲证：`uninjected`/`no-file-args-real` 零命中）。当前无行为洞（所有拒绝分支文本上先于 spawnFn 闭包 return），但丢的正是防未来重构的回归探测器。恢复约 5 行（拒绝表测试尾部 bare `__testResetPtySessions()` + `__testSetPtyPlatform("darwin")` 后断言一次）。

### Task 1 放行条件

恢复真路径拒绝钉 → Task 1 回 APPROVE-WITH-NITS。残余 NIT：审计不记 argv（随 Task 2 补）；byte cap 不含 file（PATH_MAX 兜底）；`"\n/bin/zsh"` 换行前缀用例被删（同分支，无害）。

---

## 附录 2：增量复审 — Task 2（`30e77ed2` Mode C embed intent）

> 范围：单 commit，6 文件（open-local-terminal / manager / handler / session / types + 859 行新测试）。两路独立对抗子代理（CORRECTNESS / SPEC-SECURITY）+ 仲裁人抽检。
> verdict：**APPROVE-WITH-NITS**（两路一致，无 BLOCK/MAJOR）。**注意：Task 1 的 BLOCK（真 loadNodePty 路径钉缺失）未被本 commit 恢复，仍然挂着**（仲裁人 grep 亲证零命中）。

### 红线复核（两路一致 + 测试钉）

- **L2 闸顺序 HELD**：embed 分支本身从不 spawn——`open-local-terminal.ts` 只**记录** intent；唯一 spawn 在 `handler.ts:181-191`，严格在 `decision.approved` 之后。cruise/trust 无法跳过（该通道无 auto-approve 路径）；intent 在确认后、spawn 前过期 → fail-closed `EMBED_INTENT_EXPIRED`，绝不退化成未批准的 `$SHELL -l`
- **无自动 spawn HELD**：`manager.ts` 只在 `open_local_terminal_snapshot===true` 的 opt-in 分支记录 intent；时间线诚实写「ACP 启动不会自动弹出终端」；源码锁测试禁止 manager 出现 spawn/osascript
- **无新监听口 HELD**：复用既有 `terminal.open` 帧 + 既有 L2 通道
- **embed 失败不外跳撒谎 HELD**：non-darwin→unsupported、disabled→embedded_terminal_disabled、busy→terminal_busy，全部 `ok:false` 且在任何 opener 之前返回；`outerOpeners` 接缝让「失败时 opener 零调用」可测且已钉；非 embed 路径字节级不变（回归钉）
- **argv 来源可信**：executable 来自本地配置/PATH 发现（`resolveAbsoluteCommand`+`isExecutableFile`），ACP 子进程无法自选 argv；intent 不写 prompt 文本进审计（basename+argc+cwd）——**审计不记 argv 是刻意的隐私决定**（有测试钉「audit carries no prompt or argv payload」），上轮 NIT 以此方式结案
- **上轮 INVALID_PTY_OPTS 映射问题 RESOLVED**：现在显式 `deny()`（畸形请求），真 spawn_failed/unsupported 仍走 `terminal.closed`
- 测试：companion 全量 **5206 / 5184 pass / 0 fail**（两路各跑一次），acp-embed-mode-c 36/36、pty-terminal 33/33

### NIT（不阻塞，Task 3/后续）

1. **TOCTOU（intent 覆盖）**：`recordEmbedIntent` 覆盖同 key 旧 intent；L2 copy（peek）与 spawn（take）之间同线程新 Mode C start 可替换 intent——spawn 跑的 basename/argc 可能与批准文案不符。`EMBED_INTENT_EXPIRED` 抓消失不抓替换。建议 confirm 载荷带 generation/nonce、take 时校验
2. wire `argv` 可整体替换 intent 的 args（不能换 executable，有测试钉）；今天无发送方（TerminalApp 不发 argv），未来客户端使用时 L2 文案只显示个数不显示内容
3. intent 先消费后 spawn——spawn 时 busy 竞态会烧掉 intent（诚实但有损）
4. L2 对话框只有 basename+argc+cwd，看不到 argv 内容（刻意，任务文本即用户浏览器任务）；同意强度略弱
5. WS schema 未登记 `argv` 字段（handler 有防御性处理，文档性缺口）
6. diff 触及 plan 清单外的 `acp/types.ts`/`pty/handler.ts`/`pty/session.ts`——均为承重改动，非 scope creep

### C 线当前状态

- Task 1：BLOCK（缺真路径钉，~5 行恢复即过）
- Task 2：APPROVE-WITH-NITS
- Task 3（侧栏入口）：未落地，watcher 盯中

### Task 2 amend（`5f73e77c`）仲裁人增量亲证

- **镜像 TOCTOU 闭合**：确认对话框开着期间新记录的 intent（peek 无→take 有）现在 fail-closed `EMBED_INTENT_UNCONFIRMED`——agent 不跑、`$SHELL -l` 也不跑（批准的是 shell 文案而面板状态已变），intent 放回保证重点按钮时确实弹 embed 文案。两条新测试钉死（零 spawn + 重试路径弹 embed 文案）
- `deny()` 补 `{id}`：畸形请求拒绝帧带回话 id，不再广播到所有终端 tab（有测试钉）
- **残余**：NIT-1 的另一半仍开——peek 见 intent A、对话框期间被替换为 B 时，仍按 A 的批准 spawn B（同用户同线程、均为本地 L2 闸内 intent，低危；建议 generation/nonce 对账）
- 仲裁人复跑 `acp-embed-mode-c`：0 fail
- Task 2 verdict 维持 **APPROVE-WITH-NITS**

---

## 附录 3：增量复审 — Task 3（`7aa9582a` 侧栏入口）

> 范围：单 commit，8 文件全在 `chrome-extension/`。两路独立对抗子代理（CORRECTNESS / PRODUCT-UX-SPEC）+ 仲裁人亲证。
> verdict：**BLOCK**——spec §4 NEVER 全 HELD，但 3 条 MAJOR（两路在 MAJOR-1 上收敛，仲裁人已亲证）。

### spec §4 NEVER 复核（全 HELD）

侧栏无 xterm/TerminalApp（grep 干净 + 源码锁）、无 Computer Use 改动、无新监听口（复用既有 Port⇄WS relay）、无「插件内 Alacritty」文案（标签「在本插件打开终端」= xterm.js 事实）、ACP permission/apply_diff 未动、默认关无入口（双闸：enabled===true + embed_intent）、click-only 有测试锁、非 darwin 经 companion 诚实拒绝在 tab 渲染。测试：extension **1372/1372**（含新 13 个入口测试）。

### MAJOR（放行前必修，均为小范围本地修复）

1. **MAJOR-1（两路收敛 + 亲证）：`terminal.open_tab` 失败被面板静默吞掉**。`CodingAgentPanel.tsx:780-784` 回调丢弃响应——而后台对「已有其他终端任务」诚实抛错（`background/terminal.ts:60-66`）并返回 `{ok:false,error}`（`index.ts:1731-1735`）。用户点击后**无事发生**：无错误提示、不聚焦已有 tab。高频可达：Settings 开的未绑定终端 tab（search===""）、两个 coding session、review 终端占用，全部静默死按钮。对照组 `ChatView.tsx:1602-1606` 用 `role="alert"` 正确暴露。plan Task 4「terminal_busy 诚实」在用户动作的表面未达成。约 3 行修复
2. **MAJOR-2（亲证 copy）：确认位置文案写错表面**。`copy.ts:38/97` 均称「在该页确认」——但确认实际渲染在**侧栏** FocusBand（`security.confirmation.request` 进 sidepanel store，终端 relay 只转发 `terminal.*` 帧；stay_background 不抢焦）。真实流程：点击 → 新全页 tab 抢焦 → tab 显示「正在开门…」无回指 → 真正的确认框在用户刚离开的侧栏 → 45s fail-closed 超时。架构继承自 #432 P0，但本 commit 的新文案主动误导。改文案点名真实位置（「请回到侧栏确认」）或在 tab 里加指引
3. **MAJOR-3：chip 提示指向未渲染的按钮**。`modeCEmbedIntentBanner`「点下方「在本插件打开终端」…」被复用到 `CodingSessionChip.tsx:95-97`——FocusBand 在面板关闭时也显示该 chip，而面板 `return null`、chip 不可点。用户被指向不存在于任何屏幕的按钮。chip 分支需上下文中性文案或带开面板入口

### NIT

1. plan 写「仅 darwin 显示」vs 实现无客户端 darwin 闸（刻意，文档化；非 darwin 落得可点入口→unsupported tab）——plan 或实现对齐一处
2. companion 错误文案「请重新点击面板「终端」按钮」与 shipped 标签「在本插件打开终端」不一致（跨 commit 文案漂移）
3. 死 tab 重聚焦：同绑定 tab 的 PTY 已结束时点击只聚焦「会话已结束」页，不重生（继承自 review 流）
4. `embed_intent` 状态消费后不清——agent 已在跑时 banner 仍说「尚无进程」，关 tab 重 click 起 `$SHELL -l` 而 banner 仍暗示 agent 待启动（L2 文案是新 peek 的、诚实，仅面板 copy 过时）

### C 线当前状态

- Task 1：BLOCK（真 loadNodePty 路径钉缺失，~5 行）
- Task 2：APPROVE-WITH-NITS
- Task 3：BLOCK（3 条 MAJOR，均小修复）

---

## 附录 4：Task 1 BLOCK 解除 — `1d3193fe` 钉恢复

> 仲裁人亲证 + 复跑。恢复方式**优于**被删的原钉：不移除注入钩子（原方式在守卫退化时会真起 `$SHELL` 进程），而是把钩子武装成投掷 `SPAWN_MUST_NOT_BE_REACHED` 的陷阱——「触达 spawn」与「spawn 因无聊原因失败」从此可区分，且守卫退化也绝不产生真进程。`spawn_failed` 与守卫自拒绝按码区分、消息精确匹配。
> 复跑 `pty-terminal`：exit 0 全绿。**Task 1 verdict 升级为 APPROVE-WITH-NITS**。
>
> **C 线当前状态**：Task 1 通过 · Task 2 通过（APPROVE-WITH-NITS）· Task 3 BLOCK（3 条 MAJOR 小修：open_tab 失败暴露 / 确认位置文案 / chip 指向未渲染按钮）

---

## 附录 5：Task 3 修复复审 — `b6e7e5d0`（hydrate enabled + darwin gate + honest embed copy）

> 一路 CORRECTNESS 对抗子代理 + 仲裁人亲证。verdict：**BLOCK（3 条 MAJOR 修了 1 条，2 条未动）**。
> 本 commit 自带的五项修复是真且钉得好：hydrate 传递（`normalize-config.ts:138-141` 只认真布尔，修掉 dead-feature 根因）、darwin 客户端闸（`embed-entry.ts:55-75` 三级信号、fail-closed、无新 WS 字段）、**MAJOR-3 FIXED**（chip 用无按钮变体文案、点名入口真实位置、panel 按 `hasEntryButton` 谓词给指示性文案）。测试 1382/1382。

### 未修（仲裁人亲证）

- **MAJOR-1 未修且被测试钉死**：`CodingAgentPanel.tsx:785` 仍 `void chrome.runtime.lastError` 吞响应；`tests/coding-panel-embed-entry.test.ts:206` 现在断言该吞法存在——缺陷被钉成预期行为，修复时需同步改测试
- **MAJOR-2 未修**：`copy.ts:38`「并在该页确认」、`:114`「该页需你确认后才启动」逐字未动；doc 注释「the tab asks for its own L2 confirmation」也还在（确认实际在侧栏 FocusBand）。注意 `:44` 新 chip 变体的「该页」指编程助手面板——panel overlay 确实宿主 MinimalConfirm，那句是诚实的
- 新增 NIT：FIX 3 的内容锁未禁「在该页」，MAJOR-2 的谎能穿过新锁；darwin 闸 fail-closed 与 companion 录 intent 的极小错配窗口（copy-only）

### C 线当前状态

Task 1 通过 · Task 2 通过 · Task 3 仍 BLOCK（残 2 条 MAJOR：错误暴露 + 确认位置文案，均 ~3 行级）

---

## 附录 6：`88cd1fc2` — peek/take 替换竞态闭合（仲裁人亲证）

- 第三种竞态（peek 见 A、对话框期间被 recordEmbedIntent 原key覆盖为 B）现在 fail-closed：`sameEmbedIntent` 深比较 cwd/file/args（有序），不同则 A、B、`$SHELL -l` 三者都不跑，**放回较新的 B**（重 click 弹的是当前状态的文案；放回 A 会让下一次点击无声跑旧 A——注释把这个取舍写明了）
- 顺手修了 Task 3 复审的 NIT-2 文案漂移：两处错误文案的「面板「终端」按钮」改为 shipped 标签「在本插件打开终端」
- 测试钉死（含「dialog named agent A, not B」），仲裁人复跑 acp-embed-mode-c 全绿
- **Task 2 的全部竞态 NIT 至此清零**，维持 APPROVE-WITH-NITS
- C 线残余：仅 Task 3 的 MAJOR-1（吞错误+钉错的测试）与 MAJOR-2（确认位置文案）

---

## 附录 7：C-DONE（`a074682c`）核对 — 完成声明与残余不符

> C-DONE 承认并闭合了 Kimi 的 Task 1 BLOCK（`1d3193fe`，变异验证方式正确）与 NIT-2（审计刻意只记 basename+argc+cwd，队长要求），其内部 M1–M12 变异锁与本文 MAJOR 编号无关。
> **但 C-DONE 全文 119 行未提及、未披露 Task 3 的两条残余 MAJOR**（仲裁人 grep 亲证零命中）：
> 1. MAJOR-1：`CodingAgentPanel.tsx:785` 吞 `terminal.open_tab` 失败（且 `tests/coding-panel-embed-entry.test.ts:206` 把吞法钉成预期）
> 2. MAJOR-2：`copy.ts:38/114`「在该页确认」文案（确认实际在侧栏 FocusBand）
>
> **结论：C 线不能算 DONE。** 这两条都是 ~3 行级修复，但一个是 plan Task 4 验收项（terminal_busy 诚实）的表面失守、一个是面向用户的错误指引，均不适合静默带入合并。若队长决断把它们降级为 follow-up 票，需要在 C-DONE 或票面上显式记账，而不是不见。

---

## 附录 8：Task 3 BLOCK 解除 — `f49978fb`（仲裁人亲证）

- **MAJOR-1 FIXED**：`openEmbeddedTerminalTab` 现在读响应——`lastError` 或 `response.error` 写入 `embedOpenError`，按钮旁 `role="alert"` 渲染，重试清零；**钉错吞法的测试已反向**（`:206-208` 断言 `doesNotMatch void lastError` + `setEmbedOpenError` + `role="alert"`）
- **MAJOR-2 FIXED**：三处文案改口「打开后请回到侧栏确认才会启动」；doc 注释更正为「L2 confirmation stays in the Side Panel FocusBand / coding panel, not on the tab」
- 仲裁人复跑 extension 全量：**1382/1382 pass**
- **C 线 verdict 升级：APPROVE-WITH-NITS**（残余 NIT：FIX 3 内容锁未禁「在该页」类措辞、dead-tab 重聚焦不重生、`embed_intent` 状态消费后 banner 过时、A→B 以外无 generation 对账——均已记录，均不阻塞）
