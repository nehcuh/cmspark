/** #521 ephemeral addressing, never a grant or generic error mapper. */
export function isNumberedSnapshotLocator(tool: string, params: Record<string, unknown>): boolean {
  return (tool === "click" || tool === "type") && typeof params.snapshot_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.snapshot_id)
    && Number.isInteger(params.element_id) && (params.element_id as number) >= 1 && (params.element_id as number) <= 64
    && !["text", "selector", "exact"].some(k => Object.hasOwn(params, k))
}
export function isSnapshotRequest(tool: string, params: Record<string, unknown>): boolean {
  return tool === "get_interactive_snapshot" || isNumberedSnapshotLocator(tool, params)
}
export const SNAPSHOT_LOCAL_REFUSAL_CODES = new Set([
  "SNAPSHOT_SCOPE_REQUIRED", "SNAPSHOT_STALE", "SNAPSHOT_INCOMPLETE", "SNAPSHOT_CAPACITY", "SNAPSHOT_UNSUPPORTED_DOCUMENT", "SNAPSHOT_UNSUPPORTED_CONTROL", "ELEMENT_OCCLUDED",
])
export function isSnapshotLocatorRefusal(tool: string, params: Record<string, unknown>, code: string | undefined): boolean {
  return isSnapshotRequest(tool, params) && !!code && (SNAPSHOT_LOCAL_REFUSAL_CODES.has(code) || code === "ELEMENT_AMBIGUOUS")
}
export function snapshotHistory(tool: string, params: Record<string, unknown>, result: any): { params: string; result_summary: string } | undefined {
  if (!isSnapshotRequest(tool, params)) return undefined
  return { params: JSON.stringify({ tabId: params.tabId, locator_kind: "snapshot" }), result_summary: result?.success ? JSON.stringify({ success: true, ...(tool === "get_interactive_snapshot" ? { rows: Array.isArray(result.data?.rows) ? result.data.rows.length : 0, complete: result.data?.complete === true } : { locator_kind: "snapshot" }) }) : "" }
}
