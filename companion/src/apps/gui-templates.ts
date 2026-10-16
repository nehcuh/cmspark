// #686: one reviewed GUI parser profile, no arbitrary argument templating.
import { checkAddAllowed } from "./guards"
import type { AppEntry } from "./types"

export const GUI_TEMPLATE_PROFILE = "npp-8.9.8.1-x64-local-text-v1" as const
export const GUI_TEMPLATE_FLAGS = Object.freeze(["-multiInst", "-nosession", "-noPlugin", "-ro"] as const)
export interface GuiFileTemplate {
  id: string
  name: string
  profile: typeof GUI_TEMPLATE_PROFILE
  risk: "state-changing" | "dangerous"
  argv: ["-multiInst", "-nosession", "-noPlugin", "-ro", { file_slot: "file" }]
}
function exactKeys(value: any, keys: string[]): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k))
}
export function guiTemplateConfigError(raw: unknown, entry: Pick<AppEntry, "token" | "kind" | "exe" | "aumid" | "bundleId" | "cli_manifest">): string | null {
  if (!Array.isArray(raw)) return "templates must be an array"
  if (!raw.length) return null
  if (raw.length !== 1) return "one GUI file template is supported per app"
  if (!entry.token.startsWith("win.app.") || entry.kind !== "gui" || !entry.exe?.path || entry.aumid || entry.bundleId || entry.cli_manifest) return "templates require a Windows GUI exe without other launch identities"
  const guard = checkAddAllowed(entry.exe.path, "gui")
  if (!guard.allowed || !guard.templatesAllowed) return "templates are forbidden for vault/LOLBIN apps"
  const t = raw[0]
  try { if (Buffer.byteLength(JSON.stringify(t), "utf8") > 4096) return "template exceeds 4 KiB" } catch { return "invalid template object" }
  if (!exactKeys(t, ["id", "name", "profile", "risk", "argv"])) return "invalid template fields"
  if (typeof t.id !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(t.id)) return "invalid template id"
  if (typeof t.name !== "string" || !t.name.trim() || t.name.length > 80 || /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(t.name)) return "invalid template name"
  if (t.profile !== GUI_TEMPLATE_PROFILE) return "unsupported GUI template profile"
  if (t.risk !== "state-changing" && t.risk !== "dangerous") return "invalid GUI template risk"
  if (!Array.isArray(t.argv) || t.argv.length !== 5 || GUI_TEMPLATE_FLAGS.some((flag, i) => t.argv[i] !== flag)
    || !exactKeys(t.argv[4], ["file_slot"]) || t.argv[4].file_slot !== "file") return "GUI template argv must use the four fixed flags and one file slot"
  return null
}
export function selectGuiTemplate(entry: AppEntry, id: unknown): Readonly<GuiFileTemplate> {
  const err = guiTemplateConfigError(entry.templates, entry)
  if (err) throw new Error(`host_app template: ${err}`)
  const t = entry.templates?.[0]
  if (!t || typeof id !== "string" || t.id !== id) throw new Error("host_app template: unknown template")
  return Object.freeze({ ...t, argv: Object.freeze([...GUI_TEMPLATE_FLAGS, Object.freeze({ file_slot: "file" })]) }) as unknown as Readonly<GuiFileTemplate>
}
/** Deterministic authority projection: configEvents ABA is latched by its caller. */
export function guiTemplateSubject(entry: AppEntry | undefined, enabled: boolean): string {
  if (!entry) return JSON.stringify([enabled, null])
  return JSON.stringify([enabled, entry.token, entry.kind, entry.source, entry.display_name,
    entry.added_at, entry.policy, entry.enabled, entry.aumid, entry.bundleId, entry.coordinateAllowed,
    entry.exe?.path, entry.exe?.sha256, entry.exe?.signer, entry.exe?.user_writable_dir,
    entry.templates, entry.cli_manifest])
}
/** A caller cannot manufacture native argv, risk or an execution receipt. */
export function guiTemplateCall(params: Record<string, any>): { app: string; template: string; file: string } {
  const allowed = new Set(["app", "action", "template", "params", "security_token", "__thread_id", "_thread_id", "__enterprise_guard", "__outbound_mcp", "__outbound_caller_id"])
  if (!params || (Object.getPrototypeOf(params) !== Object.prototype && Object.getPrototypeOf(params) !== null)
    || !["app", "action", "template", "params"].every(k => Object.hasOwn(params, k))
    || Object.keys(params).some(k => !allowed.has(k)) || params.action !== "run_template"
    || (params.security_token !== undefined && typeof params.security_token !== "string")
    || ["__thread_id", "_thread_id", "__outbound_caller_id"].some(k => params[k] !== undefined && typeof params[k] !== "string")
    || (params.__outbound_mcp !== undefined && params.__outbound_mcp !== true)
    || typeof params.app !== "string" || !/^win\.app\.[a-z0-9][a-z0-9_-]{1,31}$/.test(params.app)
    || typeof params.template !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(params.template)
    || !exactKeys(params.params, ["file"]) || typeof params.params.file !== "string" || !params.params.file.length || params.params.file.length > 259) throw new Error("host_app template: invalid input")
  return { app: params.app, template: params.template, file: params.params.file }
}
