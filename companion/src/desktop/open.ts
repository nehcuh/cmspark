import type { DesktopHostLauncher } from "./host-launcher"
/** Consumes only lifecycle-stamped identity; never a renderer supplied surface. */
export async function requestDesktopOpen(frame: Record<string, unknown>, auth: { authenticated: boolean; surface?: string; origin?: string }, launcher: Pick<DesktopHostLauncher, "open">): Promise<Record<string, unknown>> {
  const id = typeof frame.id === "string" ? frame.id : undefined
  if (!auth.authenticated || auth.surface !== "tray" || auth.origin !== "cmspark-tray://local") return { type: "desktop.open.result", ok: false, error_code: "DESKTOP_LAUNCH_DENIED", ...(id ? { id } : {}) }
  if (frame.type !== "desktop.open" || Object.keys(frame).some(k => !["type", "view", "id"].includes(k)) || (frame.id !== undefined && (typeof frame.id !== "string" || frame.id.length > 200)) || (frame.view !== undefined && frame.view !== "compact" && frame.view !== "workspace")) return { type: "desktop.open.result", ok: false, error_code: "DESKTOP_REQUEST_INVALID", ...(id ? { id } : {}) }
  const result = await launcher.open(frame.view === "workspace" ? "workspace" : "compact")
  return { ...result, ...(id ? { id } : {}) }
}
