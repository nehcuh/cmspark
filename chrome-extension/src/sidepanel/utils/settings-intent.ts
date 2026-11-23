/**
 * Lightweight NL intents for configuring CMspark via text / voice in Settings.
 * Pure — no side effects. Keep phrases Chinese-first + a few English aliases.
 */
import { SETTINGS_DESTINATIONS } from "./settings-navigation"

export type SettingsIntent =
  | { type: "set_dictation_mode"; mode: "classic" | "continuous" }
  | { type: "set_hotkey_enabled"; enabled: boolean }
  | { type: "set_asr_refiner"; enabled: boolean }
  | { type: "set_stt_engine"; engine: "browser" | "local" }
  | { type: "set_realtime_streaming"; enabled: boolean }
  | { type: "open_meeting" }
  | { type: "open_packs" }
  | { type: "enable_hotkey_default" }
  | { type: "unknown"; reason: string }

export type ReasoningDisplay = "always_collapsed" | "auto_live" | "always_open"
export const REASONING_DISPLAY_STORAGE_KEY = "cmspark.ui.show_reasoning"
export const REASONING_DISPLAY_NAMES: Record<ReasoningDisplay, string> = {
  always_collapsed: "默认折叠",
  auto_live: "仅推理时展开",
  always_open: "始终展开",
}

const LOCAL_SETTINGS_SEARCH = [
  { destination: "model-profiles", label: "已连接的模型服务", aliases: ["模型", "模型配置", "添加模型", "模型服务", "api key", "服务地址"] },
  { destination: "model-chat", label: "默认对话模型、输出上限与思考强度", aliases: ["思考强度", "默认模型", "对话模型", "单次输出上限", "输出上限", "输出预算", "上下文"] },
  { destination: "model-vision", label: "看图模型", aliases: ["看图", "看图模型", "视觉模型"] },
  { destination: "model-meeting-transcribe", label: "会议转写", aliases: ["会议转写", "会议外部转写", "会议录音识别"] },
  { destination: "model-meeting-visual", label: "会议画面理解", aliases: ["会议画面", "会议截图模型"] },
  { destination: "model-meeting-minutes", label: "会议纪要模型", aliases: ["纪要模型", "会议纪要模型", "摘要模型"] },
  { destination: "model-local", label: "本机模型", aliases: ["本机模型", "下载模型", "whisper", "本机视觉"] },
  { destination: "input-dictation-engine", label: "聊天听写引擎", aliases: ["听写引擎", "外部转写", "语音识别"] },
  { destination: "input-asr-refiner", label: "听写后纠错", aliases: ["语音纠错", "听写后纠错", "asr纠错"] },
  { destination: "input-display", label: "思考过程显示", aliases: ["思考过程", "思考过程显示", "显示思考过程", "回复显示"] },
  { destination: "input-shortcuts", label: "键盘与快捷键", aliases: ["快捷键", "发送键", "按住说话"] },
  { destination: "data-files", label: "附件限制", aliases: ["附件", "文件大小", "上传限制"] },
  { destination: "data-knowledge", label: "知识使用", aliases: ["知识", "知识范围", "知识匹配"] },
  { destination: "data-index", label: "会话索引和摘要", aliases: ["会话索引", "后台摘要"] },
  { destination: "data-archive", label: "历史保留", aliases: ["历史", "保留天数", "归档"] },
  { destination: "data-notes", label: "导出和笔记", aliases: ["导出", "笔记", "obsidian"] },
  { destination: "privacy-trust", label: "站点权限与信任", aliases: ["权限", "站点权限", "信任域", "自动批准"] },
  { destination: "privacy-activity", label: "数据发送与采集", aliases: ["数据发送", "外发", "数据采集", "站点统计"] },
  { destination: "tools-mcp", label: "MCP 工具", aliases: ["mcp", "mcp工具"] },
  { destination: "tools-capabilities", label: "本机工具和能力档", aliases: ["shell", "能力档", "本机工具"] },
  { destination: "tools-coding", label: "编程助手", aliases: ["编程助手", "代码助手"] },
  { destination: "connection-pairing", label: "Companion 连接与配对", aliases: ["配对", "连接", "companion"] },
  { destination: "connection-maintenance", label: "诊断与维护", aliases: ["日志", "诊断", "版本"] },
]

export type LocalSettingsIntent =
  | { type: "search"; destination: string; label: string }
  | { type: "reasoning_display"; mode: ReasoningDisplay }
  | { type: "manual_knowledge" }

/** Exact actions use local rules. Other sentences go through validated semantic proposals. */
export function localSettingsIntent(raw: string): LocalSettingsIntent | null {
  const command = raw.trim().toLowerCase().replace(/[。！？?!]$/, "")
  if (/^(?:请\s*)?(?:把)?思考过程(?:收起来|折叠|默认折叠)$/.test(command)) {
    return { type: "reasoning_display", mode: "always_collapsed" }
  }
  if (/^(?:请\s*)?(?:把)?思考过程(?:始终展开|一直展开)$/.test(command)) {
    return { type: "reasoning_display", mode: "always_open" }
  }
  if (/^(?:请\s*)?(?:把)?思考过程(?:仅推理时展开|恢复默认)$/.test(command)) {
    return { type: "reasoning_display", mode: "auto_live" }
  }
  if (/^(?:请\s*)?(?:这次对话|当前对话|这个对话)(?:(?:别|不要|不再)自动(?:带入?|加上?)(?:不相关的)?知识|只用(?:已)?勾选(?:的)?知识)$/.test(command)) {
    return { type: "manual_knowledge" }
  }
  const query = command.replace(/^(?:搜索|查找|打开|查看)\s*/, "").replace(/(?:在哪里|在哪|怎么设置)$/, "").trim()
  const destination = Object.entries(SETTINGS_DESTINATIONS).find(([, item]) => item.title.toLowerCase() === query)
  if (destination) return { type: "search", destination: destination[0], label: destination[1].title }
  const result = LOCAL_SETTINGS_SEARCH.find(item => item.aliases.includes(query))
  return result ? { type: "search", destination: result.destination, label: result.label } : null
}

function norm(s: string): string {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[。.!！?？,，]/g, "")
}

/**
 * Parse a short command into a settings intent.
 * Returns `unknown` when no rule matches (caller may show help).
 */
export function parseSettingsIntent(raw: string): SettingsIntent {
  const t = norm(raw)
  if (!t) return { type: "unknown", reason: "empty" }

  if (
    /打开会议|会议工作台|会议纪要|openmeeting|meetingworkbench/.test(t) ||
    t === "会议" ||
    t === "meeting"
  ) {
    return { type: "open_meeting" }
  }
  if (/打开场景|场景面板|装配场景|openpacks|openscenes/.test(t)) {
    return { type: "open_packs" }
  }

  if (
    /开启连续听写|打开连续听写|启用连续听写|连续听写开|开启听写\+|打开听写\+|enablecontinuous|continuouson/.test(
      t,
    )
  ) {
    return { type: "set_dictation_mode", mode: "continuous" }
  }
  if (
    /关闭连续听写|经典短听|短听写|classic听写|disablecontinuous|continuousoff|经典模式/.test(t)
  ) {
    return { type: "set_dictation_mode", mode: "classic" }
  }

  if (
    /开启实时|打开实时|实时出字|字级流式|实时字级|enablerealtime|liveinterim|streamingon/.test(t)
  ) {
    return { type: "set_realtime_streaming", enabled: true }
  }
  if (/关闭实时|关掉实时|disablerealtime|streamingoff/.test(t)) {
    return { type: "set_realtime_streaming", enabled: false }
  }

  if (
    /开启按住|打开按住|启用热键|开启热键|按住说话|holdon|enablehotkey|hotkeyon/.test(t)
  ) {
    return { type: "set_hotkey_enabled", enabled: true }
  }
  if (/关闭按住|关闭热键|关掉热键|holdoff|disablehotkey|hotkeyoff/.test(t)) {
    return { type: "set_hotkey_enabled", enabled: false }
  }
  if (/默认热键|恢复热键|resethotkey/.test(t)) {
    return { type: "enable_hotkey_default" }
  }

  if (/开启纠错|打开纠错|开启asr|启用asr|refineron|enableasr/.test(t)) {
    return { type: "set_asr_refiner", enabled: true }
  }
  if (/关闭纠错|关掉纠错|关闭asr|refineroff|disableasr/.test(t)) {
    return { type: "set_asr_refiner", enabled: false }
  }

  if (/浏览器听写|浏览器识别|云听写|browserstt|usebrowser/.test(t)) {
    return { type: "set_stt_engine", engine: "browser" }
  }
  if (/本机听写|本机识别|本地whisper|localstt|uselocal|本地听写/.test(t)) {
    return { type: "set_stt_engine", engine: "local" }
  }

  return { type: "unknown", reason: "no_match" }
}
