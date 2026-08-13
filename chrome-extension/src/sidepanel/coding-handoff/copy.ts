// 编程接力 — user-visible copy (§5.7.6 UX Consistency Contract).
// Components must import from here; no ad-hoc Chinese strings in UI chrome.

export const codingHandoffCopy = {
  productName: "编程接力",
  productBlurb:
    "把当前页与对话证据打包，交给本机终端编程助手（Claude Code / Gemini CLI 等）。写码在外部完成；浏览器仍归 CMspark。",
  outboundContrast:
    "对照：若要让本机编程 Agent 使用已登录浏览器 → 设置中的 Outbound MCP，不是编程接力。",

  // CTAs
  ctaCopy: "复制编程任务包",
  ctaOpenTerminal: "复制任务包",
  ctaHandoff: "派给终端助手",
  ctaToCoding: "交给编程助手",
  ctaContinueSidebar: "继续在侧栏",
  ctaBindWorkspace: "选择工作区",
  ctaCancel: "取消",
  ctaClose: "关闭",
  ctaStart: "启动",
  ctaStopSession: "停止编程会话",
  ctaMuteThread: "不再提示本对话",
  ctaOpenSettings: "打开设置 · 编程助手",
  ctaRetry: "重试",

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
  copiedOk: "已复制编程任务包 — 可粘贴到 Claude Code / Gemini CLI / 终端助手",
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
  ctaStartReview: "启动 · 审查",
  ctaStartDraft: "启动 · 起草",
  rediscover: "重新检测本机编程助手",
  adoptConfig: "将检测结果写入 config（持久化）",
  modeReviewOption: "审查",
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
    "未在 PATH / 常见安装路径找到 claude · gemini · codex · pi。安装后点「重新检测」，或把绝对路径写入 config.acp.servers。",
  discoveredNeedEnable: "已检测到本机助手；请先勾选上方「启用 ACP 会话」再启动。",
  rediscoverHint: "检测与「启用 ACP」无关：未启用时仍会列出本机已安装助手。",

  // Errors
  agentNotFound: "找不到编程助手",
  agentNotFoundBody: "请安装 Claude Code / Gemini CLI 等，并在设置中确认路径。",
  agentNotLoggedIn: "需要先登录",
  authExpired: "登录已过期",
  pathDenied: "路径被拒绝",
  agentCrash: "编程助手异常退出",
  timeout: "等待超时",
  spawnFailed: "无法启动",
  sessionBusy: "已有编程会话在跑",
  acpDisabled: "ACP 会话未启用（设置 → 编程助手）",
} as const

export type CodingHandoffCopyKey = keyof typeof codingHandoffCopy
