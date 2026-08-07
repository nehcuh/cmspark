/**
 * Web Speech error → user-facing zh copy (SoT §6.6).
 * Pure; no DOM. Optional userAgent for OS-specific mic privacy path (S52 N6).
 */

export type VoiceUserFacing = {
  /** Compact caption under composer / spike log */
  message: string
  /** silent = no UI toast (aborted by user/system) */
  severity: "info" | "error" | "silent"
}

/**
 * OS-aware mic privacy settings hint (shared with voice-permission tab).
 * Pure: pass userAgent string; no navigator access inside.
 */
export function osMicPrivacyHint(userAgent?: string): string {
  const ua = userAgent || ""
  if (/Windows/i.test(ua)) return "Windows「设置 → 隐私和安全性 → 麦克风」"
  if (/Mac|iPhone|iPad|iPod/i.test(ua)) return "macOS「系统设置 → 隐私与安全性 → 麦克风」"
  return "系统麦克风隐私设置"
}

export type MapSpeechErrorOpts = {
  /** navigator.userAgent (or test double) for OS-specific not-allowed copy */
  userAgent?: string
}

/**
 * Map SpeechRecognitionErrorEvent.error codes (+ synthetic codes we invent).
 * https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionErrorEvent/error
 */
export function mapSpeechError(code: string, opts?: MapSpeechErrorOpts): VoiceUserFacing {
  const c = (code || "").toLowerCase()
  switch (c) {
    case "not-allowed":
    case "service-not-allowed": {
      const osHint = osMicPrivacyHint(opts?.userAgent)
      return {
        severity: "error",
        message: `无法使用麦克风：请在 Chrome 站点设置与 ${osHint} 中允许本扩展 / Chrome`,
      }
    }
    case "no-speech":
      return { severity: "info", message: "未识别到内容" }
    case "network":
      return {
        severity: "error",
        message: "语音识别需要网络（或本机语言包）；请检查网络后重试",
      }
    case "aborted":
      return { severity: "silent", message: "" }
    case "audio-capture":
      return {
        severity: "error",
        message: "无法捕获麦克风音频，请检查设备是否被占用",
      }
    case "bad-grammar":
    case "language-not-supported":
      return {
        severity: "error",
        message: "当前语言语音识别不可用，请改用系统听写或键入",
      }
    case "timeout":
      return {
        severity: "info",
        message: "已达单次听写上限，文字已保留在输入框",
      }
    case "offline":
      return {
        severity: "error",
        message: "语音识别需要网络（或本机语言包）；请检查网络后重试",
      }
    case "empty":
      return { severity: "info", message: "未识别到内容" }
    default:
      return {
        severity: "error",
        message: code ? `语音识别错误：${code}` : "语音识别失败",
      }
  }
}

/**
 * Path B local STT error → user-facing zh copy (SoT §6.5).
 * severity banner = show under composer; silent = no UI toast (user/system abort).
 */
export type LocalSttUserFacing = {
  message: string
  severity: "banner" | "silent"
}

/** Map Companion / local-adapter error codes for engine=local. */
export function mapLocalSttError(code: string): LocalSttUserFacing {
  const c = (code || "").toLowerCase()
  switch (c) {
    case "empty_result":
      return { severity: "banner", message: "未识别到内容，请重试" }
    case "model_missing":
      return { severity: "banner", message: "本机模型未就绪，请先在设置下载" }
    case "binary_missing":
      return { severity: "banner", message: "本机听写组件不可用，请更新 Companion" }
    case "hash_fail":
      return { severity: "banner", message: "本机听写组件校验失败，请重装 Companion" }
    case "companion_disconnected":
      return { severity: "banner", message: "Companion 未连接，本机转写不可用" }
    case "session_busy":
      return { severity: "banner", message: "正在识别，请稍候或取消" }
    case "payload_too_large":
      return { severity: "banner", message: "录音过长或数据异常" }
    case "infer_timeout":
      return { severity: "banner", message: "识别超时，请缩短后重试" }
    case "resource_conflict":
    case "oom":
      return { severity: "banner", message: "本机资源不足（可关闭实验模型后重试）" }
    case "aborted":
      return { severity: "silent", message: "" }
    default:
      return {
        severity: "banner",
        message: code ? `本机转写错误：${code}` : "本机转写失败",
      }
  }
}

/** Hide vs disable decision for mic chrome (SoT §7.2 subset). */
export type MicChrome =
  | { show: false; reason: "disabled_setting" | "unsupported" | "non_tier1" }
  | { show: true; enabled: true }
  | { show: true; enabled: false; reason: "permission_denied" | "offline" | "thread_busy" }

export function resolveMicChrome(input: {
  voiceInputEnabled: boolean
  speechSupported: boolean
  tier1Chrome: boolean
  /** enforce tier-1 hide policy */
  enforceTier1?: boolean
  permissionState?: "granted" | "denied" | "prompt" | "unknown"
  online?: boolean
  threadBusy?: boolean
}): MicChrome {
  if (!input.voiceInputEnabled) return { show: false, reason: "disabled_setting" }
  if (!input.speechSupported) return { show: false, reason: "unsupported" }
  if (input.enforceTier1 && !input.tier1Chrome) return { show: false, reason: "non_tier1" }
  if (input.threadBusy) return { show: true, enabled: false, reason: "thread_busy" }
  if (input.permissionState === "denied") {
    return { show: true, enabled: false, reason: "permission_denied" }
  }
  if (input.online === false) {
    return { show: true, enabled: false, reason: "offline" }
  }
  return { show: true, enabled: true }
}
