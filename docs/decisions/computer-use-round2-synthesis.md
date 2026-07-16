# Computer Use — Round 2 三方综合（Cross-Platform Revisit）

> 日期：2026-07-16
> 来源：`cross-platform-revisit-brief.md` × Kimi (`adversary-kimi-cross-platform.txt`, 5.7k) × Pi-sub (`adversary-pi-cross-platform.txt`, 10.8k)
> 触发：用户推翻 Round 1 D8（darwin-only Phase 1），要求「最开始就支持 macOS + Windows + Ubuntu」

---

## 0. 一句话结论

**用户原话「三平台从最开始支持」在工程现实下需要拆解：macOS + Ubuntu Phase 1 同步 ship（12-14 周），Windows 推 Phase 1.5（条件：EV cert + 公司主体落地，+6-8 周）。这不是「darwin-first 重新包装」——Kimi 的质疑成立，但 Pi 的实现成本分析证明 Windows 在未签名 binary 下连 read-only UIAutomation 都跑不通（UIAccess protected 进程看不见完整 tree），不只是 SmartScreen 表面问题。**

**Kimi 的 process call 也成立**：「要么同步 ship，要么诚实砍掉某个平台，别造新词」。本综合不再用「Phase 1.5」做软着陆——Windows 在 EV cert 未批准前**不在 Phase 1**，明写。

---

## 1. 三方收敛（一致认同）

### 1.1 必须推翻 Round 1 D8 darwin-only

| 立场 | 来源 | 理由 |
|---|---|---|
| **Brief 作者（Round 1）** | darwin-only | 平台策略 darwin-first |
| **Kimi（Round 1）** | darwin-only | 「唯一正确的平台策略」 |
| **Pi-sub（Round 1）** | darwin-only + 不定义 interface | 早期抽象一定错 |
| **Round 2 三方** | **推翻 darwin-only** | 用户硬需求 + interface 必须前置（Pi 改变立场） |

### 1.2 HostAdapter interface 必须定义（推翻 Round 1 Pi 的「不定义」）

**Round 1 Pi**：Phase 1 不定义 HostAdapter interface，直接 `darwin/` 裸写。
**Round 2 Pi 改变立场**：前提失效。三平台下 interface 必须定义，但**定义时机**有分歧（见 §2.1）。

### 1.3 Native 优先，反对 Node 跨平台库（nut.js / robotjs / node-notifier）

**Pi 的核心论证**（Kimi 未反驳，视为接受）：
- nut.js/robotjs 是 **GUI 自动化库**（截图 + 鼠标键盘），不是 host-use 库。它们不能「读 Outlook 第一封邮件正文」——那要走 UIAutomation tree。
- 用 nut.js 实现「读邮件」= 模拟点 Outlook → 等窗口 → 读 label，**比 UIAutomation `FindFirst` 慢 10-100 倍且 brittle 100 倍**。
- AT-SPI Electron 应用（Code/Slack）`atspi_event_listener_new` 注册后 GLib main loop 持续 poll D-Bus，5000+ 节点全量 walk **5-15s**。Node 没有现成 AT-SPI binding。
- Node native addon 构建矩阵：3 平台 × Node 20/22/23 × darwin-arm64/darwin-x64/linux-x64/linux-arm64/win-x64 = **12+ prebuilds**。nut.js 自己有 prebuilds，你的 N-API addon 没有。
- Node GUI 库对 macOS Sonoma `CGEventTap` / Windows 11 UIAccess / Wayland portal 权限变化响应慢半拍。

**收敛方案**：三平台各用 native stack，三语言（TS / C# / Rust）：
- macOS：保留 Round 1 资产（osascript_eval + 预编译 .scpt + Swift tray），**不重写**
- Windows：UIAutomation 走 PowerShell ScriptBlock + `ConstrainedLanguage`；tray 走 C# WinForms `NotifyIcon`（~200 行，Authenticode 签名）
- Linux：AT-SPI 走 `gdbus call org.a11y.atspi.Registry` shell 调用（不写 N-API addon）；tray 走 Rust + `ksni` 或 `tray-icon` crate（独立 binary ~300 行）

### 1.4 daemon IPC 抽象，tray 不抽象

**Pi 共识**（Kimi 未直接回答，但 Q5 立场隐含同意）：
- IPC 抽象层用 Node `net` module（UDS + Windows named pipe 都支持）
- **Windows named pipe 必须显式设 ACL**：`ConvertStringSecurityDescriptorToSecurityDescriptorW` 配 `D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;OW)`，否则默认 Everyone 可写。`net` module 不自动加 ACL，`fs.chmod` 在 named pipe 上无效。
- tray 三套独立 binary（Swift / C# / Rust），复用度几乎为 0，**强抽 interface 是空类型层**
- 真正值得抽象的层：**确认消息协议 JSON-RPC payload**——`{cmd:"confirm", nonce, summary, risk_level}` → `{response:"allow"|"deny"}`。三平台 tray binary 都实现这套协议，传输层各自实现。

### 1.5 Windows EV cert 是硬阻塞（不只是 SmartScreen）

**Kimi + Pi 联合，Pi 加严**：

| 阻塞层 | Kimi | Pi |
|---|---|---|
| SmartScreen 拦截 | ✅ 提出 | ✅ 同意 |
| 未签名 binary 用户安装率 10-30% | ✅ 估 | — |
| EV cert 需要公司主体 | ✅ 提出 | ✅ 加严 |
| **UIAccess protected 进程（Outlook 等）未签 binary 看不见完整 UIAutomation tree** | ❌ 漏 | ✅ 提出 |
| **Win11 24H2+ 未签 binary `SetForegroundWindow` 被 UIPI silently ignore** | ❌ 漏 | ✅ 提出 |
| **`SendInput` 模拟输入需要 UIAccess manifest + 签名 binary** | ❌ 漏 | ✅ 提出 |

**结论**：Windows 在 EV cert + 公司主体 + Authenticode 签名流程落地前**不应进 Phase 1**。这不是「省成本」，是「未签名 binary 在 Windows 上 read-only 都跑不通」。

---

## 2. 三方分歧及收敛

### 2.1 Q6 HostAdapter interface 时机：Pi 胜出

| 立场 | 时机 |
|---|---|
| **Brief 作者（Round 2 初步）** | Phase 0 末尾定义 |
| **Kimi** | Phase 0 开始前定义（防被 darwin 实现绑架） |
| **Pi** | Phase 0 三平台 spike 跑通后再定义（rule of three） |
| **收敛** | **Pi 胜出**。Kimi 担心「被 darwin 实现绑架」，Pi 反驳：前置定义会被「对 3 个平台的想象」绑架，后者更糟。 |

**Pi 的方法论**（采纳）：
1. Phase 0（W1-W3）：3 平台并行 spike，**各自裸写最小 PoC**
2. Phase 1（W4）开始前**一次性定义 interface**，基于 3 套真实跑通的实现
3. interface 粒度：**只抽象 3 个方法**——
   - `listReadTargets()` → `TargetId[]`
   - `readOne(targetId: TargetId)` → `ReadResult`
   - `writeOne(targetId: TargetId, payload: WritePayload)` → `WriteResult`
4. 平台特异 token（bundle id / hwnd / window class）走 opaque `TargetId`，server.ts 不关心内部结构
5. **不要 abstract 6 个、8 个方法**——3 个就够 Phase 1 验证

### 2.2 Q5 平台范围：Kimi + Pi 联合，砍 Windows 保留 Linux

| 立场 | Phase 1 平台 |
|---|---|
| **Brief 作者（Round 2 初步）** | Phase 0 三平台 spike + darwin 先 ship + Win/Linux 接力 |
| **Kimi** | Option A 同步 ship 三平台；但条件不满足时砍 Windows 或 Linux |
| **Pi** | macOS + Linux 同步 ship；Windows 推 Phase 1.5 |
| **收敛** | **Pi 方案胜出，Kimi 砍平台建议被吸收**。 |

**Kimi 的「砍 Linux」被 Pi 推翻**：
- Kimi 论据：Linux 安全承诺最难兑现（Wayland/X11 分裂、生物识别缺失、发行版碎片化）
- Pi 反驳：Linux 用户基数小（<10% 桌面份额）→ 风险敞口小；Linux 实现成本最低（AT-SPI + bash，无签名成本，无公司主体）→ **适合作为 Phase 1 验证 HostAdapter 跨平台性的第二平台**。砍 Linux = 放弃验证跨平台架构。

**Pi 的「砍 Windows」加严 Kimi**：
- Kimi：SmartScreen + EV cert 公司主体
- Pi：+ UIAccess protected 进程 + SendInput + SetForegroundWindow 三条独立阻塞

**收敛结论**：
- **Phase 1 = macOS + Ubuntu Linux 同步 ship**
- **Windows 推 Phase 1.5，前置条件**：① EV cert 购买（$499/yr）② 公司主体注册 ③ Authenticode 签名流程跑通 ④ UIAccess manifest 设计完成

### 2.3 Q8 Linux biometric 缺失：Kimi 加严被采纳

| 立场 | Linux 没 biometric 时 |
|---|---|
| **Brief 作者（Round 2 初步）** | double-confirm + 6 位 nonce（可复制粘贴） |
| **Kimi** | 加严：手动输入 nonce，**不可复制粘贴**。降级到 ask-once = 欺骗用户。 |
| **Pi** | 未直接回答 |
| **收敛** | **Kimi 加严被采纳**。Linux critical 操作：手动输入 6 位 nonce，不可复制粘贴。理由：诚实反映 Linux 平台安全能力缺口；产品契约不能因平台权限模型弱而整体下滑。 |

### 2.4 跨平台 trust root：Pi 提出三套独立方案

| 平台 | trust root |
|---|---|
| macOS | ad-hoc signing + `SecStaticCodeCheckValidity` + hardened runtime + library validation（Round 1 共识） |
| Windows | Authenticode + EV cert + UIAccess manifest（Phase 1.5） |
| Linux | **不校验 binary 完整性**，靠 file system permission（`chmod 500` + root owned）做 trust root。GPG 验证用户基本不验，AppImage 内置签名机制覆盖率 <5%。 |

**Linux 的特殊处理**（Pi 提出，Kimi 未反对）：违反 Round 1 双信道假设的「独立校验」，但 Linux 桌面用户本来就接受这种 model。Phase 1 Linux 接受这个降级，明写为「Linux trust root = filesystem permission」。

---

## 3. Q5-Q10 最终收敛

| 问题 | 最终答案 |
|---|---|
| **Q5** 平台范围 | **Phase 1 同步 ship macOS + Ubuntu Linux**；Windows 推 Phase 1.5（条件见 §2.2）。Phase 0 三平台 spike（含 Windows，验证 UIAccess 是否真的被阻塞）。 |
| **Q6** interface 时机 | **Phase 0 W3 末尾定义**，基于 3 平台 spike 真实实现（rule of three）。只抽象 3 方法：`listReadTargets` / `readOne` / `writeOne`。平台特异 token 走 opaque `TargetId`。 |
| **Q7** native vs Node 库 | **Native 三语言**：macOS=TS+Swift / Windows=C#+PowerShell / Linux=TS+Rust+bash。**强烈反对 Node 跨平台 GUI 库**（nut.js/robotjs）。 |
| **Q8** Linux biometric | **手动输入 nonce，不可复制粘贴**。critical 操作不允许降级到 ask-once。 |
| **Q9** IPC 抽象 | **daemon IPC 抽象**（Node `net`，Windows named pipe 必须显式设 ACL `D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;OW)`）；**tray 不抽象**（三套独立 binary）；**只抽象确认消息 JSON-RPC 协议**。 |
| **Q10** Windows EV cert | **Phase 1 硬阻塞**。未签名 binary 不只是 SmartScreen——UIAccess protected 进程看不见完整 UIAutomation tree，`SetForegroundWindow` 被 UIPI ignore，`SendInput` 需 UIAccess manifest。Phase 1.5 前置：EV cert + 公司主体 + Authenticode + UIAccess manifest。 |

---

## 4. Phase 0 / Phase 1 / Phase 1.5 最终 scope

### 4.1 Phase 0（W1-W3）— 三平台并行 spike + 权限 gate

**目标**：3 平台各跑通最小 PoC，回答两个问题——
1. 各平台权限模型是否允许 host-use？
2. HostAdapter 的 3 个核心方法在三平台下语义可对齐？

**Spike 清单**：

| 平台 | Spike 实现 | 验证点 |
|---|---|---|
| macOS | Round 1 设计：`applescript_run` Mail read inbox top 1（预编译 `.scpt`） | TCC Automation 权限对话框 + ad-hoc signed binary 在 Sonoma 14.4+ 拿到权限 |
| Windows | UIAutomation + PowerShell ScriptBlock 读 Outlook inbox top 1 | 未签名 binary 是否能访问 UIAccess protected 进程；SmartScreen 实际拦截率；UIAutomation cache request 延迟（5-30ms 是否成立） |
| Linux | `gdbus call org.a11y.atspi.Registry` 读 Evolution mail top 1 | Ubuntu 24.04 Wayland 默认下 AT-SPI 是否被 sandbox 拦；AppImage 是否可分发；Electron app（Code/Slack）D-Bus 是否死锁 |

**Phase 0 末尾决策门**：
- macOS spike 失败 → kill 整个项目
- Linux spike 失败 → Linux 推 Phase 2，Phase 1 = macOS only（退化到 Round 1 方案）
- Windows spike 失败（预期内，UIAccess 阻塞） → 确认 Windows Phase 1.5，记录阻塞证据
- 三平台 spike 通过 → 进入 Phase 1 interface 定义

### 4.2 Phase 1（W4-W14）— macOS + Linux 同步 ship

**W4 interface 定义**（基于 spike）：
```typescript
// companion/src/host-use/host-adapter.ts
export interface HostAdapter {
  listReadTargets(kind: TargetKind): Promise<TargetId[]>;
  readOne(targetId: TargetId): Promise<ReadResult>;
  writeOne(targetId: TargetId, payload: WritePayload): Promise<WriteResult>;
}
// TargetId 是 opaque string（macOS=bundle+window_id, Windows=hwnd, Linux=atspi-path）
```

**实现**：
- `companion/src/host-use/darwin/`（TS + 预编译 .scpt + osascript_eval 复用）
- `companion/src/host-use/linux/`（TS + `gdbus` shell 调用 + Rust tray binary）
- `companion/src/host-use/win/`（**stub**，Phase 1.5 实现）

**Tool**（1 个，跨平台）：
- `host_read` — 走 `HostAdapter.readOne()`
- `host_write` — 走 `HostAdapter.writeOne()`（Phase 1 限 Notes create note / Finder move）
- macOS 保留 Round 1 verb 白名单；Linux 等价白名单：`{Evolution: read mail, Files (nautilus): list/move, gedit: create doc}`

**Daemon**：
- macOS：launchd plist + Swift tray
- Linux：systemd user unit + Rust tray binary
- IPC：Node `net`，macOS/Linux 走 UDS 0600

**确认梯度**（Phase 1 实现 2 档）：
- `ask-once`：所有 read
- `biometric`：macOS Touch ID 用于 write；**Linux 手动 6 位 nonce 不可复制粘贴**

### 4.3 Phase 1.5（W15-W22）— Windows（条件触发）

**前置条件**（必须全部满足才启动）：
- ✅ EV cert 购买完成（$499/yr）
- ✅ 公司主体注册完成
- ✅ Authenticode 签名流程在测试机器跑通
- ✅ UIAccess manifest 设计完成并通过内部 review
- ✅ Phase 0 Windows spike 的 UIAccess 阻塞证据归档

**实现**：
- `companion/src/host-use/win/`（C# + PowerShell + UIAutomation + WinForms NotifyIcon tray）
- daemon IPC：Windows named pipe + 显式 ACL
- 确认梯度：`ask-once` + `biometric`（Windows Hello）

**如果前置条件 6 个月内无法全部满足**：Windows 推 Phase 2 或永久 cancel，文档明写「Windows support requires EV cert + legal entity, currently not committed」。

---

## 5. Kill 信号

### 5.1 Phase 0 kill（立即）

- macOS spike 失败（ad-hoc signing 拿不到 TCC Automation 权限）→ kill 整个项目
- macOS + Linux 都失败 → kill 整个项目
- Linux spike 失败但 macOS 通过 → 退化到 Round 1 darwin-only 方案

### 5.2 Phase 1 → Phase 1.5 gate（Windows 启动决策）

- macOS + Linux Phase 1 ship 后 8 周内 ≥3 用户主动提议「Windows 版」
- EV cert + 公司主体预算批准
- 如果 8 周内无用户主动提议 Windows → 取消 Windows 计划，资源转 Phase 2 AX API

### 5.3 Kimi 的 process call（写入综合）

> 「要么同步 ship，要么诚实砍掉某个平台，别造新词让用户误以为需求被满足了。」

**执行原则**：
- 不再使用「Phase 1.5」「v1.1 候选」「Phase 2+」等模糊词隐藏砍平台事实
- 任何被推迟的平台/功能必须在 README 和 docs/ 显式标注「not supported in Phase 1, requires X condition」

---

## 6. 决策记录

### 6.1 Windows 处理（用户原话「三平台从最开始支持」 vs 工程现实）

**用户原话**：「最开始我想要支持的包括 macos，windows 以及 ubuntu」
**综合建议**：macOS + Ubuntu Phase 1，Windows Phase 1.5（条件触发）

**冲突根源**：Windows 在未签名 binary 下连 read-only UIAutomation 都跑不通（UIAccess protected 进程），不是工程问题，是签名门槛。

**选项**：

- **Option X**：接受综合建议。批准 macOS + Ubuntu Phase 1 ship（W14）；Windows Phase 1.5 启动条件（EV cert $499/yr + 公司主体注册）按 Phase 0 完成后批准。
- **Option Y**：坚持三平台同步 ship。立即批准 Windows EV cert 预算 + 公司主体注册流程，Phase 0 三平台 spike 同时启动；Phase 1 工期从 12-14 周延长到 18-22 周（Windows 多 6-8 周签名/UIAccess 工作）。

### 6.2 决策（2026-07-16）

**用户选定：Option X** ✅

- Phase 1 = macOS + Ubuntu Linux 同步 ship（W4-W14）
- Windows 推 Phase 1.5，**前置条件**：EV cert $499/yr + 公司主体注册 + Authenticode 签名流程 + UIAccess manifest 设计
- Phase 0 仍做三平台 spike（含 Windows），目的从「跑通」改为「收集 UIAccess 阻塞证据」
- Windows Phase 1.5 启动需另批准，不是自动触发
- Phase 1 ship 时 README/docs 显式标注「Windows not supported in Phase 1, requires EV cert + legal entity」

---

## 7. 下一步行动

1. ✅ Round 2 brief + Kimi + Pi + synthesis 提交到 `worktree-notebooklm-import`
2. ✅ **用户决策 Option X 锁定**（2026-07-16）—— macOS + Ubuntu Phase 1 ship，Windows Phase 1.5 条件触发
3. 新建 worktree `computer-use-phase0`（当前 worktree 名 `notebooklm-import` 已混淆，应换新）
4. Phase 0 三平台并行 spike（W1-W3）：
   - macOS：`companion/src/host-use/darwin/applescript.ts`（Round 1 设计直接用，Mail read inbox top 1）
   - Linux：`companion/src/host-use/linux/atspi.ts`（`gdbus call org.a11y.atspi.Registry` shell 调用）+ `companion/src/tray/rust-tray/`（独立 Rust binary，~300 行）+ Evolution mail read spike
   - Windows（仅收集阻塞证据）：`companion/src/host-use/win/uiautomation.ps1`（PowerShell spike 读 Outlook）+ 记录 UIAccess 实际阻塞行为 + SmartScreen 拦截率
5. 找测试机：macOS Sonoma 14.4+ 5 台 + Ubuntu 24.04 5 台 + Windows 11 5 台（Windows 仅作阻塞证据收集）
6. Phase 0 W3 末尾决策门：
   - macOS spike 失败 → kill 整个项目
   - Linux spike 失败 → 退化到 darwin-only Phase 1（Round 1 方案）
   - Windows spike 失败（预期内）→ Windows Phase 1.5 阻塞证据归档，等用户另批准 EV cert
   - 三平台通过（含 Windows 阻塞证据收集完成）→ W4 定义 HostAdapter interface（3 方法）→ 进入 Phase 1

---

## 8. Round 2 元评估

- **Kimi 价值**：process call（「别造新词」）+ Windows EV cert 公司主体阻塞 + Linux biometric 加严（不可复制粘贴 nonce）
- **Pi 价值**：实现成本数字（UIAutomation cache 5-30ms / AT-SPI Electron 5-15s / Node N-API 12+ prebuilds）+ Windows UIAccess 三重阻塞 + Linux 不砍的反论证 + interface rule-of-three 方法论
- **Brief 作者（Claude 主线）偏差**：Option B（darwin 先 ship）被 Kimi 正确识别为「重新包装 darwin-first」；Q8 nonce 允许复制粘贴被 Kimi 加严；Q7 折中（macOS native + Win/Linux Node 库）被 Pi 全推翻
- **下次评审改进**：brief 应该一开始就要求评审人回答「用户原话是否可在工程现实下满足」，而不是默认「折中方案」是合理答案
