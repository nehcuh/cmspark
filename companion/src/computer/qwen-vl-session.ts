// Qwen3-VL session facade (prepare / locate / circuit / dispose).

import * as fs from "node:fs"
import { getConfig } from "../config"
import type { QwenVlVariant } from "./qwen-vl-catalog"
import { qwenModelDir, probeQwenModelDir } from "./qwen-vl-download"
import {
  isolatedPythonBin,
  resolvePythonRuntime,
  type PythonMode,
} from "./python-runtime"
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
  /** Override Python binary (tests). Default: resolvePythonRuntime from config. */
  pythonBin?: string
  workerScript?: string
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

    // Python contract (ADR-style, settings UI):
    //   pythonMode=isolated (default) → ~/.cmspark-agent/python-env only
    //     (created/maintained via uv when available; NEVER PATH/system python3)
    //   pythonMode=system → explicit owner opt-in to global / pythonPath
    let pythonBin = this.deps.pythonBin
    if (!pythonBin) {
      const cfg = getConfig().computer
      const mode: PythonMode = cfg?.pythonMode === "system" ? "system" : "isolated"
      const preferUv = cfg?.pythonPreferUv !== false

      if (mode === "isolated") {
        // Fast path: use the isolated venv binary as-is (uv or venv created it).
        // Do not resolve through PATH "python3" and do not accept system python.
        const iso = isolatedPythonBin()
        if (!fs.existsSync(iso)) {
          throw new ModelRuntimeError(
            "model-not-ready",
            "Qwen3-VL 独立 Python 环境未就绪（~/.cmspark-agent/python-env）。" +
              "请在设置页用「创建独立环境」（有 uv 时优先 uv venv + uv pip）安装依赖后再启用。" +
              "isolated 模式不会回退到系统 python3。",
          )
        }
        pythonBin = iso
        const rt = await resolvePythonRuntime({ mode: "isolated", preferUv })
        this.deps.log?.("computer.model.qwen.python", {
          mode: "isolated",
          resolution: rt.resolution,
          uvAvailable: rt.uvAvailable,
          // basename only — avoid home-path leakage in chat/logs
          python: iso.split(/[/\\]/).pop() || "python3",
          env: "python-env",
        })
      } else {
        const rt = await resolvePythonRuntime({
          mode: "system",
          systemPythonPath: typeof cfg?.pythonPath === "string" ? cfg.pythonPath : undefined,
          preferUv,
        })
        if (!rt.pythonPath) {
          throw new ModelRuntimeError(
            "model-not-ready",
            "Qwen3-VL 已配置 pythonMode=system，但未找到可用的系统 Python。" +
              "请指定 computer.pythonPath，或改回 isolated（推荐，uv 独立环境）。",
          )
        }
        pythonBin = rt.pythonPath
        this.deps.log?.("computer.model.qwen.python", {
          mode: "system",
          resolution: rt.resolution,
          uvAvailable: rt.uvAvailable,
          python: pythonBin.split(/[/\\]/).pop() || pythonBin,
        })
      }
    }

    const runtimeDeps: QwenVlRuntimeDeps = {
      variant,
      modelDir: dir,
      device: this.deps.device,
      pythonBin,
      ...(this.deps.workerScript ? { workerScript: this.deps.workerScript } : {}),
      broadcast: this.deps.broadcast,
      log: this.deps.log,
    }
    const runtime =
      this.deps.runtimeFactory?.(runtimeDeps) ?? new QwenVlRuntime(runtimeDeps)
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
