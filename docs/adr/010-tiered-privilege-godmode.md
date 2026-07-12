# ADR-010: 三层权限阶梯与 God-mode（`allow_all_schemes`）

**日期**: 2026-07-12 | **状态**: 已确认（PR #35 PR-0 / #36 PR-A 已合并；PR-B 本 PR）

## 背景

CMspark 的安全模型是**两层门**（见 [ADR-006](006-layered-defense.md)）：

- **Layer 1（scheme 硬阻断）**：`navigate` / `create_tab` / `set_tab_url` 对非 http(s) scheme（`javascript:` / `data:` / `about:` / `file:` / `chrome:`）**直接拒绝**，不可被任何开关绕过。这一层堵死了 prompt 注入经由导航工具执行任意脚本 / 打开特权页 / 读本地文件的口子。
- **Layer 2（确认门）**：`evaluate` / `osascript_eval` / 未授信域导航需人工确认（`securityConfirmations.request`）；可被 `auto_approve_dangerous`（全局）或 `auto_approved_domains`（per-domain，见 [ADR-007](007-domain-whitelist-auto-approve.md)）跳过。

长期以来存在一个缺口：**没有一条合法通道在受控前提下放行 Layer 1**。某些可信工作流（调试内嵌 `data:` 页、自动化操作 `chrome://` 设置页）被 Layer 1 完全锁死，用户只能通过绕过手段。同时，2026-07-09 全量审计发现 **WS 端点缺乏鉴权**——本地任何进程伪造 `Origin: chrome-extension://...` 即可发 `config.set` 翻转 `auto_approve_dangerous` / 写 `auto_approved_domains`（软 L1 绕过 / L2 自动放行），这让任何「危险开关」的 UI 启用路径都不安全。

## 决策

### 1. 第三层：God-mode = `security.allow_all_schemes`（独立布尔）

新增 `security.allow_all_schemes`（默认 `false`，`deepMerge` 兼容旧 config.json）。它**同时绕过两层**：

- **skipL1 = `allow_all_schemes`**：URL gate 的 scheme 硬阻断放行，落 `security.godmode_bypassed` 审计日志（`javascript:` scheme 特标 `javascript: true`，因其会在目标 tab origin 跑任意脚本）。
- **skipL2 = `auto_approve_dangerous || allow_all_schemes || domain_whitelist`**：两个确认点（evaluate/osascript_eval 的 `skipConfirmation`；URL gate 的 `skipUrlConfirmation`）都加 `|| allow_all_schemes`。

God-mode **严格强于** `auto_approve_dangerous`（后者只绕 L2）。命名采独立布尔 (B)，不复用三值枚举。reason 优先级链：`god_mode > global_toggle > domain_whitelist`。

```
┌──────────────┐   off   ┌──────────────────┐
│  Default     │ ──────▶ │ 每个高危操作确认  │  L1 阻断非 http(s) + L2 确认门
└──────────────┘         └──────────────────┘
        │ auto_approve_dangerous = true  （ADR-007）
        ▼
┌──────────────┐
│ Auto-approve │  L2 确认门全局跳过；L1 仍阻断非 http(s)
└──────────────┘
        │ allow_all_schemes = true  （本 ADR = God-mode）
        ▼
┌──────────────┐
│  God-mode    │  L1 + L2 全部绕过；留 godmode_bypassed 审计
└──────────────┘
```

### 2. 前置根基：PR-0 WS 共享密钥鉴权

在开放 God-mode 的任何 UI / WS 启用路径**之前**，必须先关闭 Origin 欺骗缺口（否则本地恶意进程可静默翻转 `allow_all_schemes`）。

PR-0（commit `aeef21e`，PR #35）实现 **challenge-response HMAC-SHA256 握手**：companion 首启 `crypto.randomBytes(32)` 生成密钥、0o600 独立文件存储；扩展经带外通道（粘贴 `cmspark-agent settings --ws-secret` 输出）获取；连接后 N 秒内未完成握手则 `ws.terminate()`。`connected` 状态 = 已鉴权。`config.set` 等所有 WS 写向量从此都被密钥门保护。

### 3. 不可篡改审计

- **每次 god-mode 放行**在动作执行**前**写 `security.godmode_bypassed`（`logger.warn`，含 tool/scheme/host/timestamp，**不含**敏感参数）——日志事件，**绝不写 config.json**（否则用户/攻击者可编辑删除，失去不可篡改性）。`javascript:` scheme 特标。
- **god-mode 开/关本身**记审计条目（`godmode_enabled_changed`，来源 `config.json_manual` / `ui_phrase_confirmed` / `ws_authenticated`）。PR-B 在扩展侧审计日志 UI 以「变更」条目展示（armed/disarmed）。

## 如何启用 God-mode

### 方式 A（推荐）：扩展 UI + 确认短语（需先完成 PR-0 配对）

1. 先按 Side Panel「设置 → 连接」粘贴 `cmspark-agent settings --ws-secret` 输出的配对密钥完成 WS 鉴权握手。
2. 「设置 → 安全设置」勾选 **God-mode（允许所有协议）**。
3. 在弹出的二次确认面板输入确认短语（`我了解风险`），点「确认开启」。该次开/关会写入审计日志。

UI 启用刻意做成**高摩擦**：勾选不直接生效，必须键入确认短语——防止误开启。一个 prompt 注入的指令无法在设置面板里键入，故短语门针对的是「误操作」而非「对抗人」。

### 方式 B：直接编辑 config.json（无需 UI / 适合无头/远程场景）

```jsonc
// ~/.cmspark-agent/config.json （权限必须 0o600）
{
  "security": {
    "allow_all_schemes": true   // ← God-mode
  }
}
```

保存后重启 companion。启动时会打印醒目 `WARNING`。此路径同样受 PR-0 保护——能写 config.json 即拥有本机文件权限，等同于已具备更强攻击面。

## 风险（必须读懂再启用）

God-mode 关闭协议保护后，**任何 prompt 注入**（agent 读到的不可信网页内容）即可：

- 执行 `data:` / `javascript:` 内嵌脚本（在目标 tab origin 内任意 JS）；
- 打开 `chrome://` 特权页（设置 / 扩展 / 历史等，含敏感操作面）；
- 读 `file:` 本地文件（泄露本机数据给 LLM）。

`auto_approve_dangerous` 至少保留 Layer 1 的协议阻断；God-mode 连这层也撤掉，是**最高风险档**。**仅在你完全信任的机器上，为你完全信任的工作流启用**，并预期 Side Panel 审计日志 + companion 日志（`security.godmode_bypassed`）会逐条记录每一次绕过。

## 显式不做（Non-goals）

- ❌ God-mode 默认开启，或引导普通用户开启。
- ❌ 非 http(s) 协议开 per-domain allowlist（God-mode 是全局开关，不做细粒度）。
- ❌ 改 `auto_approve_dangerous` 现有语义。
- ❌ Tier 2「LLM 自动放行」（反模式）；窄版推迟 P3+。

## 工具危险面分级（God-mode 范围外，独立 follow-up）

| 类 | 工具 | 当前门 | God-mode 是否放行 |
|---|---|---|---|
| 浏览器导航 | navigate/create_tab/set_tab_url | L1+L2 | **是**（本 ADR） |
| 脚本执行 | evaluate | L2（per-domain 白名单） | **是** |
| 宿主脚本 | osascript_eval | L2（仅全局 toggle） | **是** |
| Cookie | get/set/delete/list_cookies | trusted_domains 门 | 否（cookie 门独立） |
| **任意 URL 读取** | **analyze_image**（可打内网/泄露） | **当前无门** | **否（follow-up M4）** |
| MCP | mcp_list_resources/read_resource/get_prompt | 无门（工具调用走 MCP server） | **否（follow-up MCP 门）** |

God-mode **不**自动放行 analyze_image / MCP——这些门本就不在 L1/L2 模型内，扩范围处理会引入 scope creep（META 2.2）。各列独立 follow-up。

## 实现轨迹

| PR | 内容 | 状态 |
|---|---|---|
| PR-0 (#35) | WS 共享密钥鉴权（HMAC 握手） | ✅ 已合并 |
| PR-A (#36) | Companion 核心：config schema + 两道门 + `godmode_bypassed` 审计 + 测试 | ✅ 已合并 |
| PR-B | 扩展 UI：勾选框 + 确认短语 + 风险文案；审计展示 godmode 开/关条目；config.json 启用说明入文档（本 ADR） | 本 PR |
| PR-C | 删除孤儿 `security.setPrivilege` / `PrivilegeMode` 死代码 | 待办 |
| follow-up | Companion `security.godmode_bypassed` 实时推送至扩展审计 UI（每次绕过可见，非仅开/关） | 待办（kimi 裁决可后置） |
| follow-up | M4 `analyze_image` 门、MCP 工具调用门（god-mode 不自动放行） | 待办 |

> **向后兼容**：`allow_all_schemes` 为 optional 字段、默认 false，`deepMerge` 兼容旧 config.json。但 God-mode 的 L1/L2 绕过逻辑在 companion 侧（PR-A），**扩展 UI 切换需 companion ≥ PR-A**——若与旧 companion 配对，扩展发回的 `allow_all_schemes` 会被忽略，`config.updated` 回传后勾选框回弹为关闭（用户可见反馈）。

## 关联

- [ADR-006: 分层防御](006-layered-defense.md) — L1/L2 两层门定义
- [ADR-007: 域白名单 + 危险操作自动批准](007-domain-whitelist-auto-approve.md) — `auto_approve_dangerous` / `auto_approved_domains`
- 设计原文：`docs/security-design-tiered-gates-2026-07-11.md`（kimi 二审 v2.1 GO）
