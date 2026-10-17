/** #480: sole issued method-set source. Changes require launcher revocation/remint. */
export const DESKTOP_METHOD_SET_VERSION = 2
export const DESKTOP_NATIVE_ORIGIN = "cmspark-desktop-native://local"
export const DESKTOP_READ_METHODS = Object.freeze([
  "system.ping", "thread.list", "thread.peek", "mcp.list", "skill.list", "knowledge.list",
] as const)
export const DESKTOP_BOOTSTRAP_MAX_BYTES = 4096
export const DESKTOP_CHALLENGE_TTL_MS = 10_000

/** Renderer submissions and controller-only responses are deliberately distinct. */
export const DESKTOP_RENDERER_METHODS = Object.freeze([...DESKTOP_READ_METHODS, "desktop.mcp.edit", "desktop.mcp.save"] as const)
export const DESKTOP_NATIVE_METHODS = Object.freeze([...DESKTOP_RENDERER_METHODS, "desktop.confirmation.decision"] as const)
