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
