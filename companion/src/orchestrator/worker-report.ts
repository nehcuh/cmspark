/** The producer and its freshness checks must select exactly the same report. */
export function selectWorkerReport<T extends { role?: unknown; content?: unknown }>(messages: T[]): {
  source: T | undefined
  partial: boolean
} {
  const assistants = messages.filter(m => m.role === "assistant")
  const chronological = assistants.at(-1)
  const report = [...assistants].reverse().find(m => typeof m.content === "string" && m.content.trim())
  return { source: report ?? chronological, partial: !!report && report !== chronological }
}
