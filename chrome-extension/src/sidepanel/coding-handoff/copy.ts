// 编程接力 — user-visible copy (§5.7.6 UX Consistency Contract).
// Components must import from here; no ad-hoc Chinese strings in UI chrome.

export const codingHandoffCopy = {
  productName: "编程接力",
  productBlurb:
    "侧栏监视 + 可选本机终端完整交互：在侧栏跑本机编程助手（Claude Code / Grok / Kimi / OpenCode / Pi 等）看时间线与确认；需要完整 TUI/权限时可开模式 C 本机终端。",
  outboundContrast:
    "对照：若要让本机编程 Agent 使用已登录浏览器 → 设置中的 Outbound MCP，不是本面板。",

  // CTAs
  ctaCopy: "改为复制任务包到终端（备选）",
  ctaOpenTerminal: "复制任务包",
  ctaHandoff: "打开编程接力",
  ctaToCoding: "打开编程接力",
  ctaContinueSidebar: "继续在侧栏",
  ctaBindWorkspace: "选择工作区",
  ctaCancel: "取消",
  ctaClose: "关闭",
  ctaStart: "启动",
  ctaStopSession: "停止编程会话",
  /** Mode C: side-panel stop only ends the monitor bridge */
  ctaStopMonitorSession: "停止监视会话",
  ctaStopMonitorTitle:
    "仅结束侧栏监视桥；本机 Terminal 内 Agent 需在终端自行退出",
  ctaMuteThread: "不再提示本对话",
  ctaOpenSettings: "打开设置 · 编程助手",
  ctaRetry: "重试",

  /** Sticky banner when Mode C (local terminal) is active or was opened */
  modeCDualProcessBanner:
    "侧栏停止仅结束监视桥；本机 Terminal 内 Agent 需在终端自行退出。",

  // Modes (never “只读” as OS sandbox claim)
  modeReview: "审查",
  modeDraft: "起草",
  modeFootnote:
    "会话模式 = 任务意图，≠ 外部进程权限担保。外部 Agent 作为独立进程仍可能写盘；CMspark 不承诺沙箱隔离。",

  // Offer / package
  offerTitle: "编程助手",
  offerBody: "这类改代码任务更适合本机 Agent。",
  packageTitle: "编程接力 · 任务包",
  packageHint: "将复制到剪贴板；写码在外部助手完成。",
  summaryLabel: "任务摘要",
  includeDialog: "对话摘要",
  includeUrl: "当前页 URL/标题",
  includePageExcerpt: "页面正文摘录",
  workspaceMissingTitle: "先绑定代码工作区",
  workspaceMissingBody:
    "编程接力需要明确的项目目录。真实修 bug 请绑定仓库；试写可用场景面板中的默认沙箱说明。",
  privacyLine: "页面摘要与仓库路径将进入任务包；粘贴到外部 Agent 后可能再上云模型。",

  // Toasts / status
  copiedOk: "已复制编程任务包 — 可粘贴到 Claude Code / Grok / Kimi / OpenCode / 终端助手",
  copiedAndTerminal:
    "已复制任务包，并尝试打开终端。若终端未出现，请手动粘贴。",
  terminalFailed: "已复制任务包（终端未能打开，请手动粘贴）",
  clipboardFailed: "无法写入剪贴板 — 请全选下方文本手动复制",
  pasteBackHint: "可选：把外部助手摘要或 PR 链接贴回此处，写入对话",
  pasteBackCta: "写入对话",
  pasteBackOk: "已写入对话注记",

  // Settings
  settingsTitle: "编程助手",
  settingsAutoSuggest: "自动建议编程接力（Offer）",
  settingsAcpEnabled: "启用 ACP 会话（实验 · 默认关）",
  settingsAcpHint:
    "开启后可用本机 ACP 兼容 Agent 做审查 / 起草会话。默认关闭；启动仍需确认。",
  settingsOpenLocalTerminal: "启动时同时打开本机终端（模式 C · 默认关）",
  settingsOpenLocalTerminalHint:
    "侧栏保留监视桥；本机终端再开交互式 Agent（完整 TUI/权限）。两进程，v1 不是同一会话。失败时侧栏仍继续。",
  /** Which host terminal app (Mode C). */
  settingsLocalTerminalApp: "本机终端应用",
  settingsLocalTerminalAppHint:
    "默认「系统自动」：Windows 用「开始」打开控制台（有安装则再试 Windows Terminal）；macOS 用 Terminal.app；Linux 用 $TERMINAL 或常见模拟器。可改 Windows Terminal / cmd、iTerm / Warp / Alacritty 等；Warp 可能需手动粘贴任务命令。",
  /** Panel mirror of Mode C setting (same config key). */
  panelOpenLocalTerminal: "启动时打开本机终端（模式 C）",

  /** CLI bridge is one-shot; multi-turn composer disabled with this reason. */
  cliComposerDisabled:
    "CLI 为一次性桥接，侧栏不可多轮发送。请用本机终端交互，或等待 Agent 支持 ACP 协议会话。",
  cliComposerPlaceholder: "CLI 一次性会话 — 请用本机终端继续",
  acpComposerPlaceholder: "继续对编程助手说…（侧栏监视）",

  // Phase B
  spawnTitle: "启动编程助手",
  spawnRisk: "将启动本机编程 Agent（可能修改文件，取决于外部 Agent）",
  sessionRunning: "编程助手运行中",
  sessionDone: "编程会话完成",
  sessionStopped: "已停止编程会话",
  statusRunning: "运行中",
  statusDone: "完成",
  disclosureRequired: "请先确认：代码/页面摘要可能发送到该 Agent 的云模型",
  ctaFollowup: "追问",
  ctaApplyDiff: "应用 diff",
  ctaStartReview: "在本面板启动 · 审查",
  ctaStartDraft: "在本面板启动 · 起草",
  ctaEnableAndStart: "启用并在本面板启动",
  rediscover: "重新检测本机编程助手",
  adoptConfig: "将检测结果写入 config（持久化）",
  modeReviewOption: "审查（只读意图）",
  modeDraftOption: "起草修改",
  /** Live chip badge: 审查 / 起草 */
  modeBadgeReview: "审查",
  modeBadgeDraft: "起草",
  /** Checkbox before ACP start (cloud disclosure) */
  disclosureCheckbox: "我知悉：代码/页面摘要可能发送到该 Agent 的云模型",
  disclosureBlocked: "请先勾选云模型披露确认",

  // Discovery status (settings + panel)
  discoveredTitle: "本机已检测到",
  discoveredEmpty:
    "未在 PATH / 常见安装路径找到 claude · gemini · codex · pi · grok · kimi · opencode。安装后点「重新检测」，或把绝对路径写入 config.acp.servers。Windows 会忽略 npm 的 Unix shebang 垫片（无扩展的 claude 脚本），需要同目录的 .cmd / .exe。",
  discoveredNeedEnable:
    "首次启动会自动开启本机 Agent 会话能力（仍会弹确认）。之后输入与输出都在本面板。",
  rediscoverHint: "检测与总开关无关：未启用时仍会列出本机已安装助手。",
  firstRunNote: "点下方启动即可在侧栏运行本机 Agent；复制任务包只是没有本机 Agent 时的备选。",

  // Errors
  agentNotFound: "找不到编程助手",
  agentNotFoundBody: "请安装 Claude Code / Grok / Kimi / OpenCode 等，并在设置中确认路径。",
  agentNotLoggedIn: "需要先登录",
  authExpired: "登录已过期",
  pathDenied: "路径被拒绝",
  agentCrash: "编程助手异常退出",
  timeout: "等待超时",
  spawnFailed: "无法启动",
  sessionBusy: "已有编程会话在跑",
  acpDisabled: "正在启用本机 Agent 会话…",
} as const

export type CodingHandoffCopyKey = keyof typeof codingHandoffCopy
