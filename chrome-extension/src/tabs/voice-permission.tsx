/**
 * Mic permission bootstrap page (SoT F-C2).
 * Opened via chrome.tabs.create when Side Panel cannot surface the grant UI.
 */
import { useEffect, useState } from "react"
import {
  detectSpeechRecognition,
  getSpeechRecognitionCtor,
  VOICE_DEFAULT_LANG,
} from "../sidepanel/voice/detect"
import { osMicPrivacyHint } from "../sidepanel/voice/error-map"

export default function VoicePermissionPage() {
  const [status, setStatus] = useState<string>("准备请求麦克风权限…")
  const [ok, setOk] = useState(false)

  useEffect(() => {
    const support = detectSpeechRecognition(window as any)
    if (!support.ok) {
      setStatus("当前浏览器不支持网页语音识别，请使用系统听写。")
      return
    }
    const Ctor = getSpeechRecognitionCtor(window as any)
    if (!Ctor) {
      setStatus("无法创建语音识别实例。")
      return
    }
    try {
      const rec = new Ctor()
      rec.lang = VOICE_DEFAULT_LANG
      rec.continuous = false
      rec.interimResults = false
      rec.onstart = () => {
        setStatus("已获得麦克风权限。请关闭本页，回到 Side Panel 再点语音输入。")
        setOk(true)
        try {
          rec.stop()
        } catch {
          /* */
        }
      }
      rec.onerror = (ev: any) => {
        const code = ev?.error || "unknown"
        if (code === "not-allowed" || code === "service-not-allowed") {
          const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : ""
          const osHint = osMicPrivacyHint(ua)
          setStatus(
            `权限被拒绝。请在 Chrome 站点设置与 ${osHint} 中允许 Google Chrome / 本扩展。`,
          )
        } else if (code === "no-speech" || code === "aborted") {
          setStatus("已触发权限流程（未识别到语音也无妨）。可关闭本页回到 Side Panel。")
          setOk(true)
        } else {
          setStatus(`识别错误：${code}。仍可检查系统麦克风权限后重试。`)
        }
      }
      rec.onend = () => {
        /* */
      }
      rec.start()
      setStatus("正在请求麦克风权限（若无弹窗，请检查系统隐私设置）…")
    } catch (e: any) {
      setStatus(`无法启动：${e?.message || e}`)
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
        转写可能使用 Chrome 语音服务（音频可能经网络发送至浏览器厂商），
        <b>不经过</b> CMspark Companion。仅用于把语音变成文字写入输入框。
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
