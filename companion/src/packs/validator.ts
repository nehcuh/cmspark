import * as fs from "fs"
import * as path from "path"
import * as yaml from "js-yaml"
import { getAllToolDefinitions } from "../bridge/tool-definitions"
import {
  FORBIDDEN_PACK_KEYS,
  MAX_PACK_FILE_BYTES,
  MAX_PACK_TOTAL_BYTES,
  MAX_SYSTEM_PROMPT_APPEND,
  PACK_ID_RE,
  type PackManifest,
  type SelectionMode,
  type ToolsMode,
  type ValidateResult,
} from "./types"

const VALID_CHANNELS = new Set(["community", "enterprise"])
const VALID_CAPS = new Set(["L0", "L1", "L2"])
const VALID_TOOL_MODES = new Set(["allowlist", "intersect", "unchanged"])
const VALID_SEL = new Set(["auto", "all", "manual"])

function knownToolNames(): Set<string> {
  // Full catalog (includes osascript_eval) so pack validation is platform-stable.
  return new Set(getAllToolDefinitions().map((t) => t.function.name))
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function asStringArray(v: unknown, field: string): string[] | { error: string } {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    return { error: `${field} must be an array of strings` }
  }
  return v as string[]
}

function resolveContained(packRoot: string, rel: string): string | { error: string } {
  if (!rel || typeof rel !== "string") return { error: `invalid relative path: ${rel}` }
  if (path.isAbsolute(rel)) return { error: `absolute paths not allowed: ${rel}` }
  const rootReal = fs.realpathSync(packRoot)
  const joined = path.resolve(packRoot, rel)
  let targetReal: string
  try {
    targetReal = fs.realpathSync(joined)
  } catch {
    return { error: `path does not exist: ${rel}` }
  }
  const relToRoot = path.relative(rootReal, targetReal)
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    return { error: `path escapes pack root: ${rel}` }
  }
  return targetReal
}

function scanForbidden(obj: unknown, pathHint: string): string | null {
  if (!isPlainObject(obj)) return null
  for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN_PACK_KEYS.has(k)) {
      return `forbidden security key "${k}" at ${pathHint}`
    }
    if (isPlainObject(v) || Array.isArray(v)) {
      const nested = scanForbidden(v, `${pathHint}.${k}`)
      if (nested) return nested
    }
  }
  return null
}

function parseSelection(v: unknown, field: string): SelectionMode | undefined | { error: string } {
  if (v === undefined) return undefined
  if (typeof v !== "string" || !VALID_SEL.has(v)) {
    return { error: `${field} must be one of auto|all|manual` }
  }
  return v as SelectionMode
}

/**
 * Validate a pack directory that already contains pack.yaml (and assets on disk).
 */
export function validatePackDir(packDir: string): ValidateResult {
  if (!fs.existsSync(packDir) || !fs.statSync(packDir).isDirectory()) {
    return { ok: false, error: `pack directory not found: ${packDir}` }
  }

  const yamlPath = path.join(packDir, "pack.yaml")
  if (!fs.existsSync(yamlPath)) {
    return { ok: false, error: "pack.yaml missing" }
  }

  let raw: string
  try {
    raw = fs.readFileSync(yamlPath, "utf-8")
  } catch (e: any) {
    return { ok: false, error: `cannot read pack.yaml: ${e?.message || e}` }
  }

  let doc: unknown
  try {
    doc = yaml.load(raw)
  } catch (e: any) {
    return { ok: false, error: `invalid pack.yaml: ${e?.message || e}` }
  }

  if (!isPlainObject(doc)) {
    return { ok: false, error: "pack.yaml must be a mapping" }
  }

  const forbidden = scanForbidden(doc, "pack")
  if (forbidden) return { ok: false, error: forbidden }

  if (doc.schema_version !== 1) {
    return { ok: false, error: `unsupported schema_version: ${doc.schema_version}` }
  }

  if (typeof doc.id !== "string" || !PACK_ID_RE.test(doc.id)) {
    return { ok: false, error: `invalid pack id (expected ${PACK_ID_RE})` }
  }
  if (typeof doc.name !== "string" || !doc.name.trim()) {
    return { ok: false, error: "name is required" }
  }
  if (typeof doc.version !== "string" || !doc.version.trim()) {
    return { ok: false, error: "version is required" }
  }
  if (typeof doc.channel !== "string" || !VALID_CHANNELS.has(doc.channel)) {
    return { ok: false, error: "channel must be community|enterprise" }
  }
  if (typeof doc.min_capability !== "string" || !VALID_CAPS.has(doc.min_capability)) {
    return { ok: false, error: "min_capability must be L0|L1|L2" }
  }
  if (typeof doc.system_prompt_append !== "string") {
    return { ok: false, error: "system_prompt_append is required (string)" }
  }
  if (doc.system_prompt_append.length === 0 || doc.system_prompt_append.length > MAX_SYSTEM_PROMPT_APPEND) {
    return {
      ok: false,
      error: `system_prompt_append length must be 1..${MAX_SYSTEM_PROMPT_APPEND}`,
    }
  }

  const requires = asStringArray(doc.requires_modules, "requires_modules")
  if ("error" in requires) return { ok: false, error: requires.error }
  const skills = asStringArray(doc.skills, "skills")
  if ("error" in skills) return { ok: false, error: skills.error }
  const knowledge = asStringArray(doc.knowledge, "knowledge")
  if ("error" in knowledge) return { ok: false, error: knowledge.error }
  const mcpServers = asStringArray(doc.mcp_servers, "mcp_servers")
  if ("error" in mcpServers) return { ok: false, error: mcpServers.error }

  if (!isPlainObject(doc.tools)) {
    return { ok: false, error: "tools is required" }
  }
  const toolsObj = doc.tools
  if (typeof toolsObj.mode !== "string" || !VALID_TOOL_MODES.has(toolsObj.mode)) {
    return { ok: false, error: "tools.mode must be allowlist|intersect|unchanged" }
  }
  const allow = asStringArray(toolsObj.allow, "tools.allow")
  if ("error" in allow) return { ok: false, error: allow.error }
  const deny = asStringArray(toolsObj.deny, "tools.deny")
  if ("error" in deny) return { ok: false, error: deny.error }

  const known = knownToolNames()
  for (const t of allow) {
    if (!known.has(t)) {
      return { ok: false, error: `unknown tool: ${t}` }
    }
  }
  for (const t of deny) {
    if (!known.has(t)) {
      return { ok: false, error: `unknown tool in deny: ${t}` }
    }
  }

  let threadDefaults: PackManifest["thread_defaults"] | undefined
  if (doc.thread_defaults !== undefined) {
    if (!isPlainObject(doc.thread_defaults)) {
      return { ok: false, error: "thread_defaults must be a mapping" }
    }
    const tdForbidden = scanForbidden(doc.thread_defaults, "thread_defaults")
    if (tdForbidden) return { ok: false, error: tdForbidden }
    const s = parseSelection(doc.thread_defaults.skill_selection_mode, "thread_defaults.skill_selection_mode")
    if (s && typeof s === "object" && "error" in s) return { ok: false, error: s.error }
    const k = parseSelection(doc.thread_defaults.knowledge_selection_mode, "thread_defaults.knowledge_selection_mode")
    if (k && typeof k === "object" && "error" in k) return { ok: false, error: k.error }
    const m = parseSelection(doc.thread_defaults.mcp_selection_mode, "thread_defaults.mcp_selection_mode")
    if (m && typeof m === "object" && "error" in m) return { ok: false, error: m.error }
    threadDefaults = {
      skill_selection_mode: s as SelectionMode | undefined,
      knowledge_selection_mode: k as SelectionMode | undefined,
      mcp_selection_mode: m as SelectionMode | undefined,
    }
  }

  let totalBytes = Buffer.byteLength(raw, "utf-8")
  const skillAbsPaths: string[] = []
  for (const rel of skills) {
    const resolved = resolveContained(packDir, rel)
    if (typeof resolved === "object") return { ok: false, error: resolved.error }
    const st = fs.statSync(resolved)
    if (!st.isFile()) return { ok: false, error: `skill is not a file: ${rel}` }
    if (st.size > MAX_PACK_FILE_BYTES) return { ok: false, error: `skill file too large: ${rel}` }
    totalBytes += st.size
    skillAbsPaths.push(resolved)
  }
  const knowledgeAbsPaths: string[] = []
  for (const rel of knowledge) {
    const resolved = resolveContained(packDir, rel)
    if (typeof resolved === "object") return { ok: false, error: resolved.error }
    const st = fs.statSync(resolved)
    if (!st.isFile()) return { ok: false, error: `knowledge is not a file: ${rel}` }
    if (st.size > MAX_PACK_FILE_BYTES) return { ok: false, error: `knowledge file too large: ${rel}` }
    totalBytes += st.size
    knowledgeAbsPaths.push(resolved)
  }
  if (totalBytes > MAX_PACK_TOTAL_BYTES) {
    return { ok: false, error: `pack total size exceeds ${MAX_PACK_TOTAL_BYTES} bytes` }
  }

  if (doc.board_mode !== undefined && typeof doc.board_mode !== "boolean") {
    return { ok: false, error: "board_mode must be a boolean when present" }
  }

  const manifest: PackManifest = {
    schema_version: 1,
    id: doc.id,
    name: doc.name.trim(),
    description: typeof doc.description === "string" ? doc.description : undefined,
    version: doc.version.trim(),
    channel: doc.channel as PackManifest["channel"],
    min_capability: doc.min_capability as PackManifest["min_capability"],
    requires_modules: requires,
    skills,
    knowledge,
    mcp_servers: mcpServers,
    tools: {
      mode: toolsObj.mode as ToolsMode,
      allow,
      deny,
    },
    system_prompt_append: doc.system_prompt_append,
    board_mode: doc.board_mode === true ? true : undefined,
    thread_defaults: threadDefaults,
    workspace:
      isPlainObject(doc.workspace) && (doc.workspace.type === "none" || doc.workspace.type === "local_path")
        ? { type: doc.workspace.type }
        : undefined,
    author: typeof doc.author === "string" ? doc.author : undefined,
    tags: Array.isArray(doc.tags) && doc.tags.every((t) => typeof t === "string") ? (doc.tags as string[]) : undefined,
    ui:
      isPlainObject(doc.ui)
        ? {
            suitable_for: typeof doc.ui.suitable_for === "string" ? doc.ui.suitable_for : undefined,
            unsuitable_for: typeof doc.ui.unsuitable_for === "string" ? doc.ui.unsuitable_for : undefined,
            tools_summary_zh:
              typeof doc.ui.tools_summary_zh === "string" ? doc.ui.tools_summary_zh : undefined,
          }
        : undefined,
  }

  return { ok: true, manifest, skillAbsPaths, knowledgeAbsPaths }
}
