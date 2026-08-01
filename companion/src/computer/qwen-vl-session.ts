// Qwen3-VL session facade (prepare / locate / circuit / dispose).

import type { QwenVlVariant } from "./qwen-vl-catalog"
import { qwenModelDir, probeQwenModelDir } from "./qwen-vl-download"
import { ModelRuntimeError, QwenVlRuntime, type QwenVlRuntimeDeps } from "./qwen-vl-runtime"

export interface QwenVlLocateResult {
  point: { x: number; y: number } | null
  raw?: string
  ms: number
}

export interface QwenVlSessionDeps {
  variant: QwenVlVariant
  modelDir?: string
  device?: string
  broadcast?: (msg: unknown) => void
  log?: (event: string, data: Record<string, unknown>) => void
  runtimeFactory?: (deps: QwenVlRuntimeDeps) => QwenVlRuntime
}

export class QwenVlSession {
  private readonly deps: QwenVlSessionDeps
  private runtime: QwenVlRuntime | null = null

  constructor(deps: QwenVlSessionDeps) {
    this.deps = deps
  }

  getStatus(): "idle" | "ready" | "disabled" | "loading" {
    return this.runtime?.getStatus() ?? "idle"
  }

  getFaults(): number {
    return this.runtime?.getFaults() ?? 0
  }

  resetCircuitBreaker(): void {
    this.runtime?.resetCircuitBreaker()
  }

  async prepare(): Promise<void> {
    const variant = this.deps.variant
    const dir = this.deps.modelDir ?? qwenModelDir(variant)
    const probe = probeQwenModelDir(variant)
    if (probe.status !== "ready") {
      throw new ModelRuntimeError(
        "model-not-ready",
        `Qwen3-VL ${variant} 未下载或不完整（${probe.error || probe.status}）`,
      )
    }
    const runtime =
      this.deps.runtimeFactory?.({
        variant,
        modelDir: dir,
        device: this.deps.device,
        broadcast: this.deps.broadcast,
        log: this.deps.log,
      }) ??
      new QwenVlRuntime({
        variant,
        modelDir: dir,
        device: this.deps.device,
        broadcast: this.deps.broadcast,
        log: this.deps.log,
      })
    this.runtime = runtime
    await runtime.prepare()
  }

  async locate(command: string, imagePath: string, width: number, height: number): Promise<QwenVlLocateResult> {
    if (!this.runtime) {
      throw new ModelRuntimeError("model-not-ready", "session not prepared")
    }
    try {
      const r = await this.runtime.infer({ imagePath, command, width, height })
      return { point: { x: r.x, y: r.y }, raw: r.raw, ms: r.ms }
    } catch (e) {
      if (e instanceof ModelRuntimeError) throw e
      throw new ModelRuntimeError("infer-error", e instanceof Error ? e.message : String(e))
    }
  }

  async dispose(): Promise<void> {
    if (this.runtime) {
      try {
        await this.runtime.dispose()
      } catch {
        /* best-effort */
      }
      this.runtime = null
    }
  }
}
