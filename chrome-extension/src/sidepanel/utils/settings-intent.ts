/**
 * Lightweight NL intents for configuring CMspark via text / voice in Settings.
 * Pure — no side effects. Keep phrases Chinese-first + a few English aliases.
 */

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

export const SETTINGS_INTENT_HELP =
  "可说/输入：开启连续听写 · 开启实时出字 · 浏览器听写 · 本机听写 · 开启按住说话 · 开启纠错 · 打开会议 · 打开场景"
