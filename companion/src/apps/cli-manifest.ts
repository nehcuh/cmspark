// Structured CLI contract (Apps Phase-2 / L-CLI-*).
// Manifest is the ONLY way to authorize subcommands/flags/positionals.
// Free-args are forbidden — positionals are fixed-arity slots only.

export type CliRisk = "read-only" | "state-changing" | "dangerous"

export interface CliFlagSpec {
  name: string
  takes_value: boolean
  /** Required when takes_value; full-string match against the value. */
  value_regex?: string
  description?: string
}

export interface CliPositionalSlot {
  name: string
  required: boolean
  /** Full-string match; defaults applied in validate if omitted. */
  value_regex?: string
  max_len?: number
}

export interface CliSubcommand {
  name: string
  description?: string
  risk: CliRisk
  flags?: CliFlagSpec[]
  positionals?: CliPositionalSlot[]
  timeout_ms?: number
  max_output_bytes?: number
}

export interface CliManifest {
  schema_version: 1
  subcommands: CliSubcommand[]
  defaults?: {
    timeout_ms?: number
    max_output_bytes?: number
  }
}

export const CLI_DEFAULT_TIMEOUT_MS = 15_000
export const CLI_HARD_TIMEOUT_MS = 120_000
export const CLI_DEFAULT_MAX_OUTPUT = 65_536
export const CLI_HARD_MAX_OUTPUT = 256_000
export const CLI_TRUNCATE_CHARS = 8_000

/** Charset for flag values / positionals unless overridden by value_regex. */
export const CLI_SAFE_VALUE = /^[A-Za-z0-9._:@/\\+\-=,~ ]{1,512}$/

const SUB_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}$/
const FLAG_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_\-]{0,31}$/
const RISKS: ReadonlySet<string> = new Set(["read-only", "state-changing", "dangerous"])

export function validateCliManifest(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "cli_manifest must be an object"
  }
  const m = raw as Record<string, unknown>
  if (m.schema_version !== 1) return "cli_manifest.schema_version must be 1"
  if (!Array.isArray(m.subcommands) || m.subcommands.length < 1) {
    return "cli_manifest.subcommands must be a non-empty array"
  }
  if (m.subcommands.length > 64) return "cli_manifest.subcommands cap is 64"
  const names = new Set<string>()
  for (const sc of m.subcommands) {
    if (!sc || typeof sc !== "object" || Array.isArray(sc)) {
      return "each subcommand must be an object"
    }
    const s = sc as Record<string, unknown>
    if (typeof s.name !== "string" || !SUB_NAME.test(s.name)) {
      return `invalid subcommand name "${s.name}"`
    }
    if (names.has(s.name)) return `duplicate subcommand "${s.name}"`
    names.add(s.name)
    if (typeof s.risk !== "string" || !RISKS.has(s.risk)) {
      return `subcommand "${s.name}" risk must be read-only|state-changing|dangerous`
    }
    if (s.flags !== undefined) {
      if (!Array.isArray(s.flags)) return `subcommand "${s.name}" flags must be an array`
      const fn = new Set<string>()
      for (const f of s.flags) {
        if (!f || typeof f !== "object") return `subcommand "${s.name}" has invalid flag`
        const fl = f as Record<string, unknown>
        if (typeof fl.name !== "string" || !FLAG_NAME.test(fl.name)) {
          return `subcommand "${s.name}" invalid flag name`
        }
        if (fn.has(fl.name)) return `subcommand "${s.name}" duplicate flag "${fl.name}"`
        fn.add(fl.name)
        if (typeof fl.takes_value !== "boolean") {
          return `flag "${fl.name}" takes_value must be boolean`
        }
        if (fl.takes_value && fl.value_regex !== undefined && typeof fl.value_regex !== "string") {
          return `flag "${fl.name}" value_regex must be string`
        }
        if (fl.takes_value && typeof fl.value_regex === "string") {
          try {
            // eslint-disable-next-line no-new
            new RegExp(fl.value_regex)
          } catch {
            return `flag "${fl.name}" value_regex is not a valid RegExp`
          }
        }
      }
    }
    if (s.positionals !== undefined) {
      if (!Array.isArray(s.positionals)) return `subcommand "${s.name}" positionals must be an array`
      if (s.positionals.length > 16) return `subcommand "${s.name}" positionals cap is 16`
      for (const pos of s.positionals) {
        if (!pos || typeof pos !== "object") return `subcommand "${s.name}" invalid positional`
        const p = pos as Record<string, unknown>
        if (typeof p.name !== "string" || !p.name) return `positional requires name`
        if (typeof p.required !== "boolean") return `positional "${p.name}" required must be boolean`
        if (p.value_regex !== undefined && typeof p.value_regex !== "string") {
          return `positional "${p.name}" value_regex must be string`
        }
        if (typeof p.value_regex === "string") {
          try {
            // eslint-disable-next-line no-new
            new RegExp(p.value_regex)
          } catch {
            return `positional "${p.name}" value_regex is not a valid RegExp`
          }
        }
      }
    }
    if (s.timeout_ms !== undefined) {
      if (typeof s.timeout_ms !== "number" || s.timeout_ms < 1000 || s.timeout_ms > CLI_HARD_TIMEOUT_MS) {
        return `subcommand "${s.name}" timeout_ms out of range`
      }
    }
    if (s.max_output_bytes !== undefined) {
      if (
        typeof s.max_output_bytes !== "number" ||
        s.max_output_bytes < 1024 ||
        s.max_output_bytes > CLI_HARD_MAX_OUTPUT
      ) {
        return `subcommand "${s.name}" max_output_bytes out of range`
      }
    }
  }
  if (m.defaults !== undefined) {
    if (!m.defaults || typeof m.defaults !== "object" || Array.isArray(m.defaults)) {
      return "cli_manifest.defaults must be an object"
    }
    const d = m.defaults as Record<string, unknown>
    if (d.timeout_ms !== undefined) {
      if (typeof d.timeout_ms !== "number" || d.timeout_ms < 1000 || d.timeout_ms > CLI_HARD_TIMEOUT_MS) {
        return "defaults.timeout_ms out of range"
      }
    }
    if (d.max_output_bytes !== undefined) {
      if (
        typeof d.max_output_bytes !== "number" ||
        d.max_output_bytes < 1024 ||
        d.max_output_bytes > CLI_HARD_MAX_OUTPUT
      ) {
        return "defaults.max_output_bytes out of range"
      }
    }
  }
  return null
}

export function asCliManifest(raw: unknown): CliManifest | null {
  if (validateCliManifest(raw) !== null) return null
  return raw as CliManifest
}

/** Reject option-injection prefixes (D6 / L-CLI-8). */
export function looksLikeOptionInjection(value: string): boolean {
  const v = String(value || "")
  if (!v) return false
  return v.startsWith("-") || v.startsWith("/") || v.startsWith("@")
}

/**
 * Full-string match (contract: value_regex must match the entire value).
 * Unanchored patterns must not partial-pass (e.g. "safe" must not accept "unsafe").
 */
export function fullStringRegexMatch(pattern: string, value: string): boolean {
  const re = new RegExp(pattern)
  const m = value.match(re)
  return m != null && m.index === 0 && m[0] === value
}

export function validateSlotValue(
  value: string,
  opts: { value_regex?: string; max_len?: number; label: string },
): string | null {
  if (typeof value !== "string") return `${opts.label} must be a string`
  const max = opts.max_len ?? 512
  if (value.length === 0) return `${opts.label} must be non-empty`
  if (value.length > max) return `${opts.label} exceeds max_len ${max}`
  if (looksLikeOptionInjection(value)) {
    return `${opts.label} rejects leading -/ / /@ (option-injection)`
  }
  if (opts.value_regex) {
    try {
      if (!fullStringRegexMatch(opts.value_regex, value)) {
        return `${opts.label} failed value_regex`
      }
    } catch {
      return `${opts.label} has invalid value_regex in manifest`
    }
  } else if (!CLI_SAFE_VALUE.test(value)) {
    return `${opts.label} failed charset whitelist`
  }
  return null
}

export interface HostCliParams {
  app: string
  subcommand: string
  flags?: Record<string, string | boolean>
  /** Positional values in manifest order (fixed arity). */
  args?: string[]
  security_token?: string
}

/**
 * Build argv for execFile from entry exe + validated subcommand + flags + positionals.
 * Returns error string or { argv, risk, timeoutMs, maxOutputBytes }.
 */
export function buildCliArgv(
  manifest: CliManifest,
  params: HostCliParams,
):
  | { ok: true; argv: string[]; risk: CliRisk; timeoutMs: number; maxOutputBytes: number; sub: CliSubcommand }
  | { ok: false; error: string } {
  const sub = manifest.subcommands.find((s) => s.name === params.subcommand)
  if (!sub) return { ok: false, error: `unknown subcommand "${params.subcommand}"` }

  const flagSpecs = sub.flags ?? []
  const flagMap = new Map(flagSpecs.map((f) => [f.name, f]))
  const incoming = params.flags ?? {}
  const argv: string[] = [sub.name]

  // Only declared flags; sorted for canonical binding.
  const keys = Object.keys(incoming).sort()
  for (const k of keys) {
    const spec = flagMap.get(k)
    if (!spec) return { ok: false, error: `undeclared flag "${k}"` }
    const raw = incoming[k]
    if (spec.takes_value) {
      if (typeof raw !== "string") return { ok: false, error: `flag "${k}" requires a string value` }
      const err = validateSlotValue(raw, {
        value_regex: spec.value_regex,
        label: `flag "${k}"`,
      })
      if (err) return { ok: false, error: err }
      argv.push(`--${k}`, raw)
    } else {
      if (raw !== true && raw !== "true") {
        return { ok: false, error: `boolean flag "${k}" must be true` }
      }
      argv.push(`--${k}`)
    }
  }

  const slots = sub.positionals ?? []
  const args = params.args ?? []
  if (args.length > slots.length) {
    return { ok: false, error: `too many positionals (max ${slots.length})` }
  }
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const val = args[i]
    if (val === undefined || val === "") {
      if (slot.required) return { ok: false, error: `missing required positional "${slot.name}"` }
      continue
    }
    const err = validateSlotValue(val, {
      value_regex: slot.value_regex,
      max_len: slot.max_len,
      label: `positional "${slot.name}"`,
    })
    if (err) return { ok: false, error: err }
    argv.push(val)
  }

  const defT = manifest.defaults?.timeout_ms ?? CLI_DEFAULT_TIMEOUT_MS
  const defO = manifest.defaults?.max_output_bytes ?? CLI_DEFAULT_MAX_OUTPUT
  let timeoutMs = sub.timeout_ms ?? defT
  let maxOutputBytes = sub.max_output_bytes ?? defO
  if (sub.risk === "dangerous") {
    // Dangerous cannot raise ceilings above defaults.
    timeoutMs = Math.min(timeoutMs, defT)
    maxOutputBytes = Math.min(maxOutputBytes, defO)
  }
  timeoutMs = Math.min(Math.max(1000, timeoutMs), CLI_HARD_TIMEOUT_MS)
  maxOutputBytes = Math.min(Math.max(1024, maxOutputBytes), CLI_HARD_MAX_OUTPUT)

  return { ok: true, argv, risk: sub.risk, timeoutMs, maxOutputBytes, sub }
}

/** Canonical binding fragment for flags+args (stable, sorted). */
export function canonicalCliBinding(params: HostCliParams): string {
  const flags = params.flags ?? {}
  const flagPart = Object.keys(flags)
    .sort()
    .map((k) => `${k}=${String(flags[k])}`)
    .join(",")
  const argsPart = (params.args ?? []).join("\u001f")
  return `${flagPart}|${argsPart}`
}

export function hostCliBindingPayload(params: Record<string, any>): string {
  const app = String(params?.app || "")
  const sub = String(params?.subcommand || "")
  if (!app || !sub) return "" // empty → issueToken should fail closed in tests
  return `${app}|${sub}|${canonicalCliBinding({
    app,
    subcommand: sub,
    flags: params?.flags,
    args: params?.args,
  })}`
}
