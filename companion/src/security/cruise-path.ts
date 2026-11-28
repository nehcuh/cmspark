/**
 * Three-flag full-autonomy cruise = path risk acceptance.
 * Product: under cruise, do not apply blanket path cages; only refuse paths
 * that are themselves high-risk semantics (volume roots, multi-user profile
 * roots, OS system trees). Behavioral SSRF (cloud metadata, etc.) stays elsewhere.
 */

import * as path from "path"
import { isFullAutonomyCruise, type CruiseSecurityFlags } from "../security-arm"
import {
  isVolumeOrFsRoot,
  isMultiUserProfilesRoot,
  isSensitiveSystemDir,
} from "./protected-paths"

export function isCruisePathRiskAccepted(
  security?: CruiseSecurityFlags,
): boolean {
  try {
    if (security != null) return isFullAutonomyCruise(security)
    const { getConfig } = require("../config") as typeof import("../config")
    return isFullAutonomyCruise(getConfig().security ?? {})
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
