/**
 * Text + one-shot voice commands to configure CMspark settings (D2+ UX).
 * Uses browser SpeechRecognition when available; never auto-sends chat.
 */

import { useCallback, useRef, useState, type CSSProperties } from "react"
import {
  parseSettingsIntent,
  SETTINGS_INTENT_HELP,
  type SettingsIntent,
} from "../utils/settings-intent"
import { getSpeechRecognitionCtor, VOICE_DEFAULT_LANG } from "../voice/detect"
import { tokens } from "../ui/tokens"

export type SettingsIntentBarProps = {
  /** Apply a parsed intent; return user-visible result string. */
  onIntent: (intent: SettingsIntent) => string
  disabled?: boolean
}

export function SettingsIntentBar({ onIntent, disabled }: SettingsIntentBarProps) {
  const [text, setText] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const recRef = useRef<{ stop: () => void; abort: () => void } | null>(null)

  const run = useCallback(
    (raw: string) => {
      const intent = parseSettingsIntent(raw)
      const msg = onIntent(intent)
      setStatus(msg)
      if (intent.type !== "unknown") setText("")
    },
    [onIntent],
  )

  const stopVoice = useCallback(() => {
    try {
      recRef.current?.stop()
    } catch {
      /* */
    }
    recRef.current = null
    setListening(false)
  }, [])

  const startVoice = useCallback(() => {
    if (disabled || listening) return
    const Ctor = getSpeechRecognitionCtor(
      typeof globalThis !== "undefined" ? (globalThis as any) : {},
    )
    if (!Ctor) {
      setStatus("此环境不支持语音识别，请直接输入文字命令")
      return
    }
    const r = new Ctor()
    r.lang = VOICE_DEFAULT_LANG
    r.continuous = false
    r.interimResults = true
    r.maxAlternatives = 1
    let finalText = ""
    r.onresult = (ev: any) => {
      let interim = ""
      const results = ev?.results
      if (!results) return
      for (let i = 0; i < results.length; i++) {
        const row = results[i]
        const t = row?.[0]?.transcript || ""
        if (row?.isFinal) finalText += t
        else interim += t
      }
      setText((finalText + interim).trim())
    }
    r.onerror = () => {
      setListening(false)
      recRef.current = null
      setStatus("语音识别失败，请改用文字")
    }
    r.onend = () => {
      setListening(false)
      recRef.current = null
      const phrase = (finalText || text).trim()
      if (phrase) run(phrase)
    }
    recRef.current = r
    setListening(true)
    setStatus("请说出设置命令…")
    try {
      r.start()
    } catch {
      setListening(false)
      setStatus("无法启动麦克风")
    }
  }, [disabled, listening, run, text])

  return (
    <div style={styles.wrap} data-testid="settings-intent-bar">
      <div style={styles.title}>文字 / 语音改设置</div>
      <div style={styles.hint}>{SETTINGS_INTENT_HELP}</div>
      <div style={styles.row}>
        <input
          type="text"
          value={text}
          disabled={disabled}
          placeholder="例如：开启连续听写"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              e.preventDefault()
              run(text)
            }
          }}
          style={styles.input}
        />
        <button
          type="button"
          disabled={disabled || !text.trim()}
          style={styles.btn}
          onClick={() => run(text)}
        >
          执行
        </button>
        <button
          type="button"
          disabled={disabled}
          style={{
            ...styles.btn,
            ...(listening ? styles.btnLive : null),
          }}
          onClick={() => (listening ? stopVoice() : startVoice())}
          title="用语音说设置命令"
        >
          {listening ? "停止" : "语音"}
        </button>
      </div>
      {status && <div style={styles.status}>{status}</div>}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    marginBottom: 14,
    padding: 10,
    borderRadius: 8,
    border: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
  },
  title: { fontSize: 12, fontWeight: 600, color: tokens.text, marginBottom: 4 },
  hint: { fontSize: 10, color: tokens.textMuted, lineHeight: 1.4, marginBottom: 8 },
  row: { display: "flex", gap: 6, alignItems: "center" },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.borderStrong}`,
  },
  btn: {
    fontSize: 11,
    padding: "6px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.borderStrong}`,
    background: tokens.bgElevated,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  btnLive: {
    background: tokens.warningSoft,
    borderColor: tokens.warning,
  },
  status: {
    marginTop: 6,
    fontSize: 11,
    color: tokens.accent,
    lineHeight: 1.4,
  },
}
