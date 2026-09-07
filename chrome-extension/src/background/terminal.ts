// #432 embedded terminal tab lifecycle + Port ⇄ WS relay (spec §3/§4)。
// SW 只转发字节帧，不解析 ANSI；tab 断开 → 主动 terminal.close（杀 PTY 由 companion 执行）。

import {
  isTerminalFrame,
  parseTerminalServerFrame,
  type TerminalServerFrame,
} from "../terminal/wire"

/** Plasmo builds `src/tabs/embedded-terminal.tsx` → `tabs/embedded-terminal.html`. */
export const EMBEDDED_TERMINAL_PATH = "tabs/embedded-terminal.html"
export const TERMINAL_PORT_NAME = "cmspark-terminal"

export function embeddedTerminalUrl(): string {
  return chrome.runtime.getURL(EMBEDDED_TERMINAL_PATH)
}

/** 图谱同款 open-or-focus（knowledge-graph.ts 先例）。 */
export async function openOrFocusEmbeddedTerminal(binding?: { thread_id: string; review_id: string }): Promise<void> {
  const requested = new URL(embeddedTerminalUrl())
  if (binding) {
    requested.searchParams.set("thread_id", binding.thread_id)
    requested.searchParams.set("review_id", binding.review_id)
  }
  const baseUrl = requested.href
  const tabs = await chrome.tabs.query({})
  const existing = tabs.find((t) => {
    if (!t.url) return false
    try {
      const u = new URL(t.url)
      const b = new URL(baseUrl)
      return u.protocol === b.protocol && u.host === b.host && u.pathname === b.pathname
    } catch {
      return false
    }
  })
  if (existing?.id != null) {
    if (binding && new URL(existing.url!).search !== requested.search) throw new Error("已有其他终端任务，请先关闭原终端后再打开此审阅任务。")
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true })
    return
  }
  await chrome.tabs.create({ url: baseUrl })
}

export type TerminalRelay = {
  handleWsFrame: (msg: unknown) => boolean
  detach: () => void
}

/**
 * 建立 tab Port ⇄ companion WS 中继。返回 null 表示发送页面不合法。
 * background/index.ts 持有唯一 relay，并在调用本函数前拒绝第二个 Port。
 */
export function attachTerminalPort(
  port: chrome.runtime.Port,
  wsSend: (frame: Record<string, unknown>) => boolean,
  log: (level: string, event: string, data: Record<string, unknown>) => void,
): TerminalRelay | null {
  try {
    const sender = new URL(port.sender?.url || ""), expected = new URL(embeddedTerminalUrl())
    if (port.sender?.id !== chrome.runtime.id || sender.protocol !== expected.protocol || sender.host !== expected.host
      || sender.pathname !== expected.pathname || port.sender?.frameId !== undefined && port.sender.frameId !== 0) throw new Error("sender")
  } catch {
    try { port.postMessage({ type: "terminal.error", code: "sender_forbidden", error: "仅内嵌终端标签页可连接终端通道" }); port.disconnect() } catch {}
    return null
  }
  let sessionId: string | null = null
  let detached = false

  const relay: TerminalRelay = {
    handleWsFrame(msg) {
      if (detached || !isTerminalFrame(msg)) return false
      if ((msg as { type: string }).type === "terminal.open_tab") return false
      const frame = parseTerminalServerFrame(msg)
      if (!frame) return false
      if (sessionId && frame.id && frame.id !== sessionId) return true // 别的会话帧：吞掉不回（单会话）
      try {
        port.postMessage(frame)
      } catch {
        // tab 已走 — disconnect 监听器会收尾
      }
      return true
    },
    detach() {
      detached = true
    },
  }

  port.onMessage.addListener((raw: unknown) => {
    if (detached) return
    if (!raw || typeof raw !== "object") return
    const m = raw as { type?: unknown; id?: unknown }
    if (typeof m.type !== "string" || !["terminal.open", "terminal.input", "terminal.resize", "terminal.ack", "terminal.ping", "terminal.pause", "terminal.resume", "terminal.close", "terminal.review.submit"].includes(m.type)) return
    if (m.type === "terminal.open") {
      if (sessionId || typeof m.id !== "string" || !m.id) return
      sessionId = m.id
      log("info", "extension.terminal_open_requested", { id: sessionId })
    } else if (!sessionId || m.id !== sessionId) return
    // pi MAJOR-1 ②：WS 未连时 wsSend=false，帧会静默丢失、tab 永挂 connecting——
    // 回推扩展级错误帧让 tab 落 error 态。
    if (wsSend(raw as Record<string, unknown>) !== true) {
      try {
        port.postMessage({ type: "terminal.error", code: "disconnected", error: "companion 未连接，请确认 CMspark 在运行后重开终端" })
      } catch {}
    }
  })

  port.onDisconnect.addListener(() => {
    if (detached) return
    detached = true
    log("info", "extension.terminal_port_disconnected", { id: sessionId })
    if (sessionId) wsSend({ type: "terminal.close", id: sessionId })
    sessionId = null
  })

  return relay
}
