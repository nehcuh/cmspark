// Qwen3-VL main-thread runtime: long-lived Python worker (load once, infer many).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import * as path from "node:path"
import { logger } from "../logger"
import type { QwenVlVariant } from "./qwen-vl-catalog"
import { qwenModelDir } from "./qwen-vl-download"

export class ModelRuntimeError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "ModelRuntimeError"
    this.code = code
  }
}

export interface QwenVlInferResult {
  x: number
  y: number
  raw?: string
  ms: number
}

export interface QwenVlRuntimeDeps {
  modelDir?: string
  variant: QwenVlVariant
  /** auto | cpu | cuda | mps */
  device?: string
  workerScript?: string
  pythonBin?: string
  broadcast?: (msg: unknown) => void
  log?: (event: string, data: Record<string, unknown>) => void
  /** circuit breaker threshold (default 3) */
  faultThreshold?: number
  /** test seam: custom request transport */
  transport?: QwenVlTransport
}

export interface QwenVlTransport {
  load(modelDir: string, device: string): Promise<void>
  infer(args: {
    imagePath: string
    command: string
    width: number
    height: number
  }): Promise<{ x: number; y: number; raw?: string }>
  dispose(): Promise<void>
}

type Pending = {
  resolve: (v: any) => void
  reject: (e: Error) => void
}

function defaultWorkerScript(): string {
  // src layout: companion/src/computer/qwen-vl-worker.py
  // dist layout: companion/dist/computer/ or .test-dist/...
  const candidates = [
    path.join(__dirname, "qwen-vl-worker.py"),
    path.join(__dirname, "..", "src", "computer", "qwen-vl-worker.py"),
    path.join(__dirname, "..", "..", "src", "computer", "qwen-vl-worker.py"),
  ]
  return candidates[0]!
}

class PythonLineTransport implements QwenVlTransport {
  private child: ChildProcessWithoutNullStreams | null = null
  private buf = ""
  private seq = 0
  private pending = new Map<string, Pending>()
  private readonly pythonBin: string
  private readonly workerScript: string

  constructor(pythonBin: string, workerScript: string) {
    this.pythonBin = pythonBin
    this.workerScript = workerScript
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child
    const child = spawn(this.pythonBin, [this.workerScript], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    })
    this.child = child
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      this.buf += chunk
      let idx: number
      while ((idx = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, idx).trim()
        this.buf = this.buf.slice(idx + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line) as { id?: string; ok?: boolean; error?: string; [k: string]: unknown }
          const id = String(msg.id ?? "")
          const p = this.pending.get(id)
          if (!p) continue
          this.pending.delete(id)
          if (msg.ok) p.resolve(msg)
          else p.reject(new ModelRuntimeError("infer-error", String(msg.error || "worker error")))
        } catch {
          /* ignore non-json */
        }
      }
    })
    child.stderr.on("data", (b: Buffer) => {
      logger.warn("computer.model.qwen.worker.stderr", { line: b.toString("utf8").slice(0, 400) })
    })
    // B1 dual-review: spawn ENOENT must not become an unhandled 'error' that kills companion.
    child.on("error", (err) => {
      const msg = err instanceof Error ? err.message : String(err)
      for (const [, p] of this.pending) {
        p.reject(
          new ModelRuntimeError(
            "worker-spawn-failed",
            `无法启动 Python 推理进程（${msg}）。请安装 python3 与 transformers/torch/pillow`,
          ),
        )
      }
      this.pending.clear()
      this.child = null
    })
    child.on("exit", (code) => {
      for (const [, p] of this.pending) {
        p.reject(new ModelRuntimeError("worker-exit", `qwen-vl worker exited (${code})`))
      }
      this.pending.clear()
      this.child = null
    })
    return child
  }

  private request(payload: Record<string, unknown>, timeoutMs: number): Promise<any> {
    const id = `r${++this.seq}`
    const child = this.ensureChild()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new ModelRuntimeError("infer-timeout", `qwen-vl request timed out (${payload.cmd})`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      child.stdin.write(JSON.stringify({ ...payload, id }) + "\n")
    })
  }

  async load(modelDir: string, device: string): Promise<void> {
    await this.request({ cmd: "load", model_dir: modelDir, device }, 600_000)
  }

  async infer(args: {
    imagePath: string
    command: string
    width: number
    height: number
  }): Promise<{ x: number; y: number; raw?: string }> {
    const msg = await this.request(
      {
        cmd: "infer",
        image_path: args.imagePath,
        command: args.command,
        width: args.width,
        height: args.height,
      },
      120_000,
    )
    return {
      x: Number(msg.x),
      y: Number(msg.y),
      raw: typeof msg.raw === "string" ? msg.raw : undefined,
    }
  }

  async dispose(): Promise<void> {
    try {
      if (this.child && !this.child.killed) {
        await this.request({ cmd: "shutdown" }, 5_000).catch(() => {})
        this.child.kill("SIGTERM")
      }
    } catch {
      /* best-effort */
    }
    this.child = null
  }
}

export type QwenVlStatus = "idle" | "ready" | "disabled" | "loading"

export class QwenVlRuntime {
  private readonly deps: QwenVlRuntimeDeps
  private transport: QwenVlTransport
  private status: QwenVlStatus = "idle"
  private faults = 0
  private busy = false
  private prepared = false

  constructor(deps: QwenVlRuntimeDeps) {
    this.deps = deps
    this.transport =
      deps.transport ??
      new PythonLineTransport(
        deps.pythonBin ?? (process.platform === "win32" ? "python" : "python3"),
        deps.workerScript ?? defaultWorkerScript(),
      )
  }

  getStatus(): QwenVlStatus {
    return this.status
  }

  getFaults(): number {
    return this.faults
  }

  resetCircuitBreaker(): void {
    this.faults = 0
    if (this.status === "disabled") this.status = this.prepared ? "ready" : "idle"
    this.deps.broadcast?.({
      type: "computer.model.state",
      modelStatus: this.status === "ready" ? "ready" : "absent",
      variant: this.deps.variant,
      faults: this.faults,
    })
  }

  async prepare(): Promise<void> {
    if (this.prepared && this.status === "ready") return
    if (this.status === "disabled") {
      throw new ModelRuntimeError("model-disabled", "qwen-vl circuit open")
    }
    this.status = "loading"
    const dir = this.deps.modelDir ?? qwenModelDir(this.deps.variant)
    try {
      await this.transport.load(dir, this.deps.device ?? "auto")
      this.prepared = true
      this.status = "ready"
      this.deps.log?.("computer.model.qwen.prepared", { variant: this.deps.variant, dir })
    } catch (e) {
      this.status = "idle"
      this.prepared = false
      const msg = e instanceof Error ? e.message : String(e)
      throw new ModelRuntimeError("model-not-ready", `qwen-vl prepare failed: ${msg}`)
    }
  }

  async infer(args: {
    imagePath: string
    command: string
    width: number
    height: number
  }): Promise<QwenVlInferResult> {
    if (this.status === "disabled") {
      throw new ModelRuntimeError("model-disabled", "qwen-vl circuit open")
    }
    if (!this.prepared) {
      throw new ModelRuntimeError("model-not-ready", "qwen-vl not prepared")
    }
    if (this.busy) {
      throw new ModelRuntimeError("qwen-vl-busy", "previous infer still running")
    }
    this.busy = true
    const t0 = Date.now()
    try {
      const r = await this.transport.infer(args)
      this.faults = 0
      return { x: r.x, y: r.y, raw: r.raw, ms: Date.now() - t0 }
    } catch (e) {
      this.faults += 1
      const threshold = this.deps.faultThreshold ?? 3
      if (this.faults >= threshold) {
        this.status = "disabled"
        this.deps.broadcast?.({
          type: "computer.model.state",
          modelStatus: "disabled",
          variant: this.deps.variant,
          faults: this.faults,
          error: "circuit-breaker",
        })
        this.deps.log?.("computer.model.qwen.circuit_open", { faults: this.faults })
      }
      throw e
    } finally {
      this.busy = false
    }
  }

  async dispose(): Promise<void> {
    this.prepared = false
    this.status = "idle"
    await this.transport.dispose()
  }
}
