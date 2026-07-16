# Cross-Platform 复评 Brief（Round 2）

> 日期：2026-07-16
> 范围：用户推翻 Round 1 D8 决策（darwin-only Phase 1）。重新评审「Phase 1 是否同时支持 macOS + Windows + Ubuntu」。
> 输入：`computer-use-design-brief.md` + `computer-use-round1-synthesis.md`（Round 1 三方收敛）
> 评审人：Kimi + Pi-sub（claude CLI 替补）+ Claude 主线综合

---

## 0. 用户原话

> 「我看了下，您这里的考虑只考虑 macos，实际我还想要支持其他平台，最开始我想要支持的包括 macos，windows 以及 ubuntu。」

**这不是「未来某天要支持」，是最开始就要支持。** 用户把 cross-platform 提到 Phase 1 hard requirement，不是 backlog。

---

## 1. Round 1 在 D8 上的三方共识（被推翻的 baseline）

| 评审人 | D8 立场 | 理由 |
|---|---|---|
| **Brief 作者** | darwin Phase 1，Win/Linux Phase 4 | 平台策略 darwin-first，跨平台留 stub |
| **Kimi** | 「唯一正确的平台策略」 | 隐含：AppleScript 是 macOS-only，跨平台抽象没意义 |
| **Pi-sub** | Phase 1 **不定义 HostAdapter interface**，`darwin/` 裸写 | 早期抽象一定错的，Phase 4 重做时宁可重写 interface |
| **Round 1 综合** | darwin-only Phase 1，HostAdapter interface 推到 Phase 4 | 三方一致 |

**现在用户的推翻使 Pi 的核心论证失效**：Pi 反对定义 interface 的前提是「Phase 1 只有 darwin」，如果三平台同时 Phase 1，interface 必须前置设计，否则 3 套 ad-hoc 实现互相不兼容。

---

## 2. 三平台差异矩阵（事实层）

| 维度 | macOS | Windows | Ubuntu/Linux |
|---|---|---|---|
| **原生自动化** | AppleScript + Shortcuts | Win32 UIAutomation + PowerShell | AT-SPI + bash + xdotool（Wayland 受限） |
| **权限模型** | TCC（Automation / Accessibility / ScreenRecording 三个独立 gate） | UAC（提权）+ SmartScreen，per-app automation 无独立 gate | Polkit；Wayland 下键盘注入/截屏被 sandbox 拦 |
| **Tray 二进制** | Swift NSStatusBar | Win32 NotifyIcon（C++/C#） | systray2 / Gtk StatusNotifier |
| **Daemon IPC** | UDS 0600 | Named pipe + ACL | UDS 0600 |
| **签名机制** | ad-hoc / Developer ID + notarization ($99/yr) | Authenticode ($499/yr EV cert 才有 SmartScreen 豁免) | GPG（用户基本不验） |
| **权限对话框** | macOS 弹「cmspark-agent 想要控制 X.app」（24h silent allow 坑） | 无 per-app gate（首次启动 SmartScreen 拦截） | 无（polkit-agent 弹密码） |
| **OCR / Vision** | VisionKit（CJK 漏字率 15%+） | Windows.Media.Ocr（CJK 支持好但 API 复杂） | Tesseract（CJK 需额外训练数据） |
| **历史 cmSpark 资产** | tray/（Swift + systray2 + readline 三套）+ osascript_eval | **无任何 host-use 资产** | **无任何 host-use 资产** |

**关键事实**：cmSpark 当前 host-use 资产 100% 在 macOS 侧（tray 三套 + osascript_eval tool + 配套 security 栈）。Windows 和 Linux 从零开始。

---

## 3. Round 1 决策在三平台下的崩溃点

### 3.1 D3 AppleScript AST 白名单 → 仅 macOS 有意义

- macOS：`osacompile` 预编译 `.scpt` + AST 校验（Round 1 共识）
- Windows：PowerShell ScriptBlock AST (`Parser.ParseInput`) + `ConstrainedLanguage` mode
- Linux：bash `shellcheck` 静态分析 + 命令白名单（但 bash 本质图灵完备，AST 白名单不够）

**3 套 AST 白名单 = 3 套实现**。Round 1 共识「LLM 只产 JSON args」在三平台都成立，但模板层各写各的。

### 3.2 D4 双信道 tray → 三种 tray binary

- macOS：Swift NSStatusBar（已有，ad-hoc signing + `SecStaticCodeCheckValidity`）
- Windows：Win32 NotifyIcon，需要 C++/C# 项目 + Authenticode 签名
- Linux：systray2 已有（但 Round 1 共识「systray2 同进程空间，critical 拒绝」）

**Linux tray 的问题没解**：systray2 是 Node 进程，和 companion 同进程空间，双信道无效。Linux 必须找独立 tray binary（Gtk StatusNotifier 的 C/Rust 实现），目前 cmSpark 没有。

### 3.3 D5 vault 黑名单 → bundle id / hwnd / window title 三套

- macOS：bundle id + `AXSecureTextField` role 检测
- Windows：process name + hwnd + `IsPassword` property on control
- Linux：window class + AT-SPI role

**heuristics 兜底（窗口标题含 password/login/bank/2FA）三平台通用**，但精确检测路径完全不同。

### 3.4 D6 screenshot → 三套 OCR 实现

Round 1 Pi 胜出方案是「Phase 1 不进 LLM」。三平台下仍成立——但 Phase 3 引入 vision 时需要三套 OCR。VisionKit（CJK 不准）/ Windows OCR（API 复杂）/ Tesseract（需训练数据）。

### 3.5 D7 daemon → 三套 daemon 机制

- macOS：launchd plist
- Windows：Windows Service + SCM
- Linux：systemd unit

**三套 daemon 实现各自独立的安装/启动/权限模型**。Round 1 共识「daemon socket UDS 0600」只在 macOS/Linux 成立；Windows 必须 named pipe + ACL。

### 3.6 Phase 0 tracer bullet → 三套 spike

Round 1 Pi 提的 Phase 0 gate「ad-hoc signing 能否在 Sonoma 14.4+ 拿到 Automation 权限」三平台等价问题：

| 平台 | Phase 0 必答问题 |
|---|---|
| macOS Sonoma 14.4+ | ad-hoc signed binary 拿得到 Automation 权限吗？ |
| Windows 11 | 未签名 binary 触发 SmartScreen，用户敢点「仍要运行」吗？需要 EV cert ($499/yr) 吗？ |
| Ubuntu 24.04+ (Wayland 默认) | Snap/Flatpak 沙箱下键盘注入/截屏被拦吗？AppImage 行吗？X11 vs Wayland 差异？ |

**Phase 0 工作量从 1 周 → 3 周**（每平台 1 周，并行也得 2 周）。

---

## 4. 需要评审回答的 6 个问题

### Q5（核心）：Phase 1 应该同时 ship 三平台，还是设计三平台但分批 ship？

- **Option A**：三平台并行 Phase 1，同步发布（~12-16 周）
- **Option B**：Phase 0 三平台 spike → Phase 1 darwin 先 ship → Phase 1.5 win/linux 接力（darwin 早 6 周可用，总工期 ~10-12 周）
- **Option C**：其他架构（评审人提案）

请明确支持哪个，理由。

### Q6：HostAdapter interface 现在必须定义吗？定义到什么粒度？

Pi Round 1 说「不定义，裸写」。但那是 darwin-only 前提。三平台下：

- **Option A**：Phase 0 就定义 `HostAdapter` interface，三平台同时实现
- **Option B**：Phase 0 只在 darwin 上跑通，但记录 darwin 实现暴露的抽象候选；Phase 1 开始前再定义 interface
- **Option C**：永远不定义统一 interface，每个平台一个独立 module（`darwin-host/`、`win-host/`、`linux-host/`），server.ts 按 platform 分发

### Q7：Windows / Linux 缺 host-use 资产，是从零写还是先依赖 Node 跨平台库（nut.js / robotjs / node-notifier）？

- **Option A**：从零写 native（Win32 UIAutomation + AT-SPI direct binding）—— 和 macOS 平齐的资产深度
- **Option B**：先依赖 Node 跨平台库快速跑通，Phase 2 再 native 重写
- **Option C**：macOS 走 native（已有资产），Win/Linux 走 Node 库（资产缺口太大）

### Q8：Round 1 的 4 档确认梯度（silent / ask-once / double-confirm / biometric）在三平台下需要调整吗？

- macOS Touch ID → ask-once 之上加 biometric 自然
- Windows Hello → 等价 Touch ID
- Linux：`lsusb` 指纹读取器检测 + `fprintd` —— 但很多 Linux 笔记本没指纹硬件

Linux 没 biometric 时怎么降级？强制走 double-confirm + 短 nonce？还是允许降级到 ask-once？

### Q9：3 套 daemon IPC（UDS / named pipe / UDS）+ 3 套 tray binary，值得引入跨平台抽象层吗？

- Node 有 `net` 既能 UDS 又能 named pipe（Windows 上 `\.\pipe\xxx`）
- tray 三套已经存在，但 Linux tray 不可用问题需要重写

### Q10：Windows EV cert ($499/yr) 是 Phase 1 ship 的硬阻塞吗？

- 没 EV cert：SmartScreen 拦截，普通用户不敢点「仍要运行」
- EV cert：年费 + 公司主体要求（个人开发者难拿）
- 替代：MSI installer + 数字签名（便宜些但仍要 cert）

如果不签 EV cert，Windows Phase 1 实际可达多少用户？

---

## 5. 我（Claude 主线）的初步立场

按 Push-Back Duty（[[behaviors-2.4]]）和 [[multi-agent-advisor-pattern]] 先把我的判断摆出来，供 Kimi/Pi 推翻：

- **Q5 → Option B**（Phase 0 三平台 spike + darwin 先 ship + HostAdapter interface 在 Phase 0 末尾定义）。理由：用户「最开始就要支持」≠「同步发布」。先验证三平台权限模型是否可行（spike 失败立即 kill 某平台），再决定 Phase 1 接口。darwin 早 ship 6 周不损失跨平台承诺。
- **Q6 → Option A**（Phase 0 末尾定义 interface）。Pi Round 1 反对定义的前提失效。
- **Q7 → Option C**（macOS native + Win/Linux Node 库）。cmSpark macOS 资产太厚，不应该为对称性重写。Win/Linux 资产缺口太大，Node 库快速跑通，Phase 2 视使用率决定是否 native 重写。
- **Q8 → Linux 没 biometric 时强制走 double-confirm + 6 位 nonce**。不允许降级到 ask-once（critical 操作）。
- **Q9 → daemon IPC 抽象到 `companion/src/ipc/`，tray 维持三套独立**。daemon IPC 复用度高（net module），tray 复用度低（UI 范式差异大）。
- **Q10 → Windows EV cert 是 Phase 1 ship 硬阻塞，建议 Phase 1.5 才做 Windows**。如果没有 cert，Windows 普通用户实际可装率会低于 30%，不值得 Phase 1 投入。

**但我是被用户推翻的一方，我的初步立场可能仍在低估 cross-platform 的真实意愿。请评审独立判断。**

---

## 6. 评审要求

- **Kimi**：从安全/产品视角，至少 1500 字。重点回答 Q5（同时 ship vs 分批）+ Q8（确认梯度跨平台）+ Q10（Windows EV cert 阻塞）。
- **Pi-sub**：从实现成本视角，1500 字以内。重点回答 Q6（HostAdapter interface）+ Q7（native vs Node 库）+ Q9（IPC 抽象）。
- 共同回答：**有没有任何一个平台，技术上或商业上不应该 Phase 1 做？** 即使这违背用户原话。

输出文件：
- `docs/decisions/adversary-kimi-cross-platform.txt`
- `docs/decisions/adversary-pi-cross-platform.txt`

不要重复 Round 1 已有结论，专注 6 个新问题。
