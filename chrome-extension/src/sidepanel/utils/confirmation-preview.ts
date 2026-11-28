import { normalizePreviewUnavailableReason } from "../../shared/computer/preview-availability"
export {
  PREVIEW_UNAVAILABLE_REASONS, normalizePreviewUnavailableReason, type PreviewUnavailableReason,
} from "../../shared/computer/preview-availability"

/** Production WS whitelist shared with the replay test. */
export function confirmationPreviewFromMessage(msg: Record<string, unknown>) {
  return {
    ...(msg.require_image_review === true ? { require_image_review: true } : {}),
    preview_image: typeof msg.preview_image === "string" ? msg.preview_image : undefined,
    preview_caption: typeof msg.preview_caption === "string" ? msg.preview_caption : undefined,
    full_preview: typeof msg.full_preview === "string" ? msg.full_preview : undefined,
    preview_unavailable_reason: normalizePreviewUnavailableReason(msg.preview_unavailable_reason),
  }
}
