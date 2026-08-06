/**
 * M0.5 Voice Input Platform Spike — open as extension tab:
 *   chrome-extension://<id>/tabs/voice-spike.html
 *
 * Proves (manual / semi-auto):
 * 1) SpeechRecognition ctor in extension document
 * 2) Mic permission + optional bootstrap note
 * 3) zh-CN onresult (user must speak)
 * 4) network / offline failure path
 * 5) no audioCapture in manifest
 *
 * Not product UI — diagnostics only. Safe to remove after M1 ships.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import {
  detectSpeechRecognition,
  getSpeechRecognitionCtor,
  isLikelyTier1Chrome,
  VOICE_DEFAULT_LANG,
  VOICE_MAX_LISTEN_MS,
  type SpeechRecognitionLike,
  type VoiceSupport,
} from "../sidepanel/voice/detect"

function formatVoiceSupport(s: VoiceSupport): string {
  // Discriminate via exclusive field — more reliable than s.ok narrowing under plasmo tsc
  if ("reason" in s) return s.reason
  return s.ctorName
}
import { mapSpeechError, resolveMicChrome } from "../sidepanel/voice/error-map"

type LogLine = { t: number; level: "info" | "ok" | "err" | "warn"; msg: string }

function now() {
  return new Date().toISOString().slice(11, 23)
}

export default function VoiceSpikePage() {
  const [logs, setLogs] = useState<LogLine[]>([])
  const [phase, setPhase] = useState<"idle" | "listening" | "stopping">("idle")
  const [interim, setInterim] = useState("")
  const [finals, setFinals] = useState("")
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  )
  const [perm, setPerm] = useState<string>("unknown")
  const [privacyAck, setPrivacyAck] = useState(false)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gotResultRef = useRef(false)

  const log = useCallback((level: LogLine["level"], msg: string) => {
    setLogs((prev) => [...prev, { t: Date.now(), level, msg }])
  }, [])

  const support = detectSpeechRecognition(
    typeof window !== "undefined" ? (window as any) : {},
  )
  const tier1 =
    typeof navigator !== "undefined" ? isLikelyTier1Chrome(navigator.userAgent) : false
  const micChrome = resolveMicChrome({
    voiceInputEnabled: true,
    speechSupported: support.ok,
    tier1Chrome: tier1,
    enforceTier1: false,
    permissionState:
      perm === "granted" || perm === "denied" || perm === "prompt"
        ? (perm as "granted" | "denied" | "prompt")
        : "unknown",
    online,
  })

  useEffect(() => {
    const on = () => {
      setOnline(true)
      log("info", "navigator.onLine → true")
    }
    const off = () => {
      setOnline(false)
      log("warn", "navigator.onLine → false (cloud STT expected to fail)")
    }
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    return () => {
      window.removeEventListener("online", on)
      window.removeEventListener("offline", off)
    }
  }, [log])

  useEffect(() => {
    log("info", `origin=${location.origin}`)
    log("info", `UA=${navigator.userAgent.slice(0, 120)}…`)
    log("info", `tier1Chrome=${tier1} speech=${JSON.stringify(support)}`)
    log("info", `manifest audioCapture: not declared (package.json) — check chrome://extensions`)
    // Permission query (may be unsupported for microphone in some builds)
    const perms = (navigator as any).permissions
    if (perms?.query) {
      perms
        .query({ name: "microphone" as PermissionName })
        .then((s: PermissionStatus) => {
          setPerm(s.state)
          log("info", `permissions.microphone=${s.state}`)
          s.onchange = () => {
            setPerm(s.state)
            log("info", `permissions.microphone → ${s.state}`)
          }
        })
        .catch((e: Error) => {
          log("warn", `permissions.query failed: ${e?.message || e}`)
          setPerm("unknown")
        })
    } else {
      log("warn", "permissions.query unavailable")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount probe once
  }, [])

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const stopRec = useCallback(
    (why: string) => {
      clearTimer()
      setPhase("stopping")
      log("info", `stop (${why})`)
      try {
        recRef.current?.stop()
      } catch {
        try {
          recRef.current?.abort()
        } catch {
          /* */
        }
      }
    },
    [log],
  )

  const startRec = useCallback(() => {
    if (!privacyAck) {
      log("err", "privacy ack required (F-S1 / F-S10)")
      return
    }
    if (!online) {
      log("err", mapSpeechError("offline").message)
      return
    }
    const Ctor = getSpeechRecognitionCtor(window as any)
    if (!Ctor) {
      log("err", "SpeechRecognition missing — hide mic in product")
      return
    }
    gotResultRef.current = false
    setInterim("")
    const rec = new Ctor()
    rec.lang = VOICE_DEFAULT_LANG
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onstart = () => {
      setPhase("listening")
      log("ok", `onstart lang=${rec.lang}`)
    }
    rec.onresult = (ev: any) => {
      let interimBuf = ""
      let finalBuf = ""
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        const t = r[0]?.transcript || ""
        if (r.isFinal) finalBuf += t
        else interimBuf += t
      }
      if (finalBuf) {
        gotResultRef.current = true
        setFinals((prev) => prev + finalBuf)
        log("ok", `onresult FINAL: ${JSON.stringify(finalBuf)}`)
      }
      if (interimBuf) {
        gotResultRef.current = true
        setInterim(interimBuf)
        log("info", `onresult interim: ${JSON.stringify(interimBuf)}`)
      }
    }
    rec.onerror = (ev: any) => {
      const code = ev?.error || "unknown"
      const mapped = mapSpeechError(code)
      log(mapped.severity === "silent" ? "info" : "err", `onerror ${code}: ${mapped.message}`)
    }
    rec.onend = () => {
      clearTimer()
      recRef.current = null
      setPhase("idle")
      setInterim("")
      log(
        gotResultRef.current ? "ok" : "warn",
        `onend gotResult=${gotResultRef.current} (M0.5 gate: need ≥1 result for PASS)`,
      )
    }
    recRef.current = rec
    try {
      rec.start()
      log("info", "recognition.start() called")
      timerRef.current = setTimeout(() => {
        log("warn", `hard cap ${VOICE_MAX_LISTEN_MS}ms`)
        stopRec("timeout")
        const mapped = mapSpeechError("timeout")
        log("info", mapped.message)
      }, VOICE_MAX_LISTEN_MS)
    } catch (e: any) {
      log("err", `start() threw: ${e?.message || e}`)
      setPhase("idle")
    }
  }, [log, online, privacyAck, stopRec])

  const exportReport = () => {
    const report = {
      spike: "voice-input-m05",
      at: new Date().toISOString(),
      origin: location.origin,
      support,
      tier1,
      perm,
      online,
      privacyAck,
      gotResult: gotResultRef.current || finals.length > 0,
      finals,
      logs: logs.map((l) => ({ level: l.level, msg: l.msg })),
      gates: {
        "S1_ctor": support.ok,
        "S2_tier1": tier1,
        "S3_no_audioCapture_declared": true,
        "S4_privacy_ack_ui": privacyAck,
        "S5_zh_onresult": !!(gotResultRef.current || finals.length > 0),
        "S6_offline_path_observed": !online || logs.some((l) => /onLine → false|offline/i.test(l.msg)),
      },
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `voice-m05-spike-${Date.now()}.json`
    a.click()
    log("ok", "exported JSON report")
  }

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Voice Input M0.5 Spike</h1>
      <p style={s.muted}>
        Extension document harness — not product UI. Open via{" "}
        <code>chrome-extension://&lt;id&gt;/tabs/voice-spike.html</code>
      </p>

      <section style={s.card}>
        <h2 style={s.h2}>Environment</h2>
        <ul style={s.ul}>
          <li>
            SpeechRecognition:{" "}
            <b style={{ color: support.ok ? "#0a0" : "#c00" }}>{formatVoiceSupport(support)}</b>
          </li>
          <li>
            Tier-1 Chrome: <b>{String(tier1)}</b>
          </li>
          <li>
            Mic permission: <b>{perm}</b>
          </li>
          <li>
            online: <b style={{ color: online ? "#0a0" : "#c00" }}>{String(online)}</b>
          </li>
          <li>
            mic chrome resolve: <code>{JSON.stringify(micChrome)}</code>
          </li>
          <li>
            lang: <code>{VOICE_DEFAULT_LANG}</code> · max: {VOICE_MAX_LISTEN_MS / 1000}s
          </li>
        </ul>
      </section>

      <section style={s.card}>
        <h2 style={s.h2}>Privacy ack (F-S1)</h2>
        <p style={s.privacy}>
          可选麦克风：浏览器将语音转成文字。转写可能使用 Chrome 语音服务（音频可能经网络发送至浏览器厂商），
          <b>不经过</b> CMspark Companion。本 spike 仅本地展示文本，不发送 chat。
        </p>
        <label style={s.check}>
          <input
            type="checkbox"
            checked={privacyAck}
            onChange={(e) => setPrivacyAck(e.target.checked)}
          />
          我已阅读上述说明（voice_privacy_ack_v1）
        </label>
      </section>

      <section style={s.card}>
        <h2 style={s.h2}>Recognition</h2>
        <div style={s.row}>
          <button
            type="button"
            style={s.btn}
            disabled={phase === "listening" || !support.ok}
            onClick={startRec}
          >
            Start (zh-CN)
          </button>
          <button
            type="button"
            style={{ ...s.btn, ...s.btnDanger }}
            disabled={phase === "idle"}
            onClick={() => stopRec("user")}
          >
            Stop
          </button>
          <button type="button" style={s.btn} onClick={exportReport}>
            Export report JSON
          </button>
          <span style={s.phase}>phase={phase}</span>
        </div>
        <p style={s.hint}>
          Bootstrap note: if Start fails with not-allowed and no prompt, grant mic for this
          extension origin via Chrome site settings, or re-open this tab after allowing Chrome
          in macOS System Settings → Privacy → Microphone.
        </p>
        <div style={s.out}>
          <div>
            <b>interim:</b> {interim || "—"}
          </div>
          <div>
            <b>finals:</b> {finals || "—"}
          </div>
        </div>
      </section>

      <section style={s.card}>
        <h2 style={s.h2}>Cloud STT / offline probe</h2>
        <p style={s.muted}>
          Toggle network off (OS menu) while listening, or start while offline — expect{" "}
          <code>network</code> / mapped toast. Do not claim PASS on permission alone.
        </p>
      </section>

      <section style={s.card}>
        <h2 style={s.h2}>Log</h2>
        <pre style={s.log}>
          {logs
            .map((l) => `${now()} [${l.level}] ${l.msg}`)
            .join("\n") || "(empty)"}
        </pre>
      </section>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    maxWidth: 720,
    margin: "0 auto",
    padding: 20,
    color: "#111",
    background: "#f6f7f9",
    minHeight: "100vh",
  },
  h1: { fontSize: 20, margin: "0 0 8px" },
  h2: { fontSize: 14, margin: "0 0 10px" },
  muted: { fontSize: 12, color: "#555", marginBottom: 16, lineHeight: 1.5 },
  card: {
    background: "#fff",
    border: "1px solid #e2e4e8",
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  ul: { margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 },
  privacy: { fontSize: 12, lineHeight: 1.55, color: "#333", margin: "0 0 10px" },
  check: { fontSize: 13, display: "flex", gap: 8, alignItems: "center" },
  row: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  btn: {
    fontSize: 13,
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #ccc",
    background: "#fafafa",
    cursor: "pointer",
  },
  btnDanger: { borderColor: "#e88", color: "#a00" },
  phase: { fontSize: 12, color: "#666", marginLeft: 4 },
  hint: { fontSize: 11, color: "#666", marginTop: 10, lineHeight: 1.45 },
  out: {
    marginTop: 10,
    fontSize: 13,
    padding: 10,
    background: "#f0f2f5",
    borderRadius: 6,
    lineHeight: 1.5,
  },
  log: {
    margin: 0,
    fontSize: 11,
    maxHeight: 280,
    overflow: "auto",
    background: "#0d1117",
    color: "#c9d1d9",
    padding: 10,
    borderRadius: 6,
    whiteSpace: "pre-wrap",
  },
}
