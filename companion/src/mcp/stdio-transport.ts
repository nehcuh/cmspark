// SDK framing/protocol, application-owned process lifetime. The SDK stdio
// transport only kills its direct child, which can leave npx/cmd descendants.
import { type ChildProcess, type SpawnOptions } from "node:child_process"
import { PassThrough } from "node:stream"
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js"
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { prepareWindowsJob, spawnWindowsJob } from "../process/windows-job"

const spawn: (command: string, args: string[], opts: SpawnOptions) => ChildProcess = require("cross-spawn")

export class OwnedStdioTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  readonly stderr = new PassThrough()
  private child?: ChildProcess
  private started = false
  private closed = false
  private closing?: Promise<void>
  private readonly startup = new AbortController()
  private preparing?: Promise<void>
  private readonly buffer = new ReadBuffer()

  constructor(private readonly _serverParams: StdioServerParameters) {}
  get pid(): number | undefined { return this.child?.pid }

  async start(): Promise<void> {
    if (this.started || this.closed) throw new Error("MCP stdio transport already started or closed")
    this.started = true
    let child: ChildProcess
    try {
      if (process.platform === "win32") {
        this.preparing = prepareWindowsJob(this.startup.signal)
        await this.preparing
      }
      if (this.closed) throw new Error("MCP stdio transport closed during startup")
      child = (process.platform === "win32" ? spawnWindowsJob : spawn)(this._serverParams.command, this._serverParams.args ?? [], {
      env: this._serverParams.env, cwd: this._serverParams.cwd, shell: false,
      detached: process.platform !== "win32", windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)))
      await this.close()
      throw error
    }
    this.child = child
    child.stderr?.pipe(this.stderr)
    const streamError = (error: Error) => {
      this.onerror?.(error)
      void this.close()
    }
    child.stdin?.on("error", streamError)
    child.stdout?.on("error", streamError)
    child.stderr?.on("error", streamError)
    child.stdout?.on("data", (data: Buffer) => {
      try {
        this.buffer.append(data)
        for (let message; (message = this.buffer.readMessage()) !== null;) this.onmessage?.(message)
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)))
        void this.close()
      }
    })
    // Exit can precede the last stdout data event. Drain with a deadline so an
    // inherited pipe cannot hold the connection open indefinitely.
    child.once("exit", () => { void this.beginClose(true) })
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve)
      child.on("error", error => {
        this.onerror?.(error); reject(error); void this.close()
      })
    })
  }

  close(): Promise<void> {
    return this.beginClose(false)
  }

  private beginClose(drain: boolean): Promise<void> {
    if (!this.closing) {
      this.closed = true
      this.startup.abort()
      // Publish the promise before closeChild can synchronously invoke onclose.
      this.closing = Promise.resolve().then(() => this.closeChild(drain))
    }
    return this.closing
  }

  private async closeChild(drain: boolean): Promise<void> {
    await this.preparing?.catch(() => {})
    const child = this.child
    if (child?.pid) {
      const pid = child.pid
      if (process.platform === "win32") {
        // This is a Job Object launcher. Ending its owned process handle closes
        // the non-inherited job and reclaims descendants, even after root exit.
        if (child.exitCode == null && child.signalCode == null) {
          try { child.kill() } catch { /* already exited */ }
        }
      } else {
        // detached=true creates an owned group. Kill it once, synchronously;
        // descendants cannot outlive an explicit close via an inherited pipe.
        try { process.kill(-pid, "SIGKILL") }
        catch { if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL") }
      }
      if (child.exitCode == null && child.signalCode == null) {
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); child.off("exit", done); resolve() }
          const timer = setTimeout(done, 1000)
          child.once("exit", done)
        })
      }
    }
    const output = child?.stdout
    if (drain && output && !output.readableEnded && !output.destroyed) {
      await new Promise<void>(resolve => {
        const done = () => {
          clearTimeout(timer)
          output.off("end", done); output.off("close", done); output.off("error", done)
          resolve()
        }
        const timer = setTimeout(done, 1000)
        output.once("end", done); output.once("close", done); output.once("error", done)
      })
    }
    child?.stdin?.destroy(); child?.stdout?.destroy(); child?.stderr?.destroy()
    child?.unref()
    this.stderr.end(); this.buffer.clear(); this.child = undefined
    this.onclose?.()
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed || !this.child?.stdin) throw new Error("MCP stdio not connected")
    const input = this.child.stdin
    await new Promise<void>((resolve, reject) => {
      input.write(serializeMessage(message), error => error ? reject(error) : resolve())
    })
  }
}
