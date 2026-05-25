// WebSocket client for companion communication

type ConnectionState = "connected" | "connecting" | "disconnected"

interface WSClientOptions {
  url: string
  onMessage: (msg: any) => void
  onStateChange: (state: ConnectionState) => void
}

export class WSClient {
  private url: string
  private ws: WebSocket | null = null
  private state: ConnectionState = "disconnected"
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private onMessage: (msg: any) => void
  private onStateChange: (state: ConnectionState) => void

  private readonly MAX_RECONNECT_DELAY = 30000
  private readonly PING_INTERVAL = 20000

  constructor(opts: WSClientOptions) {
    this.url = opts.url
    this.onMessage = opts.onMessage
    this.onStateChange = opts.onStateChange
  }

  connect(silent = false) {
    if (this.ws?.readyState === WebSocket.CONNECTING || this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    this.setState("connecting", silent)

    try {
      this.ws = new WebSocket(this.url)
    } catch (e) {
      this.setState("disconnected", silent)
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.setState("connected")
      this.reconnectDelay = 1000
      this.startPing()
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        this.onMessage(msg)
      } catch {
        // ignore malformed messages
      }
    }

    this.ws.onclose = () => {
      const wasConnected = this.state === "connected"
      this.setState("disconnected", !wasConnected)
      this.ws = null
      this.stopPing()
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onclose will fire after this
    }
  }

  send(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  ping() {
    this.send({ type: "system.ping" })
  }

  getState(): ConnectionState {
    return this.state
  }

  private setState(state: ConnectionState, silent = false) {
    this.state = state
    if (!silent) {
      this.onStateChange(state)
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.state === "disconnected") {
        this.connect(true)
      }
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.MAX_RECONNECT_DELAY)
  }

  private startPing() {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ping()
      }
    }, this.PING_INTERVAL)
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }
}
