import { randomBytes } from "node:crypto"

// Identity experiment only. These receipts never grant an action or mask pixels.
export type CockpitBridgeIdentity = {
  v: 1; ownerNonce: string; challenge: string; documentId: string; windowId: number
  portNonce: string; hwndDecimal: string; tagValue: string; pid: number; tid: number
}
type Hello = Pick<CockpitBridgeIdentity, "v" | "ownerNonce" | "documentId" | "windowId"> & { type: "cockpit.bridge.hello" }
type Bound = CockpitBridgeIdentity & { type: "cockpit.bridge.bound" }
type Retire = { type: "cockpit.bridge.retire"; v: 1; ownerNonce: string }
type Auth = { authenticated?: boolean; surface?: string; origin?: string }
type Socket = { readyState: number; send(data: string): void }
const nonce = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{32}$/.test(v)
const challenge = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v)
const uint32 = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 0xffffffff
function decimal(v: unknown, max = 0xffffffffffffffffn): v is string {
  return typeof v === "string" && /^[1-9][0-9]{0,19}$/.test(v) && BigInt(v) <= max
}
function exact(v: unknown, keys: string[]): v is Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false
  const descriptors = Object.getOwnPropertyDescriptors(v)
  return Reflect.ownKeys(v).length === keys.length && keys.every(key => descriptors[key] && "value" in descriptors[key])
}
export function validCockpitBridgeMessage(v: unknown): v is Hello | Bound | Retire {
  try {
    if (!v || typeof v !== "object") return false
    const type = Object.getOwnPropertyDescriptor(v, "type")?.value
    const keys = type === "cockpit.bridge.hello" ? ["type", "v", "ownerNonce", "documentId", "windowId"]
      : type === "cockpit.bridge.bound" ? ["type", "v", "ownerNonce", "challenge", "documentId", "windowId", "portNonce", "hwndDecimal", "tagValue", "pid", "tid"]
      : type === "cockpit.bridge.retire" ? ["type", "v", "ownerNonce"] : null
    if (!keys || !exact(v, keys) || v.v !== 1 || !nonce(v.ownerNonce)) return false
    if (type === "cockpit.bridge.retire") return true
    if (typeof v.documentId !== "string" || !/^[\x21-\x7e]{1,128}$/.test(v.documentId) ||
      !Number.isInteger(v.windowId) || v.windowId < 1 || v.windowId > 2147483647) return false
    return type === "cockpit.bridge.hello" || (challenge(v.challenge) && nonce(v.portNonce) &&
      decimal(v.hwndDecimal, 0x7fffffffffffffffn) && decimal(v.tagValue) && uint32(v.pid) && uint32(v.tid))
  } catch { return false }
}

type Pending = { auth: Auth; hello: Hello; challenge: string; expires: number }
type Verified = { auth: Auth; identity: Bound }
/** At most one pending or verified identity per actual socket. No action API. */
export class CockpitNativeBridge {
  private pending = new WeakMap<Socket, Pending>()
  private verified = new WeakMap<Socket, Verified>()
  constructor(private now: () => number = () => performance.now(), private entropy: () => string = () => randomBytes(32).toString("hex")) {}
  close(socket: Socket): void { this.pending.delete(socket); this.verified.delete(socket) }
  handle(socket: Socket, message: unknown, auth: Auth | undefined, currentAuth: () => unknown): void {
    const current = () => socket.readyState === 1 && !!auth?.authenticated && auth.surface === "panel" &&
      /^chrome-extension:\/\/[a-p]{32}$/.test(auth.origin || "") && currentAuth() === auth
    if (!validCockpitBridgeMessage(message) || !current()) return
    if (message.type === "cockpit.bridge.retire") {
      if (this.pending.get(socket)?.hello.ownerNonce === message.ownerNonce) this.pending.delete(socket)
      if (this.verified.get(socket)?.identity.ownerNonce === message.ownerNonce) this.verified.delete(socket)
      return
    }
    if (message.type === "cockpit.bridge.hello") {
      const live = this.pending.get(socket)
      if (live && live.auth === auth && live.expires > this.now()) return
      this.close(socket)
      const value = this.entropy(), now = this.now()
      if (!challenge(value) || !Number.isFinite(now) || !current()) return
      // Copy finite primitives; never retain a caller-owned mutable message.
      const hello: Hello = { type: message.type, v: 1, ownerNonce: message.ownerNonce, documentId: message.documentId, windowId: message.windowId }
      const pending: Pending = { auth: auth!, hello, challenge: value, expires: now + 5000 }
      this.pending.set(socket, pending)
      try { socket.send(JSON.stringify({ type: "cockpit.bridge.challenge", v: 1, ownerNonce: hello.ownerNonce,
        documentId: hello.documentId, windowId: hello.windowId, challenge: value })) }
      catch { if (this.pending.get(socket) === pending) this.close(socket) }
      return
    }
    const pending = this.pending.get(socket)
    if (!pending || pending.auth !== auth || this.now() >= pending.expires ||
      message.ownerNonce !== pending.hello.ownerNonce || message.documentId !== pending.hello.documentId ||
      message.windowId !== pending.hello.windowId || message.challenge !== pending.challenge || !current()) return
    this.pending.delete(socket) // consumed exactly once, before any send callback
    const identity: Bound = { ...message }
    this.verified.set(socket, { auth: auth!, identity })
    try { socket.send(JSON.stringify({ type: "cockpit.bridge.state", v: 1, ownerNonce: message.ownerNonce, state: "verified" })) }
    catch { this.close(socket) }
  }
}
