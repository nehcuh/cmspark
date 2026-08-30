// Path B M0 — pure UI copy + recommended Whisper model id for Settings voice section.
// Privacy dual-engine wording locked by SoT §5 / §6.1 (tests assert residual discipline).

/** UI primary recommendation (SoT); keep in lock-step with companion RECOMMENDED_WHISPER_MODEL. */
export const RECOMMENDED_WHISPER_MODEL_ID = "medium" as const

export const WHISPER_SETTINGS_MODEL_IDS = ["small", "medium", "large-v3-turbo"] as const
export type WhisperSettingsModelId = (typeof WHISPER_SETTINGS_MODEL_IDS)[number]

/** Non-primary models shown under “其他型号”. */
export const OTHER_WHISPER_MODEL_IDS = ["small", "large-v3-turbo"] as const

// --- Engine radio (SoT §6.1) -------------------------------------------------

export const ENGINE_SECTION_LABEL = "听写方式"

export const ENGINE_BROWSER_LABEL = "浏览器听写"
export const ENGINE_BROWSER_HINT = "无需下载；可能使用浏览器云端服务"

export const ENGINE_LOCAL_LABEL = "本机转写"
export const ENGINE_LOCAL_HINT = "需下载模型；音频在本机 Companion 临时转写"

// --- Privacy paragraphs (SoT §5 dual-engine residual) ------------------------

/**
 * Browser-mode privacy (M1 cloud STT residual).
 * May mention vendor cloud and that audio does not pass through Companion.
 */
export const BROWSER_PRIVACY_COPY =
  "可选麦克风：浏览器将语音转成文字后填入输入框，默认不自动发送。转写可能使用 Chrome " +
  "语音服务（音频可能经网络发送至浏览器厂商），不经过 CMspark Companion。发送后的文字与键入相同，仍受现有确认与信任设置约束。" +
  "若当前浏览器不支持网页语音识别，请使用系统听写。"

/**
 * Local-mode / local-draft privacy (Path B residual).
 * MUST NOT claim audio bypasses Companion — audio goes Ext → Companion tmp → whisper.
 */
export const LOCAL_PRIVACY_COPY =
  "本机转写：麦克风音频经鉴权通道送至本机 Companion，写入临时文件后由本机 Whisper 识别，" +
  "结果填入草稿（默认不自动发送）；识别后删除临时音频，不保证 OS 交换/崩溃转储等零痕迹。" +
  "发送后的文字与键入相同，仍受现有确认与信任设置约束。模型需用户显式下载（HTTPS + 校验）。" +
  "与电脑控制实验模型同时使用可能占用大量内存。"

/** Return privacy paragraph for the engine the UI is presenting (draft or committed). */
export function privacyCopyForEngine(engine: "browser" | "local"): string {
  return engine === "local" ? LOCAL_PRIVACY_COPY : BROWSER_PRIVACY_COPY
}

// --- Action / status labels --------------------------------------------------

export const RECOMMENDED_ROW_PREFIX = "推荐"
export const OTHER_MODELS_TOGGLE = "其他型号"
export const BTN_DOWNLOAD = "下载"
export const BTN_CANCEL = "取消"
export const BTN_DELETE = "删除"
export const BTN_ENABLE_LOCAL = "启用本机转写"
export const BTN_LOCAL_ENABLED = "已启用本机转写"
export const BTN_SWITCH_BROWSER = "改用浏览器听写"
export const BTN_SET_ACTIVE = "设为活动"

export const MEMORY_NOTE = "与电脑控制实验模型同时使用可能占用大量内存"

// --- Transport / optimistic feedback (settings sendMessage path) -------------

/** Shown while voiceModel store mirror is still null. */
export const VOICE_STATUS_QUERYING = "正在查询本机模型状态…"

/** Local-only label after user clicks download, before companion state/progress. */
export const VOICE_STATUS_STARTING_DOWNLOAD = "正在开始下载…"

/** get_state / mutators: background refused because WS not up. */
export const VOICE_ERR_COMPANION_DISCONNECTED =
  "Companion 未连接。请确认菜单栏 CMspark 已启动且 Side Panel 显示已连接。"

// --- Fallback + download source (auto-fallback / HF mirror) -------------------

/** Toggle: per-session browser dictation when the local model is not ready (default on). */
export const VOICE_AUTO_FALLBACK_LABEL = "本机模型不可用时自动使用浏览器听写"
export const VOICE_AUTO_FALLBACK_HINT =
  "本机模型未就绪时，本次听写临时改用浏览器引擎并显示提示横幅；不会修改「听写方式」设置。"

/** Download endpoint input (HF mirror). Empty = manifest URLs as-is. */
export const VOICE_DOWNLOAD_ENDPOINT_LABEL = "模型下载源"
export const VOICE_DOWNLOAD_ENDPOINT_PLACEHOLDER = "https://huggingface.co"
export const VOICE_DOWNLOAD_ENDPOINT_HINT =
  "留空使用默认源；可填镜像如 https://hf-mirror.com（仅 https 源，文件校验不变）。"

/** get_state never filled voiceModel within the settings-open timeout. */
export const VOICE_ERR_STATE_TIMEOUT =
  "未能获取本机模型状态。请确认 Companion 已连接，然后关闭并重新打开设置；若仍无效请在 chrome://extensions 重载扩展。"

/** download accepted by SW but no companion progress/state within timeout. */
export const VOICE_ERR_DOWNLOAD_NO_PROGRESS =
  "下载指令已发出，但未收到 Companion 进度。请确认 Companion 在运行，或重载扩展后重试。"

export type VoiceSettingsSendResult = { ok: true } | { ok: false; error: string }

/**
 * Parse chrome.runtime.sendMessage response for voice.model.* (settings → SW → WS).
 * Background always sendResponse({ ok, error? }) for these types when the SW is alive.
 */
export function parseVoiceSettingsSendResponse(
  resp: unknown,
  runtimeLastError?: string | null,
): VoiceSettingsSendResult {
  if (typeof runtimeLastError === "string" && runtimeLastError.trim()) {
    return { ok: false, error: mapVoiceTransportError(runtimeLastError.trim()) }
  }
  if (resp == null || typeof resp !== "object") {
    // Undefined can mean no listener (SW dead) without lastError in some edge paths.
    return { ok: false, error: VOICE_ERR_COMPANION_DISCONNECTED }
  }
  const r = resp as { ok?: unknown; error?: unknown }
  if (r.ok === false) {
    const raw = typeof r.error === "string" && r.error.trim() ? r.error.trim() : "请求失败"
    return { ok: false, error: mapVoiceTransportError(raw) }
  }
  return { ok: true }
}

/** Map SW / transport English or technical strings to settings-facing Chinese. */
export function mapVoiceTransportError(error: string): string {
  if (!error) return VOICE_ERR_COMPANION_DISCONNECTED
  if (/Companion 未连接|未连接/.test(error)) {
    return /Companion/.test(error) ? error : VOICE_ERR_COMPANION_DISCONNECTED
  }
  if (/Service worker|未初始化|重载扩展/i.test(error)) {
    return error.includes("重载")
      ? error
      : "扩展 Service Worker 未就绪，请在 chrome://extensions 重载 CMspark 后重试。"
  }
  if (/Unknown message type/i.test(error)) {
    return "扩展版本过旧或不匹配，请在 chrome://extensions 重新加载 CMspark。"
  }
  if (/message port closed|Receiving end does not exist/i.test(error)) {
    return "扩展后台未响应，请在 chrome://extensions 重载 CMspark 后重试。"
  }
  return error
}

export function formatDiskUsage(usedMB: number, budgetMB: number): string {
  const used = Number.isFinite(usedMB) ? usedMB : 0
  const budget = Number.isFinite(budgetMB) ? budgetMB : 0
  return `磁盘占用 ${formatMb(used)} / 预算 ${formatMb(budget)}`
}

export function formatMb(mb: number): string {
  if (!Number.isFinite(mb) || mb < 0) return "0 MB"
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  if (mb >= 10) return `${Math.round(mb)} MB`
  return `${mb.toFixed(1)} MB`
}

/** Progress percent from voice.model.progress bytes; 0–100. */
export function progressPercent(receivedBytes: number, totalBytes: number): number {
  if (!Number.isFinite(receivedBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round((receivedBytes / totalBytes) * 100)))
}

export function modelStatusLabel(
  status: string | undefined,
): string {
  switch (status) {
    case "ready":
      return "已就绪"
    case "downloading":
      return "下载中"
    case "incomplete":
      return "未完成"
    case "absent":
    default:
      return "未下载"
  }
}

/** Map probe / download machine codes to user-facing Chinese. */
export function modelProbeErrorLabel(error: string | undefined | null): string | null {
  if (!error) return null
  switch (error) {
    case "unexpected-files":
      return "目录有异常文件。请点「删除」清空后重新下载。"
    case "partial-download":
      return "上次下载未完成。请点「删除」或直接再点「下载」继续/重下。"
    case "model-unknown":
      return "未知模型型号"
    case "http-error":
      return "下载失败：网络/镜像返回错误（HuggingFace 需可访问）。可检查网络后重试。"
    case "network-error":
      return "下载失败：网络中断。请检查网络后重试。"
    case "disk-budget-exceeded":
      return "磁盘预算不足。请在设置删除不用的模型，或增大预算后重试。"
    case "hash-mismatch":
      return "下载文件校验失败。请删除后重新下载。"
    default:
      // Prefer full HTTP message from companion when present
      if (/HTTP \d+|redirect|network/i.test(error)) {
        return `下载失败：${error.length > 160 ? error.slice(0, 160) + "…" : error}`
      }
      if (error.length > 120) return error.slice(0, 120) + "…"
      return error
  }
}

/**
 * Binary probe line for settings.
 * not_found / hash_mismatch → user can auto-download (voice.binary.download).
 */
export function binaryStatusLine(
  binary: { status?: string; path?: string; message?: string } | null | undefined,
): string {
  const status = binary?.status || "not_found"
  if (status === "ready") {
    return binary?.path
      ? `本机组件：已就绪（${binary.path}）`
      : "本机组件：已就绪"
  }
  if (status === "hash_mismatch") {
    return "本机组件：校验失败（可重新安装本机组件）"
  }
  if (status === "unsupported" || status === "unsupported_arch") {
    return binary?.message
      ? `本机组件：当前平台不支持自动安装（${binary.message}）`
      : "本机组件：当前平台不支持自动安装"
  }
  // macOS: no win-style HTTPS zip — brew/local install path (adversary F-merge-4).
  // Keep platform-agnostic wording; Settings button has the full macOS brew note.
  return binary?.message
    ? `本机组件：未找到（${binary.message}）— 可安装本机听写组件`
    : "本机组件：未找到 — 可安装本机听写组件（macOS 需 Homebrew whisper-cpp 或安装包内置）"
}

/** Whether Settings should show the binary download button. */
export function canDownloadWhisperBinary(
  binary: { status?: string } | null | undefined,
): boolean {
  const status = binary?.status || "not_found"
  return status === "not_found" || status === "hash_mismatch"
}
