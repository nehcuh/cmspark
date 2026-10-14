import { previewImageSafe } from "../sidepanel/utils/computer-utils"
import { normalizePreviewUnavailableReason } from "../sidepanel/utils/confirmation-preview"
import { tokens } from "../sidepanel/ui/tokens"

const REASON_COPY = {
  target_unavailable: "未找到可预览的目标窗口",
  capture_failed: "无法获取目标窗口截图",
  ocr_failed: "无法完成截图文字识别与凭证遮盖",
  render_failed: "无法生成标注预览",
  timeout: "预览生成超时",
  preview_failed: "预览生成失败",
}

/** Actual confirmation image/notice view; no approval or trust logic. */
export function ConfirmationPreview({ image, reason, imageFailed, onImageError }: {
  image?: string; reason?: unknown; imageFailed: boolean; onImageError: () => void
}) {
  const unavailable = normalizePreviewUnavailableReason(reason)
  const message = unavailable ? REASON_COPY[unavailable]
    : imageFailed && image ? "预览图片加载失败"
      : image && !previewImageSafe(image) ? "预览图片无法显示" : undefined
  if (message) return (
    <div role="status" style={{ fontSize: 11, color: tokens.darkText, maxWidth: 180 }}>
      <strong>预览不可用（降级确认）</strong>
      <div>{message}。请核对任务与动作说明后再决定是否允许。</div>
    </div>
  )
  if (!previewImageSafe(image)) return null
  return <img src={`data:image/jpeg;base64,${image}`} alt="标注截图"
    style={{ width: 160, maxHeight: 100, objectFit: "cover", borderRadius: tokens.radiusSm }} onError={onImageError} />
}
