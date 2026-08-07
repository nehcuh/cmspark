/**
 * Mic permission bootstrap page (SoT F-C2 / Path B F-C-B3).
 * Opened via chrome.tabs.create when Side Panel cannot surface the grant UI.
 *
 * Grants both:
 * - getUserMedia (Path B local STT — required)
 * - SpeechRecognition start (M1 browser STT — best-effort after gUM)
 */
import { useEffect, useState } from "react"
import {
  detectSpeechRecognition,
  getSpeechRecognitionCtor,
  VOICE_DEFAULT_LANG,
} from "../sidepanel/voice/detect"
import { detectLocalMediaCapture } from "../sidepanel/voice/local-stt-detect"
import { osMicPrivacyHint } from "../sidepanel/voice/error-map"

export default function VoicePermissionPage() {
  const [status, setStatus] = useState<string>("准备请求麦克风权限…")
  const [ok, setOk] = useState(false)
  const [gumOk, setGumOk] = useState(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false

    const finish = (msg: string, success: boolean) => {
      if (cancelled) return
      setStatus(msg)
      setOk(success)
    }

    ;(async () => {
      const media = detectLocalMediaCapture(window as any)
      if (!media.ok) {
        // Fall back to SpeechRecognition-only bootstrap (M1)
        finish(
          "本环境缺少 getUserMedia/MediaRecorder；将尝试浏览器听写权限（本机转写不可用）。",
          false,
        )
        trySpeechOnly()
        return
      }

      try {
        setStatus("正在请求麦克风（getUserMedia）…")
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        setGumOk(true)
        // Release tracks immediately — we only needed the grant.
        stream.getTracks().forEach((t) => t.stop())
        stream = null
        finish(
          "已获得麦克风权限（getUserMedia）。请关闭本页，回到 Side Panel 再点语音输入。浏览器听写与本机转写均可使用。",
          true,
        )
        // Best-effort also touch SpeechRecognition so browser engine path is warm.
        trySpeechOnly(true)
      } catch (e: any) {
        const name = e?.name || ""
        const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : ""
        const osHint = osMicPrivacyHint(ua)
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          finish(
            `权限被拒绝。请在 Chrome 站点设置与 ${osHint} 中允许 Google Chrome / 本扩展。`,
            false,
          )
        } else {
          finish(`getUserMedia 失败：${e?.message || name || e}`, false)
          trySpeechOnly()
        }
      }
    })()

    function trySpeechOnly(skipIfAlreadyOk = false) {
      if (skipIfAlreadyOk && !cancelled) {
        /* gUM already succeeded */
      }
      const support = detectSpeechRecognition(window as any)
      if (!support.ok) return
      const Ctor = getSpeechRecognitionCtor(window as any)
      if (!Ctor) return
      try {
        const rec = new Ctor()
        rec.lang = VOICE_DEFAULT_LANG
        rec.continuous = false
        rec.interimResults = false
        rec.onstart = () => {
          try {
            rec.stop()
          } catch {
            /* */
          }
        }
        rec.onerror = () => {
          /* ignore after gUM */
        }
        rec.start()
      } catch {
        /* */
      }
    }

    return () => {
      cancelled = true
      if (stream) stream.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div
      style={{
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        maxWidth: 480,
        margin: "40px auto",
        padding: 24,
        lineHeight: 1.55,
        color: "#111",
      }}
    >
      <h1 style={{ fontSize: 18 }}>CMspark 麦克风权限</h1>
      <p style={{ fontSize: 13, color: "#444" }}>
        浏览器听写可能使用 Chrome 云端语音服务。
        <b>本机转写</b>会将音频送至本机 Companion 临时识别（需你在设置中启用并下载模型）。
        两种方式默认都不自动发送。
      </p>
      <p
        style={{
          fontSize: 14,
          padding: 12,
          background: ok ? "#ecfdf5" : "#f8fafc",
          borderRadius: 8,
          border: `1px solid ${ok ? "#6ee7b7" : "#e2e8f0"}`,
        }}
      >
        {status}
        {gumOk ? (
          <span style={{ display: "block", marginTop: 8, fontSize: 12, color: "#047857" }}>
            getUserMedia: granted
          </span>
        ) : null}
      </p>
      <button
        type="button"
        onClick={() => window.close()}
        style={{
          marginTop: 16,
          padding: "8px 14px",
          borderRadius: 6,
          border: "1px solid #cbd5e1",
          background: "#fff",
          cursor: "pointer",
        }}
      >
        关闭本页
      </button>
    </div>
  )
}
