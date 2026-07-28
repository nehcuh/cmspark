# CMspark 菜单栏服务架构方案 — 安全审查报告

> 审查日期: 2026-06-07
> 审查范围: 方案A（激进/SwiftUI）、方案B（折中/Electron）、方案C（保守/launchd）
> 审查维度: 进程隔离、网络攻击面、代码完整性、敏感数据保护、开机自启安全、供应链安全

---

## 一、方案A：激进方案（SwiftUI 原生菜单栏 + pkg 打包）

### 安全评分: 6/10

### 主要安全关切

#### 1. `pkg` 打包引入巨大的可信计算基（TCB）膨胀
**风险等级: 高**

`pkg` 将 Node.js 运行时（~50MB）与 Companion 源码 bundle 为单一二进制。该二进制成为必须信任的核心组件，但其构建过程涉及：
- `pkg` 自身的预编译 Node.js 运行时（来自 Vercel 的第三方二进制）
- 运行时中内嵌的 V8 引擎、libuv、OpenSSL 等原生组件
- 无法被 macOS 代码签名逐字节覆盖（签名仅覆盖外层 `.app` bundle）

**攻击场景**: 攻击者替换 `pkg` 打包后的 companion binary，由于该二进制内含完整 Node.js 运行时，可在用户空间执行任意代码，且 SwiftUI 菜单栏无法有效校验其完整性。

#### 2. Native Messaging 通道引入新的攻击面
**风险等级: 中高**

方案A 明确提到"可选 Chrome Native Messaging 通道"。Native Messaging 要求：
- 注册 host manifest 到 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
- 任何已加载扩展均可枚举 Native Messaging hosts
- 若 host 配置未严格限制 `allowed_origins`，恶意扩展可冒充 CMspark 扩展与之通信

**攻击场景**: 用户安装的某个恶意 Chrome 扩展发现 CMspark Native Messaging host 后，可向其发送消息，诱导菜单栏应用执行非预期操作（如启动 Companion、读取日志）。

#### 3. 双技术栈增加供应链攻击面
**风险等级: 中**

Swift + TypeScript 双栈意味着：
- Swift 侧依赖 Xcode 工具链、Swift Package Manager 生态
- TypeScript 侧依赖 npm 生态、`pkg` 工具链
- 任一供应链环节被攻破（如恶意 Swift Package、被篡改的 `pkg` 预编译运行时）都会影响最终产物

#### 4. 开机自启（SMAppService）的隐蔽持久化
**风险等级: 中**

SMAppService 将应用注册为系统级登录项，用户难以察觉。若应用本身被攻破，攻击者获得的是**随系统启动的持久化驻留点**。

#### 5. 进程内存中的 API key 暴露
**风险等级: 低（已有问题，不加剧）**

Companion 进程内存中的 API key 可被同用户进程读取（`vmmap` + 字符串扫描）。方案A 的架构不改变此现状，但文档中提到"建议后续引入 Keychain 存储"——这意味着当前方案未解决此问题。

### 缓解建议

| 关切 | 缓解措施 | 优先级 |
|------|---------|--------|
| `pkg` 二进制完整性 | 1. 构建时生成 companion binary 的 SHA256 校验和，Swift 应用在 spawn 前校验；2. 将 companion 源码直接嵌入 Swift app 的 Resource bundle，运行时解包到临时目录而非持久化路径 | P0 |
| Native Messaging 攻击面 | 1. 第一阶段禁用 Native Messaging，仅保留 WebSocket；2. 若必须启用，`allowed_origins` 严格限定为 CMspark 扩展 ID；3. 所有 Native Messaging 消息增加 HMAC 签名验证 | P1 |
| 供应链安全 | 1. CI 中锁定 `pkg` 版本并校验其 npm 包的 SHA256；2. Swift 依赖全部使用 commit-pinned SPM；3. 发布时提供完整的 SBOM（软件物料清单） | P1 |
| SMAppService 持久化 | 1. 首次勾选"开机自启"时明确弹窗告知用户；2. 菜单栏图标始终可见，提供"立即关闭自启"的一键入口；3. 系统设置中显示为"CMspark Agent"而非模糊名称 | P2 |
| API key 内存保护 | 1. 短期：使用 `secitem` / Keychain 存储 API key，Companion 仅在需要时读取，不在内存中长期持有；2. 长期：考虑使用 macOS Secure Enclave 进行密钥派生 | P2 |

---

## 二、方案B：折中方案（Electron 主进程-only）

### 安全评分: 5/10

### 主要安全关切

#### 1. Electron 主进程拥有完整的 Node.js 权限，攻击面极大
**风险等级: 高**

Electron 主进程是一个完整的 Node.js 环境，具备：
- 完整的文件系统访问权限
- 任意子进程 spawn 能力
- 网络请求能力（不受 CSP 限制）
- 内存中加载 V8 + Chromium 引擎

虽然方案B 声明"不创建 Renderer Window"，但 Electron 的架构决定了主进程本身已是一个高权限运行时。一旦主进程被攻破（如通过恶意 npm 依赖的 postinstall 脚本、渲染进程漏洞——若未来添加设置窗口），攻击者获得的是**完整用户空间权限**。

**攻击场景**: 某个被攻破的 npm 依赖（如 `node-auto-launch` 被供应链攻击）在主进程中执行恶意代码，可直接读取 `~/.cmspark-agent/config.json`、篡改 Companion 二进制、或向外部 C2 服务器外泄数据。

#### 2. `node-auto-launch` 的跨平台抽象引入不可控行为
**风险等级: 中**

`node-auto-launch` 在 macOS 上的实现底层是修改 Login Items，但其跨平台封装隐藏了具体行为。该库已多年未积极维护（最新版本 2.2.1 发布于 2017 年），存在：
- 未修复的安全漏洞
- 对新版 macOS 行为变更的适配滞后
- 潜在的 postinstall 脚本风险

#### 3. 双 Node 运行时（Electron Node + Companion Node）增加内存与攻击面
**风险等级: 中**

Electron 内置 Node.js 运行时 + Companion 作为子进程使用系统/打包 Node.js，形成**两个独立的 Node.js 运行时**：
- 内存占用翻倍（Electron ~80MB + Companion ~80MB = ~160MB）
- 两个运行时的 npm 依赖树可能不同，各自面临供应链风险
- Electron 的 Node 版本与 Companion 的 Node 版本不一致时，可能出现行为差异

#### 4. electron-builder 自动更新机制的信任链薄弱
**风险等级: 中**

方案B 提到"第一阶段手动下载；第二阶段 electron-updater"。`electron-updater` 的自动更新若配置不当：
- 更新包通过 HTTP 而非 HTTPS 下载
- 缺少签名验证或验证逻辑可被绕过
- 更新服务器被攻破后可推送恶意版本

#### 5. Companion 孤儿进程风险
**风险等级: 中低**

Electron 主进程崩溃时，Companion 子进程可能成为孤儿进程继续运行。虽然文档提到"退出时强制 kill Companion"，但异常崩溃路径（如 segfault、OOM killer）无法保证清理逻辑执行。

### 缓解建议

| 关切 | 缓解措施 | 优先级 |
|------|---------|--------|
| Electron 主进程高权限 | 1. **绝不**创建 Renderer Window，禁用 `nodeIntegration` 和 `contextIsolation` 的默认值；2. 主进程代码最小化，仅保留 Tray + Menu + spawn 逻辑；3. 使用 `app.enableSandbox()` 限制主进程能力（Electron 28+ 支持）；4. 所有文件操作限制在 `~/.cmspark-agent/` 目录内 | P0 |
| `node-auto-launch` 风险 | 1. 弃用 `node-auto-launch`，直接使用 `SMAppService`（macOS 13+）或手动写入 `~/Library/LaunchAgents/` plist；2. 若必须使用，fork 并审计其源码，移除 postinstall 脚本 | P1 |
| 双 Node 运行时 | 1. 统一 Node 版本：Electron 的 Node 版本与 Companion 开发版本保持一致；2. 考虑将 Companion 直接作为 Electron 主进程的一部分运行（牺牲独立性，减少攻击面） | P1 |
| 自动更新安全 | 1. 第一阶段严格禁用自动更新；2. 第二阶段启用时，强制代码签名验证 + HTTPS + 更新包 SHA256 校验；3. 更新前弹窗告知用户版本变更摘要 | P1 |
| 孤儿进程 | 1. Companion 启动时写入 PID 文件；2. 菜单栏启动时检查残留 PID 并清理；3. 系统级使用 `launchd` 管理 Companion（即使 Electron 崩溃，launchd 可接管） | P2 |

---

## 三、方案C：保守方案（launchd + node-notifier）

### 安全评分: 7/10

### 主要安全关切

#### 1. `node-notifier` 依赖的 `terminal-notifier` 二进制完整性
**风险等级: 中**

`node-notifier` 在 macOS 上依赖预编译的 `terminal-notifier` 二进制（位于 `node_modules/node-notifier/vendor/`）。该二进制：
- 由第三方维护，非 Apple 官方签名
- 历史上曾出现过版本混淆问题
- 若被替换，可在菜单栏代理上下文中执行任意代码

**攻击场景**: 攻击者通过供应链攻击替换 `terminal-notifier` 二进制，当菜单栏代理调用通知时，实际执行的是恶意代码。

#### 2. PID 文件竞态条件与 TOCTOU 漏洞
**风险等级: 中**

方案C 使用 PID 文件进行进程间协调，但文档中仅提到"使用 `fs.openSync` + `O_EXCL` 原子创建"作为缓解。实际上：
- PID 文件在崩溃后可能残留，导致"假阳性"（认为进程在运行，实际已死）
- 多进程读写 PID 文件存在 TOCTOU（Time-of-Check to Time-of-Use）窗口
- 没有提到 PID 文件的权限控制（应为 `0600`）

#### 3. launchd plist 的篡改风险
**风险等级: 中低**

`~/Library/LaunchAgents/com.cmspark.companion.plist` 若被恶意修改：
- 可指向任意可执行路径
- 可实现开机自启的恶意代码
- 用户通常不会检查 plist 内容

#### 4. 日志目录权限默认宽松
**风险等级: 中低**

文档提到"日志目录 `~/.cmspark-agent/logs/` 权限默认 755，其他用户可读"。虽然计划通过安装脚本改为 `700`，但：
- 安装脚本可能执行失败或被跳过
- 日志中可能包含敏感操作记录（如访问的 URL、DOM 内容片段）
- 现有 `logger.ts` 的脱敏机制（`SENSITIVE_KEY_RE`）仅针对 key 名，不针对 value 内容

#### 5. AppleScript 启动器的注入风险
**风险等级: 低**

AppleScript 应用包（`CMspark Agent.app`）通过 `osascript` 执行 shell 命令。若 AppleScript 文件被篡改，可注入任意命令。

### 缓解建议

| 关切 | 缓解措施 | 优先级 |
|------|---------|--------|
| `terminal-notifier` 完整性 | 1. CI 构建时校验 `terminal-notifier` 的 SHA256；2. 运行时校验 vendor 目录下二进制签名（codesign -v）；3. 长期：弃用 `node-notifier`，改用纯 Node.js 的 `child_process.exec('osascript')` 调用 `display notification` | P1 |
| PID 文件竞态 | 1. 使用 Unix Domain Socket 锁替代 PID 文件（`net.createServer().listen('/path/to/socket')`，利用文件系统原子性）；2. 若保留 PID 文件，设置权限 `0600`，并使用 `flock` 或 `lockfile` 库实现真正的互斥锁 | P1 |
| launchd plist 篡改 | 1. 安装脚本生成 plist 后计算 SHA256，写入 `~/.cmspark-agent/.plist.sha256`；2. 每次启动前校验 plist 完整性；3. 长期：使用 `SMAppService`（macOS 13+）替代手动 plist 管理 | P2 |
| 日志权限 | 1. `initDataDir()` 中强制设置 `logs/` 目录权限为 `0o700`；2. 日志脱敏增强：不仅脱敏 key，还要对 URL、DOM 内容中的敏感信息（如密码输入框的值）进行模式匹配脱敏 | P2 |
| AppleScript 注入 | 1. AppleScript 文件作为静态资源打包，运行时校验其 SHA256；2. 避免在 AppleScript 中拼接用户输入的字符串 | P2 |

---

## 四、方案间安全对比

### 综合对比表

| 安全维度 | 方案A (SwiftUI) | 方案B (Electron) | 方案C (launchd) | 最优 |
|---------|----------------|-----------------|----------------|------|
| **进程隔离与权限边界** | SwiftUI 主进程权限低于 Electron，但 Companion 仍是完整 Node.js | Electron 主进程 = 完整 Node.js，权限边界最弱 | launchd 管理独立进程，权限边界清晰 | **C** |
| **网络攻击面** | WebSocket 127.0.0.1 + 可选 Native Messaging | WebSocket 127.0.0.1，无新增网络面 | WebSocket 127.0.0.1，无新增网络面 | **B/C 持平** |
| **代码完整性** | `pkg` 二进制难以逐字节校验，签名仅覆盖外层 | electron-builder 签名较成熟，但 Electron 本身 TCB 巨大 | 无新增打包层，Companion 保持原样 | **C** |
| **敏感数据保护** | 与现状相同，未引入 Keychain | 与现状相同，Electron 主进程可读取所有数据 | 与现状相同，无额外进程访问数据 | **C（攻击面最小）** |
| **开机自启安全** | SMAppService 系统级，用户可见 | `node-auto-launch` 封装不透明，维护滞后 | launchd plist 透明可控，用户可手动检查 | **C** |
| **供应链安全** | 双栈（Swift + TS），`pkg` 预编译运行时 | Electron + npm + `node-auto-launch`，依赖树庞大 | 仅新增 `node-notifier`，改动最小 | **C** |
| **崩溃恢复/孤儿进程** | Swift 进程管理器可监控 Companion | Electron 崩溃可能导致孤儿进程 | launchd `KeepAlive` 自动重启，最可靠 | **C** |
| **审计与可观测性** | 新增 Swift 层日志，需统一格式 | 新增 Electron 层日志，需统一格式 | 统一在 Companion 日志中，最简洁 | **C** |

### 详细分析

#### 为什么方案C 最安全？

1. **最小可信计算基（MinTCB）**: 方案C 没有引入任何新的重型运行时。Companion 保持为独立的 Node.js 进程，`node-notifier` 是唯一新增依赖，且可被替换为纯 AppleScript 调用。相比之下，方案A 引入 `pkg` 预编译运行时（不可审计的 ~50MB 二进制），方案B 引入整个 Electron 框架（~150MB，含 Chromium + Node.js）。

2. **系统级进程管理**: `launchd` 是 macOS 原生的进程管理器，具备：
   - 崩溃自动重启（`KeepAlive`）
   - 资源限制（`HardResourceLimits`）
   - 日志轮转（`StandardOutPath` / `StandardErrorPath`）
   - 用户可手动检查和控制（`launchctl list` / `launchctl unload`）

   方案A 的 SMAppService 仅管理 SwiftUI 应用本身，不直接管理 Companion 进程；方案B 的 `node-auto-launch` 是用户空间库，不具备系统级恢复能力。

3. **无新增网络攻击面**: 方案C 没有引入 Native Messaging（方案A 可选）、没有 Electron 的远程更新通道（方案B 的 `electron-updater`）。WebSocket 仍绑定 `127.0.0.1:23401`，与现状完全一致。

4. **透明的持久化机制**: `~/Library/LaunchAgents/com.cmspark.companion.plist` 是纯文本文件，用户可随时查看和修改。相比之下，SMAppService 的注册信息存储在系统数据库中，普通用户难以审计；`node-auto-launch` 的 Login Item 注册对用户完全透明。

#### 方案A 的安全优势与劣势

**优势**:
- SwiftUI 应用本身内存占用低（~30MB），比 Electron 主进程更轻量
- SMAppService 是 Apple 推荐的开机自启方式，比 `node-auto-launch` 更规范
- 原生代码签名和公证流程成熟

**劣势**:
- `pkg` 打包引入不可审计的预编译 Node.js 运行时
- Native Messaging 若启用，攻击面显著扩大
- 双技术栈增加供应链风险
- 13.5 人天的开发周期意味着更多代码 = 更多漏洞

#### 方案B 的安全劣势最突出

**核心问题**: Electron 主进程是一个**完整的高权限 Node.js 运行时**，而菜单栏应用根本不需要这种能力。

- Electron 的 TCB 包含 V8、Chromium、Node.js、系统原生 API 绑定，任何组件的漏洞都可被利用
- `node-auto-launch` 的维护状态堪忧（最后更新 2017 年）
- 自动更新机制（`electron-updater`）历史上多次出现安全漏洞
- 双 Node 运行时（Electron 内置 Node + Companion Node）意味着双倍的供应链风险

### 结论与建议

**安全排序: C > A > B**

| 方案 | 安全评分 | 适用场景 |
|------|---------|---------|
| **C（保守）** | **7/10** | **当前阶段推荐** — 安全稳定化 MVP 阶段，优先保障安全性，接受稍低的用户体验 |
| A（激进） | 6/10 | 未来阶段 — 当团队具备 Swift 安全审计能力、且能解决 `pkg` 完整性校验后 |
| B（折中） | 5/10 | 不推荐 — Electron 的 TCB 与菜单栏需求严重不匹配，安全风险大于便利性收益 |

**最终建议**:

1. **当前阶段采用方案C**，并实施上述缓解措施（尤其是 PID 文件改为 UDS 锁、`terminal-notifier` 完整性校验）
2. **方案A 可作为中长期目标**，但必须在实施前解决：
   - `pkg` 打包产物的完整性校验机制
   - 禁用或严格限制 Native Messaging
   - Swift 层代码的安全审计
3. **方案B 不建议采用**，除非团队愿意接受 Electron 的安全模型，并投入额外资源进行主进程沙箱化

---

## 附录：关键安全检查清单

无论选择哪个方案，以下检查项必须落实：

- [ ] WebSocket 始终绑定 `127.0.0.1`，禁止 `0.0.0.0`
- [ ] `~/.cmspark-agent/` 目录权限设置为 `0700`
- [ ] 日志中的 API key、Cookie、URL 参数已脱敏
- [ ] 开机自启项在系统设置中可见，用户可手动禁用
- [ ] 所有新增依赖在 CI 中校验 SHA256
- [ ] 发布产物提供 SHA256 校验和与 SBOM
- [ ] 崩溃后 Companion 不会以孤儿进程常驻
- [ ] 恶意扩展无法通过任何通道（WS/Native Messaging/IPC）操控 Companion
