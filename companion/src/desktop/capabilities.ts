/** #480: sole issued method-set source. Changes require launcher revocation/remint. */
export const DESKTOP_METHOD_SET_VERSION = 6
export const DESKTOP_NATIVE_ORIGIN = "cmspark-desktop-native://local"
export const DESKTOP_READ_METHODS = Object.freeze([
  "system.ping", "thread.list", "thread.peek", "thread.search", "mcp.list", "skill.list", "knowledge.list",
] as const)
export const DESKTOP_BOOTSTRAP_MAX_BYTES = 4096
export const DESKTOP_CHALLENGE_TTL_MS = 10_000

/** Renderer submissions and controller-only responses are deliberately distinct. */
export const DESKTOP_RENDERER_METHODS = Object.freeze([...DESKTOP_READ_METHODS, "desktop.mcp.edit", "desktop.mcp.save", "desktop.thread.metadata.edit", "desktop.thread.metadata.save", "desktop.thread.create", "desktop.thread.open", "desktop.chat.send", "desktop.chat.stop", "desktop.resource.read", "desktop.resource.import", "desktop.resource.update", "desktop.resource.remove"] as const)
export const DESKTOP_NATIVE_METHODS = Object.freeze([...DESKTOP_RENDERER_METHODS, "desktop.confirmation.decision"] as const)
