// #723 first identity vertical. No frame, rectangle, mask or action authority.
export const COCKPIT_NATIVE_HOST = "com.cmspark.cockpit"
export const COCKPIT_NATIVE_PORT = "cmspark-cockpit-native"
export type CockpitBridgeBind = { v: 1; op: "bind"; ownerNonce: string; challenge: string; documentId: string; windowId: number }
export type CockpitBridgeBound = Omit<CockpitBridgeBind, "op"> & {
  op: "bound"; portNonce: string; hwndDecimal: string; tagValue: string; pid: number; tid: number
}
export type CockpitBridgeUnavailable = { v: 1; op: "unavailable"; reason: "bridge_unavailable" }
export type CockpitBridgeDispose = { v: 1; op: "dispose"; ownerNonce: string; portNonce: string }
export function isCockpitNativeBound(value: unknown): value is CockpitBridgeBound {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const d = Object.getOwnPropertyDescriptors(value)
    const keys = ["v", "op", "ownerNonce", "challenge", "documentId", "windowId", "portNonce", "hwndDecimal", "tagValue", "pid", "tid"]
    if (Reflect.ownKeys(value).length !== keys.length || !keys.every(k => d[k] && "value" in d[k])) return false
    const v = value as CockpitBridgeBound
    const decimal = (s: unknown, max = 0xffffffffffffffffn) => typeof s === "string" && /^[1-9][0-9]{0,19}$/.test(s) && BigInt(s) <= max
    return v.v === 1 && v.op === "bound" && typeof v.ownerNonce === "string" && /^[0-9a-f]{32}$/.test(v.ownerNonce) &&
      typeof v.portNonce === "string" && /^[0-9a-f]{32}$/.test(v.portNonce) && typeof v.challenge === "string" &&
      /^[0-9a-f]{64}$/.test(v.challenge) && typeof v.documentId === "string" && /^[\x21-\x7e]{1,128}$/.test(v.documentId) &&
      Number.isInteger(v.windowId) && v.windowId > 0 && v.windowId <= 2147483647 && decimal(v.hwndDecimal, 0x7fffffffffffffffn) && decimal(v.tagValue) &&
      Number.isInteger(v.pid) && v.pid > 0 && v.pid <= 0xffffffff && Number.isInteger(v.tid) && v.tid > 0 && v.tid <= 0xffffffff
  } catch { return false }
}
