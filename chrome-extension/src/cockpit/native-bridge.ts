import {
  COCKPIT_NATIVE_HOST,
  isCockpitNativeBound,
  type CockpitBridgeBind,
  type CockpitBridgeBound,
  type CockpitBridgeDispose,
} from "../shared/cockpit-native-bridge"

const BIND_KEYS = ["v", "op", "ownerNonce", "challenge", "documentId", "windowId"]
function plainKeys(raw: unknown, keys: string[]): raw is Record<string, unknown> {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false
    const fields = Object.getOwnPropertyDescriptors(raw)
    return Reflect.ownKeys(raw).length === keys.length && keys.every(key => fields[key] && "value" in fields[key])
  } catch { return false }
}
function isBind(raw: unknown): raw is CockpitBridgeBind {
  try {
    if (!plainKeys(raw, BIND_KEYS)) return false
    return raw.v === 1 && raw.op === "bind" && typeof raw.ownerNonce === "string" && /^[0-9a-f]{32}$/.test(raw.ownerNonce) &&
      typeof raw.challenge === "string" && /^[0-9a-f]{64}$/.test(raw.challenge) &&
      typeof raw.documentId === "string" && /^[\x21-\x7e]{1,128}$/.test(raw.documentId) &&
      typeof raw.windowId === "number" && Number.isInteger(raw.windowId) && raw.windowId > 0 && raw.windowId <= 2147483647
  } catch { return false }
}
function matches(value: CockpitBridgeBound, bind: CockpitBridgeBind): boolean {
  return value.ownerNonce === bind.ownerNonce && value.challenge === bind.challenge &&
    value.documentId === bind.documentId && value.windowId === bind.windowId
}

type DocumentBridgeOptions = {
  /** Test DI is inert; the production default calls Chrome from this document. */
  connectNative?: (host: string) => chrome.runtime.Port
  consumeLastError?: () => void
}

/**
 * Only the native Port's private onMessage callback may forward a bound DTO.
 * A runtime message claiming to be a native receipt is never accepted here.
 */
export function attachCockpitNativeBridge(runtime: chrome.runtime.Port, options: DocumentBridgeOptions = {}): () => void {
  const connectNative = options.connectNative ?? (host => chrome.runtime.connectNative(host))
  const consumeLastError = options.consumeLastError ?? (() => { void chrome.runtime.lastError })
  let stopped = false
  type Binding = { bind: CockpitBridgeBind; native: chrome.runtime.Port; portNonce: string | null; retiring: boolean; disposalSent: boolean }
  let current: Binding | null = null
  const unavailable = () => {
    if (stopped) return
    try { runtime.postMessage({ v: 1, op: "unavailable", reason: "bridge_unavailable" }) } catch { /* original runtime is already retired */ }
  }
  const requestDispose = (binding: Binding) => {
    binding.retiring = true
    if (!binding.portNonce || binding.disposalSent) return
    binding.disposalSent = true
    const dispose: CockpitBridgeDispose = { v: 1, op: "dispose", ownerNonce: binding.bind.ownerNonce, portNonce: binding.portNonce }
    try { binding.native.postMessage(dispose) } catch {
      // No success receipt is inferred. Closing an unavailable channel is not
      // proof that native property cleanup ran.
      try { binding.native.disconnect() } catch { /* already closed */ }
    }
    // Do not disconnect immediately after post: let the fixed host process
    // consume dispose, clean its own tag, exit, and close the original port.
  }
  const onRuntimeMessage = (raw: unknown) => {
    if (stopped) return
    if (plainKeys(raw, ["v", "op", "ownerNonce", "portNonce"]) && raw.v === 1 && raw.op === "dispose") {
      if (current && raw.ownerNonce === current.bind.ownerNonce && raw.portNonce === current.portNonce) requestDispose(current)
      return
    }
    if (!isBind(raw)) { unavailable(); return }
    if (current) { unavailable(); return } // one host; never queue or retry binds
    let native: chrome.runtime.Port
    try { native = connectNative(COCKPIT_NATIVE_HOST) } catch { unavailable(); return }
    const binding: Binding = { bind: raw, native, portNonce: null, retiring: false, disposalSent: false }
    current = binding
    const onNativeMessage = (value: unknown) => {
      if (isCockpitNativeBound(value) && matches(value, binding.bind) && binding.portNonce === null) {
        binding.portNonce = value.portNonce
        if (stopped || binding.retiring || current !== binding) { requestDispose(binding); return }
        // Fresh object with the exact production DTO fields; no arbitrary
        // client metadata or runtime-message receipt is forwarded.
        const bound: CockpitBridgeBound = {
          v: 1, op: "bound", ownerNonce: value.ownerNonce, challenge: value.challenge,
          documentId: value.documentId, windowId: value.windowId, portNonce: value.portNonce,
          hwndDecimal: value.hwndDecimal, tagValue: value.tagValue, pid: value.pid, tid: value.tid,
        }
        try { runtime.postMessage(bound) } catch { requestDispose(binding) }
        return
      }
      if (!binding.retiring) unavailable()
      // An invalid/duplicate/unavailable reply never creates or renews an
      // identity. If bound, request normal cleanup; otherwise close unknown.
      if (binding.portNonce) requestDispose(binding)
      else { binding.retiring = true; try { native.disconnect() } catch { /* already closed */ } }
    }
    const onNativeDisconnect = () => {
      consumeLastError()
      native.onMessage.removeListener(onNativeMessage)
      native.onDisconnect.removeListener(onNativeDisconnect)
      if (current === binding) current = null
      if (!binding.retiring) unavailable()
    }
    native.onMessage.addListener(onNativeMessage)
    native.onDisconnect.addListener(onNativeDisconnect)
    try { native.postMessage(raw) } catch {
      binding.retiring = true
      try { native.disconnect() } catch { /* already closed */ }
      unavailable()
    }
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    runtime.onMessage.removeListener(onRuntimeMessage)
    runtime.onDisconnect.removeListener(onRuntimeDisconnect)
    // A bind already in flight keeps only its native cleanup callback. A late
    // bound reply is disposed and can never be forwarded to a new document.
    if (current) requestDispose(current)
  }
  const onRuntimeDisconnect = () => { consumeLastError(); stop() }
  runtime.onMessage.addListener(onRuntimeMessage)
  runtime.onDisconnect.addListener(onRuntimeDisconnect)
  return stop
}
