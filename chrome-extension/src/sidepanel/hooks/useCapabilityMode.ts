import { useEffect, useRef, useMemo, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import {
  DEFAULT_QUIESCENCE_MS,
  deriveCapabilityLevel,
  levelBadgeLabel,
  levelEscalateToast,
  type ModeInput,
} from "../mode/mode-controller"
import type { CapabilityLevel } from "../types"

function useStateTick(ms: number): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
  return tick
}

export function useCapabilityMode(
  onEscalate?: (msg: string) => void,
): { level: CapabilityLevel; badgeLabel: string } {
  const { state } = useAgentStore()
  const tick = useStateTick(5000)

  const level = useMemo(() => {
    const input: ModeInput = {
      now: Date.now(),
      computerTaskStatus: state.computerTask?.status ?? null,
      pendingConfirmToolNames: state.pendingSecurityConfirmations.map((c) => c.tool_name),
      lastBrowserToolAt: state.lastBrowserToolAt,
      quiescenceMs: DEFAULT_QUIESCENCE_MS,
      modePin: state.modePin,
    }
    return deriveCapabilityLevel(input)
  }, [
    state.computerTask?.status,
    state.pendingSecurityConfirmations,
    state.lastBrowserToolAt,
    state.modePin,
    tick,
  ])

  const prevRef = useRef<CapabilityLevel | null>(null)
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = level
    if (prev == null) return
    const order = { chat: 0, browser: 1, computer: 2 } as const
    if (order[level] > order[prev]) {
      const msg = levelEscalateToast(level)
      if (msg && onEscalate) onEscalate(msg)
    }
  }, [level, onEscalate])

  return { level, badgeLabel: levelBadgeLabel(level) }
}
