# ADR-014: Mission Pack（任务包）与企业能力模块

**日期**: 2026-07-26 | **状态**: 已实现（PR #77，待 merge）  
**相关**: 产品结论 `docs/decisions/v1.3/scenario-packs-product-conclusion-2026-07-26.md`；设计 `docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md`

## 背景

Chrome 插件形态下，用户希望在「通用浏览器 Agent」之上叠加**可安装的领域场景**（如应用安全审查、本机白盒辅助、受控 shell、企业内网探测），且：

1. **不应**把端口扫描 / 自由 shell 做成 Chrome Web Store 默认能力（政策与责任面）；
2. **应**支持企业本地安装 + 用户/管理员 **opt-in** 开启模块；
3. 已有 Skills / Knowledge / MCP / `tool_whitelist` / L2 确认栈，缺少**一次装配到 Thread 的组合层**。

## 决策

### 1. 两层对象：Module（安装级）× Pack（任务级）

| 对象 | 生命周期 | 作用 |
|------|----------|------|
| **Capability Module** | config 级 | 是否允许本机使用某类能力（`appsec` / `devsec-workspace` / `shell` / `netsec`） |
| **Mission Pack** | 可安装资产 + apply 到 Thread | skills + knowledge + tools 策略 + system_prompt_append 的任务模板 |

Pack **不是**新 LLM runtime：`pack.apply` = 写 Thread 字段（`mission_pack_id`、`tool_whitelist`、`active_skill_ids`、`system_prompt_append`、snapshot…）。

### 2. 双通道分发（community / enterprise）

- `config.capability_profile`: `community` | `enterprise`（Companion 为权威，扩展不可伪造）
- **community**：可装/用偏只读 Pack（如 AppSec）；**禁止**启用 shell/netsec
- **enterprise**：本地安装 SKU；shell/netsec 可 opt-in（默认 `enabled: false`）

### 3. 模块与工具（Companion 执行）

| 模块 | 工具 / 能力 | 安全合同 |
|------|-------------|----------|
| `appsec` | 内置 Pack `appsec-prd-review`（威胁建模 + 页面 checklist） | 偏浏览器只读 allowlist |
| `devsec-workspace` | `workspace_list_dir` / `workspace_read_file` | 路径须在**有效 root** 内：显式 `thread.workspace_root`（**仅原生 folder-picker 可绑定**）优先；未绑定时运行时回落 `~/CMspark-projects`（不写 thread；沙箱根不得为 symlink） |
| `shell` | `shell_exec`（单次命令，非自由交互 PTY） | **强制 L2 确认**（god-mode 不可静默跳过）；审计默认不记完整命令正文 |
| `netsec` | `netsec_port_scan`（TCP connect 探测） | 空 `target_allowlist` = 拒绝一切；任务级 `netsec.authorize_task`（`user_gesture` + allowlist 子集）；强制 L2 |

### 4. 关键实现约束

- **原子 apply**：切换/重应用 Pack 时从 pre-pack snapshot 在内存建 patch，单次 `applyPackPatch`；re-apply **冻结**原始 snapshot
- **uninstall 回滚**：用 `mission_pack_snapshot` 恢复 whitelist / skills / append
- **审计**：`~/.cmspark-agent/logs/capability-audit.jsonl`（0o600、append、轮转）
- **数据布局**：`packs/installed/<id>/pack.yaml` + 命名空间 skill/knowledge 复制装载
- **错误分级**：`default_sandbox_unavailable` / 遗留 `workspace_root not set` / `module_disabled` 为 **recoverable**；未绑定时默认沙箱即可 list/read，创建失败或模块未开时引导 Side Panel「场景」

### 5. UI

Side Panel 底部栏 **「场景」/「任务包」**（L0/L1）：列 Pack、应用、启用模块、选择工作区、NetSec 任务授权；未绑定时显示默认沙箱 `~/CMspark-projects`，绑定时显示 `workspace_root`。

## 后果

**正面**：场景可打包分发；企业高危能力与 CWS 默认面分离；复用现有确认栈与 Thread 模型。

**权衡 / 后续**：

- 当前 **不做** 交互式 PTY / Cockpit 内嵌终端（刻意用 `shell_exec` tool card）
- **不捆绑** nmap 等二进制；PATH/可选组件后话
- Pack 市场 / 远程自动安装：P2+ 另议
- 完整 `god-mode` 与 enterprise policy 文件（管理员预置）可再硬化

## 拒绝的方案

| 方案 | 原因 |
|------|------|
| 扩展内嵌原生 libghostty | MV3 无法 link native；UI≠shell |
| CWS 默认带扫描器 | 商店 dual-use + 法律责任 |
| Pack 放宽 `auto_approve_dangerous` | **2026-08-06 修订**：内置/installed 仍禁止；**仅 origin=user 场景** 可在 `trust` 块声明，于 `pack.apply`（user_gesture）写入全局配置，`unapply` 尽量恢复快照 — 见 [用户场景 Trust 设计](../superpowers/specs/2026-08-06-user-scene-tools-and-ai-create.md) 选项 B |

## 参考实现

- `companion/src/packs/` — engine / validator / audit / builtin appsec
- `companion/src/capability/` — modules / workspace / shell
- `companion/src/netsec/` — scope / scan
- `chrome-extension/.../PacksPanel.tsx`
