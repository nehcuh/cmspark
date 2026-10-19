// #723: read-only observation, never a reservation or confirmation authority.
export function validCockpitIdleRequest(value: unknown): value is { type: "cockpit.idle.get"; id: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  try {
    const d = Object.getOwnPropertyDescriptors(value)
    return Object.keys(d).sort().join() === "id,type" && !!d.type && "value" in d.type && d.type.value === "cockpit.idle.get" &&
      !!d.id && "value" in d.id && typeof d.id.value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(d.id.value)
  } catch { return false }
}
export function sendCockpitIdleSnapshot(
  ws: { readyState: number; send(data: string): void }, request: unknown,
  auth: { authenticated?: boolean; surface?: string; origin?: string } | undefined,
  currentAuth: () => unknown, pendingCount: () => number, tasks: ReadonlyMap<string, boolean>,
): void {
  if (!validCockpitIdleRequest(request) || !auth?.authenticated || auth.surface !== "panel" || !/^chrome-extension:\/\//i.test(auth.origin || "")) return
  let state: "IDLE" | "BUSY" | "UNKNOWN" = "UNKNOWN"
  try {
    const pending = pendingCount(), active = tasks.size
    if (Number.isSafeInteger(pending) && pending >= 0 && Number.isSafeInteger(active) && active >= 0) state = pending > 0 || active > 0 ? "BUSY" : "IDLE"
  } catch { /* Missing authority never means idle. */ }
  // No await between reading the actual singletons and enqueueing this frame.
  if (ws.readyState === 1 && currentAuth() === auth && auth.authenticated) {
    try { ws.send(JSON.stringify({ type: "cockpit.idle.result", id: request.id, state })) } catch { /* disconnected: keep UI */ }
  }
}
