# Host Use 与 Apps 使用说明

> **面向使用者**：本机宿主读写、应用白名单启动、与 Computer Use 的边界。  
> **产品版本**：0.5.0 · **决策摘要**：[ADR-018](adr/018-host-use.md)  
> **接口史（非唯一规范）**：[decisions/host-adapter-interface.md](decisions/host-adapter-interface.md)  
> **坐标桌面**：[computer-use-user-guide.md](computer-use-user-guide.md) · **确认台**：[confirm-center-user-guide.md](confirm-center-user-guide.md)

### 能力坐标

| 轴 | 本指南位置 |
|----|------------|
| **Surface** | **L2 宿主面**（与 Computer Use 同属桌面侧，但走**语义 API**，不是坐标键鼠） |
| **Composition** | Apps 白名单 / 每应用策略是配置，不是 Pack；可与 Skill 提示「先 host_read 再总结」组合 |
| **Autonomy** | 单线程为主；Worker **硬禁** `host_*`（见 [multi-agent](multi-agent-user-guide.md)） |
| **Trust** | 读/写/启动各有 L2 或策略门；写路径常含生物识别/nonce（平台相关） |
| **规范** | [ADR-020](adr/020-capability-model-three-axes.md) · [ADR-018](adr/018-host-use.md) |

---

## 1. 一句话

| 能力 | 工具 | 做什么 |
|------|------|--------|
| **Host 读** | `host_read` | 从本机邮件等应用读结构化内容（如收件箱顶条预览） |
| **Host 写** | `host_write` | 受控写：如建笔记、受限目录内移动文件 |
| **App 启动** | `host_app` | 启动你**亲自加白**的 GUI 应用（仅无参 `launch`） |
| **CLI 工具** | `host_cli` | 运行你加白的 **结构化** CLI（manifest 内 subcommand/flag；无自由 argv） |
| **Computer Use** | `host_computer` | 对已授权坐标的窗口做键鼠（见 [Computer Use](computer-use-user-guide.md)） |

这些都是 **L2 / opt-in / 高危门**，**不是**浏览器 **L1** CDP 工具的默认扩展。能网页内完成的，优先 L1；有语义 Host API 时，优先本指南，再考虑坐标 Computer Use。

---

## 2. 在 Side Panel 管理 Apps

1. 打开 Side Panel 底栏 → **应用（Apps）**。  
2. **全局 App** 行：只读指示 `apps.enabled`；关闭后 **`host_app` 一律拒绝**。当前版本若显示关闭，需在 **`~/.cmspark-agent/config.json`** 中开启（面板不提供假开关）。  
3. **坐标操作** 行：只读镜像 `computer.coordinateEnabled`（见 Computer Use 指南）。  
4. 在 **应用** 分段中搜索本机候选、**加白名单**、设置每应用策略（见下）。  
5. **CLI 工具**分段：添加结构化 CLI（绝对路径 + `cli_manifest` JSON）；LLM 通过 **`host_cli`** 调用声明的 subcommand（无 free-args）。策略最高「AI 判断」，每次执行经 L2；危险级可升生物识别。输出按不可信内容处理。

### 每应用策略（`host_app` launch）

| 策略（UI 文案可能为中文） | 行为 |
|---------------------------|------|
| **全自动 / auto** | 白名单内无参启动可跳过重复 L2（仍审计） |
| **AI 判断 / ai** | 本线程首次询问，之后同线程信任 |
| **每次确认 / manual** | 每次 launch 都确认 |

未知 token、已禁用条目、Apps 总关 → **typed error**，Agent 不应死循环重试。

---

## 3. `host_read` / `host_write`（Host Use）

### 3.1 读（`host_read`）

- **L2 确认** 后执行（与 `evaluate` 同类队列）。  
- **macOS**：实现以 **Mail.app** 读收件箱顶条为主；Notes/Finder 等可能在白名单语义内但返回 **not-implemented** typed error（不会误报成邮件正文）。  
- **Windows**：经典 **Outlook COM**；「New Outlook」不支持，会返回明确错误。  
- **Linux**：Phase 1 读路径多为 **pending**。  
- 返回字段大致：`sender` / `subject` / `date_received` / `body_preview`（预览长度有 cap）。

### 3.2 写（`host_write`）

| kind | 含义（已实现） | 平台注意 |
|------|----------------|----------|
| `create` | 创建笔记等内容（首行常作标题） | macOS Notes；Windows OneNote 等 |
| `move` | 移动文件 | macOS POSIX；Windows **仅** Documents / Desktop / Downloads 内 |
| `update` / `delete` | 未实现 | 返回错误 |

- **每次写** 需 **生物识别**（Touch ID / Windows Hello）或不可用时的 **6 位手动确认码**（不可粘贴的 nonce 流，走确认台）。  
- **不可**用模型参数里的 `user_confirmed` 代替真人确认。

### 3.3 TargetId

HostAdapter 使用 **不透明 TargetId**（list 结果再回传），Companion **不**让 LLM 随意拼字符串当 ID：

- 概念接口：`listReadTargets` → `readOne` / `writeOne`（见 [host-adapter-interface](decisions/host-adapter-interface.md)）。  
- 平台形态示例：darwin `bundleId:…`、win `hwnd:…` 等 — **对用户与 LLM 均视为 opaque**。  
- 校验：`validateTargetId`；非法 ID 拒绝。

### 3.4 黑名单 / vault

密码管理器、部分高危系统路径等在 adapter **blacklist**；与 Computer Use 的 vault 结构排除互补。具体列表以代码 `host-use/*/blacklist` 与 `apps/guards` 为准。

---

## 4. 生物识别边界（你需要知道的）

| 场景 | 是否要求生物识别 / 等价 nonce |
|------|--------------------------------|
| 开启全局坐标开关、部分「加 auto / 放权」应用流 | 是（确认门） |
| `host_write` 每次 | 是 |
| `host_read` | L2 UI 确认（非必须生物识别，以当前门为准） |
| `host_app` launch | 依 per-app policy（auto 可跳过 L2） |
| `host_computer` 任务 L2 | 任务确认（type 全文枚举）；**不**因 session-trust 跳过 payment 等硬门 |

**原则**：生物识别证明「坐在机器前的人同意这一枪」；配置里的 enterprise / god-mode **不能**静默代替写操作的生物识别。

---

## 5. 与 Computer Use / workspace / shell 的分工

| 需求 | 作用面 | 优先工具 |
|------|--------|----------|
| 浏览器页面 | **L1** | CDP 工具 |
| 本机**工作区目录** list/read | 本机模块（任务包） | `workspace_*`（先选工作区） |
| 受控 shell | 企业模块 + 确认台 | `shell_exec` |
| 邮件/笔记/受限文件移动 | **L2** 语义 Host | `host_read` / `host_write` |
| 打开某个已白名单 App | **L2** | `host_app` |
| 在 App 窗口里点点点 | **L2** 坐标 | `host_computer` |

---

## 6. 相关文档

| 文档 | 用途 |
|------|------|
| [ADR-020](adr/020-capability-model-three-axes.md) | L2 Surface 与能力选型 |
| [ADR-018](adr/018-host-use.md) | Host Use 决策摘要 |
| [ADR-017](adr/017-computer-use.md) | Computer Use |
| [confirm-center-user-guide.md](confirm-center-user-guide.md) | L2 / 确认码 |
| [mission-pack-usage.md](mission-pack-usage.md) | workspace / shell / netsec |
| [architecture.md](architecture.md) §9 | 模块树 |

---

*文档版本：2026-07-29 · 对齐 ADR-020 · 与 `host-use/` · `apps/` · tool-definitions 一致。*
