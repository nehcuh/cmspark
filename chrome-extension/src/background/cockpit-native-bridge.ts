import { claimCockpitNativeDocument } from "./cockpit-window"
import { isCockpitNativeBound } from "../shared/cockpit-native-bridge"
export { COCKPIT_NATIVE_PORT } from "../shared/cockpit-native-bridge"
import { COCKPIT_NATIVE_PORT } from "../shared/cockpit-native-bridge"
type Connection = { current(): boolean; send(frame: object): boolean }
type Claim = NonNullable<Awaited<ReturnType<typeof claimCockpitNativeDocument>>>
type Held = { port: chrome.runtime.Port; claim: Claim; ownerNonce: string; connection: Connection; challenge: string | null; retired: boolean }
const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("")
/** Native JSON is accepted only from this current first-party document Port. */
export function createCockpitNativeRelay(connection: () => Connection) {
  let held: Held | null = null
  let attempt = {}
  const current = (h: Held) => held === h && !h.retired && h.claim.isCurrent() && h.connection.current()
  function retire(h: Held) {
    if (h.retired) return
    h.retired = true
    if (held === h) held = null
    try { if (h.connection.current()) h.connection.send({ type: "cockpit.bridge.retire", v: 1, ownerNonce: h.ownerNonce }) }
    catch { /* no transport effect can prevent owned local retirement */ }
    // The document owns the native port and keeps its cleanup callbacks through
    // actual native close. Closing this runtime port is not cleanup proof.
    try { h.port.disconnect() } catch { /* already closed */ }
  }
  return {
    async attach(port: chrome.runtime.Port): Promise<void> {
      if (port.name !== COCKPIT_NATIVE_PORT) return
      if (held && current(held)) { try { port.disconnect() } catch {}; return }
      const ticket = {}; attempt = ticket
      let closed = false
      port.onDisconnect.addListener(() => { closed = true; if (held?.port === port) retire(held) })
      const claim = port.sender ? await claimCockpitNativeDocument(port.sender) : null
      const endpoint = connection()
      if (closed || attempt !== ticket || !claim?.isCurrent() || !endpoint.current()) { try { port.disconnect() } catch {}; return }
      if (held) retire(held)
      const h: Held = { port, claim, connection: endpoint, ownerNonce: nonce(), challenge: null, retired: false }
      held = h
      port.onMessage.addListener(message => {
        void (async () => {
          if (current(h) && message?.v === 1 && message?.op === "unavailable" && message?.reason === "bridge_unavailable" &&
            Object.keys(message).sort().join() === "op,reason,v") { retire(h); return }
          if (!current(h) || !isCockpitNativeBound(message) || message.ownerNonce !== h.ownerNonce ||
            message.documentId !== h.claim.documentId || message.windowId !== h.claim.windowId || message.challenge !== h.challenge) return
          const { op: _op, ...identity } = message
          h.challenge = null // reserve before any async document revalidation
          if (!await h.claim.revalidate() || !current(h)) { retire(h); return }
          if (!h.connection.send({ type: "cockpit.bridge.bound", ...identity })) retire(h)
        })().catch(() => retire(h))
      })
      try {
        if (!endpoint.send({ type: "cockpit.bridge.hello", v: 1, ownerNonce: h.ownerNonce,
          documentId: claim.documentId, windowId: claim.windowId })) retire(h)
      } catch { retire(h) }
    },
    receive(message: any): boolean {
      if (message?.type !== "cockpit.bridge.challenge" && message?.type !== "cockpit.bridge.state") return false
      const h = held
      if (!h || !current(h) || message.v !== 1 || message.ownerNonce !== h.ownerNonce) return true
      if (message.type === "cockpit.bridge.challenge") {
        if (message.documentId !== h.claim.documentId || message.windowId !== h.claim.windowId ||
          typeof message.challenge !== "string" || !/^[0-9a-f]{64}$/.test(message.challenge) || h.challenge !== null) return true
        h.challenge = message.challenge
        try { h.port.postMessage({ v: 1, op: "bind", ownerNonce: h.ownerNonce, documentId: h.claim.documentId,
          windowId: h.claim.windowId, challenge: h.challenge }) } catch { retire(h) }
      }
      return true
    },
    disconnect(): void { attempt = {}; if (held) retire(held) },
  }
}
