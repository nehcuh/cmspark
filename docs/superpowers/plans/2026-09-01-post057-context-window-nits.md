# post-0.5.7：context_window 默认 512000 + 双路 nits

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**GitHub:** [#268](https://github.com/nehcuh/cmspark/issues/268)  
**Date:** 2026-09-01  
**HEAD baseline:** `20339f93` (`main`) — implement on a branch, not on main.  
**Adversary:** PRODUCT / CORRECTNESS / SECURITY / SKEPTIC（独立）合成。SKEPTIC 对「512k 工厂默认」记名异议，见 §Dissent。

**Goal:** 新装默认 Agent 工作预算 512000；磁盘过小窗口在**不写** `config.json` 的前提下不再把当轮工具 JSON 砍成 `{"succes…`；0.5.7 双路 F1–F3 按**独立批次**诚实化。F4 不扩 UI。

**Architecture:** `context_window` 是 companion 压缩预算，不是供应商窗口承诺。`deepMerge` 磁盘标量获胜。本票分四批（B0 预算 / B1 文案 / B2 启动器 / B3 listen），可同 Issue 叠 PR，**禁止单 commit 混装**。F3 若做 listen-first，必须同 PR 带「本轮未提供的 mcp__ 不得执行」。

**Tech Stack:** companion TypeScript, chrome-extension React, NSIS/zip launchers, Node test runner.

**Spec:** Issue #268 + 本 plan。压缩数学不改（`computeReserve` 0.15 / replyReserve）。相关：`docs/superpowers/specs/2026-08-06-settings-thread-compact-ux.md`（128k 决策被本票**显式推翻工厂默认**，不是 nit 清理）。

## Global Constraints

- Issue-first：`GitHub: #268`。实现 PR `Closes #268` 或分 PR `Refs #268`。
- 不写 live `~/.cmspark-agent/config.json` 的 `context_window`（无 `saveConfig` / `atomicWrite` 治疗 4000）。
- 过小磁盘值的运行时生效预算 **不得**抬到 512000（抬到 **128000** 或 `reserve+MIN_LIVE`，Settings 双真）。
- 不放宽 `workspace_root` containment；不做 Windows 方言 / CI 矩阵（tuwckn 另票）。
- F4：零新 UI、零 `run_progress: null` 生产写入方。
- 不改 L2 / `confirm_per_command` / `verifyClient` / `ws_secret` / pairing。
- 默认模型仍是 DeepSeek-class，除非另票改 `model_name`。
- Settings 预同步 `handleSave` 不得把新默认/下限持久化到未水合的磁盘值。
- 本票 NEVER：overlay/#230、#228 outbound、SEA 重新进官方 NSIS payload。

## Dissent（SKEPTIC · 必须保留）

Lane D **反对**把工厂默认从 128000 改为 512000：这是 2026-08-06 / Pi R5「128k 才能让自动压缩触发；1e6 ≈ 永不压」的逆转。512k 预算约 435k，短对话几乎不压；默认模型仍是 `deepseek-v4-flash`，供应商窗口常在 64k–128k。

**用户钉 512000，本 plan 执行该钉**，但：

1. `config.ts` 注释必须改成承认「工厂默认 512k = 压缩更晚触发；请按模型真实上限改」。
2. 不得把 512k 说成「修了 tuwckn 的 4000」。4000 的修复是 **运行时下限 + shrink 不再输出半截 JSON**。
3. 双路复审本 plan 可以继续 REJECT 512k 默认；那是允许的。实现者在用户钉未被撤回前仍按 512k 做 B0。

---

## 批次（独立可撤）

| 批 | 内容 | 独立 PR？ | 回滚不影响 |
|----|------|-----------|------------|
| **B0** | 默认 512000 lockstep + 过小窗口运行时下限（不写盘）+ shrink 解释失败封闭 + Settings 三档文案 + 预同步 Save 守卫 | 是（本票主 PR） | B1–B3 |
| **B1** | F1 CHANGELOG/README/CLAUDE 活切点诚实 | 可并进 B0 文档 commit，或单独 docs PR | 代码 |
| **B2** | F2 zip 启动器 node.exe+js 优先于 leftover SEA | 单独 PR | B0/B3 |
| **B3** | F3 listen 不阻塞于 MCP start + **本轮未提供的 mcp__ 拒执行** | 单独 PR；安全测试不过则整批不合并 | B0/B2 |

F4：CHANGELOG Known residual 已有「无生产写入方」。本票 **不改代码**。

---

## B0 — 预算默认 / 下限 / shrink

### 产品句

新装 `context_window=512000`。磁盘 `< 16000` 时，**本进程**按 128000 做预算（文件仍是 4000）；设置页同时显示磁盘值与生效值。工具结果收缩不得输出 `{"succes…`。

### Files

- Modify: `companion/src/config.ts:394-395`（默认 + 注释）
- Modify: `companion/src/llm/context-budget.ts`（`shrinkToolBodiesToFit`；可选 `effectiveContextWindow`）
- Modify: `companion/src/llm/adapter.ts`（入口一次性换成 `effective`：`MAX_FILE_TOKENS` `:415`、`applyContextBudget`、`computeMaxTokens` `:977`/`:1104` 全吃生效窗口，禁止只改预算那一处）
- Modify: `chrome-extension/src/utils/config.ts:12`
- Modify: `chrome-extension/src/sidepanel/store/agentStore.tsx:491`
- Modify: `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx:438-443,1858-1866`
- Modify: `companion/src/settings-web.ts:819`
- Modify: `README.md:201`
- Test: `companion/tests/config.test.ts`
- Test: `companion/tests/context-budget.test.ts`（shrink 非 JSON 前缀）
- Test: extension store/settings 默认

### 生效窗口（钉死）

```ts
export const CONTEXT_WINDOW_DEFAULT = 512000
export const CONTEXT_WINDOW_TINY = 16000
export const CONTEXT_WINDOW_FLOOR = 128000 // runtime only; never persist

export function effectiveContextWindow(disk: number): {
  disk: number
  effective: number
  floored: boolean
} {
  const n = Number.isFinite(disk) ? Math.floor(disk) : CONTEXT_WINDOW_DEFAULT
  // 非正数与 < TINY 同等：生效 128000，不写盘（Kimi dual nit）
  if (!Number.isFinite(n) || n <= 0 || n < CONTEXT_WINDOW_TINY) {
    return { disk: n, effective: CONTEXT_WINDOW_FLOOR, floored: true }
  }
  return { disk: n, effective: n, floored: false }
}
```

- `floored === true` → `logger.warn("llm.context_window_too_small", { disk, effective })`。**禁止** `saveConfig`。
- Settings 帮助三档：
  - `disk < 16000`：过小，本轮按 128000 生效，**未改配置文件**。
  - 默认附近：新默认 512000 是 Agent 工作预算；请按模型真实上限填。填太大压缩来不及挡供应商 400。
  - `>= 1000000`：极大，自动压缩几乎不触发（1e6 历史）。
- **删除** `>= 200000 → 推荐 128000` 分支（否则 512k 默认自打脸）。

### shrink 解释失败封闭

`shrinkToolBodiesToFit`（`context-budget.ts:314-353`）：

- 敏感集合（已有 `COMPACT_SENSITIVE_COOKIE_TOOLS` / `COMPACT_SENSITIVE_CODE_TOOLS`）+ 密钥形 `mcp__*`：缩成 **name + len**，禁止切片正文。
- 其余 tool 行：内层改为非 JSON 通知，例如 `[tool_result_truncated chars=N]`，保留 `<untrusted>` 外壳。
- **禁止** `raw.slice(0, next) + "…"` 产生 `{"succes…`。
- `thread.context_compacted` 在 `dropped_count===0` 但发生 shrink 时带 `shrunk: true`。

### 预同步 Save 守卫

`SettingsSlideout` `handleSave`：在 companion `config.updated` 水合前，**不要**用 `initialState` 的 512000 整包覆盖磁盘。最小实现：Save 禁用直到第一次 `config.updated`，或只 PATCH 用户碰过的字段。

Pi M2 已记此 race：改 extension 默认后，未水合 Save 会把 4000/128k/1e6 静默写成 512k。

### TDD（B0）

- [ ] **T0** `config.test.ts`：空目录 `initDataDir` → 磁盘+内存 512000；磁盘 4000 → 运行时 `getConfig().llm.context_window === 4000` 且磁盘不变；`effectiveContextWindow(4000).effective === 128000` 且 `floored`；`effectiveContextWindow(0)` / 负数同样 floored 到 128000；缺 key → 内存 512000、磁盘仍缺 key。
- [ ] 跑红：`npm --prefix companion test -- tests/config.test.ts`
- [ ] 改 `defaultConfig` + `effectiveContextWindow`；再绿。
- [ ] **T0b** `context-budget.test.ts`：超预算的 `{"success":true,"data":"SECRET"}` shrink 后 **不是** 该 JSON 的前缀；`get_cookies` / `evaluate` / `shell_exec` 只剩 name+len。
- [ ] 改 `shrinkToolBodiesToFit`；再绿。
- [ ] **T1** extension：`initialState` / `DEFAULT_LLM_CONFIG` === 512000；512000 帮助文案不得匹配 `/推荐 128000/`；`<16000` 文案含「未改配置文件」。
- [ ] **T1b** Save：无 `config.updated` 时 handleSave 不发全量 512000。
- [ ] **T2** `settings-web.ts` `||512000`
- [ ] **T3** README 表从 **64000**（今日活表，已与代码 128000 三方漂移）改为 512000；lockstep grep 必须显式打 `64000` 与 `128000`；`config.ts` 注释改写。
- [ ] CHANGELOG Unreleased：默认 512000；过小窗口运行时按 128000；不写盘。

Verify: `npm --prefix companion test -- tests/config.test.ts tests/context-budget.test.ts`；`cd chrome-extension && npm test` 相关文件。

---

## B1 — F1 文案

### Files

- `CHANGELOG.md:15`（0.5.7 Added 过售句；优先改活切点而不是只加 0.5.8 脚注）
- `README.md:957`
- `CLAUDE.md:37`

合成句：**页面工具前必须 propose；成功后才挂卡。模型放弃 / 纯问答则无卡。**

不要动 `CHANGELOG.md:108` 历史节。不要弱化 `PROPOSE_REQUIRED` 测试。

- [ ] grep 活文档不再把「聊天列出现可勾」写成保证。
- [ ] `cd chrome-extension && npm test` run-progress 相关保持绿。

---

## B2 — F2 启动器

### Files

- `companion/launch-hidden.vbs:22-30`：`node.exe`+`cmspark-agent.js` **先于** `cmspark-agent.exe`
- `companion/launch.bat:9-15`：同上；错误文案不要把 `cmspark-agent.exe tray` 当主路径
- `companion/README.txt:52-57` FAQ
- `scripts/tests/test-package-gates.sh` 静态断言顺序
- 保留 `scripts/installer.nsi:84-85` Delete leftover SEA（不是 `companion/installer.nsi`）

钉：

- 官方树（js+node 在、exe 也在）→ 启动 **node**。
- 仅 SEA 便携树（有 exe 无 js）→ 仍能启动 SEA。
- 23401 已被 leftover SEA 占用 → **不**在 launch.bat 里杀进程；可警告「端口被 cmspark-agent.exe 占用」。

- [ ] 红：gates 脚本断言 VBS/BAT 中 `node.exe` 出现在 `cmspark-agent.exe` FileExists 之前。
- [ ] 改三文件；`bash scripts/tests/test-package-gates.sh`

---

## B3 — F3 listen + offered-catalog

### 为什么必须带安全门

listen-first 后，第一轮 `chat.create` 可能在 MCP `connected` 之前快照空工具表，但 rule 10 仍教 `mcp__filesystem__*`。`executeMcpTool` 用 **live** `resolveToolName`。默认 filesystem `trusted` 读不走 L2。竞态：模型发明 `mcp__filesystem__read_text_file` → 中途 `reaggregate` → **无确认读家目录**。SECURITY 路：offered-catalog 与 listen-first **同 PR**，禁止 follow-up。

### Files

- `companion/src/ws/lifecycle.ts:700-738`：`getOrCreateSharedSecret` → `initServices` → 注册 MCP 监听 → **构造 WSS+`verifyClient` → `listen`** → 再 `mcpManager.start`（不要 await 挡 listen）。禁止先 listen 再挂 WSS。
- `companion/src/llm/adapter.ts`：本轮提供过的工具名集合。
- `companion/src/mcp/dispatch.ts` 或 adapter `executeTool`：`mcp__*` 不在本轮 snapshot → 硬错误 `tool_not_offered`，即使后来 connected。
- 新测试：MCP start hang 15s → `/healthz` 与 HMAC 在 ≪15s 成功；随后发明 `mcp__filesystem__read_text_file` **不得**读盘。

钉：

- `/healthz` 仍是存活，不是 MCP ready。Tray「已连接」仍是 `auth.ok`。
- 不把 MCP ready 做成 WS 门（否则 F3 白做）。
- origin / unauth terminate / pairing 不变。

- [ ] 红：注入永不 resolve 的 `mcp.start`，断言 `listen` 在其 settle 前调用（当前 `lifecycle.ts` 应失败）。
- [ ] 红：snapshot 无 MCP 工具时 dispatch `mcp__filesystem__read_text_file` → not offered。
- [ ] 实现 listen-first + offered-catalog。
- [ ] `npm --prefix companion test` 含 ws-auth / healthz / 新测试。

---

## 明确不做

- F4 sticky-null UI
- 静默把磁盘 4000 写成 512000
- 把 `computeReserve` 调成「512k 也能常压缩」（新预算政策，另票）
- tuwckn N7 / OS 身份 / `windows-latest` 全量
- 本代理会话改用户 live `config.json`（用户要改请自己 Settings 保存或 `settings --set`）

---

## 验证总表

| 批 | 命令 |
|----|------|
| B0 | `npm --prefix companion test -- tests/config.test.ts tests/context-budget.test.ts`；extension 相关 test |
| B1 | 活文档 grep + run-progress tests |
| B2 | `bash scripts/tests/test-package-gates.sh` |
| B3 | companion ws-auth + healthz + 新 hang/offered-catalog 测试 |
| 回归 | W1e `scratch/w1e-replay.ts`；不要全仓陪跑除非碰 shell |

---

## Dual-review REJECT 针（给 Claude/Kimi 审 **本 plan**）

REJECT 若 plan 仍出现：

1. 单 commit 混装 B0+B2+B3
2. 只改默认、没有下限或 shrink 封闭（本机 4000 仍 `{"succes…`）
3. 启动时写盘治疗 4000
4. 512k 默认但 Settings 仍 `>=200000 → 推荐 128000`
5. 下限生效值抬到 **512000** 且不披露
6. F3 listen-first **没有** offered-catalog 测试
7. F4 UI
8. tuwckn Windows/path-escape/CI 混入文件列表
9. 无 `GitHub: #268`
10. 预同步 Save 未钉
