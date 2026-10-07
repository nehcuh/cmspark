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

type TermStatus = "connecting" | "running" | "closed" | "error"

const STATUS_COPY: Record<TermStatus, string> = {
  connecting: "等待启动终端…请回到 CMspark 侧栏批准确认",
  running: "",
  closed: "终端会话已结束",
  error: "终端不可用",
}

let sessionSeq = 0

export function TerminalApp() {
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

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      theme: {
        background: tokens.darkBg,
        foreground: tokens.darkText,
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    const sessionId = `term.${Date.now().toString(36)}.${(sessionSeq += 1)}`
    const query = new URLSearchParams(window.location.search)
    const threadId = query.get("thread_id"), reviewId = query.get("review_id")
    let inputSeq = 0
    let closedByUs = false
    let sessionEnded = false
    let ready = false
    let pendingResize: { cols: number; rows: number } | null = null
    // 会话 keepalive：静默（无输入无输出）不等于孤儿——每 25s ping 重置服务端心跳（spec §4）
    const pingTimer = setInterval(() => {
      send({ type: "terminal.ping", id: sessionId })
    }, 25_000)
    // Confirmation may take 45s, followed by the bounded login-env/native spawn work.
    const OPEN_WATCHDOG_MS = 60_000
    let opened = false
    const watchdog = setTimeout(() => {
      if (!opened) {
        send({ type: "terminal.close", id: sessionId })
        sessionEnded = true
        clearInterval(pingTimer)
        subData.dispose()
        setStatus("error")
        setDetail("companion 未响应：请确认 CMspark 在运行，且设置中已开启「内嵌终端」")
      }
    }, OPEN_WATCHDOG_MS)

    const port = chrome.runtime.connect({ name: TERMINAL_PORT_NAME })

    const send = (frame: unknown) => {
      if (sessionEnded) return
      // L2 is still pending: the server has no owned PTY for input/resize/heartbeat yet.
      const type = (frame as { type?: string }).type
      if (!ready && (type === "terminal.input" || type === "terminal.resize" || type === "terminal.ping")) return
      try {
        port.postMessage(frame)
      } catch {
        // SW 已走 — 下面 onDisconnect 不保证触发，直接落终态
        setStatus("closed")
        sessionEnded = true
        clearInterval(pingTimer)
      }
    }
    submitRef.current = report => send({ type: "terminal.review.submit", id: sessionId, user_gesture: true, report })

    const open = () => {
      fit.fit()
      send({
        type: "terminal.open",
        id: sessionId,
        cols: term.cols,
        rows: term.rows,
        user_gesture: true,
        ...(threadId ? { thread_id: threadId } : {}),
        ...(reviewId ? { review_id: reviewId } : {}),
      })
    }

    port.onMessage.addListener((raw: unknown) => {
      const frame = raw as TerminalServerFrame
      if (!frame || sessionEnded) return
      if ((frame as { id?: string }).id && (frame as { id?: string }).id !== sessionId) return
      // 扩展级错误无会话 id（busy/disconnected/watchdog 同类），不受会话过滤
      if (frame.type === "terminal.error") {
        if (opened) {
          setDetail(frame.error)
          setReportStatus(frame.error)
          setSubmitting(false)
          if (frame.code === "disconnected" || frame.error === "TERMINAL_SESSION_NOT_OWNED") {
            sessionEnded = true
            clearInterval(pingTimer)
            setStatus("closed")
            setDetail("连接中断，终端进程已结束。请关闭此页并重新发起编程接力。")
            subData.dispose()
          }
          return
        }
        opened = true // 停 watchdog
        clearTimeout(watchdog)
        send({ type: "terminal.close", id: sessionId })
        sessionEnded = true
        clearInterval(pingTimer)
        setStatus("error")
        setDetail(frame.error)
        subData.dispose()
        return
      }
      if ((frame as { id?: string }).id !== sessionId) return
      switch (frame.type) {
        case "terminal.opened":
          opened = true
          ready = true
          clearTimeout(watchdog)
          setDetail("")
          setStatus("running")
          fit.fit()
          send({ type: "terminal.resize", id: sessionId, ...(pendingResize || { cols: term.cols, rows: term.rows }) })
          pendingResize = null
          term.focus()
          if (frame.review_prompt) setReviewPrompt(frame.review_prompt)
          break
        case "terminal.review.received":
          setDetail("")
          setSubmitting(false)
          setReportStatus(`已回传原任务。回执：${frame.receipt_id}。报告与覆盖仍待核实。`)
          break
        case "terminal.data": {
          const seq = frame.seq
          // write 回调 = 「已解析」信号（xterm flowcontrol 指南同构），ack 驱动服务端水位
          term.write(terminalB64Decode(frame.b64), () => {
            send({ type: "terminal.ack", id: sessionId, seq })
          })
          break
        }
        case "terminal.closed": {
          sessionEnded = true
          clearInterval(pingTimer)
          setSubmitting(false)
          opened = true // 终态到达，停 watchdog
          subData.dispose() // pi NIT-2：closed 后不再发 input
          setStatus(frame.error ? "error" : "closed")
          if (frame.error) setDetail(frame.error)
          else if (frame.code === "unsupported") setDetail("当前平台暂不支持内嵌终端（首发仅 macOS）")
          else if (typeof frame.code === "number") setDetail(`进程退出码 ${frame.code}`)
          break
        }
        default:
          break
      }
    })

    port.onDisconnect.addListener(() => {
      if (closedByUs) return
      sessionEnded = true
      clearInterval(pingTimer)
      subData.dispose()
      setSubmitting(false)
      opened = true // 停 watchdog
      setStatus((s) => (s === "running" ? "closed" : s === "connecting" ? "error" : s))
      setDetail((d) => d || "连接中断")
    })

    const subData = term.onData((data) => {
      inputSeq += 1
      send({ type: "terminal.input", id: sessionId, seq: inputSeq, b64: terminalB64Encode(data) })
    })

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const subResize = term.onResize(({ cols, rows }) => {
      pendingResize = { cols, rows }
      if (resizeTimer) return
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (ready && pendingResize) {
          send({ type: "terminal.resize", id: sessionId, ...pendingResize })
          pendingResize = null
        }
      }, 50)
    })

    const onWinResize = () => fit.fit()
    window.addEventListener("resize", onWinResize)
    const observer = new ResizeObserver(onWinResize)
    observer.observe(host)

    open()

    return () => {
      closedByUs = true
      clearInterval(pingTimer)
      clearTimeout(watchdog)
      if (resizeTimer) clearTimeout(resizeTimer)
      window.removeEventListener("resize", onWinResize)
      observer.disconnect()
      subData.dispose()
      subResize.dispose()
      try {
        port.postMessage({ type: "terminal.close", id: sessionId })
        port.disconnect()
      } catch {
        // 已断
      }
      term.dispose()
      submitRef.current = null
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
          onClick={() => window.close()}
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
