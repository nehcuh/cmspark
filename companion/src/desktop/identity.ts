/** #480: native-desktop identity primitive used only by the dedicated channel.
 * Only the trusted host launcher may issue a bootstrap. Never expose this API
 * to a renderer, overlay, HTTP route or existing WS client.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { DESKTOP_NATIVE_METHODS, DESKTOP_METHOD_SET_VERSION } from "./capabilities"
export { DESKTOP_READ_METHODS } from "./capabilities"

export type DesktopPrincipal = Readonly<{ hostSessionId: string; connectionId: string }>
export type DesktopBootstrap = Readonly<{ capabilityId: string; secret: string }>
export type DesktopChallenge = Readonly<{ nonce: string; signingInput: string }>

type Pending = {
  nonce: string
  connectionId: string
  protocolVersion: number
  signingInput: string
  expiresAt: number
}
type Capability = {
  hostSessionId: string
  secret: Buffer
  methods: readonly string[]
  methodSetVersion: number
  bootstrapExpiresAt: number
  activated: boolean
  pending?: Pending
  principal?: DesktopPrincipal
}

const BOOTSTRAP_TTL_MS = 30_000
const CHALLENGE_TTL_MS = 10_000
const MAX_HOST_SESSIONS = 64
const HEX_PROOF = /^[0-9a-f]{64}$/i
const CONNECTION_ID = /^[A-Za-z0-9_-]{1,128}$/

export class DesktopIdentityRegistry {
  private readonly capabilities = new Map<string, Capability>()
  private readonly principals = new WeakMap<DesktopPrincipal, string>()
  private readonly revocations = new Set<(id: string) => void>()
  onRevoke(fn: (id: string) => void): () => void { this.revocations.add(fn); return () => this.revocations.delete(fn) }

  constructor(private readonly now: () => number = Date.now) {}

  /** The return value is for a native child bootstrap pipe, not a WS response. */
  issue(hostSessionId: string): DesktopBootstrap {
    if (!CONNECTION_ID.test(hostSessionId)) throw new Error("Invalid desktop host session")
    this.pruneUnactivated()
    if ([...this.capabilities.values()].some(c => c.hostSessionId === hostSessionId)) {
      throw new Error("Desktop host session already issued")
    }
    if (this.capabilities.size >= MAX_HOST_SESSIONS) throw new Error("Desktop host session limit reached")
    const capabilityId = randomBytes(16).toString("hex")
    const secret = randomBytes(32)
    this.capabilities.set(capabilityId, {
      hostSessionId, secret, methods: Object.freeze([...DESKTOP_NATIVE_METHODS]), methodSetVersion: DESKTOP_METHOD_SET_VERSION, activated: false,
      bootstrapExpiresAt: this.now() + BOOTSTRAP_TTL_MS,
    })
    return Object.freeze({ capabilityId, secret: secret.toString("hex") })
  }

  /** Connection ID and negotiated protocol come from the server, never payload claims. */
  challenge(capabilityId: string, connectionId: string, protocolVersion: number): DesktopChallenge | null {
    const capability = this.live(capabilityId)
    if (!capability || !CONNECTION_ID.test(connectionId) ||
        !Number.isSafeInteger(protocolVersion) || protocolVersion < 1) return null
    const nonce = randomBytes(32).toString("hex")
    const signingInput = JSON.stringify([
      "cmspark.desktop.auth.v1", capabilityId, connectionId, protocolVersion, nonce,
    ])
    capability.pending = {
      nonce, signingInput, connectionId, protocolVersion,
      expiresAt: this.now() + CHALLENGE_TTL_MS,
    }
    return Object.freeze({ nonce, signingInput })
  }

  authenticate(
    capabilityId: string, connectionId: string, protocolVersion: number, proof: unknown,
  ): DesktopPrincipal | null {
    const capability = this.live(capabilityId)
    const pending = capability?.pending
    if (!capability || !pending) return null
    // A stale/foreign socket must not consume the live connection's challenge.
    if (pending.connectionId !== connectionId) return null
    // Consume even a failed attempt: a challenge cannot be retried/replayed.
    delete capability.pending
    if (pending.expiresAt <= this.now() ||
        pending.protocolVersion !== protocolVersion || typeof proof !== "string" || !HEX_PROOF.test(proof)) return null
    const expected = createHmac("sha256", capability.secret).update(pending.signingInput).digest()
    if (!timingSafeEqual(expected, Buffer.from(proof, "hex"))) return null
    const principal = Object.freeze({ hostSessionId: capability.hostSessionId, connectionId })
    // A reconnect creates a fresh principal; the old connection loses access.
    capability.principal = principal
    capability.activated = true
    this.principals.set(principal, capabilityId)
    return principal
  }

  allows(principal: DesktopPrincipal, method: string): boolean {
    const id = this.principals.get(principal)
    const capability = id ? this.capabilities.get(id) : undefined
    return !!capability && capability.principal === principal && capability.methods.includes(method)
  }

  /** Disconnect cancels connection authority; host may reconnect using a fresh challenge.
   * Caller must separately cancel the existing confirmation manager's owned requests.
   */
  disconnect(principal: DesktopPrincipal): void {
    const id = this.principals.get(principal)
    const capability = id ? this.capabilities.get(id) : undefined
    if (capability?.principal === principal) delete capability.principal
  }

  cancelChallenge(capabilityId: string, connectionId: string): void {
    const capability = this.capabilities.get(capabilityId)
    if (capability?.pending?.connectionId === connectionId) delete capability.pending
  }

  revoke(capabilityId: string): void {
    const capability = this.capabilities.get(capabilityId)
    if (capability) capability.secret.fill(0)
    this.capabilities.delete(capabilityId)
    if (capability) for (const fn of this.revocations) fn(capabilityId)
  }

  /** Trusted launcher-owned host retirement also covers never-authenticated issuances. */
  revokeHost(hostSessionId: string): void {
    for (const [id, capability] of this.capabilities) if (capability.hostSessionId === hostSessionId) this.revoke(id)
  }

  revokeAll(): void {
    for (const id of this.capabilities.keys()) this.revoke(id)
  }

  private live(id: string): Capability | undefined {
    const capability = this.capabilities.get(id)
    if (capability && !capability.activated && capability.bootstrapExpiresAt <= this.now()) {
      this.revoke(id)
      return undefined
    }
    return capability
  }

  private pruneUnactivated(): void {
    for (const id of this.capabilities.keys()) this.live(id)
  }
}
