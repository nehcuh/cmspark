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

export async function hydrateOverlayIfLive(args: {
  id: string
  token: number
  selectMessages: (id: string) => Promise<OverlayHydrateMessage[]>
  applyHydrate: (id: string, messages: OverlayHydrateMessage[]) => void
  claimLease: (id: string) => Promise<void>
  releaseAllLeases: () => Promise<void>
}): Promise<"claimed" | "abandoned"> {
  const messages = await args.selectMessages(args.id)
  if (!overlaySessionIsLive(args.token)) return "abandoned"
  args.applyHydrate(args.id, messages)
  await args.claimLease(args.id)
  if (overlaySessionIsLive(args.token)) return "claimed"
  if (live) return "abandoned"
  await args.releaseAllLeases()
  return "abandoned"
}

export async function claimOverlayIfLive(args: {
  token: number
  claim: () => Promise<void>
  releaseAll: () => Promise<void>
}): Promise<boolean> {
  if (!overlaySessionIsLive(args.token)) return false
  await args.claim()
  if (overlaySessionIsLive(args.token)) return true
  if (live) return false
  await args.releaseAll()
  return false
}
