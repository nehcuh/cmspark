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
export async function openOrFocusEmbeddedTerminal(): Promise<void> {
  const baseUrl = embeddedTerminalUrl()
  const tabs = await chrome.tabs.query({})
  const existing = tabs.find((t) => {
    if (!t.url) return false
    try {
      const u = new URL(t.url)
      const b = new URL(baseUrl)
      return u.origin === b.origin && u.pathname.endsWith("/tabs/embedded-terminal.html")
    } catch {
      return false
    }
  })
  if (existing?.id != null) {
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
 * 建立 tab Port ⇄ companion WS 中继。返回 null = 已有会话在跑（同时最多 1 个 PTY，
 * spec §5；第二个 tab 连接被拒，由 tab 侧展示「已有终端会话」）。
 */
export function attachTerminalPort(
  port: chrome.runtime.Port,
  wsSend: (frame: Record<string, unknown>) => boolean,
  log: (level: string, event: string, data: Record<string, unknown>) => void,
): TerminalRelay | null {
  let sessionId: string | null = null
  let detached = false

  const relay: TerminalRelay = {
    handleWsFrame(msg) {
      if (detached || !isTerminalFrame(msg)) return false
      if ((msg as { type: string }).type === "terminal.open_tab") return false
      const frame = parseTerminalServerFrame(msg)
      if (!frame) return false
      if (sessionId && frame.id !== sessionId) return true // 别的会话帧：吞掉不回（单会话）
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
    if (typeof m.type !== "string" || !m.type.startsWith("terminal.")) return
    if (m.type === "terminal.open") {
      if (typeof m.id !== "string" || !m.id) return
      sessionId = m.id
      log("info", "extension.terminal_open_requested", { id: sessionId })
    }
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
