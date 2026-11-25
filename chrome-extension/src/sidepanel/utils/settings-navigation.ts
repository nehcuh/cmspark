import type { SettingsSectionId } from "./settings-sections"

export const SETTINGS_CATEGORIES = {
  models: { title: "模型与服务", description: "对话、视觉、语音、会议与后台任务" },
  input: { title: "输入与交互", description: "发送键、听写、识别引擎与思考过程显示" },
  data: { title: "数据与知识", description: "附件、知识使用、会话索引、归档与笔记导出" },
  privacy: { title: "隐私与权限", description: "活动采集、安全规则、授权与密钥" },
  tools: { title: "工具与集成", description: "本机能力、网络、MCP 与编程接力" },
  connection: { title: "连接与维护", description: "Companion 配对、连接状态与升级" },
} as const

export type SettingsCategoryId = keyof typeof SETTINGS_CATEGORIES

export const SETTINGS_DESTINATIONS = {
  "model-chat": { category: "models", section: "model", title: "对话模型", description: "文本模型、服务地址与推理预算" },
  "model-vision": { category: "models", section: "model", title: "看图与截图", description: "截图分析、独立视觉服务与降级策略" },
  "model-meeting-transcribe": { category: "models", section: "model", title: "会议转写", description: "本机转写与导入音频的外部转写服务" },
  "model-meeting-visual": { category: "models", section: "model", title: "会议画面理解", description: "选择识别会议截图的模型服务" },
  "model-meeting-minutes": { category: "models", section: "model", title: "会议纪要", description: "继承对话模型或指定文本模型" },
  "model-activity": { category: "models", section: "model", title: "活动提取", description: "活动记录的 OCR、视觉与本机模型" },
  "model-local": { category: "models", section: "experimental", title: "本机模型", description: "本地视觉定位的下载、许可与启用" },
  "model-background": { category: "models", section: "model", title: "后台任务", description: "对话压缩、会话要点与标签提取" },
  "model-profiles": { category: "models", section: "model", title: "文本模型配置", description: "保存、命名并复用文本模型连接" },
  "input-shortcuts": { category: "input", section: "voice", title: "发送与听写快捷键", description: "发送键及按住说话的组合键" },
  "input-dictation": { category: "input", section: "voice", title: "聊天听写", description: "麦克风、实时出字与听写方式" },
  "input-dictation-engine": { category: "input", section: "voice", title: "听写引擎", description: "浏览器、系统、本机模型与外部服务" },
  "input-asr-refiner": { category: "input", section: "voice", title: "听写纠错", description: "用当前对话模型校正转写文本" },
  "input-display": { category: "input", section: "voice", title: "思考过程展示", description: "在聊天界面中何时展开思考过程" },
  "data-knowledge": { category: "data", section: "export", title: "知识使用", description: "核对当前对话使用哪些知识以及如何选用" },
  "data-files": { category: "data", section: "export", title: "文件上传", description: "附件大小、文本容量与图片分析" },
  "data-index": { category: "data", section: "export", title: "会话索引", description: "自动提取标签与要点，以及运行上限" },
  "data-archive": { category: "data", section: "export", title: "对话归档", description: "控制会话中保存的工具操作记录" },
  "data-notes": { category: "data", section: "export", title: "笔记导出", description: "Markdown 导出、思考过程与笔记库" },
  "privacy-autonomy": { category: "privacy", section: "security", title: "运行自主度", description: "核对各档位的权限和操作确认规则" },
  "privacy-trust": { category: "privacy", section: "security", title: "信任规则与审计", description: "信任域、自动批准、协议解锁与日志" },
  "privacy-activity": { category: "privacy", section: "security", title: "活动与站点统计", description: "活动采集范围、站点统计与保留规则" },
  "privacy-secrets": { category: "privacy", section: "secrets", title: "密钥与环境", description: "管理工具使用的密钥和环境变量" },
  "tools-capabilities": { category: "tools", section: "integrations", title: "本机能力", description: "场景、本机工具、电源与工作区限制" },
  "tools-network": { category: "tools", section: "integrations", title: "网络授权", description: "网络与扫描工具的适用范围" },
  "tools-mcp": { category: "tools", section: "integrations", title: "出站 MCP 授权", description: "管理本机工具经 MCP 对外提供的授权" },
  "tools-desktop": { category: "tools", section: "integrations", title: "桌面操作", description: "macOS 与 Windows 原生应用授权和主模型看图" },
  "tools-coding": { category: "tools", section: "integrations", title: "编程接力", description: "编程助手、终端及并发设置" },
  "connection-pairing": { category: "connection", section: "connection", title: "配对 Companion", description: "使用本机密钥建立鉴权连接" },
  "connection-maintenance": { category: "connection", section: "connection", title: "连接状态与升级", description: "查看连接状态与配置版本" },
} as const satisfies Record<string, { category: SettingsCategoryId; section: SettingsSectionId; title: string; description: string }>

export type SettingsDestinationId = keyof typeof SETTINGS_DESTINATIONS

const legacyDestinations = {
  connection: "connection-pairing",
  model: "model-chat",
  voice: "input-dictation",
  secrets: "privacy-secrets",
  security: "privacy-autonomy",
  integrations: "tools-capabilities",
  export: "data-files",
  experimental: "model-local",
} as const satisfies Record<SettingsSectionId, SettingsDestinationId>

export function resolveSettingsDestination(id: string): SettingsDestinationId | undefined {
  if (Object.hasOwn(SETTINGS_DESTINATIONS, id)) return id as SettingsDestinationId
  return Object.hasOwn(legacyDestinations, id) ? legacyDestinations[id as SettingsSectionId] : undefined
}

export function modelEndpointLabel(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const endpoint = new URL(value)
    return endpoint.protocol === "http:" || endpoint.protocol === "https:" ? endpoint.host : undefined
  } catch {
    return undefined
  }
}
