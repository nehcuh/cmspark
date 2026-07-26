# CMspark Design — Mission Pack + Enterprise Capability Modules

| Field | Value |
|-------|--------|
| Status | **Approved for P0 planning**（Claude + Pi `APPROVE_WITH_CHANGES` → must-fix 已合入 §17） |
| Date | 2026-07-26 |
| Product conclusion | `docs/decisions/v1.3/scenario-packs-product-conclusion-2026-07-26.md` |
| Reviews | `docs/audit/reviews/mission-pack-design-claude-*.md`；`mission-pack-design-pi-*.md`；综合 `docs/decisions/v1.3/mission-pack-design-review-synthesis-2026-07-26.md` |
| Related | UI L0/L1/L2 `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md`；ADR-004 skills；ADR-007 domain whitelist；ADR-010 privilege |
| Surfaces | Companion（源 of truth）+ Side Panel + Cockpit（Shell 模块） |
| Non-goal surfaces | Chrome Web Store 默认捆绑 NetSec/Shell；扩展内原生 libghostty |

---

## 1. Problem

CMspark 已有 **Skills / Knowledge / MCP / tool_whitelist / 确认栈 / L0–L2**，但缺少：

1. **可一键启用的任务级组合**（多资产 + 策略一次装配到 Thread）  
2. **企业能力与消费端能力的分界**（本地安装模块 vs CWS 友好默认）  
3. **高危能力（Shell / NetSec）的统一启用、scope、审计模型**  

若不做打包层，每个安全场景都会变成硬编码特性；若不做企业分档，NetSec/Shell 会误入商店默认叙事。

---

## 2. Goals & non-goals

### 2.1 Goals

| ID | Goal |
|----|------|
| G1 | **Mission Pack** 作为配置组合层：安装/启用/应用到 Thread，**不**新造 LLM runtime |
| G2 | **双通道**：`community` 与 `enterprise` 能力声明分离；企业能力仅本地安装 + 本机配置 |
| G3 | **opt-in 启用**（D10）：用户/管理员自行打开模块；默认最小权限 |
| G4 | 建设顺序（D11）：AppSec → DevSec workspace → Shell → NetSec |
| G5 | Pack **默认只能收窄**工具面；放宽须显式企业策略 + 可审计 |
| G6 | NetSec：scope allowlist + 任务级授权文案 + 审计日志 |
| G7 | Shell：Companion PTY + Cockpit UI；session 绑 thread；与确认栈统一 |

### 2.2 Non-goals（本 design 范围外）

- 自建 SAST 引擎 / 与 CodeQL·Snyk 正面对打  
- 扩展进程内嵌原生 libghostty 或任意 shell  
- CWS 默认分发 nmap/自由 shell  
- Pack 市场 / 远程自动安装任意第三方 pack（P2+ 另开 brief）  
- Computer Use SPI 重做、God-mode 语义变更  

---

## 3. Product model

### 3.1 两层对象

```
Enterprise Capability Module（企业能力模块）
  └── 安装级：是否允许本机使用某类能力（shell / netsec / 捆绑工具…）
        │
        ▼
Mission Pack（任务包）
  └── 任务级：一次「审这个 PR / 做威胁建模」的资产 + Thread 模板
```

| 对象 | 生命周期 | 谁启用 | 例子 |
|------|----------|--------|------|
| **Module** | 安装/配置级 | 用户或管理员 opt-in | `shell`, `netsec`, `devsec-workspace` |
| **Pack** | 可导入资产 + 应用到 Thread | 用户点「用此任务包」 | `appsec-prd-review` |

**关系**：Pack 可 **require** 某 module（如 NetSec Pack 要求 `modules.netsec.enabled`）；缺 module 时 UI 引导去设置页开启，**禁止**静默开启。

### 3.2 通道与默认

| Profile | 安装形态 | 默认可启用 modules | 默认可装 packs |
|---------|----------|-------------------|----------------|
| **community** | CWS 扩展 + 本机 Companion | 无高危；仅 AppSec 类只读 pack | 内置/用户导入的非 require-highrisk pack |
| **enterprise** | 本地安装器 + 侧载/企业策略扩展 | 安装器可选组件 + 设置页 opt-in | 企业 packs 目录 + 用户 fork |

`capability_profile` 写在 Companion `config.json`（或安装器写入的 marker），**扩展只读展示**，不可仅靠扩展伪造 enterprise。

### 3.3 与 L0 / L1 / L2

| Pack `min_capability` | 含义 |
|----------------------|------|
| `L0` | 主要对话 + knowledge；工具极少 |
| `L1` | 浏览器工具 + 页面读取；AppSec 主路径 |
| `L2` | 需要 host / Shell / 强确认桌面能力；强制 Cockpit 叙事对齐现有 redesign |

Pack **不**引入第 4 种产品 mode。安全 Layer（确认、God-mode）与 L0/L1/L2 **正交**。

---

## 4. Locked decisions（继承 + design 细化）

| ID | Decision |
|----|----------|
| D1–D11 | 见产品结论文档 |
| S1 | Pack **无独立执行引擎**；`apply` = 写 Thread 字段 + 可选 knowledge 激活 |
| S2 | Module 状态只在 Companion 持久化；扩展经 WS 读写 |
| S3 | `tools_allow` 与现有 `tool_whitelist` 语义：`null`=不限制（现有），Pack 应用时写 **显式 allow 列表** 或 **与当前列表求交**（见 §6.4） |
| S4 | Pack **不得**将 `auto_approve_dangerous` / God-mode 设为 true |
| S5 | Shell 输入面仅 Cockpit（或等价宽窗）；Side Panel 最多入口按钮 |
| S6 | NetSec 出站目标必须在 allowlist 内，否则 Companion 硬拒（不依赖 LLM 自觉） |
| S7 | 所有 module 启停与 NetSec 任务授权写入 **history / 结构化 audit log** |
| S8 | `pack.apply` **原子** prepare-then-commit；失败 Thread 不变 |
| S9 | Pack uninstall 回滚曾 apply 的 thread 策略字段（见 §6.7 snapshot） |
| S10 | Shell **默认 per-command 确认**；session 级确认须显式 opt-in |
| S11 | `tools.mode: intersect` + `tool_whitelist === null` → **降级为 allowlist**（不枚举「全工具」） |
| S12 | `min_capability` 与 `requires_modules` **独立**；L2 不隐含 shell；require 以 `requires_modules` 为准 |

---

## 5. On-disk layout

数据根：`DATA_DIR` = `~/.cmspark-agent`（或 `CMSPARK_DATA_DIR`）。

```
~/.cmspark-agent/
├── config.json                 # + capability_profile, modules, netsec, shell 段
├── packs/
│   ├── installed/              # 已安装 pack 目录（一 pack 一子目录）
│   │   └── appsec-prd-review/
│   │       ├── pack.yaml       # manifest（规范名：pack.yaml）
│   │       ├── skills/         # 可选：pack 自带 skill md
│   │       ├── knowledge/      # 可选：pack 自带 knowledge md
│   │       └── README.md
│   └── enabled.json            # 可选：全局「建议 pack 列表」缓存
├── modules/
│   ├── shell/                  # 可选：模块附属资源（非必须）
│   └── netsec/
├── skills/ …                   # 现有
├── knowledge/ …                # 现有
├── threads/ …
└── logs/
    └── capability-audit.jsonl  # 模块/授权/扫描任务审计（append-only）
```

**安装器**可将 enterprise packs 解压到 `packs/installed/`，并将 `config.modules.*.available = true`；**enabled 仍默认 false**（Shell/NetSec）。

---

## 6. Mission Pack format

### 6.1 `pack.yaml` schema（v1）

```yaml
schema_version: 1
id: appsec-prd-review          # 稳定 id，目录名建议一致
name: 应用安全审查
description: 对当前页/PRD 做 STRIDE 威胁建模与页面安全 checklist
version: 0.1.0
channel: community             # community | enterprise
min_capability: L1             # L0 | L1 | L2

requires_modules: []           # e.g. [devsec-workspace] | [netsec] | [shell]

# 资产：相对 pack 目录或引用全局已有 name
skills:
  - ./skills/threat-model-stride.md
  - ./skills/page-security-audit.md
knowledge:
  - ./knowledge/owasp-baseline.md
mcp_servers: []                # 引用用户 config 中已声明的 server id；不自动安装 MCP

# 工具策略（应用到 thread.tool_whitelist）
tools:
  mode: allowlist              # allowlist | intersect | unchanged
  allow:
    - list_tabs
    - navigate
    - get_page_text
    - get_page_html
    - screenshot
    - use_skill
  deny:                        # 硬禁：apply 后即使全局有也不进 whitelist
    - host_computer
    - osascript_eval

# 追加到 thread，不覆盖全局 system（实现：config_override.system_prompt 拼接策略见 §6.5）
system_prompt_append: |
  你是应用安全审查助手。输出结构化：风险、证据（URL/片段）、建议、待办。
  不执行未确认的高危操作；不声称已完成未运行的扫描。

thread_defaults:
  skill_selection_mode: manual
  knowledge_selection_mode: manual
  mcp_selection_mode: manual

# 可选：工作区（DevSec）
workspace:
  type: none                   # none | local_path
  # path 不写死在 pack；apply 时由用户 folder-picker 填入 thread

# 可选：NetSec（仅 enterprise + module）
netsec:
  requires_task_authorization: true
  default_scope: []            # 空 = 必须用用户/管理员配置的 allowlist

# 元数据
author: cmspark
tags: [security, appsec]
```

### 6.2 校验规则（Companion `PackValidator`）

| 规则 | 失败行为 |
|------|----------|
| `schema_version` 支持 | 拒绝安装 |
| `id` 匹配 `^[a-z0-9][a-z0-9-]{1,63}$` 且禁止以 `-` 连续开头 | 拒绝 |
| `channel: enterprise` 且 profile=community | **允许安装**；`pack.list` 标 `apply_blocked: enterprise_profile_required`；**拒绝 apply** |
| `requires_modules` 有未 available 的模块 | apply 失败 + UI 说明 |
| `requires_modules` 有 available 但未 enabled | apply 失败 +「去开启」 |
| `tools.allow` 含未知工具名 | **一律拒绝**（对照 `getToolDefinitions()` 注册名；禁止 warn-and-strip） |
| `tools.deny` 与 `allow` 冲突 | deny 优先（从 allow 结果中剔除） |
| 相对路径 skill/knowledge 必须在 pack 目录 **realpath containment** 内 | 拒绝 |
| 单文件 ≤ 1MB；解压后 pack 总量 ≤ 50MB；zip entries ≤ 1000 | 拒绝（zip bomb / DoS） |
| `system_prompt_append` 长度上限 **16KB** | 拒绝 |
| Pack 声明任何安全放宽键 | **拒绝**（见下方 blocklist） |

**禁止键 blocklist**（pack 的任何字段/thread_defaults/config 注入路径均不得设置）：

`auto_approve_dangerous`, `allow_all_schemes`, `auto_approved_domains`, `trusted_domains`, `god_mode`（及 config 中等价布尔放宽项）。  
防御纵深：即使不进 `ALLOWED_CONFIG_OVERRIDE_KEYS`，PackValidator 也显式拒绝。

### 6.3 安装 API（WS / 内部）

| Message / op | 作用 |
|--------------|------|
| `pack.list` | 列出 installed + 校验状态 + requires 是否满足 + apply_blocked 原因 |
| `pack.install` | 从目录/zip/内置资源安装到 `packs/installed/<id>`（流程见下） |
| `pack.uninstall` | 删除目录 + **按 §6.7 回滚**仍引用该 pack 的 thread 策略字段 |
| `pack.apply` | `{ thread_id, pack_id, workspace_path? }` → **原子**写 Thread |
| `pack.export` | 打包 zip → **P2**（非 P0/P1） |

#### `pack.install` 流程（zip / 目录）

1. 若 zip：解压到 `DATA_DIR/cache/pack-import-<uuid>/`  
2. **每条 zip entry**：目标 path 做 realpath，必须仍在 tmp 根下（zip slip → 拒绝整包）  
3. 校验 `pack.yaml` + 相对路径 skill/knowledge containment  
4. 校验大小上限（§6.2）  
5. 通过后 `rename`/`cp` 到 `packs/installed/<id>/`（同 id 覆盖须显式 `force`）  
6. `skillEngine.refresh()`；audit `pack.install`  

内置资源：从 companion 包内 `builtin-packs/<id>/` 复制，同样走 containment。

### 6.4 `pack.apply` → Thread 映射

现有 Thread 字段（`thread-manager.ts`）：

| Thread 字段 | Pack 来源 |
|-------------|-----------|
| `active_skill_ids` | pack skills 安装到 skill 引擎后的 **name** 列表（manual 模式） |
| `skill_selection_mode` | `thread_defaults` 或强制 `manual` |
| `knowledge_selection_mode` | 同上；knowledge names 进入 active 解析路径（与现有 knowledge 激活方式对齐实现） |
| `active_mcp_server_ids` | `mcp_servers` 与**已连接** server 求交 |
| `mcp_selection_mode` | `manual`（若 pack 声明了 mcp 列表） |
| `tool_whitelist` | 见下 |
| `config_override.system_prompt_append` | 见 §6.5（**P0 新增 ALLOWED 键**） |
| **新增** `mission_pack_id` | 来源 pack；`null` = 未应用（老 thread 默认） |
| **新增** `mission_pack_snapshot` | apply 前策略回滚快照（§6.7） |
| **新增** `workspace_root?` | DevSec：本机绝对路径（folder-picker） |
| ~~`netsec_scope_snapshot`~~ | **取消作为执行依据**；NetSec 任务**实时读** config allowlist；审计只记 allowlist **hash** |

**`tools.mode` 语义（锁定 S11）：**

| mode | 行为 |
|------|------|
| `allowlist` | `tool_whitelist = allow \ deny` |
| `intersect` | 若原 `tool_whitelist === null` → **降级为 allowlist**（`allow \ deny`）。若原为数组 → `原 ∩ allow \ deny`。**禁止**维护「全工具枚举」快照 |
| `unchanged` | 不改 `tool_whitelist` |

AppSec pack **必须** `mode: allowlist`。

#### `pack.apply` 原子性（S8）

```
1. validate pack + modules + paths
2. build ThreadPatch in memory (incl. mission_pack_snapshot if first apply or re-apply)
3. threadManager.applyPackPatch(thread_id, patch)  // single mutation + atomicWriteJSON
4. on any error before step 3: thread unchanged
5. audit pack.apply
```

### 6.5 system prompt 合并（锁定）

**P0 必须**：

1. `ALLOWED_CONFIG_OVERRIDE_KEYS` 增加 `system_prompt_append: "string"`（上限 16KB）  
2. LLM adapter 组装顺序：  
   `global/base system → thread.config_override.system_prompt（若有则替换 base 段）→ thread.config_override.system_prompt_append`  
3. Pack apply 写入 `system_prompt_append`：  
   - 若 thread **已有**用户 `system_prompt_append`：新值 =  
     `"--- Mission Pack ---\n" + pack.append + "\n\n--- User ---\n" + existing`  
     （**pack 在前，用户在后**，用户意图优先压过 pack）  
   - 若无：仅写 pack 段  
4. **禁止**用 pack 去改写 `system_prompt` 整段键  

### 6.6 Pack 内 skill/knowledge 装载

**P0 默认实现（降低 skill-engine 风险）**：安装时 **复制** 到命名空间文件：

- `skills/pack--<pack_id>--<skillName>.md`  
- `knowledge/global/pack--<pack_id>--<name>.md`  

`active_skill_ids` 使用 **全名** `pack--<pack_id>--<skillName>`（或 frontmatter name 强制此前缀）。

**P1+ 可选**：skill-engine multi-root；P0 不做 multi-root refactor，避免阻塞。

卸载：删除上述复制文件 + `refresh()`；thread 策略按 §6.7 回滚。

### 6.7 Uninstall / re-apply 与 snapshot（S9）

apply 时若 `mission_pack_id` 为空或切换 pack，先写入：

```ts
mission_pack_snapshot: {
  tool_whitelist: thread.tool_whitelist,       // null | string[]
  active_skill_ids: [...],
  skill_selection_mode, knowledge_selection_mode, mcp_selection_mode,
  active_mcp_server_ids: [...],
  system_prompt_append: thread.config_override?.system_prompt_append ?? null,
}
```

`pack.uninstall(id)`：对所有 `mission_pack_id === id` 的 thread：

1. 用 `mission_pack_snapshot` 恢复策略字段  
2. `mission_pack_id = null`，清空 snapshot  
3. 若无 snapshot（脏数据）：`tool_whitelist = null` + 清空 pack 前缀 skills（保守可恢复）  

`pack.apply` 覆盖另一 pack：先按旧 pack 回滚 snapshot，再应用新 pack。

---

## 7. Enterprise modules

### 7.1 Module registry（config 段）

```jsonc
// config.json 片段
{
  "capability_profile": "enterprise",  // "community" | "enterprise"
  "modules": {
    "appsec": {
      "available": true,
      "enabled": false,                // D10：默认 false；首次 apply AppSec pack 可引导一点击启用
      "enabled_at": null,
      "enabled_by": null
    },
    "devsec-workspace": {
      "available": true,
      "enabled": false
    },
    "shell": {
      "available": true,
      "enabled": false,
      "policy": "confirm_per_command", // 默认；见 §7.3C
      // "confirm_session" | "allowlist" 为显式放宽
      "allowlist_commands": []
    },
    "netsec": {
      "available": true,
      "enabled": false,
      "target_allowlist": [],          // 空数组 = 拒绝一切出站扫描
      "require_task_auth": true
    }
  }
}
```

### 7.2 Module 生命周期

```
available=false  →  UI 不展示启用开关（或显示「未安装组件」）
available=true, enabled=false  →  展示开关；Pack require 时引导开启
enabled=true  →  能力入口可用；仍受 per-call 确认 / scope 约束
```

**启停 API**：`modules.list` / `modules.set_enabled`  

`set_enabled(true)` 必须：

1. 校验 `available`  
2. 写 `enabled_at` / `enabled_by`  
3. append `capability-audit.jsonl`  
4. 广播 `modules.updated` 给已认证 WS  

`set_enabled(false)`：立即拒绝新的 shell session / netsec 任务；进行中任务 **abort**。

### 7.3 Module 细节

#### A. `appsec`（P0）

- 不提供新二进制。  
- 内置 pack：`appsec-prd-review`（威胁建模 + 页面 checklist）。  
- 工具：浏览器只读偏重 + 必要时 `evaluate` **仍走现有确认**。

#### B. `devsec-workspace`（P1）

- Thread 字段 `workspace_root`（realpath + 存在性检查；不得逃出用户选定根的… 以用户选中目录为根）。  
- 选择路径：Companion **native folder-picker**（复用 Obsidian 路径）。  
- **默认**：Companion 内置只读 `list_dir` / `read_file`（cwd 限 workspace）；MCP filesystem **可选增强**，非硬依赖。  
- 扫描器：PATH 探测 semgrep/gitleaks；结果 **tool card**。  
- 不做完整交互终端。

#### C. `shell`（P1′）

| 项 | 规格 |
|----|------|
| Backend | Companion `node-pty`；**非**扩展 |
| Frontend | Cockpit + **xterm.js**（默认）；ghostty-web 可选实验 |
| Session | `thread_id → pty_id` 一对一；**禁止**跨 thread 复用 |
| **默认 policy** | `confirm_per_command`：每条用户/agent 提交的命令行确认后才写入 PTY |
| `confirm_session` | **显式 opt-in**（设置页二次确认 + audit + 警告文案：session 内等价 host shell） |
| `allowlist` | 仅匹配 `allowlist_commands` 前缀/正则的命令可无确认；其余拒绝或降级为 per-command |
| PTY isolation | kill 时杀 process group；尽力禁用 TIOCSTI 类注入；单 foreground 会话 |
| Lifecycle | **fork thread**：不继承 PTY（新 thread 无 session）。**resume / Companion 重启**：session 视为已死，UI「Shell 已结束 / 重新打开」。**crash**：全部 session 终止，audit `shell.session_close` reason=crash |
| 可见性 | L0 不可见；L1 可显示入口但引导 L2/Cockpit；**仅 Cockpit 可用完整终端** |
| 审计 | open/close；默认记录 **exit code + 命令长度**，命令正文默认不入 audit（或仅脱敏后截断；禁止完整 secret） |
| 确认通道 | 新 confirm kind `shell.command` / `shell.session`；**不走** `auto_approved_domains` / cookie 信任域 |

**与 `osascript_eval`**：同属高危 host 面；message type 分离；均不可被域白名单静默放行。

#### D. `netsec`（P2）

| 项 | 规格 |
|----|------|
| 工具形态 | Companion 适配器；**新代码** `netsec/scope.ts`，**不**复用 `matchDomain` 假装支持 CIDR |
| Scope 空 | **硬拒一切出站扫描** |
| 匹配算法（锁定） | 见下方 |
| 任务授权 | 每次任务 checkbox 默认 **未勾选**；写 audit + history |
| 硬拒 | 非 allowlist、module off、profile=community |
| 页面审计 | 不依赖 netsec |
| LLM 可见性 | 拒绝时 tool_result 仍可能进入 LLM 上下文；**可接受**（企业私有 endpoint 假设）；文档注明 |

**Allowlist 匹配算法（P2 必须单测）：**

| 规则类型 | 语义 |
|----------|------|
| 精确 hostname | 大小写不敏感相等；输入先 **punycode 规范化**（IDN） |
| `*.example.com` | 匹配 `a.example.com`、`a.b.example.com`（多级后缀）；**不**匹配 `example.com` 本身 |
| CIDR | **P2 仅 IPv4**（如 `10.0.0.0/8`）；IPv6 目标 → 拒绝并提示未支持 |
| 端口 | **不**做端口级 scope；匹配 host/IP 后该 host 上探测端口由工具参数决定（仍受工具白名单） |
| 字面 IP | 可写精确 IPv4 或落在 CIDR 内 |

执行时**实时**读 config allowlist，不使用 thread 内过期 snapshot。

---

## 8. Security & audit

### 8.1 威胁模型（增量）

| 威胁 | 缓解 |
|------|------|
| 恶意 pack 路径逃逸 | realpath containment；拒绝 `..` |
| pack 放宽全局自动批准 | schema 禁止；apply 忽略/拒绝安全键 |
| 伪 enterprise 扩展 | profile 与 modules 仅 Companion 权威 |
| NetSec 扫未授权资产 | allowlist 硬拒 + 任务授权文案 |
| Shell 旁路确认 | module 门 + policy + 审计；不与 cookie 域白名单共用 |
| 审计被删掩盖 | jsonl + 可选文件权限 0o600；P2 考虑签名链 |
| Prompt 注入诱导扫描 | 工具层硬拒 > 模型层 |

### 8.2 `capability-audit.jsonl` 事件类型与文件合同

```ts
type AuditEvent =
  | { type: "module.enable" | "module.disable"; module: string; by: string; at: string }
  | { type: "pack.install" | "pack.uninstall" | "pack.apply"; pack_id: string; thread_id?: string; at: string }
  | { type: "netsec.task_auth"; targets: string[]; by: string; at: string; thread_id: string }
  | { type: "netsec.scan"; targets: string[]; tool: string; result: "ok" | "denied" | "error"; allowlist_hash: string; at: string }
  | { type: "shell.session_open" | "shell.session_close"; thread_id: string; reason?: string; at: string }
  | { type: "shell.command"; thread_id: string; cmd_len: number; exit_code?: number; at: string }
```

**文件合同（P0）：**

| 项 | 要求 |
|----|------|
| 路径 | `DATA_DIR/logs/capability-audit.jsonl` |
| 权限 | 文件 `0o600`；`logs/` 目录 `0o700` |
| 写入 | `fs.appendFile` / `O_APPEND`；**禁止** truncate/unlink 业务路径 |
| 行大小 | 单行 ≤ 256KB；超限截断字段或丢弃该事件并 logger.warn |
| 轮转 | 单文件超过 **10MB** → rename 为 `capability-audit.jsonl.1` 等，**最多保留 3** 个历史；可复用/对齐现有 `log-rotation` 模式 |
| 内容 | Shell **默认不写完整命令正文** |

### 8.3 与现有安全栈交叉

| 现有机制 | Pack/Module 如何对接 |
|----------|----------------------|
| `tool_whitelist` | Pack apply 写入 |
| `SecurityConfirmationManager` | 注册独立 kinds：`shell.command` / `shell.session` / `netsec.task`；**显式排除** domain whitelist 与 cookie 信任自动批准路径 |
| `auto_approved_domains` | **永不**放行 Shell/NetSec |
| `osascript_eval` | 同级高危；不与 Shell 混 kind |
| God-mode | Pack 禁止打开；module 启用 ≠ God-mode |

---

## 9. UI / UX（最小）

### 9.1 Side Panel

| 入口 | 行为 |
|------|------|
| **任务包** 列表 | `pack.list`；显示 requires 是否满足 |
| **使用此包** | 选 thread 或新建 thread → `pack.apply`；缺 module 则 modal 引导 |
| 徽章 | Thread 标题旁 `pack: appsec-prd-review` |
| 设置 → 企业能力 | 仅 `available` 的 module 显示开关；Shell/NetSec 二次确认文案 |

### 9.2 Cockpit

- Shell 模块启用后：Cockpit 增加 **Terminal** 面板（L1 用户展开或 L2）。  
- NetSec：任务进度与结果以 **tool cards / 步骤条** 为主，不必进终端。

### 9.3 文案原则

- 不把 community 安装称为「渗透平台」。  
- 企业模块开启文案明确：**授权、审计、可关闭**。  
- NetSec 授权 checkbox 不可预勾选。

---

## 10. Phased delivery

### P0 — Pack 平台 + AppSec

| 交付 | 验收 |
|------|------|
| `pack.yaml` schema + validator（含 blocklist / 未知工具拒绝 / zip slip） | 单测绿 |
| `system_prompt_append` 加入 ALLOWED + adapter 合并顺序 | 单测绿 |
| 复制型 pack skill/knowledge 装载（非 multi-root） | refresh 可见 |
| 原子 `pack.apply` + `mission_pack_snapshot` | 失败不污染 thread |
| `pack.uninstall` 回滚 snapshot | 单测绿 |
| WS：list / install(内置+zip) / apply / uninstall | |
| 内置 `appsec-prd-review` | 可跑通 |
| `capability-audit.jsonl` 合同（权限/append/行上限/轮转） | |
| modules 段最小：`appsec` available；enabled 默认 false + apply 引导 | |
| **不含** Shell PTY、NetSec 扫描、multi-root skill-engine | |

**成功标准（产品）**：内测完成真实审查 ≥3 次/人；零「未确认高危被执行」。

### P1 — DevSec workspace

| 交付 | 验收 |
|------|------|
| `modules.devsec-workspace` opt-in | |
| `workspace_root` + folder-picker | 路径 containment |
| 与 MCP filesystem / 只读文件工具绑定 | |
| 可选：semgrep PATH 探测 + tool card | 无二进制则友好提示 |

### P1′ — Shell module

| 交付 | 验收 |
|------|------|
| `modules.shell` available/enabled | 默认 enabled=false |
| Companion PTY + Cockpit xterm 或 ghostty-web | session 绑 thread |
| policy confirm 或 allowlist | 关闭 module 杀 session |
| 审计 session open/close | |

### P2 — NetSec module

| 交付 | 验收 |
|------|------|
| allowlist 硬拒 | 单测 + 集成测 |
| 任务级授权文案 | 未勾选不能 scan |
| 最小探测工具 + 审计 | |
| enterprise-only | community profile 拒绝 |

---

## 11. Testing strategy

| 层 | 内容 |
|----|------|
| Unit | Pack schema、path containment、tools allow∩deny、allowlist 匹配（CIDR/host） |
| Integration | apply → thread JSON；module disable 中断 shell/netsec |
| Security | pack zip slip；prompt 无法绕过 netsec deny；community 拒 enterprise apply |
| UI（轻） | 缺 module 引导；授权 checkbox 默认 false |

---

## 12. Open questions — **已锁定**（Claude + Pi 一致）

| # | 决定 |
|---|------|
| Q1 | `appsec`: `available: true`, `enabled: false`；首次 apply 引导一点击启用（模块开 ≠ 自动 apply 到所有 thread） |
| Q2 | 使用 `system_prompt_append` 新键；合并顺序见 §6.5 |
| Q3 | Shell UI 默认 **xterm.js** |
| Q4 | **不**捆绑 nmap |
| Q5 | Pack 可含 craft 产物；craft 不自动 `requires_modules`；install 后 `refresh()` |

---

## 13. Implementation sketch（非绑定，供 plan 拆解）

| 组件 | 建议路径 |
|------|----------|
| Pack loader/validator | `companion/src/packs/pack-engine.ts` |
| Module gate | `companion/src/capability/modules.ts` |
| Audit log | `companion/src/capability/audit-log.ts` |
| WS handlers | `message-router.ts` cases `pack.*` / `modules.*` |
| Thread 字段 | `thread-manager.ts` 扩展 + 迁移默认 |
| Config | `config.ts` 默认 modules 段 |
| UI Packs | Side Panel `PacksPanel` 或 Settings 子页 |
| Shell | `companion/src/shell/pty-session.ts` + Cockpit `TerminalView` |
| NetSec | `companion/src/netsec/scope.ts` + `scanner.ts` |

---

## 14. PR / 落地切片建议

| PR | 范围 |
|----|------|
| PR-A | Schema + validator + disk layout + unit tests |
| PR-B | pack.list/install/apply + thread 字段 + 内置 AppSec pack |
| PR-C | UI 任务包列表 + apply 流 |
| PR-D | modules config + settings opt-in + audit jsonl |
| PR-E | DevSec workspace_root |
| PR-F | Shell PTY + Cockpit |
| PR-G | NetSec scope + 最小扫描 |

---

## 15. Sign-off

| 方 | 裁决 | 置信度 |
|----|------|--------|
| Claude | APPROVE_WITH_CHANGES → must-fix 已合入 | 86% |
| Pi | APPROVE_WITH_CHANGES → must-fix 已合入 | 84% |
| Design 状态 | **可进入 writing-plans（P0）** | |

---

## 16. References

- 产品结论：`docs/decisions/v1.3/scenario-packs-product-conclusion-2026-07-26.md`  
- 评审综合：`docs/decisions/v1.3/mission-pack-design-review-synthesis-2026-07-26.md`  
- Thread 模型：`companion/src/threads/thread-manager.ts`  
- Skill/Knowledge：`companion/src/skills/skill-engine.ts`  
- Tools：`companion/src/bridge/tool-definitions.ts`（`getToolDefinitions`）  
- DATA_DIR：`companion/src/config.ts`  
- UI modes：`docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md`  

---

## 17. Review amendments log（2026-07-26）

合并 Claude M1–M8 与 Pi M1–M6 / R1–R4：

| 源 | 项 | 处置 |
|----|-----|------|
| 双方 | Shell 默认 per-command | S10 + §7.3C |
| 双方 | intersect + null | S11：降级 allowlist |
| 双方 | system_prompt_append | §6.5 强制 P0 |
| Claude | 原子 apply | S8 + §6.4 |
| Claude | uninstall 回滚 | S9 + §6.7 snapshot |
| Claude | zip slip / 审计文件合同 | §6.3 / §8.2 |
| Claude | 未知工具拒绝 | §6.2 |
| Pi | 禁止键枚举 | §6.2 blocklist |
| Pi | min_capability vs modules | S12 |
| Pi | Shell lifecycle | §7.3C |
| Pi | NetSec 匹配算法 + 新代码 | §7.3D |
| Pi | confirm kinds 不走域白名单 | §8.3 |
| 双方 | AppSec 默认 enabled false | §7.1 / Q1 |
| Claude | P0 用复制装载非 multi-root | §6.6 |
| 双方 | pack.export → P2 | §6.3 |
