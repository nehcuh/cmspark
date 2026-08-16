# Windows ACP spawn · 多路独立对抗共识

> **日期**: 2026-08-16  
> **Brief**: `docs/audit/reviews/_prompts/acp-win-spawn-20260816.md`  
> **Patch**: `docs/audit/reviews/acp-win-spawn-diff-20260816-090554.patch`  
> **范围**: 外部编程 Agent Windows 启动（discover + stdio spawn + Mode C）  
> **核验**: 共识条目均对照源码 `[inspected]`；Claude/Pi unwrap 本机 `[executed]`

---

## 参与路与裁决

| 路 | 角色 | 裁决 |
|----|------|------|
| **A** | Security / Trust | **REJECT** |
| **B** | UX / Honesty | **REJECT** |
| **C** | Correctness / Windows spawn | **APPROVE_WITH_NITS** |

### 合成裁决

**REJECT（Mode C 诚实 + wrapViaCmd 回退面）· ACP 主路径（npm Claude/Pi stdio）DONE**

不是整包无效：原 bug（shebang ENOENT / `.cmd` EINVAL）在 **stdio 桥** 上已修。  
不能按 APPROVE_WITH_NITS 合入的原因：Mode C 把「80ms 未收到 spawn error」写成 L1 成功（对用户说谎）；unwrap 失败回退把 prompt/`$task` 送进 `cmd /c`（新执行面，旧路径是 EINVAL）。

---

## 集群完成度（合成）

| 集群 | A | B | C | **共识** |
|------|---|---|---|----------|
| Discover 不选 shebang | — | PASS+P2 copy | DONE | **DONE** |
| unwrap Claude `.exe` / Pi `node cli.js` | PASS (happy) | — | DONE `[executed]` | **DONE** |
| stdio `spawnAcpChild` 双站点 | PASS | — | DONE | **DONE** |
| wrapViaCmd 回退安全 | **S-01 P1** | — | C1/C2 | **应修** |
| Mode C Windows 诚实 | S-02 | **H1/H2 P0** | residual | **应修（挡合入）** |
| Mode C paste 含任务 | — | H7 P1 | — | **应修** |
| kill 树 | S-05 P2 | — | C7 nit | 后置 |

---

## 跨路共识 · 应修

### P0 — 挡合入（B 强烈 + 源码确认）

| ID | 来源 | 核验 | 问题 | 处置 |
|----|------|------|------|------|
| **R1 false L1** | **B H1/H2** | **CONFIRMED** `open-local-terminal.ts:300-339, 926-942`：`findWindowsTerminalExe` 在 `existsSync(WindowsApps\wt.exe)` 或裸 `"wt.exe"` 上恒成功；`spawnDetachedWin` 80ms resolve，不听 `exit` | UI「已打开本机终端（交互）」可以在没有窗口时出现；旧行为 `ok:false` 更诚实 | 禁止把 80ms 当 L1。0-byte / App Execution Alias 不当成功。观察失败 → `failed` 或真 L0，并给出粘贴行 |
| **R2 auto 永不 L0** | **B H3** | **CONFIRMED** `auto` 下 wt/start 都不抛 → 进不了 L0 | 广告的降级死了 | `auto` 在未观察到窗口时走 L0/`failed`，不要先 stamp `opened` |

### P1 — 安全 / 回退面（A+C 同构）

| ID | 来源 | 核验 | 问题 | 处置 |
|----|------|------|------|------|
| **R3 wrapViaCmd + prompt** | **A S-01 · C C2** | **CONFIRMED** Claude CLI 会把 `buildUserPrompt()`（含 `page_context`）插进 `-p`；unwrap 失败才走 `cmd /c`。npm Claude **不走此路** `[executed]`。回退是**新执行面**（旧 = EINVAL） | 页面文本可 `&` 断 `cmd`；`\"` 不是 cmd 转义 | **禁止**把 prompt/page_context 送进 `wrapViaCmd`。unwrap 失败：只传 flags + stdin，或诚实报错。`quoteCmdArg` 用 `""`，`%` → `%%`，`/c` 外包一层 `"` |
| **R4 Mode C `& cmd /c … $task`** | **A S-02** | **CONFIRMED** `resolveAcpSpawn(command, [])` unwrap 失败时 `spec.command` 是 `cmd.exe` | `$task` 被 cmd 再解析 | spec 是 `cmd.exe` 时禁止 L1；只 L0。或只 `& 'agent.cmd' --% $task` |
| **R5 Windows paste 丢任务** | **B H7** | **CONFIRMED** `buildWindowsCommandLine` 只有 `cd /d && command`；POSIX paste 含 prompt file | 用户粘贴得到空 TUI | L0/paste 带上 prompt file（与 POSIX `buildInteractiveExecFragment` 对等） |

### P2 — 后置

| ID | 来源 | 核验 | 处置 |
|----|------|------|------|
| R6 tmp 无 O_EXCL / 不删 | A S-03 | CONFIRMED | `wx` + unlink；与既有 Mode C residual 同族 |
| R7 `start` 引号 | A S-04 | CONFIRMED | 全 token `windowsQuotePath` |
| R8 `taskkill` PATH | A S-05 · C C7 | CONFIRMED | `System32\taskkill.exe` + `'error'` |
| R9 打包 exe + `process.execPath` | C C5 | CONFIRMED residual | JS shim 找不到 sibling `node.exe` 时不要用 companion PE |
| R10 `%~dp0` / pnpm / Codex npm | C C4 | CONFIRMED residual | 扩 unwrap 或拒绝 wrap |
| R11 `joinDp0` 反斜杠 | C C6 | CONFIRMED | 归一化 `\`；darwin 上现有 unwrap 夹具可能红 |
| R12 无 wiring 测试 | C C3 | CONFIRMED | 锁 `spawnAcpChild(` 调用点 |
| R13 设置项仍是 macOS 终端名 | B H8 | CONFIRMED | 文案补 WT/cmd |
| R14 shebang-only 空列表 | B H6 | CONFIRMED | 一句 Windows 说明即可 |

---

## 明确通过（勿回退）

1. **`pickWindowsWhereHit`**：`.exe` > `.cmd` > 永不 shebang-only。`where` 先打 shebang 的实机布局已覆盖。  
2. **unwrap**：Claude `"%dp0%\…\claude.exe" %*` 与 Pi `"%_prog%" "%dp0%\…cli.js"` **本机已跑通**。  
3. **双 stdio 站点**都走 `spawnAcpChild`（protocol-session + startCliBridge）。无 `shell: true`。  
4. **POSIX identity**：`resolveAcpSpawn` 非 win32 原样返回。  
5. **Mode C 门**：仍只读 `open_local_terminal_snapshot`；不是 Phase A 复制按钮 free-exec。  
6. **banner `Write-Host` 单引号**：goalHint 不会开第二条命令（A 已否证该猎点）。

---

## Ship decision

| 切面 | 决策 |
|------|------|
| ACP stdio 启动 Claude/Pi（用户原问题） | **可 dogfood**（重启 Companion 后） |
| 合入 main / 开 PR | **R1–R5 已落地**（workflow `acp-win-spawn-r1r5`）；P2 residual 仍后置 |
| Mode C Windows | **可诚实降级**（无假 L1）；cmd-host = L0 + paste |

Implementer self-APPROVE 不是门禁。两路 REJECT 压过一路 APPROVE_WITH_NITS。

---

## Post-fix（workflow `acp-win-spawn-r1r5` · 2026-08-16）

R1–R5 已改：`win-spawn.ts` / `open-local-terminal.ts` + 对应测试。  
父会话复跑 `[executed]`：`acp-win-spawn` + `acp-open-local-terminal` + `acp-discover` **69 pass / 0 fail**。

## Post-fix P2（R6–R14 · 2026-08-16）

| ID | 状态 |
|----|------|
| R6 tmp wx + 延迟 unlink | **DONE** |
| R7 start 全 token 引号 | **DONE** |
| R8 System32\\taskkill + error | **DONE** |
| R9 拒绝 companion PE 当 node | **DONE** |
| R10 unwrap `%~dp0` | **DONE** |
| R11 joinDp0 反斜杠 | **DONE** |
| R12 spawnAcpChild wiring 锁 | **DONE** |
| R13 设置 WT/cmd | **DONE** |
| R14 shebang 空列表说明 | **DONE** |

父会话复跑 `[executed]`：**77 pass / 0 fail**。
