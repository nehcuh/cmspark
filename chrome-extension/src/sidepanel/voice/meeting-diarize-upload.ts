/**
 * #260 — PCM upload + embedding auto-diarize client (meeting.diarize.upload_*).
 * 音频不出本机：raw s16le PCM → companion 内存会话 → ONNX 声纹 embedding。
 * 镜像 transcribeWavViaStt：有序 WS 上直接连发 chunk（不逐块等 ack）。
 */

import { LOCAL_STT_MAX_CHUNK_RAW_BYTES } from "./local-stt-detect"
import { splitIntoChunks } from "./pcm-encode"
import { uint8ToBase64, type SttOnMessage, type SttSend } from "./meeting-audio-import"

/** wrapPcmS16leAsWav 产出的 canonical 44 字节 WAV 头。 */
export const WAV_HEADER_BYTES = 44

/** 本地分段器产出的 WAV → 原始 s16le PCM 字节。 */
export function wavToRawPcm(wav: Uint8Array): Uint8Array {
  return wav.length > WAV_HEADER_BYTES ? wav.subarray(WAV_HEADER_BYTES) : new Uint8Array(0)
}

export type DiarizeUploadProgress = { done: number; total: number }

export type DiarizeUploadResult =
  | { ok: true }
  | { ok: false; code: string; message?: string }

/**
 * 一次性上传全部段 PCM 并触发 embedding 自动标说话人。
 * 状态机：upload_start → (等服务器 session_id) → chunks → upload_end →
 * auto_diarize{mode:"embedding"} → 等 meeting.diarized / meeting.error。
 * 服务器缺模型时回 embedding_model_required —— 调用方必须显式引导下载，
 * 不得静默落回旧引擎（#260 硬约束）。
 */
export function diarizeViaEmbeddingUpload(opts: {
  meetingId: string
  pcmSegments: Uint8Array[]
  k: number
  preserveManual?: boolean
  send: SttSend
  onMessage: SttOnMessage
  onProgress?: (p: DiarizeUploadProgress) => void
  timeoutMs?: number
}): Promise<DiarizeUploadResult> {
  const {
    meetingId,
    pcmSegments,
    k,
    preserveManual = true,
    send,
    onMessage,
    onProgress,
    timeoutMs = 300_000,
  } = opts

  if (pcmSegments.length === 0) {
    return Promise.resolve({ ok: false, code: "no_segments", message: "无音频段" })
  }

  return new Promise<DiarizeUploadResult>((resolve) => {
    let settled = false
    let phase: "upload_start" | "uploading" | "finalizing" | "diarizing" = "upload_start"
    let sessionId: string | null = null
    const totalSeqs: number[] = []

    const finish = (r: DiarizeUploadResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        unsub()
      } catch {
        /* */
      }
      resolve(r)
    }

    const unsub = onMessage((msg: any) => {
      if (!msg || typeof msg.type !== "string" || settled) return
      switch (msg.type) {
        case "meeting.diarize.upload_started": {
          if (phase !== "upload_start") return
          const sid = msg.session_id
          if (typeof sid !== "string" || !sid) {
            finish({ ok: false, code: "upload_start_invalid", message: "服务器未返回上传会话" })
            return
          }
          sessionId = sid
          phase = "uploading"
          try {
            streamChunks()
          } catch {
            finish({ ok: false, code: "send_failed" })
          }
          return
        }
        case "meeting.diarize.upload_ended": {
          if (phase !== "finalizing") return
          if (sessionId && typeof msg.session_id === "string" && msg.session_id !== sessionId) {
            return
          }
          phase = "diarizing"
          try {
            send({
              type: "meeting.auto_diarize",
              v: 1,
              id: meetingId,
              privacy_ack_v1: true,
              mode: "embedding",
              pcm_session: sessionId,
              k,
              ...(preserveManual ? { preserve_manual: true } : {}),
            })
          } catch {
            finish({ ok: false, code: "send_failed" })
          }
          return
        }
        case "meeting.diarize.progress": {
          if (msg.id !== meetingId) return
          const done = typeof msg.done === "number" ? msg.done : 0
          const total = typeof msg.total === "number" ? msg.total : 0
          onProgress?.({ done, total })
          return
        }
        case "meeting.diarized": {
          if (msg.meeting?.id && msg.meeting.id !== meetingId) return
          finish({ ok: true })
          return
        }
        case "meeting.error": {
          // 面板单会议单飞；错误消息不总会话绑定，带 id 时按会议过滤。
          if (typeof msg.id === "string" && msg.id && msg.id !== meetingId) return
          finish({
            ok: false,
            code: typeof msg.code === "string" && msg.code ? msg.code : "meeting_error",
            ...(typeof msg.message === "string" ? { message: msg.message } : {}),
          })
          return
        }
      }
    })

    const timer = setTimeout(() => finish({ ok: false, code: "timeout" }), timeoutMs)

    function streamChunks(): void {
      if (!sessionId) throw new Error("no-session")
      for (let i = 0; i < pcmSegments.length; i++) {
        const chunks = splitIntoChunks(pcmSegments[i]!, LOCAL_STT_MAX_CHUNK_RAW_BYTES)
        for (let seq = 0; seq < chunks.length; seq++) {
          send({
            type: "meeting.diarize.upload_chunk",
            v: 1,
            session_id: sessionId,
            index: i,
            seq,
            data: uint8ToBase64(chunks[seq]!),
          })
        }
        totalSeqs.push(chunks.length)
      }
      phase = "finalizing"
      send({
        type: "meeting.diarize.upload_end",
        v: 1,
        session_id: sessionId,
        total_seqs: totalSeqs,
      })
    }

    try {
      send({
        type: "meeting.diarize.upload_start",
        v: 1,
        privacy_ack_v1: true,
        segments: pcmSegments.length,
        sample_rate: 16000,
        format: "pcm_s16le",
      })
    } catch {
      finish({ ok: false, code: "send_failed" })
    }
  })
}
