// #432 embedded terminal wire contract (spec docs/superpowers/specs/2026-09-06-embedded-terminal-design.md §4).
// 复用既有 WS JSON 语义（10MB 闸不动、不拆 binary）；终端字节流一律 base64 短块。
// Fail-closed：形状不符的帧返回 null，调用方丢弃，不猜。

/** 单帧 base64 净荷上限（spec §4：≤16KiB）。 */
export const TERMINAL_FRAME_PAYLOAD_MAX = 16 * 1024
/** 写缓冲高水位：xterm 未 ack 的帧数超过即等 pause（服务端按 ack 水位 pty.pause）。 */
export const TERMINAL_ACK_HIGH_WATER = 64

// --- client → companion ---

export type TerminalClientFrame =
  | { type: "terminal.open"; id: string; cols: number; rows: number; user_gesture: true; cwd?: string; argv?: string[]; thread_id?: string }
  | { type: "terminal.input"; id: string; seq: number; b64: string }
  | { type: "terminal.resize"; id: string; cols: number; rows: number }
  | { type: "terminal.ack"; id: string; seq: number }
  | { type: "terminal.close"; id: string }

// --- companion → client ---

export type TerminalServerFrame =
  | { type: "terminal.opened"; id: string; pid: number; platform: string }
  | { type: "terminal.data"; id: string; seq: number; b64: string }
  | { type: "terminal.pause"; id: string }
  | { type: "terminal.resume"; id: string }
  | { type: "terminal.closed"; id: string; code?: number | string; signal?: string; error?: string }

/** UTF-8 安全 base64（CJK 不炸）。 */
export function terminalB64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function terminalB64Decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v ? v : null
}
function asInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null
}

/** 解析服务端帧；任何形状不符 → null（调用方丢弃）。 */
export function parseTerminalServerFrame(raw: unknown): TerminalServerFrame | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const type = asStr(o.type)
  const id = asStr(o.id)
  if (!type || !id) return null
  switch (type) {
    case "terminal.opened": {
      const pid = asInt(o.pid)
      const platform = asStr(o.platform)
      if (pid == null || !platform) return null
      return { type, id, pid, platform }
    }
    case "terminal.data": {
      const seq = asInt(o.seq)
      const b64 = asStr(o.b64)
      if (seq == null || !b64) return null
      return { type, id, seq, b64 }
    }
    case "terminal.pause":
    case "terminal.resume":
      return { type, id }
    case "terminal.closed": {
      const code =
        typeof o.code === "number" || typeof o.code === "string" ? o.code : undefined
      const signal = typeof o.signal === "string" ? o.signal : undefined
      const error = typeof o.error === "string" ? o.error : undefined
      return { type, id, ...(code !== undefined ? { code } : {}), ...(signal ? { signal } : {}), ...(error ? { error } : {}) }
    }
    default:
      return null
  }
}

/** 本帧是否是 terminal.* 族（background 路由用，窄判定）。 */
export function isTerminalFrame(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === "object" &&
    typeof (raw as { type?: unknown }).type === "string" &&
    ((raw as { type: string }).type.startsWith("terminal.") ||
      (raw as { type: string }).type === "terminal.open_tab")
  )
}
