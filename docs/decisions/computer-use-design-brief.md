# Computer Use 设计评审 Brief (v1)
> 日期：2026-07-15  评审人：Kimi、Pi-sub (claude CLI)、Claude 主线
> 范围：让 cmSpark 浏览器内 AI agent 操控宿主机原生 app（Mail / Finder / Notes / Shortcut / 任意 GUI / 截屏点击）

---

## 0. 为什么做这件事

cmSpark 当前是「Chrome Extension ↔ WebSocket ↔ Companion」双层拓扑，agent 只能通过 CDP 操控浏览器。用户多次反馈希望 agent 能：
- 「把今天的邮件整理成 markdown」→ 需要读 Mail.app
- 「桌面这堆截图按日期归类」→ 需要 Finder 操作
- 「跑一下我的 Shortcut『Daily Report』」→ 需要 shortcuts CLI
- 「关掉 Chrome 也能用」→ 需要 daemon 模式独立运行

业界所有主流 agent（Anthropic Cowork、OpenAI Operator、Google Gemini CU、OpenClaw/Pi、Manus Desktop）都同时做「browser + native」，cmSpark 当前「Chrome-only」是错位定位。**这是 tray/daemon 模式的杀手级 feature**——证明「关掉浏览器 agent 还在」的价值。

## 1. 调研结论（Pi agent + 业界）

- **Pi agent** = OpenClaw + earendil-works/Pi（最可能，"pi agent 最近加了 computer use" 对应 OpenClaw 4.x voice + Mac native Computer Use）。技术栈：**macOS Accessibility API + ScreenCaptureKit**，不走 AppleScript。
- **业界共识 stack**：AppleScript/Shortcuts 优先 → Accessibility API 次之 → 截屏+视觉兜底（最贵最不可靠）。
- **cmSpark 现有资产**：companion native helper（已是宿主进程）+ `osascript_eval` tool（P0 已修：execFile + argv + 强制 SecurityConfirmation）+ SecurityConfirmationManager + page-sanitizer + history.db + tray（Swift/systray2/readline 三套）+ daemon.ts。
- **关键差异化**：相比 OpenClaw/Anthropic，cmSpark 已有**完整 security 栈**——这是我们的护城河，必须复用而非重写。

## 2. 架构方案（架构师提案）

### 2.1 设计原则（6 条）

1. **先 API 后 GUI**：AppleScript Dictionary / AX API 比视觉点击快 100×、可靠 10×、可结构化、可审计。
2. **Companion 是唯一执行边界**：所有宿主动作走 `server.ts::executeCompanionTool`，extension 永不 spawn。
3. **能力分级三档**：untrusted（静默）/ trusted（白名单或 45s 确认）/ critical（永远强制确认，god-mode 也跳不过）。
4. **失败上升级联（fallback chain 由 agent 主动选）**：system prompt 教 agent 先 `applescript_run`/`shortcut_run`，失败 → `ax_action_invoke`，最后 `vision_click`。companion 不自动降级。
5. **幂等 + 短超时 + 可 abort**：默认 10s 超时，结果结构化返回，失败可重试。
6. **跨平台先抽象接口、后做 darwin 优先**：`HostAdapter` interface，Phase 1 只实现 darwin，Win/Linux 留 stub。

### 2.2 4 层能力模型

| 层 | 覆盖 | 性能 | 可靠度 | 权限 | 何时触发 |
|---|---|---|---|---|---|
| **L1 AppleScript Dictionary** | Mail/Calendar/Finder/Notes/Reminders/Safari/Music | <50ms | 高 | 无 | 目标 app 在 sdef 名单 |
| **L2 macOS Shortcuts** | 系统 action + 用户自定义 + 跨 app workflow | 100–500ms | 中高 | 首次 Automation 权限 | L1 无对应 API |
| **L3 Accessibility (AXUIElement)** | 任意 GUI app | 100–500ms | 中 | **Accessibility 权限（一次性全局）** | L1/L2 不可用 |
| **L4 Vision-based** | 真正任意（远程桌面、Canvas-only） | 1–5s + LLM 费用 | 低 | 截屏 + AX | L1-L3 全失败兜底 |

### 2.3 12 个新增 Tool

| name | L 级 | 强制确认（架构师原案） |
|---|---|---|
| `applescript_run` | L1 | trusted |
| `applescript_eval_host` | L1 | critical |
| `shortcut_run` | L2 | trusted |
| `app_activate` | L3 | untrusted |
| `app_list_running` | L3 | untrusted |
| `ax_tree_query` | L3 | untrusted |
| `ax_action_invoke` | L3 | trusted |
| `menu_click` | L3 | trusted |
| `screenshot_capture` | L4 | untrusted |
| `vision_click` | L4 | critical |
| `file_open_with` | L1 | trusted |
| `notification_send` | L1 | untrusted |

### 2.4 组件拓扑

```
Chrome Extension                  WebSocket            Companion (Node.js)
+-----------------+              ws://127.0.0.1:23401  +---------------------+
| sidepanel/      |  <========>                       | server.ts           |
|  ChatView       |                                   |  executeCompanion   |
|  + Confirm      |  <-- security.confirmation.* -->  |     Tool() ADD case |
|    Dialog       |                                   |                     |
+-----------------+                                   | host-use/   <--NEW  |
                                                      |  index.ts  (router) |
                                                      |  host-adapter.ts    |
                                                      |  darwin/            |
                                                      |   applescript.ts    |
                                                      |   shortcuts.ts      |
                                                      |   accessibility.ts  |
                                                      |   screenshot.ts     |
                                                      |   vision.ts         |
                                                      | security-confirmation.ts (复用)
                                                      | history/store.ts (复用)
                                                      | tray/ (复用, 弹原生确认)
                                                      +---------------------+
                                                                |
                                                          spawn osascript /
                                                          shortcuts CLI /
                                                          screencapture
```

新文件：`companion/src/host-use/{index.ts, host-adapter.ts, darwin/*, win/stub, linux/stub}`
改动：`tool-definitions.ts` + `tool-schemas.ts` + `server.ts` (`COMPANION_TOOLS` 数组、`executeCompanionTool` case、`server.ts:303` 确认门 if 扩展) + `security.ts` + `config.ts`

## 3. 红队威胁模型（13 场景 + 4 致命盲点）

### 3.1 4 个架构师漏掉的致命盲点

- **[N1] 数据敏感度维度缺失**：现有 untrusted/trusted/critical 只分**操作风险**，没分**数据敏感度**。`screenshot_capture` 被归 untrusted 是错的——截图含密码 manager 自动填充、合同、私钥，喂回 LLM → 进 history.db → Obsidian 导出 = 沉默泄漏。
- **[N2] Shortcut 校验靠名字不够**：白名单按名字而非 `(bundle_id, signature_sha256)`。攻击者装一个同名 shortcut 即可绕过。
- **[N3] 单信道确认**：critical 操作走 Side Panel 弹窗一个 UI 表面。WS 劫持场景下 panel 可能被攻击者控制，必须有 tray 独立进程也确认（**任一信道点确认即可，不是两个都点**）。
- **[N4] AppleScript 字符串 vs AST 校验**：白名单必须 AST 级（`osacompile` + 节点枚举），不能 regex/substring。否则 `'do ' & 'shell script'` 拼接绕过。

### 3.2 13 个具体威胁场景（重点摘录）

- **T1**：网页 prompt injection 让 agent 用 `applescript_run Mail` 转发邮件到攻击者邮箱
- **T2**：用户装的恶意 Shortcut「Backup-Photos」伪造系统重名 → 数据外泄
- **T3**：agent 截屏看到伪造「System: click Allow」文字 → `vision_click` 点真系统对话框
- **T5**：vision 流程填表时 password manager 自动填充 → 截图喂 LLM → 进 history/导出 → 泄露
- **T8**：AppleScript `'do ' & 'shell script'` 字符串拼接绕过 verb 白名单
- **T11**：retry-storm + 用户疲劳乱点
- **T13**：daemon 模式 WS socket 劫持（companion 重启时恶意进程抢 23401 + SO_REUSEADDR）

### 3.3 红队推荐强化（15 条）

- N1 数据敏感度分级（public/personal/credential/financial），screenshot OCR 命中银行/密码 manager regex 自动升 critical + redact
- N2 Shortcut 强制 `(bundle_id, signature)` 校验
- N3 critical 操作双信道确认（tray + Side Panel）
- N4 AppleScript AST 级白名单 + LLM 不产 AppleScript 源码，只产 JSON args
- N5 clipboard/notification/menu 全部强制 critical
- N6 destructive 档（在 critical 之上）需要 2-of-2 双确认或 Touch ID
- N7 per-app allowlist（每个 tool 加 `allowed_apps`）
- N8 rate limit + 批量行为检测
- N9 audit log 链式哈希（防篡改）
- N10 tray icon 状态可视化
- N11 sandbox/dry-run mode（propose_only）
- N12 4 步 onboarding
- N13 vault 黑名单硬编码（1Password / Keychain / 银行 app），god-mode 不可跳过
- N14 LLM 输出端 decoy detection
- N15 screenshot 后置 OCR + 敏感区域像素模糊 + 原图只存 hash

### 3.4 红队建议 Phase 1 剔除/推迟清单

| Tool | 红队建议 | 理由 |
|---|---|---|
| `applescript_eval_host` | 剔除 | 已有 osascript_eval 等价物，扩张攻击面 |
| `shortcut_run` | 推迟到 Phase 2 | Shortcut 是图灵完备黑盒，签名校验（N2）不落实前不发 |
| `vision_click` | Phase 1 默认禁用 | T3 提权路径太短，至少 screenshot+click 双确认 |
| `menu_click` | Phase 1 默认禁用 | 任意菜单项 = 任意 app 功能（Mail「Forward All」/Finder「Secure Empty Trash」） |
| `notification_send` | Phase 1 限 title 固定前缀 | 防 T9 钓鱼 |

**Phase 1 安全保留**（5 个）：`applescript_run`（按 N4 AST 改造）、`app_activate`、`app_list_running`、`ax_tree_query`（blocked_bundles 内）、`screenshot_capture`（按 N15 redact 后）、`file_open_with`（路径白名单）

## 4. UX 方案（4 档梯度）

### 4.1 矛盾 1 解决：四档确认梯度（取代架构师 3 档）

| 档 | 触发 | UX | 谁放行 |
|---|---|---|---|
| **L0 静默** | 已 whitelist 的 shortcut/scope；同 app 同窗口 5s 内的连续 read | 黄色徽章仅展示，不弹窗 | 自动 |
| **L1 单确认** | 普通 native action（开 app、读、写草稿） | Side Panel 内联确认条，45s 超时 | 一次点 |
| **L2 双信道** | critical（系统对话框点击、shortcut 写文件） | Side Panel 弹窗 + tray 同步亮起；任一信道点确认即可 | tray 或 panel |
| **L3 Touch ID** | destructive 且不可逆（发邮件、删邮件、`rm`、转账） | 弹窗 + 强制 Touch ID / 6 位 nonce fallback | 生物特征 |

**关键澄清**：红队的「双信道」=「tray 这个独立进程也能确认」，不是「两个都要点」。攻击者要同时攻破 panel 和 tray 才能伪造确认。

**Smart scope（5s 窗口）**：同 app + 同 window + 同 action verb + 5s 内 → 自动降一档。防 T11 retry-storm。

### 4.2 矛盾 2 解决：agent 何时用 native（三层提示）

1. **System prompt 能力宣告**：「你拥有 native 操作能力，但默认走浏览器。仅当用户明确提到桌面 app、本地文件、或浏览器无法完成的任务时才提议使用 native 工具，且第一次必须先征求同意。」
2. **隐式触发**：LLM 识别 native 意图 → 不直接干，先问「这个任务需要打开 Mail.app（只读）。可以吗？」（能力跃迁确认，thread 内一次性）
3. **显式触发**：用户用动词强制（「用 Mail 给 X 发邮件」），LLM 直接进 native 模式，但 destructive 动作仍走 L3。

**绝不主动**：agent 不在用户没提 native 时擅自提议。

**语义模糊 → 不动手**：「整理我的邮件」歧义（读 vs 删）必须先问清。

### 4.3 矛盾 3 解决：可见性徽章系统

```
Side Panel 320px 底部永远固定徽章（不随聊天滚动消失）:
┌──────────────────────────────────┐
│ ✉️ Mail.app · 写邮件              │
│ ✓ 选账户  ✓ 选收件人  ● 写正文   │
│ ○ 附附件  ○ 发送(L3)      12s [⏸]│
└──────────────────────────────────┘
```

颜色编码（左边框 4px 色条 + icon + 文字，色盲友好）：
- L0 灰 / L1 黄 / L2 橙 / L3 深红+🔒 / untrusted 暗灰+⚠

**Daemon 模式 tray icon 状态机**：
- idle 灰静止 / operating 黄脉冲 / confirm-wait 橙闪烁 / error 红静止
- 一个任务最多 2 条系统通知（需确认 + 结果），进度绝不发通知

### 4.4 Whitelist 演化（3-then-suggest）

- 第一次：弹窗含「仅这次」/「以后都允许此 shortcut」/「以后都允许所有 shortcut ⚠禁用」
- 连续 3 次同意同一项 → 第 4 次主动建议加白名单
- 第 7 次再问，第 10 次后默认用户有理由不再追问
- whitelist 设置页可看「这个月用了 0 次，要不要删？」——白名单会腐烂，UI 鼓励清理

### 4.5 错误恢复分级

| 操作 | undo | UX |
|---|---|---|
| 写文件 / 改文件 | ✓ 备份 `~/.cmspark-agent/undo/` 7 天 | 聊天 undo 链接 |
| 移废纸篓 | ✓ 用 trash 不用 rm | undo 恢复原位 |
| 设 clipboard | ✓ 存旧值 | undo 还原 |
| 发邮件 / 删邮件 / 转账 | ✗ 不可逆 | 红标 ⛔，无 undo |
| `rm` / `srm` | ✗ 禁止实现 | 强制 trash |

**批量升档**：>10 个对象即使可逆也升一档到 L1 确认。

**Uh oh 教训**：「桌面 200 个截图归类」即使可逆，必须单独确认 + undo 链接 24h 顶部可见。

## 5. 产品方案（PRD）

### 5.1 定位

cmSpark computer use = **browser-first 演化**，不是追赶 Operator/Cowork（赛道不同：本地 vs cloud VM）。是 **tray/daemon 的杀手级 feature**——「关掉 Chrome 也能用 agent」是 daemon 价值的最终证明。

### 5.2 Top 场景（按价值排序）

1. 「把今天的邮件整理成 markdown」→ Mail.app read + LLM 摘要（每周 N 次）
2. 「桌面这堆截图按日期归类」→ Finder trash+移动（每周 N 次）
3. 「跑一下 Shortcut『Daily Report』」→ shortcuts CLI（每天 1 次）
4. 「把这个 PDF 用 Preview 导出成 PNG」→ file_open_with（每周 N 次）
5. 「关掉 Chrome 也能跑 agent」→ daemon 模式（持续）

### 5.3 KPI（6 个月目标）

- 采用：启用 computer use 占比 ≥40%；W1 留存 ≥20%；whitelist 平均项数 3-8
- 价值：每周 native 操作 ≥5 次/活跃用户
- 安全：critical/destructive 拒绝率 5-15%；误操作回滚率 <2%；**安全事件 0**
- 可靠性：tool 成功率 ≥90%；跨 macOS 版本兼容率 ≥95%

### 5.4 Phase 划分

- **Phase 0（W1）**：Tracer bullet——1 个 tool（`applescript_run` Notes 建 note）跑通端到端
- **Phase 1（W2-W4）**：MVP——5-6 tool（按红队剔除后）+ 4 档确认 + 基础 UX
- **Phase 1.5（W5-W8）**：10 用户可用性测试，决定 go/no-go
- **Phase 2（W9-W12）**：AX API + daemon tray 双信道
- **Phase 3（W13-W20）**：Shortcut 签名校验 + Vision 受限启用
- **Phase 4（W21-W24+）**：Win/Linux adapter

### 5.5 Go/No-Go 标准

- **Phase 0 → Phase 1**：tracer bullet 2 周跑通
- **Phase 1 → Phase 2**：W1 留存 ≥20% + 0 安全事件 + 可用性测试通过
- **KILL 信号**：10/10 拒启用 / 0 真实启用 / tracer bullet 2 周跑不通

### 5.6 两条反论（理性评估）

1. **信任赤字可能无法跨越**：OpenClaw 18 个月没破圈，根因是用户心智模型（让 agent 碰邮件）不是技术。**缓解**：Phase 0 后立即测试，不达标即 kill。
2. **ROI 不如深化 Knowledge/Skill**：cmSpark 主线（Knowledge/Skill/Tray）都缺人，computer use 是新用户故事，问题是 cmSpark 是否到拉新阶段。

## 6. 待评审的关键决策

请评审以下 8 个决策，给出**同意 / 反对 / 修订**意见：

1. **D1**：4 档梯度（L0/L1/L2/L3）取代架构师原案的 3 档
2. **D2**：Phase 1 严格剔除红队推荐的 5 个高风险 tool
3. **D3**：AppleScript AST 级白名单（`osacompile` + 节点枚举），LLM 只产 JSON args
4. **D4**：critical 操作双信道（Side Panel + tray），任一信道点确认即可
4. **D5**：vault 黑名单硬编码（1Password/Keychain/银行 app），god-mode 不可跳过
5. **D6**：screenshot 后置 OCR + 敏感区域像素模糊 + 原图只存 hash（不进 history.db）
6. **D7**：daemon 模式作为 computer use 的杀手级 feature（Phase 2+），而非 Phase 1
7. **D8**：Phase 1 仅 macOS（darwin 优先），Win/Linux Phase 4 才做

以及开放问题：
- **Q1**：4 档梯度是否过复杂？是否应回到 3 档（untrusted/trusted/critical）+ destructive 加 Touch ID？
- **Q2**：daemon 模式的 tray 信任根（Swift binary SHA256）够吗？还是需要证书签名 + notarization？
- **Q3**：screenshot OCR 是否过激（性能/隐私 trade-off）？是否应该让用户选「截屏不喂 LLM，只存元数据」？
- **Q4**：agent 自主性曲线——「绝不主动提议 native」是否会损失价值？比如用户说「整理我的桌面」时 agent 是否该主动说「我可以帮你」？

## 7. 实现锚点（companion codebase）

- `/Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import/companion/src/server.ts:688`（`COMPANION_TOOLS` 数组扩容）
- `/Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import/companion/src/server.ts:303`（确认门 if 扩展，含新 tool 名）
- `/Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import/companion/src/server.ts:1010-1117`（`executeCompanionTool` 加 case）
- `/Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import/companion/src/bridge/tool-definitions.ts:483-497`（osascript_eval 旁加新 schema）
- `/Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import/companion/src/bridge/tool-schemas.ts`（zod 校验）
- `/Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import/companion/src/security-confirmation.ts`（45s 队列复用）
- `/Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import/companion/src/security.ts`（matchDomain 等复用）
- `/Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import/companion/src/history/store.ts`（operations 表，无需 schema 改）
- `/Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import/companion/src/tray/`（Swift/systray2/readline 三套）
- `/Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import/companion/src/daemon.ts`（UDS lock + daemonize）
- 新建：`/Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import/companion/src/host-use/`

参考 ADR：
- [ADR-007](../../docs/adr/007-domain-whitelist-auto-approve.md)（域白名单 + auto-approve）
- [ADR-008](../../docs/adr/008-obsidian-export.md)（vault 档案 + 隐私）
- [ADR-009](../../docs/adr/009-mermaid-rendering.md)（CSP-safe 客户端直跑）
- ADR-010（tiered-privilege + godmode + 不可篡改审计）

---

**评审请求**：以 critical / adversarial 视角审查以上方案。重点回答 D1-D8 决策和 Q1-Q4 开放问题。请指出：
1. 哪些决策我们漏看了风险？
2. 哪些决策过设计或工程成本不划算？
3. 你会建议的最小可行 Phase 1 scope 是什么（与我们的对比）？
4. 是否有任何**致命**缺陷让我们应该 kill 这个项目？
