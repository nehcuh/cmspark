import type { CSSProperties } from "react"
import type {
  VoiceBinaryError,
  VoiceBinaryProgress,
  VoiceWhisperAcceleration,
  VoiceWhisperAdapter,
  VoiceWhisperAvailabilityReason,
  VoiceWhisperBackend,
  VoiceWhisperFallbackReason,
  VoiceWhisperGpuBackend,
  VoiceWhisperRuntime,
} from "../types"
import { tokens } from "../ui/tokens"
import { progressPercent } from "../voice/whisper-settings-copy"

const BACKEND_LABEL: Record<VoiceWhisperBackend, string> = { cpu: "CPU", cuda: "CUDA", vulkan: "Vulkan" }
const GPU_BACKENDS: readonly VoiceWhisperGpuBackend[] = ["cuda", "vulkan"]
const ADAPTER_LABEL: Record<VoiceWhisperAdapter["kind"], string> = {
  physical: "物理显卡",
  virtual: "虚拟显示或软件渲染",
  unknown: "设备类型未确认",
}
const INSTALL_LABEL: Record<VoiceWhisperRuntime["status"], string> = {
  ready: "组件已安装",
  absent: "组件未安装",
  incomplete: "组件不完整或校验失败",
}
const AVAILABILITY_LABEL: Record<VoiceWhisperAvailabilityReason, string> = {
  unsupported_platform: "仅支持 Windows x64",
  runtime_missing: "组件未安装",
  runtime_incomplete: "组件不完整或校验失败",
  inventory_unavailable: "无法读取显卡信息",
  no_nvidia_adapter: "未检测到驱动正常的 NVIDIA 物理显卡",
  no_physical_adapter: "未检测到驱动正常的物理显卡",
  cuda_driver_missing: "CUDA 显卡驱动不可用",
  vulkan_loader_missing: "Vulkan 加载器不可用，请检查显卡驱动",
}
const FALLBACK_LABEL: Record<VoiceWhisperFallbackReason, string> = {
  cuda_failed: "CUDA 执行失败，已回退 CPU",
  cuda_unproven: "CUDA 未能确认 GPU 执行，已回退 CPU",
  vulkan_failed: "Vulkan 执行失败，已回退 CPU",
  vulkan_unproven: "Vulkan 未能确认 GPU 执行，已回退 CPU",
}

function runtimeDetail(runtime: VoiceWhisperRuntime): string {
  if (runtime.available) return "可作为候选"
  if (runtime.reason === "runtime_missing" || runtime.reason === "runtime_incomplete") return ""
  if (runtime.reason) return AVAILABILITY_LABEL[runtime.reason]
  return runtime.status === "ready" ? "暂不可用" : ""
}

function installProgressLabel(label: string, progress?: VoiceBinaryProgress): string {
  switch (progress?.phase) {
    case "download": return `${label} 下载中`
    case "extract": return `${label} 解包中`
    case "verify": return `${label} 校验中`
    case "cancelling": return `正在取消安装 ${label}`
    default: return `正在准备安装 ${label}`
  }
}

interface Props {
  acceleration: VoiceWhisperAcceleration | undefined
  progress: VoiceBinaryProgress | null
  error: VoiceBinaryError | null
  modelDownloading: boolean
  onInstall: (backend: VoiceWhisperGpuBackend) => void
  onCancel: (backend: VoiceWhisperGpuBackend) => void
}

export function WhisperAccelerationSettings({ acceleration, progress, error, modelDownloading, onInstall, onCancel }: Props) {
  if (!acceleration?.supported) return null
  const downloading = acceleration.downloadingBackend ?? progress?.backend
  const { latest } = acceleration
  const timestamp = latest && new Date(latest.at)
  return (
    <section aria-label="本机听写 GPU 加速" style={styles.section}>
      <div style={styles.heading}>本机听写 GPU 加速</div>
      {acceleration.adapters.length ? (
        <ul style={styles.adapters} aria-label="检测到的显示适配器">
          {acceleration.adapters.map((adapter, index) => (
            <li key={`${adapter.name}-${index}`}>
              {adapter.name} · {ADAPTER_LABEL[adapter.kind]}
              {adapter.vramMB !== undefined && ` · 显存 ${adapter.vramMB} MiB`}
              {adapter.driverVersion && ` · 驱动 ${adapter.driverVersion}`}
              {adapter.driverIssue && " · 驱动异常"}
            </li>
          ))}
        </ul>
      ) : <div>暂无显示适配器信息</div>}
      {GPU_BACKENDS.map((backend) => {
        const label = BACKEND_LABEL[backend]
        const runtime = acceleration.runtimes[backend]
        const detail = runtimeDetail(runtime)
        const installing = downloading === backend
        const update = progress?.backend === backend ? progress : undefined
        const total = update?.totalBytes ?? 0
        const percent = total > 0 ? progressPercent(update?.receivedBytes ?? 0, total) : undefined
        return (
          <div key={backend} style={styles.runtime}>
            <div style={styles.runtimeRow}>
              <div>
                <strong>{label}</strong> · {INSTALL_LABEL[runtime.status]}
                {detail && ` · ${detail}`}
              </div>
              {installing ? (
                <button type="button" style={styles.button} disabled={update?.phase === "cancelling"} onClick={() => onCancel(backend)}>
                  取消安装 {label}
                </button>
              ) : runtime.status !== "ready" && (
                <button type="button" style={styles.button} disabled={!!downloading || modelDownloading} onClick={() => onInstall(backend)}>
                  {runtime.status === "incomplete" ? "重新安装" : "安装"} {label}
                </button>
              )}
            </div>
            {installing && (
              <div role="status" style={styles.progress}>
                {installProgressLabel(label, update)}
                {percent !== undefined && ` · ${percent}%`}
                {update?.file && ` · ${update.file}`}
              </div>
            )}
            {error?.backend === backend && <div role="alert" style={styles.error}>{label}：{error.message}</div>}
          </div>
        )
      })}
      <div style={styles.history}>下一次自动选择候选：{BACKEND_LABEL[acceleration.plannedBackend]}</div>
      <div>
        最近一次执行：{latest && timestamp ? (
          <>
            {BACKEND_LABEL[latest.backend]}{latest.device && ` · ${latest.device}`}
            {" · "}{latest.ms} ms{" · "}
            <time dateTime={timestamp.toISOString()}>{timestamp.toLocaleString("zh-CN")}</time>
            {latest.fallbackReason && ` · ${FALLBACK_LABEL[latest.fallbackReason]}`}
          </>
        ) : "暂无记录"}
      </div>
      <div style={styles.validation}>本次实机验证：NVIDIA GeForce RTX 4080 SUPER。AMD / Intel 实机待验证。</div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  section: {
    margin: "10px 0",
    padding: "8px 0",
    borderBlock: `1px solid ${tokens.border}`,
    color: tokens.textSecondary,
    fontSize: 11,
    lineHeight: 1.6,
    overflowWrap: "anywhere",
  },
  heading: { color: tokens.text, fontSize: 12, fontWeight: 600, marginBottom: 4 },
  adapters: { margin: "4px 0 6px", paddingInlineStart: 16 },
  runtime: { marginBlock: 4 },
  runtimeRow: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 8px" },
  button: {
    padding: "3px 8px",
    border: `1px solid ${tokens.borderStrong}`,
    borderRadius: tokens.radiusSm,
    background: tokens.bgElevated,
    color: "inherit",
    fontSize: 11,
  },
  progress: { marginTop: 2, color: tokens.accentText },
  error: { marginTop: 2, color: tokens.danger },
  history: { marginTop: 6 },
  validation: { marginTop: 6, color: tokens.textMuted },
}
