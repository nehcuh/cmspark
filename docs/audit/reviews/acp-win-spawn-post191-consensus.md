# Windows ACP Mode C · post-#191 residual consensus

> **日期**: 2026-08-17
> **HEAD**: `750cf41` (`docs(memory): S72 session-end — #191 Windows ACP spawn handoff`)
> **范围**: post-#191 residuals F1–F7（Mode C Windows launch honesty + quoting）
> **核验**: 共识条目均对照源码 `[inspected]`；不采信 lane JSON 的 lock 原文，逐条重读
> **勿回退**: `docs/audit/reviews/acp-win-spawn-consensus-20260816-090554.md` **R1–R14**
> **宿主**: macOS；Windows spawn 仅 mock/unit 可证，无本机 WT PE 实跑

---

## 参与路与裁决

| 路 | 角色 | 裁决 |
|----|------|------|
| **A** | Security / Trust | **REJECT**（F1 + F5 P0） |
| **B** | UX / Honesty | **REJECT**（F1 + F7 P0；反对把 WT 早退当成功） |
| **C** | Correctness / Windows spawn | **REJECT**（F1 + F2 P0） |

### 合成裁决

**REJECT（Mode C 诚实 + `start` 引号面）**

#191 / R1–R14 主路径（discover unwrap、stdio `spawnAcpChild`、cmd-host L0、R6 wx+unlink、R7 token 引号、R8 taskkill pin）**不要重开**。  
挡合入的是两处 Mode C 启动面：

1. **F1** — `launchStart` 的 `cmd /d /s /c <start line>` 没有 `wrapViaCmd` 的 extra-quote + `windowsVerbatimArguments`。Node CRT 会把 R7 的 `"` 改写成 `\"`；`start` 仍可能 exit 0，`openLocalTerminalForAgent` 据此 stamp **L1**。
2. **F2** — `launchWt` 把 **real PE** `wt.exe` 的设计手递退出（exit 0，常 <300ms）当成失败，落入 `launchStart`。这会双开 Console，或在 start 也失败时对已经打开的 WT 报假失败。这不是重开 R1。

另两处小锁（诚实谎言 / PATH 执行面）一并修：

3. **F5** — `ComSpec` / 裸 `cmd.exe` + 裸 `powershell.exe` 未钉 System32（`where`/`taskkill` 已钉）。
4. **F7** — Timeline 成功文案用 **config pref** 而不是实际 `appLabel`。`pref=wt` + start 回退会显示「wt · 交互」。

---

## 独立核验（不要只信 lane）

| ID | 源码 `[inspected]` | A | B | C | **合成** |
|----|--------------------|---|---|---|----------|
| **F1** `launchStart` 缺 verbatim / extra-quote | `open-local-terminal.ts:432-436, 498-501` spawn 无 `windowsVerbatimArguments`；`buildWindowsStartCommandLine:252-253` 全 token `windowsQuotePath`；`wrapViaCmd` `win-spawn.ts:261-270` 已 extra-wrap + verbatim；`acp-win-spawn.test.ts:193-195` 只锁 wrapViaCmd；L1 stamp `:1151-1166`；`earlyExitIsFailure:false` 把 start exit 0 当成功 `:443-452` | must_fix high | must_fix high | must_fix high | **must_fix P0** |
| **F2** `launchWt` 把 handoff-exit 当失败 | `WT_OBSERVE_MS=300` `:404`；`launchWt :505-509` `earlyExitIsFailure:true`；任意窗口内 exit → reject `:444-446`；`wantWt` catch → `launchStart` `:528-537`。Microsoft WT #6860：`wt.exe` 是立刻 re-exec `WindowsTerminal.exe` 再 return 的 shim。`isRealWindowsTerminalExe` 已拒 alias `:361-370` | nit（fail-closed 非 trust 门） | **反对当成功**（怕重开 R1） | must_fix high | **must_fix P0**（锁法不重开 R1） |
| **F3** 不扫 Store PE | `defaultWindowsTerminalCandidates :379-389`：LocalAppData WindowsApps（随后被拒）、`Program Files\Windows Terminal`、Local WT、scoop。**没有** `Program Files\WindowsApps\Microsoft.WindowsTerminal_*` | nit；禁扫 | nit；禁扫 | nit；禁扫 | **defer** |
| **F4** 缺 `-NoProfile` | Mode C `psArgs :488-495` = `-NoExit -NoLogo -ExecutionPolicy Bypass -File`。仓库自动化（`host-use/win/powershell.ts:104` 等）带 `-NoProfile` 是 **非交互** | nit | nit | nit | **defer** |
| **F5** 未钉 cmd / powershell | `wrapViaCmd :265` 与 `launchStart :499` = `process.env.ComSpec \|\| "cmd.exe"`；start/wt payload 裸 `"powershell.exe"` `:253, :507`。对照：`discover.ts:145-148` `System32\where.exe`；`win-spawn.ts:323-328` `System32\taskkill.exe`；`resolvePowerShellExe` 已存在但 Mode C 未用 | must_fix high | nit（ComSpec 是 OS 契约） | nit（R8 族 leftover） | **must_fix**（裸 powershell PATH 面；cmd 顺手钉死） |
| **F6** 60s unlink | `scheduleUnlink` 默认 `60_000` `win-spawn.ts:337`；`finally :1202` unlink `task.md`+ps1。L0 paste 是 `Get-Content -LiteralPath` `:267-274`。R6 已定 wx+延迟删 | nit；勿重开 R6 | nit | nit | **defer**（勿重开 R6） |
| **F7** pref 当成功标签 | `manager.ts:196-199` 插值 `terminalApp` pref，不用 `r.detail` / `appLabel`。`openWindowsWithPref` start 回退 `appLabel: "Windows Console"` `:502`。`LOCAL_TERMINAL_APP_OPTIONS :17-27` 全局含 wt/cmd；`SettingsSlideout.tsx:2884-2898` 无 `appsPlatform`。`openDarwinWithPref` 对 `wt` 无 preset，缺 bundle 则 throw `:832-837` | nit | must_fix high | nit | **must_fix**（timeline 谎言）；dropdown 过滤 **defer** |

### F2 为何不是重开 R1

R1 根因是两件事叠在一起：

1. 把 **0-byte App Execution Alias** / 裸 `wt.exe` 当成「找到了」；
2. **80ms 无 spawn error** 即 stamp L1，**不听 exit**。

#191 已修：(1) `isRealWindowsTerminalExe` 永不接受裸 `wt.exe` 或 `Microsoft\WindowsApps\wt.exe`；(2) 不再用 80ms-without-error。

`wt.exe`（含 `Program Files\Windows Terminal\wt.exe` 真 PE）按 WT #6860 **设计为** 把会话交给 `WindowsTerminal.exe` 后 **立刻 exit 0**。把这条 exit 0 当失败：

- `pref=wt` → 真 PE 已打开 WT → 300ms 内 exit 0 → catch → `launchStart` → **第二扇 Console**；
- 若 F1 再让 start 假成功，L1 贴在 Console 上；若 start 失败，则对已经打开的 WT 报「Windows Terminal failed to launch」。

锁法：**仅对已通过 `isRealWindowsTerminalExe` 的路径**，`exit 0` **或** 观察窗后仍存活 = 成功；spawn error / **非 0** 才回落 start。  
不是 80ms-without-error，不接受 alias。B 路「当成功会重开 R1」的 **merge-block 论证不成立**；其「不要把 alias 早退当 L1」的约束保留在 must_not。

---

## 跨路共识 · 应修

### P0

| ID | 锁（最小） | 理由 |
|----|------------|------|
| **F1** | `launchStart` 必须走 `wrapViaCmd` 同款 `/d /s /c` 契约：start 行外包一层 `"`，且 **只对这条 cmd 宿主** 设 `windowsVerbatimArguments:true`。`spawnDetachedWin` 对 **wt PE argv 禁止** verbatim（cwd 含空格会被拆）。禁止把 CRT 改写后的 start exit 0 当成 L1。 | R7 的 `"` 在无 verbatim 时被 Node CRT 写成 `\"`；cmd 看到的不是 `start "CMspark" …`。start 仍可能 exit 0 → `:1151-1166` stamp L1。这是 quoting/exec 面，三路一致。 |
| **F2** | `launchWt`：已接受的 real PE 上，**exit 0 = CLI handoff 成功**（不要 `earlyExitIsFailure` 把任意早退当失败）。仍存活过 `WT_OBSERVE_MS` 也是成功。仅 spawn error / **非 0** 才 fall through 到 start。禁止 80ms-without-error。禁止 spawn 裸 `wt.exe` / WindowsApps alias。 | 真 PE 的设计退出被当成失败 → 双开或假失败。不是 R1。 |

### P1（小、一起做）

| ID | 锁（最小） | 理由 |
|----|------------|------|
| **F5** | `wrapViaCmd` 与 `launchStart` 的 cmd 宿主钉 `%SystemRoot%\System32\cmd.exe`（**不用** `process.env.ComSpec`、不用裸 `cmd.exe`）。start / wt 的 PowerShell payload 钉 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`（**不用** 裸 `powershell.exe`）。缺文件让 spawn ENOENT 诚实失败，不要回落 PATH。 | A 确认的执行面。`where`/`taskkill` 已按同一纪律钉 System32。裸 `powershell.exe` 是 Mode C 窗口的 PATH 劫持。B/C 视为 leftover 不挡合入；合成仍修——改动是 4 行 pin，不是重设计。 |
| **F7** | Timeline **成功**文案必须用实际打开的 app（`OpenLocalTerminalResult.app` / `opened.appLabel` / `r.detail`），**禁止**插值 config `terminalApp`。`pref=wt` + start 回退不得显示「wt · 交互」。 | `manager.ts:196-199` 在 F2 未修时几乎是 `pref=wt` 的主路径谎言。dropdown 平台过滤另后置。 |

---

## 后置（defer）

| ID | 为何 defer |
|----|------------|
| **F3** Store PE 缺口 | Store/inbox 只有 `WindowsApps\Microsoft.WindowsTerminal_*` 时 `pref=wt` 会走 Console。**禁止**枚举 `Program Files\WindowsApps` 包。保持拒绝 `%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe`。诚实降级即可。 |
| **F4** `-NoProfile` | 仓库带 `-NoProfile` 的站点都是非交互自动化。Mode C 是 `-NoExit` 交互窗，用户 profile 可能是要的。不是假 L1，不是 quoting 面。 |
| **F6** 60s unlink | R6 已定 `wx` + 延迟 unlink。60s 是人贴晚了的 race，不是无窗口 stamp L1。**不要重开 R6**。 |
| **F7-dropdown** | `LOCAL_TERMINAL_APP_OPTIONS` 在非 Windows 也列出 wt/cmd；macOS 选 wt 会 throw（`:832-837`），失败是诚实的。用已有 `appsPlatform` 过滤是 UX nit，不是假 L1。 |

---

## 明确拒绝的主张

1. **要求枚举** `Program Files\WindowsApps\Microsoft.WindowsTerminal_*`（F3 overreach）。
2. **把 80ms-without-error / 未观察 exit 当 L1**（R1；F2 锁法不得滑回这条）。
3. **`findWindowsTerminalExe` 返回裸 `wt.exe` 或 `Microsoft\WindowsApps` alias**。
4. **重开 R6**（改 ttl、取消 unlink、或改 `wx`）。
5. **强制** 交互 Mode C 加 `-NoProfile`。
6. **`wrapViaCmd` 携带 prompt / `page_context`**。
7. **任何 ACP spawn 使用 `shell:true`**。
8. **cmd-host Mode C 升 L1**（R4；继续只 L0）。

---

## 必须保持（R1–R14 / 主路径）

- `pickWindowsWhereHit`：`.exe` > `.cmd` > 永不 shebang-only。
- Claude / Pi unwrap 不得回退。
- 双 stdio 站点继续走 `spawnAcpChild`：`protocol-session.ts:50`、`manager.ts:614`。
- 禁止新的 `shell:true`。
- Mode C 门继续只读 `open_local_terminal_snapshot`。
- cmd-host Mode C **只 L0**。
- `wrapViaCmd` 必须继续先走 `argvForCmdWrap`（永不携带 prompt / `page_context`）。
- `findWindowsTerminalExe` 永不返回裸 `wt.exe` 或 WindowsApps alias。

---

## Recipe（可直接实现，不重设计）

### 1. Pin helpers — `companion/src/acp/win-spawn.ts`

在 `windowsTaskkillPath` 旁增加（同一 `SystemRoot` 纪律）：

```ts
export function windowsCmdExePath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || "C:\\Windows"
  return path.join(root, "System32", "cmd.exe")
}

export function windowsPowerShellExePath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || "C:\\Windows"
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}
```

- `wrapViaCmd`：`const comspec = windowsCmdExePath()` — **删掉** `process.env.ComSpec || "cmd.exe"`。
- 不要 `existsSync` 后回落裸名；缺文件让 spawn 诚实 ENOENT。
- 不要从 `acp/` 新引 `host-use/`（避免分层）；pin 与 taskkill 同文件即可。

### 2. F1 — start 行 verbatim — `open-local-terminal.ts`

抽出纯函数（便于单测，不必 mock `spawn`）：

```ts
export function planWindowsStartSpawn(psArgs: string[]): {
  command: string
  args: [string, string, string, string]
  options: { windowsVerbatimArguments: true; windowsHide: true }
} {
  const line = buildWindowsStartCommandLine(psArgs) // already start "CMspark" + quoted tokens
  return {
    command: windowsCmdExePath(),
    args: ["/d", "/s", "/c", `"${line}"`], // extra wrap = wrapViaCmd /s 契约
    options: { windowsVerbatimArguments: true, windowsHide: true },
  }
}
```

`spawnDetachedWin` 增加可选 `windowsVerbatimArguments?: boolean`，原样传给 `spawn`。  
`launchStart`：

```ts
const plan = planWindowsStartSpawn(psArgs)
await spawnDetachedWin(plan.command, plan.args, {
  earlyExitIsFailure: false,
  windowsVerbatimArguments: true,
})
```

**禁止**给 `launchWt` 的 wt PE argv 设 verbatim。

`buildWindowsStartCommandLine` 的第一个 token 改为 `windowsPowerShellExePath()`（不要硬编码 `"powershell.exe"`）。现有 R7 测试对 `"powershell\.exe"` 的 match 仍然成立。

### 3. F2 — wt handoff — `spawnDetachedWin`

不要用 start 模式（`earlyExitIsFailure:false` 会在 2500ms 未退出时报 timeout——wt 若挂着也会被误杀）。  
给 wt 一条 **handoff** 策略（可把 flag 改名为 `cliHandoff`，或保留名但改语义并改注释）：

- `error` → reject
- `exit` / `close`：**code === 0 或 null-after-unref 视为成功**；**仅 non-zero reject**
- `WT_OBSERVE_MS` 到期仍未 settle：若 `exitCode` 为非 0 → reject，否则 **resolve**（仍存活 = 成功）
- **不要**把「80ms 无 error」当成功；必须走过观察窗或收到 exit 0

`launchWt`：

```ts
await spawnDetachedWin(wt, ["-d", cwd, "--", windowsPowerShellExePath(), ...psArgs], {
  cliHandoff: true, // 不是 earlyExitIsFailure:true
})
```

`wantWt` 仅在 spawn error / non-zero 时 catch → `launchStart`。

为测 F2，给 `openWindowsWithPref` 加可选 `deps?: { spawn?; findWindowsTerminalExe? }`（默认真 `spawn` / `findWindowsTerminalExe`），或 export `spawnDetachedWin`。二选一即可，优先 **deps 注入** 以免扩大公开面。

### 4. F7 — timeline 用真实 app

`OpenLocalTerminalResult` 增加可选 `app?: string`。  
所有 `ok:true` 返回（darwin + win L1/L0）设 `app: opened.appLabel`。  
`manager.ts:196-199`：

```ts
const shown = r.app || (terminalApp === "auto" ? "系统默认" : terminalApp)
const label = r.level === "L0"
  ? `已打开本机终端（L0 · ${shown} · 可能需粘贴）`
  : `已打开本机终端（${shown} · 交互）`
```

成功路径 **禁止**在 `r.app` 存在时再用 raw pref。失败路径仍可用 pref（「未打开[wt]」）。

不要在本轮改 `LOCAL_TERMINAL_APP_OPTIONS` 平台过滤。

### 5. 测试（必须新增，全在现有文件）

`companion/tests/acp-win-spawn.test.ts`

- `windowsCmdExePath` / `windowsPowerShellExePath` 在伪造 `SystemRoot=C:\\Windows` 时分别以 `\\System32\\cmd.exe`、`\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` 结尾。
- `wrapViaCmd`（未解析的 `.cmd`）`r.command` 匹配 `/System32\\cmd\.exe$/i`，**不**等于裸 `"cmd.exe"`，且 `windowsVerbatimArguments === true`，cmdline 仍 extra-wrap。prompt 剥离用例保持绿。

`companion/tests/acp-open-local-terminal.test.ts`

- **F1**：`planWindowsStartSpawn(["-NoExit","-File","C:\\tmp\\run.ps1"])`  
  - `command` 钉 System32 cmd  
  - `args` = `["/d","/s","/c", wrapped]`  
  - `wrapped` 以 `"` 起止，**内含**字面 `start "CMspark"` 与 `"`（`assert.match(wrapped, /start "CMspark"/)`；`assert.doesNotMatch(wrapped, /\\"/)`）  
  - `options.windowsVerbatimArguments === true`
- **F2**（mock `spawn`）：  
  - 注入 `findWindowsTerminalExe → C:\\Program Files\\Windows Terminal\\wt.exe`  
  - child 在 10ms `emit("exit", 0)` → `openWindowsWithPref(..., "wt")` resolve，`appLabel === "Windows Terminal"`，**start/cmd 未被调用**  
  - child `emit("error")` 或 `exit 1` → 调用 start 计划（cmd `/c`）  
  - child 300ms+ 仍不 exit → resolve WT，不调 start  
- **F5**：start 行 / wt argv 含钉死的 `WindowsPowerShell\\v1.0\\powershell.exe`，不含作为独立 token 的裸 `powershell.exe`（路径里的文件名除外）。
- **保持绿**：`isRealWindowsTerminalExe` 拒裸 wt / WindowsApps；`findWindowsTerminalExe` 永不返回它们；R7 全 token 引号；Mode C cmd-host 仍 L0。

`companion/tests` 里若已有 manager timeline 单测，加一条：`r.app = "Windows Console"` + pref `"wt"` → 文案含 `Windows Console`、**不含** `（wt · 交互）`。没有现成 harness 就只改 `manager.ts` 并在本文件写清；不要为这一行新造测试框架。

### 6. 不要动

- `pickWindowsWhereHit`、unwrap Claude/Pi、`spawnAcpChild` 两站点、`shell:false`
- `argvForCmdWrap` / 禁止 prompt 进 cmd
- `modeCWindowsLevelForSpec`（cmd-host = L0）
- `isRealWindowsTerminalExe` / `isWindowsAppsAliasPath` 拒绝规则
- `scheduleUnlink` 默认 60s、`wx` 写入
- 不要扫 `WindowsApps\Microsoft.WindowsTerminal_*`
- 不要给交互 psArgs 强行加 `-NoProfile`
- 不要给 wt PE 设 `windowsVerbatimArguments`

### 7. 验证

```bash
npm --prefix companion test -- --test-name-pattern "acp-win-spawn|acp-open-local-terminal"
```

目标：既有用例全绿 + 上述新锁全绿。macOS 宿主足够（纯函数 + mock spawn）。

---

## Ship decision

| 切面 | 决策 |
|------|------|
| ACP stdio Claude/Pi（#191） | **保持**；本轮不改 |
| 合入 / 关 residual | **先落地 F1+F2+F5+F7 recipe**，否则继续 REJECT |
| F3 / F4 / F6 / dropdown | 后置；F6 明确不重开 |

三路皆 REJECT。合成同意 REJECT，但 **F2 采纳 C 的方向**（handoff-exit = 成功），用「仅 real PE + exit 0 或仍存活」避免 B 担心的 R1 回潮。F5 采纳 A 的 pin，即使 B/C 视为 leftover。F7 采纳 B 的 timeline 锁，dropdown 后置。
