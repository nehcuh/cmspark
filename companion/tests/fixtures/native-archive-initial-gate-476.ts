/** Bounded, test-only positive observations. Missing events remain unknown. */
export function createArchiveInitialGate476() {
  const relations = ['NULL', 'OWNED_MAIN', 'OWNED_CONFIRMATION', 'SAME_PROCESS_OTHER', 'OTHER_PROCESS', 'UNKNOWN'] as const
  let ready = false, passed = false, hidden = false, saturated = false
  let firstRelation: (typeof relations)[number] | null = null
  return {
    observe(id: unknown) {
      if (typeof id !== 'string' || id.length > 32) return
      if (id === 'D476_PRE_A_READY') { ready = true; return }
      if (id === 'D476_PRE_A_PASS') { passed = true; return }
      if (id === 'D476_PRE_A_HIDDEN') { hidden = true; return }
      if (id === 'D476_PRE_A_SAT') { saturated = true; return }
      const match = /^D476_PRE_A_R([0-5])$/.exec(id)
      if (match && match[0] === id && firstRelation === null) firstRelation = relations[Number(match[1])]
    },
    snapshot() { return { schema: 1, readySeen: ready, passSeen: passed, hiddenSeen: hidden, saturatedSeen: saturated, firstRelation } },
  }
}
