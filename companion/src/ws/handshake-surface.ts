/**
 * Batch E (#251): derive handshake surface from Origin class + claimed field.
 * HMAC remains the WS gate. This is mis-label hygiene among authenticated peers.
 *
 * Wire `surface` stays omit | "tray" | "summoner" (validate.ts). `"panel"` is
 * server-side only — never a client-claimed value.
 */

export type HandshakeSurface = "panel" | "tray" | "summoner"

const EXT_ORIGIN = /^chrome-extension:\/\/[A-Za-z0-9_-]+$/i
export const TRAY_WS_ORIGIN = "cmspark-tray://local"

export function isChromeExtensionWsOrigin(origin: string | undefined | null): boolean {
  return typeof origin === "string" && EXT_ORIGIN.test(origin)
}

export type SurfaceFromOrigin =
  | { ok: true; surface: HandshakeSurface; coerced: boolean }
  | {
      ok: false
      reason: "summoner_from_extension" | "omit_tray" | "unknown_origin"
    }

export function surfaceFromOrigin(
  origin: string | undefined | null,
  claimed: unknown,
): SurfaceFromOrigin {
  const originStr = typeof origin === "string" ? origin : ""
  if (EXT_ORIGIN.test(originStr)) {
    if (claimed === "summoner") {
      return { ok: false, reason: "summoner_from_extension" }
    }
    return { ok: true, surface: "panel", coerced: claimed === "tray" }
  }
  if (originStr === TRAY_WS_ORIGIN) {
    if (claimed === "tray" || claimed === "summoner") {
      return { ok: true, surface: claimed, coerced: false }
    }
    return { ok: false, reason: "omit_tray" }
  }
  return { ok: false, reason: "unknown_origin" }
}
