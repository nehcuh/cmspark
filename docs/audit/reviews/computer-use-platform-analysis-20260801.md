# 电脑操作平台分析：Grok Build vs CMspark macOS vs Windows vs 业界

> **日期**: 2026-08-01  
> **状态**: Synthesis for triple external review  
> **触发**: 用户要求多路调研 — Grok Build 操作方式、CMspark 反复失败 vs Windows、业界优秀实践  
> **方法**: 三路并行 subagent（Grok 文档/工具面 · CMspark 代码链 · 业界公开资料）+ 主会话综合  
> **相关 HANDOFF**: `docs/superpowers/plans/2026-08-01-macos-tcc-estop-BLOCKED-HANDOFF.md`

---

## 0. 一句话结论

| 对象 | 本质 |
|------|------|
| **Grok Build** | **终端编码 Agent**：无一等公民 Computer Use；能力来自 **shell + 宿主终端的 TCC** + 用户贴图 |
| **CMspark Windows** | **同会话用户态脚本**（PrintWindow / SendInput / 键状态轮询）— **无 macOS 式 TCC 身份墙** |
| **CMspark macOS** | **产品化 L2**：fail-closed estop + SCK + 独立 Mach-O；正确但 **运维脆弱**（ad-hoc CDHash、daemon 子进程、estop 硬门） |
| **业界标杆** | 云端沙箱浏览器（Operator）或开发者 Docker（Claude demo）；本地桌面必须 **单一稳定签名身份 + HITL + 表面分层** |

**用户体感「Grok 电脑操作很好」≠ Grok 有 CU 产品**；是 **always-approve shell + Ghostty 已授权** 的天花板。  
**CMspark 反复失败** 不是「没实现截图点击」，而是 **macOS 隐私身份 + 架构拓扑** 与 CLI 探测路径不一致。

---

## 1. Grok Build 如何做「电脑操作」

### 1.1 架构 `[inspected]`

```
Ghostty / Terminal / IDE
  └─ grok CLI 单进程（~0.2.x）
       ├─ 文件工具（read/edit/grep）
       ├─ bash / run_terminal_command  ← 万能适配器
       ├─ 用户粘贴图片 [Image #N]
       ├─ MCP / 子 agent
       └─ 无 host_computer / 无 SCK / 无 inject 工具
```

文档（`~/.grok/docs/user-guide/`、README Built-in Tools）**没有**截图/点击/AX/SCK 一等工具。

### 1.2 截图 / 点击实际怎么发生

| 路径 | 机制 |
|------|------|
| A | 用户 ⌘⇧ 截图粘贴进对话 — 多模态 `read_file` |
| B | Agent 被允许 shell 后跑 `screencapture` / `osascript` / 第三方 cliclick 等 |
| C | MCP 若接了 computer-use 服务 — 可选扩展 |

**权限**：TCC 通常记在 **宿主终端（Ghostty）**，不是「Grok.app」。  
本机 `permission_mode = always-approve` → 模型几乎等于「完整用户 shell」。

### 1.3 对 CMspark 的启示

1. **不要用 Grok 当 CU 参考实现** — 它是编码 Agent，不是桌面操控产品。  
2. 可参考：**低摩擦权限 UX**（一次授权终端即可）。  
3. 不可抄：**无 app 白名单、无 L2 任务确认、无 estop 产品门** — 与 ADR-017 冲突。  
4. CMspark 的 `shell_exec` ≈ Grok bash；`host_computer` 是 **更深、更贵** 的 Surface（ADR-020 L2）。

**置信度**: 无 CU 一等工具 95%；shell 即能力 90%；TCC 归因终端 70%。

---

## 2. 为何 CMspark 反复失败，Windows 为何可以

### 2.1 macOS 调用链 `[inspected]`

```
Side Panel → WS → Companion(Node daemon, detached)
  → ensureEstopHelper()  spawn MacOS/CMspark estop   ← code 4 硬门
  → MacScreenCapturer     exec  MacOS/CMspark screenshot  ← -3801
  → MacInputInjector      spawnHostBin inject
```

包装后同一 Mach-O：`com.cmspark.agent`，`Resources/cmspark-host` → symlink `MacOS/CMspark`。

### 2.2 Windows 调用链 `[inspected]`

```
Side Panel → WS → Companion
  → powershell computer-estop.ps1   (GetAsyncKeyState 轮询，无全局 tap)
  → computer-capture.ps1            (PrintWindow / BitBlt)
  → computer-input.ps1              (SendInput)
```

**无** Screen Recording / Accessibility 隐私列表；无 ad-hoc CDHash 漂移。

### 2.3 真机矛盾（HANDOFF `[executed]`）

| 探测 | 结果 |
|------|------|
| CLI `MacOS/CMspark` estop / 截图 / 点击 | ✅ |
| Side Panel `host_computer` | ❌ code 4 和/或 -3801 |

→ **二进制能 CU；产品编排路径不能稳定 CU。**

### 2.4 根因排序（置信度）

| 序 | 根因 | 置信 | 说明 |
|----|------|------|------|
| 1 | **estop fail-closed + CGEventTap(code 4)** | 0.92 | 急停起不来则整条 host_computer 拒绝 |
| 2 | **ad-hoc 重签 CDHash / TCC 错位** | 0.85 | 设置里「已开」可能绑旧身份 |
| 3 | **Node daemon 拉起短命 host** | 0.78 | 父进程/会话与 CLI 不同；责任进程归因 |
| 4 | **SCK -3801 残余** | 0.80 | estop 过后仍可截图失败 |
| 5 | resolveHostBinary 边界 | 0.55 | `2c1437f` 已加强 Contents 探测，真机未闭环 |
| 6 | 输入监控未检 | 0.45 | 可能共因 |

### 2.5 Windows「更好」的真正原因

不是 Windows 适配器写得更聪明，而是 **从不进入 macOS TCC 身份数据库**。  
跨平台公平对比：Windows CU ≈「用户态自动化」；macOS CU ≈「隐私特权产品」。

---

## 3. 业界优秀实践（2024–2026）

### 3.1 大厂路径

| 产品 | 关键选择 |
|------|----------|
| **OpenAI Operator** | **云端虚拟浏览器** — 隔离优先；takeover / watch / confirm / 注入监控多层 |
| **Anthropic Computer Use** | 开发者自备环境；官方 **Docker + Xvfb**；max iterations；像素坐标 |
| **Browserbase / Stagehand** | **云浏览器 + 混合**（NL + Playwright）；能 CDP 绝不纯视觉桌面 |

### 3.2 本地桌面不可妥协的三点

1. **单一稳定签名身份**（Developer ID + 同一 Team ID；禁止 ad-hoc 发货）  
2. **捕获/注入只在该身份 Mach-O 内**（永不在裸 node）  
3. **HITL**：不可逆动作确认；estop **在模型环外**；默认 CU 关  

### 3.3 反模式（CMspark 已踩或曾踩）

| 反模式 | 后果 |
|--------|------|
| 用户勾 CMspark、SCK 在另一 CDHash | 假绿 + -3801 |
| ad-hoc 生产包 | 每重装清授权 |
| 教用户勾 node | 产品失败 |
| estop 硬门 + 脆弱 tap | CLI 能截、产品全灭 |
| 纯视觉做网页 | 慢、错；应 L1 CDP |

### 3.4 推荐架构（Chrome 扩展 + Companion）

```
Extension (CDP L1 + 确认台 + 急停 UI)
    ↕ WS
Companion Node（策略/LLM，非 TCC 主体）
    ↕ spawn 仅同身份二进制
MacOS/CMspark（SCK + inject + estop）  ← 唯一用户可见权限主体
    签名：Developer ID（P1）；P0 可 ad-hoc 但须诚实文档
```

**P0 未完成**：daemon↔TCC 闭环 + 真机 host_computer DoD。  
**P1**：Developer ID；tray 常驻 estop / XPC；可选截图侧注入监控。

---

## 4. 综合裁决与路线图

### 4.1 判断

| 问题 | 裁决 |
|------|------|
| Grok 是否「电脑操作做得好」？ | **编码 Agent + shell 天花板**，非 CU 产品 |
| CMspark 是否「实现错了」？ | 产品方向（fail-closed、L2、身份统一）**对**；**交付拓扑**未闭环 |
| Windows 是否「架构更优」？ | **平台更宽容**，不是证明 macOS 应照抄 PS1 |
| 下一步最大杠杆 | **tray/Aqua 拥有长驻 estop** + **稳定签名** + **instrument bin 路径** |

### 4.2 建议优先级

1. **Instrument**：Side Panel 路径强制 log `bin` + CDHash + stderr（`2c1437f` 已部分）  
2. **Tray 拥有 estop**：Companion 只连 socket  
3. **Developer ID** 进发布流水线  
4. **DoD**：仅 CLI 成功不算过；必须 Side Panel 批准后非 Chrome 截图成功  
5. **产品叙事**：对用户区分「Grok 式 shell」vs「桌面 L2」能力边界  

### 4.3 置信度总表

| 区块 | 置信度 |
|------|--------|
| Grok 无 CU 一等工具 | 95% |
| macOS 调用链与 estop 硬门 | 95% |
| Windows 无 TCC 墙 | 95% |
| CLI vs daemon 矛盾为当前阻塞 | 90%（真机 HANDOFF） |
| ad-hoc CDHash 主因之一 | 85% |
| tray-owned estop 可修复 | 75%（假设，待做） |
| 业界云沙箱趋势 | 90% |

---

## 5. 证据与子报告来源

- Subagent A：Grok Build 工具面 / `~/.grok/docs`  
- Subagent B：CMspark darwin/win 代码与 HANDOFF  
- Subagent C：OpenAI / Anthropic / Stagehand / TCC 公开资料  
- 主会话：既有 BLOCKED HANDOFF、PR #103、用户真机日志  

---

## 6. 三路复审结果（2026-08-01-213609）

| Reviewer | Verdict |
|----------|---------|
| Claude | APPROVE_WITH_NITS |
| Pi | APPROVE_WITH_NITS |
| Kimi | APPROVE_WITH_NITS |

合成：`docs/audit/reviews/computer-use-platform-analysis-triple-synthesis-20260801.md`  
**R1–R5 全过**；分析可作为战略指导。设备侧 host_computer 仍阻塞（另轨）。

### 复审后措辞修正（采纳）

1. **estop**：连上后是 **长驻** helper；问题在 **daemon spawn 上下文 ≠ CLI**，不是「短命 estop」。  
2. **第二路径**：`shell_exec` + `screencapture` 仍可能把 TCC 记到 **node**（#7n9nvl）— 与 host_computer 并行存在。  
3. **根因 #1 拆分**：① CGEventTap 在产品路径失败；② fail-closed 门把失败放大成 **整条 CU 不可用**。  
4. **路线图补**：合 main `2c1437f`；Developer ID 标商务；Windows estop 对等安全显式 defer；输入监控验证项。

---

## 7. 待实现关注点（历史）

1. 是否错误把 Grok shell 当成 CU 标杆？→ 三路认为 **否，分析已拆清**  
2. tray-owned estop 是否引入新安全问题？→ 需实现时做威胁建模  
3. 业界云沙箱 → **约束有效**，不强制 CMspark 改云  
