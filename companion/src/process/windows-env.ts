// Match Node/libuv's Windows target-environment semantics without giving the
// protocol server the environment required by its PowerShell control host.
const required = ["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "PATH", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR"]

export function windowsTargetEnvironment(env: NodeJS.ProcessEnv, host: NodeJS.ProcessEnv = process.env): Buffer {
  const keys: string[] = []
  for (const key in env) keys.push(key)
  const seen = new Set<string>(), entries = new Map<string, string>()
  for (const key of keys.sort()) {
    const folded = key.toUpperCase()
    if (seen.has(folded)) continue
    seen.add(folded)
    const value = env[key]
    if (value === undefined) continue
    if (!key || key.includes("\0") || (key.includes("=") && !/^=[a-z]:$/i.test(key)) || String(value).includes("\0")) {
      throw new TypeError("Invalid Windows environment entry")
    }
    entries.set(folded, `${key}=${value}`)
  }
  // uv_spawn already supplies these OS variables when options.env omits them.
  // Explicit values, including empty strings, always win. No other host keys
  // (tokens, loader flags, or the temporary carrier) enter the target block.
  for (const key of required) {
    if (entries.has(key)) continue
    const hostKey = Object.keys(host).sort().find(candidate => candidate.toUpperCase() === key)
    if (hostKey && host[hostKey] !== undefined) {
      const value = String(host[hostKey])
      if (value.includes("\0")) throw new TypeError("Invalid Windows environment entry")
      entries.set(key, `${hostKey}=${value}`)
    }
  }
  // The native bootstrap applies Windows ordinal key ordering before launch.
  // Even an empty block has two UTF-16 NUL terminators (four bytes).
  return Buffer.from([...entries.values()].join("\0") + "\0\0", "utf16le")
}
