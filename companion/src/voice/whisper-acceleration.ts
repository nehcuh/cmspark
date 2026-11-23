import { existsSync } from "node:fs"
import path from "node:path"

import { getConfigDir } from "../config"
import { defaultWhisperBinaryInstallDir, resolveWhisperArch } from "./binary-resolve"
import { probeWhisperBinaryInstallAsync } from "./whisper-binary-download"
import type { WhisperBinaryManifest } from "./whisper-binary-manifest"
import {
  adapterLabel,
  getWindowsWhisperHardware,
  isVirtualDisplayDevice,
  type WindowsWhisperAdapter,
  type WindowsWhisperHardware,
} from "./whisper-windows-hardware"

export { parseWindowsWhisperAdapters } from "./whisper-windows-hardware"

export const WHISPER_GPU_BACKENDS = ["cuda", "vulkan"] as const
export type WhisperGpuBackend = typeof WHISPER_GPU_BACKENDS[number]
export type WhisperBackend = "cpu" | WhisperGpuBackend
export type WhisperFallbackReason = `${WhisperGpuBackend}_failed` | `${WhisperGpuBackend}_unproven`
export type WhisperExecution = {
  backend: WhisperBackend
  device?: string
  fallbackReason?: WhisperFallbackReason
  ms: number
  at: number
}

type AvailabilityReason =
  | "unsupported_platform"
  | "runtime_missing"
  | "runtime_incomplete"
  | "inventory_unavailable"
  | "no_nvidia_adapter"
  | "no_physical_adapter"
  | "cuda_driver_missing"
  | "vulkan_loader_missing"

export type WhisperRuntimeStatus = {
  status: "ready" | "absent" | "incomplete"
  available: boolean
  reason?: AvailabilityReason
}

export type WhisperAccelerationState = {
  supported: boolean
  adapters: WindowsWhisperAdapter[]
  runtimes: Record<WhisperGpuBackend, WhisperRuntimeStatus>
  plannedBackend: WhisperBackend
  latest?: WhisperExecution
  downloadingBackend?: WhisperBackend
}

export type WhisperRuntimeChoice =
  | { backend: "cpu" }
  | { backend: WhisperGpuBackend; binaryPath: string }

type WindowsRuntimeOptions = {
  dataDir?: string
  platform?: NodeJS.Platform
  arch?: string
  manifest?: WhisperBinaryManifest
  detectHardware?: () => Promise<WindowsWhisperHardware>
  signal?: AbortSignal
}

export function isWhisperGpuBackend(backend: unknown): backend is WhisperGpuBackend {
  return backend === "cuda" || backend === "vulkan"
}

export function supportsWindowsWhisperAcceleration(platform = process.platform, arch: string = process.arch): boolean {
  return resolveWhisperArch(platform, arch) === "win-x64"
}

export function whisperGpuInstallTarget(backend: WhisperGpuBackend, dataDir = getConfigDir()) {
  return {
    arch: `win-x64-${backend}`,
    destDir: path.resolve(defaultWhisperBinaryInstallDir("win-x64", dataDir), backend),
  }
}

function probeRuntime(backend: WhisperGpuBackend, opts: WindowsRuntimeOptions) {
  const target = whisperGpuInstallTarget(backend, opts.dataDir)
  return probeWhisperBinaryInstallAsync(target.destDir, target.arch, opts.manifest, opts.signal)
}

/** Strict acceptance still uses the packaged pins and the private install layout. */
export async function verifiedWindowsWhisperRuntime(
  backend: WhisperGpuBackend,
  dataDir?: string,
  signal?: AbortSignal,
): Promise<Extract<WhisperRuntimeChoice, { binaryPath: string }> | undefined> {
  if (!supportsWindowsWhisperAcceleration()) return undefined
  const probe = await probeRuntime(backend, { dataDir, signal })
  if (probe.status !== "ready" || !probe.primaryPath) return undefined
  return { backend, binaryPath: probe.primaryPath }
}

function hardwareBlocker(backend: WhisperGpuBackend, hardware: WindowsWhisperHardware): AvailabilityReason | undefined {
  if (!hardware.inventoryAvailable) return "inventory_unavailable"
  const physical = hardware.adapters.filter((a) => a.kind === "physical" && !a.driverIssue)
  if (backend === "cuda") {
    if (!physical.some((a) => a.vendor === "nvidia")) return "no_nvidia_adapter"
    if (!hardware.cudaDriver) return "cuda_driver_missing"
  } else {
    if (!physical.length) return "no_physical_adapter"
    if (!hardware.vulkanLoader) return "vulkan_loader_missing"
  }
}

export async function selectWindowsWhisperRuntime(opts: WindowsRuntimeOptions = {}): Promise<WhisperRuntimeChoice> {
  opts.signal?.throwIfAborted()
  if (!supportsWindowsWhisperAcceleration(opts.platform, opts.arch)) return { backend: "cpu" }
  const installed = WHISPER_GPU_BACKENDS.filter((backend) => existsSync(whisperGpuInstallTarget(backend, opts.dataDir).destDir))
  if (!installed.length) return { backend: "cpu" }
  const hardware = await (opts.detectHardware ?? getWindowsWhisperHardware)()
  opts.signal?.throwIfAborted()
  for (const backend of installed) {
    if (hardwareBlocker(backend, hardware)) continue
    // Fresh verification before every use. The inventory cache never bypasses the file pins.
    const probe = await probeRuntime(backend, opts)
    if (probe.status === "ready" && probe.primaryPath) return { backend, binaryPath: probe.primaryPath }
  }
  return { backend: "cpu" }
}

export async function inspectWhisperAcceleration(opts: WindowsRuntimeOptions = {}): Promise<WhisperAccelerationState> {
  if (!supportsWindowsWhisperAcceleration(opts.platform, opts.arch)) {
    const unsupported = { status: "absent", available: false, reason: "unsupported_platform" } as const
    return { supported: false, adapters: [], runtimes: { cuda: unsupported, vulkan: unsupported }, plannedBackend: "cpu" }
  }
  const hardware = await (opts.detectHardware ?? getWindowsWhisperHardware)()
  async function inspect(backend: WhisperGpuBackend): Promise<WhisperRuntimeStatus> {
    const probe = await probeRuntime(backend, opts)
    const reason = probe.status === "incomplete" ? "runtime_incomplete" :
      hardwareBlocker(backend, hardware) ?? (probe.status === "absent" ? "runtime_missing" : undefined)
    return { status: probe.status, available: !reason, ...(reason ? { reason } : {}) }
  }
  const [cuda, vulkan] = await Promise.all([inspect("cuda"), inspect("vulkan")])
  const runtimes = { cuda, vulkan }
  return {
    supported: true,
    adapters: hardware.adapters,
    runtimes,
    plannedBackend: WHISPER_GPU_BACKENDS.find((backend) => runtimes[backend].available) ?? "cpu",
    ...(latestExecution ? { latest: latestExecution } : {}),
  }
}

/**
 * whisper.cpp v1.7.6 reports the actual initialized backend and the model
 * buffer's backend device. Enumeration, host buffers and exit status aren't proof.
 */
export function parseWhisperBackendEvidence(backend: WhisperGpuBackend, stderr: string): { device: string } | undefined {
  const initialized = /^whisper_backend_init_gpu: using (CUDA|Vulkan)(\d+) backend\s*$/mi.exec(stderr)
  if (!initialized || initialized[1]?.toLowerCase() !== backend) return undefined
  if (/^whisper_backend_init_gpu: failed to initialize /mi.test(stderr)) return undefined
  const buffers = stderr.matchAll(/^whisper_model_load:\s+(CUDA|Vulkan)(\d+) total size\s*=\s*(\d+(?:\.\d+)?) MB\s*$/gmi)
  if (![...buffers].some((row) => row[1] === initialized[1] && row[2] === initialized[2] && Number(row[3]) > 0)) return undefined

  const names = backend === "cuda"
    ? stderr.matchAll(/^\s*Device (\d+): (.+?), compute capability \d+\.\d+, VMM: (?:yes|no)\s*$/gmi)
    : stderr.matchAll(/^ggml_vulkan:\s*(\d+) = (.+?) \([^\r\n]*?\) \| uma:[^\r\n]*(\r?\nggml_vulkan: Warning: Device type is CPU\.)?/gmi)
  for (const row of names) {
    if (row[1] !== initialized[2] || row[3]) continue
    const device = adapterLabel(row[2])
    if (device && !isVirtualDisplayDevice(device)) return { device }
  }
}

let latestExecution: WhisperExecution | undefined
const executionObservers = new Set<() => void>()

export function observeWhisperExecution(listener: () => void): () => void {
  executionObservers.add(listener)
  return () => { executionObservers.delete(listener) }
}

export function recordWhisperExecution(execution: WhisperExecution): void {
  latestExecution = { ...execution }
  for (const notify of executionObservers) {
    try { notify() } catch { /* Observers cannot fail an inference. */ }
  }
}
