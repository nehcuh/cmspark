// Optimistic user-message temp ids, shared by Side Panel / Cockpit / Service
// Worker so agentStore recognizes every surface's bubble (isTempUserMessageId).
// The random suffix keeps two sends in the same thread+millisecond from
// sharing an id and merging into one bubble (agentStore sameIdIdx).

/** `${threadId}_user_${ms}_${rand}`; without a thread: `user_${ms}_${rand}`. */
export function newTempUserMessageId(
  threadId: string | null | undefined,
  now: number = Date.now(),
  rand: string = Math.random().toString(36).slice(2, 8),
): string {
  return threadId ? `${threadId}_user_${now}_${rand}` : `user_${now}_${rand}`
}

const optimisticId = /(?:^|_)user_(\d{10,})(?:_([a-z0-9]+))?$/

export function isTempUserMessageId(id: string, threadId: string): boolean {
  if (!id) return false
  if (optimisticId.test(id)) return true
  // Older panels used the thread id and timestamp without a random suffix.
  const prefix = threadId + "_"
  return !!threadId && id.startsWith(prefix) && /^\d{10,}$/.test(id.slice(prefix.length))
}

/** Compare ids from the client factory and Companion's thread-local message writer. */
export function predatesStoredMessage(id: string, persistedId: string, threadId: string): boolean {
  if (!id || !persistedId || !threadId) return false
  const prefix = threadId + "_"
  if (!id.startsWith(prefix) || !persistedId.startsWith(prefix)) return false
  const pending = /^(?:user_)?(\d{10,})(?:_[a-z0-9]+)?$/.exec(id.slice(prefix.length))
  const persisted = /^(\d{10,})_[a-z0-9]+$/.exec(persistedId.slice(prefix.length))
  return !!pending && !!persisted && Number(pending[1]) < Number(persisted[1])
}
