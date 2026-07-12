// WebSocket client for companion communication
//
// Designed for MV3 service worker lifecycle:
// - Uses chrome.alarms for reconnection (setInterval dies on worker suspend)
// - On worker wake, checks state and reconnects if needed
// - No setInterval for pings — relies on server-side WS protocol ping/pong
//
// P0-2B authentication: the companion challenges every new connection; the
// extension must reply with proof = HMAC-SHA256(sharedSecret, nonce) before any
// app message is accepted. The shared secret is pasted once by the user
// (Settings → 连接 → WS 配对密钥) and stored in chrome.storage.local. "connected"
// means AUTHENTICATED — onStateChange("connected") fires only after auth.ok, so
// every existing send site (config.get on connect, tab.navigated push, log.event)
// is automatically gated behind auth. While not yet paired, we stop reconnecting
// (no storm) until a secret is provided.

type ConnectionState = "connected" | "connecting" | "disconnected"

interface WSClientOptions {
  url: string
  onMessage: (msg: any) => void
  onStateChange: (state: ConnectionState) => void
}

const WS_SECRET_KEY = "wsSharedSecret"

/** HMAC-SHA256(secret, message) → hex, via Web Crypto. Matches the companion's
 *  crypto.createHmac("sha256", secret).update(nonce): both use the UTF-8 bytes of
 *  the hex secret as the key and the UTF-8 bytes of the nonce as the message. */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export class WSClient {
  private url: string
  private ws: WebSocket | null = null
  private state: ConnectionState = "disconnected"
  private reconnectAttempts = 0
  private onMessage: (msg: any) => void
  private onStateChange: (state: ConnectionState) => void

  /** Authenticated = companion accepted our handshake. App sends are gated on this. */
  private authenticated = false
  /** Messages sent before auth.ok; flushed once authenticated. */
  private pending: object[] = []
  /** No secret stored yet (first run, not paired). Suppress reconnect storm. */
  private unpaired = false

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
      // Stay "connecting" — the companion sends auth.challenge immediately; we
      // promote to "connected" only after auth.ok. (No proactive send here: any
      // pre-auth message is terminated by the companion.)
      this.reconnectAttempts = 0
      this.clearReconnectAlarm()
    }

    this.ws.onmessage = (event) => {
      let msg: any
      try {
        msg = JSON.parse(event.data)
      } catch {
        return // ignore malformed messages
      }

      // Auth handshake messages are handled inline, never forwarded to the app.
      if (msg.type === "auth.challenge") {
        void this.handleChallenge(msg.nonce)
        return
      }
      if (msg.type === "auth.ok") {
        this.authenticated = true
        this.setState("connected")
        this.flushPending()
        return
      }
      if (msg.type === "auth.failed") {
        // Companion terminates the socket after this; onclose handles state.
        this.authenticated = false
        return
      }

      // App-level message. Defense-in-depth: the companion only emits app
      // messages after auth.ok, but never trust wire state alone.
      if (!this.authenticated) return
      try {
        this.onMessage(msg)
      } catch {
        // App handler must never break the WS loop.
      }
    }

    this.ws.onclose = () => {
      const wasConnected = this.state === "connected"
      this.authenticated = false
      this.pending = []
      this.ws = null
      this.setState("disconnected", !wasConnected)
      // If unpaired (no secret), don't storm reconnect — wait for setSecret().
      if (!this.unpaired) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      // onclose will fire after this
    }
  }

  /** Respond to the companion's challenge with proof = HMAC(secret, nonce).
   *  If no secret is stored yet, close and mark unpaired (first-run pairing). */
  private async handleChallenge(nonce: string) {
    const secret = await this.loadSecret()
    if (!secret) {
      this.unpaired = true
      this.authenticated = false
      try { this.ws?.close() } catch { /* closing */ }
      return
    }
    this.unpaired = false
    try {
      const proof = await hmacSha256Hex(secret, nonce)
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "auth.handshake", proof }))
      }
    } catch (err) {
      // Web Crypto failure — treat as failed auth; companion will timeout/terminate.
      // Log without the secret so debugging is possible.
      console.warn("[cmspark-ws] auth handshake crypto failed", err)
    }
  }

  private loadSecret(): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([WS_SECRET_KEY], (result) => {
          const s = result[WS_SECRET_KEY]
          resolve(typeof s === "string" && s ? s : null)
        })
      } catch {
        resolve(null)
      }
    })
  }

  /** Store the pairing secret (from Settings) and (re)connect to authenticate. */
  setSecret(secret: string) {
    this.unpaired = false
    chrome.storage.local.set({ [WS_SECRET_KEY]: secret }, () => {
      // Reset backoff so pairing triggers an immediate reconnect.
      this.reconnectAttempts = 0
      try { this.ws?.close() } catch { /* */ }
      this.ws = null
      this.connect()
    })
  }

  /** Whether a pairing secret is currently stored (for the Settings UI status). */
  hasSecret(): Promise<boolean> {
    return this.loadSecret().then((s) => s !== null)
  }

  private flushPending() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    while (this.pending.length > 0) {
      const data = this.pending.shift()!
      try { this.ws.send(JSON.stringify(data)) } catch { /* */ }
    }
  }

  send(data: object): boolean {
    // Not paired yet — don't open a connection just to have it rejected; the
    // WSClient stays parked until setSecret() supplies a secret.
    if (this.unpaired) return false
    // Authenticated + open → send now.
    if (this.authenticated && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
      return true
    }
    // Open but still handshaking → queue until auth.ok (sending pre-auth makes the
    // companion terminate the connection).
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.authenticated) {
      this.pending.push(data)
      return true
    }
    // Not open → trigger reconnect.
    if (this.ws && this.ws.readyState !== WebSocket.CONNECTING) {
      this.ws.close()
      this.ws = null
      this.setState("disconnected")
      this.connect()
    }
    return false
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
    // No secret stored — nothing to reconnect with; wait for setSecret().
    if (this.unpaired) return
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Still connected — send a ping to verify liveness (queued if mid-handshake).
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
