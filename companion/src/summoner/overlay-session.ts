/** Overlay-open generation so in-flight hydrate/claim cannot outlive close. */

let generation = 0
let live = false

export function beginOverlaySession(): number {
  generation += 1
  live = true
  return generation
}

export function invalidateOverlaySession(): void {
  generation += 1
  live = false
}

export function overlaySessionIsLive(token: number): boolean {
  return live && token === generation
}

export function overlayIsOpen(): boolean {
  return live
}

export function currentOverlaySession(): number {
  return generation
}

export type OverlayHydrateMessage = {
  role: string
  content?: string
  tool_calls?: Array<{ function?: { name?: string } }>
}

/** Lease row as reported by composer.lease.claim (`released_siblings`). */
export type OverlayLeaseState = {
  thread_id: string
  holder: string
  rev: number
}

/**
 * Stale-claim repair must not exclusive-claim a lagged thread id after
 * beginOverlaySession() has already moved generation (the new session may
 * already hold a different overlay lease). Bind token at hydrate/submit
 * success; reclaim only while that token is still live.
 */
export function shouldReclaimLiveOverlayThread(args: {
  liveThreadId: string | null | undefined
  liveSessionToken: number | null | undefined
  siblings: OverlayLeaseState[]
}): boolean {
  if (!args.liveThreadId || args.liveSessionToken == null) return false
  if (!overlaySessionIsLive(args.liveSessionToken)) return false
  return args.siblings.some((s) => s.thread_id === args.liveThreadId)
}

/**
 * Outcome of an overlay lease claim. `rev` backs the CAS self-release when the
 * claim turns out stale; `released_siblings` lists the threads this claim
 * demoted so the caller can repair a live session's hold.
 */
export type OverlayClaimResult = {
  ok: boolean
  rev?: number
  released_siblings?: OverlayLeaseState[]
}

function claimOk(claimed: OverlayClaimResult | false): claimed is OverlayClaimResult {
  return claimed !== false && claimed.ok !== false
}

/**
 * Stale-claim unwind: release ONLY the lease this session just took (CAS on the
 * claim rev — a newer claim on the same thread bumps the rev and is never
 * touched), then hand the demoted siblings to the caller for compensating
 * re-claim. Never releaseAll here: a newer overlay session is live and holds
 * its own thread.
 */
async function unwindStaleClaim(args: {
  claimed: OverlayClaimResult
  releaseSelf: (rev: number) => Promise<void>
  onStaleClaim?: (releasedSiblings: OverlayLeaseState[]) => void | Promise<void>
}): Promise<void> {
  if (typeof args.claimed.rev === "number") {
    await args.releaseSelf(args.claimed.rev)
  }
  const siblings = args.claimed.released_siblings ?? []
  if (siblings.length > 0) {
    await args.onStaleClaim?.(siblings)
  }
}

export async function hydrateOverlayIfLive(args: {
  id: string
  token: number
  selectMessages: (id: string) => Promise<OverlayHydrateMessage[]>
  applyHydrate: (id: string, messages: OverlayHydrateMessage[]) => void
  claimLease: (id: string) => Promise<OverlayClaimResult | false>
  releaseClaimedLease: (id: string, rev: number) => Promise<void>
  releaseAllLeases: () => Promise<void>
  onStaleClaim?: (releasedSiblings: OverlayLeaseState[]) => void | Promise<void>
}): Promise<"claimed" | "abandoned"> {
  const messages = await args.selectMessages(args.id)
  if (!overlaySessionIsLive(args.token)) return "abandoned"
  args.applyHydrate(args.id, messages)
  const claimed = await args.claimLease(args.id)
  if (!claimOk(claimed)) return "abandoned"
  if (overlaySessionIsLive(args.token)) return "claimed"
  if (live) {
    await unwindStaleClaim({
      claimed,
      releaseSelf: (rev) => args.releaseClaimedLease(args.id, rev),
      onStaleClaim: args.onStaleClaim,
    })
    return "abandoned"
  }
  await args.releaseAllLeases()
  return "abandoned"
}

export async function claimOverlayIfLive(args: {
  token: number
  claim: () => Promise<OverlayClaimResult | false>
  releaseClaim: (rev: number) => Promise<void>
  releaseAll: () => Promise<void>
  onStaleClaim?: (releasedSiblings: OverlayLeaseState[]) => void | Promise<void>
}): Promise<boolean> {
  if (!overlaySessionIsLive(args.token)) return false
  const claimed = await args.claim()
  if (!claimOk(claimed)) return false
  if (overlaySessionIsLive(args.token)) return true
  if (live) {
    await unwindStaleClaim({
      claimed,
      releaseSelf: args.releaseClaim,
      onStaleClaim: args.onStaleClaim,
    })
    return false
  }
  await args.releaseAll()
  return false
}
