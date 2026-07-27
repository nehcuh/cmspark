// Process-wide single-flight for shell_exec / netsec_port_scan — ADR-015 §3 / §4

const busy = new Map<string, string>() // tool -> owner thread or "global"

export type FlightResult =
  | { ok: true }
  | { ok: false; error: string; holder?: string }

export function tryAcquireFlight(tool: "shell_exec" | "netsec_port_scan", owner: string): FlightResult {
  const holder = busy.get(tool)
  if (holder) {
    return {
      ok: false,
      error: `${tool}_BUSY: another ${tool} is in flight (holder=${holder}). Wait and retry.`,
      holder,
    }
  }
  busy.set(tool, owner || "unknown")
  return { ok: true }
}

export function releaseFlight(tool: "shell_exec" | "netsec_port_scan"): void {
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
