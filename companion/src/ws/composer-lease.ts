/** S20 composer.lease — per-thread overlay/panel holder with CAS rev.
 *
 * P0 fields only: thread_id, holder ("overlay"|"panel"), rev.
 * Overlay-visible ⇒ overlay holds; close overlay ⇒ panel. No dual drafts.
 */

export const OVERLAY_STANDBY = "OVERLAY_STANDBY" as const
export const LEASE_REV_MISMATCH = "LEASE_REV_MISMATCH" as const

export type ComposerHolder = "overlay" | "panel"

export type ComposerLeaseState = {
  thread_id: string
  holder: ComposerHolder
  rev: number
}

export type LeaseMutationResult =
  | { ok: true; state: ComposerLeaseState; released_siblings: ComposerLeaseState[] }
  | { ok: false; state: ComposerLeaseState; error_code: typeof LEASE_REV_MISMATCH }

export type ComposerLeaseGateOk = { ok: true }
export type ComposerLeaseGateDeny = {
  ok: false
  error_code: typeof OVERLAY_STANDBY
  error: string
  holder: ComposerHolder
}

export type ChatCreateLeaseError = {
  type: "chat.error"
  thread_id: string
  error: string
  data: { error_code: typeof OVERLAY_STANDBY; holder: ComposerHolder }
}

export class ComposerLeaseRegistry {
  private leases = new Map<string, ComposerLeaseState>()

  get(thread_id: string): ComposerLeaseState {
    return this.leases.get(thread_id) ?? { thread_id, holder: "panel", rev: 0 }
  }

  claim(args: { thread_id: string; holder: ComposerHolder; rev: number }): LeaseMutationResult {
    const current = this.get(args.thread_id)
    if (args.rev !== current.rev) {
      return { ok: false, state: current, error_code: LEASE_REV_MISMATCH }
    }
    const next: ComposerLeaseState = {
      thread_id: args.thread_id,
      holder: args.holder,
      rev: current.rev + 1,
    }
    this.leases.set(args.thread_id, next)
    const released_siblings =
      args.holder === "overlay" ? this.releaseAllOverlay(args.thread_id) : []
    return { ok: true, state: next, released_siblings }
  }

  /** Optional: return holder to panel and bump rev when incoming rev matches. */
  release(args: { thread_id: string; rev: number }): LeaseMutationResult {
    const current = this.get(args.thread_id)
    if (args.rev !== current.rev) {
      return { ok: false, state: current, error_code: LEASE_REV_MISMATCH }
    }
    const next: ComposerLeaseState = {
      thread_id: args.thread_id,
      holder: "panel",
      rev: current.rev + 1,
    }
    this.leases.set(args.thread_id, next)
    return { ok: true, state: next, released_siblings: [] }
  }

  /** Overlay is a singleton composer: at most one thread may hold it. */
  releaseAllOverlay(exceptThreadId?: string): ComposerLeaseState[] {
    const released: ComposerLeaseState[] = []
    for (const [id, state] of this.leases) {
      if (state.holder !== "overlay") continue
      if (exceptThreadId && id === exceptThreadId) continue
      const next: ComposerLeaseState = {
        thread_id: id,
        holder: "panel",
        rev: state.rev + 1,
      }
      this.leases.set(id, next)
      released.push(next)
    }
    return released
  }
}

/** Process-wide SoT. Overlay claim and chat.create share this map. */
export const composerLeases = new ComposerLeaseRegistry()

export function incomingHolderFromSurface(surface: unknown): ComposerHolder {
  return surface === "summoner" ? "overlay" : "panel"
}

export function assertComposerLease(
  holder: ComposerHolder,
  incoming: ComposerHolder,
): ComposerLeaseGateOk | ComposerLeaseGateDeny {
  if (holder !== incoming) {
    return {
      ok: false,
      error_code: OVERLAY_STANDBY,
      error: "OVERLAY_STANDBY: composer is on the other surface",
      holder,
    }
  }
  return { ok: true }
}

/** Overwrite always — never trust a client-supplied `__cmspark_surface`. */
export function stampCmsparkSurface(msg: any, surface: string | undefined): void {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return
  msg.__cmspark_surface = surface === "summoner" ? "summoner" : "tray"
}

export function stripCmsparkSurface(msg: any): unknown {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return undefined
  const stamped = msg.__cmspark_surface
  delete msg.__cmspark_surface
  return stamped
}

export function gateChatCreateOnLease(
  thread_id: string,
  surface: unknown,
  registry: ComposerLeaseRegistry = composerLeases,
): ChatCreateLeaseError | null {
  const incoming = incomingHolderFromSurface(surface)
  const lease = registry.get(thread_id)
  const gate = assertComposerLease(lease.holder, incoming)
  if (!gate.ok) {
    return {
      type: "chat.error",
      thread_id,
      error: gate.error,
      data: { error_code: gate.error_code, holder: gate.holder },
    }
  }
  return null
}

function leasePayload(state: ComposerLeaseState) {
  return { thread_id: state.thread_id, holder: state.holder, rev: state.rev }
}

export function handleComposerLeaseFamily(
  type: string,
  rest: any,
  registry: ComposerLeaseRegistry = composerLeases,
  surface?: unknown,
): any | null {
  switch (type) {
    case "composer.lease.get": {
      return { type: "composer.lease", ...leasePayload(registry.get(String(rest.thread_id))) }
    }
    case "composer.lease.claim": {
      const holder = rest.holder
      if (holder !== "overlay" && holder !== "panel") {
        return { type: "error", error: 'composer.lease.claim holder must be "overlay" | "panel"' }
      }
      if (typeof rest.rev !== "number" || !Number.isInteger(rest.rev)) {
        return { type: "error", error: "composer.lease.claim requires rev number" }
      }
      if (surface === "summoner" || surface === "tray") {
        const expected = incomingHolderFromSurface(surface)
        if (holder !== expected) {
          return {
            type: "error",
            error: "LEASE_HOLDER_SURFACE_MISMATCH",
            error_code: "LEASE_HOLDER_SURFACE_MISMATCH",
          }
        }
      }
      const result = registry.claim({
        thread_id: String(rest.thread_id),
        holder,
        rev: rest.rev,
      })
      if (!result.ok) {
        return {
          type: "composer.lease.error",
          error: "LEASE_REV_MISMATCH",
          error_code: result.error_code,
          ...leasePayload(result.state),
        }
      }
      return {
        type: "composer.lease",
        ...leasePayload(result.state),
        released_siblings: result.released_siblings,
      }
    }
    case "composer.lease.release": {
      if (typeof rest.rev !== "number" || !Number.isInteger(rest.rev)) {
        return { type: "error", error: "composer.lease.release requires rev number" }
      }
      const result = registry.release({
        thread_id: String(rest.thread_id),
        rev: rest.rev,
      })
      if (!result.ok) {
        return {
          type: "composer.lease.error",
          error: "LEASE_REV_MISMATCH",
          error_code: result.error_code,
          ...leasePayload(result.state),
        }
      }
      return { type: "composer.lease", ...leasePayload(result.state) }
    }
    case "composer.lease.release_overlay": {
      const released = registry.releaseAllOverlay()
      return { type: "composer.lease.released", released }
    }
    default:
      return null
  }
}


export type LeaseRpc = (
  type:
    | "composer.lease.get"
    | "composer.lease.claim"
    | "composer.lease.release"
    | "composer.lease.release_overlay",
  body: Record<string, unknown>,
) => Promise<any>

/**
 * Overlay claim with CAS retry. A concurrent panel claim between get and
 * claim returns LEASE_REV_MISMATCH + current rev; retry with that rev.
 */
export function shouldBroadcastLease(type: string, result: unknown): boolean {
  if (!result || typeof result !== "object") return false
  const resultType = (result as { type?: string }).type
  if (type === "composer.lease.release_overlay") return resultType === "composer.lease.released"
  if (type !== "composer.lease.claim" && type !== "composer.lease.release") return false
  return resultType === "composer.lease"
}

export async function releaseOverlayLeaseCas(
  threadId: string,
  rpc: LeaseRpc,
  attempts = 3,
): Promise<{ ok: boolean; state?: ComposerLeaseState; error_code?: string }> {
  let rev: number | undefined
  for (let i = 0; i < attempts; i++) {
    if (rev == null) {
      const got = await rpc("composer.lease.get", { thread_id: threadId })
      if (got?.holder !== "overlay") {
        return {
          ok: true,
          state: {
            thread_id: String(got?.thread_id ?? threadId),
            holder: "panel",
            rev: typeof got?.rev === "number" ? got.rev : 0,
          },
        }
      }
      rev = typeof got?.rev === "number" ? got.rev : 0
    }
    const released = await rpc("composer.lease.release", {
      thread_id: threadId,
      rev,
    })
    if (released?.error_code === "LEASE_REV_MISMATCH") {
      rev = typeof released.rev === "number" ? released.rev : undefined
      continue
    }
    if (typeof released?.rev === "number" && released.holder === "panel") {
      return {
        ok: true,
        state: {
          thread_id: String(released.thread_id ?? threadId),
          holder: "panel",
          rev: released.rev,
        },
      }
    }
    return {
      ok: false,
      error_code: typeof released?.error_code === "string" ? released.error_code : "LEASE_RELEASE_FAILED",
    }
  }
  return { ok: false, error_code: LEASE_REV_MISMATCH }
}

export async function applySummonerComposerVisibility(args: {
  visible: boolean
  threadId: string
  rpc: LeaseRpc
}): Promise<{ ok: boolean; state?: ComposerLeaseState; error_code?: string }> {
  if (!args.visible) return releaseAllOverlayLeases(args.rpc)
  const threadId = args.threadId.trim()
  if (!threadId) return { ok: false, error_code: "LEASE_NO_THREAD" }
  return claimOverlayLeaseCas(threadId, args.rpc)
}

/** Summoner socket death drops every overlay hold so Side Panel is not stuck. */
export function overlayLeasesOnSummonerDisconnect(
  surface: string | undefined,
  registry: ComposerLeaseRegistry = composerLeases,
): ComposerLeaseState[] {
  if (surface !== "summoner") return []
  return registry.releaseAllOverlay()
}

export function broadcastOverlayLeasesOnSocketClose(
  surface: string | undefined,
  broadcast: (msg: {
    type: "composer.lease"
    thread_id: string
    holder: ComposerHolder
    rev: number
  }) => void,
  registry: ComposerLeaseRegistry = composerLeases,
): number {
  const released = overlayLeasesOnSummonerDisconnect(surface, registry)
  for (const state of released) {
    broadcast({
      type: "composer.lease",
      thread_id: state.thread_id,
      holder: state.holder,
      rev: state.rev,
    })
  }
  return released.length
}

export async function releaseAllOverlayLeases(
  rpc: LeaseRpc,
): Promise<{ ok: boolean; state?: ComposerLeaseState; error_code?: string }> {
  const released = await rpc("composer.lease.release_overlay", {})
  if (released?.type === "composer.lease.released" && Array.isArray(released.released)) {
    const last = released.released[released.released.length - 1] as ComposerLeaseState | undefined
    return {
      ok: true,
      state: last ?? { thread_id: "", holder: "panel", rev: 0 },
    }
  }
  return {
    ok: false,
    error_code:
      typeof released?.error_code === "string" ? released.error_code : "LEASE_RELEASE_FAILED",
  }
}

export async function claimOverlayLeaseCas(
  threadId: string,
  rpc: LeaseRpc,
  attempts = 3,
): Promise<{ ok: boolean; state?: ComposerLeaseState; error_code?: string }> {
  let rev: number | undefined
  for (let i = 0; i < attempts; i++) {
    if (rev == null) {
      const got = await rpc("composer.lease.get", { thread_id: threadId })
      rev = typeof got?.rev === "number" ? got.rev : 0
    }
    const claim = await rpc("composer.lease.claim", {
      thread_id: threadId,
      holder: "overlay",
      rev,
    })
    if (claim?.error_code === "LEASE_REV_MISMATCH") {
      rev = typeof claim.rev === "number" ? claim.rev : undefined
      continue
    }
    if (typeof claim?.rev === "number" && claim.holder === "overlay") {
      return {
        ok: true,
        state: {
          thread_id: String(claim.thread_id ?? threadId),
          holder: "overlay",
          rev: claim.rev,
        },
      }
    }
    return { ok: false, error_code: typeof claim?.error_code === "string" ? claim.error_code : "LEASE_CLAIM_FAILED" }
  }
  return { ok: false, error_code: LEASE_REV_MISMATCH }
}
