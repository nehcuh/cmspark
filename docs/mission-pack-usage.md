# Mission Pack（任务包）使用说明

> 面向试用 / 验收 / 本机开启企业能力。  
> 设计决策见 [ADR-014](adr/014-mission-pack-enterprise-modules.md)；架构总览见 [architecture.md §7](architecture.md)。  
> **高危工具弹窗 /「确认台」按钮**：见 [confirm-center-user-guide.md](confirm-center-user-guide.md)（与任务授权、L2 确认分层说明）。

### 能力坐标

| 轴 | 本指南位置 |
|----|------------|
| **Surface** | Pack **不改变**拓扑：浏览器场景多在 **L1**（如 AppSec）；`shell` / `netsec` / workspace 属更深本机能力，走对应门禁（确认台） |
| **Composition** | **主叠加路径** — 把 skills + knowledge + tool 白名单 + 提示词一次装到线程；**不是**新 Agent runtime |
| **Autonomy** | 可与 multi-worker 交叉（§10）；内置/installed Pack **不能**抬 Trust；**仅「我的」场景** 可经 Trust 块 + user_gesture 写全局（见 §2c） |
| **Channel** | `community` vs `enterprise`（安装级，扩展不可伪造） |
| **规范** | [ADR-020](adr/020-capability-model-three-axes.md) · [ADR-014](adr/014-mission-pack-enterprise-modules.md) |

**怎么理解「高级场景」：** 黑盒 / AppSec 类 = 多半是 **L1 + 本 Pack 配方**；不是必须打开 Computer Use（L2）。需要本机命令或端口探测时，才是 enterprise 模块 + 确认台。

---

## 0. 先读：两档能力与四个模块

| 概念 | 含义 |
|------|------|
| **`capability_profile`** | Companion 安装级通道：`community`（默认）或 `enterprise`。写在 **`~/.cmspark-agent/config.json`**，**扩展不能伪造**（商店默认不开放高危能力）。 |
| **Module（模块）** | 某类能力是否允许使用：`appsec` / `devsec-workspace` / `shell` / `netsec`。默认 **`enabled: false`**，需 opt-in。 |
| **Mission Pack（任务包）** | 装到线程上的场景模板（skills + 工具策略 + 提示词等）。Pack 可 **require** 某些模块；模块未开时「应用到当前线程」会失败或按钮不可用。 |

| 模块 | community 能否启用 | 主要用途 |
|------|-------------------|----------|
| `appsec` | ✅ 可以 | 应用安全审查（浏览器内） |
| `devsec-workspace` | ✅ 可以 | 本机工作区 list/read |
| `shell` | ❌ **必须** `capability_profile: "enterprise"` | 单次受控命令 `shell_exec` |
| `netsec` | ❌ **必须** enterprise | 端口探测 `netsec_port_scan` |

**若你看到横幅「模块 shell / netsec 未启用」、点「启用」后仍停在未启用：多半是当前仍是 `community`。** 见下文 [§4](#4-切换到-enterprise并开启-shell) / [§9 排错](#9-常见现象排错)。

---

## 1. 在 Side Panel 打开任务包

1. 启动 **Companion**，在 Chrome 加载扩展，打开 **Side Panel**。
2. 底栏处于 L0「聊」或 L1「网页」时，点 **「任务包」**。
3. 面板里通常有：
   - 各模块未启用时的橙色横幅 + **「启用」**
   - **选择工作区** / **NetSec 任务授权**
   - 当前线程是否已绑定工作区
   - 已安装 Pack 列表 + **应用到当前线程**

点面板右上角 **「刷新」** 可重新拉取 `pack.list` / `modules.list`。

---

## 2. AppSec 审查（community 可用）

> **坐标**：典型 **L1 网页 + 本 Pack（组合面）** — 黑盒 / 威胁建模 checklist，**不需要** Computer Use（L2）。


1. 在任务包面板，若出现 **「模块 appsec 未启用」**，点 **「启用」**。
2. 选中要工作的**线程**。
3. 找到 **「应用安全审查」**（id 约 `appsec-prd-review`），点 **应用到当前线程**。
4. 在浏览器打开待审 PR / 文档页，用自然语言做威胁建模或页面 checklist。

**不需要**绑定本机工作区。

---

## 2b. 网络巡检场景（enterprise + netsec）

> **坐标**：**Composition 配方**叠在 **netsec 模块**上 — 场景 ≠ 打开扫描电源。  
> 内置 Pack id：`netsec-port-survey`（名称「网络巡检」）。

1. `capability_profile: enterprise` 并启用模块 **netsec**（见 §4 / 场景页「本机能力」）。
2. **设置 → 网络扫描**：配置允许扫描的目标；需要时 **授权本对话**。
3. 场景面板找到 **「网络巡检」** → **用于本对话**（会收窄工具面，含 `netsec_port_scan`）。
4. 用自然语言指定范围；Agent 调端口扫描时仍走 **L2 确认**。
5. 用完点 **退出场景**；模块与白名单设置不会因退出而关掉。

**不要**用本场景装技能或跑 shell；需要全工具时请先退出场景。

### 2c. 用户场景（「我的」）— 工具策略与 AI 创建（2026-08-06）

| 能力 | 说明 |
|------|------|
| **编辑** | 仅 **「· 我的」** 场景有「编辑」；内置只有 **「另存为我的」** |
| **工具策略** | 默认「不额外限制」；可选「仅允许勾选的工具」（含 shell_exec / evaluate 等高危分组） |
| **高危工具** | 可勾选进工具面；**Trust 区**可声明「跳过 L2 / 自动开模块 / 写 auto_approve」 |
| **Trust（选项 B）** | **仅「我的」场景**。保存并**用于本对话**时写入 **全局** Companion 配置 |
| **Trust 恢复** | **退出场景** / **切换到其他场景** / **删除场景** / apply 失败路径会恢复应用前的 profile · auto_approve · 模块开关；Companion 启动会清理崩溃残留（journal reconcile） |
| **Trust 单 holder** | 同时只能有一个对话占用 Trust；其他对话应用会弹窗展示占用方，并支持 **一键解锁并用于本对话**（`force_takeover`：先 unapply 占用方再 apply） |
| **Trust 不会** | 经 zip/目录 **安装** 的包不能自带 `origin:user`+`trust`（安装时剥离）；`spawn_worker` 应用场景 **不写** 全局 Trust |
| **另存** | 可勾「保留原场景工具限制」（默认关） |
| **AI** | 「AI 生成场景」/「推荐技能·MCP」/「优化 Prompt」— 只预填，需保存 |

红队 / root 类任务：新建 → 勾 `shell_exec` + **跳过 L2** + **自动开启模块** → **保存并用于本对话**（会确认写全局配置）。

> ⚠️ Trust 勾选会改本机全局安全开关，不是仅当前对话。列表带 **⚠️ Trust** 标记；应用前弹窗会再确认。请确认后再应用。

---

## 3. 本机代码 / 工作区（DevSec）

1. 启用 **`devsec-workspace`**（横幅「启用」）。
2. 让 Agent 使用 `workspace_list_dir` / `workspace_read_file`。
3. **（可选）** 需要真实仓库时：选中目标线程 → **「选择工作区」** → 系统文件夹对话框选根目录；面板显示绑定路径。**「清除工作区」** 仅在已显式绑定时出现。

**默认沙箱（Scheme 1）**：线程未绑定 `workspace_root` 时，上述工具运行时落到 `~/CMspark-projects`（不存在则自动创建，权限 `0o700`），**不会**自动写入线程的 `workspace_root`；场景面板显示「默认沙箱 ~/CMspark-projects（可绑定真实项目）」。显式绑定后以绑定路径为准。路径 containment 始终生效。沙箱根目录若为 **symlink**（指向其它目录）会被拒绝（`default_sandbox_unavailable`），防止无手势扩大可读面。沙箱创建失败或模块未开启时才会拦截。

---

## 4. 切换到 enterprise 并开启 Shell

> **插件里没有「一键切 enterprise」开关**（刻意：高危能力不走 Chrome Web Store 默认通道）。  
> 本机试用请改 Companion 配置；企业环境可由安装器写入。

### 4.1 改配置（必做）

1. 完全退出 / 停止 Companion（避免写配置被运行中进程覆盖或读到旧值）。
2. 打开配置文件：

   ```text
   ~/.cmspark-agent/config.json
   ```

3. 设置（或合并进已有 JSON，注意逗号）：

   ```json
   "capability_profile": "enterprise"
   ```

4. **保存文件后重新启动 Companion**（改 profile / modules 后**必须重启**，Side Panel 再点「刷新」）。

### 4.2 启用 shell 模块

任选其一：

**方式 A — 任务包面板（推荐）**

1. 确认已按 4.1 切到 `enterprise` 并重启。
2. 打开 **任务包**，在 **「模块 shell 未启用」** 横幅点 **「启用」**。
3. 横幅应消失；若仍在，点「刷新」并对照 [§9](#9-常见现象排错)。

**方式 B — 直接写 config**

在 `modules.shell` 中设 `"enabled": true`（完整示例见 [§7](#7-配置片段示例)），保存并**重启 Companion**。

### 4.3 使用受控 Shell

1. Agent 调用工具 **`shell_exec`** 时，会出现 **L2 安全确认**（含命令预览）。
2. 你批准后，Companion 执行**单次**命令（非交互会话）。
3. Side Panel **没有**内嵌交互式终端（刻意用 tool card，不做自由 PTY）。
4. **#au4dch 止血（0.3.x）**：Windows 上 one-shot 子进程使用 `windowsHide`（避免空黑窗）；执行中 tool 卡可显示 `tool.progress` 输出尾与秒数。交互式网页 Shell（Cockpit PTY）仍为后续 epic，**本版未交付**。
5. **下载去重**：优先 `downloads_find` / `browser_download` 的 `prefer_existing`（仅复用 **Downloads** 目录下已完成项），避免重复点击下载。

### 4.4 在 community 下点「启用 shell」会怎样？

- Companion **拒绝**启用，错误类似：  
  `enterprise_profile_required — set capability_profile=enterprise for shell/netsec`
- 模块会**继续显示未启用**。
- 面板可能先闪一下「已请求启用 shell」，但**不会真正打开**——属预期，不是功能未实现。

---

## 5. 开启 NetSec 端口探测

同样要求 **`capability_profile: "enterprise"`**（步骤同 [§4.1](#41-改配置必做)）。

### 5.1 配置 allowlist（扫描前必做）

**推荐：任务包面板 → NetSec 扫描目标**（模块启用后）：可视化添加/删除 IP（实时写入 Companion）。也可用 `config.json` 预置：

```json
"netsec": {
  "available": true,
  "enabled": true,
  "target_allowlist": ["127.0.0.1", "10.0.0.0/8", "*.corp.example"],
  "require_task_auth": true
}
```

| 规则 | 说明 |
|------|------|
| **空 `target_allowlist`** | **禁止一切扫描**（默认安全姿态） |
| 支持形式 | IPv4、CIDR、hostname、`*.suffix` 通配 |
| 面板修改 | 实时生效；手改文件依赖 Companion 重载 / mtime 热加载 |

### 5.2 启用模块 + 任务授权

1. 任务包面板启用 **`netsec`**（或 config 中 `enabled: true`）。
2. **选中当前线程**，在 NetSec 卡片添加目标，或勾选后 **「授权所选 → 本线程」**（可勾选「添加后立即授权」）。
3. 确认「拥有测试授权」文案（需要用户手势 `user_gesture`）。

> 任务授权 ≠ 确认台 L2：前者声明「本线程可扫这些目标」，后者是 Agent **真正调用** `netsec_port_scan` 时的执行审批。见 [确认台说明 §5](confirm-center-user-guide.md#5-和配置类授权不是同一件事)。

### 5.3 扫描时

- Agent 调用 **`netsec_port_scan`** 时默认再过一次 **L2 确认**（侧栏红条或 [确认台](confirm-center-user-guide.md)）。
- **本线程企业信任（Plan A）**：在 L2 红条勾选「本线程内自动批准同类（netsec）」后，同线程、范围内后续扫描可跳过 L2（30 分钟无人工批准 / 最长 8 小时 / Companion 重启后失效）。**仅 netsec family**，不放开 shell。
- **全局企业自动批准（Plan B）**：设置 → **运行自主度**「全自动巡航」或 高级闸门 →「全局自动批准企业高危工具」+ 短语确认；仍受 allowlist / 任务授权约束；**不会**被协议解锁（原 God-mode）/「自动批准危险操作」单独跳过 shell/netsec。  
- **桌面无人值守**（`host_computer`）：与 Plan B **正交**；走「运行自主度 → 无人值守」，**不能**靠 Pack / god 静默打开；见 [computer-use-user-guide §5.1](computer-use-user-guide.md#51-无人值守桌面值守与-g1-对照)。
- 实现仅为 **TCP connect 探针**，不是完整 nmap。
- **仅用于你有权测试的目标**。

### 5.4 community 下点「启用 netsec」

与 shell 相同：被拒绝，需先切 enterprise（见 [§4.4](#44-在-community-下点启用-shell会怎样)）。

---

## 6. 推荐开启顺序（本机全功能试用）

1. 正常用 **community**：先开 `appsec`、`devsec-workspace`，验证任务包 + 工作区。  
2. 需要 shell / netsec 时：停 Companion → 改 `capability_profile` + allowlist → **重启** → 面板启用模块。  
3. NetSec 再走「任务授权」→ 让 Agent 扫描。  
4. 默认每条高危工具仍弹 **L2**；**协议解锁 / 自动批准危险操作不会**静默跳过 shell/netsec。需要少点确认时：用 **Plan A**（本线程勾选）、**Plan B**，或设置 → **运行自主度 → 全自动巡航**（合成 Plan B），且始终受白名单/任务授权约束。

---

## 7. 配置片段示例

```jsonc
// ~/.cmspark-agent/config.json（示意：与现有字段合并，勿整文件只留这一段）
{
  "capability_profile": "enterprise",
  "modules": {
    "appsec": {
      "available": true,
      "enabled": true
    },
    "devsec-workspace": {
      "available": true,
      "enabled": true
    },
    "shell": {
      "available": true,
      "enabled": true,
      "policy": "confirm_per_command",
      "allowlist_commands": []
    },
    "netsec": {
      "available": true,
      "enabled": true,
      "target_allowlist": ["127.0.0.1", "10.0.0.0/8", "*.corp.example"],
      "require_task_auth": true
    }
  }
}
```

修改后务必：

1. **JSON 合法**（可用编辑器校验）。  
2. **重启 Companion**。  
3. Side Panel → 任务包 → **刷新**，确认 shell/netsec 横幅消失（若已 `enabled: true`）。

---

## 8. 验收检查清单

- [ ] 应用 AppSec Pack 后，线程带有 `mission_pack_id`，工具面按 Pack 收窄  
- [ ] 未显式绑定时 `workspace_*` 走默认沙箱 `~/CMspark-projects`；创建失败 / 模块未开时给出可恢复提示；选文件夹后可 list/read 绑定目录  
- [ ] **community** 下无法真正启用 shell/netsec（点启用后仍未启用）  
- [ ] **enterprise** 下启用 shell 后，`shell_exec` 必现 L2，且协议解锁不能静默跳过  
- [ ] netsec **空 allowlist** 时扫描失败；授权目标不在 list 时拒绝  
- [ ] 改 config 后未重启时，行为可能仍像旧 profile（应重启再验）

---

## 9. 常见现象排错

| 现象 | 可能原因 | 怎么处理 |
|------|----------|----------|
| 一直显示「模块 shell/netsec 未启用」，点启用无效 | `capability_profile` 仍是 `community` | 按 [§4.1](#41-改配置必做) 改成 `enterprise` 并**重启** |
| 已改 config 仍像 community | Companion 未重启 / 改错文件 / JSON 解析失败回退默认 | 确认路径 `~/.cmspark-agent/config.json`；重启；看 Companion 日志是否报 config 损坏 |
| Pack「应用到当前线程」按钮灰掉 | `apply_blocked`：缺模块，或 enterprise Pack 在 community | 先开齐 `requires_modules`；企业 Pack 需 enterprise profile |
| `workspace_*` 报 default sandbox / 路径逃逸 | 默认沙箱创建失败，或路径试图逃出根目录 | 检查 `~/CMspark-projects` 权限；或选中线程 → **选择工作区** 绑定明确目录 |
| NetSec 授权后仍扫不了 | allowlist 为空，或目标不在 list / 未 L2 | 任务包里补 allowlist + 任务授权；**再在确认台/红条批准 L2**（见 [确认台说明](confirm-center-user-guide.md)） |
| 面板提示「已请求启用 …」但横幅还在 | 后端拒绝（常见 enterprise_profile_required）或未刷新 | 查 profile；点「刷新」；必要时看 `capability-audit.jsonl` |

---

## 10. Multi-Agent（编排 / Worker）与任务包

> **主用户指南**：[multi-agent-user-guide.md](multi-agent-user-guide.md)（spawn / tab 锁 / Board / 上限与硬禁）。  
> 设计见 [ADR-015](adr/015-multi-agent-orchestrator-tab-lock.md) · [ADR-016](adr/016-mission-board.md)。本节说明 **试用时怎么用**，以及与 Mission Pack 的边界。  
> **坐标**：本节在 [ADR-020](adr/020-capability-model-three-axes.md) 上属 **Autonomy**；Worker 默认 **L1 网页**；Pack 仍是 **Composition 模板**，不是第二套 Agent。

### 10.1 模型一句话

| 角色 | 是什么 | 不是什么 |
|------|--------|----------|
| **Orchestrator** | 窄工具面线程：`spawn_worker` / `wait_workers` / `collect_handback` / `list_workers` / `list_tab_locks` / `ask_user` … | 默认 **不能** 直接浏览器 mutate / shell / netsec / host |
| **Worker** | 子 Thread（`parent_thread_id` + `orchestrator_run_id`）；工具面多在 **L1** | 不是独立 swarm / 深层桌面 runtime（硬禁 host/shell/netsec） |
| **Mission Pack** | 角色 **模板**（skills + `tool_whitelist` + 提示词）= **组合面** | 内置/installed **不会**抬 Trust；**用户场景 Trust B** 见 §2c（spawn 路径也不写全局 Trust） |

### 10.2 Spawn 必须显式确认（无 auto-spawn）

- Orchestrator 调用 **`spawn_worker`** 时会出现 **L2 确认**（侧栏红条或 FleetStrip **「确认台」**；与 `evaluate` / `shell_exec` 同类）。详见 [confirm-center-user-guide.md](confirm-center-user-guide.md)。
- **没有** 自动批量拉起 worker 的路径；LLM 参数里的 `user_confirmed` **不被信任**。
- 批准后：Companion 创建子线程 → 可选 `pack.apply` 角色模板 → 计算非空 `tool_whitelist`（`parent ∩ pack.allow \ WORKER_HARD_DENY`）。
- 并发上限（默认）：每 run 最多 **5** worker；进程 multi-agent LLM 环最多 **5**。

### 10.3 Tab 排他锁（操作同一页时）

- 某 worker **持有** tab lease 时，其它 worker 对同一 `tabId` 的读/写工具会得到可恢复错误（如 `TAB_LOCKED` / `TAB_BUSY_CONFIRMING`），**不会**并行进第二确认。
- 权威在 Companion；扩展侧另有 **per-tab 串行队列**（纵深，防 CDP 竞态）。
- **shared-observer（只读共享）本阶段不做**——纯读（screenshot / get_page_*）也要 lease。
- 人为切入 worker 可发 follow-up，**不会**自动偷锁；要 mutate 非己持锁 tab 须 force-release 或等待释放。

### 10.4 与 enterprise / shell / netsec 的关系

- Worker 默认 **硬禁** `shell_exec` / `netsec_port_scan` / `osascript_eval` / `host_*`（见 ADR-015 `WORKER_HARD_DENY`）。
- Spawn **不得** 改 `capability_profile`、偷偷启用 modules，或写入全局 Trust B（`applyPack({ allowTrust: false })`）。
- 需要 shell/netsec 时仍走本文 [§4](#4-切换到-enterprise并开启-shell) / [§5](#5-开启-netsec端口探测) 的本机 opt-in，且通常在 **非 worker / 升权另确认** 路径；多 agent 下 shell/netsec 另有 process **single-flight**。
- **Trust 单 holder**：同一时间只有一个对话可占用 Trust 场景；他对话再应用会 `trust_holder_conflict`（带 `holders` 别名）。Side Panel 弹窗可 **一键解锁并用于本对话**（`pack.apply` + `force_takeover:true`，先 unapply 占用方）。

### 10.5 Side Panel 操作提示

1. 用自然语言让主线程当编排者（或工具面已收窄为 orchestrator）。
2. 批准 **spawn** 确认（红条或 **确认台**）→ FleetStrip 可见 worker 数量 / 状态徽标。
3. 浏览器危险操作与 spawn 走**同一套 L2 确认**（看清 `worker_id` / `tabId` / run）。
4. 需要停全部：FleetStrip **全停**（abort LLM + 拒 pending + 释放该 run 相关 lease）。

### 10.6 本阶段明确不做

| 项 | 状态 |
|----|------|
| auto-spawn / 静默 fan-out | **不做**（仅 explicit L2） |
| shared-observer 只读并行 | **延期** |
| 全量 Dashboard 网格 / lease 图 | 部分（FleetStrip + Cockpit 计数） |

---

## 11. 相关路径

| 用途 | 路径 |
|------|------|
| Companion 配置（profile / modules） | `~/.cmspark-agent/config.json` |
| 已安装 Pack | `~/.cmspark-agent/packs/installed/` |
| 能力启停 / 授权审计 | `~/.cmspark-agent/logs/capability-audit.jsonl` |
| 多 agent / lease / spawn 审计（同 capability 审计流） | `~/.cmspark-agent/logs/capability-audit.jsonl` |
| 线程元数据（含 `workspace_root`、worker 字段） | `~/.cmspark-agent/threads/index.json` |

---

## 12. 相关文档

| 文档 | 用途 |
|------|------|
| [confirm-center-user-guide.md](confirm-center-user-guide.md) | **确认台 / L2 确认**用户说明（与任务授权分层） |
| [multi-agent-user-guide.md](multi-agent-user-guide.md) | **Multi-Agent / Board 主用户指南**（spawn、tab 锁、上限；与本文 §10 交叉） |
| [ADR-020](adr/020-capability-model-three-axes.md) | 能力三轴：Pack = Composition；Worker = Autonomy×L1 |
| [ADR-014](adr/014-mission-pack-enterprise-modules.md) | 为何双通道、为何不做内嵌 PTY |
| [ADR-015](adr/015-multi-agent-orchestrator-tab-lock.md) | Multi-agent orchestrator、tab lease、spawn HITL |
| [ADR-016](adr/016-mission-board.md) | Mission Board 工具与 UI |
| [architecture.md §7](architecture.md) | 模块 / 工具 / 代码落点 |
| [GOAL.md](GOAL.md) | 产品阶段与 G19 / G22 一带目标 |
| [meeting-and-dictation-user-guide.md](meeting-and-dictation-user-guide.md) | 内置 Pack「会议记录」与听写+（**不会**因 apply Pack 自动开麦） |
)
