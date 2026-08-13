# 编程场景重定位：Zed ACP 对照 · 「浏览器壳 + 编程 Agent」

> **日期**: 2026-08-13  
> **触发**: 用户指出应参考 Zed ACP 优雅形态；发起后不应来回切终端；浏览器侧完成输入/查看/设置  
> **对照**: [agentclientprotocol.com](https://agentclientprotocol.com) · [Zed External Agents](https://zed.dev/docs/ai/external-agents) · 本仓 `companion/src/acp/*`  
> **修订**: 在 [product-rethink](coding-handoff-product-rethink-2026-08-13.md) 之上 **升级目标形态**；安全锁仍服从 ADR-020/025  

---

## 0. 用户命题（接受）

> 既然从插件发起编程，就不该再在浏览器 ↔ 终端之间来回切。  
> 我们相当于给编程 TUI/Agent **套了一层壳**：底层能力是编程 Agent，用户在浏览器端输入、查看、设置。

这与 **Zed 对 ACP 的定位同构**，与当前 CMspark「任务包复制 + 一次性 spawn + 薄 chip」**不同构**。

---

## 1. Zed 怎么做（优雅在哪）

### 1.1 角色拆分（LSP 式）

```text
┌─────────────────────────────────────────────────────────┐
│  Zed = ACP Client（编辑器 / UX 所有者）                   │
│  · Agent Panel：对话、流式输出、tool 卡片                 │
│  · Multi-buffer：diff 审阅与应用                         │
│  · Permission UI：工具/写盘确认                           │
│  · 工作区上下文：打开文件、选区、cwd                      │
│  · 配置：settings + ACP Registry（装哪个 Agent）          │
└───────────────────────────┬─────────────────────────────┘
                            │ JSON-RPC 2.0 over stdio
                            │ (newline-delimited)
┌───────────────────────────▼─────────────────────────────┐
│  External Agent = ACP Server（智能与运行时所有者）         │
│  · Claude / Codex / Gemini / Pi …（或其 adapter）        │
│  · 模型、鉴权、账单、工具逻辑、自己的 config               │
│  · 通过 session/update 推流：消息块 / tool / plan / diff  │
└─────────────────────────────────────────────────────────┘
```

**优雅点**：用户 **始终在一个壳里**；Agent 是可替换引擎，不是「请去终端」。

### 1.2 协议主路径（真 ACP）

```text
initialize  →  capability 协商
session/new →  cwd / sessionId
session/prompt → 用户一轮输入
     ▲
     │  持续 notifications
session/update  (agent_message_chunk | tool_call | plan | diff | …)
session/request_permission  → Client 弹确认 → 回结果
session/cancel | prompt 结束 (stopReason)
```

Zed **不**把 Agent 当「跑完吐一段 stdout 的脚本」；它是 **双向会话**。

### 1.3 UI 与协议的映射

| 用户动作 | ACP | Zed 表面 |
|----------|-----|----------|
| 开线程 / 选 Agent | session/new | Agent Panel 新会话 |
| 打字发送 | session/prompt | 输入框 |
| 看思考与回复 | session/update chunks | 流式气泡 |
| 看读文件 / 跑命令 | tool_call updates | Tool 卡片 |
| 看改动 | structured diff | Multi-buffer review |
| 允许危险操作 | request_permission | 确认 UI |
| 停 | session/cancel | 停止按钮 |
| 设模式/选项 | set_mode / config_option | 会话设置 |

---

## 2. 我们现在做了什么（诚实差距）

```text
当前 CMspark「acp」≈ 伪 ACP / CLI fire-and-forget

  propose → L2 confirm → spawn(command, argv + prompt)
       → 读 stdout 文本 tail
       → 结束塞 handback 信封
       → FocusBand 一行 progress_tail

  没有: initialize / session/new / session/prompt 多轮
  没有: session/update 结构化 tool/plan/diff
  没有: 浏览器侧持续输入 → 同一 session 下一轮 prompt
  没有: 协议级 permission 往返
```

| 维度 | Zed | CMspark 现状 |
|------|-----|----------------|
| 协议 | 真 JSON-RPC ACP | spawn + 文本 stdout |
| 用户是否切走 | 否（留在 Agent Panel） | 设计上鼓励复制去终端 |
| 多轮 | 同 session 连续 prompt | followup ≈ 新 session + 上文拼接 |
| 可观测 | tool/plan/diff 一等公民 | 80 字 tail |
| 输入 | Panel 内输入 | 几乎只能启动时 goal |
| 配置 | Agent 自管 + Registry | PATH 探测 + config.servers |
| 写盘 | 编辑器审 diff 再应用 | gated apply 或外部自写 |

**结论**：产品叙事写了「ACP Client」，实现更接近 **「带确认的本地 CLI 任务跑批」**。  
用户觉得别扭，是因为 **壳不够壳、会话不够会话**——不是「不该做壳」。

---

## 3. 产品重定位（接受用户方向）

### 3.1 一句话

> **在编程场景下，CMspark Side Panel = 面向浏览器用户的 ACP Client 壳；**  
> **本机 Claude/Codex/… = ACP Agent 引擎。**  
> 用户输入、查看、设置、停止、（可选）审 diff **尽量不离开浏览器**。

这与「不是 Side Panel IDE」**不矛盾**：

| 仍是壳 | 仍不是 IDE |
|--------|------------|
| 对话流 + tool 卡 + plan | Monaco 全文件编辑 |
| 结构化 diff 列表 + 确认应用 | 无限 multi-file 自由编辑器 |
| 工作区绑定 + 页证据注入 | 完整 git UI / 调试器 |
| 协议会话 | 第二套 LLM runtime（CMspark 自己再写一个 coding agent） |

**IDE 做 buffer 与语言服务；我们做「浏览器证据 × 本机 Agent 会话」的 Client。**  
Zed 是「编辑器 Client」；我们是「浏览器 Companion Client」——**同一协议位，不同 Surface。**

### 3.2 与上一轮 rethink 的关系

| 上一轮 | 本轮修正 |
|--------|----------|
| 主路径偏「任务包复制」 | 复制仍是 **降级/无 Agent 时**；有 ACP 时主路径是 **壳内会话** |
| 「工作台 = 观察」 | 工作台升级为 **会话面**：输入 + 流 + 设置 + 审 diff |
| 反膨胀反对「独立 Agent 面板」 | 反对的是 **第二 runtime / 底栏 Tab**；**赞成** 场景内 **全高会话壳**（类 Zed Agent Panel，适配 320px） |
| 勿切终端 | **强化为产品锁**：编程场景启动后，主路径 **零强制** 切终端 |

---

## 4. 目标架构（Zed 同构 · CMspark 拓扑）

```text
┌─ Chrome Side Panel (320px) ─────────────────────────────┐
│  场景: 编程  ·  仓库条  ·  Agent 选择                    │
│  ┌─ Coding Session Shell ─────────────────────────────┐ │
│  │  [流]  agent 消息 / tool 卡 / plan / 权限请求       │ │
│  │  [输入]  用户继续说…  (→ session/prompt)           │ │
│  │  [条]  模式·停止·设置·工作区 basename               │ │
│  └────────────────────────────────────────────────────┘ │
│  浏览器 Tab 证据 ──注入 prompt 上下文──┘                 │
└───────────────────────────┬─────────────────────────────┘
                            │ WS
┌─ Companion (唯一 runtime 门面) ─────────────────────────┐
│  AcpClient (真 JSON-RPC)                                 │
│   initialize · session/* · 转发 update → WS              │
│   permission → Confirm Center (originWs)                 │
│   fs/terminal capability: 按策略代理或拒绝               │
│  workspace realpath cage · 审计 · 无 CMSPARK_* 注入子进程 │
└───────────────────────────┬─────────────────────────────┘
                            │ stdio JSON-RPC
┌─ 本机 ACP Agent / Adapter ──────────────────────────────┐
│  claude-acp / codex-acp / gemini adapter / pi …          │
│  读自己的 ~/.claude 等配置（引擎侧，非我们吸密钥）        │
└─────────────────────────────────────────────────────────┘
```

**关键纪律（从 Zed 学到的）**：

1. **Client 拥有 UX**；Agent 拥有智能与自身配置。  
2. **流用 notification**，不是等进程退出。  
3. **危险操作用协议 permission**，映射我们已有确认台。  
4. **Diff 先展示再应用**（我们已有 gated apply，应对齐结构化 diff update）。  
5. **非 ACP 原生的 CLI** 用 **adapter 进程**（Zed Registry 同理），不要无限特殊 argv。

---

## 5. 用户流程（目标 · 不切终端）

### 5.1 从 GitHub / staging 进入

```text
用户在浏览器（PR / staging）
      │
      ▼
  /code 或 场景「编程」或 仓库条 [交给编程助手]
      │
      ▼
  绑仓（folder-picker · 当场完成）
  选 Agent（探测自 PATH/config · 读的是本机安装）
  HITL 确认（云披露 + 模式）
      │
      ▼
  ════════════════════════════════════
  ║  编程会话壳（不离开 Side Panel）  ║
  ║  · 自动带上：URL / PR / 对话摘要  ║
  ║  · 流式：Agent 在说什么、在调啥   ║
  ║  · 用户继续输入，无需开终端       ║
  ║  · 权限弹确认台，点允许/拒绝      ║
  ║  · diff 列表 → 确认后 apply       ║
  ════════════════════════════════════
      │
      ▼
  可选：回浏览器页点验收（L1）
```

### 5.2 与「复制任务包」的关系

```text
有 ACP Agent 可用 ──► 默认进会话壳（真 Client）
无 Agent / 用户偏好 ──► 降级：复制任务包到任意 TUI
协议失败 / 半兼容 ──► 降级 + 诚实错误，不装死会话
```

复制不是失败，是 **兼容层**；会话壳才是 **主形态**。

---

## 6. 320px 会话壳线框（非 IDE）

```text
┌─ 编程 · Claude · ~/cmspark ──────── [×] ┐
│ ● 运行中 · 审查              [停止] [⚙] │
├─────────────────────────────────────────┤
│ 上下文条: PR #42 · org/repo · 已注入    │
├─────────────────────────────────────────┤
│ ▸ Plan                                  │
│   1. 定位 timeout 路径                  │
│   2. 读 api.ts                          │
│ ▸ Tool  读 src/api.ts          ✓        │
│ ▸ Tool  搜 "timeout"           ✓        │
│ ▸ Agent 发现 2 处竞态…（流式）          │
│ ▸ Diff  src/api.ts  +12 -3   [审阅]     │
├─────────────────────────────────────────┤
│ 输入下一条…                      [发送] │
│ 模式: 审查 ▾ · 模型由 Agent 自管        │
└─────────────────────────────────────────┘
```

**刻意不做**：完整文件树、内嵌终端滚动全文、Monaco、底栏第二产品。

---

## 7. 实现分期（对齐真 ACP）

| 阶段 | 内容 | 用户可感知 |
|------|------|------------|
| **P0** | 修 workspace.pick；会话壳空态 | 绑仓不「没反应」 |
| **S1 真 Client 骨架** | JSON-RPC initialize + session/new + prompt + update 广播 | 流式消息进壳，非等退出 |
| **S2 输入闭环** | 壳内输入 → session/prompt；cancel | **无需切终端追问** |
| **S3 结构化 UX** | tool_call / plan / diff 卡片；permission→确认台 | 像「能看懂的 Agent」 |
| **S4 Adapter 矩阵** | 优先 1 个官方 ACP agent；其余 adapter 或降级复制 | 稳定优于全家桶 |
| **S5 页联动** | 仓库条 + 关联本地 + 复制 clone；注入 session 上下文 | GitHub 不脱节 |

**技术债点名**：现 `manager.ts` spawn+stdout **不能**渐进「多加一点 tail」假装 ACP；需 **Client 状态机重写** 或并行 `AcpJsonRpcClient`，旧路径仅作 fallback。

---

## 8. 安全锁（壳做厚时仍成立）

| 锁 | 在壳模型下 |
|----|------------|
| 单 Companion tool-loop | Client 在 Companion；不在扩展里跑 Agent |
| `acp.enabled` 默认关 | 壳入口仍 opt-in |
| L2 / originWs | prompt 启动、permission、apply 均走确认台 |
| 无 free shell | terminal 能力按协议代理且确认；禁止裸 shell 产品按钮 |
| 子进程无 Outbound token | 保持 |
| Worker 禁 ACP | 保持 |
| 不读 Agent 密钥进我们的 LLM | Agent 自读 config；我们只 spawn |

---

## 9. 最终裁决

| 命题 | 裁决 |
|------|------|
| 学 Zed 的分层（Client UX / Agent 智能） | **学** |
| 学真 ACP 协议而非 stdout 跑批 | **学 · 必做** |
| 用户留在浏览器壳内输入查看设置 | **产品主路径** |
| 做成 Side Panel Cursor | **不学**（无 buffer/LSP 优势） |
| 任务包复制 | **降级与兼容**，非有 Agent 时的主 CTA |
| 当前实现与叙事 | **欠账**；应公开为「Phase：CLI bridge → 真 ACP Client」 |

**产品句（对外）**：

> 编程场景下，CMspark 是 **ACP 客户端壳**：你在侧栏和本机编程 Agent 对话、看步骤与 diff、做确认；  
> Agent 仍是 Claude Code / Codex / … 自己，配置与智能在本机，不在我们云上另起一套。
