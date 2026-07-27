// Process-wide single-flight for shell_exec / netsec_port_scan — ADR-015 §3 / §4
//
// Owner-aware: same owner may re-enter (L2 path reserves flight before confirm,
// execute path re-acquires without BUSY). releaseFlight only frees when owner matches
// (or when owner omitted for legacy call sites that own the slot exclusively).

const busy = new Map<string, string>() // tool -> owner thread or "global"

export type FlightTool = "shell_exec" | "netsec_port_scan"

export type FlightResult =
  | { ok: true; reentrant?: boolean }
  | { ok: false; error: string; holder?: string }

/** Non-holding probe — use before L2 so we never show confirm when already busy. */
export function isFlightBusy(tool: FlightTool): { busy: true; holder: string } | { busy: false } {
  const holder = busy.get(tool)
  if (holder) return { busy: true, holder }
  return { busy: false }
}

export function tryAcquireFlight(tool: FlightTool, owner: string): FlightResult {
  const holder = busy.get(tool)
  if (holder) {
    if (holder === (owner || "unknown")) {
      // Same owner re-enter (reserved across L2 confirm → execute)
      return { ok: true, reentrant: true }
    }
    return {
      ok: false,
      error: `${tool}_BUSY: another ${tool} is in flight (holder=${holder}). Wait and retry.`,
      holder,
    }
  }
  busy.set(tool, owner || "unknown")
  return { ok: true }
}

/**
 * Release flight. When `owner` is provided, only release if it matches the holder
 * (prevents cancel paths from stealing another worker's flight).
 */
export function releaseFlight(tool: FlightTool, owner?: string): void {
  const holder = busy.get(tool)
  if (!holder) return
  if (owner != null && holder !== (owner || "unknown")) {
    return
  }
  busy.delete(tool)
}

export function flightSnapshot(): Record<string, string> {
  const o: Record<string, string> = {}
  for (const [k, v] of busy) o[k] = v
  return o
}

export function _resetFlightsForTests(): void {
  busy.clear()
}
