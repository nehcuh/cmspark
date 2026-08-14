# acp-residual-b12 · Claude + Pi 双路复审共识

> **日期**: 2026-08-14  
> **范围**: Mode C dual-review blockers B1/B2 residual（feat/coding-agent-panel worktree）  
> **原文**:  
> - Claude: `acp-b12-claude-dual-20260814-120255.md`  
> - Pi: `acp-b12-pi-dual-20260814-120255.md`  
> - Patch: `acp-b12-residual-diff-20260814-120255.patch`  
> **前序**: `acp-design-closeout-dual-consensus-20260814-101318.md`（B1/B2 为 ship 阻塞）

---

## 裁决

| 路 | 裁决 |
|----|------|
| **Claude** | **APPROVE_WITH_NITS** |
| **Pi** | **APPROVE_WITH_NITS** |

**合成裁决: APPROVE_WITH_NITS（可 dogfood / 非 redesign）**

- **B1 Chip Stop 诚实** = **DONE**（双方）  
- **B2 Panel Mode C 源诚实** = **DONE**（双方）  
- 仅剩 nits；无 REQUEST_CHANGES

---

## 完成度对照（双路）

| 项 | Claude | Pi | 共识 |
|----|--------|-----|------|
| B1 Chip 停止监视会话 | DONE | DONE | **DONE** |
| B2 Panel session 字段诚实 | DONE | DONE | **DONE** |
| Companion emit `open_local_terminal` + `local_terminal` | DONE | DONE | **DONE** |
| L0 vs L1 时间线文案 | DONE | DONE | **DONE** |
| Linux `-e` argv 拆分 | DONE | DONE | **DONE** |
| L2 TOCTOU snapshot | DONE | DONE | **DONE** |
| 范围测试 / tsc | — | green (Pi) | **[executed] green**（companion tsc + 73 acp tests；extension tsc） |

---

## 阻塞项（相对 closeout 共识）

| ID | 状态 |
|----|------|
| **B1** Chip 始终「停止编程会话」 | **已关** |
| **B2** Panel live config + timeline regex | **已关** |

机制摘要（双方一致）：

1. `propose()` 拍 `open_local_terminal_snapshot`；`maybeOpenLocalTerminal` 只用 snapshot。  
2. `emitProgress` 每条 `acp.session.event` 带 `open_local_terminal` + `local_terminal`（pending|opened|opened_l0|failed|skipped）。  
3. Chip / Panel Stop 与 banner 只信 `session.openLocalTerminal` + `session.localTerminal`。  
4. Live config 仅用于**开局前**复选框，不驱动运行中诚实文案。

---

## 双路 nits（非阻塞）

| ID | 来源 | 内容 | 处置 |
|----|------|------|------|
| N1 | 双方 | Panel `modeCLikely \|\| modeCTerminalRunning` 冗余 | **已修**（collapse → `modeCLikely`） |
| N2 | Pi | Chip banner 对 `failed`/`opened_l0` 仍用「Agent 需在终端退出」 | **已修**（与 Panel 对齐分支文案） |
| N3 | Pi / 前序 | 死代码 `CodingSessionShell` Stop 未跟 Mode C | **已修**（同逻辑；仍零 importer） |
| N4 | Claude | L0/L1 timeline 字符串无单测 | DEFER（低风险；snapshot 已有门控测试） |
| N5 | Pi | offered 阶段 `local_terminal:pending` 文案略早 | 接受（intent 已锁定；文案「正在打开」） |
| N6 | Pi | computer-uia 15 fail 无关本 diff | out of scope |

---

## 相对「设计是否完成 / 可否 ship」

| 设计包 | 双审后 |
|--------|--------|
| Mode C 主路径（双进程 + 诚实 Stop） | **完成** |
| 壳方向 P0–P2 closeout | **完成**（含 B1/B2 residual） |
| DEFER 项（TUI embed / full tree / Monaco…） | **正确未做** |
| 可宣称 dogfood | **是**（macOS 主路径；Linux 已 argv 加固） |
| merge 建议 | 用户确认后 commit；不自动 push |

---

## 验证证据

- `[executed]` companion `tsc --noEmit` exit 0  
- `[executed]` `node --import tsx --test tests/acp-*.test.ts` → **73 pass / 0 fail**  
- `[executed]` extension `tsc --noEmit` exit 0  
- `[inspected]` dual reviews APPROVE_WITH_NITS ×2  
- Workflow: `acp-residual-b12`（script_path run）+ 本共识收口

---

## 后续可选

1. 本地重装 Companion/扩展 dogfood Mode C（开本机终端 + Chip 停止监视）。  
2. DEFER 产品项单独排期。  
3. 用户指令后再 commit / PR。
