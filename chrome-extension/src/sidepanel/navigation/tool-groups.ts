import { contextBarOverflowTabsForLevel, contextBarTabsForLevel, type ContextBarTabId } from "../mode/mode-controller"
import type { CapabilityLevel } from "../types"

export function toolGroups(level: CapabilityLevel): { title: "当前任务" | "其他工具"; ids: ContextBarTabId[] }[] {
  return [
    { title: "当前任务", ids: contextBarTabsForLevel(level) },
    { title: "其他工具", ids: contextBarOverflowTabsForLevel(level) },
  ]
}
