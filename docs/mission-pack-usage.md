# Mission Pack（任务包）使用说明

> 面向试用 / 验收 / 本机开启企业能力。  
> 设计决策见 [ADR-014](adr/014-mission-pack-enterprise-modules.md)；架构总览见 [architecture.md §7](architecture.md)。

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

1. 在任务包面板，若出现 **「模块 appsec 未启用」**，点 **「启用」**。
2. 选中要工作的**线程**。
3. 找到 **「应用安全审查」**（id 约 `appsec-prd-review`），点 **应用到当前线程**。
4. 在浏览器打开待审 PR / 文档页，用自然语言做威胁建模或页面 checklist。

**不需要**绑定本机工作区。

---

## 3. 本机代码 / 工作区（DevSec）

1. 启用 **`devsec-workspace`**（横幅「启用」）。
2. **先选中目标线程**，再点 **「选择工作区」** → 系统文件夹对话框选仓库根目录。
3. 面板显示 **当前工作区: `/path/...`** 后，再让 Agent 使用 `workspace_list_dir` / `workspace_read_file`。

若未选工作区就调用上述工具，会得到**可恢复**错误（提示来面板选文件夹），不会整段标成「不可恢复」。

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

### 4.4 在 community 下点「启用 shell」会怎样？

- Companion **拒绝**启用，错误类似：  
  `enterprise_profile_required — set capability_profile=enterprise for shell/netsec`
- 模块会**继续显示未启用**。
- 面板可能先闪一下「已请求启用 shell」，但**不会真正打开**——属预期，不是功能未实现。

---

## 5. 开启 NetSec 端口探测

同样要求 **`capability_profile: "enterprise"`**（步骤同 [§4.1](#41-改配置必做)）。

### 5.1 配置 allowlist（扫描前必做）

在 `config.json` 中配置，例如：

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
| 保存后 | **重启 Companion** |

### 5.2 启用模块 + 任务授权

1. 任务包面板启用 **`netsec`**（或 config 中 `enabled: true` 后重启）。
2. **选中当前线程**，点 **「NetSec 任务授权」**。
3. 按提示输入目标（逗号分隔 hostname/IPv4，**必须是 allowlist 的子集**）。
4. 在确认框中确认「拥有测试授权」文案（需要用户手势 `user_gesture`）。

### 5.3 扫描时

- Agent 调用 **`netsec_port_scan`** 时再过一次 **L2 确认**。
- 实现仅为 **TCP connect 探针**，不是完整 nmap。
- **仅用于你有权测试的目标**。

### 5.4 community 下点「启用 netsec」

与 shell 相同：被拒绝，需先切 enterprise（见 [§4.4](#44-在-community-下点启用-shell会怎样)）。

---

## 6. 推荐开启顺序（本机全功能试用）

1. 正常用 **community**：先开 `appsec`、`devsec-workspace`，验证任务包 + 工作区。  
2. 需要 shell / netsec 时：停 Companion → 改 `capability_profile` + allowlist → **重启** → 面板启用模块。  
3. NetSec 再走「任务授权」→ 让 Agent 扫描。  
4. 每条高危工具仍会弹 **L2**；企业档也不会被 god-mode 静默跳过 shell/netsec 确认。

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
- [ ] 未选工作区时 `workspace_*` 给出可恢复提示；选文件夹后可 list/read  
- [ ] **community** 下无法真正启用 shell/netsec（点启用后仍未启用）  
- [ ] **enterprise** 下启用 shell 后，`shell_exec` 必现 L2，且 god-mode 不能静默跳过  
- [ ] netsec **空 allowlist** 时扫描失败；授权目标不在 list 时拒绝  
- [ ] 改 config 后未重启时，行为可能仍像旧 profile（应重启再验）

---

## 9. 常见现象排错

| 现象 | 可能原因 | 怎么处理 |
|------|----------|----------|
| 一直显示「模块 shell/netsec 未启用」，点启用无效 | `capability_profile` 仍是 `community` | 按 [§4.1](#41-改配置必做) 改成 `enterprise` 并**重启** |
| 已改 config 仍像 community | Companion 未重启 / 改错文件 / JSON 解析失败回退默认 | 确认路径 `~/.cmspark-agent/config.json`；重启；看 Companion 日志是否报 config 损坏 |
| Pack「应用到当前线程」按钮灰掉 | `apply_blocked`：缺模块，或 enterprise Pack 在 community | 先开齐 `requires_modules`；企业 Pack 需 enterprise profile |
| `workspace_*` 报 workspace_root | 当前线程未绑定目录 | 选中线程 → **选择工作区** |
| NetSec 授权后仍扫不了 | allowlist 为空，或目标不在 list / 未 L2 | 配 `target_allowlist` 并重启；授权目标 ⊆ list；批准 L2 |
| 面板提示「已请求启用 …」但横幅还在 | 后端拒绝（常见 enterprise_profile_required）或未刷新 | 查 profile；点「刷新」；必要时看 `capability-audit.jsonl` |

---

## 10. 相关路径

| 用途 | 路径 |
|------|------|
| Companion 配置（profile / modules） | `~/.cmspark-agent/config.json` |
| 已安装 Pack | `~/.cmspark-agent/packs/installed/` |
| 能力启停 / 授权审计 | `~/.cmspark-agent/logs/capability-audit.jsonl` |
| 线程元数据（含 `workspace_root`） | `~/.cmspark-agent/threads/index.json` |

---

## 11. 相关文档

| 文档 | 用途 |
|------|------|
| [ADR-014](adr/014-mission-pack-enterprise-modules.md) | 为何双通道、为何不做内嵌 PTY |
| [architecture.md §7](architecture.md) | 模块 / 工具 / 代码落点 |
| [GOAL.md](GOAL.md) | 产品阶段与 G19 一带目标 |
)
