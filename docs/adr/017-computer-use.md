# ADR-017: Computer Use（坐标桌面操控）

**日期**: 2026-07-28  
**状态**: **Implemented / Accepted**（产品 0.5.0；平台：macOS / Windows 主路径）  
**用户指南**: [computer-use-user-guide.md](../computer-use-user-guide.md)  
**相关**: [confirm-center-user-guide.md](../confirm-center-user-guide.md) · [ADR-018](018-host-use.md) · [ADR-015](015-multi-agent-orchestrator-tab-lock.md)

> **过程史（非唯一规范）**：设计与对抗评审长文在 `docs/decisions/coordinate-computer-use-*.md`、`macos-computer-use-implementation-plan.md` 等。现行行为以本 ADR + 代码 `companion/src/computer/` 为准。

---

## Context

浏览器 CDP 无法覆盖「本机 GUI 应用窗口内」的点击与键入。需要在 **默认关闭**、**可审计**、**可急停** 的前提下提供坐标级 computer-use，并与 Apps 白名单、L2 确认台、Multi-Agent tab lease 共存。

---

## Decision

1. **工具入口**：`host_computer`（任务描述 + app token + actions[] + budget）。  
2. **双开关 fail-closed**：  
   - 全局 `computer.coordinateEnabled`（默认 false）。**0.5.0 用户路径**：Side Panel **Apps 面板**「坐标操作」调用 `computer.set_enabled`（可走生物识别/确认台）；亦可写 `config.json`。  
   - 每应用 `AppEntry.coordinateAllowed`（密码箱/终端/钱包/LOLBIN **结构排除**，永远不可开）。**浏览器**同样不能把该位置成 true（无人值守不得静默注入）；但 `host_computer` 可走 **一次性 L2**（确认台弹出，必须真人点允许；无人值守 / 三旗 / G1 **永不跳过**；授权不落盘）。  
3. **任务级 L2 强制**：枚举 task、app、全部 type 文本、预算。  
   - **全局 bool**（`allow_all_schemes` / `auto_approve_dangerous` / `auto_approve_enterprise_tools`）**永不**单独跳过任务级 initial L2（1–2 旗）。三旗全开巡航可 waive `forceConfirm`（含 **非浏览器** host initial）——与值守 grant 分列。**vault-browser one-shot（D2）永不 waive**（`resolveL2ForceConfirm` + `vaultBrowserOneShot`）。  
   - **例外（[ADR-021](021-unattended-desktop-session.md)，2026-08-09 修订）**：用户经短语+双勾选**显式武装**的进程内 **无人值守 grant** 可静默 **initial L2 与 mid-task re-L2**（含危险/实验/前台让出；仅 `coordinateAllowed` App；open_within_app；8h 墙钟）。硬拒绝仍 throw 无对话框。G1/巡航无 grant 时 PROMPT_ALWAYS 仍强制确认。**vault-browser one-shot 永不 skip**（G1 / 值守 / 巡航都不进入 skip 代数）。  
4. **Session-trust**（`computer/session-trust` G1）：进程内、按 thread（优先，initial-skip 仅 `thread:` key）/ ws + app；可抑制部分 mid-task re-L2；**显式 opt-in** 且 corpus ⊆ 已批、budget/actions ≤ 已见上限、未过期、无凭据闩时，可跳过 **同线程同 App 后续任务的 initial L2**；danger / experimental / foreground_yielded **始终 prompt**（无值守 grant 时）；~30min 自上次交互批准空闲过期；Companion 重启清空。  
   - **与 ADR-021 并行**：G1 = 交互后 corpus 子集；值守 = 预武装 open_within_app + re-L2 静默；两者均可置 `hostComputerTrustSkip`，代数为 OR，审计 reason 可区分。**vault-browser one-shot 两者都不可 skip。**  
5. **硬拒**：支付/转账/购买/验证码终确、凭据上下文键入、任务自弹对话框代点等。  
6. **UI**：Confirm Center / Cockpit 步骤轨 + 急停；关窗不停任务。  
7. **Multi-agent**：Worker `WORKER_HARD_DENY` 含 `host_computer`；存在 tab lease 时禁止对 **vault browser** 窗（Chrome / Chromium / Edge / Brave / Safari / …）坐标注入（`HOST_CHROME_TAB_LEASE`，按 `app` 字段匹配，不扫 task 正文）。  
8. **证据 / 模型**：evidence 目录与 TinyClick 等定位链路为实现细节；实验性 model 管线在设置中 opt-in。  
9. **全局开关 UI（0.5.0）**：Apps 面板已暴露 `computer.set_enabled` 切换；托盘入口仍可选增强。

---

## Consequences

- **正向**：桌面 GUI 自动化成为一等能力且默认关；确认台成为操控面。  
- **负向**：权限与平台适配成本高；Linux 非一等；用户须理解「双开关 + 任务级 L2（全局 bool 不跳过；G1 / ADR-021 值守条件放宽）」；全局开启经 Apps 面板或 config；值守 open_within_app 放大注入键入面。  
- **维护**：改开关语义或硬拒列表须同步用户指南 + 本 ADR + ADR-021；过程稿路径仅作历史。

---

## Code map

| 路径 | 职责 |
|------|------|
| `companion/src/computer/` | policy、executor、session-trust、estop、evidence、adapters、TinyClick… |
| `companion/src/bridge/tool-definitions.ts` | `host_computer` schema |
| `chrome-extension/.../CockpitApp.tsx` · `SafetyStrip` · `AppsPanel` | 确认台 / 急停 / 坐标开关（`computer.set_enabled`） |
