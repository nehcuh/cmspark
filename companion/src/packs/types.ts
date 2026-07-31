// Mission Pack types — see docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md

export type PackChannel = "community" | "enterprise"
export type MinCapability = "L0" | "L1" | "L2"
export type ToolsMode = "allowlist" | "intersect" | "unchanged"
export type SelectionMode = "auto" | "all" | "manual"

export interface PackTools {
  mode: ToolsMode
  allow: string[]
  deny: string[]
}

export interface PackThreadDefaults {
  skill_selection_mode?: SelectionMode
  knowledge_selection_mode?: SelectionMode
  mcp_selection_mode?: SelectionMode
}

export interface PackManifest {
  schema_version: number
  id: string
  name: string
  description?: string
  version: string
  channel: PackChannel
  min_capability: MinCapability
  requires_modules: string[]
  skills: string[]
  knowledge: string[]
  mcp_servers: string[]
  tools: PackTools
  system_prompt_append: string
  /**
   * ADR-016: when true, pack apply enables thread.board_mode and structured
   * collect_handback is required (Fact/Intent JSON). Default undefined = off.
   */
  board_mode?: boolean
  thread_defaults?: PackThreadDefaults
  workspace?: { type: "none" | "local_path" }
  author?: string
  tags?: string[]
  /** Optional UX copy for scene apply modal (product SoT). */
  ui?: {
    suitable_for?: string
    unsuitable_for?: string
    tools_summary_zh?: string
  }
}

export interface ThreadPackSnapshot {
  tool_whitelist: string[] | null
  active_skill_ids: string[]
  skill_selection_mode?: SelectionMode
  knowledge_selection_mode?: SelectionMode
  mcp_selection_mode?: SelectionMode
  active_mcp_server_ids?: string[]
  system_prompt_append: string | null
}

export interface PackListItem {
  id: string
  name: string
  description?: string
  version: string
  channel: PackChannel
  min_capability: MinCapability
  requires_modules: string[]
  apply_blocked?: string | null
  installed_path: string
  suitable_for?: string
  unsuitable_for?: string
  tools_summary_zh?: string
}

export type ValidateResult =
  | {
      ok: true
      manifest: PackManifest
      skillAbsPaths: string[]
      knowledgeAbsPaths: string[]
    }
  | { ok: false; error: string }

export interface PackApplyPatch {
  mission_pack_id: string | null
  mission_pack_snapshot: ThreadPackSnapshot | null
  tool_whitelist: string[] | null
  active_skill_ids: string[]
  skill_selection_mode?: SelectionMode
  knowledge_selection_mode?: SelectionMode
  mcp_selection_mode?: SelectionMode
  active_mcp_server_ids?: string[]
  system_prompt_append: string | null
  workspace_root?: string | null
  /** ADR-016: set when pack.manifest.board_mode is true. */
  board_mode?: boolean
}

export const FORBIDDEN_PACK_KEYS = new Set([
  "auto_approve_dangerous",
  "allow_all_schemes",
  "auto_approve_enterprise_tools",
  "auto_approved_domains",
  "trusted_domains",
  "god_mode",
])

export const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
export const MAX_SYSTEM_PROMPT_APPEND = 16 * 1024
export const MAX_PACK_FILE_BYTES = 1 * 1024 * 1024
export const MAX_PACK_TOTAL_BYTES = 50 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 1000
