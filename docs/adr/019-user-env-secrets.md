# ADR-019: 用户环境变量 / Secrets 管理器（User Env）

**日期**: 2026-07-29 | **状态**: **已交付**（2026-07-29；Gate1+Gate2 双评审均 APPROVE_WITH_NITS；ship note: `docs/audit/reviews/user-env-ship-note.md`；分支 `feat/user-env-secrets`）  

**动机对话**: `#pjlgfh`（Datayes skills 安装后，因缺 `DATAYES_TOKEN` 被迫在聊天中粘贴 token）  
**相关**: ADR-001（双层拓扑）、ADR-006（分层防御）、MCP `env`（stdio 子进程先例）、`shell_exec`（capability/shell.ts）  
**评审产物**: `.omx/artifacts/ask-claude-adr019-user-env-review-*.md` · `.omx/artifacts/ask-pi-adr019-user-env-review-*.md`

---

## 1. 背景与问题

### 1.1 现象

社区 / 企业 skill（尤其 Datayes 系列）约定通过 **环境变量** 注入 API token（如 `DATAYES_TOKEN`），禁止硬编码。Agent 通过 `use_skill` 加载说明后，用 `shell_exec` 跑 Python 脚本：

```ts
// companion/src/capability/shell.ts（现状）
env: { ...process.env, CMSPARK_SHELL: "1" }
```

Companion 多由 launchd / daemon / tray 拉起，**不继承用户交互 shell 的 export**。结果：

1. Skill 检测 token 缺失 → 要求用户配置  
2. 用户无产品化入口 → 在聊天中粘贴 token（泄露进 thread / history / 可能上传 LLM）  
3. 即使临时 `export`，daemon 重启后丢失  

### 1.2 非目标（本 ADR 明确不做）

| 非目标 | 原因 |
|--------|------|
| 把密钥只存在 Chrome `storage` | 子进程在 Companion 主机；扩展存储不是执行环境 |
| 把 token 注入 system prompt / 对话上下文 | 扩大泄露面到 LLM 供应商 |
| 替代 `shell_exec` L2 确认 | 有密钥 ≠ 免确认 |
| 通用密钥环（Keychain / DPAPI）第一版 | 复杂度高；P0 用文件 0o600 对齐 `ws_secret` / `api_key` |
| 为每个 skill 单独做 OAuth 流程 | 范围过大 |

---

## 2. 决策摘要

> **在 Side Panel 设置中提供「环境变量 / Secrets」管理 UI；数据以 Companion 为唯一真源持久化；在 `shell_exec`（及可选 MCP stdio）子进程启动时合并注入；全路径脱敏，永不进入 LLM 上下文。**

产品文案推荐：

- 中文：**环境变量（Secrets）**  
- 副文案：供 skill / shell 子进程使用；不会发送给大模型  

---

## 3. 架构

```
┌─────────────────────────────┐         WebSocket (auth'd)        ┌──────────────────────────────┐
│  Chrome Extension           │  user_env.list / set / delete      │  Companion                   │
│  SettingsSlideout           │ ─────────────────────────────────► │  user-env.ts                 │
│  「环境变量」区块            │ ◄───────────────────────────────── │  ~/.cmspark-agent/user-env.json│
│  仅见 key + set?/masked     │  redacted snapshot                 │  mode 0o600                  │
└─────────────────────────────┘                                    │            │                 │
                                                                   │            ▼                 │
                                                                   │  shellExec / MCP stdio spawn │
                                                                   │  env = process.env ⊕ user_env│
                                                                   └──────────────────────────────┘
```

**真源**: Companion 磁盘文件，**不**写入 `config.json`（避免与已含 `llm.api_key` 的大配置广播路径纠缠；降低误把明文经 `config.updated` 泄漏的风险）。

**UI**: Extension 仅编辑入口；与 MCP 面板改 `config.json` 不同，走专用消息类型。

---

## 4. 存储设计

### 4.1 路径与权限

| 项 | 值 |
|----|-----|
| 路径 | `~/.cmspark-agent/user-env.json`（随 `CMSPARK_DATA_DIR` / `DATA_DIR`） |
| 模式 | 文件 `0o600`，目录已 `0o700` |
| 格式 | JSON object：`{ "VERSION": 1, "vars": { "KEY": "value", ... } }` |
| 原子写 | temp + rename（复用 `io.ts` 模式） |

### 4.2 Schema

```ts
// companion/src/user-env.ts（新模块）

export const USER_ENV_VERSION = 1

export interface UserEnvFile {
  version: number
  /** ISO timestamp of last successful write */
  updated_at?: string
  vars: Record<string, string>
}

/** 变量名：POSIX 风格，与常见 skill 约定对齐 */
export const USER_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 单值最大长度（防恶意 / 误粘贴超大 base64） */
export const USER_ENV_VALUE_MAX = 16_384

/** 条目数上限 */
export const USER_ENV_MAX_KEYS = 64
```

### 4.3 禁止 / 保留名（denylist）

写入时拒绝（返回明确 error_code），防止破坏 Companion 与子进程。

**构建规则（评审修正）**：denylist **必须**基于实现时 `grep process.env` / 危险加载器键，**禁止虚构条目**（例如代码中不存在的 `WS_SECRET` env 名）。

基线危险键（实现时再扫仓补全）：

```
PATH, HOME, USER, LOGNAME, SHELL, TMPDIR, TEMP, TMP,
LD_PRELOAD, LD_LIBRARY_PATH, DYLD_INSERT_LIBRARIES, DYLD_LIBRARY_PATH,
NODE_OPTIONS, NODE_PATH, ELECTRON_RUN_AS_NODE,
OPENSSL_CONF, PYTHONHOME, PYTHONPATH, PYTHONSTARTUP,
CMSPARK_SHELL, CMSPARK_DATA_DIR, CMSPARK_SECURITY_SECRET（若代码读取）
```

**前缀策略（评审后默认）**：禁止写入 **`CMSPARK_*` 全部前缀**（Pi 倾向 A；Claude 倾向 B-仅 denylist）。  
取 A 的理由：内部变量增删频繁，前缀封锁降低「漏加 denylist」回归；用户自定义密钥用 `DATAYES_*` / 业务名即可。若产品后续需要开放无害 `CMSPARK_*` 调试键，再改为 allowlist 例外。

### 4.4 与 `process.env` 合并语义

```ts
function buildChildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...getUserEnvVars(), // 用户配置覆盖同名 OS 环境变量
    CMSPARK_SHELL: "1",  // shell 路径仍强制写入（不可被 user_env 覆盖：先 merge user 再强制）
  }
}
```

**覆盖顺序**（后写覆盖前写）：

1. `process.env`（宿主）  
2. `user_env.vars`  
3. 系统强制键（`CMSPARK_SHELL` 等）  

**刻意允许**用户覆盖 `DATAYES_TOKEN` 等 OS 级变量（设置页优先级更高，便于 GUI 用户）。

---

## 5. API / 协议

### 5.1 新 WS 消息类型（auth 后）

| type | 方向 | 作用 |
|------|------|------|
| `user_env.list` | E → C | 拉取脱敏列表 |
| `user_env.set` | E → C | 设置/更新单个或批量 `{ vars: { K: V } }`；**空字符串是合法值**，删除只能走 `user_env.delete`（评审修正） |
| `user_env.delete` | E → C | 删除 keys：`{ keys: string[] }` |
| `user_env.updated` | C → E | 广播脱敏快照（多客户端同步）；**唯一**生成 payload 的入口是 `buildUserEnvPublic()`（评审 P0） |

**不走 `config.set`**，避免：

- `message-router` 已很长的 normalize 面继续膨胀  
- `redactConfigForBroadcast` 漏改导致明文出站  
- 与「保存 LLM 设置」按钮耦合（用户改 env 应即时/独立保存）

### 5.2 脱敏快照

```ts
interface UserEnvPublic {
  keys: Array<{
    name: string
    masked: string        // always "***"（listed = 已配置）
    // 不返回 value 明文；不返回冗余 set:boolean（评审 P1）
  }>
  count: number
  updated_at?: string
}

/** 唯一出站构造器 — handler / broadcast 禁止直接传 UserEnvFile */
export function buildUserEnvPublic(file: UserEnvFile): UserEnvPublic
```

`set` 时若客户端发送 `value === "***"`（与 api_key 相同），**忽略该键**（表示未改动）。  
`value === ""` **写入空字符串**，不表示删除。

### 5.3 错误码

| error_code | 含义 |
|------------|------|
| `INVALID_KEY` | 名不匹配 `USER_ENV_KEY_RE` |
| `RESERVED_KEY` | denylist / `CMSPARK_*` |
| `VALUE_TOO_LONG` | > 16KiB |
| `TOO_MANY_KEYS` | > 64 |
| `IO_ERROR` | 读写失败 |

---

## 6. 注入点

### 6.1 P0：`shell_exec`（必做）

`companion/src/capability/shell.ts`：

```ts
env: buildChildEnv()  // 替换 { ...process.env, CMSPARK_SHELL: "1" }
```

覆盖 #pjlgfh 主路径（Python skill 脚本）。

### 6.2 P0.5：MCP stdio（强烈建议同 PR 或紧随）

`companion/src/mcp/transport.ts` 已有：

```ts
const env = { ...process.env }
env.PATH = buildSpawnPath()
if (config.env) Object.assign(env, config.env)
```

调整为：

```ts
const env = { ...process.env, ...getUserEnvVars() }
env.PATH = buildSpawnPath()
if (config.env) Object.assign(env, config.env) // per-server 仍最高优先级（除强制键）
```

**合并优先级**: process → user_env → MCP server.env → PATH 加固 / 强制键。

### 6.3 明确不做（P0）

| 路径 | 原因 |
|------|------|
| `host_app` / Apps spawn | 另一套信任模型；后续 ADR |
| Computer Use 子进程 | 非 skill 密钥场景 |
| Companion 自身 `process.env` 热改 | 避免污染 daemon 全局；仅子进程注入 |
| `use_skill` / skill-engine 内部 LLM 调用 | 仅 capability 子进程（shell / MCP stdio）注入 |
| `osascript_eval` 扩展为 `do shell script` | **不变量**：当前模板只 `execute javascript`；未来若扩展必须先评估是否绕过 user_env 注入面（Claude 评审 P0） |

---

## 7. UI 设计（SettingsSlideout）

### 7.1 区块位置

设置侧栏，建议在 **「连接 / 配对」与「LLM」之间或 LLM 之后**，标题：

**环境变量（Secrets）**  
说明：用于 skill 与 shell 命令（如 `DATAYES_TOKEN`）。仅保存在本机 Companion，**不会发送给大模型**。

### 7.2 交互

- 列表：变量名 | 状态（已配置 ●）| 删除  
- 「添加」：name + value（password 型 input）  
- 「更新」：对已有 key 可只填新 value  
- 快捷 chips（可选 P0）：`DATAYES_TOKEN` 一键填入 name  
- 独立「保存」按钮（或每行即时 set）——推荐 **每行确认写入**（`user_env.set`），避免与底部大 Save 混淆  

### 7.3 状态

- 未连接 Companion：区块 disabled + 提示  
- `set` 成功：toast / 行内 ✓  
- 错误：展示 `error_code` 中文映射  

---

## 8. 安全要求

| ID | 要求 | 验证方式 |
|----|------|----------|
| S1 | 明文永不经 WS 出站（list/updated） | 单测 redact + 集成断言 response 无明文 |
| S2 | 明文不进 LLM messages / system prompt | code review + grep 注入点 |
| S3 | history / logger / capability audit **永不**记 user_env 明文值 | set handler 显式 redact 后再 log；单测断言 |
| S4 | 文件 0o600 + 原子写 | 单测 / 启动后 stat |
| S5 | denylist 生效（基于全仓 `process.env` 扫描 + 危险键） | 单测 PATH / LD_PRELOAD 等 |
| S6 | 不绕过 shell L2 | 现有 shell 测试仍要求 token |
| S7 | thread 导出 / Obsidian 不含 env 文件内容 | 默认无引用即可 |
| S8 | `user_env.updated` / list **只**经 `buildUserEnvPublic()` 出站 | grep + 单测 |
| S9 | `getUserEnvVars()` IO/parse 失败 → `{}` 降级，不阻断 shell | 单测损坏文件 |

**已知残留风险（接受并文档化）**：

- Agent 仍可用 `shell_exec` 执行 `echo $DATAYES_TOKEN` 或 `curl … -d "$DATAYES_TOKEN"`：**stdout / argv / ps** 均可外泄；**L2 确认是唯一防线**（本 ADR 不引入新攻击面，也不在 P0 做 stdout/argv 脱敏）。  
- 用户若在聊天主动粘贴 token，本功能无法阻止；UI 文案引导「请到设置配置」。  

---

## 9. 实现拆分（PR Plan）

### PR-1：Companion 核心（可独立合入）

1. `companion/src/user-env.ts`：load/save/list/set/delete + denylist + cache  
2. WS handlers：`user_env.list|set|delete` + `user_env.updated` 广播  
3. `shell.ts` 注入 `buildChildEnv()`  
4. 单测：`user-env.test.ts`、`shell` env 合并（mock spawn）  
5. `redact`：history / 日志路径扫描  

### PR-2：Extension UI

1. `SettingsSlideout` 新区块  
2. background / ws-client 转发新消息类型  
3. types + store（仅 public 快照）  
4. 基础扩展侧测试（若有 message 映射测试）  

### PR-3（可选同批）：MCP 合并 + 文档

1. `mcp/transport.ts` 注入  
2. `docs/mission-pack-usage.md` 或新 `docs/user-env.md`  
3. Claude.md Common Issues 一条：`DATAYES_TOKEN` → 设置 → 环境变量  

### 非 PR 验收（手动）

1. 设置 `DATAYES_TOKEN` → `shell_exec` `printenv DATAYES_TOKEN` 有值（确认弹窗批准）  
2. 重启 Companion 后仍在  
3. `user_env.list` 无明文  
4. 尝试 set `PATH` 被拒  

---

## 10. 测试计划

| 层 | 用例 |
|----|------|
| unit | key regex、denylist、max keys/value、`***` 忽略、原子写损坏恢复 |
| unit | `buildChildEnv` 覆盖顺序：user 覆盖 process，强制键覆盖 user |
| unit | redact 快照 |
| integration | WS set → list → shell spawn env 含 key（mock child） |
| regression | 现有 shell L2、MCP PATH 加固、config redact 不回归 |

---

## 11. 后续演进（非本 ADR 承诺）

- Skill frontmatter `required_env: [DATAYES_TOKEN]` → 设置页 / agent 缺省提示  
- macOS Keychain / 加密 at-rest  
- stdout 密钥脱敏  
- 按 thread / pack 作用域 env（企业多租户）  

---

## 12. 决策记录（评审后固化 · 待人类确认）

| 议题 | 共识 | Claude | Pi | 最终默认 |
|------|------|--------|-----|----------|
| 存储位置 | 独立 `user-env.json` | A | A | **A** |
| 协议 | 独立 `user_env.*` | A | A | **A** |
| MCP 注入 | P0.5 同批 | A | A | **A** |
| 覆盖 process.env | 用户覆盖同名 | A | A | **A** |
| 强制键 | 禁止全部 `CMSPARK_*` | **B**（仅 denylist） | **A**（前缀） | **A**（见 §4.3 取舍说明） |

### 12.1 必须合入设计的评审修正（P0 并集）

| ID | 来源 | 修正 |
|----|------|------|
| R1 | Pi | `user_env.set` 进 logger/audit 前 **显式 redact** `vars` 值 |
| R2 | Pi | 出站 **唯一** `buildUserEnvPublic()`，禁止直接广播 `UserEnvFile` |
| R3 | Claude | denylist **扫仓生成**，去掉虚构 `WS_SECRET` 等 |
| R4 | Claude | §6.3 `osascript_eval` 不变量 |
| R5 | Claude | §8 argv 外泄列为接受残留风险 |
| R6 | Claude | 空字符串 ≠ 删除；删除只走 `user_env.delete` |
| R7 | Pi | `getUserEnvVars` 损坏时 `{}` 降级（P1 升为实现要求，并入 S9） |

### 12.2 事实勘误

- Claude 称 `redactConfigForBroadcast`「不存在」——**不准确**。该函数在 `companion/src/server.ts`（约 4224 行）存在，且已脱敏 MCP env。但 message-router 的 `config.get/set` 路径另有内联 `***`，**两处脱敏并存**；独立 `user-env.json` + 独立协议仍是正确选择，避免再扩第三/第四处内联。

---

## 13. 成功标准

1. 用户无需在聊天粘贴 `DATAYES_TOKEN` 即可跑通 Datayes skill 脚本路径  
2. 扩展 UI 可增删改查（脱敏）  
3. 安全：WS / LLM / 默认日志路径无明文 token  
4. 测试绿；文档可发现  

---

## 14. 双评审摘要

| | Claude | Pi |
|--|--------|-----|
| 结论 | **Approve with changes** | **Approve with changes** |
| 核心共识 | 独立文件 + 独立协议 + shell/MCP 注入 + L2 仍为外泄唯一防线 | 同左 |
| 分歧 | 强制键 B（灵活） | 强制键 A（前缀封锁） |
| 特色抓点 | argv 外泄、空串删除语义、denylist 虚构、osascript 不变量 | audit redact、broadcast 单入口、损坏降级 |

**综合建议**：按 §12 默认 + §12.1 七条修正更新设计后即可开工；实现顺序 PR-1 → PR-2，MCP 注入尽量同 PR-1 或紧随。

---

*作者: design draft*  
*评审: Claude (glm) + Pi · 2026-07-29*  
*下一步: 人类确认 §12 → 状态改为「已确认」→ 实现*
