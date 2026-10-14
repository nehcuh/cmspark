// Keep wire diagnostics on a fixed vocabulary; raw capture errors are not UI text.
export const PREVIEW_UNAVAILABLE_REASONS = [
  "target_unavailable", "capture_failed", "ocr_failed", "render_failed", "timeout", "preview_failed",
] as const
export type PreviewUnavailableReason = typeof PREVIEW_UNAVAILABLE_REASONS[number]
export function normalizePreviewUnavailableReason(value: unknown): PreviewUnavailableReason | undefined {
  return typeof value === "string" && (PREVIEW_UNAVAILABLE_REASONS as readonly string[]).includes(value)
    ? value as PreviewUnavailableReason : undefined
}

/** Production WS whitelist shared with the replay test. */
export function confirmationPreviewFromMessage(msg: Record<string, unknown>) {
  return {
    preview_image: typeof msg.preview_image === "string" ? msg.preview_image : undefined,
    preview_caption: typeof msg.preview_caption === "string" ? msg.preview_caption : undefined,
    full_preview: typeof msg.full_preview === "string" ? msg.full_preview : undefined,
    preview_unavailable_reason: normalizePreviewUnavailableReason(msg.preview_unavailable_reason),
  }
}
