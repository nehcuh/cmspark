/** Only composition failures with an established level get a tool discriminator.
 * Trust, dynamic apply_blocked and unknown failures keep their existing fallback. */
export function packApplyErrorCode(code?: string):
  | "PACK_MODULE_DISABLED"
  | "PACK_ENTERPRISE_PROFILE_REQUIRED"
  | undefined {
  if (code === "module_disabled") return "PACK_MODULE_DISABLED"
  if (code === "enterprise_profile_required") return "PACK_ENTERPRISE_PROFILE_REQUIRED"
  return undefined
}
