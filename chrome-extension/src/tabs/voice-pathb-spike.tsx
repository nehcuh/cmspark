/**
 * Path B Local STT Platform Spike — open as extension tab:
 *   chrome-extension://<id>/tabs/voice-pathb-spike.html
 *
 * Human gates: S0 gUM grant, S1 MediaRecorder sizes, S2 PCM/WAV encode in-page.
 * Machine gates live in unit tests + scripts/voice-pathb-*.
 */
import { useCallback, useMemo, useRef, useState } from "react"
import {
  detectLocalMediaCapture,
  estimatePcmS16leBytes,
  LOCAL_STT_MAX_RECORD_MS,
  LOCAL_STT_SAMPLE_RATE,
  pcmWithinSessionBudget,
} from "../sidepanel/voice/local-stt-detect"
import { encodeMonoFloatToWav16k, splitIntoChunks } from "../sidepanel/voice/pcm-encode"

type LogLine = { t: number; msg: string }

export default function VoicePathbSpikePage() {
  const [logs, setLogs] = useState<LogLine[]>([])
  const [recording, setRecording] = useState(false)
  const [lastBlobBytes, setLastBlobBytes] = useState<number | null>(null)
  const [lastWavBytes, setLastWavBytes] = useState<number | null>(null)
  const [lastChunks, setLastChunks] = useState<number | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const startedAt = useRef(0)

  const media = useMemo(() => detectLocalMediaCapture(window as any), [])
  const est45 = estimatePcmS16leBytes(LOCAL_STT_MAX_RECORD_MS)

  const log = useCallback((msg: string) => {
    setLogs((prev) => [...prev, { t: Date.now(), msg }].slice(-80))
  }, [])

  const stopAll = useCallback(() => {
    try {
      recRef.current?.stop()
    } catch {
      /* */
    }
    recRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setRecording(false)
  }, [])

  const startRecord = async (maxMs: number) => {
    if (!media.ok) {
      log(`detect fail: ${media.ok === false ? media.reason : "unknown"}`)
      return
    }
    stopAll()
    chunksRef.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : ""
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      recRef.current = rec
      rec.ondataavailable = (ev) => {
        if (ev.data?.size) chunksRef.current.push(ev.data)
      }
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" })
        setLastBlobBytes(blob.size)
        const elapsed = Date.now() - startedAt.current
        log(`MediaRecorder stop: blob=${blob.size}B mime=${rec.mimeType || "?"} elapsed≈${elapsed}ms`)
        log(
          `budget check (PCM estimate for elapsed): ${estimatePcmS16leBytes(elapsed)}B / cap ok=${pcmWithinSessionBudget(elapsed)}`,
        )
        // S2: decode via AudioContext → float → WAV 16k (no ffmpeg)
        try {
          const ab = await blob.arrayBuffer()
          const ctx = new AudioContext()
          const decoded = await ctx.decodeAudioData(ab.slice(0))
          const ch0 = decoded.getChannelData(0)
          const wav = encodeMonoFloatToWav16k(ch0, decoded.sampleRate)
          setLastWavBytes(wav.byteLength)
          const parts = splitIntoChunks(wav, 256 * 1024)
          setLastChunks(parts.length)
          log(
            `S2 PCM/WAV: srcRate=${decoded.sampleRate} → 16k wav=${wav.byteLength}B chunks=${parts.length}`,
          )
          await ctx.close()
        } catch (e: any) {
          log(`S2 encode failed: ${e?.message || e}`)
        }
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setRecording(false)
      }
      rec.onerror = () => log("MediaRecorder error")
      startedAt.current = Date.now()
      rec.start(250)
      setRecording(true)
      log(`recording start maxMs=${maxMs} mime=${rec.mimeType || "default"}`)
      window.setTimeout(() => {
        if (recRef.current === rec && rec.state === "recording") {
          log("auto-stop timer")
          rec.stop()
        }
      }, maxMs)
    } catch (e: any) {
      log(`getUserMedia failed: ${e?.name || ""} ${e?.message || e}`)
      setRecording(false)
    }
  }

  const exportReport = () => {
    const report = {
      spike: "voice-pathb-s0-s2-human",
      time: new Date().toISOString(),
      mediaDetect: media,
      estPcm45s: est45,
      lastBlobBytes,
      lastWavBytes,
      lastChunks,
      sampleRateTarget: LOCAL_STT_SAMPLE_RATE,
      logs,
      userAgent: navigator.userAgent,
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `voice-pathb-spike-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    log("exported report JSON")
  }

  return (
    <div
      style={{
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        maxWidth: 640,
        margin: "24px auto",
        padding: 20,
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: 18 }}>Path B Local STT Spike (S0–S2 human)</h1>
      <p style={{ fontSize: 13, color: "#444" }}>
        Open: <code>chrome-extension://&lt;id&gt;/tabs/voice-pathb-spike.html</code>
      </p>
      <p style={{ fontSize: 13 }}>
        Media detect:{" "}
        <b>{media.ok ? "OK (gUM + MediaRecorder)" : `FAIL (${"reason" in media ? media.reason : "?"})`}</b>
      </p>
      <p style={{ fontSize: 13 }}>
        45s PCM estimate: <code>{est45}</code> B (budget OK={String(pcmWithinSessionBudget(LOCAL_STT_MAX_RECORD_MS))})
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" disabled={recording || !media.ok} onClick={() => startRecord(5_000)}>
          Record 5s
        </button>
        <button type="button" disabled={recording || !media.ok} onClick={() => startRecord(45_000)}>
          Record 45s
        </button>
        <button type="button" disabled={!recording} onClick={stopAll}>
          Stop
        </button>
        <button type="button" onClick={exportReport}>
          Export report JSON
        </button>
      </div>
      <p style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
        last webm/opus blob: {lastBlobBytes ?? "—"} · wav16k: {lastWavBytes ?? "—"} · chunks:{" "}
        {lastChunks ?? "—"}
      </p>
      <pre
        style={{
          marginTop: 16,
          fontSize: 11,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: 12,
          maxHeight: 360,
          overflow: "auto",
        }}
      >
        {logs.map((l) => `${new Date(l.t).toISOString().slice(11, 19)} ${l.msg}`).join("\n") ||
          "(no logs yet)"}
      </pre>
    </div>
  )
}
