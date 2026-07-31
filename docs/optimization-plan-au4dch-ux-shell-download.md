# 后续优化方向：#au4dch 会话痛点（下载 · 运行态 · Shell）

> **日期**: 2026-08-01  
> **状态**: Active — 痛点驱动 backlog（**不**取代 [optimization-plan-post-adr-020.md](optimization-plan-post-adr-020.md) 的 A–E 排序权威；本文件是其 **UX / Shell 子轨**）  
> **触发会话**: `~/.cmspark-agent/threads/au4dch.json`（安装 Black-cat skill → 授权渗透 `60.205.226.234`）  
> **能力坐标**: [ADR-020](adr/020-capability-model-three-axes.md) · Shell 规格锚点：[mission-pack enterprise design §Shell](superpowers/specs/2026-07-26-mission-pack-enterprise-design.md) · [mission-pack-usage §4](mission-pack-usage.md) · Multi-agent：[multi-agent-user-guide.md](multi-agent-user-guide.md)

---

## 0. 一句话

长任务会话里，用户真正卡在三件事：**已有文件还被反复下**、**后台还在跑但侧栏像结束了**、**调了外部命令却只有黑窗没有可读输出**。  
本计划把它们拆成 **可合并的 P0 止血** 与 **独立 epic 的网页 Shell**，避免把「黑窗」误当成「必须立刻做 PTY」或把「卡住」误当成「只缺 multi-agent UI」。

---

## 1. 会话事实（证据基线）

| 观察 | 证据 | 含义 |
|------|------|------|
| 重复下载 | 用户：「我已经下载好了」；Agent 此前多次尝试发布包下载 | 缺「先查已有」一等能力 |
| 以为卡住 | 用户多次：「卡住了？」「现在如何了」「？」 | 长命令无进度；状态文案不可靠 |
| 非 multi-worker | 同线程约 **190× `shell_exec`**，**0× `spawn_worker`** | 主痛点是 **单线程长 tool**，不是 Fleet 未显示 |
| 超长命令 | 多条 `duration_ms` > 10s；至少 1 条 **~135s 超时 SIGKILL** | 默认 60s 级等待 + 无 stream 时体验崩溃 |
| 黑窗 | Windows 上 spawn 外部命令可见控制台 | `shell_exec` 未 `windowsHide`，且 stdout 仅结束时回传 |
| 网页 Shell 落空 | 文档明确「侧栏不做内嵌 PTY」；规格有 Cockpit xterm | **设计有、交付无**；one-shot 已上，交互终端未做 |

**纠偏**：用户口语「多个 sub agent」在 #au4dch 中对应 **skill 状态机 + 连续 shell**，不是 ADR-015 worker。优化必须同时覆盖 **单线程长 tool** 与 **真 multi-agent 主线程空闲感** 两条路径。

---

## 2. 与现有 backlog 的关系

| 主计划轴 | 本子轨 | 关系 |
|----------|--------|------|
| **B Trust**（P1-4 shell allowlist 等） | Wave A/B 的 shell 改动 | 动 `shell_exec` 时 **不得**放宽 L2；优先 `windowsHide` / progress，argv 化仍归 B |
| **C Composition** | 下载去重、装 skill 路径 | 属于 L1 浏览器 + 安装体验，**禁止**为此新开一级常驻面板 |
| **D Surface L2** | 网页 Shell（PTY） | 企业 Channel + Cockpit；沿用 enterprise design，不发明第二确认方言 |
| **E Autonomy** | 舰队运行态条 | 在已有 FleetStrip 上增强，**不做** auto-spawn / 静默 fan-out |
| **F 工程** | 单测 + 可选 e2e | progress / find downloads 必须可测 |

**排序原则**：Trust 硬门（B 未闭环项）仍优先于新功能；本子轨 **P0 止血不阻塞** 在「不改确认语义」的前提下可与 B 并行。

---

## 3. 三条优化方向（问题 → 根因 → 方向）

### 3.1 下载：先发现已有，再决定是否下载

**问题**  
安装/取包场景下 Agent 反复 `browser_download` / curl，用户已手动下过仍不复用。

**根因** `[inspected]`  
- `browser_download` + `download-waiter` 只跟踪**注册后新创建**的 download（故意忽略 pre-existing complete）。  
- 无 `chrome.downloads.search` 封装给 LLM；无 `prefer_existing` 契约。  
- Agent 只能 `shell_exec` 扫目录，路径脆弱、跨平台差。

**方向**

| ID | 工作 | 轴 | 状态 |
|----|------|-----|------|
| **DL-1** | 工具 `downloads.find`（或等价）：按 `filenameHint` / URL 子串 / 可选 regex 查 **complete + exists** 项，返回 path/size/endTime（只读） | L1 Surface | OPEN |
| **DL-2** | `browser_download` 增加 `prefer_existing?: true`（默认 true 或文档推荐 true）：命中则跳过点击，返回 `source: "cache"` | L1 | OPEN |
| **DL-3** | Skill / browse 提示：装包、取 release 前先 find | Composition | OPEN |
| **DL-4** | `force_redownload` + 同名不同大小/mtime 时提示冲突 | L1 | OPEN（可跟 DL-2） |

**安全边界**  
- 仅 Chrome Downloads API 可见项 + 既有 Downloads 沙箱路径；**禁止**任意盘符枚举。  
- 不自动执行下载的文件；安装 skill 仍走现有 import/路径校验。

**Done 判据**  
- 单元测：mock `downloads.search` 命中 → 不触发 click/waiter。  
- 真机：Downloads 已有 `foo.tar.gz` 时 Agent 一条 find 即拿 path。

---

### 3.2 运行态：后台未结束时，主界面不得「像结束了」

**问题**  
长 `shell_exec` / 多轮 tool 时用户以为卡死或已结束；未来 multi-worker 时 orchestrator `chat.done` 后主线程更像空闲。

**根因** `[inspected]`  

1. **`processingLabel` 结构错位**（`ChatView.tsx`）：只看「最后一条是否 assistant + tool_calls」，而 live 路径是 `tool.start` → **`role: "tool"`** 独立消息。  
2. **`shell_exec` 无 progress**：stdout/stderr 缓冲到 `close` 才进 `tool.result`（`capability/shell.ts`）。  
3. **空 assistant 气泡**（仅 tool_calls、无正文）视觉上像「说完了」。  
4. **真 multi-agent**：FleetStrip 存在，但主 chat `isProcessing=false` 与 worker 活跃解耦；`wait_workers` 是轮询不是屏障。

**方向**

| ID | 工作 | 轴 | 状态 |
|----|------|-----|------|
| **ST-1** | 修活跃态：扫描最近消息中 `status===running` 的 tool；文案 `执行中: shell_exec · 23s`；有 running tool 时输入区保持「忙」语义 | UI | OPEN |
| **ST-2** | WS `tool.progress`（或 `tool.delta`）：`tool_call_id` + elapsed_ms + stdout/stderr tail（截断）+ 可选 phase | 协议 | OPEN |
| **ST-3** | ToolCallCard 订阅 progress：滚动 tail、超时倒计时、`timed_out` 预告 | UI | OPEN |
| **ST-4** | FocusBand / 顶栏「本线程活跃任务」：running tools 计数 + 最坏耗时 | UI | OPEN |
| **ST-5** | Orchestrator 有未完成 worker 时：主线程常驻「舰队运行中 · N」并链到 FleetStrip / Cockpit | Autonomy | OPEN |
| **ST-6** | （可选）`wait_workers` blocking 模式：timeout + abort，**仍须** L2 策略不静默 | Autonomy | deferred |

**不做**  
- 不为「像卡住」发明第二 Agent runtime。  
- 不在 progress 通道塞完整命令密钥（审计策略与 shell 一致：默认不落完整 secret）。

**Done 判据**  
- #au4dch 类 60s+ 命令期间：侧栏始终可见 running + 时间 + 输出尾。  
- 用户无需连发「？」也能判断是否在跑。  
- spawn 场景：worker 未完时主线程有明确指示（ST-5）。

---

### 3.3 Shell：先止血黑窗与可见输出，再做网页交互终端

**问题**  
「之前说做网页端 shell」——用户期望在插件/确认台里看命令与输出；实际只有 one-shot + Windows 黑窗。

**根因** `[inspected]`  
- 交付：`shell_exec` one-shot（`spawn` + `shell: true`），**无** `windowsHide`。  
- 规格：Companion `node-pty` + Cockpit **xterm.js**、`confirm_per_command`、session 绑 thread —— **未实现**。  
- 文档已诚实写「没有内嵌交互终端」；产品预期未对齐。

**方向（两轨，禁止混成一个 PR）**

#### 轨 A — One-shot 止血（优先）

| ID | 工作 | 状态 |
|----|------|------|
| **SH-A1** | `shell_exec`：`windowsHide: true`（win32）；darwin/linux 无黑窗则 no-op | OPEN |
| **SH-A2** | 与 ST-2 共用 progress：chunk 截断写入 tail（MAX 与现有 200k 总 cap 协调） | OPEN |
| **SH-A3** | ToolCallCard `shell_exec` 专用展开：exit_code / duration / stdout·stderr 预览 | OPEN |
| **SH-A4** | 文档：`mission-pack-usage` 明确「黑窗 = 已知缺陷 → A1 修复；交互终端 = 轨 B」 | OPEN |

#### 轨 B — 网页 Shell epic（原 PR-F / design §C.shell）

| ID | 工作 | 状态 |
|----|------|------|
| **SH-B1** | Companion `node-pty` session：`thread_id → pty_id` 一对一；kill 杀 process group | OPEN |
| **SH-B2** | Cockpit + xterm.js；L0 不可见完整终端；确认 kind `shell.command` / `shell.session` | OPEN |
| **SH-B3** | policy：`confirm_per_command` 默认；`confirm_session` 显式 opt-in + audit | OPEN |
| **SH-B4** | lifecycle：fork 不继承；Companion 重启 session 死；crash 全关 + audit | OPEN |
| **SH-B5** | dual-review + 对抗：TIOCSTI / 注入 / 跨 thread 复用禁止 | OPEN |

**轨 B 前置**  
- 企业 `capability_profile` + module shell 已启用（现有门）。  
- Trust B 中与 shell 相关的 allowlist/argv 收敛宜并行或先于 session 自由输入。  
- **禁止** 在 Side Panel 320px 里塞半成品 PTY 当「完成网页 Shell」。

**Done 判据**  
- 轨 A：Windows 真机无黑窗；长命令侧栏可见 tail；与 #au4dch 同类 recon 可观测。  
- 轨 B：Cockpit 内可交互；每命令（默认）经确认；审计与 design 表一致；有 e2e/对抗记录。

---

## 4. 推荐执行波次

```text
Wave 0  文档与预期对齐（本文件 + 用户指南一句话 + 主 plan 交叉引用）
Wave 1  止血（可同一 PR 或 1–2 个小 PR）
          SH-A1 windowsHide
          ST-1  processingLabel / 活跃 tool 扫描
          ST-2 + ST-3 + SH-A2  tool.progress + shell tail + ToolCallCard
Wave 2  下载去重
          DL-1 + DL-2（+ 单测）；DL-3 提示词
Wave 3  编排态可见
          ST-4 FocusBand；ST-5 舰队运行中
Wave 4  网页 Shell epic
          SH-B1…B5（独立分支 / dual-review / 不可与 Wave1 混 PR）
```

**建议默认下一枪**：Wave 1（直接消掉 #au4dch 的「卡住 + 黑窗」）。  
**Wave 4** 单独排期，不因用户一句话「做 shell」就插入阻塞 Trust 的大改。

### 波次 × 粗工时

| Wave | 工时感 | 风险 |
|------|--------|------|
| 0 | 0.5h | 低 |
| 1 | 1–2d | 中（新 WS 事件需版本兼容：旧扩展忽略 progress） |
| 2 | 0.5–1d | 低–中（Downloads API 权限已有则低） |
| 3 | 0.5–1d | 低 |
| 4 | 1–2w+ | 高（PTY / 确认 / 审计 / 平台） |

---

## 5. 代码锚点（实现时第一落点）

| 区域 | 路径 |
|------|------|
| shell one-shot | `companion/src/capability/shell.ts` |
| shell 工具 schema | `companion/src/bridge/tool-schemas.ts` |
| tool.start / 执行 | `companion/src/server.ts`（tool.start 等） |
| 下载 | `chrome-extension/src/background/browser-download-handler.ts` · `download-waiter.ts` |
| 下载工具定义 | `companion/src/bridge/_browser_download_tool_snippet.ts` |
| 侧栏状态 | `chrome-extension/src/sidepanel/components/ChatView.tsx`（processingLabel / ToolCallCard） |
| WS 入站 | `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` |
| 舰队 UI | `chrome-extension/src/sidepanel/components/FleetStrip.tsx` · `companion/src/orchestrator/fleet.ts` |
| PTY 规格 | `docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md` §C.shell |

---

## 6. 协议草图（Wave 1，非最终 ADR）

```text
// Companion → Extension（执行中可多帧）
{
  type: "tool.progress",
  thread_id: string,
  tool_call_id: string,
  tool_name: string,          // e.g. "shell_exec"
  elapsed_ms: number,
  stdout_tail?: string,       // 末 N 字符，已截断
  stderr_tail?: string,
  note?: string               // 可选："waiting for process"
}

// 兼容：旧客户端忽略未知 type；tool.result 仍为权威终态
```

实现时若已有近似事件名，**复用不扩**；新 type 须在 architecture / 测试中登记。

---

## 7. 验收场景（回归剧本）

1. **Download cache**：Downloads 已有 `black-cat-v1.1.0.tar.gz` → find / prefer_existing → 返回 path，无第二次 download 条目。  
2. **Long shell**：`shell_exec` 跑 30s+ 命令 → 侧栏显示 running + 秒数 + tail；Windows 无黑窗。  
3. **Timeout**：命令超 `timeoutMs` → 用户在超时前可见 elapsed；结束后 `timed_out` 明确。  
4. **Multi-agent（可选 Wave 3）**：spawn 2 worker 后 orchestrator 空闲 → 仍显示「舰队运行中 · 2」直至 worker 结束或全停。  
5. **PTY（Wave 4）**：Cockpit 开 shell → 输入命令 → L2 → 见输出；关 thread / 杀 session 无孤儿进程。

---

## 8. 明确非目标（本子轨）

| 非目标 | 原因 |
|--------|------|
| Side Panel 内嵌完整终端当默认 | 规格落在 Cockpit；320px 不适合作主终端 |
| auto-spawn / 静默 fan-out | ADR-015/020 硬禁 |
| progress 全量落盘审计 | 与现有 shell 审计「默认不存命令正文」一致 |
| 用 god-mode 跳过 shell L2 | Trust 纪律 |
| 为装 skill 开放任意路径读写 | 仍走 Downloads / 已有 import 门 |

---

## 9. 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-01 | 初版：#au4dch 三痛点 → DL / ST / SH 两轨；Wave 0–4；挂接 ADR-020 主 plan |
