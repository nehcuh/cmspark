import type {
  VoiceBinaryProgress,
  VoiceWhisperAcceleration,
  VoiceWhisperAdapter,
  VoiceWhisperAvailabilityReason,
  VoiceWhisperBackend,
  VoiceWhisperExecution,
  VoiceWhisperFallbackReason,
  VoiceWhisperRuntime,
} from "../types"

const AVAILABILITY_REASONS: readonly VoiceWhisperAvailabilityReason[] = [
  "unsupported_platform", "runtime_missing", "runtime_incomplete", "inventory_unavailable",
  "no_nvidia_adapter", "no_physical_adapter", "cuda_driver_missing", "vulkan_loader_missing",
]
const FALLBACK_REASONS: readonly VoiceWhisperFallbackReason[] = [
  "cuda_failed", "vulkan_failed", "cuda_unproven", "vulkan_unproven",
]
const MAX_EXECUTION_MS = 24 * 60 * 60 * 1000
const MAX_TIMESTAMP = 253_402_300_799_999 // End of year 9999.
const MAX_VRAM_MIB = 16 * 1024 * 1024

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function member<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return values.find((candidate) => candidate === value)
}

function boundedInteger(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : undefined
}

export function boundedVoiceLabel(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined
  // Native names may contain control characters. Keep the label single-line and
  // remove direction overrides so text cannot spill into adjacent status copy.
  return value.replace(/[\x00-\x1f\x7f-\x9f\u2028-\u202e\u2066-\u2069]/g, " ").trim().slice(0, maxLength) || undefined
}

function parseBackend(value: unknown): VoiceWhisperBackend | undefined {
  return member(["cpu", "cuda", "vulkan"], value)
}

/** Only a genuinely absent backend field identifies an old CPU-only message. */
export function parseVoiceBinaryBackend(value: unknown): VoiceWhisperBackend | undefined {
  return value === undefined ? "cpu" : parseBackend(value)
}

function parseAdapter(value: unknown): VoiceWhisperAdapter | undefined {
  const adapter = record(value)
  if (!adapter) return undefined
  const name = boundedVoiceLabel(adapter.name)
  const kind = member(["physical", "virtual", "unknown"] as const, adapter.kind)
  const vendor = member(["nvidia", "amd", "intel", "other"] as const, adapter.vendor)
  if (!name || !kind || !vendor) return undefined
  const driverVersion = boundedVoiceLabel(adapter.driverVersion)
  const vramMB = boundedInteger(adapter.vramMB, 1, MAX_VRAM_MIB)
  return {
    name, kind, vendor,
    ...(driverVersion ? { driverVersion } : {}),
    ...(adapter.driverIssue === true ? { driverIssue: true } : {}),
    ...(vramMB !== undefined ? { vramMB } : {}),
  }
}

function parseRuntime(value: unknown): VoiceWhisperRuntime | undefined {
  const runtime = record(value)
  if (!runtime || typeof runtime.available !== "boolean") return undefined
  const status = member(["ready", "absent", "incomplete"] as const, runtime.status)
  if (!status) return undefined
  const reason = member(AVAILABILITY_REASONS, runtime.reason)
  return {
    status,
    available: status === "ready" && runtime.available && runtime.reason === undefined,
    ...(reason ? { reason } : {}),
  }
}

function parseExecution(value: unknown): VoiceWhisperExecution | undefined {
  const execution = record(value)
  if (!execution) return undefined
  const backend = parseBackend(execution.backend)
  const ms = boundedInteger(execution.ms, 0, MAX_EXECUTION_MS)
  const at = boundedInteger(execution.at, 1, MAX_TIMESTAMP)
  if (!backend || ms === undefined || at === undefined) return undefined
  if (backend !== "cpu") {
    const device = boundedVoiceLabel(execution.device)
    return device ? { backend, device, ms, at } : undefined
  }
  const fallbackReason = member(FALLBACK_REASONS, execution.fallbackReason)
  return { backend, ms, at, ...(fallbackReason ? { fallbackReason } : {}) }
}

export function parseWhisperAcceleration(value: unknown): VoiceWhisperAcceleration | undefined {
  const snapshot = record(value)
  if (!snapshot || typeof snapshot.supported !== "boolean" || !Array.isArray(snapshot.adapters)) return undefined
  const rawRuntimes = record(snapshot.runtimes)
  const cuda = parseRuntime(rawRuntimes?.cuda)
  const vulkan = parseRuntime(rawRuntimes?.vulkan)
  const plannedBackend = parseBackend(snapshot.plannedBackend)
  if (!cuda || !vulkan || !plannedBackend) return undefined
  const runtimes = { cuda, vulkan }
  if (plannedBackend !== "cpu" && (!snapshot.supported || !runtimes[plannedBackend].available)) return undefined
  const adapters = snapshot.adapters.map(parseAdapter).filter((adapter) => adapter !== undefined)
  const latest = parseExecution(snapshot.latest)
  const downloadingBackend = parseBackend(snapshot.downloadingBackend)
  return {
    supported: snapshot.supported, plannedBackend, adapters, runtimes,
    ...(latest ? { latest } : {}),
    ...(downloadingBackend ? { downloadingBackend } : {}),
  }
}

export function parseVoiceBinaryProgress(value: unknown): VoiceBinaryProgress | undefined {
  const progress = record(value)
  if (!progress) return undefined
  const backend = parseVoiceBinaryBackend(progress.backend)
  if (!backend) return undefined
  const phase = member(["download", "extract", "verify"] as const, progress.phase)
  const file = boundedVoiceLabel(progress.file)
  return {
    backend,
    receivedBytes: boundedInteger(progress.receivedBytes, 0) ?? 0,
    totalBytes: boundedInteger(progress.totalBytes, 0) ?? 0,
    ...(phase ? { phase } : {}),
    ...(file ? { file } : {}),
  }
}
