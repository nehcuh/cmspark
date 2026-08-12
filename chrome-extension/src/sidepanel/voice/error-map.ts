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
    case "continuous-timeout":
      return {
        severity: "info",
        message: "已达连续听写上限，文字已保留在输入框",
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
      return {
        severity: "banner",
        message:
          "本机听写组件（cmspark-whisper）未找到。请在设置页点「安装本机听写组件」（macOS 需 brew whisper-cpp 或安装包内置），或暂时改用浏览器听写",
      }
    case "hash_fail":
      return { severity: "banner", message: "本机听写组件校验失败，请重装 Companion" }
    case "companion_disconnected":
      return { severity: "banner", message: "Companion 未连接，本机转写不可用" }
    case "session_busy":
      return { severity: "banner", message: "正在识别，请稍候或取消" }
    case "payload_too_large":
      return { severity: "banner", message: "录音过长或数据异常" }
    case "infer_timeout":
      return {
        severity: "banner",
        message:
          "识别超时（大模型/首段更易发生）。请在设置将活动模型改为 medium，或缩短本段后再试",
      }
    case "resource_conflict":
      return {
        severity: "banner",
        message: "上一段识别尚未结束，请稍候再试（或结束听写后重开会议）",
      }
    case "oom":
      return {
        severity: "banner",
        message: "本机内存不足（可改用 medium 模型或关闭实验模型后重试）",
      }
    case "infer_failed":
      return {
        severity: "banner",
        message: "本机识别失败，请检查本机听写组件/模型后重试",
      }
    case "binary_broken":
      return {
        severity: "banner",
        message:
          "本机听写组件无法运行（动态库/二进制损坏）。请设置中重新安装组件，或 brew install whisper-cpp 后点「安装本机听写组件」",
      }
    case "aborted":
      return { severity: "silent", message: "" }
    default:
      return {
        severity: "banner",
        message: code ? `本机转写错误：${code}` : "本机转写失败",
      }
  }
}

// --- Composer UX helpers (M1 Task 7; pure) ------------------------------------

/** Short local-listening hint (SoT §6.2) — no permanent third status row. */
export const LOCAL_LISTEN_HINT = "结束后本机识别"

/** Banner CTA label: switch sttEngine → browser (SoT §5.3). */
export const CTA_SWITCH_BROWSER = "改用浏览器听写"

/** Banner CTA label: open settings for model download. */
export const CTA_OPEN_SETTINGS = "去设置"

/**
 * Residual cloud disclosure when user opts into browser STT (SoT §5.3).
 * Keep short for 320px banner / toast.
 */
export const BROWSER_ENGINE_CLOUD_RESIDUAL = "可能经浏览器厂商云端"

/** Toast / banner line after successful CTA switch. */
export const TOAST_SWITCHED_BROWSER = `已改用浏览器听写。${BROWSER_ENGINE_CLOUD_RESIDUAL}`

/**
 * Format remaining listen budget as m:ss (45s → "0:45"). Pure.
 * Ceils partial seconds so UI never shows "0:00" while still listening.
 */
export function formatListenRemaining(remainingMs: number): string {
  if (!Number.isFinite(remainingMs)) return "0:00"
  const sec = Math.max(0, Math.ceil(remainingMs / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

/**
 * Elapsed → remaining label for the 45s cap.
 * Pure; pass maxMs for tests (default 45_000).
 */
export function formatListenRemainingFromElapsed(
  elapsedMs: number,
  maxMs = 45_000,
): string {
  const rem = Math.max(0, maxMs - (Number.isFinite(elapsedMs) ? elapsedMs : 0))
  return formatListenRemaining(rem)
}

/** Compact aria/title for local listening (timer + hint). */
export function localListeningStatusLabel(remainingMs: number): string {
  return `本机转写 · 剩余 ${formatListenRemaining(remainingMs)} · ${LOCAL_LISTEN_HINT}`
}

export type LocalBannerCta =
  | { kind: "switch_browser"; label: string }
  | { kind: "open_settings"; label: string }

/**
 * Recovery CTA for local STT error banners (SoT §5.3 / §6.3 / Task 7).
 * - companion_disconnected / binary_missing / hash_fail → 改用浏览器听写
 * - model_missing → 去设置
 * - empty / abort / busy → null (retry or wait; no engine flip)
 */
export function localSttBannerCta(code: string | null | undefined): LocalBannerCta | null {
  const c = (code || "").toLowerCase()
  switch (c) {
    case "companion_disconnected":
    case "binary_missing":
    case "hash_fail":
      return { kind: "switch_browser", label: CTA_SWITCH_BROWSER }
    case "model_missing":
      return { kind: "open_settings", label: CTA_OPEN_SETTINGS }
    default:
      return null
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
