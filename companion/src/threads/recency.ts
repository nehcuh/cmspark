/** Human-facing recency: last transcript row, else created_at. Never `updated_at`. */
export function threadRecency(t: {
  last_message_at?: string | null
  created_at?: string
}): string {
  const last = typeof t.last_message_at === "string" ? t.last_message_at.trim() : ""
  if (last) return last
  return typeof t.created_at === "string" ? t.created_at : ""
}
