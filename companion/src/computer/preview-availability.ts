// Operator-only preview diagnostics. Never carry native error text or paths.
export const PREVIEW_UNAVAILABLE_REASONS = [
  "target_unavailable", "capture_failed", "ocr_failed", "render_failed", "timeout", "preview_failed",
] as const
export type PreviewUnavailableReason = typeof PREVIEW_UNAVAILABLE_REASONS[number]
export function normalizePreviewUnavailableReason(value: unknown): PreviewUnavailableReason | undefined {
  return typeof value === "string" && (PREVIEW_UNAVAILABLE_REASONS as readonly string[]).includes(value)
    ? value as PreviewUnavailableReason : undefined
}
