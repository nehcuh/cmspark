// Minimal NDJSON JSON-RPC 2.0 over child process stdio (ACP Client half).
// Spec: https://agentclientprotocol.com — initialize / session/* / notifications.

import type { ChildProcessWithoutNullStreams } from "child_process"
import { EventEmitter } from "events"
import { killAcpChild } from "./win-spawn"

export type JsonRpcId = string | number

export type JsonRpcMessage = {
  jsonrpc: "2.0"
  id?: JsonRpcId | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class JsonRpcStdioClient extends EventEmitter {
  private nextId = 1
  private pending = new Map<string, Pending>()
  private buf = ""
  private closed = false

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    super()
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => this.onData(chunk))
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      this.emit("stderr", chunk)
    })
    child.on("close", () => this.shutdown(new Error("process closed")))
    child.on("error", (err) => this.shutdown(err instanceof Error ? err : new Error(String(err))))
  }

  private onData(chunk: string): void {
    this.buf += chunk
    let idx: number
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      let msg: JsonRpcMessage
      try {
        msg = JSON.parse(line) as JsonRpcMessage
      } catch {
        // Non-JSON line — treat as log/agent text for CLI hybrids
        this.emit("raw_line", line)
        continue
      }
      this.dispatch(msg)
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const key = String(msg.id)
      const p = this.pending.get(key)
      if (!p) return
      this.pending.delete(key)
      clearTimeout(p.timer)
      if (msg.error) {
        p.reject(new Error(msg.error.message || `jsonrpc error ${msg.error.code}`))
      } else {
        p.resolve(msg.result)
      }
      return
    }
    if (msg.method) {
      // Request from agent (permission) or notification
      if (msg.id != null && msg.id !== undefined) {
        this.emit("request", msg)
      } else {
        this.emit("notification", msg.method, msg.params)
      }
    }
  }

  request(method: string, params?: unknown, timeoutMs = 60_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("jsonrpc client closed"))
    const id = this.nextId++
    const payload: JsonRpcMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? {},
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id))
        reject(new Error(`jsonrpc timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(String(id), { resolve, reject, timer })
      this.write(payload)
    })
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params: params ?? {} })
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result })
  }

  respondError(id: JsonRpcId, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message } })
  }

  private write(msg: JsonRpcMessage): void {
    if (this.closed) return
    try {
      this.child.stdin.write(JSON.stringify(msg) + "\n")
    } catch (e) {
      this.emit("error", e)
    }
  }

  shutdown(err?: Error): void {
    if (this.closed) return
    this.closed = true
    for (const [k, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err || new Error("client shutdown"))
      this.pending.delete(k)
    }
    this.emit("close", err)
  }

  kill(): void {
    try {
      killAcpChild(this.child, "SIGTERM")
    } catch {
      /* */
    }
    setTimeout(() => {
      try {
        killAcpChild(this.child, "SIGKILL")
      } catch {
        /* */
      }
    }, 1500)
    this.shutdown(new Error("killed"))
  }
}

/** Try ACP initialize handshake; returns false if peer is not JSON-RPC ACP. */
export async function tryAcpInitialize(
  client: JsonRpcStdioClient,
  timeoutMs = 4000,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  try {
    const result = await client.request(
      "initialize",
      {
        protocolVersion: 1,
        clientInfo: { name: "cmspark", version: "0.5.9" },
        capabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      },
      timeoutMs,
    )
    return { ok: true, result }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}
