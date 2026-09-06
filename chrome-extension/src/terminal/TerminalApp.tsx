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
  connecting: "正在开门并启动终端…（首次需确认）",
  running: "",
  closed: "终端会话已结束",
  error: "终端不可用",
}

let sessionSeq = 0

export function TerminalApp() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<TermStatus>("connecting")
  const [detail, setDetail] = useState("")

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
        background: "#1e1e28",
        foreground: "#e8e8ee",
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    const sessionId = `term.${Date.now().toString(36)}.${(sessionSeq += 1)}`
    let inputSeq = 0
    let closedByUs = false
    // 会话 keepalive：静默（无输入无输出）不等于孤儿——每 25s ping 重置服务端心跳（spec §4）
    const pingTimer = setInterval(() => {
      send({ type: "terminal.ping", id: sessionId })
    }, 25_000)
    // pi MAJOR-1 ③：开门 watchdog——12s 无 opened/error 一律落 error，不永转圈
    const OPEN_WATCHDOG_MS = 12_000
    let opened = false
    const watchdog = setTimeout(() => {
      if (!opened) {
        setStatus("error")
        setDetail("companion 未响应：请确认 CMspark 在运行，且设置中已开启「内嵌终端」")
      }
    }, OPEN_WATCHDOG_MS)

    const port = chrome.runtime.connect({ name: TERMINAL_PORT_NAME })

    const send = (frame: unknown) => {
      try {
        port.postMessage(frame)
      } catch {
        // SW 已走 — 下面 onDisconnect 不保证触发，直接落终态
        setStatus("closed")
      }
    }

    const open = () => {
      fit.fit()
      send({
        type: "terminal.open",
        id: sessionId,
        cols: term.cols,
        rows: term.rows,
        user_gesture: true,
      })
    }

    port.onMessage.addListener((raw: unknown) => {
      const frame = raw as TerminalServerFrame
      if (!frame) return
      // 扩展级错误无会话 id（busy/disconnected/watchdog 同类），不受会话过滤
      if (frame.type === "terminal.error") {
        opened = true // 停 watchdog
        setStatus("error")
        setDetail(frame.error)
        subData.dispose()
        return
      }
      if ((frame as { id?: string }).id !== sessionId) return
      switch (frame.type) {
        case "terminal.opened":
          opened = true
          setStatus("running")
          term.focus()
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
      opened = true // 停 watchdog
      setStatus((s) => (s === "running" ? "closed" : s === "connecting" ? "error" : s))
      setDetail((d) => d || "连接中断")
    })

    const subData = term.onData((data) => {
      inputSeq += 1
      send({ type: "terminal.input", id: sessionId, seq: inputSeq, b64: terminalB64Encode(data) })
    })

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let pendingResize: { cols: number; rows: number } | null = null
    const subResize = term.onResize(({ cols, rows }) => {
      pendingResize = { cols, rows }
      if (resizeTimer) return
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (pendingResize) send({ type: "terminal.resize", id: sessionId, ...pendingResize })
        pendingResize = null
      }, 50)
    })

    const onWinResize = () => fit.fit()
    window.addEventListener("resize", onWinResize)

    open()

    return () => {
      closedByUs = true
      clearInterval(pingTimer)
      clearTimeout(watchdog)
      if (resizeTimer) clearTimeout(resizeTimer)
      window.removeEventListener("resize", onWinResize)
      subData.dispose()
      subResize.dispose()
      try {
        port.postMessage({ type: "terminal.close", id: sessionId })
        port.disconnect()
      } catch {
        // 已断
      }
      term.dispose()
    }
  }, [])

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#1e1e28" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 14px",
          background: "#262631",
          color: "#e8e8ee",
          fontSize: 12,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
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
      <div ref={hostRef} style={{ flex: 1, padding: "4px 0 0 8px" }} />
    </div>
  )
}
