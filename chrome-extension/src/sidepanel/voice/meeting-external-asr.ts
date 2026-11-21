import { uint8ToBase64, type AudioSegmentWav } from "./meeting-audio-import"
import { formatMeetingElapsed } from "./meeting-caps"

export type MeetingAsrDelivery = "not_sent" | "unknown" | "sent"
type Delivery = MeetingAsrDelivery
type Failure = { ok: false; code: string; delivery: Delivery }
type Result = { ok: true; text: string } | Failure
export type MeetingAsrRequest = (message: Record<string, unknown>, timeoutMs?: number) => Promise<any>

export interface MeetingAsrState {
  mode: "local" | "external"
  style: "deepseek" | "openai"
  baseUrl: string
  normalizedUrl: string
  model: string
  keyConfigured: boolean
  ready: boolean
  segmentMs: number
  requestTimeoutMs: number
  configIdentity: string
}

export function meetingAsrState(reply: any): MeetingAsrState | null {
  const state = reply?.state
  if (reply?.type !== "meeting.asr.state" || !state ||
      !["local", "external"].includes(state.mode) || !["deepseek", "openai"].includes(state.style) ||
      typeof state.baseUrl !== "string" || typeof state.normalizedUrl !== "string" || typeof state.model !== "string" ||
      typeof state.ready !== "boolean" || typeof state.keyConfigured !== "boolean" ||
      !/^[0-9a-f]{64}$/.test(state.configIdentity) || !Number.isSafeInteger(state.segmentMs) ||
      state.segmentMs < 1000 || state.segmentMs > 45_000 ||
      !Number.isSafeInteger(state.requestTimeoutMs) || state.requestTimeoutMs < 30_000 || state.requestTimeoutMs > 600_000) return null
  return state
}

export function meetingExternalConfirmation(fileName: string, target: Pick<MeetingAsrState, "normalizedUrl" | "model">, durationSec: number, count: number) {
  return [
    `发送「${fileName}」的音频（${formatMeetingElapsed(durationSec * 1000)}，共 ${count} 段）？`,
    `接收地址：${target.normalizedUrl}`,
    `转写模型：${target.model}`,
    "音频会转为单声道 WAV 后逐段发送。取消会停止后续发送，已发送的音频无法撤回。",
  ].join("\n\n")
}

const messages: Record<string, string> = {
  aborted: "已中止外部转写。",
  external_configuration_changed: "会议转写配置已变化。重新选择音频并核对接收地址后确认。",
  external_unconfigured: "请在模型与服务中配置会议转写服务。",
  external_invalid_settings: "请检查转写地址、模型和密钥格式。",
  external_key_required_for_endpoint: "接收地址已变化，请为新地址填写密钥。",
  external_save_failed: "未能保存会议转写设置。",
  external_save_unknown: "未核对到保存结果，请重新读取设置。",
  external_import_busy: "已有外部会议音频导入进行中。",
  external_authorization_required: "本次确认已失效。请重新选择音频并确认。",
  external_unauthorized: "服务拒绝了密钥。",
  external_endpoint: "服务找不到转写接口。",
  external_too_large: "音频段超出服务限制。",
  external_rate_limited: "服务正在限流。",
  external_unavailable: "转写服务暂时不可用。",
  external_timeout: "等待转写服务超时。",
  external_unreachable: "无法连接转写服务。",
  external_redirect: "转写地址返回了重定向。",
  external_empty: "服务没有返回可用的转写文字。",
  external_bad_response: "服务返回了无法读取的转写结果。",
  external_segment_mismatch: "音频段与本次确认的内容不一致。",
  network_unknown: "连接中断或等待响应超时。",
  not_connected: "Companion 未连接。",
}

export function meetingAsrError(code: string) {
  return messages[code] ?? "会议转写请求失败。"
}

export function meetingAsrDelivery(delivery: Delivery) {
  if (delivery === "sent") return "该段音频已发送。"
  if (delivery === "unknown") return "该段音频是否到达服务未知。"
  return "该段音频未发送。"
}

function failure(code: string, delivery: Delivery = "not_sent"): Failure {
  return { ok: false, code, delivery }
}

function deliveryFrom(response: any, fallback: Delivery): Delivery {
  const value = response?.delivery
  return value === "sent" || value === "unknown" || value === "not_sent" ? value : fallback
}

export async function beginMeetingExternalImport(options: {
  request: MeetingAsrRequest
  configIdentity: string
  segments: readonly AudioSegmentWav[]
  requestTimeoutMs: number
  signal: AbortSignal
}): Promise<Failure | { ok: true; transcribe: (segment: AudioSegmentWav) => Promise<Result>; dispose: () => void }> {
  const { request, signal } = options
  let token: string
  try {
    const segments: Array<{ bytes: number; sha256: string }> = []
    for (const { wav } of options.segments) {
      if (signal.aborted) return failure("aborted")
      const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(wav))
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
      segments.push({ bytes: wav.byteLength, sha256 })
    }
    if (signal.aborted) return failure("aborted")
    const reply = await request({
      type: "meeting.asr.authorize", config_identity: options.configIdentity, privacy_ack_v1: true,
      privacy_ack_meeting_asr_v1: true, segments,
    })
    if (reply?.type !== "meeting.asr.authorized" || typeof reply.token !== "string") return failure(reply?.code ?? "external_authorization_required")
    token = reply.token
  } catch {
    return failure("network_unknown")
  }

  let cancellation: Promise<Failure> | undefined
  let completed = 0
  const cancel = () => {
    cancellation ??= request({ type: "meeting.asr.cancel", token })
      .then(reply => failure("aborted", deliveryFrom(reply, "unknown")))
      .catch(() => failure("aborted", "unknown"))
    return cancellation
  }
  const dispose = () => { if (completed < options.segments.length) void cancel() }
  if (signal.aborted) {
    dispose()
    return failure("aborted")
  }

  return {
    ok: true,
    dispose,
    async transcribe(segment) {
      if (signal.aborted) return failure("aborted")
      let onAbort: () => void = () => {}
      const cancelled = new Promise<Failure>(resolve => {
        onAbort = () => { void cancel().then(resolve) }
        signal.addEventListener("abort", onAbort, { once: true })
      })
      try {
        const sent = request({
          type: "meeting.asr.segment", token, index: segment.index, data: uint8ToBase64(segment.wav),
        }, options.requestTimeoutMs + 10_000).then((reply): Result => {
          if (reply?.type === "meeting.asr.result" && reply.index === segment.index && typeof reply.text === "string") {
            return { ok: true, text: reply.text }
          }
          return failure(reply?.code ?? "network_unknown", deliveryFrom(reply, "unknown"))
        })
        const result = await Promise.race([sent, cancelled])
        if (result.ok) completed++
        return result
      } catch (error) {
        const notConnected = error instanceof Error && error.message === "not_connected"
        return failure(notConnected ? "not_connected" : "network_unknown", notConnected ? "not_sent" : "unknown")
      } finally {
        signal.removeEventListener("abort", onAbort)
      }
    },
  }
}
