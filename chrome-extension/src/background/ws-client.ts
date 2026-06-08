// WebSocket client for companion communication
//
// Designed for MV3 service worker lifecycle:
// - Uses chrome.alarms for reconnection (setInterval dies on worker suspend)
// - On worker wake, checks state and reconnects if needed
// - No setInterval for pings — relies on server-side WS protocol ping/pong

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
  private reconnectAttempts = 0
  private onMessage: (msg: any) => void
  private onStateChange: (state: ConnectionState) => void

  private readonly ALARM_NAME = "cmspark-ws-reconnect"
  private readonly MAX_RECONNECT_DELAY = 30000

  constructor(opts: WSClientOptions) {
    this.url = opts.url
    this.onMessage = opts.onMessage
    this.onStateChange = opts.onStateChange
  }

  connect(silent = false) {
    // If still open or connecting, skip
    if (this.ws?.readyState === WebSocket.CONNECTING || this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    this.setState("connecting", silent)

    try {
      this.ws = new WebSocket(this.url)
    } catch {
      this.setState("disconnected", silent)
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.setState("connected")
      this.reconnectAttempts = 0
      this.clearReconnectAlarm()
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

  /**
   * Called when the service worker wakes up.
   * Checks if the WebSocket is still alive; reconnects if dead.
   */
  checkAndReconnect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Still connected — send a ping to verify liveness
      this.ping()
      return
    }

    // Connection lost while worker was suspended — reconnect
    this.ws = null
    this.setState("disconnected", true)
    this.connect(true)
  }

  private setState(state: ConnectionState, silent = false) {
    this.state = state
    if (!silent) {
      this.onStateChange(state)
    }
  }

  /**
   * Schedule reconnect using chrome.alarms (survives service worker suspension).
   * setInterval/setTimeout are NOT reliable in MV3 service workers.
   */
  private scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.MAX_RECONNECT_DELAY)
    this.reconnectAttempts++

    chrome.alarms.create(this.ALARM_NAME, { delayInMinutes: delay / 60000 })
  }

  private clearReconnectAlarm() {
    chrome.alarms.clear(this.ALARM_NAME)
  }
}
