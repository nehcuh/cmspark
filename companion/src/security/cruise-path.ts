/**
 * Three-flag full-autonomy cruise = path risk acceptance.
 * Product: under cruise, do not apply blanket path cages; only refuse paths
 * that are themselves high-risk semantics (volume roots, multi-user profile
 * roots, OS system trees). Behavioral SSRF (cloud metadata, etc.) stays elsewhere.
 */

import * as path from "path"
import { getConfig } from "../config"
import { isFullAutonomyCruise } from "../tool/l2-admission"
import {
  isVolumeOrFsRoot,
  isMultiUserProfilesRoot,
  isSensitiveSystemDir,
} from "../mcp/allow-dir-expand"

export function isCruisePathRiskAccepted(
  security?: {
    auto_approve_dangerous?: boolean
    auto_approve_enterprise_tools?: boolean
    allow_all_schemes?: boolean
  },
): boolean {
  try {
    return isFullAutonomyCruise(security ?? getConfig().security ?? {})
  } catch {
    return false
  }
}

/**
 * Paths that remain denied even under cruise (not "path sandbox for convenience"
 * but semantic hard danger: whole volume / all users / OS trees).
 */
export function isCruiseHardDangerPath(
  absPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!absPath || typeof absPath !== "string") return true
  let p = absPath
  try {
    p = path.resolve(absPath)
  } catch {
    return true
  }
  if (isVolumeOrFsRoot(p)) return true
  if (isMultiUserProfilesRoot(p, platform)) return true
  if (isSensitiveSystemDir(p, platform)) return true
  return false
}
