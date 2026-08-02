## ADR-020 capability declaration

| Axis | Declaration |
|------|-------------|
| **Surface** | F1 host_cli = L2 Host; F2 Qwen = L2 CU experimental |
| **Composition** | Apps config + tool catalog; no bare middle agent |
| **Autonomy** | Workers hard-deny host_cli |
| **Trust** | god-mode cannot skip host_cli L2; experimental re-L2 always; Q5 |
| **Channel** | Community Apps structured CLI; free shell stays enterprise shell_exec |
| **originWs** | SecurityPolicy L2 token family shared with host_app |

# Master Plan：Apps CLI Phase-2 + Qwen3-VL 实验层 + 缺陷收敛

> **日期**: 2026-08-02  
> **状态**: Active / Autonomous AFK session  
> **触发**: 用户确认两功能未做完；要求 workflow 深度体检 → 对抗验证 → Pi 复审 → worktree 开发 → 双路（Pi+Claude）通过才停  
> **基线**: `main` @ 当前 tip（session 开始时 `007130b`）  
> **隔离**: 全部实现放在 **git worktree**，不污染用户当前工作区

---

## 0. 一句话

| 功能 | 产品语义 | 权威设计 |
|------|----------|----------|
| **F1 Apps CLI Phase-2** | App 页签 Segment B：白名单 CLI + 结构化 `host_cli` 契约执行（无 free-args） | [app-tab-design-draft.md](../../decisions/app-tab-design-draft.md) + adversary 修订 |
| **F2 模型下载配置 + 增强点击** | 设置页完成预检→大陆下载→启用；Computer Use 定位链 Qwen3-VL 实验层 | [qwen3-vl SoT](../specs/2026-08-01-qwen3-vl-experimental-layer-product-design.md) + [impl plan](./2026-08-01-qwen3-vl-experimental-layer-impl.md) |
| **D 缺陷** | 深度体检确认的 Critical/High + 已知 TCC/文案/门禁假绿 | 本会话 diagnosis 报告 |

**不做（本会话边界）**：

- Free-args CLI（P3）
- 网页 PTY Shell（SH-B epic）
- Developer ID / 公证（TCC 长期）
- 捆绑 Python venv / GGUF
- 直接 merge main（完成开发 + 双审后停；合 PR 由用户）

---

## 1. 已知基线（会话启动时 `[inspected]`）

### F1 CLI

| 项 | 状态 |
|----|------|
| GUI App tab + L0 `host_app` launch | 已交付 |
| `apps.add kind=cli` | **硬拒** `CLI_PHASE2` |
| AppsPanel Segment B | **占位文案** |
| `host_cli` tool | **不存在** |
| `cli_manifest` schema | 类型占位，无校验执行 |
| guards D1 vault/lolbin for cli | 数据层已有，执行路径未接 |

### F2 Qwen / 增强点击

| 项 | 状态 |
|----|------|
| 下载/预检/runtime/worker 骨架 | 已有代码 |
| 用户文案 TinyClick 残留 | **仍 OPEN**（`model-state-messages` / extension mirror） |
| `modelDiskBudgetMB` 产品义 | **仍引用**（应 D8 废除） |
| plan P0-1…P0-8 checkbox | 文档仍 open；需代码实测勾选 |
| 增强点击 = locate-chain `qwen-vl` + re-L2 | 部分接线；P0 绿前不宣称可内测 |

### 历史坑（禁止再犯）

1. **TCC 产品身份**：打包必须 bundle 级 codesign；用户可见主体只写 **CMspark**；勿引导勾 node/host  
2. **LS vs CLI TCC**：勿用 CLI `security-check` 断言 app 内 tap  
3. **host_app/host_cli 三处接线**：tool 名单 + `bindingPayloadFor` + executor；binding 非空断言  
4. **CLI 输出注入**：ANSI strip → 截断 → `wrapUntrusted`；Q5 见 CLI 输出后 state-changing 强制 L2  
5. **D1 vault 遗传**：CLI track 全量 vault/lolbin deny；GUI vault 禁模板  
6. **auto 仅 L0 无参**：带参 op 强制 L2  
7. **god-mode 永不跳** experimental re-L2 / host_computer 任务 L2  
8. **worktree 开发**，不写坏 main 工作树  

---

## 2. 验收条件（DoD）— 停止门

### F1 · Apps CLI Phase-2 — 必须全部满足

| # | 验收项 | 验证方式 |
|---|--------|----------|
| F1-A | 用户可在 Apps 面板 Segment **CLI 工具**添加 `win.cli.*` / `mac.cli.*`（枚举或粘贴路径），**非** `CLI_PHASE2` 硬拒 | 单测 + 手工 checklist |
| F1-B | `cli_manifest` 校验：schema_version、subcommands、flags value_regex、risk、timeout/max_output 上限 | unit tests |
| F1-C | 新工具 **`host_cli`**：`{app, subcommand, flags?, args?}`；**argv-only** `execFile`；无 shell；cwd pin；env 白名单（禁 `*_API_KEY`/`*_TOKEN`/`CMSPARK_*`） | unit + security tests |
| F1-D | vault/lolbin/CLI-on-vault：**add 与 exec 双门拒绝** | unit |
| F1-E | policy：auto 对 CLI **不** silent 执行带参（强制 L2 或按 risk→L2/biometric）；manual 全 L2 | unit |
| F1-F | 输出：strip ANSI → maxBuffer kill → 截断 → wrapUntrusted；`PAGE_CONTENT_TOOLS`/`source=cli`；Q5 flag 后 state-changing 降级 | unit |
| F1-G | SecurityPolicy **bindingPayloadFor** 含 app+subcommand+canonical flags/args 且 **非空** | unit（接线断言） |
| F1-H | 审计 `cli.exec`；system prompt 索引注入 CLI 条目（上限与 GUI 合计可控） | unit / snapshot |
| F1-I | 文档：`host-and-apps.md` 去掉「CLI 可忽略」占位，写清用法与边界 | docs review |
| F1-J | **禁止 free-args**；禁止 LLM `apps.add` | 代码审查 |

### F2 · 模型下载配置 + 增强点击 — 必须全部满足

对齐 [impl plan P0](./2026-08-01-qwen3-vl-experimental-layer-impl.md) + SoT：

| # | 验收项 | 验证方式 |
|---|--------|----------|
| F2-A | **P0-1** 坐标仅图像像素；宽屏假 0–1000 缩放删除；golden 矩阵 | tests |
| F2-B | **P0-2** `!canEnable` 时 `set_enabled(true)` 服务端拒绝 + UI disabled | tests |
| F2-C | **P0-3** 用户可见无 TinyClick（legacy 注释除外） | grep + mirror lock tests |
| F2-D | **P0-4** 许可门条款完整；hash 变则重过门；可复位 decline | tests |
| F2-E | **P0-5** worker.py 打包路径 resolve；缺失不崩 Companion | package path + unit |
| F2-F | **P0-6** free-disk ≥ 变体+2GB；废除 budgetMB 产品义 | unit |
| F2-G | **P0-7** downloading/partial 诚实态；无假百分比 | unit + UI |
| F2-H | **P0-8** `modelEnabled` 禁止 G1 initial-skip | unit |
| F2-I | locate-chain：UIA/OCR miss → qwen-vl 建议点 → **experimental re-L2** 必确认 | unit |
| F2-J | 用户文档 `qwen-vl-experimental-layer.md` 与旅程一致 | docs |
| F2-K | `npm --prefix companion test` + extension 相关测试绿 | CI/local |

### D · 缺陷门

| # | 验收项 |
|---|--------|
| D-A | Diagnosis 报告 Critical 全部修复或 **adversary+Pi 书面 wontfix** |
| D-B | Confirmed High 中与 F1/F2 路径交叉的全部修；其余 High 至少 ticket/ defer 记录 |
| D-C | 不引入 TCC 文案/身份回退；不新增引导勾 node |

### 停止门（Stop Gate）

仅当同时成立：

1. F1-A…F1-J 全部 `[executed]` 或等价证据  
2. F2-A…F2-K 全部 `[executed]`  
3. D-A + D-B  
4. **Pi VERDICT ∈ {APPROVE, APPROVE_WITH_NITS}**  
5. **Claude VERDICT ∈ {APPROVE, APPROVE_WITH_NITS}**  
6. 任一 REJECT → 修 → 再双审，**不得停止**

不确定时：先问 Pi 与 Claude；双路同意「可停」才停。

---

## 3. 执行流程（workflow）

```text
Phase 0  会话交接 + 本 plan + 验收锁
Phase 1  deep-diagnosis-fanout workflow（只读体检）
Phase 2  综合 findings + 两功能 plan → 内部对抗 subagent → Pi 复审 plan
Phase 3  worktree: feat/apps-cli-phase2 | feat/qwen-vl-p0 | fix/diagnosis-batch
Phase 4  实现 F1（TDD）
Phase 5  实现 F2 P0（TDD）
Phase 6  修 D Critical/High
Phase 7  dual-external-review (Pi + Claude) → 迭代至通过
Phase 8  写完成报告 + session handoff（不自动 merge main）
```

中途决策：

```text
分歧 → 对抗 subagent（默认怀疑）→ 合成 → Pi 复审 → 按裁决继续（不等人）
```

---

## 4. Worktree 布局

| Worktree 目录 | 分支 | 范围 |
|---------------|------|------|
| `../cmspark-wt-cli-p2` | `feat/apps-cli-phase2` | F1 |
| `../cmspark-wt-qwen-p0` | `feat/qwen-vl-p0-complete` | F2 |
| `../cmspark-wt-diag-fix` | `fix/diagnosis-2026-08-02` | D（可与特征串行 cherry-pick） |

若依赖冲突，允许在 **单一 worktree** `feat/cli-qwen-diag-20260802` 串行交付，但仍 **不写 main 工作树**。

---

## 5. 实现切片（atomic）

### F1

1. `types`：`CliManifest` 严格类型 + `validateCliManifest`  
2. `apps.add` 放开 `kind=cli` + guards  
3. `host_cli` tool def + schema + catalog  
4. executor：argv-only spawn + caps  
5. server gate + bindingPayloadFor + Q5 flag  
6. AppsPanel Segment B UI  
7. system prompt index  
8. tests + docs  

### F2

按 impl plan commits 1–8 + docs。

### D

Diagnosis 报告优先级表驱动。

---

## 6. 变更日志

| 日期 | 说明 |
|------|------|
| 2026-08-02 | 初版：AFK 会话 master plan + 验收锁 |
