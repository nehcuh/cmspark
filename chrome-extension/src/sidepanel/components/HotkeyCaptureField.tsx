/**
 * D2 UX — click to record a hold-to-talk chord from the keyboard.
 * Side Panel focus required; validates via hotkey-chord (no bare fn / Win+V).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { chordFromKeyboardEvent, parseHotkeyChord } from "../voice/hotkey-chord"
import { tokens } from "../ui/tokens"

export type HotkeyCaptureFieldProps = {
  value: string
  disabled?: boolean
  onChange: (chord: string) => void
  /** Optional presets shown as chips */
  presets?: string[]
}

export function HotkeyCaptureField({
  value,
  disabled,
  onChange,
  presets = [
    "Control+Shift+Space",
    "Alt+Space",
    "Control+Alt+Space",
    "Control+Shift+D",
  ],
}: HotkeyCaptureFieldProps) {
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLButtonElement>(null)

  const stopCapture = useCallback(() => {
    setCapturing(false)
  }, [])

  useEffect(() => {
    if (!capturing) return
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === "Escape") {
        stopCapture()
        setError(null)
        return
      }
      if (e.repeat) return
      const chord = chordFromKeyboardEvent(e)
      if (!chord) {
        // Still holding only modifiers — keep waiting
        if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) {
          setError("请继续按住修饰键并按下主键（如 Space / 字母）")
          return
        }
        setError("需要组合键（至少一个修饰键 + 主键）。禁止单独 Fn / Meta+V。")
        return
      }
      if (!parseHotkeyChord(chord)) {
        setError("无效或禁止的组合（禁止 bare Fn / 单独 Meta+V）")
        return
      }
      onChange(chord)
      setError(null)
      stopCapture()
    }
    const onBlur = () => stopCapture()
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("blur", onBlur)
    }
  }, [capturing, onChange, stopCapture])

  useEffect(() => {
    if (capturing) boxRef.current?.focus()
  }, [capturing])

  return (
    <div style={styles.wrap}>
      <div style={styles.row}>
        <code style={styles.chord}>{value || "—"}</code>
        <button
          ref={boxRef}
          type="button"
          disabled={disabled}
          style={{
            ...styles.captureBtn,
            ...(capturing ? styles.captureBtnActive : null),
            ...(disabled ? styles.captureBtnDisabled : null),
          }}
          onClick={() => {
            if (disabled) return
            setError(null)
            setCapturing((v) => !v)
          }}
          aria-pressed={capturing}
        >
          {capturing ? "按下组合键…（Esc 取消）" : "按键盘录制"}
        </button>
      </div>
      {error && <div style={styles.error}>{error}</div>}
      {!capturing && (
        <div style={styles.presets}>
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              disabled={disabled}
              style={styles.presetChip}
              onClick={() => {
                if (parseHotkeyChord(p)) {
                  onChange(p)
                  setError(null)
                }
              }}
            >
              {p}
            </button>
          ))}
        </div>
      )}
      <div style={styles.hint}>
        点击「按键盘录制」后按下组合键自动识别。需 Side Panel 焦点。禁止 bare Fn / 单独
        Meta+V。
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { marginTop: 6 },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  chord: {
    fontSize: 12,
    padding: "6px 8px",
    background: "#f4f4f5",
    borderRadius: 6,
    border: "1px solid #e4e4e7",
    minWidth: 120,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  captureBtn: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 6,
    border: `1px solid ${tokens.border || "#ddd"}`,
    background: "#fff",
    cursor: "pointer",
    color: "#333",
  },
  captureBtnActive: {
    background: "#fef3c7",
    borderColor: "#f59e0b",
    fontWeight: 600,
  },
  captureBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  error: { marginTop: 4, fontSize: 11, color: "#b91c1c", lineHeight: 1.4 },
  presets: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 },
  presetChip: {
    fontSize: 10,
    padding: "3px 6px",
    borderRadius: 999,
    border: "1px solid #e4e4e7",
    background: "#fafafa",
    cursor: "pointer",
    color: "#555",
  },
  hint: { marginTop: 4, fontSize: 10, color: "#999", lineHeight: 1.4 },
}
