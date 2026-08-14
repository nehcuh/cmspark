# ACP residual batch · 多路独立对抗共识

> **日期**: 2026-08-14  
> **Worktree**: `.worktrees/feat-coding-handoff` (`feat/coding-agent-panel`)  
> **Brief**: `acp-adversarial-residual-brief-20260814-164012.md`  
> **Patch**: `acp-adversarial-residual-diff-20260814-164012.patch` (~155KB)  
> **范围集群**: B1/B2 Mode C 诚实 · agent-env 终端对等 · Mode C 任务注入 · 工作区 UX  

---

## 参与路与裁决

| 路 | 角色 | 工具 | 裁决 |
|----|------|------|------|
| **A** | Security / Trust | Claude | **APPROVE_WITH_NITS**（自称 dogfood 前需 B1 serverEnv denylist） |
| **B** | UX / Honesty | Pi | **REQUEST_CHANGES** |
| **C** | Correctness | Pi（首跑 Claude 超时重试） | **REQUEST_CHANGES** |
| **Claude dual** | 全栈 | Claude | **APPROVE_WITH_NITS** |
| **Pi dual** | 全栈 | Pi | **APPROVE_WITH_NITS** |

### 合成裁决

**APPROVE_WITH_NITS 偏 REQUEST_CHANGES（有少量应修项，无 redesign）**

- **功能主路径**（B12 诚实架构 / env 对等 / Mode C 任务注入 / 工作区一选自启）= **四集群 DONE**（双 dual 一致）  
- **Dogfood 可用性（macOS 主路径）** = 可继续 dogfood，但下列 **共识应修** 建议立刻补一刀  
- **公开 release 前** = 必须清完 privacy / applyable / Linux error 等项  

---

## 集群完成度（合成）

| 集群 | A | B | C | Claude dual | Pi dual | **共识** |
|------|---|---|---|---------|---------|----------|
| B12 Mode C Stop/字段诚实 | — | B2 PASS | PASS | DONE | DONE | **DONE**（session 字段源正确） |
| agent-env 终端对等 | PASS+nits | — | PASS | DONE | DONE | **DONE**（双 spawn 已接；失败缓存见下） |
| Mode C 任务注入 | PASS+nits | PASS+nits | PASS | DONE | DONE | **DONE**（非 banner-only；缺清理） |
| 工作区 UX 一选自启 | — | PASS | PASS+nits | DONE | DONE | **DONE**（防 double-pick 成立） |

---

## 跨路共识 · 应修（按优先级）

### P0 — 多路或 correctness 强烈要求

| ID | 来源 | 问题 | 处置建议 |
|----|------|------|----------|
| **R1 applyable 死合同** | **C B1** | `acp.session.event` 的 `pending_diffs` **无** `applyable`；reducer 要求 `applyable===true`；handback 之后又被 closed event 冲掉 → **起草模式 Apply 按钮永远不出现** | manager emit 时补 `applyable`，或 reducer 对 closed+hunks 用本地谓词；补回归测试 |
| **R2 prompt 文件不清理** | **A B2 · Claude dual · Pi dual · C N4** | Mode C `/tmp/cmspark-mode-c-*.md`（0o600）写完不 unlink；CLI 桥有 unlink | `$(cat)` 后 `rm -f` 再 `exec`，或 session close 扫尾 |
| **R3 pending 横幅说谎** | **B bug** | `emitProgress` 在 offered/closed 仍用 snapshot 推 `local_terminal:"pending"` → UI 写「正在打开本机终端…」但未开/已停 | 仅 `running` 且已调用 open 时用 pending；`cancel` 置 skipped/failed |
| **R4 login-shell 失败永久缓存** | **C B2 · Pi dual** | `loginShellEnvProbed=true` 在 probe 前设置，失败缓存 `{}` 整进程不再试 | 仅成功时 mark probed；失败允许重试 / 启动时异步预热 |

### P1 — 安全/卫生（mac dogfood 可后置，共享机/release 前必做）

| ID | 来源 | 问题 | 处置 |
|----|------|------|------|
| **R5 serverEnv denylist** | **A B1** | `server.env` 不经 `USER_ENV_DENYLIST`；`sanitizeAcpConfig` 原样吃磁盘 env | **降级说明**：`config.set` **不能**改 servers（仅 `enabled`），故 **非** WS 直注。仍建议在 `buildAcpAgentEnv` 过滤 `LD_PRELOAD`/`NODE_OPTIONS`/… 防手改 config.json |
| **R6 tmp 写 symlink/O_EXCL** | **A B3 · Claude dual nit** | `writeFileSync` 无 O_EXCL；名可预测 | `mkdtemp` 0o700 子目录或 O_EXCL |
| **R7 Linux spawn error** | **C B3 · Claude dual** | `openLinuxTerminal` 无 `error` 监听 → 可能打崩 companion | `child.on("error")` fail-soft |
| **R8 Mode C 勾选 reload 失真** | **B bug** | `normalizeConfig` 丢掉 `coding_handoff` → 扩展 UI 勾选恒假，companion 仍可能开终端 | normalize 保留 `coding_handoff` 或从 companionConfig 读 |

### P2 — UX 诚实（建议修，非阻塞 dual APPROVE）

| ID | 来源 | 问题 |
|----|------|------|
| **R9 failed 仍「停止监视」** | B | 终端 failed 时 Stop 更应「停止编程会话」或改 banner 说清楚只杀桥且无终端可续 |
| **R10 L0 文案** | B | L0 未粘贴前「Agent 需在终端退出」略早 |
| **R11 panel close 未清 pendingStart** | Claude dual | 关面板不清 `pendingStartAfterPickRef`，重开可能误触发 auto-start |
| **R12 pick_result 不校验 threadId** | B/C | 跨线程迟到的 pick 可能绑错目录 |
| **R13 DEEPSEEK 经 process.env 进 agent** | Pi dual | 与 user-env 对 DEEPSEEK 的 deny 意图不一致；建议 strip companion 专用 key |
| **R14 codex 死分支** | 多路 | 与 generic 相同，删或真正分化 |

---

## 明确通过（勿回退）

1. **B1/B2 字段源**：Chip/Panel/Shell Stop 与 banner 用 `session.openLocalTerminal` + `session.localTerminal`，非 live config + 时间线正则。  
2. **TOCTOU**：`open_local_terminal_snapshot` 在 propose 拍；L2 copy 与 `maybeOpenLocalTerminal` 同读 snapshot（A S3 需再确认 L2 文案路径 — handlers 已传 snapshot，**通过**）。  
3. **buildAcpAgentEnv**：ACP + CLI **双路径**已用；合并序与 PATH harden 有单测。  
4. **Mode C 任务**：`buildUserPrompt` → 临时文件 → `CMSPARK_TASK=$(cat) && exec`；Pi dual 在本机 osascript 路径做过经验证。  
5. **工作区**：`effectiveWorkspace` + `pendingStartAfterPick` 消除「选完还要点一次启动」主路径；`thread.list` on open。  
6. **Shell 转义**：`shellSingleQuote` + osascript `JSON.stringify` 被 A/Pi 认可。  

---

## 与「blocker」的校准（orchestrator 意见）

| 声称 | 校准 |
|------|------|
| A：**serverEnv 经 config.set 注入 LD_PRELOAD** | **过强**。`config.set` 仅允许 `acp.enabled`；servers 仅磁盘 sanitize / adopt_discovered。仍建议 denylist 作纵深。→ **P1 非 P0 blocker** |
| B：**REQUEST_CHANGES 因 failed 标签 + pending 横幅 + checkbox** | 诚实度真实；**dogfood 可忍**，修 R3/R8/R9 后可升 APPROVE |
| C：**applyable 死** | 若 dogfood 含 **起草+Apply**，则为 **P0**；仅审查模式 dogfood 可后置 |
| Dual 双方 APPROVE_WITH_NITS | 与「主路径可用、有 hygiene debt」一致 |

---

## 建议落地顺序（下一刀）

1. **R1** applyable 合同 + 测试（若要 dogfood 起草）  
2. **R2 + R6** Mode C prompt 文件生命周期（rm + mkdtemp/O_EXCL）  
3. **R3** pending 仅 running + cancel 清状态  
4. **R4** login-shell 失败可重试  
5. **R8** coding_handoff 进 normalizeConfig  
6. **R5/R7/R9–R14** 打包 follow-up  

---

## 产物路径

| 文件 |
|------|
| `docs/audit/reviews/acp-adversarial-A-security-20260814-164012.md` |
| `docs/audit/reviews/acp-adversarial-B-ux-20260814-164012.md` |
| `docs/audit/reviews/acp-adversarial-C-correctness-20260814-164012.md` |
| `docs/audit/reviews/acp-adversarial-claude-dual-20260814-164012.md` |
| `docs/audit/reviews/acp-adversarial-pi-dual-20260814-164012.md` |
| `docs/audit/reviews/acp-adversarial-residual-brief-20260814-164012.md` |
| `docs/audit/reviews/acp-adversarial-residual-diff-20260814-164012.patch` |
| **本共识** `acp-adversarial-residual-consensus-20260814-164012.md` |

---

## 一句话

> 四集群功能意图 **已落地且双 dual 认可**；多路对抗揪出 **applyable 死合同、Mode C 临时文件生命周期、pending 横幅说谎、login-shell 失败缓存** 等高价值 hygiene。**合成：可继续 macOS 审查路径 dogfood；起草 Apply 与 privacy 清理应尽快修。**
