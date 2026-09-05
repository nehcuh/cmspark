// Qwen3-VL main-thread runtime: long-lived Python worker (load once, infer many).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { logger } from "../logger"
import { getAppRoot } from "../paths"
import type { QwenVlVariant } from "./qwen-vl-catalog"
import {
  qwenModelDir,
  probeQwenModelAt,
  clearQwenModelEnabledOnIntegrityFailure,
} from "./qwen-vl-download"
import { isolatedPythonBin } from "./python-runtime"

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

/**
 * Resolve qwen-vl-worker.py for dev (tsc dist/), packaged App (Resources/),
 * and source-tree layouts. Returns the first existing path.
 * Throws ModelRuntimeError("worker-missing") when none exist.
 */
export function resolveQwenVlWorkerScript(explicit?: string): string {
  if (explicit) {
    if (fs.existsSync(explicit)) return explicit
    throw new ModelRuntimeError(
      "worker-missing",
      `qwen-vl-worker.py not found at explicit path: ${explicit}`,
    )
  }

  let appRoot: string | undefined
  try {
    appRoot = getAppRoot()
  } catch {
    appRoot = undefined
  }

  const candidates = [
    // tsc dist: companion/dist/computer/qwen-vl-worker.py (copied by npm run build)
    path.join(__dirname, "qwen-vl-worker.py"),
    // Packaged .app / zip: worker next to cmspark-agent.js (Resources/)
    ...(appRoot
      ? [
          path.join(appRoot, "qwen-vl-worker.py"),
          path.join(appRoot, "computer", "qwen-vl-worker.py"),
          path.join(appRoot, "dist", "computer", "qwen-vl-worker.py"),
          path.join(appRoot, "src", "computer", "qwen-vl-worker.py"),
        ]
      : []),
    // Dev source relative to dist/ or src/
    path.join(__dirname, "..", "src", "computer", "qwen-vl-worker.py"),
    path.join(__dirname, "..", "..", "src", "computer", "qwen-vl-worker.py"),
    path.join(__dirname, "computer", "qwen-vl-worker.py"),
  ]

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }

  throw new ModelRuntimeError(
    "worker-missing",
    `qwen-vl-worker.py not found (packaging gap or incomplete install). Tried: ${candidates
      .filter(Boolean)
      .slice(0, 6)
      .join(" | ")}. Reinstall CMspark or copy the worker next to cmspark-agent.js.`,
  )
}

/**
 * Default interpreter for Qwen3-VL: CMspark isolated env ONLY
 * (~/.cmspark-agent/python-env, typically created via uv).
 * Never silently fall back to PATH/system python3 — that is an explicit
 * config.pythonMode="system" choice wired by QwenVlSession.
 */
function defaultPythonBin(): string {
  try {
    const iso = isolatedPythonBin()
    if (fs.existsSync(iso)) return iso
  } catch {
    /* DATA_DIR edge */
  }
  throw new ModelRuntimeError(
    "model-not-ready",
    "Qwen3-VL 需要 CMspark 独立 Python 环境（~/.cmspark-agent/python-env，设置页可经 uv 创建）。" +
      "未找到该解释器，且构造时未传入 pythonBin；不会回退到系统 python3。",
  )
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
    // Prefer isolated venv semantics when the binary lives under python-env.
    // Do not rely on PATH to find packages — the absolute pythonBin is the source of truth.
    const env: NodeJS.ProcessEnv = { ...process.env }
    try {
      const iso = isolatedPythonBin()
      if (this.pythonBin === iso || this.pythonBin.startsWith(path.dirname(path.dirname(iso)) + path.sep)) {
        const root = path.dirname(path.dirname(iso)) // .../python-env
        env.VIRTUAL_ENV = root
        const binDir = path.dirname(this.pythonBin)
        env.PATH = `${binDir}${path.delimiter}${env.PATH || ""}`
      }
    } catch {
      /* keep process.env */
    }
    const child = spawn(this.pythonBin, [this.workerScript], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      windowsHide: true,
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
    if (deps.transport) {
      this.transport = deps.transport
    } else {
      // Resolve worker at construct time so admission fails with worker-missing
      // instead of a cryptic "can't open file" from a missing path.
      const workerScript = resolveQwenVlWorkerScript(deps.workerScript)
      this.transport = new PythonLineTransport(
        deps.pythonBin ?? defaultPythonBin(),
        workerScript,
      )
    }
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
    const probe = probeQwenModelAt(dir, this.deps.variant)
    if (probe.status !== "ready") {
      this.status = "idle"
      this.prepared = false
      clearQwenModelEnabledOnIntegrityFailure(this.deps.variant, probe)
      throw new ModelRuntimeError(
        probe.error === "sha256-mismatch" ||
          probe.error === "size-mismatch" ||
          probe.error === "model-file-missing"
          ? probe.error
          : "model-not-ready",
        `qwen-vl load refused: integrity ${probe.error || probe.status}`,
      )
    }
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
