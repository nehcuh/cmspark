// #432 内嵌终端 tab 主体（spec §1/§3/§5）。
// xterm.js（canvas 渲染器，无 webgl/wasm CSP 争议）+ Port ⇄ background ⇄ companion PTY。
// 诚实状态机：connecting → running → closed/unsupported/error；不做只读假终端。

import { useEffect, useRef, useState } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"

import { TERMINAL_PORT_NAME } from "../background/terminal"
import {
  terminalB64Decode,
  terminalB64Encode,
  type TerminalServerFrame,
} from "./wire"
import { tokens } from "../sidepanel/ui/tokens"

type TermStatus = "connecting" | "reconnecting" | "running" | "closed" | "error"

const STATUS_COPY: Record<TermStatus, string> = {
  connecting: "等待启动终端…请回到 CMspark 侧栏批准确认",
  running: "",
  reconnecting: "连接中断，正在恢复（最多 30 秒）",
  closed: "终端会话已结束",
  error: "终端不可用",
}

let sessionSeq = 0

export function TerminalApp() {
  const closeRef = useRef<(() => void) | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<TermStatus>("connecting")
  const [detail, setDetail] = useState("")
  const [reviewPrompt, setReviewPrompt] = useState("")
  const [reportText, setReportText] = useState("")
  const [reportStatus, setReportStatus] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const submitRef = useRef<((report: unknown) => void) | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13,
      cursorBlink: true, convertEol: false, scrollback: 5000,
      theme: { background: tokens.darkBg, foreground: tokens.darkText } })
    const fit = new FitAddon()
    term.loadAddon(fit); term.open(host); fit.fit()
    const sessionId = `term.${Date.now().toString(36)}.${(sessionSeq += 1)}`
    const query = new URLSearchParams(window.location.search)
    const threadId = query.get("thread_id"), reviewId = query.get("review_id")
    let inputSeq = 0, lastWritten = 0, lastQueued = 0
    let closedByUs = false, sessionEnded = false, ready = false, opened = false
    let resumeToken: string | undefined
    let port: chrome.runtime.Port
    let portLost = false
    let pendingResize: { cols: number; rows: number } | null = null
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let resizeTimer: ReturnType<typeof setTimeout> | undefined

    const end = (message: string, failed = false) => {
      if (sessionEnded) return
      sessionEnded = true; ready = false; resumeToken = undefined
      clearInterval(pingTimer); clearTimeout(watchdog); clearTimeout(recoveryTimer); clearTimeout(retryTimer)
      subData.dispose(); setSubmitting(false); setStatus(failed ? "error" : "closed"); setDetail(message)
    }
    // Reattach never replays commands/pastes. Only server output has sequence/ack replay.
    const send = (frame: unknown) => {
      if (sessionEnded) return
      const type = (frame as { type?: string }).type
      if (!ready && ["terminal.input", "terminal.resize", "terminal.ping", "terminal.review.submit"].includes(type || "")) return
      try { port.postMessage(frame) } catch { recover(true) }
    }
    const attach = () => {
      if (sessionEnded || !resumeToken) return
      send({ type: "terminal.attach", id: sessionId, resume_token: resumeToken, last_seq: lastWritten })
    }
    const retry = () => {
      if (retryTimer || sessionEnded) return
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        if (portLost) { connect(); portLost = false }
        attach()
      }, 500)
    }
    const recover = (lostPort = false) => {
      if (sessionEnded || closedByUs) return
      if (!opened || !resumeToken) { end("启动时连接中断，请重新打开终端并确认。", true); return }
      ready = false; portLost ||= lostPort
      setSubmitting(false); setStatus("reconnecting"); setDetail("连接恢复后将附着原进程；输入暂停。")
      // Repeated errors cannot extend the fixed recovery window.
      if (!recoveryTimer) recoveryTimer = setTimeout(() => end("恢复窗口已过期，终端进程将清理。请重新打开并确认。"), 30_000)
      if (portLost) retry()
    }
    const onFrame = (raw: unknown) => {
      const frame = raw as TerminalServerFrame
      if (!frame || sessionEnded || frame.id && frame.id !== sessionId) return
      if (frame.type === "terminal.detached") { recover(); return }
      if (frame.type === "terminal.error") {
        setSubmitting(false); setReportStatus(frame.error)
        if (opened && frame.error === "TERMINAL_REATTACH_UNAVAILABLE") { recover(); retry(); return }
        if (frame.code === "disconnected" && opened) { recover(); return }
        if (!opened || frame.error === "TERMINAL_CONTEXT_CHANGED" || frame.error === "TERMINAL_SESSION_NOT_OWNED") {
          end(frame.error, true); return
        }
        setDetail(frame.error); return
      }
      if (frame.id !== sessionId) return
      switch (frame.type) {
        case "terminal.opened":
        case "terminal.attached":
          if (frame.type === "terminal.opened") {
            resumeToken = frame.resume_token
            if (frame.review_prompt) setReviewPrompt(frame.review_prompt)
          }
          opened = true; ready = true
          clearTimeout(watchdog); clearTimeout(recoveryTimer); recoveryTimer = undefined
          clearTimeout(retryTimer); retryTimer = undefined
          setDetail(""); setStatus("running"); fit.fit()
          if (lastWritten) send({ type: "terminal.ack", id: sessionId, seq: lastWritten })
          send({ type: "terminal.resize", id: sessionId, ...(pendingResize || { cols: term.cols, rows: term.rows }) })
          pendingResize = null; term.focus(); break
        case "terminal.data": {
          if (frame.seq <= lastQueued) { if (frame.seq <= lastWritten) send({ type: "terminal.ack", id: sessionId, seq: lastWritten }); break }
          lastQueued = frame.seq
          term.write(terminalB64Decode(frame.b64), () => {
            lastWritten = Math.max(lastWritten, frame.seq)
            send({ type: "terminal.ack", id: sessionId, seq: lastWritten })
          })
          break
        }
        case "terminal.review.received":
          setDetail(""); setSubmitting(false)
          setReportStatus(`已回传原任务。回执：${frame.receipt_id}。报告与覆盖仍待核实。`); break
        case "terminal.closed":
          end(frame.error || (typeof frame.code === "number" ? `进程退出码 ${frame.code}` : `终端会话已结束：${frame.code || "closed"}`), !!frame.error); break
      }
    }
    const connect = () => {
      try {
        const current = chrome.runtime.connect({ name: TERMINAL_PORT_NAME })
        port = current
        current.onMessage.addListener(onFrame)
        current.onDisconnect.addListener(() => { if (port === current) recover(true) })
      } catch { portLost = true; retry() }
    }
    const subData = term.onData(data => {
      if (!ready) return
      send({ type: "terminal.input", id: sessionId, seq: ++inputSeq, b64: terminalB64Encode(data) })
    })
    const subResize = term.onResize(({ cols, rows }) => {
      pendingResize = { cols, rows }
      if (resizeTimer) return
      resizeTimer = setTimeout(() => {
        resizeTimer = undefined
        if (ready && pendingResize) { send({ type: "terminal.resize", id: sessionId, ...pendingResize }); pendingResize = null }
      }, 50)
    })
    const pingTimer = setInterval(() => send({ type: "terminal.ping", id: sessionId }), 25_000)
    const watchdog = setTimeout(() => {
      if (!opened) { send({ type: "terminal.close", id: sessionId }); end("companion 未响应：请确认 CMspark 在运行，且设置中已开启「内嵌终端」", true) }
    }, 60_000)
    const close = () => {
      closedByUs = true
      send({ type: "terminal.close", id: sessionId })
      end("终端会话已结束")
      try { port.disconnect() } catch { /* lease reclaims if offline */ }
    }
    closeRef.current = close
    submitRef.current = report => send({ type: "terminal.review.submit", id: sessionId, user_gesture: true, report })
    const onWinResize = () => fit.fit()
    window.addEventListener("resize", onWinResize)
    window.addEventListener("pagehide", close)
    const observer = new ResizeObserver(onWinResize); observer.observe(host)
    connect()
    send({ type: "terminal.open", id: sessionId, cols: term.cols, rows: term.rows, user_gesture: true,
      ...(threadId ? { thread_id: threadId } : {}), ...(reviewId ? { review_id: reviewId } : {}) })
    return () => {
      close(); clearTimeout(resizeTimer)
      window.removeEventListener("resize", onWinResize); window.removeEventListener("pagehide", close)
      observer.disconnect(); subData.dispose(); subResize.dispose(); term.dispose()
      submitRef.current = null; closeRef.current = null
    }
  }, [])

  return (
    <div className="cm-terminal" style={{ display: "flex", flexDirection: "column", height: "100dvh", background: tokens.darkBg, fontFamily: tokens.font }}>
      <style>{`
        .cm-terminal{font-size:13px;line-height:1.6}
        .cm-terminal button{min-height:36px;border:1px solid ${tokens.darkBorder};border-radius:8px;background:${tokens.darkElevated};color:${tokens.darkText};padding:6px 12px;cursor:pointer;font:inherit}
        .cm-terminal button:disabled{opacity:.5;cursor:not-allowed}
        .cm-terminal textarea{box-sizing:border-box;border:1px solid ${tokens.darkBorder};border-radius:8px;background:${tokens.darkElevated};color:${tokens.darkText};padding:12px;font-family:${tokens.fontMono};font-size:12px;resize:vertical}
        .cm-terminal :focus-visible{outline:2px solid ${tokens.darkAccent};outline-offset:2px}
        .cm-terminal summary{cursor:pointer;font-weight:600;min-height:32px}
        .cm-terminal [role=status]{display:block;margin-top:8px;color:${tokens.darkMuted}}
        @media(max-width:480px){.cm-terminal-header{flex-wrap:wrap;gap:6px!important}.cm-terminal details{padding:10px 12px!important}}
      `}</style>
      <div className="cm-terminal-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 20px",
          background: tokens.darkElevated,
          color: tokens.darkText,
          fontSize: 12,
          borderBottom: `1px solid ${tokens.darkBorder}`,
        }}
      >
        <strong>内嵌终端</strong>
        <span style={{ opacity: 0.7 }}>
          {status === "running" ? "运行中" : STATUS_COPY[status]}
          {detail ? ` · ${detail}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          style={{ fontSize: 12, padding: "2px 10px", cursor: "pointer" }}
          onClick={() => { closeRef.current?.(); window.close() }}
        >
          关闭
        </button>
      </div>
      {reviewPrompt && (
        <details style={{ color: tokens.darkText, padding: "14px 20px", maxHeight: "48vh", overflow: "auto", flexShrink: 0 }} open>
          <summary>代码审阅任务与报告回传</summary>
          <p>在下方终端自行启动已安装的 Agent，再将提示词粘贴到 Agent 内。请勿粘贴到 shell 命令行。</p>
          <textarea aria-label="审阅提示词" readOnly value={reviewPrompt} style={{ width: "100%", height: 100 }} />
          <button type="button" onClick={() => navigator.clipboard.writeText(reviewPrompt).catch(() => setReportStatus("复制失败，请手动复制提示词"))}>复制审阅提示词</button>
          <p>将 Agent 输出的 JSON 报告粘贴在此，核对完整内容后提交。确认表示同意导入，不代表代码或测试通过。</p>
          <textarea aria-label="Agent 审阅报告 JSON" value={reportText} maxLength={65536} onChange={event => setReportText(event.target.value)} style={{ width: "100%", height: 100 }} />
          <button type="button" disabled={status !== "running" || submitting || !reportText.trim()} onClick={() => {
            try {
              if (new TextEncoder().encode(reportText).length > 65536) throw new Error("报告不得超过 64 KiB")
              const report = JSON.parse(reportText)
              setSubmitting(true); setReportStatus("等待确认并保存…")
              submitRef.current?.(report)
            } catch (error) { setReportStatus((error as Error).message) }
          }}>确认内容并发送到 CMspark</button>
          <span role="status">{reportStatus}</span>
        </details>
      )}
      <div ref={hostRef} style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "4px 0 0 8px" }} />
    </div>
  )
}
