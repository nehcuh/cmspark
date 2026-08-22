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
  | { ok: true; state: ComposerLeaseState }
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
    return { ok: true, state: next }
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
    return { ok: true, state: next }
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
      return { type: "composer.lease", ...leasePayload(result.state) }
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
    default:
      return null
  }
}
