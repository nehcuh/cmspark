import type { CodingSessionState } from "../store/agentStore"

export const CODING_INACTIVE_RICH_MAX_ROWS = 16
export const CODING_INACTIVE_RICH_MAX_BYTES = 256 * 1024

function terminal(row: CodingSessionState): boolean {
  return (row.state === "closed" || row.state === "handback") &&
    row.executionPhase !== "preparing" && row.executionPhase !== "running" && row.executionPhase !== "closing"
}

export function compactCodingSession(row: CodingSessionState): CodingSessionState {
  return {
    sessionId: row.sessionId, threadId: row.threadId, agentId: row.agentId,
    state: row.state, executionPhase: row.executionPhase, updatedAt: row.updatedAt, transport: row.transport,
    mode: row.mode, partial: row.partial, hasPendingDiff: row.hasPendingDiff,
    openLocalTerminal: row.openLocalTerminal, localTerminal: row.localTerminal,
    cancelConfirmed: row.cancelConfirmed, cacheCompacted: true,
    cancelled: row.cancelled || row.error === "cancelled",
  }
}

/** Rich inactive data only. Terminal identity markers and active/actionable data are retained. */
export function pruneCodingSessionCache(
  records: Record<string, CodingSessionState>, activeThreadId: string | null,
  selection: Record<string, string>, dismissedId?: string,
): Record<string, CodingSessionState> {
  const current = activeThreadId ? selection[activeThreadId] : undefined
  const candidates = Object.values(records).filter(row => !row.cacheCompacted && terminal(row) &&
    !row.hasPendingDiff && (row.sessionId !== current || row.sessionId === dismissedId))
    .sort((a, b) => a.updatedAt - b.updatedAt || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
  const sizes = candidates.map(row => new TextEncoder().encode(JSON.stringify(row)).length)
  let count = candidates.length, bytes = sizes.reduce((sum, size) => sum + size, 0)
  let result = records
  candidates.forEach((row, index) => {
    if (row.sessionId !== dismissedId && count <= CODING_INACTIVE_RICH_MAX_ROWS && bytes <= CODING_INACTIVE_RICH_MAX_BYTES) return
    if (result === records) result = { ...records }
    result[row.sessionId] = compactCodingSession(row)
    count--; bytes -= sizes[index]!
  })
  return result
}

/** Ordered, unique, viewable membership; existing singleton is only a migration seed. */
export function codingSessionMembership(
  records: Record<string, CodingSessionState>, previous: Record<string, string[]> | undefined,
  selection: Record<string, string>, eventId?: string,
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const append = (id: string, owner: string) => {
    const row = records[id]
    if (!row || row.threadId !== owner || row.cacheCompacted) return
    const ids = result[owner] || (result[owner] = [])
    if (!ids.includes(id)) ids.push(id)
  }
  for (const [owner, ids] of Object.entries(previous || {})) for (const id of ids) append(id, owner)
  for (const [owner, id] of Object.entries(selection)) append(id, owner)
  if (eventId && records[eventId]) append(eventId, records[eventId]!.threadId)
  return result
}
