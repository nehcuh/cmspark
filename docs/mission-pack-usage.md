# Mission Pack（任务包）使用说明

> 面向试用 / 验收。设计细节见 [ADR-014](adr/014-mission-pack-enterprise-modules.md)。

## 1. 在 Side Panel 打开任务包

1. 启动 Companion + 加载扩展，打开 Side Panel。
2. 底栏（L0「聊」/ L1「网页」模式）点 **「任务包」**。
3. 可见：已安装 Pack 列表、模块启用条、**选择工作区**、NetSec 任务授权。

## 2. AppSec 审查（community 可用）

1. 启用模块 **`appsec`**（任务包面板横幅「启用」）。
2. 选中要工作的线程。
3. 对 **「应用安全审查」**（`appsec-prd-review`）点 **应用到当前线程**。
4. 在浏览器打开待审 PR/文档页，用自然语言做威胁建模或页面 checklist。

**不需要**绑定本机工作区。

## 3. 本机代码 / 工作区（DevSec）

1. 启用 **`devsec-workspace`**。
2. 在目标线程上点 **「选择工作区」** → 系统文件夹对话框选仓库根目录。
3. 面板显示 **当前工作区: /path/...** 后再让 Agent 使用 `workspace_list_dir` / `workspace_read_file`。

若未选择工作区就调用上述工具，会得到可恢复错误（提示来面板选文件夹），**不会**再整段标成「不可恢复」。

## 4. 受控 Shell（enterprise）

1. 配置 `capability_profile: "enterprise"`（config / 企业安装器；community 下无法启用 shell）。
2. 启用模块 **`shell`**。
3. Agent 调用 `shell_exec` 时会出现 **L2 确认**（含命令预览）；批准后执行**单次**命令。

当前**没有** Side Panel 内嵌交互式终端（刻意用 tool card）。

## 5. NetSec 端口探测（enterprise）

1. `capability_profile: "enterprise"`，启用 **`netsec`**。
2. 配置 `modules.netsec.target_allowlist`（CIDR / hostname / `*.suffix`）。**空列表 = 禁止一切扫描**。
3. 任务包面板 **NetSec 任务授权** → 输入目标 → **确认授权文案**（`user_gesture`）。
4. Agent 调用 `netsec_port_scan` 时再过 **L2 确认**。

仅 TCP connect 探针，非完整 nmap；勿用于未授权目标。

## 6. 配置片段示例

```jsonc
// ~/.cmspark-agent/config.json（示意）
{
  "capability_profile": "enterprise",
  "modules": {
    "appsec": { "available": true, "enabled": true },
    "devsec-workspace": { "available": true, "enabled": true },
    "shell": { "available": true, "enabled": false, "policy": "confirm_per_command" },
    "netsec": {
      "available": true,
      "enabled": false,
      "target_allowlist": ["10.0.0.0/8", "*.corp.example"],
      "require_task_auth": true
    }
  }
}
```

## 7. 验收检查清单

- [ ] 应用 AppSec Pack 后 thread 有 `mission_pack_id`，工具面收窄
- [ ] 未选工作区时 `workspace_*` 可恢复提示，选文件夹后可 list/read
- [ ] shell/netsec 在 community 下无法启用；enterprise 下 L2 不可被 god-mode 静默跳过
- [ ] netsec 空 allowlist 时扫描失败；授权目标不在 list 时拒绝

## 8. 相关路径

| 用途 | 路径 |
|------|------|
| 已安装 Pack | `~/.cmspark-agent/packs/installed/` |
| 能力审计 | `~/.cmspark-agent/logs/capability-audit.jsonl` |
| 线程元数据 | `~/.cmspark-agent/threads/index.json`（含 `workspace_root`） |
