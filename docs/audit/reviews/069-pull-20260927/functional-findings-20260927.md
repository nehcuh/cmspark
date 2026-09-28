# 功能验证发现 — 0.6.9 已安装副本（2026-09-27 23:00 起在本机运行）

操作者在真实安装环境（`C:\Users\HuChen\AppData\Local\CMspark`，`cmspark-agent --version` = v0.6.9，
daemon PID 26792 于 23:00:59 启动，`/outbound-mcp/v1/health` 返回 200）上做了功能验证。
用户手工反馈两个问题，操作者用 **CDP 驱动真实 sidepanel React 应用**（esbuild fixture：
`scripts/render-workspace-fixture.cjs` 产物，真实 `<App/>` + 桩 chrome API）取得 DOM 级证据。

## 发现 A：Windows 上内嵌终端设置入口可交互，但后端必然拒绝（UI/后端不一致）

设置项**存在**（推翻用户「没有设置入口」的判断），位于 设置 →「本机与工具」(integrations)：

实测该页渲染 3 个终端控件（其余 7 个分类页均为 0 个）：
1. 「启动时同时打开本机终端（模式 C · 默认关）」— checkbox，默认 unchecked，可点
2. 「内嵌终端（实验 · 默认关 · 仅 macOS）」— checkbox，默认 unchecked，可点
3. 「本机终端应用」下拉 — 因开关未开而 disabled

实测点击 #2 → `checked: false→true`，发出 `config.set`，「打开内嵌终端」按钮出现。
实测点击「打开内嵌终端」→ 发出 `terminal.open_tab`。
**此时 `navigator.userAgentData.platform === "Windows"`。**

但内嵌终端在 Windows 上有四层 darwin-only 门禁，任一都足以让它失败：

- `chrome-extension/src/sidepanel/components/CodingAgentPanel.tsx:792` — `showEmbedEntry` 要求 `isDarwin()`
- `companion/src/acp/manager.ts:253` — `embedEligible = embedded_terminal?.enabled === true && process.platform === "darwin"`
- `companion/src/acp/open-local-terminal.ts:1222` — `if (platform !== "darwin") return { ok:false, detail:"unsupported" }`
- `companion/src/pty/session.ts:304` — `if (ptyHostPlatform() !== "darwin") return { ok:false, error:"内嵌终端仅支持 macOS（darwin）；Windows/Linux 另票。", code:"unsupported" }`

**问题**：设置页的 #2 开关没有平台门禁（实测在 Windows 上可勾选且不被 disabled），
勾上后还渲染出「打开内嵌终端」按钮并真的发出 `terminal.open_tab`，
但该请求到达 companion 后必被拒为 `unsupported`。
这是一个用户点了必然失败、且 UI 未事先告知的入口。

评审需判断：
- A1 这是否 blocking？（用户可达的必然失败路径）
- A2 设置页是否应按平台 disable/隐藏 #2，或至少标注「本机不可用」？
  注意 `CodingAgentPanel` 已有 `isDarwin()` 门禁，设置页没有 —— 两处门禁不一致。
- A3 文案「仅 macOS」是否构成充分告知？在 checkbox 未 disabled 的前提下。
- A4 Windows 上唯一可用路径是模式 C 外部终端（`openWindowsWithPref`，
  `open-local-terminal.ts:1198` 的 windows opener 有真实实现）。
  核实该路径在 Windows 上确实端到端可用，还是同样有未发现的断点。

## 发现 B：内嵌终端全页 tab 无「回主对话」入口（真实缺陷，同仓库已有可复用模式）

- 内嵌终端是全页 tab：`chrome-extension/src/tabs/embedded-terminal.tsx` → `TerminalApp`
- `chrome-extension/src/terminal/TerminalApp.tsx` 中 `sidePanel` 出现次数 = **0**
- 头部唯一按钮是「关闭」→ `window.close()`（`TerminalApp.tsx:248-252`）
- 其余两个按钮（`:261`、`:264`）属于「代码审阅任务与报告回传」折叠区，与导航无关
- **对比**：同类全页面板 `chrome-extension/src/thread-graph/ThreadGraphApp.tsx` 有 **2 处**
  `chrome.sidePanel.open({ windowId })`（`:335` 及其上下文 `:331-339` 的 tabs.query 模式）

即：知识图谱面板**有**回主对话实现，内嵌终端面板**没有**，现成模式就在隔壁未被复用。
用户进入内嵌终端后只能关标签页，无任何入口把侧栏拉回，打断交互流。

评审需判断：
- B1 这是否 blocking？
- B2 是否应直接复用 `ThreadGraphApp` 的 `chrome.tabs.query` + `chrome.sidePanel.open` 模式？
- B3 发现 B 在 Windows 上当前不可达（因发现 A 的门禁），但在 macOS 上是真实问题。
  严重性应如何定级？不要因为 Windows 不可达就降级。

## 操作者自纠：一条先前结论已作废，请勿采信

操作者先前判断「内嵌终端设置项是 0.6.9 新增的」——**该结论无效，已作废**。
根因：仓库不存在 `v0.6.8` tag（`git tag` 仅有 `computer-use-w8-snapshot`、`v0.3.0`、`v0.4.0`、`v0.6.9`），
`git show v0.6.8:...` 静默失败，其空输出被 `grep -c` 读成 0，误判为「0.6.8 无此项」。

用真实提交重核（请勿重复这个错误，用 commit hash 不用 tag）：
- `59931595`（0.6.8 对应的旧 main HEAD）：`CodingHandoffSettingsSection.tsx` 中 `embeddedTerminal` 出现 **4** 次
- `b5a7396a`（0.6.9 当前 main HEAD）：同样 **4** 次
- `01601109`（feat(terminal): #432 内嵌终端 ext 半边，2026-09-06）**是** `59931595` 的祖先

结论：该设置项在 0.6.8 就已存在，**不是**本次拉取批次引入。

评审需独立复核这一自纠是否成立 —— 如果操作者的更正本身也是错的，直接指出。

## 环境事实（供评审复现）

- 已安装：`C:\Users\HuChen\AppData\Local\CMspark`，`node.exe cmspark-agent.js --version` → `cmspark-agent v0.6.9`
- daemon 运行中，`daemon status` → PID 26792，`ws://127.0.0.1:23401`
- `curl http://127.0.0.1:23401/outbound-mcp/v1/health` → 200 `{"status":"ok","runner":"wired","service":"outbound-mcp","require_grant":false}`
- 用户 Chrome（Default profile）加载的扩展路径：`C:\Users\HuChen\AppData\Local\CMspark\chrome-extension`（ID `mjjheobfcodjhdnngikfokbenghlkjpo`）
- Profile 1 加载的是**另一个**副本：`C:\Users\HuChen\Projects\cmspark\dist-package\cmspark-windows-x64\chrome-extension`（ID `ddmijppddlpidmimkhhgplcajhifbmik`）
  —— 两个 profile 加载不同路径的副本，评审应确认这是否构成发布/验证风险
- 两处副本的 `sidepanel.b7741352.js` 大小与 mtime 完全一致（1357026 字节，22:54），均为本次构建产物
- Chrome 153.0.8010.53 对正式版**忽略** `--load-extension`（实测：临时 profile 里只出现 Chrome 内置扩展
  `fignfifoniblkonapihmkfakmlgkbkcf` = "Google Network Speech"，我们的扩展未加载），
  因此功能验证走的是 esbuild fixture + CDP，而非真实扩展上下文。
  **这意味着发现 A/B 的 DOM 证据来自 fixture 渲染的真实组件树，但未经过真实扩展权限/背景页链路。**
  评审应把这一点当作证据边界，不要当成端到端证明。
