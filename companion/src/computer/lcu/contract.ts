// #775: pure boundary contracts. Importing this module starts no runtime or provider.
import path from "node:path"

export const LCU_VERSION = "0.13.0"
export const LCU_SOURCE = "c38f4b6286ba74ebf053c2b3d1970e387556a559"
export const LCU_INSTALL_URL = "https://github.com/amontlabs/lcu/blob/v0.13.0/docs/INSTALLATION.md"
export const LCU_TOOL_NAMES = ["lcu_js", "lcu_js_reset"] as const
export type LcuToolName = typeof LCU_TOOL_NAMES[number]
export type LcuPlatform = "darwin" | "linux" | "unsupported"

export interface LcuConfig {
  enabled: boolean
  /** An executable path, never a shell command or an argv string. */
  command?: string
}

export interface LcuObservedStatus {
  lcuVersion: string
  platform: "darwin" | "linux"
  architecture: "arm64" | "x64"
  appVersion: string
  runtimeVersion: string
  pair: "tested" | "untested" | "unknown"
  changedSinceInstall: boolean
  /** Upstream evidence is not evidence of a CMspark desktop action. */
  nativeVerified: false
}

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
const bounded = (v: unknown, max = 256): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v)

export function supportedLcuPlatform(platform: string, arch: string): LcuPlatform {
  if (platform === "darwin" && arch === "arm64") return "darwin"
  if (platform === "linux" && (arch === "arm64" || arch === "x64")) return "linux"
  return "unsupported"
}

export function lcuCandidates(platform: string, arch: string, home: string, custom?: string): string[] {
  if (supportedLcuPlatform(platform, arch) === "unsupported") return []
  if (custom !== undefined) return validLcuCommand(custom) ? [custom] : []
  return platform === "darwin"
    ? [path.posix.join(home, ".local/share/lcu/current/bin/lcu")]
    : ["/opt/lcu/current/bin/lcu", path.posix.join(home, ".local/share/lcu/current/bin/lcu")]
}

export function validLcuCommand(value: unknown): value is string {
  // Both supported runtime platforms use POSIX paths, even when their pure
  // detection contract is evaluated by a Windows caller/test host.
  return bounded(value, 4096) && path.posix.isAbsolute(value) && path.posix.basename(value) === "lcu"
}

/** Project only actual fields emitted by upstream lcu/status.mjs collect(). */
export function projectLcuStatus(input: unknown): LcuObservedStatus | undefined {
  if (!record(input) || !bounded(input.lcu_version) || !record(input.app) || !record(input.compatibility)) return
  const { platform, architecture, app, compatibility } = input
  if (supportedLcuPlatform(String(platform), String(architecture)) === "unsupported") return
  if (!bounded(app.version) || !bounded(app.runtime)) return
  if (!["tested", "untested", "unknown"].includes(String(compatibility.status))) return
  const tested = compatibility.status === "tested" ? true : compatibility.status === "untested" ? false : null
  if (compatibility.tested !== tested || compatibility.platform !== platform || compatibility.architecture !== architecture ||
      compatibility.app_version !== app.version || compatibility.runtime !== app.runtime) return
  if (input.changed_since_install !== null && !bounded(input.changed_since_install, 8192)) return
  return {
    lcuVersion: input.lcu_version,
    platform: platform as "darwin" | "linux",
    architecture: architecture as "arm64" | "x64",
    appVersion: app.version,
    runtimeVersion: app.runtime,
    pair: compatibility.status as LcuObservedStatus["pair"],
    changedSinceInstall: input.changed_since_install !== null,
    nativeVerified: false,
  }
}

export function lcuEnableRefusal(status: LcuObservedStatus | undefined): string | undefined {
  if (!status) return "LCU_STATUS_UNVERIFIED"
  if (status.lcuVersion !== LCU_VERSION) return "LCU_VERSION_UNSUPPORTED"
  if (status.platform !== "darwin" || status.architecture !== "arm64") return "LCU_PLATFORM_APPROVAL_NOT_VERIFIED"
  if (status.changedSinceInstall) return "LCU_RUNTIME_CHANGED"
  if (status.pair !== "tested") return "LCU_RUNTIME_PAIR_UNVERIFIED"
  return undefined
}

/** Never inherit loader, credential, sandbox-disable or approval overrides. */
export function lcuEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of ["HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "XDG_RUNTIME_DIR", "DISPLAY", "DBUS_SESSION_BUS_ADDRESS"]) {
    if (typeof source[key] === "string") env[key] = source[key]!
  }
  env.CUA_REPL_ENABLED_SURFACES = "computer"
  env.SKY_ENABLE_AUDIO = "0"
  env.NODE_REPL_ENABLE_AUDIO = "0"
  return env
}

export interface LcuAppRequest { message: string; app: string; warning?: string; sessionOffered: boolean }

/** Same original shape as nativeAppApprovalOptions at the pinned upstream source. */
export function lcuAppRequest(value: unknown): LcuAppRequest | undefined {
  if (!record(value) || value.mode !== "form" || !bounded(value.message, 16384) || !record(value.requestedSchema) || !record(value._meta)) return
  const schema = value.requestedSchema, meta = value._meta
  if (schema.type !== "object" || !record(schema.properties) || Object.keys(schema.properties).length !== 0 ||
      (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.length !== 0))) return
  if (meta.codex_approval_kind !== "mcp_tool_call" || meta.connector_id !== "computer-use" || !record(meta.tool_params) || !bounded(meta.tool_params.app, 1024)) return
  const app = meta.tool_params.app
  // The hosted confirmation UI and dedicated agent hosts are not approval targets.
  // Upstream also enforces its own deny list. This never writes its approval store.
  const id = app.toLowerCase().replace(/\.app$/, "")
  if (/(?:cmspark|com\.openai\.codex|com\.apple\.terminal|com\.google\.chrome|com\.microsoft\.edgemac|org\.chromium\.chromium|org\.mozilla\.firefox|com\.apple\.safari|com\.anthropic\.claude)/.test(id) ||
      ["terminal", "iterm", "iterm2", "codex", "claude", "google chrome", "chromium", "firefox", "safari", "microsoft edge"].includes(id)) return
  const warning = [meta.warningSubtitle, meta.subtitle].find(v => bounded(v, 8192)) as string | undefined
  return { message: value.message, app, ...(warning ? { warning } : {}), sessionOffered: Array.isArray(meta.persist) && meta.persist.includes("session") }
}

export function lcuAppResponse(request: LcuAppRequest | undefined, approved: boolean, current: boolean) {
  if (!request || !current) return { action: "cancel" as const }
  if (!approved) return { action: "decline" as const }
  return { action: "accept" as const, content: {} }
}
