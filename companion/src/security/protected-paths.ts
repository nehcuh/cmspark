import * as path from "node:path"

/** Sensitive home-relative prefixes (matched case-insensitively). */
export const SENSITIVE_HOME_PREFIXES = [
  ".ssh",
  ".gnupg",
  "library/keychains",
  "library/mail",
  ".aws",
  ".config/gcloud",
  ".config/gh",
  ".kube",
  // Plaintext-token files / dirs directly under home (L3 2026-08: the gate
  // copy claimed credential paths are hard-blocked; make it true for the
  // common ones). Shared with the file-open cage — keep both surfaces aligned.
  ".git-credentials",
  ".npmrc",
  ".netrc",
  ".docker",
  // Windows profile secrets often live under AppData
  "appdata/roaming/gnupg",
  "appdata/roaming/openssh",
]

/**
 * Path-segment basenames that never become allow-dirs (anywhere on disk).
 * Case-insensitive match on any path component.
 */
export const SENSITIVE_PATH_SEGMENTS = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".kube",
  "keychains",
]

/** True when dir is a filesystem / volume root (/, C:\). */
export function isVolumeOrFsRoot(dir: string): boolean {
  const resolved = path.resolve(dir)
  return path.dirname(resolved) === resolved
}

/**
 * Multi-user profile parents (one L2 click must not open every local account).
 * Exact match only — `C:/Users/alice` and `/home/bob` remain offerable.
 */
export function isMultiUserProfilesRoot(
  dirReal: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const n = dirReal.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
  if (platform === "win32") {
    return /^[a-z]:\/users$/.test(n)
  }
  return n === "/users" || n === "/home" || n === "/export/home"
}

/**
 * Hard-refuse OS / firmware trees. Does not cover ordinary project mounts
 * (D:/work, /opt/apps, /data). Matched after realpath + forward-slash normalize.
 */
export function isSensitiveSystemDir(
  dirReal: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const n = dirReal.replace(/\\/g, "/").toLowerCase()

  if (platform === "win32") {
    const patterns = [
      /^[a-z]:\/windows(\/|$)/,
      /^[a-z]:\/program files(\/|$)/,
      /^[a-z]:\/program files \(x86\)(\/|$)/,
      /^[a-z]:\/programdata(\/|$)/,
      /^[a-z]:\/\$recycle\.bin(\/|$)/,
      /^[a-z]:\/system volume information(\/|$)/,
      /^[a-z]:\/recovery(\/|$)/,
      /^[a-z]:\/perflogs(\/|$)/,
      /^[a-z]:\/boot(\/|$)/,
      /^[a-z]:\/efi(\/|$)/,
    ]
    return patterns.some((re) => re.test(n))
  }

  // POSIX / macOS system trees
  const prefixes = [
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/boot",
    "/proc",
    "/sys",
    "/dev",
    "/root",
    "/system",
    "/library/keychains",
    "/library/mail",
    "/private/etc",
    "/private/var/db",
    "/var/root",
    "/var/run",
    "/cores",
  ]
  return prefixes.some((p) => n === p || n.startsWith(p + "/"))
}
