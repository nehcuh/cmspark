import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js"
import { getToolDefinitions } from "../bridge/tool-definitions"
import { TOOL_ARG_SCHEMAS, tryParseToolArgs } from "../bridge/tool-schemas"
import { outboundContextRequestSchema } from "./context-projection"
import { outboundToInternalName } from "./profile"
import { outboundNeedsTabLease } from "./dual-entry"

type Schema = Record<string, any> & { type: "object" }
const schemas = new Map<string, Schema>()
const ajv = new AjvJsonSchemaValidator()
const validators = new Map<string, ReturnType<typeof ajv.getValidator>>()

function requireOneOf(...keys: string[]) { return { anyOf: keys.map(key => ({ required: [key] })) } }

/** The native tool contract is the source; no second hand-maintained tool catalog. */
export function outboundToolArgumentSchema(canonical: string): Schema {
  const cached = schemas.get(canonical)
  if (cached) return structuredClone(cached)
  const internal = outboundToInternalName(canonical)
  const definition = getToolDefinitions().find(tool => tool.function.name === internal)
  const zod = internal === "site_context" ? outboundContextRequestSchema : TOOL_ARG_SCHEMAS[internal ?? ""]
  let schema: Schema
  if (canonical === "cmspark__accept_data_disclosure") {
    schema = { type: "object", properties: { acknowledge: { type: "boolean" } }, required: ["acknowledge"] }
  } else if (canonical === "cmspark__list_outbound_profile") {
    schema = { type: "object", properties: {} }
  } else if (zod) {
    schema = toJsonSchemaCompat(zod as any, { pipeStrategy: "input" }) as Schema
  } else if (definition) {
    schema = structuredClone(definition.function.parameters) as Schema
  } else {
    throw new Error(`Missing outbound argument contract: ${canonical}`)
  }
  delete schema.$schema
  schema.additionalProperties = false
  for (const [key, property] of Object.entries(definition?.function.parameters.properties ?? {})) {
    if (schema.properties?.[key] && property.description) schema.properties[key].description = property.description
  }
  if (schema.properties?.tabId) Object.assign(schema.properties.tabId, { type: "integer", minimum: 1 })
  if (internal === "navigate" || internal === "create_tab") schema.properties.url.format = "uri"
  // Outbound L9 deliberately disallows the native screenshot/vision active-tab
  // default: callers must choose a tab before acquiring the shared lease.
  if (outboundNeedsTabLease(internal ?? "") || internal === "site_context") {
    schema.required = [...new Set([...(schema.required ?? []), "tabId"])]
  }
  // Zod's arbitrary refine functions cannot be represented by its converter.
  // Expose existing native alternatives as JSON Schema too; execution validates
  // this exact schema and retains the native refinements below.
  if (["click", "dblclick", "hover", "get_element_info", "select_option"].includes(internal ?? "")) {
    Object.assign(schema, requireOneOf("selector", "text"))
  }
  if (internal === "downloads_find") Object.assign(schema, requireOneOf("filenameHint", "urlContains"))
  if (internal === "drag_and_drop") schema.allOf = [requireOneOf("from_selector", "from_text"), requireOneOf("to_selector", "to_text")]
  if (internal === "fill_form") Object.assign(schema.properties.fields.items, requireOneOf("selector", "text"))
  schemas.set(canonical, schema)
  return structuredClone(schema)
}

/** Both longstanding wire forms are discoverable. Domain remains envelope metadata. */
export function outboundToolWireSchema(canonical: string): Schema {
  const tool = outboundToolArgumentSchema(canonical)
  if (canonical === "cmspark__accept_data_disclosure" || canonical === "cmspark__list_outbound_profile") return tool
  const domain = { type: "string", description: "Optional domain hint for auditing; does not grant permission." }
  const flat = { ...tool, properties: { ...tool.properties, domain } }
  const wrapped = { type: "object", properties: { args: tool, domain }, required: ["args"], additionalProperties: false }
  return { type: "object", properties: { ...flat.properties, args: tool }, anyOf: [flat, wrapped] }
}

function validate(canonical: string, raw: unknown, wire: boolean): string | null {
  const key = `${wire ? "wire" : "args"}:${canonical}`
  let validator = validators.get(key)
  if (!validator) {
    validator = ajv.getValidator(wire ? outboundToolWireSchema(canonical) : outboundToolArgumentSchema(canonical))
    validators.set(key, validator)
  }
  const result = validator(raw)
  return result.valid ? null : `Invalid outbound arguments: ${result.errorMessage ?? "schema mismatch"}`
}

export function validateOutboundToolArgs(canonical: string, args: unknown, domain?: unknown): string | null {
  if (domain !== undefined && typeof domain !== "string") return "Invalid outbound domain: expected string"
  const error = validate(canonical, args, false)
  if (error) return error
  const native = tryParseToolArgs(outboundToInternalName(canonical)!, args)
  return native.ok ? null : native.error
}

export function decodeOutboundWireArgs(canonical: string, input: Record<string, unknown>):
  { ok: true; args: Record<string, unknown>; domain?: string } | { ok: false; error: string } {
  const error = validate(canonical, input, true)
  if (error) return { ok: false, error }
  const args = input.args && typeof input.args === "object" && !Array.isArray(input.args)
    ? input.args as Record<string, unknown>
    : Object.fromEntries(Object.entries(input).filter(([key]) => key !== "domain"))
  const domain = typeof input.domain === "string" ? input.domain : undefined
  const nativeError = validateOutboundToolArgs(canonical, args, domain)
  return nativeError ? { ok: false, error: nativeError } : { ok: true, args, domain }
}
