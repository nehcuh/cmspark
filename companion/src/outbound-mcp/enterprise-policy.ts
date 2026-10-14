/** Administrator-owned authority; never parsed from an execution request. */
import { createHash, createPublicKey, randomUUID } from "node:crypto"
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, type Stats } from "node:fs"
import { dirname, join } from "node:path"
import { getConfigDir } from "../config"
import { atomicWriteJSON } from "../io"

export const ENTERPRISE_VERSION = 1 as const
export class EnterpriseError extends Error {
  constructor(public readonly code: string, public readonly status = 403) { super(code) }
}
export function deny(code: string, status = 403): never { throw new EnterpriseError(code, status) }
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) deny("INVALID_INPUT", 400)
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !keys.includes(key))) deny("INVALID_INPUT", 400)
  return result
}
export function string(value: unknown, max = 256): string {
  if (typeof value !== "string" || !value.length || value.length > max || /[\x00-\x1f\x7f]/.test(value)) deny("INVALID_INPUT", 400)
  return value
}
export function identifier(value: unknown): string {
  const result = string(value, 128)
  if (!/^[a-zA-Z0-9_.:-]+$/.test(result)) deny("INVALID_INPUT", 400)
  return result
}
function array<T>(value: unknown, parse: (item: unknown) => T, max = 32): T[] {
  if (!Array.isArray(value) || value.length > max) deny("INVALID_INPUT", 400)
  return value.map(parse)
}
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value)
    if (result === undefined) deny("INVALID_INPUT", 400)
    return result
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalJSON).join(",") + "]"
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalJSON((value as Record<string, unknown>)[key])).join(",") + "}"
}
export function digest(value: unknown): string { return createHash("sha256").update(canonicalJSON(value)).digest("hex") }
export type EnterpriseScope = { origin: string; path: string }
export type EnterpriseMarker = { selector: string; text?: string }
export type EnterpriseAction = {
  id: string; tool: "click" | "type"; effect: "read_only" | "write"; selector: string
  target: { tag: string; attributes: Record<string, string>; text?: string }
  max_length?: number
}
export type EnterprisePolicy = {
  version: 1; subject: string; instance_id: string; profile_id: string; revision: string; expires_at: string
  authority_public_key: string; tools: string[]; navigation: EnterpriseScope[]; evidence: EnterpriseScope[]; login: EnterpriseScope[]
  ready: EnterpriseMarker[]; login_markers: EnterpriseMarker[]; actions: EnterpriseAction[]
}
export const ENTERPRISE_TOOLS = ["create_tab", "navigate", "get_page_text", "screenshot", "click", "type", "scroll"] as const
export function canonicalURL(value: unknown): URL {
  const raw = string(value, 4096)
  // WHATWG normalizes dot segments, backslashes and default ports. Reject ambiguous
  // input before normalization so a reverse proxy cannot interpret it differently.
  if (raw.includes("\\") || /\/\.{1,2}(?:\/|[?#]|$)/.test(raw) || /%/i.test(raw.split(/[?#]/)[0])) deny("URL_AMBIGUOUS")
  let url: URL
  try { url = new URL(raw) } catch { return deny("URL_INVALID") }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.origin === "null") deny("URL_INVALID")
  return url
}
function scope(value: unknown): EnterpriseScope {
  const raw = object(value, ["origin", "path"])
  const origin = string(raw.origin, 512), path = string(raw.path, 1024)
  const url = canonicalURL(origin + path)
  if (url.origin !== origin || !path.startsWith("/") || url.pathname !== path || url.search || url.hash || path.includes("//")) deny("SCOPE_INVALID")
  return { origin, path }
}
export function inScope(url: URL, scopes: EnterpriseScope[]): boolean {
  return scopes.some(scope => scope.origin === url.origin && (scope.path === "/" || url.pathname === scope.path || url.pathname.startsWith(scope.path.replace(/\/$/, "") + "/")))
}
function marker(value: unknown): EnterpriseMarker {
  const raw = object(value, ["selector", "text"])
  return { selector: string(raw.selector, 512), ...(raw.text === undefined ? {} : { text: string(raw.text, 256) }) }
}
function action(value: unknown): EnterpriseAction {
  const raw = object(value, ["id", "tool", "effect", "selector", "target", "max_length"])
  if (!["click", "type"].includes(String(raw.tool)) || !["read_only", "write"].includes(String(raw.effect))) deny("ACTION_INVALID")
  const target = object(raw.target, ["tag", "attributes", "text"])
  const tag = string(target.tag, 32)
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) deny("ACTION_INVALID")
  const attributes = object(target.attributes, ["type", "name", "role", "aria-label", "data-action", "href"])
  const parsed: Record<string, string> = {}
  for (const [key, value] of Object.entries(attributes)) parsed[key] = string(value, 512)
  if (!Object.keys(parsed).length && target.text === undefined) deny("ACTION_TARGET_REQUIRED")
  if (raw.tool === "type" && (parsed.type !== "text" && parsed.type !== "search")) deny("CREDENTIAL_FIELD_FORBIDDEN")
  if (raw.max_length !== undefined && (!Number.isSafeInteger(raw.max_length) || Number(raw.max_length) < 1 || Number(raw.max_length) > 4096)) deny("ACTION_INVALID")
  return { id: identifier(raw.id), tool: raw.tool as EnterpriseAction["tool"], effect: raw.effect as EnterpriseAction["effect"], selector: string(raw.selector, 512),
    target: { tag, attributes: parsed, ...(target.text === undefined ? {} : { text: string(target.text, 256) }) },
    ...(raw.max_length === undefined ? {} : { max_length: Number(raw.max_length) }) }
}
export function parseEnterprisePolicy(value: unknown, profile: string, checkExpiry = true): EnterprisePolicy {
  const raw = object(value, ["version", "subject", "instance_id", "profile_id", "revision", "expires_at", "authority_public_key", "tools", "navigation", "evidence", "login", "ready", "login_markers", "actions"])
  if (raw.version !== 1) deny("POLICY_VERSION")
  const expires_at = string(raw.expires_at, 64), expiry = Date.parse(expires_at)
  if (!Number.isFinite(expiry) || (checkExpiry && expiry <= Date.now())) deny("POLICY_EXPIRED")
  const authority_public_key = raw.authority_public_key
  if (typeof authority_public_key !== "string" || authority_public_key.length > 2048) deny("AUTHORITY_INVALID")
  try { if (createPublicKey(authority_public_key).asymmetricKeyType !== "ed25519") deny("AUTHORITY_INVALID") } catch { deny("AUTHORITY_INVALID") }
  const tools = array(raw.tools, identifier)
  // profile imports the grant store; resolve after module initialization.
  const { OUTBOUND_PROFILE_TOOLS } = require("./profile") as typeof import("./profile")
  const profileTools = OUTBOUND_PROFILE_TOOLS[profile as keyof typeof OUTBOUND_PROFILE_TOOLS] as readonly string[] | undefined
  if (!profileTools || profile === "outbound_context_v1" || !tools.length || new Set(tools).size !== tools.length || tools.some(tool => !(ENTERPRISE_TOOLS as readonly string[]).includes(tool) || !profileTools.includes("cmspark__" + tool))) deny("ENTERPRISE_PROFILE_FORBIDDEN")
  const navigation = array(raw.navigation, scope), evidence = array(raw.evidence, scope), login = array(raw.login, scope)
  const ready = array(raw.ready, marker, 8), login_markers = array(raw.login_markers, marker, 8), actions = array(raw.actions, action)
  if (!navigation.length || !ready.length || !login_markers.length || new Set(actions.map(a => a.id)).size !== actions.length || actions.some(a => !tools.includes(a.tool))) deny("POLICY_INVALID")
  return { version: 1, subject: identifier(raw.subject), instance_id: identifier(raw.instance_id), profile_id: identifier(raw.profile_id), revision: identifier(raw.revision), expires_at,
    authority_public_key, tools, navigation, evidence, login, ready, login_markers, actions }
}
export type EnterpriseInstance = { version: 1; instance_id: string; profile_id: string; subject: string }
function instancePath(): string { return join(getConfigDir(), "enterprise-instance.json") }
export function enterpriseInstance(): EnterpriseInstance {
  try {
    const raw = object(JSON.parse(readFileSync(instancePath(), "utf8")), ["version", "instance_id", "profile_id", "subject"])
    if (raw.version !== 1) deny("INSTANCE_INVALID")
    return { version: 1, instance_id: identifier(raw.instance_id), profile_id: identifier(raw.profile_id), subject: identifier(raw.subject) }
  } catch { return deny("INSTANCE_UNREGISTERED") }
}
export function registerEnterpriseInstance(profileId: string, subject: string): EnterpriseInstance {
  const profile_id = identifier(profileId), boundSubject = identifier(subject)
  const path = instancePath(), lock = path + ".lock"
  let fd: number
  // Serialize the fresh read and atomic commit across administrator processes.
  // A crashed writer requires offline recovery; never steal by age or PID.
  try { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); fd = openSync(lock, "wx", 0o600) }
  catch (error) { return deny((error as NodeJS.ErrnoException).code === "EEXIST" ? "INSTANCE_BUSY" : "INSTANCE_UNWRITABLE", 503) }
  let owner: Stats | undefined
  try {
    owner = fstatSync(fd)
    if (existsSync(path)) {
      const existing = enterpriseInstance()
      if (existing.profile_id !== profile_id || existing.subject !== boundSubject) deny("INSTANCE_ALREADY_REGISTERED")
      return existing
    }
    const result: EnterpriseInstance = { version: 1, instance_id: randomUUID(), profile_id, subject: boundSubject }
    atomicWriteJSON(path, result, 0o600)
    return result
  } catch (error) {
    if (error instanceof EnterpriseError) throw error
    return deny("INSTANCE_UNWRITABLE", 503)
  } finally {
    try {
      if (owner) {
        const current = lstatSync(lock)
        if (current.dev === owner.dev && current.ino === owner.ino && current.isFile()) unlinkSync(lock)
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") deny("INSTANCE_UNWRITABLE", 503) }
    finally { try { closeSync(fd) } catch { deny("INSTANCE_UNWRITABLE", 503) } }
  }
}
