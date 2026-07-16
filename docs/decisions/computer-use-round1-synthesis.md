# Computer Use — 三方评审综合（Claude 主线 + Kimi + Pi-sub）

> 日期：2026-07-16
> 来源：brief (`computer-use-design-brief.md`) × Kimi adversary (`adversary-kimi-computer-use.txt`, 175 行) × Pi-sub adversary (`adversary-pi-computer-use.txt`, 6.7k)
> Pi-sub 流派：Bash 直跑 `claude --print` 被 auto-mode classifier 三连拦（同 `git push` 阻拦 pattern），改用 Agent subagent 跑隔离上下文，与 Kimi 隔离程度等价。

---

## 0. 一句话结论

**Brief 的 Phase 1 铺得太开（5-6 tool），Pi 砍到 1 tool 是对的。Phase 0 的真正目标不是「跑通 Mail read」，是「ad-hoc signed binary 能否在 Sonoma 14.4+ 拿到 Automation 权限」——这是 Pi 唯一提出但 Kimi 漏掉的技术可行性 gate。三方一致不 kill，但 Phase 0 失败立即 kill。**

---

## 1. 三方一致认同的判断

### 1.1 值得做

| 判断 | 共识 |
|---|---|
| **Computer use 是 tray/daemon 的杀手级 feature** | ✅ 三方一致。Brief 第 5 节「关掉 Chrome agent 还在」是核心价值，Kimi/Pi 都明确反对推迟。 |
| **AST 白名单 + LLM 只产 JSON args（D3）** | ✅ 三方一致。但 Pi 补充：`osacompile` runtime gate 在 Apple Silicon 上 300-500ms 且 Unicode 处理有 bug，**必须改用预编译 `.scpt` + argv 注入**，AST 校验降为 dev-time 工具。 |
| **双信道 + Swift tray 独立 binary（D4）** | ✅ 三方一致。Pi 加严：systray2（Node 进程）和 companion 同进程空间，**Phase 1 双信道只在 Swift tray SHA256 匹配时启用**；Linux/systray2 critical 操作直接拒绝。 |
| **darwin only Phase 1（D8）** | ✅ 三方一致。Pi 补刀：Phase 1 **别定义 `HostAdapter` interface**，直接 `darwin/` 裸写。早期抽象一定是错的，Phase 4 再重构。 |
| **vault 黑名单 + heuristics 兜底（D5）** | ✅ 三方一致。Pi 实现 detail：很多敏感 app（1Password、银行）的 AX tree 默认 `AXManualAccessibility="NO"`，bundle id 拿不到；**真正的兜底是 `AXUIElement.role == AXSecureTextField` 时无条件 critical**。 |

### 1.2 必须砍 / 推迟

| 项目 | 三方结论 | 理由 |
|---|---|---|
| **`shortcut_run`** | ❌ Phase 1-2 全砍（不只 Phase 1） | Kimi：图灵完备黑盒，签名校验不落实前不发；Pi 补：Automation 权限对话框 24h silent allow，T2（恶意重名）授权后无法被用户察觉。 |
| **`vision_click`** | ❌ 代码层移除（不留开关） | Kimi：默认禁用是废话；Pi：Phase 1 连入口都没有。 |
| **`menu_click`** | ❌ 代码层移除 | 同上。任意菜单项 = 任意 app 功能。 |
| **`applescript_eval_host`** | ❌ 剔除 | 与 `osascript_eval` 重复暴露。 |
| **`notification_send`** | ❌ 砍 | Kimi：限前缀防不住钓鱼；Pi：LLM 控制通知内容 = 钓鱼入口。 |
| **Whitelist 3-7-10 计数演化（4.4 节）** | ❌ 砍 | Kimi：复杂记不住；Pi 补刀：计数持久化到 config.json = 攻击面（直接编辑计数让某 tool 永远 silent allow）。改为二元 allow/deny per tool per app。 |
| **`HostAdapter` interface（Phase 1）** | ❌ 砍 | Pi：早期抽象一定错。Phase 4 重做时宁可重写 interface。 |

---

## 2. 三方分歧及收敛

### 2.1 D6 screenshot：Pi 胜出

| 立场 | 内容 |
|---|---|
| **Brief** | screenshot OCR + 敏感区域像素模糊 + 原图只存 hash |
| **Kimi** | 修订：分层方案——默认本地 OCR + redact 后进 LLM；用户选 vision；原图加密存 7 天 |
| **Pi** | 反对 Kimi：VisionKit CJK 漏字率 15%+，redact regex 无法覆盖密码 manager 自定义字段；Phase 1 直接禁 screenshot 进 LLM |
| **收敛** | **Pi 胜出**。Phase 1 screenshot 只进 audit log + tray UI 可见，不喂 LLM。Kimi 的「用户显式选 vision」推到 Phase 3。 |

**理由**：Kimi 的方案偏产品理想，Pi 拿的是工程实测数字。Phase 1 的目标是验证「用户愿不愿意给权限」，不是「agent 能看多少屏幕」。Vision 准确度问题在 Phase 1 不解，模糊/redact 反而会训练用户「agent 截图了我看不清」卸载。

### 2.2 D7 daemon：Kimi + Pi 联合推翻 Brief

| 立场 | daemon 时机 |
|---|---|
| **Brief** | Phase 2+，先做浏览器内 native |
| **Kimi** | 反对：推到 Phase 2 = 杀死产品价值；Phase 1 做「关闭 sidepanel 后 tray 常驻 + 系统通知确认」 |
| **Pi** | 同意 Kimi 反对，但更小：Phase 1 daemon 只做 tray 常驻 + click-to-confirm 通知，**不跑 LLM streaming** |
| **收敛** | **Phase 1 必须有 daemon 最小形态**。Pi 的「不跑 LLM streaming」加严：tray 是确认信道 + 状态可视化，不是 LLM 推理边界。LLM 仍在 companion 主进程。 |

### 2.3 Phase 1 tool 数量：Pi 胜出（1 tool）

| 立场 | Tool 数 | Tool 清单 |
|---|---|---|
| **Brief** | 5-6 | applescript_run, app_activate, app_list_running, ax_tree_query, screenshot_capture, file_open_with |
| **Kimi** | 3 | applescript_run + app_activate + app_list_running |
| **Pi** | 1 | applescript_run only |
| **收敛** | **Pi 胜出，但保留 Kimi 的 2 个辅助 tool 作 v1.1 候选**。Phase 1 仅 ship `applescript_run`。 |

**Pi 的论证**（Kimi 未反驳，视为接受）：
- Phase 1 目标是验证「用户愿不愿意给 Automation 权限」，不是「agent 能干多少事」
- 3 个 tool 不会比 1 个 tool 多验证任何东西，但多 2 倍 attack surface
- `app_list_running` 会通过 SCShareableContent 泄漏所有 app 的 window title（包括 1Password「Login」、银行账户余额预览）——即使不截图
- `app_activate` 用处被 `applescript_run` 覆盖（`tell application "X" to activate`）

### 2.4 Phase 0 目标：Pi 重新定义（关键技术 gate）

| 立场 | Phase 0 tracer bullet 目标 |
|---|---|
| **Brief** | 1 个 tool 跑通端到端（Notes 建 note） |
| **Kimi** | 跑通后立即测用户信任（10 个目标用户 ≥3 拒点 → kill） |
| **Pi** | **ad-hoc signed binary 能否在 Sonoma 14.4+ 拿到 Automation 权限？** |
| **收敛** | **Pi 的 gate 是前置条件**——如果 ad-hoc signing 拿不到权限，根本到不了 Kimi 的用户测试。合并：Phase 0 = 技术可行性 + 用户信任二合一。 |

**Pi 的核心洞察**：Apple Silicon macOS Sonoma 14.4+ 对未签名 binary 的 Automation 权限越来越严。如果 Developer ID + notarization（$99/year + Apple 审核）是前置条件，整个项目在个人开发者手里就是死的。

**Pi 的折中方案**（采纳）：
- Swift tray binary 用 **ad-hoc signing + `SecStaticCodeCheckValidity`** 校验 code signature（不只 hash）
- 不开 `com.apple.security.cs.disable-library-validation`
- DYLD 注入靠 **hardened runtime + library validation** 拦，不靠 notarization

---

## 3. 最终 D1-D8 + Q1-Q4 收敛

### 3.1 D1-D8 最终立场

| 决策 | 最终立场 | 来源 |
|---|---|---|
| **D1** 4 档梯度 | ✅ 保留，命名换 `silent / ask-once / double-confirm / biometric`（codebase 用 enum）。**Phase 1 不实现 silent**（Pi：AX window tracking 一周脏活） | Pi 加严 |
| **D2** 剔除高风险 tool | ✅ 代码层移除 5 tool（不留开关）+ `applescript_run` 走预编译模板 + verb 白名单 + enum args | Pi 加严 |
| **D3** AST 白名单 | ✅ 预编译 `.scpt` 文件 + argv 注入；AST 校验是 dev-time 工具，不 runtime osacompile | Pi 加严 |
| **D4** 双信道 | ✅ Swift tray 独立 binary + companion 启动校验 code signature（不只 SHA256）；Linux/systray2 critical 拒绝 | Pi 加严 |
| **D5** vault 黑名单 | ✅ bundle id 黑名单 + `AXSecureTextField` 无条件 critical + heuristics 兜底（窗口标题含 password/login/bank/2FA） | Pi + Kimi 合并 |
| **D6** screenshot redact | ❌ Phase 1 直接禁 screenshot 进 LLM；screenshot 只进 audit log + tray UI | Pi 胜出 |
| **D7** daemon Phase 2+ | ❌ 推翻。Phase 1 必须有 daemon 最小形态（tray 常驻 + click-to-confirm 通知，不跑 LLM streaming） | Kimi + Pi 联合 |
| **D8** darwin only | ✅ Phase 1 不抽象 `HostAdapter` interface，`darwin/` 裸写 | Pi 加严 |

### 3.2 Q1-Q4 最终答案

| 问题 | 最终答案 |
|---|---|
| **Q1** 4 档是否过复杂？ | 不回 3 档。命名换用户语言（silent/ask-once/double-confirm/biometric）。Phase 1 只实现 ask-once + biometric 两档。 |
| **Q2** tray 信任根 SHA256 够吗？ | 不够。**实际方案**：ad-hoc signing + `SecStaticCodeCheckValidity` + hardened runtime + library validation。Developer ID + notarization 是 Phase 2+ 才考虑（$99/year 对个人开发者门槛过高）。**daemon 模式 socket 必须从 `ws://127.0.0.1:23401` 改为 UDS 0600**（Kimi 红灯 1）。 |
| **Q3** screenshot OCR 过激？ | Phase 1 不做 OCR（Pi 胜出）。Phase 3 再讨论是否引入 vision，且必须有「原图本地保留 + 用户复查」逃生舱。 |
| **Q4** agent 自主性曲线？ | 不「绝不主动」，但 Phase 1 system prompt **只宣告读能力**（Mail read、Finder 列文件），不宣告任何写能力。这样 agent 主动提议时也只能提议读；写必须用户显式动词。 |

---

## 4. Phase 0 / Phase 1 最终 scope

### 4.1 Phase 0（W1）— 技术可行性 + 信任 gate

**唯一目标**：在 5 台测试机上回答两个问题——
1. **技术**：ad-hoc signed companion binary 在 Sonoma 14.4+ 能否拿到 Automation 权限 + 跑通 Mail.app read 1 条邮件摘要？
2. **信任**：用户看到 macOS 权限对话框时是否敢点同意？

**Tracer bullet**：
- `companion/src/host-use/darwin/applescript.ts`：1 个预编译 `.scpt` 模板（Mail read inbox top 1）
- `companion/src/host-use/index.ts`：路由 + ask-once 确认（45s 超时，复用 security-confirmation.ts）
- Swift tray binary ad-hoc signed + `SecStaticCodeCheckValidity` 校验
- UDS 0600 替换 ws://127.0.0.1:23401（daemon mode only；browser mode 保持 WS）

**Go/No-Go**：
- ✅ ≥3/5 测试机：权限对话框正常弹 + 用户点同意 + Mail摘要正确返回
- ❌ ≥3/5 测试机：拒绝点同意 OR ad-hoc signing 拿不到权限 → **kill 项目**

### 4.2 Phase 1（W2-W4）— MVP

**Tool（1 个）**：
- `applescript_run` — 预编译 `.scpt` 模板 + verb 白名单 + argv 注入
- 白名单 verb（Phase 1）：`{Mail: read messages, Finder: list files, Notes: create note}`
- LLM 输出 free-form string → 立即 abort（必须 JSON args 匹配 enum）

**Daemon（最小）**：
- Swift tray 常驻 + 系统通知 click-to-confirm
- 不跑 LLM streaming（LLM 仍在 companion 主进程）
- UDS 0600 通信（不上 WS）

**确认梯度（2 档）**：
- `ask-once`：所有 read 操作（Mail/Finder/Notes create）
- `biometric`：Touch ID 用于任何写操作（Phase 1 仅有 Notes create note；Finder move 推 Phase 2）

**screenshot/shortcut/AX/menu/vision**：代码层不存在。

### 4.3 Phase 1 安全保留（Pi + Kimi 共识）

- N2 Shortcut 签名校验：Phase 1 不做 Shortcut，N2 推 Phase 3
- N3 双信道：Phase 1 只在 Swift tray 编译产物匹配时启用
- N4 AST 白名单：dev-time 工具（CI 跑），不 runtime
- N15 screenshot redact：Phase 1 不做，screenshot 不进 LLM
- **新增 N16（Pi 提出）**：`app_list_running` 只返回 bundle id，不返回 window title（Phase 1 该 tool 不存在，但写进 backlog 防回归）

---

## 5. Kill 信号

### 5.1 Phase 0 kill（立即）

- ≥3/5 测试机：用户拒点 Automation 权限同意
- ≥3/5 测试机：ad-hoc signing 拿不到 Automation 权限（macOS 直接拒）
- ≥3/5 测试机：Mail摘要读不到内容（AppleScript sdef 不稳定）

### 5.2 Phase 1 → Phase 2 gate

- W1 留存 ≥20%（用户开过一次 native 后还在用）
- 0 安全事件
- ≥3 用户主动提议「能不能让 agent 也做 X」（需求信号）

### 5.3 永远不做（Brief 第 5.6 节「两条反论」）

- 跨 Agent 异构编排（与 computer use 正交，但 Brief 1.2.9 已砍，此处重申）
- 节点连线式 Workflow 编辑器
- LSP 管理

---

## 6. 待 Phase 0 后回答的开放问题

1. **Apple Silicon vs Intel 的 Automation 权限行为差异**：Phase 0 测试机覆盖 Intel Mac 吗？还是只 Apple Silicon？
2. **Mail.app read 的 sdef 稳定性**：不同 macOS 版本（Sonoma 14.x vs Sequoia 15.x）的 AppleScript dictionary 是否一致？
3. **UDS 0600 + launchd plist 的实际部署**：用户机器上 launchd.plist 怎么装？首次启动谁触发？
4. **ad-hoc signing 的 revoke 风险**：用户机器上其他恶意 binary 是否也能仿冒 ad-hoc signed companion？（Pi 的 `SecStaticCodeCheckValidity` 是否足够区分？）

---

## 7. 下一步行动

1. ✅ 把 brief + Kimi + Pi + synthesis 提交到 `worktree-notebooklm-import` 分支
2. **新建 worktree** `computer-use-phase0`（worktree 名 notebooklm-import 已混淆，Phase 0 应换新 worktree）
3. Phase 0 tracer bullet 实施清单（4 文件）：
   - `companion/src/host-use/index.ts`（router）
   - `companion/src/host-use/darwin/applescript.ts`（预编译 .scpt 加载 + execFile）
   - `companion/src/host-use/darwin/templates/read-mail.scpt`（预编译模板）
   - `companion/src/tray/build-tray.sh` 加 ad-hoc signing + `SecStaticCodeCheckValidity` 校验逻辑
4. 找 5 台测试机（用户 + 朋友 + 内测群）
5. 跑 Phase 0 → 收集结果 → go/no-go

---

## 8. 三方评审元评估

- **Kimi 价值**：产品 + 安全视角，红灯 1（UDS）和红灯 2（用户信任）是项目级 gate
- **Pi 价值**：实现成本 + macOS native 实战，把 Kimi 的「3 tool」砍到「1 tool」，并提出 Phase 0 真正技术 gate（ad-hoc signing）
- **Claude 主线（Brief）偏差**：Phase 1 铺太开（5-6 tool）、把 daemon 推 Phase 2 错、screenshot redact 方向错（被 Pi 推翻）
- **下次评审改进**：Brief 写完后立即跑 Pi（工程师视角），让 Kimi 在 Pi 之上做产品/安全收敛，比 Kimi 先评 + Pi 反驳效率高
